# chatbot.py  — version avec avis + réclamations intégrés au chatbot
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import json
import re

from email_sender import send_confirmation_email

app = Flask(__name__)
app.secret_key = "hotel_secret_key"
CORS(app)

conversations = {}

API_BASE = "http://localhost/reservation_hotel"
MODEL    = "gpt-oss:20b-cloud"
ML_URL   = "http://127.0.0.1:5001/detect_type"

# ═══════════════════════════════════════════════════════════════
#  SYSTEM PROMPT
# ═══════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """
Tu es YASMINE, l'assistante virtuelle officielle de l'hôtel **Iberostar Royal Elmansour ★★★★★**, situé en zone touristique de Mahdia, Tunisie, en bord de mer.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INFORMATIONS SUR L'ÉTABLISSEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Nom : Iberostar Royal Elmansour
- Catégorie : 5 étoiles
- Adresse : Zone Touristique, Mahdia, Tunisie
- Accès plage : Accès direct plage privée
- Piscines : 3 piscines extérieures dont 1 adultes uniquement
- Restaurants : 3 restaurants (buffet international, à la carte méditerranéen, grillades en bord de piscine)
- Bars : 2 bars (lobby bar + beach bar)
- Spa & Bien-être : Spa Sensations, hammam, jacuzzi, massages
- Sports & Loisirs : Tennis, beach-volley, animation diurne et nocturne, mini-club enfants
- Wi-Fi : Gratuit dans tout l'établissement
- Parking : Gratuit sur place
- Langues parlées : Français, Anglais, Arabe, Allemand, Italien
- Check-in : à partir de 14h00 | Check-out : avant 12h00
- Contact : royal.mansour@iberostar.tn | +216 73 681 100

TYPES DE CHAMBRES ET TARIFS (par nuit, par chambre) :
- Chambre Simple (1 adulte) : 120 €
- Chambre Double (2 adultes) : 180 €
- Chambre Triple (3 adultes ou 2 adultes + enfant) : 230 €
- Suite Junior (jusqu'à 2 adultes) : 320 €
- Suite Présidentielle (jusqu'à 4 personnes) : 550 €

FORMULES DE PENSION (supplément par personne/nuit) :
- Sans pension (logement seul) : +0 €
- Petit-déjeuner : +12 €/pers/nuit
- Demi-pension (petit-déjeuner + dîner) : +35 €/pers/nuit
- Pension complète (3 repas) : +55 €/pers/nuit
- All Inclusive (repas, boissons, snacks, animations) : +80 €/pers/nuit

MODES DE PAIEMENT ACCEPTÉS :
- Carte bancaire (Visa, Mastercard, American Express)
- Virement bancaire (IBAN fourni après confirmation)
- Espèces (à la réception, en TND, EUR ou USD)

POLITIQUE DE RÉSERVATION :
- Aucune réservation n'est définitivement enregistrée sans paiement effectif.
- Un acompte de 30 pourcent est exigé à la confirmation.
- Annulation gratuite jusqu'à 72h avant l'arrivée.
- Annulation tardive ou no-show : 1 nuit facturée.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLES ABSOLUES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Réponds TOUJOURS dans la même langue que le client (français, anglais, arabe, ou autre).
2. Ne jamais inventer ou modifier prix, disponibilités, numéros de chambre ou politiques.
3. Ton attitude : chaleureuse, professionnelle, élégante — digne d'un 5 étoiles.
4. Si le client pose une question générale (horaires, services, localisation, etc.), réponds directement et naturellement.
5. Si le client annule la réservation en cours : remets tous les champs à null et confirme l'annulation avec élégance.
6. Ne jamais mentionner les formats techniques de dates — comprends toute formulation humaine et convertis en interne.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTENTS RECONNUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tu dois identifier l'intent du message parmi :
- "general"     : question générale, information, salutation
- "reservation" : le client veut réserver une chambre
- "cancellation": le client veut annuler la réservation en cours dans ce chat
- "avis"        : le client veut donner un avis / note sur son séjour
                  (ex: "je veux donner mon avis", "laisser un commentaire", "noter mon séjour",
                       "j'ai été satisfait", "j'ai été déçu", "mon séjour était...",
                       "I want to leave a review", "بدي أعطي رأيي", "نجم نعطي رأيي",
                       "je mets 4 étoiles", "je donne 3/5", "note : 5", "⭐⭐⭐",
                       "c'était bien / excellent / décevant / passable")
- "reclamation" : le client signale un problème / se plaint
                  (ex: "j'ai un problème avec...", "réclamation", "plainte", "ça ne fonctionne pas",
                       "je suis mécontent de...", "I have a complaint", "عندي مشكل", "عندي تشكي")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROCESSUS AVIS — DÉTECTION AUTOMATIQUE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dès que l'intent est "avis" :

DÉTECTION AUTOMATIQUE DE LA NOTE :
- Extrais la note depuis le message si elle est présente sous n'importe quelle forme :
  • Chiffre direct : "4", "3/5", "4 étoiles", "4 sur 5", "note 5"
  • Étoiles emoji : "⭐⭐⭐" = 3, "★★★★" = 4
  • Mots-clés : "excellent"/"parfait" = 5, "très bien"/"super" = 4,
                "bien"/"correct" = 3, "passable"/"moyen" = 2, "décevant"/"mauvais" = 1
  • En anglais : "excellent"=5, "very good"=4, "good"=3, "fair"=2, "poor"=1
  • En arabe : "ممتاز"=5, "جيد جداً"=4, "جيد"=3, "مقبول"=2, "سيء"=1
- Si la note est extraite, remplis review.note directement SANS la redemander.
- Si aucune note détectable, demande une note de 1 à 5.

DÉTECTION AUTOMATIQUE DU COMMENTAIRE :
- Si le message contient une description du séjour (> 10 caractères), utilise-la comme commentaire.
- Exemples : "mon séjour était fantastique, le spa est incroyable" → commentaire extrait.
- Si un commentaire est détecté, remplis review.comment directement SANS le redemander.
- Si note ET commentaire sont déjà dans le premier message, mets review_ready = true immédiatement.

FLUX SELON LES CAS :
1. Note + commentaire dans le message → review_ready = true directement.
2. Note dans le message, pas de commentaire → confirme la note, demande un commentaire optionnel.
3. Pas de note → demande la note (1-5), puis commentaire optionnel.
4. Client dit "pas de commentaire" / "sans commentaire" / "non" → review.comment = "" et review_ready = true.

Une fois review_ready = true, NE pose plus de questions — le système enregistre l'avis.
Quand [SYSTÈME] confirme l'enregistrement (INSERT ou UPDATE), remercie chaleureusement.
Si le client modifie un avis existant, informe-le naturellement que son avis a été mis à jour.

Champs à collecter pour l'avis :
- review_note : entier 1-5 ou null
- review_comment : string ou null (optionnel, "" = pas de commentaire)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROCESSUS RÉCLAMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dès que l'intent est "reclamation" :
1. Accueille la réclamation avec empathie et professionnalisme.
2. Demande une description détaillée du problème (si non fournie ou trop courte < 10 chars).
3. Une fois la description obtenue (≥ 10 caractères), mets reclamation_ready = true.
4. Le système ML détectera automatiquement le type — ne demande PAS le type au client.
5. Quand [SYSTÈME] confirme l'enregistrement avec le type détecté, informe le client
   que sa réclamation a été enregistrée et que l'équipe le contactera.

Champs à collecter pour la réclamation :
- reclamation_description : string (minimum 10 caractères) ou null

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROCESSUS DE RÉSERVATION — CONDUITE DE LA CONVERSATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DÉCLENCHEMENT :
- Ne commence JAMAIS à collecter des données de réservation de ta propre initiative.
- Le processus de réservation ne démarre QUE si le client exprime explicitement ou implicitement
  l'intention de réserver.
- Pour tout autre message (salutation, question générale, curiosité), réponds naturellement
  et chaleureusement SANS poser de questions de réservation.

UNE FOIS L'INTENTION CONFIRMÉE :
- Guide le client naturellement, question par question, sans formulaire rigide.
- Pose au maximum 1 à 2 questions à la fois.

Ordre de collecte :
  1. checkInDate, 2. checkOutDate, 3. roomType, 4. adults, 5. children,
  6. pension, 7. paymentDetails, 8. clientName, 9. email, 10. phone

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ÉTAPE RÉCAPITULATIF + MONTANT AVANT CONFIRMATION RÉSERVATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dès que les 10 champs sont collectés :
1. Calcule le montant total.
2. Présente un récapitulatif complet + MONTANT TOTAL + acompte 30%.
3. Demande confirmation explicite avant de valider.
4. La réservation n'est confirmée que sur expression affirmative.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT DE RÉPONSE — OBLIGATOIRE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Retourne UNIQUEMENT un objet JSON valide.
PAS de backticks, PAS de ```json, PAS de texte avant ou après.
La réponse commence EXACTEMENT par { et finit EXACTEMENT par }

Structure JSON :
{
  "reply": "Message affiché au client (string)",
  "intent": "general | reservation | cancellation | avis | reclamation",
  "data": {
    "checkInDate": "YYYY-MM-DD ou null",
    "checkOutDate": "YYYY-MM-DD ou null",
    "roomType": "simple | double | triple | suite_junior | suite_presidentielle | null",
    "adults": entier ou null,
    "children": entier ou null,
    "pension": "Sans pension | Petit-déjeuner | Demi-pension | Pension complète | All inclusive | null",
    "paymentDetails": "Carte bancaire | Virement bancaire | Espèces | null",
    "clientName": "string ou null",
    "email": "string ou null",
    "phone": "string ou null"
  },
  "review": {
    "note": entier 1-5 ou null,
    "comment": "string ou null"
  },
  "reclamation": {
    "description": "string ou null"
  },
  "totalAmount": montant total en euros (nombre) ou null,
  "depositAmount": acompte 30% (nombre) ou null,
  "ready_to_check": true si checkInDate + checkOutDate + roomType + adults sont non-null,
  "ready_to_confirm": true si les 10 champs data sont non-null ET client a confirmé explicitement,
  "review_ready": true si intent=avis ET review.note est non-null ET (review.comment est non-null OU client a dit pas de commentaire),
  "reclamation_ready": true si intent=reclamation ET reclamation.description >= 10 chars
}
"""

# ═══════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════

def parse_bool(val):
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() == "true"
    return bool(val)


def extract_json(raw: str):
    raw = re.sub(r"```json\s*", "", raw)
    raw = re.sub(r"```\s*", "", raw)
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    start = raw.find("{")
    if start == -1:
        return None
    depth = 0
    for i, ch in enumerate(raw[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(raw[start:i+1])
                except json.JSONDecodeError:
                    return None
    return None


def merge_data(current: dict, new_data: dict) -> dict:
    result = dict(current)
    for key in result:
        val = new_data.get(key)
        if val is not None:
            result[key] = val
    return result


def all_data_complete(data: dict) -> bool:
    required = ["checkInDate", "checkOutDate", "roomType", "adults",
                "children", "pension", "paymentDetails", "clientName", "email", "phone"]
    return all(data.get(k) is not None for k in required)


# ── Détection locale de la note (fallback si l'IA rate) ──────────────────────
def extract_note_from_text(text: str):
    """
    Tente d'extraire une note 1-5 depuis le texte brut du client.
    Retourne un entier 1-5 ou None.
    """
    t = text.lower().strip()

    # Étoiles emoji : ⭐⭐⭐ ou ★★★★
    stars = len(re.findall(r'[⭐★]', text))
    if 1 <= stars <= 5:
        return stars

    # Patterns numériques : "4/5", "4 sur 5", "note 4", "4 étoiles", simple "4"
    patterns = [
        r'\b([1-5])\s*/\s*5\b',
        r'\b([1-5])\s+sur\s+5\b',
        r'note\s*[:\-]?\s*([1-5])\b',
        r'\b([1-5])\s+étoile',
        r'\b([1-5])\s+star',
        r'^([1-5])$',
        r'\bnote\s+([1-5])\b',
    ]
    for p in patterns:
        m = re.search(p, t)
        if m:
            return int(m.group(1))

    # Mots-clés multi-langues
    keywords = {
        5: ['excellent', 'parfait', 'exceptionnel', 'fantastique', 'magnifique',
            'perfect', 'outstanding', 'amazing', 'wonderful', 'ممتاز', 'رائع'],
        4: ['très bien', 'super', 'très bon', 'very good', 'great', 'جيد جداً', 'زين'],
        3: ['bien', 'correct', 'satisfait', 'good', 'ok', 'okay', 'جيد', 'بالمعقول'],
        2: ['passable', 'moyen', 'bof', 'fair', 'average', 'مقبول', 'عادي'],
        1: ['décevant', 'mauvais', 'nul', 'terrible', 'poor', 'bad', 'disappointing', 'سيء', 'ردي'],
    }
    for note, words in keywords.items():
        for w in words:
            if w in t:
                return note

    return None


def ask_ai(message, history, current_data, current_review=None, current_reclamation=None):
    context_parts = [f"[DONNÉES RÉSERVATION] : {json.dumps(current_data, ensure_ascii=False)}"]
    if current_review:
        context_parts.append(f"[DONNÉES AVIS] : {json.dumps(current_review, ensure_ascii=False)}")
    if current_reclamation:
        context_parts.append(f"[DONNÉES RÉCLAMATION] : {json.dumps(current_reclamation, ensure_ascii=False)}")
    context = "\n\n" + "\n".join(context_parts)

    messages = list(history[-10:])
    messages.append({"role": "user", "content": message + context})
    raw = ""
    try:
        r = requests.post(
            "http://localhost:11434/api/chat",
            json={
                "model": MODEL,
                "messages": [{"role": "system", "content": SYSTEM_PROMPT}] + messages,
                "stream": False,
                "options": {"temperature": 0.1}
            },
            timeout=60
        )
        raw = r.json().get("message", {}).get("content", "")
        parsed = extract_json(raw)
        if parsed is None:
            raise json.JSONDecodeError("Aucun JSON trouvé", raw, 0)
        return parsed
    except json.JSONDecodeError as e:
        print(f"[JSON ERROR] {e} | raw={raw[:300]}")
        return {
            "reply": "Désolé, une erreur est survenue. Pouvez-vous répéter ?",
            "intent": "general",
            "data": current_data,
            "review": current_review or {"note": None, "comment": None},
            "reclamation": current_reclamation or {"description": None},
            "ready_to_check": False,
            "ready_to_confirm": False,
            "review_ready": False,
            "reclamation_ready": False,
        }
    except Exception as e:
        print(f"[AI ERROR] {e}")
        return {
            "reply": f"Erreur IA : {e}",
            "intent": "general",
            "data": current_data,
            "review": current_review or {"note": None, "comment": None},
            "reclamation": current_reclamation or {"description": None},
            "ready_to_check": False,
            "ready_to_confirm": False,
            "review_ready": False,
            "reclamation_ready": False,
        }


def call_check_availability(data):
    try:
        r = requests.post(
            f"{API_BASE}/check_availability.php",
            json={
                "checkInDate":  data["checkInDate"],
                "checkOutDate": data["checkOutDate"],
                "roomType":     data["roomType"],
                "adults":       data["adults"],
                "children":     data.get("children", 0)
            },
            headers={"Content-Type": "application/json"},
            timeout=60
        )
        return r.json()
    except Exception as e:
        return {"status": "error", "message": str(e)}


def call_make_reservation(login_id, data, room):
    try:
        from datetime import datetime
        nights = (
            datetime.strptime(data["checkOutDate"], "%Y-%m-%d") -
            datetime.strptime(data["checkInDate"],  "%Y-%m-%d")
        ).days
        total = round(float(room.get("price", 0)) * nights, 2)
        r = requests.post(
            f"{API_BASE}/make_reservation.php",
            json={
                "login_id":            login_id,
                "clientName":          data["clientName"],
                "customer_id":         room.get("customer_id", login_id),
                "email":               data["email"],
                "phoneNumber":         data["phone"],
                "checkInDate":         data["checkInDate"],
                "checkOutDate":        data["checkOutDate"],
                "roomType":            data["roomType"],
                "roomNumber":          room.get("roomnumber"),
                "numberOfAdults":      data.get("adults", 1),
                "numberOfChildren":    data.get("children", 0),
                "totalNumberOfPeople": (data.get("adults", 1) or 1) + (data.get("children", 0) or 0),
                "paymentDetails":      data["paymentDetails"],
                "pension":             data["pension"],
                "totalPrice":          total,
                "status":              "confirmed"
            },
            headers={"Content-Type": "application/json"},
            timeout=60
        )
        return r.json()
    except Exception as e:
        return {"status": "error", "message": str(e)}


def call_ml_detect(description: str) -> dict:
    try:
        r = requests.post(
            ML_URL,
            json={"description": description},
            headers={"Content-Type": "application/json"},
            timeout=5
        )
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"[ML ERROR] {e}")
    return {"type": "autre", "confidence": 0.5, "label": "Autre", "fallback": True}


def call_submit_avis(login_id: str, note: int, commentaire: str) -> dict:
    """
    Soumet ou met à jour l'avis du client via avis.php.
    Le PHP gère lui-même le UPSERT (INSERT ou UPDATE selon existence).
    """
    try:
        r = requests.post(
            f"{API_BASE}/avis.php",
            json={
                "action":      "submit",
                "login_id":    login_id,
                "note":        note,
                "commentaire": commentaire or ""
            },
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        # Lire texte brut pour détecter erreur PHP
        raw = r.text
        try:
            return r.json()
        except Exception:
            return {"success": False, "error": f"Réponse serveur invalide : {raw[:200]}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def call_submit_reclamation(login_id: str, description: str, detected_type: str) -> dict:
    try:
        r = requests.get(
            f"{API_BASE}/reclamation.php",
            params={"action": "reservation", "login_id": login_id},
            timeout=10
        )
        resa_data = r.json()
        reservation = resa_data.get("reservation")
        if not reservation:
            return {"success": False, "error": "Aucune réservation éligible pour soumettre une réclamation."}

        r2 = requests.post(
            f"{API_BASE}/reclamation.php",
            json={
                "action":         "submit",
                "login_id":       login_id,
                "reservation_id": reservation["id"],
                "description":    description,
                "type":           detected_type,
                "avis_id":        None
            },
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        return r2.json()
    except Exception as e:
        return {"success": False, "error": str(e)}


def new_session():
    return {
        "history": [],
        "data": {k: None for k in [
            "checkInDate", "checkOutDate", "roomType", "adults",
            "children", "pension", "paymentDetails", "clientName", "email", "phone"
        ]},
        "room": {},
        "availability_checked": False,
        "review": {"note": None, "comment": None},
        "reclamation": {"description": None},
    }


# ═══════════════════════════════════════════════════════════
#  ROUTE PRINCIPALE
# ═══════════════════════════════════════════════════════════

@app.route("/chat", methods=["POST"])
def chat():
    body     = request.json or {}
    message  = body.get("message", "").strip()
    login_id = str(body.get("login_id", "guest"))

    if not message:
        return jsonify({"reply": "Message vide ❌"})

    if login_id not in conversations:
        conversations[login_id] = new_session()

    sess = conversations[login_id]

    # ── 1. Appel IA ──
    ai = ask_ai(
        message,
        sess["history"],
        sess["data"],
        sess["review"],
        sess["reclamation"]
    )

    reply             = ai.get("reply", "...")
    intent            = ai.get("intent", "general")
    ready_check       = parse_bool(ai.get("ready_to_check", False))
    ready_confirm     = parse_bool(ai.get("ready_to_confirm", False))
    review_ready      = parse_bool(ai.get("review_ready", False))
    reclamation_ready = parse_bool(ai.get("reclamation_ready", False))

    sess["data"] = merge_data(sess["data"], ai.get("data") or {})

    # ── Merge review ──────────────────────────────────────────────────────────
    ai_review = ai.get("review") or {}

    # Priorité : valeur retournée par l'IA
    if ai_review.get("note") is not None:
        sess["review"]["note"] = int(ai_review["note"])

    # Fallback : détection locale si l'IA n'a pas extrait la note
    if sess["review"]["note"] is None and intent == "avis":
        detected_note = extract_note_from_text(message)
        if detected_note:
            sess["review"]["note"] = detected_note
            print(f"[NOTE FALLBACK] Détectée localement : {detected_note}")

    # Commentaire : "" accepté (= pas de commentaire)
    ai_comment = ai_review.get("comment")
    if ai_comment is not None:
        sess["review"]["comment"] = ai_comment

    # Si note détectée localement et review_ready pas encore true,
    # vérifier si on peut le passer à true (note + commentaire ou note + "pas de commentaire")
    if (not review_ready
            and intent == "avis"
            and sess["review"]["note"] is not None
            and sess["review"]["comment"] is not None):
        review_ready = True
        print(f"[REVIEW READY FALLBACK] note={sess['review']['note']} comment={sess['review']['comment'][:30]!r}")

    # ── Merge reclamation ──────────────────────────────────────────────────────
    ai_recl = ai.get("reclamation") or {}
    if ai_recl.get("description"):
        sess["reclamation"]["description"] = ai_recl["description"]

    # ── 2. Annulation réservation ──────────────────────────────────────────────
    if intent == "cancellation":
        sess["history"].append({"role": "user",      "content": message})
        sess["history"].append({"role": "assistant", "content": reply})
        conversations[login_id] = new_session()
        return jsonify({"reply": reply, "intent": "cancellation"})

    # ── 3. Traitement AVIS ────────────────────────────────────────────────────
    if intent == "avis" and review_ready and sess["review"]["note"]:
        note        = int(sess["review"]["note"])
        commentaire = sess["review"].get("comment") or ""

        print(f"[AVIS] login_id={login_id} | note={note} | comment={commentaire[:80]!r}")
        res = call_submit_avis(login_id, note, commentaire)
        print(f"[AVIS RESULT] {res}")

        action = res.get("action", "")  # "created" ou "updated"

        if res.get("success"):
            if action == "updated":
                system_msg = (
                    f"[SYSTÈME] Avis mis à jour avec succès : note {note}/5. "
                    f"Informe le client que son avis précédent a bien été modifié "
                    f"et remercie-le chaleureusement."
                )
            else:
                system_msg = (
                    f"[SYSTÈME] Avis enregistré avec succès : note {note}/5. "
                    f"Remercie chaleureusement le client pour son retour et son séjour."
                )
        else:
            err = res.get("error", "inconnue")
            system_msg = (
                f"[SYSTÈME] Impossible d'enregistrer l'avis : {err}. "
                f"Informe le client avec élégance et propose-lui de contacter la réception."
            )

        sess["history"].append({"role": "user",      "content": message})
        sess["history"].append({"role": "assistant", "content": reply})
        ai2   = ask_ai(system_msg, sess["history"], sess["data"], sess["review"], sess["reclamation"])
        reply = ai2.get("reply", reply)

        # Reset review
        sess["review"] = {"note": None, "comment": None}
        sess["history"].append({"role": "user",      "content": system_msg})
        sess["history"].append({"role": "assistant", "content": reply})
        if len(sess["history"]) > 20:
            sess["history"] = sess["history"][-20:]

        return jsonify({"reply": reply, "intent": "avis"})

    # ── 4. Traitement RÉCLAMATION ──────────────────────────────────────────────
    if intent == "reclamation" and reclamation_ready:
        description = sess["reclamation"].get("description", "")
        if description and len(description) >= 10:
            ml_result     = call_ml_detect(description)
            detected_type = ml_result.get("type", "autre")
            type_label    = ml_result.get("label", "Autre")
            confidence    = int(ml_result.get("confidence", 0) * 100)

            print(f"[RECLAMATION] login_id={login_id} | type={detected_type} ({confidence}%) | desc={description[:60]}")
            res = call_submit_reclamation(login_id, description, detected_type)
            print(f"[RECLAMATION RESULT] {res}")

            if res.get("success"):
                system_msg = (
                    f"[SYSTÈME] Réclamation enregistrée avec succès. "
                    f"Type détecté automatiquement : {type_label} ({confidence}% de confiance). "
                    f"Statut : Ouverte. "
                    f"Informe le client que sa réclamation a été enregistrée, "
                    f"mentionne le type détecté de façon naturelle, "
                    f"et assure-le que l'équipe le contactera rapidement."
                )
            else:
                err = res.get("error", "inconnue")
                system_msg = (
                    f"[SYSTÈME] Impossible d'enregistrer la réclamation : {err}. "
                    f"Informe le client avec empathie et propose-lui de contacter la réception "
                    f"au +216 73 681 100 ou par email royal.mansour@iberostar.tn."
                )

            sess["history"].append({"role": "user",      "content": message})
            sess["history"].append({"role": "assistant", "content": reply})
            ai2   = ask_ai(system_msg, sess["history"], sess["data"], sess["review"], sess["reclamation"])
            reply = ai2.get("reply", reply)

            sess["reclamation"] = {"description": None}
            sess["history"].append({"role": "user",      "content": system_msg})
            sess["history"].append({"role": "assistant", "content": reply})
            if len(sess["history"]) > 20:
                sess["history"] = sess["history"][-20:]

            return jsonify({"reply": reply, "intent": "reclamation"})

    # ── 5. Disponibilité ───────────────────────────────────────────────────────
    if ready_check and not sess["availability_checked"]:
        result = call_check_availability(sess["data"])
        sess["availability_checked"] = True

        if result.get("status") == "available":
            rooms = result.get("rooms", [])
            sess["room"] = rooms[0] if rooms else {}
            from datetime import datetime
            try:
                nights = (
                    datetime.strptime(sess["data"]["checkOutDate"], "%Y-%m-%d") -
                    datetime.strptime(sess["data"]["checkInDate"],  "%Y-%m-%d")
                ).days
            except Exception:
                nights = "?"
            msg2 = (
                f"[SYSTÈME] Chambre disponible : n°{sess['room'].get('roomnumber')}, "
                f"{sess['room'].get('price')} DT/nuit, {nights} nuit(s). "
                f"Informe l'utilisateur et continue à collecter les données manquantes."
            )
        elif result.get("status") == "unavailable":
            msg2 = (
                "[SYSTÈME] Aucune chambre disponible pour ces critères. "
                "Informe l'utilisateur et propose d'autres dates ou un autre type de chambre."
            )
            for k in ["checkInDate", "checkOutDate", "roomType"]:
                sess["data"][k] = None
            sess["availability_checked"] = False
        else:
            msg2 = (
                f"[SYSTÈME] Erreur vérification disponibilité : {result.get('message', '?')}. "
                f"Informe l'utilisateur."
            )

        sess["history"].append({"role": "user",      "content": message})
        sess["history"].append({"role": "assistant", "content": reply})

        ai2   = ask_ai(msg2, sess["history"], sess["data"], sess["review"], sess["reclamation"])
        reply = ai2.get("reply", reply)
        sess["data"] = merge_data(sess["data"], ai2.get("data") or {})

        sess["history"].append({"role": "user",      "content": msg2})
        sess["history"].append({"role": "assistant", "content": reply})
        if len(sess["history"]) > 20:
            sess["history"] = sess["history"][-20:]

        return jsonify({"reply": reply, "intent": intent, "data": sess["data"]})

    # ── 6. Confirmation réservation ───────────────────────────────────────────
    if ready_confirm and sess["room"] and all_data_complete(sess["data"]):
        print(f"[CONFIRM] login_id={login_id} | data={json.dumps(sess['data'], ensure_ascii=False)}")

        res = call_make_reservation(login_id, sess["data"], sess["room"])
        print(f"[RESERVATION RESULT] {res}")

        if res.get("status") == "success":
            ref = res.get("reservation_id", res.get("id", "N/A"))

            email_res = send_confirmation_email(
                data=sess["data"],
                room=sess["room"],
                reservation_id=ref
            )

            if email_res.get("success"):
                system_msg = (
                    f"[SYSTÈME] Réservation #{ref} confirmée avec succès. "
                    f"Email envoyé à {sess['data']['email']}. "
                    f"Annonce la confirmation et la référence #{ref} à l'utilisateur."
                )
            else:
                system_msg = (
                    f"[SYSTÈME] Réservation #{ref} confirmée. "
                    f"Email non envoyé ({email_res.get('error', '?')}). "
                    f"Confirme la réservation avec la référence #{ref} "
                    f"et dis à l'utilisateur de contacter la réception pour son reçu."
                )
                print(f"[EMAIL] ⚠️  Échec : {email_res.get('error')}")

            sess["history"].append({"role": "user",      "content": message})
            sess["history"].append({"role": "assistant", "content": reply})
            ai3   = ask_ai(system_msg, sess["history"], sess["data"], sess["review"], sess["reclamation"])
            reply = ai3.get("reply", reply)

            conversations[login_id] = new_session()
            return jsonify({"reply": reply, "intent": "confirmed"})

        else:
            system_msg = (
                f"[SYSTÈME] Erreur lors de l'enregistrement : {res.get('message', 'inconnue')}. "
                f"Informe l'utilisateur et propose de réessayer."
            )
            sess["history"].append({"role": "user",      "content": message})
            sess["history"].append({"role": "assistant", "content": reply})
            ai3   = ask_ai(system_msg, sess["history"], sess["data"], sess["review"], sess["reclamation"])
            reply = ai3.get("reply", reply)
            sess["history"].append({"role": "user",      "content": system_msg})
            sess["history"].append({"role": "assistant", "content": reply})
            if len(sess["history"]) > 20:
                sess["history"] = sess["history"][-20:]
            return jsonify({"reply": reply, "intent": "error", "data": sess["data"]})

    # ── 7. Historique normal ───────────────────────────────────────────────────
    sess["history"].append({"role": "user",      "content": message})
    sess["history"].append({"role": "assistant", "content": reply})
    if len(sess["history"]) > 20:
        sess["history"] = sess["history"][-20:]

    return jsonify({"reply": reply, "intent": intent, "data": sess["data"]})


@app.route("/reset", methods=["POST"])
def reset():
    login_id = str((request.json or {}).get("login_id", "guest"))
    conversations.pop(login_id, None)
    return jsonify({"status": "ok"})


@app.route("/debug/<login_id>", methods=["GET"])
def debug(login_id):
    sess = conversations.get(login_id)
    if not sess:
        return jsonify({"error": "Session introuvable"})
    return jsonify({
        "data":                 sess["data"],
        "room":                 sess["room"],
        "review":               sess["review"],
        "reclamation":          sess["reclamation"],
        "availability_checked": sess["availability_checked"],
        "history_length":       len(sess["history"]),
        "all_data_complete":    all_data_complete(sess["data"])
    })


if __name__ == "__main__":
    print("🏨 Chatbot Hôtel v7 (avis auto-detect + UPSERT) — http://127.0.0.1:5000")
    app.run(debug=True, host="0.0.0.0", port=5000)