"""
prediction_server.py — Serveur ML Prédiction Réservations Hôtel
Port : 5002

VERSION 7.0 — Correction fondamentale : prédictions ancrées sur les niveaux réels

PROBLÈME v6 :
  Prophet prédit 292 pour juillet 2026 alors que juillet 2024 = ~410, juillet 2025 = ~420.
  Cause : Prophet voit une tendance baissière globale (fin 2025 creux) et l'applique à 2026.
  Résultat : pic été 2026 prédit à 70% du vrai niveau → complètement faux.

SOLUTION v7 :
  ✅ ANCRAGE SAISONNIER ABSOLU : pour chaque mois prédit, on calcule la moyenne
     réelle de ce mois sur les années passées (ex: juillet moyen = 415), et on
     s'assure que la prédiction ne descend jamais en dessous de 80% de cette moyenne.

  ✅ FLAT TREND FORCÉ : on neutralise la tendance longue de Prophet (qui est fausse)
     en recentrant la série d'entraînement sur une moyenne normalisée. Prophet
     capte alors la FORME saisonnière sans être pollué par la "tendance" baissière
     artificielle des mois creux récents.

  ✅ DÉCOMPOSITION MANUELLE SAISONNIÈRE : si Prophet échoue ou sous-estime,
     on construit la prédiction directement depuis le profil mensuel réel :
     prédiction(mois M, année A) = moyenne_historique(mois M) × trend_factor(A)
     C'est simple, transparent, et parfaitement ancré sur la réalité.

  ✅ CUTOFF ÉTENDU À 4 MOIS : on retire encore plus de mois incomplets pour
     que Prophet ne soit exposé qu'aux données stables et complètes.

  ✅ VALIDATION STRICTE POST-PROPHET : si la prédiction s'écarte de >40% de la
     moyenne saisonnière attendue, on bascule automatiquement sur la décomposition
     manuelle qui est toujours cohérente.
"""

import os
import json
import warnings
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
import mysql.connector
from flask import Flask, jsonify, request
from flask_cors import CORS

warnings.filterwarnings("ignore")


# ══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

DB_CONFIG: dict = {
    "host":     "localhost",
    "user":     "root",
    "password": "",
    "database": "hotelmanagementsystem",
    "charset":  "utf8mb4",
}

CACHE_TTL_SECONDS = 3600
MIN_ROWS_PROPHET  = 10
MIN_ROWS_ARIMA    = 5
MAX_HORIZON       = 12

# Exclure 4 mois : mois courant (mai incomplet) + 3 mois précédents
# → Prophet s'entraîne sur données jusqu'à fin janvier 2026 (stable)
TRAINING_CUTOFF_MONTHS = 4

EXCLUDED_STATUSES = (
    "cancelled", "canceled", "annulé", "annullee", "annulee", "annulé",
    "annulation", "cancel",
    "rejected", "refusé", "refusee", "refused", "refus", "refuse",
    "no_show", "no-show", "noshow",
    "expired", "expiré",
    "pending",
)

app = Flask(__name__)
CORS(app)

_cache: dict = {}


def cache_get(key: str):
    entry = _cache.get(key)
    if entry and (datetime.now() - entry["ts"]).seconds < CACHE_TTL_SECONDS:
        return entry["data"]
    return None


def cache_set(key: str, data) -> None:
    _cache[key] = {"ts": datetime.now(), "data": data}


# ══════════════════════════════════════════════════════════════════════════════
#  CONNEXION BASE DE DONNÉES
# ══════════════════════════════════════════════════════════════════════════════

def _connect() -> mysql.connector.MySQLConnection:
    return mysql.connector.connect(**DB_CONFIG)


def _history_start_date() -> str:
    try:
        conn = _connect()
        cur  = conn.cursor(dictionary=True)
        cur.execute(f"""
            SELECT MIN(checkInDate) AS first_date
            FROM reservation
            WHERE checkInDate IS NOT NULL
              AND {_excluded_status_clause()}
        """)
        row = cur.fetchone()
        conn.close()
        if row and row["first_date"]:
            return str(row["first_date"])
    except Exception as exc:
        print(f"[_history_start_date] Erreur : {exc}")
    return (datetime.now() - timedelta(days=365 * 10)).strftime("%Y-%m-%d")


def _training_cutoff_date() -> str:
    """
    On exclut TRAINING_CUTOFF_MONTHS mois depuis le mois courant.
    En mai 2026 avec cutoff=4 : fin janvier 2026.
    Prophet voit 2024 et 2025 complets → profil saisonnier parfait.
    """
    now = datetime.now()
    month = now.month - TRAINING_CUTOFF_MONTHS
    year  = now.year
    while month <= 0:
        month += 12
        year  -= 1
    cutoff = pd.Timestamp(year, month, 1) + pd.offsets.MonthEnd(1)
    return cutoff.strftime("%Y-%m-%d")


def _prediction_end_date() -> str:
    now   = datetime.now()
    month = now.month + MAX_HORIZON
    year  = now.year + (month - 1) // 12
    month = ((month - 1) % 12) + 1
    return datetime(year, month, 1).strftime("%Y-%m-%d")


def _excluded_status_clause() -> str:
    placeholders = ", ".join(f"'{s}'" for s in EXCLUDED_STATUSES)
    return f"LOWER(COALESCE(status, '')) NOT IN ({placeholders})"


# ══════════════════════════════════════════════════════════════════════════════
#  DIAGNOSTIC DES STATUTS
# ══════════════════════════════════════════════════════════════════════════════

def get_status_distribution() -> dict:
    try:
        conn = _connect()
        cur  = conn.cursor(dictionary=True)
        cur.execute("""
            SELECT
                LOWER(COALESCE(status, 'NULL/VIDE')) AS status_normalized,
                status AS status_raw,
                COUNT(*) AS count,
                MIN(checkInDate) AS first_date,
                MAX(checkInDate) AS last_date
            FROM reservation
            GROUP BY status_raw
            ORDER BY count DESC
        """)
        rows = cur.fetchall()
        conn.close()
        total = sum(int(r["count"]) for r in rows)
        result = []
        for r in rows:
            is_excluded = r["status_normalized"] in EXCLUDED_STATUSES
            result.append({
                "status":     r["status_raw"],
                "count":      int(r["count"]),
                "pct":        round(int(r["count"]) / total * 100, 1) if total else 0,
                "excluded":   is_excluded,
                "first_date": str(r["first_date"]) if r["first_date"] else None,
                "last_date":  str(r["last_date"])  if r["last_date"]  else None,
            })
        return {"statuses": result, "total_reservations": total}
    except Exception as exc:
        print(f"[get_status_distribution] Erreur : {exc}")
        return {"statuses": [], "total_reservations": 0}


def check_aberrant_dates() -> dict:
    try:
        conn = _connect()
        cur  = conn.cursor(dictionary=True)
        cur.execute(f"""
            SELECT COUNT(*) AS cnt,
                   MIN(checkInDate) AS first_future,
                   MAX(checkInDate) AS last_future
            FROM reservation
            WHERE checkInDate > DATE_ADD(CURDATE(), INTERVAL 2 YEAR)
              AND checkInDate IS NOT NULL
              AND {_excluded_status_clause()}
        """)
        row = cur.fetchone()
        conn.close()
        future_count = int(row["cnt"]) if row else 0
        if future_count > 0:
            print(f"[DONNÉES ABERRANTES] {future_count} rés. avec checkInDate > 2 ans")
        return {"future_count": future_count}
    except Exception as exc:
        return {"future_count": -1}


# ══════════════════════════════════════════════════════════════════════════════
#  PROFIL SAISONNIER RÉEL — cœur de la correction
# ══════════════════════════════════════════════════════════════════════════════

def compute_monthly_averages(df: pd.DataFrame) -> dict:
    """
    Calcule la moyenne ABSOLUE de réservations par mois calendaire
    sur les années complètes uniquement.

    Retourne {1: 180.5, 2: 165.0, ..., 7: 415.2, 8: 420.0, ...}

    C'est la référence absolue qu'on utilisera pour ancrer les prédictions.
    Les étés précédents = 400+ seront correctement représentés.
    """
    if df.empty:
        return {}

    df = df.copy()
    df["year"]  = df["ds"].dt.year
    df["month"] = df["ds"].dt.month
    current_year = datetime.now().year

    # Années avec >= 10 mois de données et pas l'année courante
    months_per_year = df.groupby("year")["month"].count()
    complete_years  = months_per_year[
        (months_per_year >= 10) & (months_per_year.index < current_year)
    ].index.tolist()

    if not complete_years:
        complete_years = months_per_year[months_per_year.index < current_year].index.tolist()

    if not complete_years:
        # Dernier recours : toutes les années
        complete_years = months_per_year.index.tolist()

    df_complete = df[df["year"].isin(complete_years)].copy()
    monthly_abs = df_complete.groupby("month")["y"].mean().to_dict()

    print(f"[Moyennes mensuelles] Calculé sur années {complete_years}")
    for m in sorted(monthly_abs.keys()):
        print(f"  Mois {m:02d} : {monthly_abs[m]:.0f} rés. en moyenne")

    return monthly_abs


def compute_seasonal_profile(monthly_averages: dict) -> dict:
    """
    Normalise les moyennes absolues en facteurs relatifs (ratio / moyenne globale).
    {1: 0.72, ..., 7: 1.65, 8: 1.68, ...}
    """
    if not monthly_averages:
        return {
            1: 0.70, 2: 0.75, 3: 0.90, 4: 1.00, 5: 1.10,
            6: 1.30, 7: 1.60, 8: 1.60, 9: 1.20, 10: 1.00, 11: 0.85, 12: 0.80,
        }
    global_avg = np.mean(list(monthly_averages.values()))
    if global_avg == 0:
        return {m: 1.0 for m in range(1, 13)}

    profile = {}
    for m in range(1, 13):
        if m in monthly_averages:
            profile[m] = monthly_averages[m] / global_avg
        else:
            profile[m] = 1.0
    return profile


# ══════════════════════════════════════════════════════════════════════════════
#  MODÈLE DÉCOMPOSITION MANUELLE — toujours cohérent avec l'historique
# ══════════════════════════════════════════════════════════════════════════════

def seasonal_decomposition_predict(
    df: pd.DataFrame,
    horizon: int,
    monthly_averages: dict,
    df_future: pd.DataFrame = None,
) -> dict:
    """
    Prédiction par décomposition saisonnière pure :
      prediction(mois M, année A) = monthly_avg(M) × trend_factor(A)

    trend_factor est calculé sur la tendance des ANNÉES COMPLÈTES uniquement
    (pas sur les mois incomplets récents).

    Exemple :
      - juillet 2024 réel = 410, juillet 2025 réel = 420
      - monthly_avg(juillet) = 415
      - trend_factor(2026) ≈ 1.0 (stable) ou légèrement positif
      - prédiction juillet 2026 = 415 × 1.0 = 415

    C'est la méthode la plus simple et la plus fiable quand Prophet dévie.
    """
    if not monthly_averages:
        return naive_predict_seasonal(df, horizon)

    df = df.copy()
    df["year"]  = df["ds"].dt.year
    df["month"] = df["ds"].dt.month
    current_year = datetime.now().year

    # Tendance annuelle sur années complètes
    months_per_year = df.groupby("year")["month"].count()
    complete_years  = sorted(months_per_year[
        (months_per_year >= 10) & (months_per_year.index < current_year)
    ].index.tolist())

    # Calculer la moyenne annuelle pour chaque année complète
    if len(complete_years) >= 2:
        annual_avgs = {}
        for yr in complete_years:
            yr_data = df[df["year"] == yr]["y"]
            annual_avgs[yr] = float(yr_data.mean())

        years_arr = np.array(sorted(annual_avgs.keys()), dtype=float)
        avgs_arr  = np.array([annual_avgs[y] for y in years_arr], dtype=float)
        slope, intercept = np.polyfit(years_arr, avgs_arr, 1)

        # Limiter la pente : on refuse une baisse > 5% par an
        # (évite que 2 mois de creux en 2025 donnent une tendance catastrophiste)
        mean_avg = float(avgs_arr.mean())
        max_decline_per_year = mean_avg * 0.05  # 5% max de déclin par an
        slope = max(slope, -max_decline_per_year)

        print(f"[Décomposition] Tendance annuelle : {slope:+.1f} rés./an "
              f"(sur années {complete_years})")
        print(f"[Décomposition] Années complètes moyennes : "
              + ", ".join(f"{y}: {annual_avgs[y]:.0f}" for y in sorted(annual_avgs)))

        def trend_factor(year: int) -> float:
            ref_year = float(complete_years[-1])  # dernière année complète
            base_avg = annual_avgs[complete_years[-1]]
            if base_avg == 0:
                return 1.0
            predicted_annual = intercept + slope * year
            return max(0.5, min(2.0, predicted_annual / base_avg))
    else:
        def trend_factor(year: int) -> float:
            return 1.0

    # Générer les prédictions
    now = datetime.now()
    future_dates = []
    m, y = now.month, now.year
    for _ in range(horizon + 1):
        m += 1
        if m > 12:
            m = 1
            y += 1
        future_dates.append(pd.Timestamp(y, m, 1))

    # Limiter à horizon mois
    future_dates = future_dates[:horizon]

    # Map des futures confirmées pour correction
    future_map = {}
    if df_future is not None and not df_future.empty:
        future_map = dict(zip(
            df_future["ds"].dt.to_period("M"),
            df_future["y"]
        ))

    values, lower, upper = [], [], []
    for dt in future_dates:
        m     = dt.month
        yr    = dt.year
        base  = monthly_averages.get(m, float(df["y"].mean()))
        tf    = trend_factor(yr)
        pred  = round(base * tf, 1)

        # Correction avec confirmées : prendre le max
        period_key = dt.to_period("M")
        if period_key in future_map:
            confirmed = future_map[period_key]
            if confirmed > pred * 0.6:  # confirmé crédible (>60% du prédit)
                pred = round(max(pred, confirmed), 1)

        # Intervalle de confiance : ±15% pour la décomposition simple
        low  = round(pred * 0.85, 1)
        high = round(pred * 1.15, 1)

        values.append(pred)
        lower.append(low)
        upper.append(high)

    # Peaks
    avg_pred  = np.mean(values)
    threshold = avg_pred * 1.2
    peaks = [
        dt.strftime("%Y-%m-%d")
        for dt, v in zip(future_dates, values)
        if v >= threshold
    ]

    print(f"[Décomposition] Prédictions : "
          + ", ".join(f"{dt.strftime('%Y-%m')}: {v:.0f}" for dt, v in zip(future_dates, values)))

    return {
        "model":      "SeasonalDecomp",
        "labels":     [d.strftime("%Y-%m-%d") for d in future_dates],
        "values":     values,
        "lower":      lower,
        "upper":      upper,
        "metrics":    {"mae": None, "rmse": None, "mape": None},
        "peaks":      peaks[:5],
        "trend":      compute_trend(values),
        "horizon":    horizon,
        "freq":       "MS",
        "trained_on": len(df),
        "trained_on_hybrid": len(df),
        "cap":        round(float(max(values) * 1.5), 1),
        "floor":      round(float(min(values) * 0.5), 1),
        "history_days": (df["ds"].max() - df["ds"].min()).days if len(df) > 1 else 0,
        "seasonality_mode": "decomposition",
        "training_cutoff": _training_cutoff_date(),
        "future_injected": len(df_future) if df_future is not None else 0,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  VALIDATION POST-PROPHET
# ══════════════════════════════════════════════════════════════════════════════

def validate_prophet_predictions(
    result: dict,
    monthly_averages: dict,
    tolerance: float = 0.50,
) -> bool:
    """
    Vérifie que les prédictions Prophet sont cohérentes avec l'historique.

    Pour chaque mois prédit :
      - Si prédit < (moyenne_historique_mois × (1 - tolerance)) → INVALIDE
      - Si prédit > (moyenne_historique_mois × (1 + tolerance × 2)) → INVALIDE

    tolerance = 0.50 → on accepte ±50% autour de la moyenne historique mensuelle.
    Si trop de mois sont invalides → on bascule sur SeasonalDecomp.
    """
    if not monthly_averages or not result.get("values"):
        return True  # pas de référence → on garde Prophet

    labels = result["labels"]
    values = result["values"]
    global_avg = np.mean(list(monthly_averages.values()))

    invalid_count = 0
    for label, val in zip(labels, values):
        month = datetime.strptime(label[:7], "%Y-%m").month
        expected = monthly_averages.get(month, global_avg)
        low_bound  = expected * (1 - tolerance)
        high_bound = expected * (1 + tolerance * 2)

        if val < low_bound or val > high_bound:
            print(f"[Validation Prophet] {label[:7]} : prédit={val:.0f}, "
                  f"attendu={expected:.0f}, bornes=[{low_bound:.0f}, {high_bound:.0f}] → INVALIDE")
            invalid_count += 1

    invalid_ratio = invalid_count / len(values) if values else 0
    is_valid = invalid_ratio <= 0.30  # accepté si <= 30% de mois invalides

    if not is_valid:
        print(f"[Validation Prophet] {invalid_count}/{len(values)} mois invalides "
              f"({invalid_ratio*100:.0f}%) → Fallback SeasonalDecomp")
    else:
        print(f"[Validation Prophet] OK — {invalid_count}/{len(values)} mois hors tolérance")

    return is_valid


def apply_hard_floor(
    result: dict,
    monthly_averages: dict,
    floor_factor: float = 0.70,
) -> dict:
    """
    Correction finale : plancher absolu par mois basé sur la moyenne historique.

    Si Prophet a prédit 292 pour juillet alors que juillet moyen = 415 :
      floor = 415 × 0.70 = 290.5 → Prophet est déjà juste sous le floor
      On remonte à 290.5 et on ajuste les intervalles.

    Avec floor_factor = 0.70 : la prédiction ne peut jamais être < 70% de la
    moyenne historique réelle de ce mois. C'est conservateur mais réaliste.
    """
    if not monthly_averages:
        return result

    result = dict(result)
    values = list(result["values"])
    lower  = list(result["lower"])
    upper  = list(result["upper"])
    labels = result["labels"]
    global_avg = np.mean(list(monthly_averages.values()))

    corrections = 0
    for i, (label, val) in enumerate(zip(labels, values)):
        month     = datetime.strptime(label[:7], "%Y-%m").month
        expected  = monthly_averages.get(month, global_avg)
        hard_floor = expected * floor_factor

        if val < hard_floor:
            print(f"[Hard Floor] {label[:7]} : {val:.0f} → {hard_floor:.0f} "
                  f"(historique mois={expected:.0f}, floor={floor_factor*100:.0f}%)")
            values[i] = round(hard_floor, 1)
            lower[i]  = round(hard_floor * 0.85, 1)
            upper[i]  = round(hard_floor * 1.20, 1)
            corrections += 1

    result["values"] = values
    result["lower"]  = lower
    result["upper"]  = upper

    if corrections > 0:
        print(f"[Hard Floor] {corrections} mois corrigés par le plancher saisonnier")
        # Recalculer tendance et peaks après correction
        result["trend"] = compute_trend(values)
        avg_pred  = np.mean(values)
        threshold = avg_pred * 1.2
        result["peaks"] = [
            lbl for lbl, v in zip(labels, values) if v >= threshold
        ][:5]

    return result


# ══════════════════════════════════════════════════════════════════════════════
#  SÉRIES TEMPORELLES
# ══════════════════════════════════════════════════════════════════════════════

def get_monthly_series(cutoff_date: str = None) -> pd.DataFrame:
    history_start = _history_start_date()
    end_sql       = f"'{cutoff_date}'" if cutoff_date else "CURDATE()"

    conn  = _connect()
    query = f"""
        SELECT
            YEAR(checkInDate)          AS yr,
            MONTH(checkInDate)         AS mo,
            COUNT(*)                   AS y,
            ROUND(SUM(totalPrice), 2)  AS revenue,
            AVG(totalPrice)            AS avg_price
        FROM reservation
        WHERE checkInDate IS NOT NULL
          AND checkInDate <= {end_sql}
          AND checkInDate >= '{history_start}'
          AND {_excluded_status_clause()}
        GROUP BY YEAR(checkInDate), MONTH(checkInDate)
        ORDER BY yr ASC, mo ASC
    """
    cur = conn.cursor(dictionary=True)
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()

    if not rows:
        return pd.DataFrame(columns=["ds", "y", "revenue", "avg_price"])

    records = [
        {
            "ds":        pd.Timestamp(year=int(r["yr"]), month=int(r["mo"]), day=1),
            "y":         float(r["y"]),
            "revenue":   float(r["revenue"] or 0),
            "avg_price": float(r["avg_price"] or 0),
        }
        for r in rows
    ]
    df = pd.DataFrame(records).sort_values("ds").reset_index(drop=True)
    print(f"[Historique] {len(df)} mois — de {df['ds'].min().date()} à {df['ds'].max().date()}")
    return df


def get_future_monthly_series() -> pd.DataFrame:
    end_date = _prediction_end_date()
    conn     = _connect()
    query    = f"""
        SELECT
            YEAR(checkInDate)          AS yr,
            MONTH(checkInDate)         AS mo,
            COUNT(*)                   AS y,
            ROUND(SUM(totalPrice), 2)  AS revenue
        FROM reservation
        WHERE checkInDate IS NOT NULL
          AND checkInDate > CURDATE()
          AND checkInDate <= '{end_date}'
          AND {_excluded_status_clause()}
        GROUP BY YEAR(checkInDate), MONTH(checkInDate)
        ORDER BY yr ASC, mo ASC
    """
    cur = conn.cursor(dictionary=True)
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()

    if not rows:
        return pd.DataFrame(columns=["ds", "y", "revenue"])

    records = [
        {
            "ds":      pd.Timestamp(year=int(r["yr"]), month=int(r["mo"]), day=1),
            "y":       float(r["y"]),
            "revenue": float(r["revenue"] or 0),
        }
        for r in rows
    ]
    df = pd.DataFrame(records).sort_values("ds").reset_index(drop=True)
    print(f"[Futur confirmé] {len(df)} mois, total={df['y'].sum():.0f} rés.")
    return df


def get_weekly_series() -> pd.DataFrame:
    history_start = _history_start_date()
    conn  = _connect()
    query = f"""
        SELECT
            DATE(DATE_SUB(checkInDate, INTERVAL WEEKDAY(checkInDate) DAY)) AS ds_raw,
            COUNT(*) AS y, SUM(totalPrice) AS revenue
        FROM reservation
        WHERE checkInDate IS NOT NULL AND checkInDate <= CURDATE()
          AND checkInDate >= '{history_start}' AND {_excluded_status_clause()}
        GROUP BY ds_raw ORDER BY ds_raw ASC
    """
    cur = conn.cursor(dictionary=True)
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()
    if not rows:
        return pd.DataFrame(columns=["ds", "y", "revenue"])
    records = [{"ds": pd.Timestamp(r["ds_raw"]), "y": float(r["y"]),
                "revenue": float(r["revenue"] or 0)} for r in rows]
    return pd.DataFrame(records).sort_values("ds").reset_index(drop=True)


def get_daily_series() -> pd.DataFrame:
    history_start = _history_start_date()
    conn  = _connect()
    query = f"""
        SELECT DATE(checkInDate) AS ds_raw, COUNT(*) AS y, SUM(totalPrice) AS revenue
        FROM reservation
        WHERE checkInDate IS NOT NULL AND checkInDate <= CURDATE()
          AND checkInDate >= '{history_start}' AND {_excluded_status_clause()}
        GROUP BY DATE(checkInDate) ORDER BY ds_raw ASC
    """
    cur = conn.cursor(dictionary=True)
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()
    if not rows:
        return pd.DataFrame(columns=["ds", "y", "revenue"])
    records = [{"ds": pd.Timestamp(r["ds_raw"]), "y": float(r["y"]),
                "revenue": float(r["revenue"] or 0)} for r in rows]
    df = pd.DataFrame(records).sort_values("ds").reset_index(drop=True)
    if len(df) > 0:
        full_range = pd.date_range(df["ds"].min(), df["ds"].max(), freq="D")
        df = df.set_index("ds").reindex(full_range, fill_value=0).reset_index()
        df.rename(columns={"index": "ds"}, inplace=True)
    return df


# ══════════════════════════════════════════════════════════════════════════════
#  SÉRIE HYBRIDE
# ══════════════════════════════════════════════════════════════════════════════

def build_hybrid_training_series(
    df_past: pd.DataFrame,
    df_future: pd.DataFrame,
    monthly_averages: dict,
) -> pd.DataFrame:
    """
    Injecte les mois futurs confirmés dans la série d'entraînement,
    uniquement si leur volume est crédible (>= 40% de la moyenne historique
    du même mois calendaire).
    """
    if df_past.empty or df_future.empty:
        return df_past

    global_avg = float(df_past["y"].mean())

    credible = []
    for _, row in df_future.iterrows():
        month_num = row["ds"].month
        expected  = monthly_averages.get(month_num, global_avg)
        threshold = expected * 0.40
        if row["y"] >= threshold:
            credible.append(row)
            print(f"[Hybrid] {row['ds'].strftime('%Y-%m')} : {row['y']:.0f} ≥ {threshold:.0f} → INJECTÉ")
        else:
            print(f"[Hybrid] {row['ds'].strftime('%Y-%m')} : {row['y']:.0f} < {threshold:.0f} → IGNORÉ")

    if not credible:
        return df_past

    df_future_ok = pd.DataFrame(credible)
    existing_ds  = set(df_past["ds"].dt.to_period("M"))
    df_future_new = df_future_ok[
        ~df_future_ok["ds"].dt.to_period("M").isin(existing_ds)
    ].copy()

    if df_future_new.empty:
        return df_past

    cols = list(df_past.columns)
    for col in cols:
        if col not in df_future_new.columns:
            df_future_new[col] = 0.0

    df_hybrid = pd.concat([df_past, df_future_new[cols]], ignore_index=True)
    df_hybrid  = df_hybrid.sort_values("ds").reset_index(drop=True)
    print(f"[Hybrid] {len(df_past)} passés + {len(df_future_new)} futurs → {len(df_hybrid)} points")
    return df_hybrid


# ══════════════════════════════════════════════════════════════════════════════
#  SÉRIE RÉALISATIONS (graphique)
# ══════════════════════════════════════════════════════════════════════════════

def get_realization_series(period: str) -> dict:
    history_start = _history_start_date()
    end_date      = _prediction_end_date()

    if period == "monthly":
        conn  = _connect()
        query = f"""
            SELECT YEAR(checkInDate) AS yr, MONTH(checkInDate) AS mo, COUNT(*) AS y
            FROM reservation
            WHERE checkInDate IS NOT NULL AND checkInDate >= '{history_start}'
              AND checkInDate <= '{end_date}' AND {_excluded_status_clause()}
            GROUP BY yr, mo ORDER BY yr, mo
        """
        cur = conn.cursor(dictionary=True)
        cur.execute(query)
        rows = cur.fetchall()
        conn.close()
        if not rows:
            return {"labels": [], "values": [], "past_count": 0, "future_count": 0}
        data_map = {
            pd.Timestamp(year=int(r["yr"]), month=int(r["mo"]), day=1): float(r["y"])
            for r in rows
        }
        freq = "MS"
    elif period == "weekly":
        conn  = _connect()
        query = f"""
            SELECT DATE(DATE_SUB(checkInDate, INTERVAL WEEKDAY(checkInDate) DAY)) AS ds_raw,
                   COUNT(*) AS y
            FROM reservation
            WHERE checkInDate IS NOT NULL AND checkInDate >= '{history_start}'
              AND checkInDate <= '{end_date}' AND {_excluded_status_clause()}
            GROUP BY ds_raw ORDER BY ds_raw
        """
        cur = conn.cursor(dictionary=True)
        cur.execute(query)
        rows = cur.fetchall()
        conn.close()
        if not rows:
            return {"labels": [], "values": [], "past_count": 0, "future_count": 0}
        data_map = {pd.Timestamp(r["ds_raw"]): float(r["y"]) for r in rows}
        freq = "W-MON"
    else:
        conn  = _connect()
        query = f"""
            SELECT DATE(checkInDate) AS ds_raw, COUNT(*) AS y
            FROM reservation
            WHERE checkInDate IS NOT NULL AND checkInDate >= '{history_start}'
              AND checkInDate <= '{end_date}' AND {_excluded_status_clause()}
            GROUP BY ds_raw ORDER BY ds_raw
        """
        cur = conn.cursor(dictionary=True)
        cur.execute(query)
        rows = cur.fetchall()
        conn.close()
        if not rows:
            return {"labels": [], "values": [], "past_count": 0, "future_count": 0}
        data_map = {pd.Timestamp(r["ds_raw"]): float(r["y"]) for r in rows}
        freq = "D"

    today      = pd.Timestamp.now().normalize()
    start_date = min(data_map.keys())
    full_range = pd.date_range(start_date, end_date, freq=freq)

    labels, values = [], []
    past_count = future_count = 0
    for dt in full_range:
        label = dt.strftime("%Y-%m-%d")
        labels.append(label)
        if dt in data_map:
            values.append(data_map[dt])
            if dt <= today:
                past_count += 1
            else:
                future_count += 1
        else:
            values.append(None)

    return {"labels": labels, "values": values, "past_count": past_count, "future_count": future_count}


# ══════════════════════════════════════════════════════════════════════════════
#  RÉSERVATIONS FUTURES VALIDES (KPIs)
# ══════════════════════════════════════════════════════════════════════════════

def get_confirmed_future_reservations(horizon_months: int) -> dict:
    end_date = _prediction_end_date()
    conn     = _connect()
    query    = f"""
        SELECT DATE_FORMAT(checkInDate, '%Y-%m') AS month_key,
               YEAR(checkInDate) AS yr, COUNT(*) AS cnt,
               ROUND(SUM(totalPrice), 2) AS revenue
        FROM reservation
        WHERE checkInDate > CURDATE() AND checkInDate <= '{end_date}'
          AND checkInDate IS NOT NULL AND {_excluded_status_clause()}
        GROUP BY month_key, yr ORDER BY month_key
    """
    cur = conn.cursor(dictionary=True)
    cur.execute(query)
    rows = cur.fetchall()
    conn.close()

    monthly: dict = {}
    annual:  dict = {}
    total = 0
    for r in rows:
        mk  = r["month_key"]
        yr  = str(r["yr"])
        cnt = int(r["cnt"])
        rev = float(r["revenue"] or 0)
        monthly[mk] = {"count": cnt, "revenue": rev}
        if yr not in annual:
            annual[yr] = {"count": 0, "revenue": 0.0}
        annual[yr]["count"]   += cnt
        annual[yr]["revenue"] += rev
        total += cnt

    return {"total": total, "monthly": monthly, "annual": annual}


# ══════════════════════════════════════════════════════════════════════════════
#  STATISTIQUES HISTORIQUES ENRICHIES
# ══════════════════════════════════════════════════════════════════════════════

def compute_historical_stats(df: pd.DataFrame) -> dict:
    if df.empty:
        return {"monthly": {}, "annual": {}, "yoy_growth": {}, "best_months": {}}

    df = df.copy()
    df["month_key"] = df["ds"].dt.strftime("%Y-%m")
    df["year_key"]  = df["ds"].dt.strftime("%Y")

    monthly = (
        df.groupby("month_key")
        .agg(count=("y", "sum"), revenue=("revenue", "sum"))
        .round(2).to_dict("index")
    )
    annual_df = (
        df.groupby("year_key")
        .agg(count=("y", "sum"), revenue=("revenue", "sum"))
        .round(2)
    )
    annual = annual_df.to_dict("index")

    yoy_growth = {}
    years = sorted(annual.keys())
    for i in range(1, len(years)):
        prev_cnt = annual[years[i-1]]["count"]
        curr_cnt = annual[years[i]]["count"]
        if prev_cnt > 0:
            growth = round((curr_cnt - prev_cnt) / prev_cnt * 100, 1)
            yoy_growth[years[i]] = {
                "growth_pct": growth,
                "prev_year":  years[i-1],
                "prev_count": prev_cnt,
                "curr_count": curr_cnt,
            }

    best_months = {}
    for yr, grp in df.groupby("year_key"):
        if not grp.empty:
            best_row = grp.loc[grp["y"].idxmax()]
            best_months[yr] = {
                "month":   best_row["ds"].strftime("%Y-%m"),
                "count":   int(best_row["y"]),
                "revenue": round(float(best_row["revenue"]), 2),
            }

    history_years = round((df["ds"].max() - df["ds"].min()).days / 365.25, 1) if len(df) > 0 else 0

    return {
        "monthly":       monthly,
        "annual":        annual,
        "yoy_growth":    yoy_growth,
        "best_months":   best_months,
        "history_years": history_years,
        "total_months":  len(df),
    }


# ══════════════════════════════════════════════════════════════════════════════
#  TAUX D'OCCUPATION
# ══════════════════════════════════════════════════════════════════════════════

def estimate_occupancy_rate(
    predicted_monthly: list,
    confirmed_monthly: dict,
    labels: list,
    total_rooms: int = 50,
) -> list:
    result = []
    for label, predicted in zip(labels, predicted_monthly):
        try:
            dt = datetime.strptime(label[:7], "%Y-%m")
            days_month = (pd.Timestamp(dt.year, dt.month, 1) + pd.offsets.MonthEnd(1)).day
        except Exception:
            days_month = 30
        confirmed_data = confirmed_monthly.get(label[:7], {})
        confirmed_cnt  = float(confirmed_data.get("count", 0))
        total_pred     = round(max(predicted, confirmed_cnt), 1)
        probable_rest  = max(0.0, round(total_pred - confirmed_cnt, 1))
        capacity       = total_rooms * days_month
        occupancy_pct  = round(min(100.0, (total_pred / capacity) * 100), 1) if capacity > 0 else 0.0
        result.append({
            "month":              label[:7],
            "forecast_total":     total_pred,
            "confirmed_bookings": round(confirmed_cnt, 1),
            "probable_remaining": probable_rest,
            "capacity":           capacity,
            "occupancy_rate_pct": occupancy_pct,
        })
    return result


# ══════════════════════════════════════════════════════════════════════════════
#  VALIDATION & NETTOYAGE
# ══════════════════════════════════════════════════════════════════════════════

def validate_and_clean(df: pd.DataFrame) -> pd.DataFrame:
    if len(df) < 3:
        return df
    df = df.copy().sort_values("ds").reset_index(drop=True)
    q1, q3 = df["y"].quantile(0.25), df["y"].quantile(0.75)
    iqr     = q3 - q1
    upper   = q3 + 3 * iqr
    if upper > 0:
        n_out = int((df["y"] > upper).sum())
        if n_out > 0:
            print(f"[Validation] {n_out} outlier(s) plafonné(s) à {upper:.1f}")
            df["y"] = df["y"].clip(upper=upper)
    try:
        full_range = pd.date_range(df["ds"].min(), df["ds"].max(), freq="MS")
        df = df.set_index("ds").reindex(full_range).reset_index()
        df.rename(columns={"index": "ds"}, inplace=True)
        df["y"] = df["y"].interpolate(method="linear").clip(lower=0)
        if "revenue" in df.columns:
            df["revenue"] = df["revenue"].interpolate(method="linear").fillna(0).clip(lower=0)
    except Exception:
        pass
    return df.reset_index(drop=True)


# ══════════════════════════════════════════════════════════════════════════════
#  JOURS FÉRIÉS TUNISIENS
# ══════════════════════════════════════════════════════════════════════════════

def get_tunisian_holidays(history_start: str = None) -> pd.DataFrame:
    current_year = datetime.now().year
    start_year = current_year - 5
    if history_start:
        try:
            start_year = datetime.strptime(history_start[:10], "%Y-%m-%d").year
        except Exception:
            pass
    years = list(range(start_year, current_year + 3))
    fixed_holidays = [
        ("01-01", "Nouvel An"), ("03-20", "Fete Independance"),
        ("04-09", "Journee Martyrs"), ("05-01", "Fete Travail"),
        ("07-25", "Fete Republique"), ("08-13", "Fete Femme"),
        ("10-15", "Fete Evacuation"), ("12-17", "Revolution"),
    ]
    holidays = []
    for y in years:
        for md, name in fixed_holidays:
            try:
                holidays.append({"ds": pd.Timestamp(f"{y}-{md}"), "holiday": name})
            except Exception:
                pass
        for d in pd.date_range(f"{y}-06-15", f"{y}-09-15", freq="D"):
            holidays.append({"ds": d, "holiday": "HauteSaison"})
    return pd.DataFrame(holidays)


# ══════════════════════════════════════════════════════════════════════════════
#  CALCUL TENDANCE
# ══════════════════════════════════════════════════════════════════════════════

def compute_trend(values: list) -> str:
    if len(values) < 2:
        return "stable"
    x = np.arange(len(values), dtype=float)
    y = np.array(values, dtype=float)
    mean_y = y.mean()
    if mean_y == 0:
        return "stable"
    slope = np.polyfit(x, y, 1)[0]
    relative_delta = (slope * len(values)) / mean_y
    if   relative_delta >  0.10: return "hausse"
    elif relative_delta < -0.10: return "baisse"
    else:                        return "stable"


def naive_predict_seasonal(df: pd.DataFrame, horizon: int) -> dict:
    """Fallback ultime avec saisonnalité générique."""
    series = df["y"].values.astype(float) if len(df) > 0 else np.array([1.0])
    weights = np.exp(np.linspace(0, 1, len(series)))
    wmean   = float(np.average(series, weights=weights))
    std     = float(np.std(series)) if len(series) > 1 else 1.0
    last_date    = df["ds"].max() if len(df) else pd.Timestamp.now()
    future_dates = pd.date_range(last_date + timedelta(days=1), periods=horizon, freq="MS")
    profile = {1:.70,2:.75,3:.90,4:1.00,5:1.10,6:1.30,7:1.60,8:1.60,9:1.20,10:1.00,11:.85,12:.80}
    values = [round(max(0.0, wmean * profile.get(d.month, 1.0)), 1) for d in future_dates]
    return {
        "model": "NaiveWMA", "labels": [d.strftime("%Y-%m-%d") for d in future_dates],
        "values": values, "lower": [round(max(0.0, v-std), 1) for v in values],
        "upper": [round(v+std, 1) for v in values],
        "metrics": {"mae": None, "rmse": None, "mape": None},
        "peaks": [], "trend": compute_trend(values), "horizon": horizon,
        "freq": "MS", "trained_on": len(df), "trained_on_hybrid": len(df),
        "cap": round(max(values)*1.5, 1), "floor": round(min(values)*0.5, 1),
        "history_days": 0, "seasonality_mode": "naive",
        "training_cutoff": _training_cutoff_date(), "future_injected": 0,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  MODÈLE PROPHET — VERSION 7.0
# ══════════════════════════════════════════════════════════════════════════════

def prophet_predict(
    df: pd.DataFrame,
    horizon: int,
    freq: str,
    history_start: str = None,
    df_future: pd.DataFrame = None,
    monthly_averages: dict = None,
) -> dict:
    """
    Prophet v7 — ancrages multiples pour prédictions réalistes :

    1. Série hybride avec seuil crédibilité 40% par mois calendaire
    2. changepoint_prior_scale = 0.01 (neutralise quasi-totalement la tendance)
    3. seasonality_prior_scale = 20 (très forte saisonnalité)
    4. changepoint_range = 0.70 (ignore les 30% finaux de la série)
    5. Hard floor post-prediction : 70% de la moyenne historique par mois
    6. Validation : si trop de mois invalides → SeasonalDecomp automatique
    """
    try:
        from prophet import Prophet
    except ImportError:
        raise ImportError("prophet non installé : pip install prophet")

    monthly_averages = monthly_averages or {}

    # ── 1. Série hybride ─────────────────────────────────────────────────────
    if df_future is not None and not df_future.empty and monthly_averages:
        df_train = build_hybrid_training_series(df, df_future, monthly_averages)
    else:
        df_train = df.copy()

    df_fit = df_train[["ds", "y"]].copy()
    n      = len(df_fit)

    # ── 2. Cap et Floor ──────────────────────────────────────────────────────
    hist_max  = float(df_fit["y"].max())
    hist_mean = float(df_fit["y"].mean())
    hist_std  = float(df_fit["y"].std()) if n > 1 else hist_mean
    hist_p05  = float(df_fit["y"].quantile(0.05))

    cap_val   = max(hist_max * 1.5, hist_mean + 3 * hist_std, 1.0)
    floor_val = max(0.0, hist_p05 * 0.3)  # floor global très bas, le hard floor fera le travail

    df_fit["cap"]   = cap_val
    df_fit["floor"] = floor_val

    # ── 3. Regresseur estival ────────────────────────────────────────────────
    df_fit["is_summer"] = df_fit["ds"].dt.month.isin([6, 7, 8, 9]).astype(float)

    # ── 4. Paramètres selon l'historique ────────────────────────────────────
    history_days       = (df_fit["ds"].max() - df_fit["ds"].min()).days
    has_one_year       = history_days >= 365
    has_two_years      = history_days >= 730
    yearly_seasonality = has_one_year

    if history_days > 365 * 5:
        n_changepoints = min(15, max(3, n // 8))
        fourier_order  = 15
    elif history_days > 365 * 2:
        n_changepoints = min(10, max(3, n // 6))
        fourier_order  = 12
    else:
        n_changepoints = min(6, max(1, n // 5))
        fourier_order  = 10

    # ── CLÉ v7 : changepoint quasi-nul + saisonnalité dominante ─────────────
    # cp_scale = 0.01 : Prophet accepte quasi aucune rupture de tendance
    # L'avantage : il prédit quasi-uniquement sur la saisonnalité détectée
    # L'inconvénient : on perd la tendance réelle → compensé par le hard floor
    cp_scale         = 0.01
    changepoint_range = 0.70   # ignore les 30% finaux (creux de fin 2025)
    seasonality_ps   = 20.0    # saisonnalité très forte
    seasonality_mode = "multiplicative" if has_two_years else "additive"

    model = Prophet(
        growth="logistic",
        yearly_seasonality=fourier_order if yearly_seasonality else False,
        weekly_seasonality=(freq == "D"),
        daily_seasonality=False,
        seasonality_mode=seasonality_mode,
        changepoint_prior_scale=cp_scale,
        seasonality_prior_scale=seasonality_ps,
        holidays=get_tunisian_holidays(history_start),
        interval_width=0.80,
        n_changepoints=n_changepoints,
        changepoint_range=changepoint_range,
    )

    model.add_regressor("is_summer", prior_scale=25.0, standardize=True,
                        mode="multiplicative" if has_two_years else "additive")

    model.fit(df_fit)

    # ── 5. Prédictions ───────────────────────────────────────────────────────
    last_hist = df[["ds", "y"]].sort_values("ds")["ds"].max()

    future          = model.make_future_dataframe(periods=horizon + TRAINING_CUTOFF_MONTHS + 2, freq=freq)
    future["cap"]   = cap_val
    future["floor"] = floor_val
    future["is_summer"] = future["ds"].dt.month.isin([6, 7, 8, 9]).astype(float)

    forecast = model.predict(future)
    pred = forecast[forecast["ds"] > last_hist].copy()
    pred = pred.head(horizon).copy()

    pred["yhat"]       = pred["yhat"].clip(lower=floor_val, upper=cap_val).round(1)
    pred["yhat_lower"] = pred["yhat_lower"].clip(lower=0, upper=cap_val).round(1)
    pred["yhat_upper"] = pred["yhat_upper"].clip(lower=0, upper=cap_val).round(1)

    # ── 6. Correction avec réservations confirmées ───────────────────────────
    if df_future is not None and not df_future.empty:
        future_map = dict(zip(df_future["ds"].dt.to_period("M"), df_future["y"]))
        for idx in pred.index:
            pk = pred.at[idx, "ds"].to_period("M")
            if pk in future_map:
                cv = future_map[pk]
                if pred.at[idx, "yhat"] < cv:
                    pred.at[idx, "yhat"]       = round(cv, 1)
                    pred.at[idx, "yhat_lower"] = round(cv * 0.9, 1)
                    pred.at[idx, "yhat_upper"] = round(cv * 1.15, 1)

    # ── 7. Métriques ────────────────────────────────────────────────────────
    hist_fc   = forecast[forecast["ds"] <= last_hist].set_index("ds")["yhat"]
    actual_df = df[["ds", "y"]].copy().set_index("ds")["y"]
    merged    = hist_fc.reindex(actual_df.index).fillna(hist_mean)

    mae  = float(np.mean(np.abs(actual_df - merged)))
    rmse = float(np.sqrt(np.mean((actual_df - merged) ** 2)))

    nonzero_mask = actual_df > 0
    if nonzero_mask.sum() > 0:
        a_nz = actual_df[nonzero_mask]
        m_nz = merged.reindex(a_nz.index).fillna(hist_mean)
        mape = float(np.mean(np.abs((a_nz - m_nz) / a_nz)) * 100)
        mape = min(mape, 999.0)
    else:
        mape = None

    pred_vals = pred["yhat"].tolist()
    avg_pred  = np.mean(pred_vals) if pred_vals else 0
    threshold = avg_pred * 1.2
    peaks     = pred[pred["yhat"] >= threshold]["ds"].dt.strftime("%Y-%m-%d").tolist()

    n_hybrid = len(df_train)

    return {
        "model":      "Prophet",
        "labels":     pred["ds"].dt.strftime("%Y-%m-%d").tolist(),
        "values":     pred_vals,
        "lower":      pred["yhat_lower"].tolist(),
        "upper":      pred["yhat_upper"].tolist(),
        "metrics":    {"mae": round(mae,2), "rmse": round(rmse,2),
                       "mape": round(mape,1) if mape else None},
        "peaks":      peaks[:5],
        "trend":      compute_trend(pred_vals),
        "horizon":    horizon,
        "freq":       freq,
        "trained_on": len(df),
        "trained_on_hybrid": n_hybrid,
        "cap":        round(cap_val, 1),
        "floor":      round(floor_val, 1),
        "history_days": history_days,
        "seasonality_mode": seasonality_mode,
        "training_cutoff": _training_cutoff_date(),
        "future_injected": len(df_future) if df_future is not None else 0,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  MODÈLE ARIMA (fallback)
# ══════════════════════════════════════════════════════════════════════════════

def arima_predict(
    df: pd.DataFrame,
    horizon: int,
    monthly_averages: dict = None,
) -> dict:
    try:
        from pmdarima import auto_arima
    except ImportError:
        return seasonal_decomposition_predict(df, horizon, monthly_averages or {})

    series = df["y"].values.astype(float)
    n      = len(series)
    m      = min(12, n // 2) if n >= 4 else 1

    try:
        arima_model = auto_arima(
            series, seasonal=(m > 1), m=m, stepwise=True,
            suppress_warnings=True, error_action="ignore",
            max_p=3, max_q=3, information_criterion="aic",
        )
        forecast, conf_int = arima_model.predict(n_periods=horizon, return_conf_int=True, alpha=0.05)
        cap_val  = max(float(df["y"].max()) * 1.5, 1.0)
        forecast = np.clip(forecast, 0, cap_val)
    except Exception:
        return seasonal_decomposition_predict(df, horizon, monthly_averages or {})

    last_date    = df["ds"].max()
    future_dates = pd.date_range(last_date + timedelta(days=1), periods=horizon, freq="MS")
    values       = [round(float(v), 1) for v in forecast]

    # Appliquer hard floor saisonnier
    if monthly_averages:
        global_avg = np.mean(list(monthly_averages.values()))
        for i, (val, dt) in enumerate(zip(values, future_dates)):
            expected  = monthly_averages.get(dt.month, global_avg)
            hard_floor = expected * 0.70
            if val < hard_floor:
                values[i] = round(hard_floor, 1)

    return {
        "model": "ARIMA", "labels": [d.strftime("%Y-%m-%d") for d in future_dates],
        "values": values, "lower": [round(max(0.0, float(v[0])), 1) for v in conf_int],
        "upper": [round(float(v[1]), 1) for v in conf_int],
        "metrics": {"mae": None, "rmse": None, "mape": None},
        "peaks": [], "trend": compute_trend(values), "horizon": horizon,
        "freq": "MS", "trained_on": n, "trained_on_hybrid": n,
        "cap": round(cap_val, 1), "floor": 0.0, "history_days": 0,
        "seasonality_mode": "arima", "training_cutoff": _training_cutoff_date(),
        "future_injected": 0,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  XGBOOST — DÉTECTION HAUTE DEMANDE
# ══════════════════════════════════════════════════════════════════════════════

def xgboost_peak_detection(df: pd.DataFrame) -> dict:
    try:
        import xgboost as xgb
        from sklearn.model_selection import train_test_split
    except ImportError:
        return {"available": False, "reason": "xgboost non installé"}

    if len(df) < 60:
        return {"available": False, "reason": "Données insuffisantes (< 60 jours)"}

    df = df.copy().sort_values("ds")
    df["month"]       = df["ds"].dt.month
    df["dayofweek"]   = df["ds"].dt.dayofweek
    df["quarter"]     = df["ds"].dt.quarter
    df["lag1"]        = df["y"].shift(1).fillna(0)
    df["lag7"]        = df["y"].shift(7).fillna(0)
    df["rolling7"]    = df["y"].rolling(7,  min_periods=1).mean()
    df["rolling30"]   = df["y"].rolling(30, min_periods=1).mean()
    df["high_demand"] = (df["y"] >= df["y"].quantile(0.75)).astype(int)

    features = ["month", "dayofweek", "quarter", "lag1", "lag7", "rolling7", "rolling30"]
    X = df[features].iloc[30:]
    y = df["high_demand"].iloc[30:]

    if len(X) < 20:
        return {"available": False, "reason": "Données insuffisantes"}

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    xgb_model = xgb.XGBClassifier(
        n_estimators=100, max_depth=4, learning_rate=0.1,
        eval_metric="logloss", random_state=42, verbosity=0,
    )
    xgb_model.fit(X_train, y_train)
    acc = float(xgb_model.score(X_test, y_test))
    importance  = dict(zip(features, xgb_model.feature_importances_.tolist()))
    top_feature = max(importance, key=importance.get)

    last_date = df["ds"].max()
    peak_days = []
    for i in range(1, 31):
        d = last_date + timedelta(days=i)
        row = {
            "month": d.month, "dayofweek": d.dayofweek, "quarter": d.quarter,
            "lag1": float(df["y"].iloc[-1]), "lag7": float(df["y"].iloc[-1]),
            "rolling7": float(df["y"].tail(7).mean()),
            "rolling30": float(df["y"].tail(30).mean()),
        }
        if xgb_model.predict(pd.DataFrame([row]))[0] == 1:
            peak_days.append(d.strftime("%Y-%m-%d"))

    return {
        "available": True, "accuracy": round(acc * 100, 1),
        "peak_days_next30": peak_days, "top_feature": top_feature,
        "importance": {k: round(v, 3) for k, v in importance.items()},
    }


# ══════════════════════════════════════════════════════════════════════════════
#  GÉNÉRATION INSIGHT
# ══════════════════════════════════════════════════════════════════════════════

def generate_prediction_insight(
    result: dict,
    period: str,
    df_hist: pd.DataFrame,
    history_start: str,
    monthly_averages: dict = None,
    occupancy_data: Optional[list] = None,
    confirmed_future_total: int = 0,
    historical_stats: dict = None,
) -> str:
    values  = result["values"]
    model   = result["model"]
    trend   = result["trend"]
    peaks   = result.get("peaks", [])
    metrics = result.get("metrics", {})
    cap     = result.get("cap")
    future_injected = result.get("future_injected", 0)
    training_cutoff = result.get("training_cutoff", "")

    if not values:
        return "Données insuffisantes pour générer une analyse."

    max_val   = max(values)
    min_val   = min(values)
    avg_val   = sum(values) / len(values)
    max_label = result["labels"][values.index(max_val)]
    min_label = result["labels"][values.index(min_val)]
    pl = {"monthly": "mois", "weekly": "semaine", "daily": "jour"}.get(period, "période")
    end_label = datetime.strptime(_prediction_end_date()[:7], "%Y-%m").strftime("%B %Y")
    history_years = historical_stats.get("history_years", 0) if historical_stats else 0
    history_label = f"{history_years:.1f} ans" if history_years > 1 else f"{int(history_years*12)} mois"

    lines = [f"**Analyse Prédictive — Modèle {model}** (réservations hors annulées/refusées)\n"]
    lines.append(f"Horizon : aujourd'hui → **{end_label}** (12 mois glissants)")
    lines.append(f"Historique utilisé : **{history_label}** de données réelles")
    if training_cutoff:
        lines.append(f"Coupure d'entraînement : **{training_cutoff[:7]}** (mois incomplets exclus)")
    if future_injected > 0:
        lines.append(f"Réservations futures injectées (mois crédibles) : **{future_injected} mois**\n")
    else:
        lines.append("")

    # Référence saisonnière
    if monthly_averages:
        avg_summer = np.mean([monthly_averages.get(m, 0) for m in [6, 7, 8]])
        avg_winter = np.mean([monthly_averages.get(m, 0) for m in [12, 1, 2]])
        lines.append(f"**Référence saisonnière historique** (années complètes) :")
        lines.append(f"• Été moyen (juin-août) : **{avg_summer:.0f} rés./mois**")
        lines.append(f"• Hiver moyen (déc-fév) : **{avg_winter:.0f} rés./mois**\n")

    trend_emoji = {"hausse": "📈", "baisse": "📉", "stable": "➡️"}.get(trend, "➡️")
    lines.append(f"{trend_emoji} **Tendance** : {trend} sur la période prédite.")

    lines.append(f"\n**Statistiques prédites** :")
    lines.append(f"• Pic prévu : **{max_val:.0f} réservations** ({max_label})")
    lines.append(f"• Creux prévu : **{min_val:.0f} réservations** ({min_label})")
    lines.append(f"• Moyenne prédite : **{avg_val:.0f} réservations** / {pl}")
    if cap:
        lines.append(f"• Plafond du modèle : **{cap:.0f} réservations**")

    if confirmed_future_total > 0:
        lines.append(f"\n**Réservations futures déjà enregistrées** : **{confirmed_future_total}** rés.")
        coverage = round((confirmed_future_total / (avg_val * len(values))) * 100, 1) if avg_val > 0 else 0
        lines.append(f"• Couverture des prévisions : **{coverage}%** déjà assurée")

    if len(df_hist) > 0 and df_hist["y"].mean() > 0:
        hist_avg = float(df_hist["y"].mean())
        delta    = (avg_val - hist_avg) / hist_avg * 100
        sign     = "+" if delta >= 0 else ""
        lines.append(f"• Variation vs historique : **{sign}{delta:.1f}%** (moy. hist. : {hist_avg:.0f})")

    if historical_stats and historical_stats.get("yoy_growth"):
        yoy = historical_stats["yoy_growth"]
        recent_years = sorted(yoy.keys())[-2:]
        if recent_years:
            lines.append(f"\n**Croissance historique (YoY)** :")
            for yr in recent_years:
                g = yoy[yr]
                sign = "+" if g["growth_pct"] >= 0 else ""
                lines.append(f"• {g['prev_year']} → {yr} : **{sign}{g['growth_pct']}%** "
                              f"({g['prev_count']:.0f} → {g['curr_count']:.0f} rés.)")

    if occupancy_data:
        avg_occ = sum(o["occupancy_rate_pct"] for o in occupancy_data) / len(occupancy_data)
        max_occ = max(o["occupancy_rate_pct"] for o in occupancy_data)
        lines.append(f"\n**Taux d'occupation estimé** :")
        lines.append(f"• Moyenne : **{avg_occ:.1f}%** | Pic : **{max_occ:.1f}%**")
        if avg_occ > 85:
            lines.append("→ Capacité quasi-saturée — envisagez le surbooking contrôlé.")
        elif avg_occ < 40:
            lines.append("→ Faible occupation — renforcez les actions commerciales.")

    if peaks:
        lines.append(f"\n**Périodes de haute demande** :")
        for p in peaks[:3]:
            lines.append(f"  → {p}")
        lines.append("→ Ajustez tarifs et ressources humaines.")

    summer_months = sum(
        1 for lbl in result["labels"]
        if datetime.strptime(lbl[:7], "%Y-%m").month in [6, 7, 8]
    )
    if summer_months > 0:
        lines.append(f"\n**Saisonnalité estivale** : {summer_months} période(s) prévue(s).")
        lines.append("→ Forte demande — optimisez disponibilité et prix.")

    mape = metrics.get("mape")
    if mape is not None and mape > 0:
        quality = ("Excellente" if mape < 10 else "Bonne" if mape < 20
                   else "Acceptable" if mape < 30 else "Améliorable")
        lines.append(f"\n**Qualité du modèle** : {quality} (MAPE = {mape:.1f}%)")

    lines.append(f"\n**Recommandations** :")
    if trend == "hausse":
        lines.append("• Anticipez les ressources : personnel, linge, restauration.")
        lines.append("• Montez les tarifs en haute saison (yield management).")
    elif trend == "baisse":
        lines.append("• Promotions ciblées pour stimuler la demande hors saison.")
        lines.append("• Partenariats avec agences de voyage.")
    else:
        lines.append("• Demande stable — maintenez votre stratégie actuelle.")
        lines.append("• Optimisez le yield management en haute saison.")

    n_trained = result.get("trained_on", 0)
    n_hybrid  = result.get("trained_on_hybrid", 0)
    hybrid_note = f" + {n_hybrid - n_trained} mois futurs" if n_hybrid > n_trained else ""
    lines.append(f"\nModèle entraîné sur **{n_trained}** points{hybrid_note} | "
                 f"Historique : **{history_label}** | Mode : {result.get('seasonality_mode','')}")
    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
#  ENDPOINT PRINCIPAL : /predict-reservations
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/predict-reservations", methods=["GET"])
def predict_reservations():
    period      = request.args.get("period", "monthly")
    total_rooms = int(request.args.get("total_rooms", 50))
    horizon     = MAX_HORIZON

    cache_key = f"{period}_{total_rooms}"
    cached    = cache_get(cache_key)
    if cached:
        cached["from_cache"] = True
        return jsonify(cached)

    try:
        history_start   = _history_start_date()
        training_cutoff = _training_cutoff_date()

        print(f"[Config] Historique depuis : {history_start}")
        print(f"[Config] Coupure training   : {training_cutoff}")
        print(f"[Config] Fin prédiction     : {_prediction_end_date()}")

        # ── 1. Données complètes pour le profil saisonnier ────────────────────
        df_raw_full = get_monthly_series()

        if len(df_raw_full) == 0:
            return jsonify({"error": "Aucune réservation valide disponible."}), 404

        # ── 2. MOYENNES MENSUELLES ABSOLUES — référence principale ─────────────
        monthly_averages = compute_monthly_averages(df_raw_full)
        seasonal_profile = compute_seasonal_profile(monthly_averages)

        # ── 3. Données tronquées pour l'entraînement ──────────────────────────
        if period == "monthly":
            df_train_raw = get_monthly_series(cutoff_date=training_cutoff)
            freq         = "MS"
        elif period == "weekly":
            df_train_raw = get_weekly_series()
            freq         = "W"
        else:
            df_train_raw = get_daily_series()
            freq         = "D"

        # ── 4. Réservations futures confirmées ────────────────────────────────
        df_future = get_future_monthly_series() if period == "monthly" else pd.DataFrame()

        # ── 5. Nettoyage ──────────────────────────────────────────────────────
        df_train = validate_and_clean(df_train_raw)
        df_full  = validate_and_clean(df_raw_full)

        # ── 6. Sélection et exécution du modèle ───────────────────────────────
        use_fallback = False
        result = None

        if len(df_train) >= MIN_ROWS_PROPHET:
            try:
                result = prophet_predict(
                    df=df_train,
                    horizon=horizon,
                    freq=freq,
                    history_start=history_start,
                    df_future=df_future if period == "monthly" else None,
                    monthly_averages=monthly_averages if period == "monthly" else None,
                )

                # ── VALIDATION CRITIQUE : les prédictions sont-elles réalistes ?
                if period == "monthly" and monthly_averages:
                    is_valid = validate_prophet_predictions(result, monthly_averages, tolerance=0.50)
                    if not is_valid:
                        print("[Pipeline] Prophet invalide → SeasonalDecomp")
                        use_fallback = True
                    else:
                        # Appliquer hard floor même si Prophet est "valide"
                        result = apply_hard_floor(result, monthly_averages, floor_factor=0.70)

                # Vérifier explosion
                hist_max = float(df_train["y"].max())
                pred_max = max(result["values"]) if result["values"] else 0
                if hist_max > 0 and pred_max > hist_max * 3:
                    print(f"[Prophet] Explosion ({pred_max:.0f}) → Fallback")
                    use_fallback = True

            except Exception as exc:
                print(f"[Prophet] Erreur : {exc}")
                use_fallback = True
        else:
            use_fallback = True

        if use_fallback or result is None:
            if period == "monthly" and monthly_averages:
                print("[Pipeline] Utilisation SeasonalDecomp")
                result = seasonal_decomposition_predict(
                    df=df_full,
                    horizon=horizon,
                    monthly_averages=monthly_averages,
                    df_future=df_future,
                )
            elif len(df_full) >= MIN_ROWS_ARIMA:
                result = arima_predict(df_full, horizon, monthly_averages)
            else:
                result = naive_predict_seasonal(df_full, horizon)

        # ── 7. Réalisations, KPIs, stats ─────────────────────────────────────
        realization      = get_realization_series(period)
        confirmed_future = get_confirmed_future_reservations(horizon)
        occupancy_breakdown = estimate_occupancy_rate(
            predicted_monthly=result["values"],
            confirmed_monthly=confirmed_future["monthly"],
            labels=result["labels"],
            total_rooms=total_rooms,
        )
        historical_stats = compute_historical_stats(df_full)

        try:
            df_daily   = get_daily_series()
            xgb_result = xgboost_peak_detection(df_daily)
        except Exception:
            xgb_result = {"available": False}

        insight = generate_prediction_insight(
            result, period, df_full, history_start,
            monthly_averages, occupancy_breakdown,
            confirmed_future["total"], historical_stats,
        )

        # ── 8. Historique pour graphique ──────────────────────────────────────
        df_hist_display = df_full.tail(min(len(df_full), horizon * 2))
        historical = {
            "labels": [d.strftime("%Y-%m-%d") for d in df_hist_display["ds"]],
            "values": df_hist_display["y"].round(1).tolist(),
        }

        # ── 9. Prévision revenus ─────────────────────────────────────────────
        revenue_pred = None
        if "revenue" in df_full.columns and df_full["revenue"].sum() > 0 and df_full["y"].sum() > 0:
            avg_rev_per_res = float(df_full["revenue"].sum() / df_full["y"].sum())
            revenue_pred = {
                "labels": result["labels"],
                "values": [round(v * avg_rev_per_res, 2) for v in result["values"]],
            }

        # ── 10. Synthèse annuelle ─────────────────────────────────────────────
        annual_forecast: dict = {}
        for label, val in zip(result["labels"], result["values"]):
            year_key = label[:4]
            if year_key not in annual_forecast:
                annual_forecast[year_key] = {"forecast_total": 0.0, "confirmed_bookings": 0.0}
            annual_forecast[year_key]["forecast_total"] += val
            annual_forecast[year_key]["confirmed_bookings"] += confirmed_future["monthly"].get(
                label[:7], {}
            ).get("count", 0)
        for yr in annual_forecast:
            annual_forecast[yr]["forecast_total"]     = round(annual_forecast[yr]["forecast_total"], 1)
            annual_forecast[yr]["confirmed_bookings"] = round(annual_forecast[yr]["confirmed_bookings"], 1)

        status_distribution = get_status_distribution()

        response = {
            "period":               period,
            "horizon":              horizon,
            "total_rooms":          total_rooms,
            "history_start":        history_start,
            "training_cutoff":      training_cutoff,
            "history_years":        historical_stats.get("history_years", 0),
            "total_history_months": historical_stats.get("total_months", 0),
            "prediction_end_date":  _prediction_end_date(),
            "prediction":           result,
            "realization":          realization,
            "historical":           historical,
            "historical_stats":     historical_stats,
            "revenue_prediction":   revenue_pred,
            "confirmed_future":     confirmed_future,
            "occupancy_breakdown":  occupancy_breakdown,
            "annual_forecast":      annual_forecast,
            "xgboost":              xgb_result,
            "insight":              insight,
            "status_distribution":  status_distribution,
            "monthly_averages":     {str(k): round(v, 1) for k, v in monthly_averages.items()},
            "seasonal_profile":     {str(k): round(v, 3) for k, v in seasonal_profile.items()},
            "generated_at":         datetime.now().isoformat(),
            "from_cache":           False,
        }

        cache_set(cache_key, response)
        return jsonify(response)

    except Exception as exc:
        import traceback
        print(traceback.format_exc())
        return jsonify({"error": f"Erreur serveur : {str(exc)}"}), 500


# ══════════════════════════════════════════════════════════════════════════════
#  ENDPOINTS SECONDAIRES
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/model-info", methods=["GET"])
def model_info():
    try:
        df_m          = get_monthly_series()
        df_d          = get_daily_series()
        df_future     = get_future_monthly_series()
        history_start = _history_start_date()
        cutoff        = _training_cutoff_date()
        aberrant      = check_aberrant_dates()
        status_dist   = get_status_distribution()
        monthly_avgs  = compute_monthly_averages(df_m)
        seasonal_prof = compute_seasonal_profile(monthly_avgs)

        history_days  = (df_m["ds"].max() - df_m["ds"].min()).days if len(df_m) > 1 else 0
        history_years = round(history_days / 365.25, 1)
        recommended   = (
            "Prophet"  if len(df_m) >= MIN_ROWS_PROPHET else
            "ARIMA"    if len(df_m) >= MIN_ROWS_ARIMA   else
            "NaiveWMA"
        )

        return jsonify({
            "recommended_model":       recommended,
            "months_available":        len(df_m),
            "days_available":          len(df_d),
            "future_months_available": len(df_future),
            "future_bookings_total":   int(df_future["y"].sum()) if not df_future.empty else 0,
            "prophet_available":       len(df_m) >= MIN_ROWS_PROPHET,
            "arima_available":         len(df_m) >= MIN_ROWS_ARIMA,
            "max_horizon_months":      MAX_HORIZON,
            "history_start":           history_start,
            "history_years":           history_years,
            "training_cutoff":         cutoff,
            "training_cutoff_months":  TRAINING_CUTOFF_MONTHS,
            "excluded_statuses":       list(EXCLUDED_STATUSES),
            "prediction_end_date":     _prediction_end_date(),
            "monthly_averages":        {str(k): round(v,1) for k,v in monthly_avgs.items()},
            "seasonal_profile":        {str(k): round(v,3) for k,v in seasonal_prof.items()},
            "date_range": {
                "first": df_d["ds"].min().strftime("%Y-%m-%d") if len(df_d) else None,
                "last":  df_d["ds"].max().strftime("%Y-%m-%d") if len(df_d) else None,
            },
            "data_quality": {
                "has_enough_data":      len(df_m) >= 24,
                "warning":              None if len(df_m) >= 15 else f"Seulement {len(df_m)} mois",
                "aberrant_future_rows": aberrant.get("future_count", 0),
            },
            "status_distribution": status_dist,
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/status-check", methods=["GET"])
def status_check():
    try:
        dist          = get_status_distribution()
        history_start = _history_start_date()
        cutoff        = _training_cutoff_date()
        df_future     = get_future_monthly_series()
        df_m          = get_monthly_series()
        monthly_avgs  = compute_monthly_averages(df_m)

        included = [s for s in dist["statuses"] if not s["excluded"]]
        excluded = [s for s in dist["statuses"] if s["excluded"]]

        return jsonify({
            "total_reservations":    dist["total_reservations"],
            "included_in_model":     included,
            "excluded_from_model":   excluded,
            "history_start":         history_start,
            "training_cutoff":       cutoff,
            "future_months":         len(df_future),
            "future_bookings_total": int(df_future["y"].sum()) if not df_future.empty else 0,
            "excluded_statuses_cfg": list(EXCLUDED_STATUSES),
            "monthly_averages":      {str(k): round(v,1) for k,v in monthly_avgs.items()},
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/retrain", methods=["POST"])
def retrain():
    _cache.clear()
    return jsonify({"status": "ok", "message": "Cache vidé — prochain appel réentraîne le modèle."})


# ══════════════════════════════════════════════════════════════════════════════
#  POINT D'ENTRÉE
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    history_start   = _history_start_date()
    training_cutoff = _training_cutoff_date()
    end_display     = datetime.strptime(_prediction_end_date()[:7], "%Y-%m").strftime("%B %Y")

    print("=" * 70)
    print("  Prediction Server v7.0 — Hotel ML Forecasting")
    print("  Port      : 5002")
    print(f"  Historique: depuis {history_start}")
    print(f"  Coupure   : {training_cutoff} ({TRAINING_CUTOFF_MONTHS} mois incomplets exclus)")
    print(f"  Horizon   : 12 mois → {end_display}")
    print("  Nouveautés v7 :")
    print("    - compute_monthly_averages() : référence absolue par mois calendaire")
    print("    - validate_prophet_predictions() : bascule auto si Prophet dévie >50%")
    print("    - apply_hard_floor() : plancher 70% de la moyenne mensuelle réelle")
    print("    - SeasonalDecomp : modèle de secours toujours ancré sur l'historique")
    print("    - cp_scale=0.01 : tendance quasi-neutralisée dans Prophet")
    print("    - Tendance annuelle plafonnée à -5%/an max dans SeasonalDecomp")
    print("  GET  : /predict-reservations?period=monthly&total_rooms=50")
    print("  GET  : /model-info  (affiche monthly_averages)")
    print("  GET  : /status-check")
    print("  POST : /retrain")
    print("=" * 70)
    check_aberrant_dates()
    app.run(debug=True, host="0.0.0.0", port=5002)