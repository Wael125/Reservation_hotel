"""
bi_chatbot.py  —  Business Intelligence Assistant (DYNAMIC VERSION)
Utilise Ollama (DeepSeek) — 100% gratuit, même logique que chatbot.py
Endpoint : POST /chat-admin
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import json
import re
from datetime import datetime

app = Flask(__name__)
CORS(app)

# ══════════════════════════════════════════════
#  CONFIG — même style que chatbot.py
# ══════════════════════════════════════════════
MODEL    = "gemma4:31b-cloud"   # même modèle que chatbot.py
OLLAMA   = "http://localhost:11434/api/chat"

DB_CONFIG = {
    "host":     "localhost",
    "user":     "root",
    "password": "",
    "database": "hotelmanagementsystem",
    "charset":  "utf8mb4",
}

# ══════════════════════════════════════════════
#  DB HELPERS
# ══════════════════════════════════════════════
def get_db():
    import mysql.connector
    return mysql.connector.connect(**DB_CONFIG)

def query_db(sql):
    conn = get_db()
    cur  = conn.cursor(dictionary=True)
    cur.execute(sql)
    rows = cur.fetchall()
    conn.close()
    return rows

# ══════════════════════════════════════════════
#  SCHEMA — vos vraies tables
# ══════════════════════════════════════════════
def get_schema():
    return """
DATABASE: hotelmanagementsystem
TODAY: {today}

TABLE customer:
  id, nom, prenom, genre, email, telephone,
  date_naissance DATE, pays, login_id

TABLE reservation:
  id, clientName, customer_id, email, phoneNumber,
  checkInDate DATE, checkOutDate DATE,
  roomType VARCHAR (simple/double/triple/suite),
  roomNumber VARCHAR,
  numberOfAdults INT, numberOfChildren INT, totalNumberOfPeople INT,
  paymentDetails VARCHAR (Carte bancaire/Espèces/Virement/PayPal),
  pension VARCHAR (Sans pension/Demi-pension/Pension complète/All inclusive),
  totalPrice DECIMAL,
  status VARCHAR (En attente/Confirmée/Refusé/Annulé/Checked_in/Checked_out/Completé)

TABLE room:
  roomnumber VARCHAR PK,
  roomType VARCHAR (simple/double/triple/suite),
  price DECIMAL,
  availability VARCHAR (Disponible/Occupé/Maintenance)

TABLE activites:
  id_activite INT PK,
  nom_activite VARCHAR,
  description TEXT,
  type_activite VARCHAR,
  duree INT (durée en minutes),
  capacite_max INT,
  localisation VARCHAR,
  statut VARCHAR (Disponible/Indisponible)

TABLE avis:
  id INT PK,
  reservation_id INT → reservation.id,
  customer_id INT → customer.id,
  note INT (note de 1 à 5),
  commentaire TEXT,
  created_at DATETIME

TABLE reclamations:
  id INT PK,
  reservation_id INT → reservation.id,
  customer_id INT → customer.id,
  avis_id INT → avis.id (nullable),
  description TEXT,
  type VARCHAR (Chambre/Salle de bain/Climatisation/Chauffage/Électricité/Wi-Fi/Télévision/Bruit/Propreté/Literie/Restauration/Petit-déjeuner/Room service/Piscine/Spa/Parking/Service réception/Service ménage/Service sécurité/Facturation/Remboursement/Autre),
  statut VARCHAR (ouverte/en_cours/resolue),
  created_at DATETIME,
  urgence VARCHAR (Faible/Moyenne/élevée)       

RELATIONS:
  reservation.customer_id  → customer.id
  reservation.roomNumber   → room.roomnumber
  avis.reservation_id      → reservation.id
  avis.customer_id         → customer.id
  reclamations.reservation_id → reservation.id
  reclamations.customer_id    → customer.id
  reclamations.avis_id        → avis.id

PATTERNS UTILES:
- Age client: TIMESTAMPDIFF(YEAR, c.date_naissance, CURDATE())
- Exclure annulés: NOT (LOWER(COALESCE(r.status,'')) LIKE 'annul%%' OR LOWER(COALESCE(r.status,'')) IN ('cancelled','canceled'))
- Mois français: janvier=1 fevrier=2 mars=3 avril=4 mai=5 juin=6 juillet=7 aout=8 septembre=9 octobre=10 novembre=11 decembre=12
- Mois courant: MONTH(col)=MONTH(CURDATE()) AND YEAR(col)=YEAR(CURDATE())
- Mois+année spécifique: MONTH(col)=N AND YEAR(col)=YYYY
- Derniers N mois: col >= DATE_SUB(CURDATE(), INTERVAL N MONTH)
- Durée séjour: DATEDIFF(checkOutDate, checkInDate)
- Note moyenne avis: AVG(a.note)
- Réclamations urgentes: LOWER(r.urgence) IN ('haute','critique')
- Réclamations ouvertes: LOWER(r.statut) IN ('ouverte','en_cours')
- Activités disponibles: LOWER(a.statut) = 'active'
""".format(today=datetime.now().strftime("%Y-%m-%d"))

# ══════════════════════════════════════════════
#  SYSTEM PROMPT — même style que chatbot.py
# ══════════════════════════════════════════════
SQL_SYSTEM_PROMPT = """
Tu es un expert analyste BI MySQL pour un système de gestion hôtelière.

Ton rôle : analyser la question de l'utilisateur et générer une requête MySQL adaptée.

RÈGLES ABSOLUES :
1. Réponds UNIQUEMENT avec un JSON valide — aucun markdown, aucun texte autour, aucun ```json
2. Le JSON doit respecter exactement cette structure :
{
  "intent": "nom_snake_case",
  "title": "Titre lisible en français",
  "sql": "SELECT ... FROM ... WHERE ... GROUP BY ... ORDER BY ... LIMIT ...",
  "chart_type": "line|bar|doughnut|histogram|kpi_cards",
  "is_kpi_cards": false,
  "description": "Une phrase décrivant ce que la requête calcule"
}

RÈGLES CHART TYPE :
- line      = séries temporelles (évolution mensuelle/hebdomadaire/annuelle)
- bar       = comparaisons catégorielles, classements, top-N
- histogram = distributions d'âge ou fréquence
- doughnut  = proportions, pourcentages, répartition par statut
- kpi_cards = chiffres agrégés uniques (totaux, moyennes, comptages) → mettre is_kpi_cards=true

RÈGLES SQL :
- Toujours aliaser les colonnes résultat en "label" et "value" quand possible
- Séries temporelles: DATE_FORMAT(col,'%Y-%m') AS label, SUM/COUNT AS value
- KPI cards: utiliser des noms de colonnes descriptifs (pas label/value)
- Utiliser COALESCE pour les champs nullables
- Maximum 15 lignes pour les classements (LIMIT 15)
- Utiliser LOWER() pour comparer les statuts
- Traduire correctement les mois français en numéros
- Toujours ORDER BY quelque chose de significatif
- Utiliser les vrais noms de colonnes des tables fournies

EXEMPLES de requêtes correctes:
- "réservations par mois" → SELECT DATE_FORMAT(checkInDate,'%Y-%m') AS label, COUNT(*) AS value FROM reservation GROUP BY label ORDER BY label
- "top clients" → SELECT clientName AS label, COUNT(*) AS value FROM reservation GROUP BY clientName ORDER BY value DESC LIMIT 10
- "taux occupation" → SELECT roomType AS label, ROUND(100*SUM(availability='occupied')/COUNT(*),1) AS value FROM room GROUP BY roomType
- "note moyenne des avis" → SELECT DATE_FORMAT(a.created_at,'%Y-%m') AS label, ROUND(AVG(a.note),2) AS value FROM avis a GROUP BY label ORDER BY label
- "réclamations par urgence" → SELECT urgence AS label, COUNT(*) AS value FROM reclamations GROUP BY urgence ORDER BY value DESC
- "activités par type" → SELECT type_activite AS label, COUNT(*) AS value FROM activites GROUP BY type_activite ORDER BY value DESC
- "réclamations par statut" → SELECT statut AS label, COUNT(*) AS value FROM reclamations GROUP BY statut ORDER BY value DESC
- "clients ayant laissé un avis" → SELECT CONCAT(c.prenom,' ',c.nom) AS label, COUNT(a.id) AS value FROM avis a JOIN customer c ON a.customer_id=c.id GROUP BY c.id ORDER BY value DESC LIMIT 10
"""

INSIGHT_SYSTEM_PROMPT = """
Tu es un analyste BI senior pour un hôtel. Génère une analyse concise et actionnable en français.

FORMAT OBLIGATOIRE (JSON valide uniquement, sans markdown) :
{
  "analysis": "ton analyse ici"
}

RÈGLES pour l'analyse :
- Commence par un emoji et un titre en gras avec **titre**
- Utilise des puces avec le caractère •
- Mets les chiffres importants en gras avec **chiffre**
- Termine par **Recommandation :** suivi d'un conseil concret
- Maximum 180 mots
- Pas de headers ##, pas de tableaux markdown
"""

# ══════════════════════════════════════════════
#  APPEL OLLAMA — même logique que chatbot.py
# ══════════════════════════════════════════════
def ask_ollama(system_prompt, user_message, temperature=0.1):
    """Appelle Ollama exactement comme chatbot.py."""
    raw = ""
    try:
        r = requests.post(
            OLLAMA,
            json={
                "model": MODEL,
                "messages": [
                    {"role": "system",  "content": system_prompt},
                    {"role": "user",    "content": user_message},
                ],
                "stream":  False,
                "options": {"temperature": temperature}
            },
            timeout=60
        )
        raw = r.json().get("message", {}).get("content", "")
        # Nettoyer les fences markdown si présents
        raw = re.sub(r"```json\s*", "", raw)
        raw = re.sub(r"```\s*",     "", raw)
        raw = raw.strip()
        return json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[BI JSON ERROR] {e} | raw={raw[:300]}")
        return None
    except Exception as e:
        print(f"[BI OLLAMA ERROR] {e}")
        return None

# ══════════════════════════════════════════════
#  STEP 1 — Générer le SQL
# ══════════════════════════════════════════════
def llm_generate_sql(message):
    prompt = f"""SCHÉMA DE BASE DE DONNÉES :
{get_schema()}

QUESTION UTILISATEUR : "{message}"

Génère la requête SQL qui répond à cette question. Réponds UNIQUEMENT avec le JSON valide."""

    result = ask_ollama(SQL_SYSTEM_PROMPT, prompt, temperature=0.1)
    return result

# ══════════════════════════════════════════════
#  STEP 2 — Générer l'analyse
# ══════════════════════════════════════════════
def llm_generate_insight(question, sql, rows, title):
    sample = rows[:40]
    prompt = f"""Question: "{question}"
Titre: "{title}"
SQL utilisé: {sql}

Résultats ({len(rows)} lignes, voici les {len(sample)} premières):
{json.dumps(sample, ensure_ascii=False, default=str)}

Génère l'analyse business. Réponds UNIQUEMENT avec le JSON valide."""

    result = ask_ollama(INSIGHT_SYSTEM_PROMPT, prompt, temperature=0.3)
    if result and "analysis" in result:
        return result["analysis"]
    return f"Analyse de {len(rows)} résultats disponibles."

# ══════════════════════════════════════════════
#  Préparer les données graphique
# ══════════════════════════════════════════════
def prepare_chart_data(rows, is_kpi_cards):
    if not rows:
        return {"labels": [], "values": [], "raw": []}
    if is_kpi_cards:
        return {"labels": [], "values": [], "raw": rows}

    first = rows[0]

    # Cas standard label/value
    if "label" in first and "value" in first:
        labels = [str(r.get("label", "")) for r in rows]
        values = []
        for r in rows:
            try:    values.append(float(r["value"]))
            except: values.append(0)
        extra = {}
        for k in [k for k in first if k not in ("label", "value")]:
            try:    extra[k] = [float(r.get(k, 0)) for r in rows]
            except: extra[k] = [str(r.get(k, ""))  for r in rows]
        return {"labels": labels, "values": values, "extra": extra, "raw": rows}

    # Fallback: première colonne = label, deuxième = value
    cols = list(first.keys())
    if len(cols) >= 2:
        labels = [str(r.get(cols[0], "")) for r in rows]
        values = []
        for r in rows:
            try:    values.append(float(r[cols[1]]))
            except: values.append(0)
        return {"labels": labels, "values": values, "extra": {}, "raw": rows}

    return {"labels": [], "values": [], "raw": rows}

# ══════════════════════════════════════════════
#  MESSAGE FALLBACK
# ══════════════════════════════════════════════
FALLBACK = """Je suis votre assistant BI. Exemples de questions :
• Combien de réservations en janvier 2025 ?
• Évolution des revenus par mois
• Clients qui habitent en Tunisie
• Top 10 clients par dépenses
• Taux d'occupation par type de chambre
• Répartition des modes de paiement
• Distribution des âges des clients
• KPI généraux du tableau de bord
• Note moyenne des avis clients par mois
• Réclamations par niveau d'urgence
• Activités disponibles par type
• Réclamations ouvertes cette semaine
• Clients ayant laissé un avis négatif (note ≤ 2)
Posez votre question librement ! 🧠"""

# ══════════════════════════════════════════════
#  ENDPOINT PRINCIPAL
# ══════════════════════════════════════════════
@app.route("/chat-admin", methods=["POST"])
def chat_admin():
    body    = request.json or {}
    message = body.get("message", "").strip()

    if not message:
        return jsonify({"error": "Message vide"}), 400

    # ── ÉTAPE 1 : LLM génère le SQL ────────────
    llm = llm_generate_sql(message)

    if not llm or not llm.get("sql"):
        return jsonify({
            "reply":         FALLBACK,
            "chart_type":    None,
            "chart_data":    None,
            "analysis_text": None,
            "intent":        "unknown",
            "sql_used":      None,
        })

    sql          = llm.get("sql", "")
    intent       = llm.get("intent", "custom")
    title        = llm.get("title", "Analyse BI")
    chart_type   = llm.get("chart_type", "bar")
    is_kpi_cards = llm.get("is_kpi_cards", False)
    description  = llm.get("description", "")

    # ── ÉTAPE 2 : Exécution SQL ─────────────────
    try:
        rows = query_db(sql)
    except Exception as e:
        print(f"[SQL ERROR] {e} | SQL: {sql}")
        return jsonify({
            "reply":         f"❌ Erreur SQL : {str(e)}",
            "chart_type":    None,
            "chart_data":    None,
            "analysis_text": None,
            "sql_used":      sql,
        }), 500

    # ── ÉTAPE 3 : LLM génère l'analyse ─────────
    if rows:
        try:
            analysis = llm_generate_insight(message, sql, rows, title)
        except Exception as e:
            analysis = f"Données disponibles : {len(rows)} résultats."
    else:
        analysis = "⚠️ Aucune donnée trouvée pour cette requête."

    # ── ÉTAPE 4 : Données graphique ─────────────
    chart_data = prepare_chart_data(rows, is_kpi_cards)
    if is_kpi_cards:
        chart_type = "kpi_cards"

    reply = f"✅ **{title}** — graphique généré dans votre dashboard ↑"
    if not rows:
        reply = f"⚠️ **{title}** — aucune donnée trouvée."

    return jsonify({
        "reply":         reply,
        "title":         title,
        "intent":        intent,
        "chart_type":    chart_type,
        "chart_data":    chart_data,
        "analysis_text": analysis,
        "sql_used":      sql,
        "description":   description,
        "filters":       {},
    })

# ══════════════════════════════════════════════
#  HEALTH CHECK
# ══════════════════════════════════════════════
@app.route("/health", methods=["GET"])
def health():
    # Test DB
    db_ok, db_msg = False, ""
    try:
        query_db("SELECT 1")
        db_ok = True
        db_msg = "connected"
    except Exception as e:
        db_msg = f"error: {str(e)}"

    # Test Ollama
    ollama_ok, ollama_msg = False, ""
    try:
        r = requests.get("http://localhost:11434/api/tags", timeout=3)
        ollama_ok = r.status_code == 200
        ollama_msg = "running" if ollama_ok else f"HTTP {r.status_code}"
    except Exception as e:
        ollama_msg = f"not reachable: {str(e)}"

    return jsonify({
        "status":    "ok" if (db_ok and ollama_ok) else "degraded",
        "db":        db_msg,
        "ollama":    ollama_msg,
        "model":     MODEL,
        "timestamp": datetime.now().isoformat(),
    })

@app.route("/bi-intents", methods=["GET"])
def bi_intents():
    return jsonify({
        "mode":  "dynamic-ollama",
        "model": MODEL,
        "examples": [
            "Combien de réservations en janvier 2025 ?",
            "Évolution du chiffre d'affaires par mois",
            "Clients qui habitent en Tunisie",
            "Top 10 clients VIP par dépenses",
            "Taux d'occupation par type de chambre",
            "Modes de paiement utilisés",
            "Distribution des âges des clients",
            "Réservations annulées cette année",
            "Revenus par type de chambre",
            "KPI généraux",
            # Nouvelles questions liées aux tables ajoutées
            "Note moyenne des avis par mois",
            "Répartition des avis par note",
            "Réclamations par niveau d'urgence",
            "Réclamations ouvertes en attente",
            "Activités disponibles par type",
            "Top clients ayant laissé des avis",
            "Réclamations résolues vs ouvertes",
            "Activités par localisation",
            "Clients avec avis négatifs (note ≤ 2)",
            "KPI avis et réclamations",
        ]
    })

if __name__ == "__main__":
    print(f"🧠 BI Assistant (Ollama — {MODEL}) — http://127.0.0.1:5001")
    print("📋 Health: http://127.0.0.1:5001/health")
    app.run(debug=True, host="0.0.0.0", port=5001)