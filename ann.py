"""
Prédiction d'annulations hôtelières — Pipeline ML complet
Dataset synthétique intégré (5 000 réservations) — aucun fichier externe requis

Dépendances (toutes incluses dans scikit-learn) :
    pip install pandas numpy scikit-learn

Pour utiliser XGBoost à la place :
    pip install xgboost
    Remplacer GradientBoostingClassifier par xgb.XGBClassifier
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report, roc_auc_score, confusion_matrix
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.impute import SimpleImputer
import warnings
warnings.filterwarnings("ignore")


# ─────────────────────────────────────────────
# 0. GÉNÉRATEUR DE DATASET SYNTHÉTIQUE
# ─────────────────────────────────────────────

def generate_dataset(n: int = 5000, seed: int = 42) -> pd.DataFrame:
    """
    Génère un dataset synthétique réaliste de réservations hôtelières.
    Les distributions et la logique d'annulation sont calquées sur le
    dataset public 'Hotel Booking Demand' (Antonio et al., 2019).
    Taux d'annulation simulé : ~37 %
    """
    rng = np.random.default_rng(seed)

    months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ]
    month_map = {m: i + 1 for i, m in enumerate(months)}

    # ── Variables catégorielles ──
    hotels         = rng.choice(["City Hotel", "Resort Hotel"], n, p=[0.66, 0.34])
    meal           = rng.choice(["BB", "HB", "FB", "SC"], n, p=[0.77, 0.12, 0.04, 0.07])
    market_segment = rng.choice(
        ["Online TA", "Offline TA/TO", "Direct", "Corporate", "Groups", "Complementary"],
        n, p=[0.47, 0.20, 0.15, 0.10, 0.07, 0.01]
    )
    distribution  = rng.choice(["TA/TO", "Direct", "Corporate", "GDS"], n, p=[0.82, 0.14, 0.03, 0.01])
    room_type     = rng.choice(["A", "B", "C", "D", "E", "F", "G"], n, p=[0.55, 0.08, 0.07, 0.15, 0.08, 0.04, 0.03])
    deposit_type  = rng.choice(["No Deposit", "Non Refund", "Refundable"], n, p=[0.87, 0.10, 0.03])
    customer_type = rng.choice(["Transient", "Contract", "Transient-Party", "Group"], n, p=[0.75, 0.10, 0.13, 0.02])
    arrival_month = rng.choice(months, n)
    arrival_month_num = np.array([month_map[m] for m in arrival_month])

    # ── Variables numériques ──
    lead_time        = rng.integers(0, 500, n)
    stays_week       = rng.integers(0, 8, n)
    stays_weekend    = rng.integers(0, 4, n)
    total_nights     = np.maximum(stays_week + stays_weekend, 1)
    adults           = rng.integers(1, 4, n)
    children         = rng.choice([0, 1, 2], n, p=[0.84, 0.12, 0.04]).astype(float)
    babies           = rng.choice([0, 1], n, p=[0.99, 0.01])
    adr              = np.round(rng.uniform(20, 400, n), 2)
    booking_changes  = rng.choice([0, 1, 2, 3], n, p=[0.70, 0.18, 0.08, 0.04])
    parking          = rng.choice([0, 1], n, p=[0.92, 0.08])
    special_requests = rng.choice([0, 1, 2, 3, 4, 5], n, p=[0.40, 0.30, 0.17, 0.08, 0.04, 0.01])
    waiting_list     = rng.choice([0, 1, 2, 5, 10, 30], n, p=[0.90, 0.04, 0.02, 0.02, 0.01, 0.01])
    prev_cancels     = rng.choice([0, 1, 2, 3], n, p=[0.87, 0.08, 0.03, 0.02])
    prev_not_cancel  = rng.choice([0, 1, 2, 3, 4], n, p=[0.72, 0.15, 0.07, 0.04, 0.02])
    agent            = rng.choice(["nan", "A1", "A2", "A3", "A4"], n, p=[0.18, 0.30, 0.25, 0.15, 0.12])

    # ── Probabilité d'annulation (modèle logistique métier) ──
    cancel_logit = (
        -1.8
        + 0.004 * lead_time
        - 0.002 * adr
        - 0.08  * total_nights
        - 0.25  * special_requests
        + 1.2   * (deposit_type == "No Deposit").astype(float)
        - 2.5   * (deposit_type == "Non Refund").astype(float)
        + 0.9   * (prev_cancels > 0).astype(float)
        + 0.4   * (market_segment == "Online TA").astype(float)
        - 0.6   * (market_segment == "Corporate").astype(float)
        + 0.3   * np.isin(arrival_month_num, [6, 7, 8]).astype(float)
        + rng.normal(0, 0.5, n)
    )
    cancel_prob = 1 / (1 + np.exp(-cancel_logit))
    is_canceled = (rng.uniform(0, 1, n) < cancel_prob).astype(int)

    df = pd.DataFrame({
        "hotel":                          hotels,
        "is_canceled":                    is_canceled,
        "lead_time":                      lead_time,
        "arrival_date_year":              rng.choice([2022, 2023, 2024], n),
        "arrival_date_month":             arrival_month,
        "arrival_date_day_of_month":      rng.integers(1, 28, n),
        "stays_in_weekend_nights":        stays_weekend,
        "stays_in_week_nights":           stays_week,
        "adults":                         adults,
        "children":                       children,
        "babies":                         babies,
        "meal":                           meal,
        "country":                        rng.choice(
            ["FRA", "PRT", "ESP", "GBR", "DEU", "USA", "Unknown"], n,
            p=[0.25, 0.20, 0.15, 0.12, 0.10, 0.10, 0.08]
        ),
        "market_segment":                 market_segment,
        "distribution_channel":           distribution,
        "is_repeated_guest":              (prev_not_cancel > 0).astype(int),
        "previous_cancellations":         prev_cancels,
        "previous_bookings_not_canceled": prev_not_cancel,
        "reserved_room_type":             room_type,
        "assigned_room_type":             room_type,
        "booking_changes":                booking_changes,
        "deposit_type":                   deposit_type,
        "agent":                          agent,
        "days_in_waiting_list":           waiting_list,
        "customer_type":                  customer_type,
        "adr":                            adr,
        "required_car_parking_spaces":    parking,
        "total_of_special_requests":      special_requests,
    })

    return df


# ─────────────────────────────────────────────
# 1. NETTOYAGE
# ─────────────────────────────────────────────

def clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.drop_duplicates()
    df = df[df["stays_in_week_nights"] + df["stays_in_weekend_nights"] > 0]
    df["meal"]    = df["meal"].replace("Undefined", "SC")
    df            = df[df["adr"] >= 0]
    df["country"] = df["country"].fillna("Unknown")
    return df.reset_index(drop=True)


# ─────────────────────────────────────────────
# 2. FEATURE ENGINEERING
# ─────────────────────────────────────────────

def build_features(df: pd.DataFrame) -> pd.DataFrame:
    fe = df.copy()

    fe["total_nights"]               = fe["stays_in_week_nights"] + fe["stays_in_weekend_nights"]
    fe["total_guests"]               = fe["adults"] + fe["children"].fillna(0) + fe["babies"]
    fe["lead_per_night"]             = fe["lead_time"] / (fe["total_nights"] + 1)
    fe["has_previous_cancellations"] = (fe["previous_cancellations"] > 0).astype(int)
    fe["cancel_rate_history"]        = (
        fe["previous_cancellations"] /
        (fe["previous_cancellations"] + fe["previous_bookings_not_canceled"] + 1)
    )
    fe["non_refundable"]  = (fe["deposit_type"] == "Non Refund").astype(int)
    fe["via_agent"]       = (fe["agent"] != "nan").astype(int)

    month_map = {
        "January": 1, "February": 2, "March": 3,    "April": 4,
        "May": 5,     "June": 6,     "July": 7,     "August": 8,
        "September": 9, "October": 10, "November": 11, "December": 12
    }
    fe["arrival_month_num"] = fe["arrival_date_month"].map(month_map)
    fe["is_peak_season"]    = fe["arrival_month_num"].isin([6, 7, 8]).astype(int)
    fe["target"]            = fe["is_canceled"]

    return fe


NUMERIC_FEATURES = [
    "lead_time", "adr", "total_nights", "total_guests",
    "lead_per_night", "cancel_rate_history",
    "booking_changes", "required_car_parking_spaces",
    "total_of_special_requests", "days_in_waiting_list",
    "arrival_month_num"
]

CATEGORICAL_FEATURES = [
    "hotel", "meal", "market_segment", "distribution_channel",
    "reserved_room_type", "deposit_type", "customer_type"
]

BINARY_FEATURES = [
    "has_previous_cancellations", "non_refundable",
    "via_agent", "is_peak_season"
]


# ─────────────────────────────────────────────
# 3. PIPELINE SKLEARN
# ─────────────────────────────────────────────

def build_pipeline() -> Pipeline:
    numeric_transformer = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler",  StandardScaler())
    ])
    categorical_transformer = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("encoder", OneHotEncoder(handle_unknown="ignore", sparse_output=False))
    ])
    preprocessor = ColumnTransformer([
        ("num", numeric_transformer,     NUMERIC_FEATURES),
        ("cat", categorical_transformer, CATEGORICAL_FEATURES),
        ("bin", "passthrough",           BINARY_FEATURES)
    ])
    model = GradientBoostingClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.08,
        subsample=0.8,
        min_samples_leaf=20,
        random_state=42
    )
    return Pipeline([("preprocessor", preprocessor), ("classifier", model)])


# ─────────────────────────────────────────────
# 4. ENTRAÎNEMENT & ÉVALUATION
# ─────────────────────────────────────────────

def train_and_evaluate(df: pd.DataFrame, threshold: float = 0.45):
    all_features = NUMERIC_FEATURES + CATEGORICAL_FEATURES + BINARY_FEATURES
    X = df[all_features]
    y = df["target"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    pipeline = build_pipeline()

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(pipeline, X_train, y_train, cv=cv, scoring="roc_auc")
    print(f"AUC-ROC cross-val : {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")

    pipeline.fit(X_train, y_train)

    proba  = pipeline.predict_proba(X_test)[:, 1]
    y_pred = (proba >= threshold).astype(int)

    print(f"\n=== Évaluation (seuil = {threshold}) ===")
    print(classification_report(y_test, y_pred, target_names=["Pas annulé", "Annulé"]))
    print(f"AUC-ROC test : {roc_auc_score(y_test, proba):.4f}")

    cm = confusion_matrix(y_test, y_pred)
    print(f"\nMatrice de confusion :\n{cm}")
    print(f"  Faux négatifs (annulations manquées) : {cm[1][0]}")
    print(f"  Faux positifs (fausses alertes)      : {cm[0][1]}")

    # ── Feature importance (top 10) ──
    print("\n=== Top 10 features (importance) ===")
    enc = pipeline.named_steps["preprocessor"]
    clf = pipeline.named_steps["classifier"]
    try:
        cat_names = (
            enc.named_transformers_["cat"]
            .named_steps["encoder"]
            .get_feature_names_out(CATEGORICAL_FEATURES)
            .tolist()
        )
    except Exception:
        cat_names = [f"cat_{i}" for i in range(clf.n_features_in_ - len(NUMERIC_FEATURES) - len(BINARY_FEATURES))]

    feature_names = NUMERIC_FEATURES + cat_names + BINARY_FEATURES
    importances   = clf.feature_importances_
    top10 = sorted(zip(feature_names, importances), key=lambda x: x[1], reverse=True)[:10]
    for feat, imp in top10:
        bar = "█" * int(imp * 300)
        print(f"  {feat:40s} {imp:.4f}  {bar}")

    return pipeline, X_test, y_test, proba


# ─────────────────────────────────────────────
# 5. SCORING TEMPS RÉEL
# ─────────────────────────────────────────────

def score_reservation(pipeline, reservation: dict, threshold: float = 0.45) -> dict:
    """Prédit le risque d'annulation pour une réservation unique."""
    df_input = pd.DataFrame([reservation])
    for col in NUMERIC_FEATURES + CATEGORICAL_FEATURES + BINARY_FEATURES:
        if col not in df_input.columns:
            df_input[col] = np.nan

    proba      = pipeline.predict_proba(df_input)[0][1]
    prediction = int(proba >= threshold)
    risk_level = (
        "Faible"     if proba < 0.30 else
        "Modéré"     if proba < 0.55 else
        "Élevé"      if proba < 0.75 else
        "Très élevé"
    )
    return {
        "cancel_probability": round(float(proba), 4),
        "prediction":         prediction,
        "risk_level":         risk_level,
        "action": (
            "Offre de rétention recommandée"
            if proba >= 0.55 else "Aucune action requise"
        )
    }


# ─────────────────────────────────────────────
# 6. POINT D'ENTRÉE
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 55)
    print("  Prédiction d'annulations hôtelières — Pipeline ML")
    print("=" * 55)

    print("\n[1/4] Génération du dataset synthétique (5 000 réservations)...")
    df_raw = generate_dataset(n=5000, seed=42)
    print(f"      Lignes générées : {len(df_raw):,}")

    print("[2/4] Nettoyage...")
    df_clean = clean(df_raw)

    print("[3/4] Feature engineering...")
    df = build_features(df_clean)
    print(f"      Taux d'annulation : {df['target'].mean():.1%}  "
          f"({df['target'].sum()} annulations sur {len(df):,} réservations)")

    print("\n[4/4] Entraînement du modèle (Gradient Boosting)...\n")
    model_pipeline, X_test, y_test, probas = train_and_evaluate(df)

    # ── Exemple de scoring temps réel ──
    print("\n=== Scoring temps réel (réservation à risque élevé) ===")
    exemple = {
        "lead_time":                    180,
        "adr":                          95.0,
        "total_nights":                 2,
        "total_guests":                 2,
        "lead_per_night":               90.0,
        "cancel_rate_history":          0.5,
        "booking_changes":              0,
        "required_car_parking_spaces":  0,
        "total_of_special_requests":    0,
        "days_in_waiting_list":         0,
        "arrival_month_num":            7,
        "has_previous_cancellations":   1,
        "non_refundable":               0,
        "via_agent":                    1,
        "is_peak_season":               1,
        "hotel":                        "City Hotel",
        "meal":                         "BB",
        "market_segment":               "Online TA",
        "distribution_channel":         "TA/TO",
        "reserved_room_type":           "A",
        "deposit_type":                 "No Deposit",
        "customer_type":                "Transient",
    }
    result = score_reservation(model_pipeline, exemple)
    for k, v in result.items():
        print(f"  {k:28s}: {v}")

    print("\nTerminé.")