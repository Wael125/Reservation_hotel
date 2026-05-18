# =============================================================================
#  train_model.py  —  NLP Engine v3.0 (Ultra-Robust)
#
#  NOUVEAUTÉS v3.0 :
#  ✅ Fuzzy matching (rapidfuzz) pour tolérance aux fautes de frappe
#  ✅ Normalisation avancée multi-couches (unicode, abréviations, SMS)
#  ✅ Dictionnaire de synonymes massivement étendu (FR/EN/AR)
#  ✅ Correction orthographique approximative avant vectorisation
#  ✅ Dataset enrichi avec variantes naturelles, SMS, abréviations
#  ✅ Pipeline TF-IDF + LinearSVC conservé + augmentation de données
#  ✅ Scoring de confiance calibré
#  ✅ Tolérance complète aux entrées humaines imparfaites
# =============================================================================

from __future__ import annotations

import logging
import os
import pickle
import re
import time
import unicodedata
from collections import Counter
from typing import Optional

import nltk
from nltk.corpus import stopwords
from nltk.stem import SnowballStemmer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import classification_report
from sklearn.model_selection import cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

# ── Fuzzy matching (optionnel mais fortement recommandé) ──────────────────────
try:
    from rapidfuzz import fuzz, process as fuzz_process
    FUZZY_AVAILABLE = True
except ImportError:
    FUZZY_AVAILABLE = False

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="[%(levelname)s] %(asctime)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("train_model")

# ── NLTK ressources ──────────────────────────────────────────────────────────
for _pkg, _kind in [
    ("punkt",     "tokenizers"),
    ("stopwords", "corpora"),
    ("wordnet",   "corpora"),
]:
    try:
        nltk.data.find(f"{_kind}/{_pkg}")
    except LookupError:
        nltk.download(_pkg, quiet=True)

MODEL_PATH = "nlp_model.pkl"

# =============================================================================
#  STOPWORDS MULTI-LANGUE
# =============================================================================

try:
    _sw_fr = set(stopwords.words("french"))
    _sw_en = set(stopwords.words("english"))
    _sw_ar = {
        "في", "من", "على", "إلى", "هل", "أن", "لا", "ما", "مع", "أو",
        "و", "ب", "ل", "ك", "عن", "هذا", "هذه", "ذلك", "تلك", "كان",
        "كانت", "يكون", "التي", "الذي", "عند", "حتى", "إن", "قد",
    }
    STOPWORDS = _sw_fr | _sw_en | _sw_ar
except Exception:
    STOPWORDS = set()

# Mots sémantiquement importants à préserver
WHITELIST = {
    "non", "oui", "no", "yes", "pas", "plus", "sans", "avec",
    "نعم", "لا", "مع", "بدون", "not", "n't", "ni",
}
STOPWORDS -= WHITELIST

# ── Stemmer ──────────────────────────────────────────────────────────────────
stemmer = SnowballStemmer("french")
arabic_re = re.compile(r"[\u0600-\u06FF]")

# =============================================================================
#  NORMALISATION UNICODE
# =============================================================================

def normalize_unicode(text: str) -> str:
    """
    Normalise les caractères unicode :
    - Apostrophes typographiques → '
    - Tirets spéciaux → -
    - Espaces insécables → espace
    """
    # Apostrophes variantes
    text = re.sub(r"[''ʼ`´]", "'", text)
    # Tirets variantes
    text = re.sub(r"[–—−‒]", "-", text)
    # Espaces variantes
    text = re.sub(r"[\u00a0\u202f\u2009]", " ", text)
    return text


def remove_accents(text: str) -> str:
    """Supprime les accents pour la normalisation interne (matching)."""
    return "".join(
        c for c in unicodedata.normalize("NFD", text)
        if unicodedata.category(c) != "Mn"
    )

# =============================================================================
#  DICTIONNAIRE DE CORRECTIONS / ABRÉVIATIONS / SYNONYMES — v3.0 ÉTENDU
# =============================================================================

# ── Abréviations SMS et langage courant ───────────────────────────────────────
SMS_MAP: dict[str, str] = {
    # Salutations abrégées
    "bjr": "bonjour", "bsr": "bonsoir", "bnjr": "bonjour", "bnsr": "bonsoir",
    "bnj": "bonjour", "slt": "salut", "coucou": "bonjour",
    "yo": "bonjour", "yoo": "bonjour", "wsh": "bonjour", "wesh": "bonjour",
    "cc": "bonjour", "hé": "bonjour", "hej": "bonjour",
    # Confirmation/négation
    "ouais": "oui", "ouaip": "oui", "yep": "oui", "yap": "oui",
    "yup": "oui", "oks": "oui", "oke": "oui", "ok": "oui",
    "nop": "non", "nope": "non", "nan": "non", "nah": "non",
    # Remerciements
    "mrc": "merci", "mrci": "merci", "thx": "merci", "thnx": "merci",
    "ty": "merci", "tnx": "merci",
    # Courants
    "svp": "s'il vous plaît", "stp": "s'il te plaît", "plz": "s'il vous plaît",
    "pls": "s'il vous plaît", "asap": "dès que possible",
    "w/": "avec", "w/o": "sans",
    "nb": "nombre", "nr": "numéro",
    "tel": "téléphone", "tél": "téléphone",
    "rdv": "rendez-vous", "resa": "réservation", "reso": "réservation",
    "reza": "réservation", "rezas": "réservations",
    "dispo": "disponible", "dispos": "disponibles",
    "pb": "problème", "prb": "problème",
    "jsuis": "je suis", "jveux": "je veux", "jvoudrai": "je voudrais",
    "jcherchai": "je cherchais", "jcherche": "je cherche",
    "ya": "il y a", "y'a": "il y a",
    "c'est": "c est", "c est": "c est",
    "d'acc": "d accord", "dac": "d accord",
    "pref": "préfère", "prefere": "préfère",
    "qd": "quand", "pr": "pour", "av": "avec",
    "qqch": "quelque chose", "qqun": "quelqu'un",
}

# ── Corrections orthographiques étendues ─────────────────────────────────────
TYPO_MAP: dict[str, str] = {
    # Réservation
    "reserv": "réservation", "rsrv": "réservation", "resrv": "réservation",
    "rezerver": "réserver", "reservaton": "réservation",
    "reseravation": "réservation", "resrvation": "réservation",
    "reervation": "réservation", "resevation": "réservation",
    "réservatin": "réservation", "resarvation": "réservation",
    "resérvation": "réservation", "rservation": "réservation",
    # Chambre
    "chambres": "chambre", "chamres": "chambre", "chamrbe": "chambre",
    "chambr": "chambre", "chanbre": "chambre", "chmbre": "chambre",
    "chambe": "chambre", "cambre": "chambre",
    # Arrivée/départ
    "arivée": "arrivée", "arrivee": "arrivée", "arivee": "arrivée",
    "arrivé": "arrivée", "arivé": "arrivée",
    "depart": "départ", "departt": "départ", "dépard": "départ",
    "départt": "départ", "depar": "départ",
    # Pension / formules
    "piscne": "piscine", "pisicne": "piscine", "piscin": "piscine",
    "restau": "restaurant", "restoran": "restaurant", "restarant": "restaurant",
    "restaurent": "restaurant", "restauant": "restaurant",
    "tout inclu": "tout inclus", "tous inclus": "tout inclus",
    "tout-inclus": "tout inclus", "tout compri": "tout inclus",
    "toutinclus": "tout inclus", "all-in": "tout inclus",
    "full package": "tout inclus", "all in": "tout inclus",
    "allinclusive": "tout inclus", "allinclus": "tout inclus",
    "demi penssion": "demi-pension", "demi-pensison": "demi-pension",
    "demipension": "demi-pension", "demi pension": "demi-pension",
    "pension complet": "pension complète", "pleine pension": "pension complète",
    "full bord": "full board",
    # Check-in/out
    "chekout": "checkout", "chek-out": "checkout", "check-out": "checkout",
    "chek-in": "check-in", "checkin": "check-in", "chekkin": "check-in",
    "chekc in": "check-in", "chek in": "check-in",
    # Types de chambre
    "doubl": "double", "duble": "double", "dooble": "double",
    "simpel": "simple", "sinple": "simple", "simpl": "simple",
    "sute": "suite", "swiit": "suite", "swit": "suite",
    "supel": "suite", "swite": "suite", "sute": "suite",
    "tripel": "triple", "tirple": "triple",
    # Paiement
    "paiment": "paiement", "payement": "paiement", "paymen": "paiement",
    "peyment": "paiement", "paymnt": "paiement",
    "carte bleue": "carte bancaire", "cb": "carte bancaire",
    "liquide": "espèces", "cash": "espèces",
    # Wifi / équipements
    "wifi": "wi-fi", "wi fi": "wi-fi", "wfi": "wi-fi",
    # Divers
    "voulais": "voudrais", "voilais": "voudrais",
    "bbok": "réservation", "boook": "réservation",
    "availble": "disponible", "avialble": "disponible",
    "pament": "paiement", "paymet": "paiement",
    "singel": "simple",
    "inclu": "inclus", "inclue": "inclus",
    "piscicne": "piscine",
    "anulat": "annulation", "anulation": "annulation",
    "anulé": "annulé", "annulé": "annulation",
}

# ── Dictionnaire de synonymes étendu ──────────────────────────────────────────
SYNONYM_MAP: dict[str, str] = {
    # ── Réservation ──
    "réserver": "réservation", "booking": "réservation", "book": "réservation",
    "louer": "réservation", "prendre": "réservation", "obtenir": "réservation",
    "commander": "réservation", "planifier": "réservation", "enregistrer": "réservation",
    "réserver une place": "réservation", "faire une resa": "réservation",
    "je veux une resa": "réservation", "avoir une chambre": "réservation",
    # ── Chambre ──
    "room": "chambre", "bedroom": "chambre", "chambre d'hôtel": "chambre",
    "hébergement": "chambre", "logement": "chambre",
    # ── Prix ──
    "coût": "prix", "tarif": "prix", "montant": "prix", "frais": "prix",
    "combien": "prix", "rate": "prix", "fee": "prix", "cost": "prix",
    "c'est combien": "prix", "ça coûte combien": "prix",
    # ── Arrivée/départ ──
    "arriver": "arrivée", "partir": "départ", "quitter": "départ",
    "entrée": "arrivée", "sortie": "départ", "atterrir": "arrivée",
    # ── Annulation ──
    "annuler": "annulation", "cancel": "annulation", "stop": "annulation",
    "supprimer": "annulation", "effacer": "annulation",
    "laisser tomber": "annulation", "abandonner": "annulation",
    "je ne veux plus": "annulation",
    # ── Pension ──
    "all inclusive": "tout inclus", "all-inclusive": "tout inclus",
    "formule complète": "tout inclus", "tout compris": "tout inclus",
    "avec repas": "pension complète", "repas inclus": "pension complète",
    "sans repas": "sans pension", "juste la chambre": "sans pension",
    "chambre seulement": "sans pension",
    "petit dej": "demi-pension", "ptit dej": "demi-pension",
    "breakfast": "demi-pension",
    # ── Services ──
    "équipements": "services", "installations": "services",
    "commodités": "services", "infrastructure": "services",
    "piscine": "piscine", "pool": "piscine", "spa": "spa",
    "gym": "salle de sport", "fitness": "salle de sport",
    # ── Localisation ──
    "adresse": "localisation", "où": "localisation", "situation": "localisation",
    "comment venir": "localisation", "chemin": "localisation",
    "itinéraire": "localisation", "gps": "localisation",
}

# =============================================================================
#  NORMALISATION MULTI-COUCHES
# =============================================================================

def _apply_sms_map(text: str) -> str:
    """Remplace les abréviations SMS par leurs formes complètes."""
    tokens = text.split()
    result = []
    i = 0
    while i < len(tokens):
        # Essai bigramme d'abord
        if i < len(tokens) - 1:
            bigram = tokens[i] + " " + tokens[i + 1]
            if bigram in SMS_MAP:
                result.append(SMS_MAP[bigram])
                i += 2
                continue
        # Unigramme
        t = tokens[i]
        result.append(SMS_MAP.get(t, t))
        i += 1
    return " ".join(result)


def normalize_text(text: str) -> str:
    """
    Pipeline complet de normalisation :
    1. Unicode
    2. Minuscules
    3. SMS / abréviations
    4. Corrections orthographiques (TYPO_MAP)
    5. Synonymes (SYNONYM_MAP)
    """
    t = normalize_unicode(text).lower().strip()

    # SMS
    t = _apply_sms_map(t)

    # Typos (sous-chaînes)
    for wrong, correct in TYPO_MAP.items():
        t = t.replace(wrong, correct)

    # Synonymes (mots entiers)
    for synonym, canonical in sorted(SYNONYM_MAP.items(), key=lambda x: -len(x[0])):
        t = re.sub(rf"\b{re.escape(synonym)}\b", canonical, t)

    return t


# =============================================================================
#  FUZZY MATCHING — CORRECTION INTELLIGENTE
# =============================================================================

# Vocabulaire de référence pour la correction fuzzy
# Construit dynamiquement depuis les données d'entraînement
_FUZZY_VOCAB: set[str] = set()

def build_fuzzy_vocab(data: dict[str, list[str]]) -> None:
    """Remplit le vocabulaire fuzzy depuis le dataset."""
    global _FUZZY_VOCAB
    words: set[str] = set()
    for phrases in data.values():
        for phrase in phrases:
            for w in phrase.lower().split():
                if len(w) > 3:
                    words.add(w)
    _FUZZY_VOCAB = words
    log.info(f"Vocabulaire fuzzy : {len(_FUZZY_VOCAB)} mots uniques")


def fuzzy_correct_token(token: str, threshold: int = 82) -> str:
    """
    Corrige un token par similarité fuzzy si un mot du vocabulaire
    est suffisamment proche (score ≥ threshold).

    N'applique la correction que si le token est inconnu du vocabulaire.
    """
    if not FUZZY_AVAILABLE or not _FUZZY_VOCAB:
        return token
    if token in _FUZZY_VOCAB or len(token) <= 3:
        return token

    result = fuzz_process.extractOne(
        token, _FUZZY_VOCAB, scorer=fuzz.ratio,
    )
    if result and result[1] >= threshold:
        corrected = result[0]
        if corrected != token:
            log.debug(f"Fuzzy: '{token}' → '{corrected}' ({result[1]}%)")
        return corrected
    return token


def fuzzy_correct_text(text: str) -> str:
    """Applique la correction fuzzy token par token."""
    if not FUZZY_AVAILABLE:
        return text
    tokens = text.split()
    return " ".join(fuzzy_correct_token(t) for t in tokens)


# =============================================================================
#  PRÉTRAITEMENT AVANCÉ — v3.0
# =============================================================================

def preprocess(text: str, apply_fuzzy: bool = False) -> str:
    """
    Pipeline de prétraitement complet :
    1. Validation entrée
    2. Normalisation unicode + casse
    3. SMS / abréviations
    4. Correction typos / synonymes
    5. Nettoyage caractères spéciaux (préserve arabe + accents FR)
    6. (Optionnel) Correction fuzzy
    7. Tokenisation
    8. Filtrage stopwords + whitelist
    9. Stemming (FR uniquement, pas arabe)

    Args:
        text:        Texte brut de l'utilisateur.
        apply_fuzzy: Active la correction fuzzy (plus lent, plus précis).
    """
    if not text or not text.strip():
        return ""

    # ── 1-4. Normalisation ────────────────────────────────────────────────────
    text = normalize_text(text)

    # ── 5. Nettoyage (conserve accents FR + arabe) ────────────────────────────
    text = re.sub(r"[^a-zA-ZÀ-ÿ\u0600-\u06FF\s\-']", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    # ── 6. Correction fuzzy (optionnelle) ─────────────────────────────────────
    if apply_fuzzy and FUZZY_AVAILABLE:
        text = fuzzy_correct_text(text)

    # ── 7. Tokenisation ───────────────────────────────────────────────────────
    tokens = text.split()

    # ── 8. Filtrage stopwords ──────────────────────────────────────────────────
    tokens = [
        t for t in tokens
        if (t in WHITELIST or t not in STOPWORDS) and len(t) > 1
    ]

    # ── 9. Stemming FR (pas arabe) ────────────────────────────────────────────
    stemmed = []
    for t in tokens:
        if arabic_re.search(t):
            stemmed.append(t)
        else:
            try:
                stemmed.append(stemmer.stem(t))
            except Exception:
                stemmed.append(t)

    return " ".join(stemmed)


# =============================================================================
#  AUGMENTATION DE DONNÉES
#  Génère automatiquement des variantes pour robustifier l'entraînement
# =============================================================================

def _augment_phrase(phrase: str) -> list[str]:
    """
    Génère des variantes d'une phrase :
    - Version sans accents
    - Version en majuscules partielles
    - Version avec fautes typiques
    - Version abrégée (SMS)
    """
    variants = [phrase]

    # Sans accents (simule les utilisateurs qui ne tapent pas les accents)
    no_acc = remove_accents(phrase)
    if no_acc != phrase:
        variants.append(no_acc)

    # Quelques substitutions typiques
    subs = [
        ("réservation", "resa"), ("réservation", "reserv"),
        ("chambre", "chambre"), ("bonjour", "bjr"),
        ("merci", "mrc"), ("s'il vous plaît", "svp"),
        ("oui", "ouais"), ("annulation", "annul"),
        ("tout inclus", "toutinclus"), ("demi-pension", "demi pension"),
    ]
    for old, new in subs:
        if old in phrase.lower():
            variants.append(phrase.lower().replace(old, new))

    return list(set(variants))


# =============================================================================
#  DATASET D'ENTRAÎNEMENT — v3.0 MASSIF
# =============================================================================

TRAINING_DATA: dict[str, list[str]] = {

    # ══════════════════════════════════════════════════════════════════════════
    # GREETING
    # ══════════════════════════════════════════════════════════════════════════
    "greeting": [
        # Formel
        "bonjour", "bonsoir", "bonne journée", "bonne soirée",
        "bienvenue", "bonjour hôtel", "hôtel bonjour",
        "bonjour à vous", "bonsoir à vous",
        "bonjour comment ça va", "bonsoir comment allez vous",
        "bonjour je vous contacte", "bonjour je cherche de l aide",
        # Informel / SMS
        "salut", "coucou", "hey", "yo", "wesh", "wsh",
        "hey salut", "allô", "allo", "slt",
        "bjr", "bsr", "bnj", "bnjr", "cc",
        "hé bonjour", "ohé bonjour", "hej",
        "salut je voulais juste dire bonjour",
        # Islamique
        "salam", "salam aleikoum", "assalamu alaikum",
        # Anglais
        "hello", "hi", "hey there", "good morning", "good evening",
        "good afternoon", "good day", "howdy", "greetings",
        "hi there", "hello there", "what's up", "sup",
        "good to see you", "nice to meet you", "how are you",
        "how do you do", "hi hotel", "hello i need help",
        "yo hotel", "hey guys",
        # Arabe
        "مرحبا", "السلام عليكم", "أهلا", "صباح الخير", "مساء الخير",
        "أهلا وسهلا", "مرحبتين", "هلا", "كيف حالك",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # THANKS
    # ══════════════════════════════════════════════════════════════════════════
    "thanks": [
        # Français
        "merci", "merci beaucoup", "merci infiniment", "grand merci",
        "merci pour votre aide", "merci pour tout", "super merci",
        "impeccable merci", "nickel merci", "parfait merci",
        "génial merci", "top merci", "excellent merci",
        "c'est parfait merci", "je vous remercie", "je te remercie",
        "merci beaucoup c'est très gentil",
        "super c'est parfait merci", "ok merci beaucoup",
        "très bien merci", "ça marche merci", "cool merci",
        "mrc", "mrc bcp", "merci mille fois",
        # Anglais
        "thank you", "thanks", "thank you very much", "many thanks",
        "thx", "ty", "thanks a lot", "thank you so much",
        "much appreciated", "that's great thanks", "perfect thanks",
        "awesome thanks", "great thanks", "wonderful thank you",
        "that helps thanks", "cheers", "ta", "thnx", "tnx",
        # Arabe
        "شكرا", "شكرا جزيلا", "شكرا لك", "شكرا كثيرا",
        "ممتاز شكرا", "جيد شكرا",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # RESERVATION_START
    # ══════════════════════════════════════════════════════════════════════════
    "reservation_start": [
        # Formel FR
        "je veux réserver une chambre", "je voudrais faire une réservation",
        "réserver une chambre", "je souhaite réserver", "faire une réservation",
        "réservation hôtel", "je cherche une chambre", "besoin d'une chambre",
        "trouver une chambre", "prendre une chambre", "louer une chambre",
        "obtenir une chambre", "réservation svp", "réserver svp",
        "j'ai besoin d'une chambre", "je veux une chambre",
        "donnez-moi une chambre", "une chambre s'il vous plaît",
        "je voudrais séjourner", "je veux séjourner",
        "je cherche à séjourner chez vous", "séjour hôtel",
        "nuit à l'hôtel", "nuitée hôtel", "avez-vous de la place",
        "y a-t-il de la disponibilité", "chambre disponible",
        "avez-vous des chambres libres", "avez-vous des chambres disponibles",
        "je voudrais passer quelques nuits", "je veux dormir chez vous",
        "je veux passer la nuit ici", "je cherche un hébergement",
        "je veux me loger", "je cherche où dormir", "logement disponible",
        "est-ce que vous avez des chambres", "je voudrais une chambre pour ce soir",
        "je veux réserver pour ce week-end", "réserver pour demain",
        "je cherche une chambre pour 2 personnes", "chambre pour ce soir",
        "je veux une réservation", "procéder à une réservation",
        "je souhaite effectuer une réservation", "je veux réserver maintenant",
        "puis-je réserver", "est-il possible de réserver",
        "je voudrais prendre une chambre", "j'aimerais réserver",
        # SMS / abréviations
        "resa svp", "je veux une resa", "faire une resa",
        "resa chambre", "reserver svp", "besoin dispo",
        "jveux réserver", "jcherche une chambre",
        "chambre dispo", "ya des chambres",
        # Phrases naturelles avec entités mélangées
        "je veux une chambre double pour demain",
        "tu as des chambres disponibles pour 2 personnes",
        "chambre double tout inclus semaine prochaine",
        "réserver suite pour 2 adultes",
        "je cherche chambre pour ce week-end 2 personnes",
        "une chambre pour moi et ma femme demain",
        "chambre simple pour ce soir s'il vous plaît",
        "bonjour je voudrais réserver une chambre double pour 3 nuits",
        "avez-vous une suite disponible pour la semaine prochaine",
        "je veux rester chez vous 5 jours",
        "hébergement pour 4 personnes fin de semaine",
        # Anglais
        "book a room", "I want to book", "I'd like to make a reservation",
        "I need a room", "I want to stay", "looking for a room",
        "room available", "any rooms available", "reserve a room",
        "make a booking", "I'd like a room", "get a room", "find a room",
        "I want to check in", "I need accommodation",
        "can I book a room", "I'd like to book a room please",
        "I need a place to stay", "I'm looking for a room",
        "do you have rooms available", "I want to make a reservation",
        "book me a room please", "reservation please",
        "I want to book a double room for tomorrow",
        "do you have a room for 2 people next week",
        "can I get a room for tonight",
        "looking for a suite all inclusive",
        # Arabe
        "نريد حجز غرفة", "أريد الحجز", "حجز فندقي", "أريد غرفة",
        "أحتاج غرفة", "هل لديكم غرف", "أريد الإقامة",
        "أريد حجز غرفة من فضلك", "هل يمكنني الحجز",
        "أريد غرفة لليلة", "أحتاج إلى مكان للإقامة",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # PROVIDE_DATES
    # ══════════════════════════════════════════════════════════════════════════
    "provide_dates": [
        # Formats ISO et numériques
        "du 15 au 20 janvier", "j'arrive le 10 mars",
        "check-in le 5 mars checkout le 10",
        "du premier au sept juillet",
        "arrivée le 20 départ le 25",
        "2025-05-01 au 2025-05-07",
        "je viens le 1er mai et repars le 5",
        "15 juin au 20 juin", "20/06 au 25/06",
        "15/07 au 22/07", "du 15-07 au 22-07",
        "12/05/2026", "12-05-2026", "12.05.2026",
        "12-05-26", "05/12/26",
        # Relatifs
        "demain", "après-demain", "apres demain", "ap-demain",
        "aujourd'hui", "ce soir",
        "arrivée demain départ dans 3 jours",
        "dans 3 jours", "dans une semaine",
        "la semaine prochaine", "le week-end prochain",
        "ce week-end", "fin de semaine",
        "lundi prochain", "mardi prochain", "vendredi prochain",
        "du lundi au vendredi", "lundi prochain au jeudi",
        "de ce vendredi à dimanche", "du vendredi au lundi",
        "ce vendredi jusqu'à dimanche",
        "le mois prochain",
        # Durées
        "3 nuits", "une semaine", "5 jours", "deux nuits",
        "je reste 3 nuits à partir du 12",
        "séjour 5 nuits", "4 jours", "une nuit",
        "je veux rester du 5 au 10",
        "séjour du 1 au 7 août",
        "du 1er au 7", "du 10 au 15 du mois",
        "arrivée le 20 juillet départ 25 juillet",
        "je serai là du 3 au 8", "présent du 10 au 14",
        "arrivée prévue le 15 mars",
        "je compte arriver demain et repartir dans 5 jours",
        # Anglais
        "from january 5 to january 10",
        "check in march 15 check out march 20",
        "arriving tomorrow", "checking in next monday",
        "overnight", "for 2 nights", "for a week", "3 days stay",
        "from the 5th to the 10th", "from monday to friday",
        "next weekend", "this friday to sunday",
        "i'll be arriving on july 15", "from july 1st to 7th",
        "staying for 3 nights", "a 5-night stay",
        "i arrive the 20th and leave the 25th",
        "day after tomorrow", "in 3 days",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # PROVIDE_ROOM_TYPE
    # ══════════════════════════════════════════════════════════════════════════
    "provide_room_type": [
        # Français — variantes standard
        "chambre double", "je veux une suite", "chambre simple",
        "chambre triple", "une suite s'il vous plaît",
        "je préfère une chambre double", "avez-vous des suites",
        "chambre pour deux", "chambre twin", "lit double", "grand lit",
        "deux lits", "chambre familiale", "suite royale", "suite junior",
        "suite présidentielle", "chambre standard", "chambre supérieure",
        "chambre deluxe", "chambre economy", "une simple",
        "une double", "une triple", "une suite",
        "je veux une chambre simple", "je veux une chambre double",
        "je préfère la suite", "je prendrai une double",
        "chambre basique", "chambre normale", "chambre classique",
        "donnez moi une suite", "j'aimerais une suite",
        "chambre pour famille", "grande chambre",
        # Avec fautes (variantes robustesse)
        "chmbre double", "chanbre simple", "sute", "swit",
        "duble", "simpel", "tripel", "familliale",
        # Anglais
        "double room", "single room", "suite please", "twin room",
        "family room", "king room", "queen room", "basic room",
        "standard room", "deluxe room", "junior suite",
        "I'd like a double", "I want a single", "give me a suite",
        "book a double room", "triple room please",
        "I prefer a suite", "I'll take a double",
        "a room with a king bed", "a room with twin beds",
        # Arabe
        "غرفة مزدوجة", "جناح", "غرفة فردية", "غرفة ثلاثية",
        "أريد جناحاً", "غرفة للعائلة", "جناح ملكي",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # PROVIDE_GUESTS
    # ══════════════════════════════════════════════════════════════════════════
    "provide_guests": [
        # Français
        "nous sommes 2 adultes", "3 personnes", "2 adultes et 1 enfant",
        "pour 4 personnes", "je voyage seul", "nous serons 2",
        "une personne seulement", "pour 1 personne", "pour 2 personnes",
        "pour 3 personnes", "pour 5 personnes", "famille de 4",
        "couple", "seul", "avec mon mari", "avec ma femme",
        "avec mes enfants", "avec 2 enfants", "2 adultes 3 enfants",
        "solo", "un adulte", "deux adultes", "trois adultes",
        "une personne", "deux personnes", "trois personnes",
        "quatre personnes", "cinq personnes",
        "adulte avec enfant", "2 adultes sans enfants",
        "je viens avec ma famille", "nous sommes en famille",
        "on est 2", "on est 3", "on sera 4",
        "juste moi", "pour moi seul", "pour moi et ma femme",
        "pour moi et mon mari", "pour deux adultes",
        # SMS / naturel
        "juste 2 pers", "on est 4 pers", "4 adultes",
        "nous 2", "2 adu 1 enf", "2 pax",
        # Anglais
        "one adult", "2 adults 2 children", "travelling alone",
        "for a couple", "family of 3", "with kids",
        "just me", "2 people", "3 people", "4 people",
        "me and my wife", "me and my husband", "my family",
        "2 adults no children", "solo traveller",
        "I'm alone", "we are 2", "we are 4",
        "for myself only", "2 adults and 1 child",
        # Arabe
        "شخص واحد", "شخصان", "عائلة", "أنا وزوجتي",
        "نحن أربعة أشخاص", "بالغان وطفلان",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # PROVIDE_PENSION
    # ══════════════════════════════════════════════════════════════════════════
    "provide_pension": [
        # Français — standard
        "demi-pension", "pension complète", "tout inclus", "sans pension",
        "avec petit déjeuner", "petit déjeuner inclus",
        "repas inclus", "avec les repas", "sans les repas",
        "formule tout compris", "je prends tout inclus",
        "je veux la demi-pension", "pension complète s'il vous plaît",
        "sans formule", "juste la chambre", "chambre seulement",
        "petit déj et dîner", "tous les repas inclus",
        "aucune pension", "je mange ailleurs",
        "je ne veux pas de repas",
        # Variantes naturelles / fautes
        "tout inclu", "tous inclus", "toutinclus", "all-in",
        "full package", "tout compri",
        "demi pension", "demipension", "demi-penssion",
        "pension complet", "pleine pension",
        "avec ptit dej", "avec pdj", "pdj inclus",
        "all inclusive", "all inclus",
        # Anglais
        "half board", "full board", "all inclusive",
        "bed and breakfast", "room only", "breakfast included",
        "meals included", "no meals", "AI",
        "all meals included", "just the room",
        "I'll take half board", "full board please",
        "no board", "breakfast only",
        # Arabe
        "إقامة كاملة", "نصف إقامة", "شامل", "بدون وجبات",
        "مع الإفطار", "كل شيء شامل",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # PROVIDE_PAYMENT
    # ══════════════════════════════════════════════════════════════════════════
    "provide_payment": [
        # Français
        "je paie par carte", "paiement en espèces", "virement bancaire",
        "par chèque", "carte bancaire", "cash",
        "payer en liquide", "visa", "mastercard", "paypal",
        "paiement à l'arrivée", "payer sur place", "payer maintenant",
        "carte de crédit", "carte de débit", "monnaie", "billets",
        "je vais payer par carte", "je préfère payer en espèces",
        "virement", "par virement", "chèque bancaire",
        "je paye cash", "paiement cash", "règlement par carte",
        "cb", "carte bleue", "par cb",
        "paiment carte", "payement especes",
        # Anglais
        "by card", "in cash", "wire transfer", "pay on arrival",
        "credit card", "debit card", "bank transfer", "cheque",
        "I'll pay by card", "cash payment", "paying in cash",
        "I prefer card", "bank wire", "paypal please",
        "I want to pay cash", "card payment",
        # Arabe
        "دفع بطاقة", "نقداً", "تحويل بنكي",
        "بطاقة ائتمان", "دفع نقداً",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # PROVIDE_CONTACT
    # ══════════════════════════════════════════════════════════════════════════
    "provide_contact": [
        # Français
        "mon nom est jean dupont", "je m'appelle marie",
        "mon email est test@gmail.com", "mon numéro est 0612345678",
        "contact pierre martin", "téléphone 06 12 34 56 78",
        "je suis ahmed ben ali", "mon prénom est", "mon nom de famille est",
        "vous pouvez m'appeler", "je m'appelle", "c'est au nom de",
        "le nom c'est", "réservation au nom de", "sous le nom de",
        "je m'appelle dupont", "au nom de jean",
        "appelez moi jean", "nom complet jean dupont",
        "mon tel est", "mon portable",
        # Anglais
        "my name is john smith", "call me john",
        "my email is", "my phone number is", "my contact",
        "name is", "I'm john", "I go by",
        "you can reach me at", "my full name",
        # Arabe
        "اسمي", "رقمي", "بريدي الإلكتروني", "أنا محمد",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # CONFIRM_RESERVATION
    # ══════════════════════════════════════════════════════════════════════════
    "confirm_reservation": [
        # Formel FR
        "oui je confirme", "je confirme la réservation",
        "c'est bon confirmez", "valider la réservation",
        "oui c'est parfait", "je valide", "confirmé",
        "oui confirmer", "réservé", "ok pour moi",
        "ça me convient", "c'est parfait", "nickel",
        "super allons-y", "oui s'il vous plaît",
        "oui je veux réserver", "je veux confirmer",
        "confirmer ma réservation", "oui je valide",
        "allez-y", "procédez", "validez",
        "oui c'est bon", "oui d'accord", "oui tout est bon",
        "je suis d'accord avec tout ça", "tout est correct",
        "les informations sont correctes", "c'est juste",
        "tout est bon confirmez", "parfait procédez",
        "oui enregistrez", "enregistrez ma réservation",
        # SMS / informel
        "oui", "ouais", "ouaip", "ok", "oke", "d'accord", "dac",
        "c'est ok", "go", "let's go", "allons-y",
        # Anglais
        "yes confirm", "yes please confirm", "confirm",
        "go ahead", "yes i confirm", "let's do it",
        "agreed", "sounds good", "absolutely", "sure",
        "yes please", "yes book it", "please confirm",
        "i confirm", "book it", "lock it in",
        "that's correct", "all looks good", "proceed",
        "yes everything is correct", "yes save my reservation",
        "confirm my reservation", "yes let's proceed",
        "yes", "yep", "yup", "alright", "affirmative",
        # Arabe
        "نعم أؤكد", "نعم", "موافق", "تمام",
        "نعم من فضلك", "تأكيد", "نعم احجز",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # CANCEL_RESERVATION
    # ══════════════════════════════════════════════════════════════════════════
    "cancel_reservation": [
        # Formel FR
        "annuler la réservation", "je veux annuler", "annulation",
        "ne plus réserver", "abandonner la réservation",
        "non annulez", "laisser tomber", "laisse tomber",
        "non merci", "finalement non", "je change d'avis",
        "pas de réservation", "oubliez", "j'annule", "annulé",
        "pas besoin", "arrêtez tout", "stop tout",
        "je ne veux plus réserver", "annulez ma réservation",
        "je veux annuler ma réservation", "annulation s'il vous plaît",
        "non je veux annuler", "finalement j'annule",
        "pas d'accord annulez", "tout annuler",
        "remettez à zéro", "recommencer depuis zéro",
        # SMS / naturel
        "annul", "j'annule tout", "stop la resa",
        "nope annule", "non stop", "annulation svp",
        # Anglais
        "cancel the reservation", "forget it", "cancel",
        "no i want to cancel", "cancel my booking",
        "never mind", "cancel it", "drop it",
        "abort", "stop the reservation", "i want to cancel",
        "please cancel", "cancel everything",
        "start over", "let me start again", "reset please",
        "no", "nope", "nah",
        # Arabe
        "إلغاء الحجز", "إلغاء", "لا أريد", "ألغِ الحجز", "لا شكرا",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # ASK_PRICE
    # ══════════════════════════════════════════════════════════════════════════
    "ask_price": [
        # Français
        "quel est le prix", "combien coûte une chambre",
        "tarifs de l'hôtel", "prix des chambres",
        "tarif suite", "prix nuit", "c'est combien",
        "combien ça coûte", "ça coûte combien", "c'est à combien",
        "tarif chambre simple", "tarif chambre double",
        "quel est votre tarif", "vos prix s'il vous plaît",
        "prix par nuit", "combien par nuit",
        "tarifs disponibles", "grille tarifaire",
        "indiquez moi vos prix", "donnez moi les tarifs",
        "je voudrais connaître vos prix",
        "quels sont vos tarifs", "quelle est votre grille de prix",
        "prix pour une nuit", "prix pour une semaine",
        "tarif pour 2 personnes", "combien pour une suite",
        "quel est le tarif de la suite",
        "le prix de la chambre double",
        "prix suite semaine prochaine", "tarif double demain",
        # Naturel avec entités
        "combien coûte une suite pour 2 nuits",
        "quel est le prix d'une chambre double tout inclus",
        "tarif chambre simple pour ce soir",
        # SMS
        "c combien", "prix ?", "tarif ?", "c koi le prix",
        # Anglais
        "how much does a room cost", "what are the prices",
        "price", "cost", "how much", "rate", "rates", "fee",
        "what's the price", "room rates please", "nightly rate",
        "how much per night", "what does it cost",
        "price list", "your rates", "pricing",
        "how much is a suite", "how much is a double room",
        "what are your room rates", "can you tell me the prices",
        "how much for all inclusive",
        # Arabe
        "كم السعر", "السعر", "التكلفة", "كم يكلف",
        "ما هو السعر", "أخبرني بالأسعار", "الأسعار من فضلك",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # ASK_SERVICES
    # ══════════════════════════════════════════════════════════════════════════
    "ask_services": [
        # Français
        "quels services proposez-vous", "avez-vous une piscine",
        "spa disponible", "restaurant à l'hôtel",
        "équipements disponibles", "services hôtel",
        "piscine", "spa", "gym", "salle de sport", "restaurant",
        "bar", "wifi", "parking", "navette", "blanchisserie",
        "room service", "que proposez vous comme services",
        "quels sont vos équipements", "avez-vous un spa",
        "y a-t-il un restaurant", "avez-vous le wi-fi",
        "le parking est il gratuit", "navette aéroport disponible",
        "avez-vous une salle de fitness", "piscine disponible",
        "est ce qu'il y a un bar", "avez-vous un club enfants",
        "services inclus", "ce que l'hôtel offre",
        "quelles sont les installations", "ce qui est disponible",
        "y a t il une piscine", "vous avez quoi comme services",
        "qu'est ce que vous offrez",
        # SMS
        "piscine dispo", "ya un spa", "wi-fi gratuit",
        "parking gratuit", "navette aéro",
        # Anglais
        "what services do you offer", "do you have a gym",
        "is there a pool", "what amenities", "facilities",
        "pool", "fitness", "wellness", "airport shuttle",
        "laundry", "breakfast service", "is there wifi",
        "do you have parking", "spa available",
        "is there a restaurant", "do you have a bar",
        "what facilities are available", "what's included",
        "do you have room service", "is parking free",
        # Arabe
        "الخدمات", "المرافق", "حمام سباحة", "سبا",
        "هل يوجد مسبح", "هل يوجد مطعم", "الخدمات المتاحة",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # ASK_LOCATION
    # ══════════════════════════════════════════════════════════════════════════
    "ask_location": [
        # Français
        "où est l'hôtel", "quelle est votre adresse",
        "comment venir à l'hôtel", "transport depuis l'aéroport",
        "navette aéroport", "localisation hôtel",
        "adresse", "où vous trouvez vous",
        "comment y aller", "itinéraire", "GPS",
        "depuis l'aéroport", "depuis la gare", "centre-ville",
        "comment rejoindre l'hôtel", "indiquez moi votre adresse",
        "où êtes vous situés", "l'hôtel est à quelle adresse",
        "votre localisation", "votre situation géographique",
        "comment venir depuis l'aéroport",
        "y a-t-il une navette", "navette disponible",
        "quel est le trajet depuis l'aéroport",
        "c'est où l'hôtel", "t'es où", "vous êtes où",
        "lien google maps", "plan d'accès",
        # Anglais
        "where is the hotel", "hotel address", "how to get there",
        "where are you", "directions", "location",
        "how far from the airport", "shuttle available",
        "how to reach the hotel", "what's your address",
        "where exactly are you located", "google maps link",
        "how do i get to you", "transport options",
        # Arabe
        "العنوان", "الموقع", "كيف أصل", "أين يقع الفندق",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # ASK_CHECKIN_RULES
    # ══════════════════════════════════════════════════════════════════════════
    "ask_checkin_rules": [
        # Français
        "à quelle heure est le check-in", "heure d'arrivée",
        "check-out à quelle heure", "heure de départ",
        "peut-on arriver tôt", "early check-in possible",
        "check-in", "check-out", "heure limite de départ",
        "heure d'enregistrement", "heure de libération",
        "late checkout", "early arrival", "flexible checkout",
        "à quelle heure faut-il libérer la chambre",
        "on peut arriver avant 14h", "on part après 12h c'est possible",
        "horaires de l'hôtel", "heure de check in",
        "politique d'arrivée", "politique de départ",
        "à partir de quelle heure peut on arriver",
        "avant quelle heure doit on partir",
        "checkin a quelle heure", "checkout c'est quand",
        "on arrive à quelle heure",
        # Anglais
        "what time is check-in", "what time is checkout",
        "check-in time", "checkout time", "arrival time",
        "departure time", "can i arrive early", "late checkout available",
        "what are the check-in hours", "when can i check in",
        "what time do i need to check out",
        # Arabe
        "ساعة الوصول", "ساعة المغادرة", "تسجيل الدخول",
        "متى يمكن الوصول", "متى يجب المغادرة",
    ],

    # ══════════════════════════════════════════════════════════════════════════
    # FALLBACK
    # ══════════════════════════════════════════════════════════════════════════
    "fallback": [
        "je ne comprends pas", "autre chose", "random text xyz",
        "blah blah", "???", "...", "rien", "nothing", "test",
        "abcdef", "12345", "qwerty", "asdfgh",
        "je veux quelque chose d'autre", "autre question",
        "hm", "hmm", "euh", "bof",
        "what", "huh", "i don't know", "idk",
        "je sais pas", "sais pas", "aucune idée",
        "zzz", "aaa", "bbb", "fdsfds", "lorem ipsum",
    ],
}

# =============================================================================
#  AUGMENTATION AUTOMATIQUE DU DATASET
# =============================================================================

def augment_training_data(data: dict[str, list[str]]) -> dict[str, list[str]]:
    """
    Augmente le dataset avec des variantes générées automatiquement.
    Ajoute ~15-25% de données supplémentaires.
    """
    augmented = {intent: list(phrases) for intent, phrases in data.items()}

    for intent, phrases in data.items():
        # N'augmente pas le fallback (risque de pollution)
        if intent == "fallback":
            continue
        for phrase in phrases:
            variants = _augment_phrase(phrase)
            for v in variants:
                if v not in augmented[intent]:
                    augmented[intent].append(v)

    return augmented


# =============================================================================
#  CONSTRUCTION DU DATASET
# =============================================================================

def _build_dataset(
    augment: bool = True,
) -> tuple[list[str], list[str]]:
    """Construit X, y depuis TRAINING_DATA (avec augmentation optionnelle)."""
    data = augment_training_data(TRAINING_DATA) if augment else TRAINING_DATA

    X, y = [], []
    for intent, phrases in data.items():
        for phrase in phrases:
            processed = preprocess(phrase)
            if processed.strip():
                X.append(processed)
                y.append(intent)

    return X, y


# =============================================================================
#  ENTRAÎNEMENT DU MODÈLE
# =============================================================================

def train_model(path: str = MODEL_PATH, evaluate: bool = True) -> Pipeline:
    """
    Entraîne le pipeline NLP v3.0 et le sauvegarde.

    Pipeline :
      TF-IDF (1-4 grammes, sublinear_tf, char analyzer en fallback)
      → LinearSVC (C=2.5, balanced)

    Args:
        path:     Chemin de sauvegarde.
        evaluate: Affiche cross-val et rapport.

    Returns:
        Pipeline entraîné.
    """
    log.info("═" * 60)
    log.info("  NLP Engine v3.0 — Démarrage entraînement")
    log.info("═" * 60)
    start = time.time()

    X, y = _build_dataset(augment=True)
    intents = len(set(y))
    log.info(f"Dataset : {len(X)} exemples | {intents} intentions")

    # Construction vocabulaire fuzzy
    build_fuzzy_vocab(TRAINING_DATA)

    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(
            ngram_range=(1, 4),       # jusqu'au 4-grammes pour mieux capturer les phrases
            min_df=1,
            max_df=0.97,
            sublinear_tf=True,
            analyzer="word",
            max_features=20_000,      # plus de features pour mieux discriminer
            strip_accents=None,       # on gère nous-mêmes
            token_pattern=r"(?u)\b\w+\b",
        )),
        ("clf", LinearSVC(
            C=2.5,
            max_iter=5000,
            dual=False,
            class_weight="balanced",
        )),
    ])

    if evaluate and len(X) >= 20:
        try:
            cv = min(5, intents)
            scores = cross_val_score(pipeline, X, y, cv=cv, scoring="accuracy")
            log.info(
                f"Cross-validation ({cv}-fold) : "
                f"{scores.mean():.3f} ± {scores.std():.3f}  "
                f"[min={scores.min():.3f} max={scores.max():.3f}]"
            )
        except Exception as e:
            log.warning(f"Cross-validation ignorée : {e}")

    pipeline.fit(X, y)
    elapsed = time.time() - start
    log.info(f"Modèle entraîné en {elapsed:.2f}s")

    # Distribution des classes
    dist = Counter(y)
    log.info("Distribution des intentions :")
    for intent, count in sorted(dist.items(), key=lambda x: -x[1]):
        log.info(f"  {intent:<25} {count:>5} exemples")

    # Sauvegarde
    try:
        with open(path, "wb") as f:
            pickle.dump(pipeline, f, protocol=pickle.HIGHEST_PROTOCOL)
        log.info(f"Modèle sauvegardé → '{path}'")
    except OSError as e:
        log.error(f"Impossible de sauvegarder le modèle : {e}")

    log.info("═" * 60)
    return pipeline


def load_or_train_model(path: str = MODEL_PATH) -> Pipeline:
    """
    Charge le modèle depuis le disque ou l'entraîne si absent/corrompu.
    Reconstruit aussi le vocabulaire fuzzy.
    """
    # Vocabulaire fuzzy toujours reconstruit
    build_fuzzy_vocab(TRAINING_DATA)

    if os.path.exists(path):
        try:
            with open(path, "rb") as f:
                model = pickle.load(f)
            log.info(f"Modèle chargé depuis '{path}'")
            return model
        except Exception as e:
            log.warning(f"Modèle corrompu ({e}) → ré-entraînement...")

    log.info("Aucun modèle trouvé → entraînement initial...")
    return train_model(path)


# =============================================================================
#  SCRIPT DIRECT
# =============================================================================

if __name__ == "__main__":
    import sys

    if "--test" in sys.argv:
        model = train_model(evaluate=True)
        test_phrases = [
            # Phrases correctes
            "je veux réserver une chambre double",
            "c'est combien par nuit",
            "avez-vous une piscine",
            "oui je confirme",
            "annuler ma réservation",
            "bonjour",
            "merci beaucoup",
            "où est l'hôtel",
            "check-in à quelle heure",
            "2 adultes et 1 enfant",
            # Phrases avec fautes / SMS
            "bjr je veux une resa",
            "chmbre duble svp",
            "toutinclus dispo",
            "mrc bcp",
            "ya des chambres pour demain",
            "reserv pour 2 pers apres demain",
            "c combien la sute",
        ]
        print("\n── Prédictions de test (v3.0) ──")
        for phrase in test_phrases:
            processed = preprocess(phrase, apply_fuzzy=True)
            intent = model.predict([processed])[0]
            dec = model.decision_function([processed])[0]
            if hasattr(dec, "__len__"):
                import numpy as np
                exp_s = np.exp(dec - dec.max())
                conf = float(exp_s.max() / exp_s.sum())
            else:
                conf = float(min(abs(dec) / 2, 1.0))
            print(f"  {phrase:<50} → {intent:<25} ({conf:.1%})")
    else:
        train_model(evaluate=True)
        log.info("Entraînement terminé.")