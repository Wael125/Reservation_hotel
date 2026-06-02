"""
reclamation.py — Détection d'intention ML pour les réclamations
Royal Mansour Iberostar — Mahdia, Tunisie

Endpoint Flask : POST /detect_type
Body JSON      : { "description": "texte de la réclamation" }

v4.0 — Moteur d'urgence entièrement refondu :
        • LISTE NOIRE CRITIQUE : mots garantissant Élevée, quelle que soit la phrase
        • Scoring multi-axe renforcé + seuils abaissés
        • Normalisation avancée : variantes FR/AR/EN/IT/DE, fautes typiques
        • Détection sémantique (synonymes, paraphrases, formes idiomatiques)
        • Boost de type inchangé (v3 compatible)
        • Réponse JSON enrichie : urgence_triggered_by (terme déclencheur)
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import re
import unicodedata

app = Flask(__name__)
CORS(app)

# ================================================================
# NORMALISATION AVANCÉE
# ================================================================
def normalize(text: str) -> str:
    """
    Normalisation robuste :
      - minuscules
      - suppression des accents (NFKD)
      - apostrophes typographiques → '
      - ponctuation → espace (sauf tirets intra-mot)
      - espaces multiples → espace
    """
    text = text.lower().strip()
    # Apostrophes typographiques
    text = text.replace(''', "'").replace(''', "'").replace('`', "'")
    # Décomposition Unicode (supprime accents)
    nfkd = unicodedata.normalize('NFKD', text)
    text = ''.join(c for c in nfkd if not unicodedata.combining(c))
    # Ponctuation → espace (garde tirets intra-mot)
    text = re.sub(r'[^\w\s\-\']', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


# ================================================================
# ████  LISTE NOIRE CRITIQUE — DÉCLENCHEUR IMMÉDIAT "ÉLEVÉE"  ████
# ================================================================
# Ces patterns, dès qu'un seul matche, forcent urgence = "Élevée"
# INDÉPENDAMMENT du score global.
# Chaque entrée : (pattern_regex, label_lisible)
# ================================================================
CRITICAL_TRIGGERS = [

    # ── INCENDIE / FEU ──────────────────────────────────────────
    (r'\bfire\b',                           'fire'),
    (r'\bfeu\b',                            'feu'),
    (r'\bincendie\b',                       'incendie'),
    (r'\bflames?\b',                        'flames'),
    (r'\bbrule(nt)?\b',                     'brule'),
    (r'\bfumee\b',                          'fumee'),
    (r'\bsmoke\b',                          'smoke'),
    (r'\bfeuer\b',                          'feuer'),         # DE
    (r'\bfuoco\b',                          'fuoco'),         # IT
    (r'\bharik\b',                          'harik'),         # AR
    (r'\b7arik\b',                          '7arik'),         # AR

    # ── SANG / BLESSURE / URGENCE MÉDICALE ──────────────────────
    (r'\bblood\b',                          'blood'),
    (r'\bsang\b',                           'sang'),
    (r'\bbleed(ing)?\b',                    'bleeding'),
    (r'\bblute(n|nd)?\b',                   'bluten'),        # DE
    (r'\bsangue\b',                         'sangue'),        # IT
    (r'\bdm\b.*\bsang\b',                   'dm_sang'),
    (r'\bbless(e|u|ure)\b',                 'blesse'),
    (r'\binjured?\b',                       'injured'),
    (r'\bwounded?\b',                       'wounded'),
    (r'\bbrul(e|ure)\b',                    'brulure'),
    (r'\bburn(ed|ing)?\b',                  'burning'),
    (r'\belectrocution\b',                  'electrocution'),
    (r'\belectrocute(r|d)?\b',              'electrocuted'),
    (r'\belectric shock\b',                 'electric_shock'),
    (r'\bchoc electrique\b',                'choc_electrique'),
    (r'\bperte de connaissance\b',          'perte_connaissance'),
    (r'\bunconsciou(s|sness)\b',            'unconscious'),
    (r'\bevanoui(e)?\b',                    'evanoui'),
    (r'\bfainted?\b',                       'fainted'),
    (r'\bcoma\b',                           'coma'),
    (r'\bsamu\b',                           'samu'),
    (r'\bampulance\b',                      'ambulance_typo'),
    (r'\bambulance\b',                      'ambulance'),
    (r'\bpompier\b',                        'pompier'),
    (r'\bfirefighter\b',                    'firefighter'),
    (r'\bhospitalis(e|e|ation)\b',          'hospitalise'),
    (r'\bhospital\b',                       'hospital'),
    (r'\bkrankenhaus\b',                    'krankenhaus'),   # DE
    (r'\bospedale\b',                       'ospedale'),      # IT

    # ── INONDATION / DÉGÂTS EAU MAJEURS ─────────────────────────
    (r'\bflood(ing|ed)?\b',                 'flooding'),
    (r'\binondation\b',                     'inondation'),
    (r'\beau partout\b',                    'eau_partout'),
    (r'\bwater everywhere\b',               'water_everywhere'),
    (r'\bwater is flooding\b',              'water_flooding'),
    (r'\bplafond\b.*\beffondre\b',          'plafond_effondre'),
    (r'\beffondrement\b',                   'effondrement'),
    (r'\bcollapse\b',                       'collapse'),
    (r'\beinflutung\b',                     'einflutung'),    # DE
    (r'\ballagamento\b',                    'allagamento'),   # IT

    # ── GAZ ──────────────────────────────────────────────────────
    (r'\bodeur.*gaz\b',                     'odeur_gaz'),
    (r'\bgaz.*fuite\b',                     'gaz_fuite'),
    (r'\bgas.*leak\b',                      'gas_leak'),
    (r'\bgas.*smell\b',                     'gas_smell'),
    (r'\bsmell.*gas\b',                     'smell_gas'),
    (r'\bgas\b',                            'gas_alone'),     # "gas" seul = danger potentiel
    (r'\bgasgeruch\b',                      'gasgeruch'),     # DE
    (r'\bodore.*gas\b',                     'odore_gas'),     # IT

    # ── AGRESSION / VIOLENCE PHYSIQUE ───────────────────────────
    (r'\bagression\b',                      'agression'),
    (r'\bassault(ed)?\b',                   'assault'),
    (r'\battack(ed)?\b',                    'attacked'),
    (r'\battaque\b',                        'attaque'),
    (r'\bbe beaten\b',                      'beaten'),
    (r'\bfrappe\b',                         'frappe'),
    (r'\bhit me\b',                         'hit_me'),
    (r'\bmenace.*physique\b',               'menace_physique'),
    (r'\bphysical threat\b',               'physical_threat'),
    (r'\bviolen(ce|t|te)\b',               'violence'),

    # ── VOL / EFFRACTION ────────────────────────────────────────
    (r'\btheft\b',                          'theft'),
    (r'\bstolen\b',                         'stolen'),
    (r'\bburglary\b',                       'burglary'),
    (r'\bbreak.?in\b',                      'break_in'),
    (r'\beffraction\b',                     'effraction'),
    (r'\bcoffre.?fort.*force\b',            'coffre_force'),
    (r'\bsafe.*broken into\b',              'safe_broken'),
    (r'\bsariqa\b',                         'sariqa'),        # AR

    # ── EMPOISONNEMENT / INTOXICATION ALIMENTAIRE ────────────────
    (r'\bpoisoning\b',                      'poisoning'),
    (r'\bempoisonnement\b',                 'empoisonnement'),
    (r'\bintoxication.*alimentaire\b',      'intoxication_alimentaire'),
    (r'\bfood poison\b',                    'food_poison'),
    (r'\bvergift(ung|et)\b',               'vergiftung'),    # DE
    (r'\bintossicazione\b',                 'intossicazione'),# IT

    # ── DANGER ÉLECTRIQUE ────────────────────────────────────────
    (r'\bspark(s|ing)?\b',                  'sparks'),
    (r'\bétincel(les?|ant)\b',             'etincelle'),
    (r'\betincel(les?|ant)\b',             'etincelle2'),
    (r'\bprise.*fume\b',                    'prise_fume'),
    (r'\boutlet.*smoke\b',                  'outlet_smoke'),
    (r'\bcourt.circuit\b',                  'court_circuit'),
    (r'\bshort circuit\b',                  'short_circuit'),
    (r'\bkurzschluss\b',                    'kurzschluss'),   # DE

    # ── DANGER IMMÉDIAT GÉNÉRIQUE ────────────────────────────────
    (r'\bemergency\b',                      'emergency'),
    (r'\burgence\b',                        'urgence'),
    (r'\bsos\b',                            'sos'),
    (r'\bhelp.*now\b',                      'help_now'),
    (r'\bau secours\b',                     'au_secours'),
    (r'\baidez.?moi\b',                     'aidez_moi'),
    (r'\bnotfall\b',                        'notfall'),       # DE
    (r'\bemergenza\b',                      'emergenza'),     # IT
    (r'\btawari\b',                         'tawari'),        # AR

    # ── PUNAISES DE LIT ─────────────────────────────────────────
    (r'\bbedbugs?\b',                       'bedbugs'),
    (r'\bpunaise.*lit\b',                   'punaise_lit'),
    (r'\blit.*punaise\b',                   'lit_punaise'),
    (r'\bwanzen\b',                         'wanzen'),        # DE
    (r'\bcimici\b',                         'cimici'),        # IT

    # ── RATS / NUISIBLES GRAVES ──────────────────────────────────
    (r'\brat(s)?\b',                        'rats'),
    (r'\brats?\b',                          'rats2'),
    (r'\bsouris.*chambre\b',               'souris_chambre'),
    (r'\bmouse.*room\b',                    'mouse_room'),
    (r'\binfest(e|ation|ed)\b',            'infestation'),
    (r'\bvermine\b',                        'vermine'),

    # ── MORT / DÉCÈS ─────────────────────────────────────────────
    (r'\bdead\b',                           'dead'),
    (r'\bdecede\b',                         'decede'),
    (r'\bdeath\b',                          'death'),
    (r'\bmort\b',                           'mort'),
]

# Pré-compilation pour performance
_COMPILED_CRITICAL = [(re.compile(p), label) for p, label in CRITICAL_TRIGGERS]


def check_critical_triggers(normalized_text: str) -> list:
    """
    Retourne la liste des labels critiques déclenchés.
    Si non vide → urgence = "Élevée" garantie.
    """
    triggered = []
    for pattern, label in _COMPILED_CRITICAL:
        if pattern.search(normalized_text):
            triggered.append(label)
    return triggered


# ================================================================
# BASE DE CONNAISSANCES — MOTS-CLÉS PAR TYPE (inchangée v3)
# ================================================================
INTENT_KEYWORDS = {

    "wifi": [
        r'\bwi.?fi\b', r'\binternet\b', r'\bconnexion\b', r'\breseau\b',
        r'\bsignal\b', r'\bdebit\b', r'\bbande passante\b', r'\bip\b',
        r'\bwireless\b', r'\bconnect(er|e|ion)?\b', r'\bnavigation\b',
        r'\brouter\b', r'\bbox\b', r'\bmodem\b', r'\bfirewall\b',
        r'\blatence\b', r'\bping\b', r'\bbandwidth\b', r'\blan\b',
        r'\bpas de wifi\b', r'\bwifi lent\b', r'\bcoupure internet\b',
        r'\bwifi coupe\b', r'\bwifi instable\b', r'\bwifi faible\b',
        r'\binternet lent\b', r'\binternet coupe\b', r'\bpas d.internet\b',
        r'\bpas de connexion\b', r'\bconnexion perdue\b', r'\bconnexion instable\b',
        r'\bsignal faible\b', r'\bsignal mauvais\b', r'\bpas de signal\b',
        r'\bnavigation impossible\b', r'\bpage\b.*\bne charge pas\b',
        r'\bmot de passe\b.*\bwifi\b', r'\bwifi\b.*\bmot de passe\b',
        r'\bcode\b.*\bwifi\b', r'\bwifi\b.*\bcode\b',
        r'\bacces\b.*\binternet\b', r'\binternet\b.*\bmarche pas\b',
        r'\bwifi\b.*\bmarche pas\b', r'\bwifi\b.*\bfonctionne pas\b',
        r'\bpas acces\b.*\binternet\b', r'\bdeconnecte\b',
        r'\btelecharger\b.*\bimpossible\b', r'\bstreaming\b.*\bimpossible\b',
        r'\bno wifi\b', r'\bwifi down\b', r'\bslow internet\b',
        r'\bno internet\b', r'\binternet not working\b', r'\bwifi password\b',
        r'\bcannot connect\b', r'\bunstable connection\b',
        r'\bwayfi\b', r'\bintirnet\b', r'\bconnexyon\b',
    ],

    "climatisation": [
        r'\bclimatis(ation|eur|er|e)\b', r'\bclim\b', r'\bair condit(ionn)?e?\b',
        r'\bventil(ateur|ation)\b', r'\bac\b', r'\breglage temperature\b',
        r'\bthermostat\b', r'\bsplit\b', r'\bconditionnement\b',
        r'\bfroid\b.*\bchambre\b', r'\bchambre\b.*\bfroid\b',
        r'\btemperature\b.*\bchambre\b', r'\btrop chaud\b', r'\btrop froid\b',
        r'\bchambre\b.*\bchaud\b', r'\bchambre\b.*\bsurchauff(e|é)\b',
        r'\btouffant\b', r'\btouffante\b', r'\bsuffocant\b', r'\bethuffant\b',
        r'\bon etouffe\b', r'\bon suffoque\b', r'\bair irrespirable\b',
        r'\bchambre\b.*\bgelée?\b', r'\bchambre\b.*\bglaciale?\b',
        r'\btemperature\b.*\bregler\b', r'\bregler\b.*\btemperature\b',
        r'\bclim\b.*\bne fonctionne pas\b', r'\bclim\b.*\bmarche pas\b',
        r'\bclim\b.*\bpanne\b', r'\bclim\b.*\bbruit\b', r'\bclim\b.*\bbruyante\b',
        r'\bclim\b.*\bfuite\b', r'\bair conditionne\b.*\bpanne\b',
        r'\bair conditionne\b.*\bmarche pas\b', r'\bventilateur\b.*\bbruyant\b',
        r'\bventilateur\b.*\bpanne\b', r'\bventilateur\b.*\bcasse\b',
        r'\bair conditioning\b', r'\bac not working\b', r'\bac broken\b',
        r'\bac too cold\b', r'\bac too hot\b', r'\broom temperature\b',
        r'\btoo warm\b', r'\btoo cool\b', r'\boverheating\b',
        r'\bklima\b', r'\bklimaanlage\b', r'\bcondizionatore\b',
        r'\btakyi(f|if)\b', r'\bbared\b.*\bghorfa\b',
    ],

    "chauffage": [
        r'\bchauffage\b', r'\bradiateur\b', r'\bchauffa(nt|ge)\b',
        r'\bchauffer\b', r'\bcalorifere\b', r'\bconvecteur\b',
        r'\bpompe a chaleur\b', r'\bplancher chauffant\b',
        r'\bpas de chaleur\b', r'\bfroid la nuit\b', r'\bfroid\b.*\bnuit\b',
        r'\bnuit\b.*\bfroid\b', r'\bchambre\b.*\bfroid(e)?\b',
        r'\bchambre\b.*\bgelée?\b', r'\bchambre\b.*\bglaciale?\b',
        r'\bradiateur\b.*\bfroid\b', r'\bradiateur\b.*\bmarche pas\b',
        r'\bradiateur\b.*\bpanne\b', r'\bradiateur\b.*\bne chauffe pas\b',
        r'\bradiateur\b.*\beteint\b', r'\bchauffage\b.*\bpanne\b',
        r'\bchauffage\b.*\bmarche pas\b', r'\bchauffage\b.*\bne fonctionne pas\b',
        r'\bchauffage\b.*\bcasse\b', r'\bchauffage\b.*\beteint\b',
        r'\bon gele\b', r'\bje gele\b', r'\bil fait\b.*\bfroid\b',
        r'\btemperature\b.*\btrop basse\b', r'\bfrigide\b',
        r'\bno heating\b', r'\bheating broken\b', r'\bheater not working\b',
        r'\bno heat\b', r'\broom is cold\b', r'\bfreezing room\b',
        r'\bheizung\b', r'\briscaldamento\b',
        r'\bdafa\b', r'\btadfi2a\b', r'\bghorfa\b.*\bbarda\b',
    ],

    "electricite": [
        r'\belectricit(e|é)\b', r'\bprise\b', r'\bpanne\b',
        r'\bcourant\b', r'\blumiere\b', r'\blumière\b', r'\blampe\b',
        r'\binterrupteur\b', r'\bfusible\b', r'\belectrique\b',
        r'\bcourt.circuit\b', r'\bvoltage\b', r'\bdisjoncteur\b',
        r'\bprise electrique\b', r'\bsocket\b', r'\bplug\b',
        r'\bprise\b.*\busb\b', r'\busb\b.*\bcharge\b', r'\bchargeur\b',
        r'\bcharger\b', r'\balimentation\b', r'\btension\b',
        r'\bprise ne fonctionne\b', r'\bpas d.electricite\b',
        r'\bpanneau electrique\b', r'\bpas de courant\b',
        r'\bcoupure de courant\b', r'\bcoupure electrique\b',
        r'\bpanne electrique\b', r'\bpanne de courant\b',
        r'\blumiere\b.*\bmarche pas\b', r'\blampe\b.*\bgrille\b',
        r'\blampe\b.*\bcassee\b', r'\blampe\b.*\bfonctionne pas\b',
        r'\beclairage\b.*\binsuffisant\b', r'\beclairage\b.*\bpanne\b',
        r'\bprise\b.*\bbrule\b', r'\bprise\b.*\bfume\b',
        r'\binterrupteur\b.*\bmarche pas\b', r'\bpas de lumiere\b',
        r'\bblackout\b', r'\bplugs\b.*\bnot working\b',
        r'\bno electricity\b', r'\bpower outage\b', r'\boutlet not working\b',
        r'\bno power\b', r'\belectric\b.*\bproblem\b', r'\blight\b.*\bnot working\b',
        r'\bstrom\b', r'\bsteckdose\b', r'\belettricita\b', r'\bpresa\b',
        r'\bkahraba\b',
    ],

    "television": [
        r'\btele(vision)?\b', r'\btv\b', r'\becran\b', r'\bchaine\b',
        r'\bprogramme\b', r'\btelecommande\b', r'\bhdmi\b',
        r'\bcable\b.*\btv\b', r'\bsatellite\b', r'\bcanalsat\b',
        r'\bbeinsport\b', r'\bnetflix\b', r'\byoutube\b.*\btv\b',
        r'\bsmart tv\b', r'\bdecodeur\b', r'\bset.?top.?box\b',
        r'\bremote\b', r'\bremote control\b', r'\bcontrol\b.*\btv\b',
        r'\bimage\b.*\bmauvaise\b', r'\bson\b.*\btv\b',
        r'\btv\b.*\bmarche pas\b', r'\btelecommande\b.*\bpile\b',
        r'\btv\b.*\bpanne\b', r'\btv\b.*\bcassee\b', r'\btv\b.*\bcasse\b',
        r'\btv\b.*\bfonctionne pas\b', r'\btv\b.*\bne s.allume pas\b',
        r'\becran\b.*\bnoir\b', r'\becran\b.*\bcasse\b', r'\becran\b.*\bfige\b',
        r'\bchaine\b.*\bmanque\b', r'\bchaine\b.*\bcoupee\b',
        r'\bpas de chaine\b', r'\bimage\b.*\bpixelise\b',
        r'\bimage\b.*\bfloue\b', r'\bson\b.*\bcouper\b', r'\bsans son\b',
        r'\bpas de son\b', r'\btelecommande\b.*\bmarche pas\b',
        r'\btelecommande\b.*\bfonctionne pas\b', r'\btv\b.*\bgelée?\b',
        r'\bprogramme\b.*\bmanque\b', r'\bsatellite\b.*\bpanne\b',
        r'\btelevision\b', r'\bscreen\b.*\bblack\b', r'\bchannel\b.*\bnot working\b',
        r'\btv\b.*\bnot working\b', r'\bno channels\b', r'\btv\b.*\bbroken\b',
        r'\bfernseher\b', r'\btelevisore\b',
        r'\btilifizyun\b', r'\btilifizyon\b', r'\bteleziyon\b',
    ],

    "bruit": [
        r'\bbruit\b', r'\bbruyant\b', r'\bvoisin(s)?\b', r'\btapage\b',
        r'\bnuisance\b', r'\bson(ore)?\b', r'\bsono(re)?\b',
        r'\bnuisance sonore\b', r'\bpollution sonore\b',
        r'\bmusique\b.*\bfort\b', r'\btrop fort\b', r'\bpas dormir\b',
        r'\binsomnie\b', r'\bvoisinage\b', r'\bcouloir bruyant\b',
        r'\bfete\b', r'\bfête\b', r'\bnuit bruyante\b',
        r'\btravaux\b', r'\bbruit de travaux\b', r'\bconstruction\b',
        r'\bbruit\b.*\bnuit\b', r'\bnuit\b.*\bbruit\b',
        r'\bbruit\b.*\bdehors\b', r'\bbruit\b.*\bexterieur\b',
        r'\bbruit\b.*\bvoiture(s)?\b', r'\bbruit\b.*\bmoteur\b',
        r'\bbruit\b.*\bcouloir\b', r'\bbruit\b.*\bescalier\b',
        r'\bbruit\b.*\bascenseur\b', r'\bbruit\b.*\bpipe\b',
        r'\bbruit\b.*\btuyaux\b', r'\bbruit\b.*\bcanalisation\b',
        r'\bvoisin\b.*\bbruyant\b', r'\bvoisin\b.*\bfort\b',
        r'\bvoisin\b.*\bnuit\b', r'\bfete\b.*\bnuit\b',
        r'\bmusique\b.*\bnuit\b', r'\bmusique\b.*\bbasse\b',
        r'\bsubwoofer\b', r'\bsono\b.*\bfort\b',
        r'\bpas pu dormir\b', r'\bnuit blanche\b', r'\bsommeil\b.*\bperturbe\b',
        r'\bsommeil\b.*\btrouble\b', r'\breveille\b.*\bbruit\b',
        r'\bbruit\b.*\breveille\b', r'\bvacarme\b', r'\bbrouhaha\b',
        r'\bclameur\b', r'\bagitation\b.*\bnuit\b',
        r'\bnoisy\b', r'\bnoise\b', r'\bneighbors?\b.*\bnoisy\b',
        r'\bcouldn.?t sleep\b', r'\bkept awake\b', r'\bloud music\b',
        r'\bloud neighbors?\b', r'\bconstant noise\b', r'\bstreet noise\b',
        r'\blärm\b', r'\brumore\b', r'\brumori\b',
        r'\bdawsha\b', r'\bdaja\b', r'\bsawt\b.*\bali\b',
    ],

    "proprete": [
        r'\bproprete\b', r'\bpropreté\b', r'\bsale\b', r'\bmalpropr(e|ete)\b',
        r'\bordure(s)?\b', r'\bdechets\b', r'\bpoussier(e|e)\b',
        r'\bpoussi(ere|ère)\b', r'\bnettoyage\b', r'\btaches\b',
        r'\bsalete\b', r'\bsaleté\b', r'\bcrasse\b', r'\bsordide\b',
        r'\bdegoutant\b', r'\bdégoûtant\b', r'\bimmonde\b',
        r'\binsecte(s)?\b', r'\bblatte(s)?\b', r'\bcafard(s)?\b',
        r'\bmoustique(s)?\b', r'\bpuce(s)?\b',
        r'\bpas propre\b', r'\bpas nettoy(e|é)\b',
        r'\bchambre\b.*\bsale\b', r'\bsale\b.*\bchambre\b',
        r'\btaches\b.*\bmur\b', r'\btaches\b.*\bsol\b', r'\btaches\b.*\bdrap\b',
        r'\btaches\b.*\bnappe\b', r'\bmoisissures?\b', r'\bmoisi\b',
        r'\bchampignon(s)?\b.*\bmur\b', r'\bhumidite\b.*\bmoisissure\b',
        r'\bcheveux\b.*\bdouche\b', r'\bcorbeille\b.*\bpleine\b',
        r'\bpoubelle\b.*\bpleine\b', r'\bodeur\b.*\bmauvaise\b',
        r'\bmauvaise odeur\b', r'\bodeur\b.*\bdesagreable\b',
        r'\bdirty\b', r'\bunclean\b', r'\bfilthy\b', r'\bcockroach\b',
        r'\bbugs\b', r'\bmold\b', r'\bmould\b',
        r'\bdust\b', r'\bstain(s)?\b', r'\bnot cleaned\b',
        r'\bschmutzig\b', r'\bsporca\b', r'\bsporcizia\b',
        r'\bndhafa\b', r'\bwsakh\b', r'\bkhashra\b', r'\bnaml\b',
    ],

    "literie": [
        r'\bliterie\b', r'\bmatelas\b', r'\boreil(ler|lers)\b',
        r'\blit\b', r'\bdraps\b', r'\bcouverture(s)?\b', r'\bcoussins\b',
        r'\bmousse\b', r'\bsommier\b', r'\bbase\b.*\blit\b',
        r'\btaie\b', r'\bdrap housse\b', r'\bcouette\b', r'\bedredon\b',
        r'\bprotege\b.*\bmatelas\b', r'\bsurmatelas\b',
        r'\bconfort\b.*\blit\b', r'\blit\b.*\bconfort\b',
        r'\blit\b.*\bcass(e|é)\b', r'\blit\b.*\bdur\b',
        r'\bmatelas\b.*\bmauvais\b', r'\bmatelas\b.*\btrop dur\b',
        r'\bmatelas\b.*\btrop mou\b', r'\bmatelas\b.*\bcreuse\b',
        r'\bmatelas\b.*\baffaisse\b', r'\bmatelas\b.*\bvieux\b',
        r'\bmatelas\b.*\buse\b', r'\bmatelas\b.*\binconfort\b',
        r'\boreillers\b.*\bdurs\b', r'\boreillers\b.*\bmous\b',
        r'\boreillers\b.*\binsuffisant\b', r'\boreillers\b.*\bmanque\b',
        r'\bdraps\b.*\bsales\b', r'\bdraps\b.*\btrou(e|é)s?\b',
        r'\bdraps\b.*\buses?\b', r'\bdraps\b.*\bfine\b',
        r'\bcouverture\b.*\binsuffisante\b', r'\bcouverture\b.*\btrop fine\b',
        r'\bit grinc(e|é)\b', r'\blit\b.*\bgrinc\b', r'\bgrincement\b',
        r'\bsommier\b.*\bcass(e|é)\b', r'\bsommier\b.*\bgrinc\b',
        r'\bmal dorm(i|ir)\b', r'\bpas dormi\b.*\blit\b',
        r'\bdos\b.*\blit\b', r'\bmal au dos\b.*\bmatelas\b', r'\blit\b.*\bvieux\b',
        r'\bbedding\b', r'\bmattress\b', r'\bpillow(s)?\b',
        r'\bsheets?\b', r'\bblanket\b', r'\buncomfortable bed\b',
        r'\bhard mattress\b', r'\bsqueaky bed\b', r'\bdirty sheets\b',
        r'\bbettwäsche\b', r'\bmatratze\b', r'\bcuscini\b', r'\blenzuola\b',
        r'\bfirrash\b', r'\bmatareh\b', r'\bwissada\b', r'\bghtaa\b',
    ],

    "salle_de_bain": [
        r'\bsalle de bain\b', r'\bsdb\b', r'\bdouche\b', r'\bbaignoire\b',
        r'\btoilette(s)?\b', r'\bwc\b', r'\brobinet\b', r'\beau chaude\b',
        r'\beau froide\b', r'\bpression\b.*\beau\b', r'\bfuite\b',
        r'\bpomme de douche\b', r'\blavabo\b', r'\bmitigeur\b', r'\bsiphon\b',
        r'\bchasse d.eau\b', r'\btasse\b.*\bwc\b', r'\bwc\b.*\bbloque\b',
        r'\bwc\b.*\bbouche\b', r'\btuyau\b.*\bbouche\b',
        r'\bcanalisation\b.*\bbouchee\b', r'\bevacuation\b.*\bbouchee\b',
        r'\bsavon\b', r'\bserviette\b', r'\bshampoing\b', r'\bbain\b',
        r'\bproduit(s)?\b.*\btoilette\b', r'\bgel douche\b',
        r'\bconditionneur\b', r'\bcreme\b.*\bbain\b', r'\bpapier toilette\b',
        r'\bpapier wc\b', r'\bmiroir\b.*\bsalle de bain\b',
        r'\bseche.cheveux\b', r'\bseche cheveux\b', r'\bhairdryer\b',
        r'\bporte.serviette\b',
        r'\bpas d.eau chaude\b', r'\beau\b.*\bfroide\b.*\bdouche\b',
        r'\bdouche\b.*\bfroide\b', r'\bpression\b.*\bfaible\b',
        r'\brobinet\b.*\bgoutte\b', r'\brobinet\b.*\bfuit\b',
        r'\bfuite\b.*\beau\b', r'\beau\b.*\bfuite\b',
        r'\bdouche\b.*\bbouchee\b', r'\bdouche\b.*\bmarche pas\b',
        r'\bdouche\b.*\bpanne\b', r'\bdouche\b.*\bfonctionne pas\b',
        r'\bdouche\b.*\bcassee\b', r'\bbaignoire\b.*\bbouchee\b',
        r'\bbaignoire\b.*\bfuite\b', r'\beau\b.*\bstagne\b',
        r'\beau\b.*\bs.evacue pas\b', r'\bevacuation\b.*\blente\b',
        r'\bwc\b.*\bdeborde\b', r'\bwc\b.*\bfuite\b', r'\bwc\b.*\bodeur\b',
        r'\btoilette(s)?\b.*\bbouche(e)?\b', r'\btoilette(s)?\b.*\bodeur\b',
        r'\btoilette(s)?\b.*\bfonctionne pas\b',
        r'\bbathroom\b', r'\bshower\b.*\bnot working\b', r'\bno hot water\b',
        r'\btoilet\b.*\bclogged\b', r'\bleaking\b.*\bbathroom\b',
        r'\bweak water pressure\b', r'\bmissing towels\b',
        r'\bbad(ezimmer|ewanne)\b', r'\bdusche\b', r'\bbagno\b', r'\bdoccia\b',
        r'\bhamm(am|em)\b', r'\bdush\b', r'\bmaya\b.*\bsakhna\b',
        r'\brobini\b', r'\btwalet\b',
    ],

    "restauration": [
        r'\brestauration\b', r'\brestaurant\b', r'\brepas\b', r'\bdiner\b',
        r'\bdejeuner\b', r'\bnourriture\b', r'\bmanger\b',
        r'\bplat\b', r'\bmenu\b', r'\bcarte\b', r'\bcuisine\b',
        r'\bchef\b', r'\bcuisinier\b', r'\bcook\b', r'\brecette\b',
        r'\bingredient\b', r'\bportion\b', r'\bdose\b', r'\bquantite\b',
        r'\bqualite\b.*\bnourriture\b', r'\bnourriture\b.*\bqualite\b',
        r'\bnourriture\b.*\bmauvaise\b', r'\bmauvaise\b.*\bnourriture\b',
        r'\bplat\b.*\bfroid\b', r'\bfroid\b.*\bservi\b', r'\bservi froid\b',
        r'\bgout\b', r'\bsaveur\b', r'\bmauvais gout\b',
        r'\bmauvais plat\b', r'\bplat\b.*\bmauvais\b', r'\bimmangeable\b',
        r'\binsipide\b', r'\bnon comestible\b', r'\bpas bon\b',
        r'\btrop sale\b', r'\btrop sucre\b', r'\btrop epice\b',
        r'\bpas frais\b', r'\bnourriture\b.*\bperimee\b',
        r'\bnourriture\b.*\bavariee\b', r'\bdiarrhee\b.*\brepas\b',
        r'\battente\b.*\brestaurant\b', r'\brestaurant\b.*\battente\b',
        r'\btrop long\b.*\bcommande\b', r'\bcommande\b.*\btrop long\b',
        r'\bcommande\b.*\berreur\b', r'\bserveur\b.*\bimpoli\b',
        r'\bserveur\b.*\bnegligent\b', r'\bserveur\b.*\blent\b',
        r'\brestaurant\b.*\bferme\b', r'\brestaurant\b.*\bcomplet\b',
        r'\btable\b.*\bsale\b', r'\bnappe\b.*\bsale\b', r'\bcouvert\b.*\bsale\b',
        r'\ballergie\b', r'\ballergique\b', r'\bintolerance\b',
        r'\bgluten\b', r'\blactose\b', r'\bhalal\b', r'\bkosher\b',
        r'\bvegetarien\b', r'\bvegan\b',
        r'\bfood quality\b', r'\bbad food\b', r'\bwrong order\b',
        r'\bovercooked\b', r'\bundercooked\b', r'\braw food\b',
        r'\bwaiter\b.*\brude\b',
        r'\bessen\b', r'\bspeise\b', r'\bcibo\b', r'\bpasto\b',
        r'\bakl\b', r'\bta3am\b', r'\bmat3am\b', r'\bwajba\b',
    ],

    "petit_dejeuner": [
        r'\bpetit.?dejeuner\b', r'\bpetit.?déjeuner\b', r'\bbreakfast\b',
        r'\bbuffet\b.*\bmatin\b', r'\bmatin\b.*\bbuffet\b',
        r'\bviennoiserie\b', r'\bjus\b.*\bmatin\b', r'\boeufs\b.*\bmatin\b',
        r'\bbuffet\b.*\bfroid\b', r'\bheure\b.*\bpetit\b.*\bdejeuner\b',
        r'\bdejeuner\b.*\bmatin\b', r'\bbrunch\b', r'\bcontinental\b',
        r'\bcroissant\b', r'\bbaguette\b', r'\bpain\b.*\bmatin\b',
        r'\bconfiture\b', r'\bbeurre\b.*\bmatin\b', r'\byaourt\b',
        r'\bfromage\b.*\bmatin\b', r'\bcharcuterie\b',
        r'\bjus d.orange\b', r'\bjus\b.*\bfruit(s)?\b',
        r'\bcafe\b.*\bmatin\b', r'\bthe\b.*\bmatin\b',
        r'\bnescafe\b', r'\bespresso\b.*\bmatin\b',
        r'\bbuffet\b.*\bvide\b', r'\bbuffet\b.*\bmanque\b',
        r'\bbuffet\b.*\btrop petit\b', r'\bbuffet\b.*\binsuffisant\b',
        r'\bbuffet\b.*\bpas frais\b', r'\bpas de buffet\b',
        r'\bproduits\b.*\bepuise(s)?\b',
        r'\bdejeuner\b.*\bfroid\b', r'\bpas assez\b.*\bdejeuner\b',
        r'\bmanque\b.*\bchoix\b.*\bmatin\b',
        r'\bno breakfast\b', r'\bempty buffet\b', r'\bcold breakfast\b',
        r'\blimited breakfast\b',
        r'\bfrühstück\b', r'\bcolazione\b',
        r'\bftour\b', r'\bsabahiya\b',
    ],

    "room_service": [
        r'\broom.?service\b', r'\bservice\b.*\bchambre\b',
        r'\bchambre\b.*\bservice\b', r'\blivraison\b.*\bchambre\b',
        r'\bcommande\b.*\bchambre\b', r'\brepas\b.*\bchambre\b',
        r'\bcommande\b.*\blongtemps\b', r'\battente\b.*\broom\b',
        r'\bservice\b.*\bnuit\b', r'\bcommande\b.*\bnuit\b',
        r'\bpetit.?dejeuner\b.*\bchambre\b', r'\bchambre\b.*\bpetit.?dejeuner\b',
        r'\bdiner\b.*\bchambre\b',
        r'\battente\b.*\btrop longue\b.*\broom\b',
        r'\broom service\b.*\btrop long\b',
        r'\blivraison\b.*\btard\b', r'\blivraison\b.*\bfroid\b',
        r'\bcommande\b.*\bfroid\b.*\bchambre\b',
        r'\bcommande\b.*\bmauvaise\b.*\bchambre\b',
        r'\broom service\b.*\berreur\b', r'\broom service\b.*\bmanquant\b',
        r'\broom service\b.*\bferme\b', r'\broom service\b.*\bindisponible\b',
        r'\bpas de room service\b',
        r'\broom service\b.*\bnot available\b', r'\broom service\b.*\blate\b',
        r'\broom service\b.*\bwrong order\b', r'\bno room service\b',
        r'\bdelivery\b.*\broom\b', r'\bin.room dining\b',
        r'\bkhidmet\b.*\bghurfa\b',
    ],

    "piscine": [
        r'\bpiscine\b', r'\bpool\b', r'\bnager\b', r'\bbaignade\b',
        r'\btransat\b', r'\bchaise longue\b', r'\beau\b.*\bpiscine\b',
        r'\baquatique\b', r'\bjacuzzi\b', r'\bbain a remous\b',
        r'\bpiscine\b.*\binterieure\b', r'\bpiscine\b.*\bexterieure\b',
        r'\bpiscine\b.*\bferme\b', r'\bpiscine\b.*\bindisponible\b',
        r'\bpiscine\b.*\bverte\b', r'\bpiscine\b.*\border\b',
        r'\bpiscine\b.*\btrop froide\b', r'\bpiscine\b.*\btrop chaude\b',
        r'\beau\b.*\bpiscine\b.*\bsale\b', r'\beau\b.*\bpiscine\b.*\bverte\b',
        r'\btransat(s)?\b.*\bmanque\b', r'\bpas de transat(s)?\b',
        r'\bpas de parasol\b', r'\bparasol\b.*\bmanque\b',
        r'\bdouche\b.*\bpiscine\b', r'\bmaître.?nageur\b',
        r'\bsurveillant\b.*\bpiscine\b', r'\bpas de surveillance\b.*\bpiscine\b',
        r'\bpool closed\b', r'\bdirty pool\b', r'\bno pool access\b',
        r'\bpool too cold\b', r'\bno loungers\b', r'\bswimming pool\b',
        r'\bschwimmbad\b', r'\bpiscina\b',
        r'\bmasba7\b', r'\bmesbahe\b', r'\bsibaha\b',
    ],

    "spa": [
        r'\bspa\b', r'\bhammam\b', r'\bmassage\b', r'\bsoin\b',
        r'\bbeaute\b', r'\bbeauté\b', r'\bwellness\b', r'\bbien.?etre\b',
        r'\bsauna\b', r'\bvapeur\b', r'\bestheti(que|cien)\b',
        r'\brelaxation\b', r'\btherapie\b', r'\bhydrotherapie\b',
        r'\bjacuzzi\b.*\bspa\b', r'\bmasseur\b', r'\bmasseuse\b',
        r'\bkinesitherapie\b', r'\bgommage\b', r'\benveloppe\b.*\bcorps\b',
        r'\bsoins\b.*\bvisage\b', r'\bsoins\b.*\bcorps\b',
        r'\bmanucure\b', r'\bpedicure\b',
        r'\bspa\b.*\bferme\b', r'\bspa\b.*\bindisponible\b',
        r'\bspa\b.*\bcomplet\b', r'\bspa\b.*\bpanne\b',
        r'\bmassage\b.*\bmauvais\b', r'\bmassage\b.*\bdouloureux\b',
        r'\bhammam\b.*\bsale\b', r'\bhammam\b.*\bferme\b',
        r'\bhammam\b.*\btrop chaud\b', r'\bhammam\b.*\btrop froid\b',
        r'\bsauna\b.*\bpanne\b', r'\bsauna\b.*\bfroid\b',
        r'\bspa not available\b', r'\bbad massage\b', r'\bsteam room\b',
        r'\bspa\b.*\bclosed\b',
        r'\bsba\b', r'\bmasaj\b',
    ],

    "parking": [
        r'\bparking\b', r'\bvoiture\b', r'\bvehicule\b', r'\bvéhicule\b',
        r'\bgarer\b', r'\bstationnement\b', r'\bgarage\b', r'\bvalet\b',
        r'\bplace\b.*\bparking\b', r'\bparking\b.*\bplace\b',
        r'\bparking\b.*\bgratuit\b', r'\bparking\b.*\bpayant\b',
        r'\bsouterrain\b', r'\bparking\b.*\bsouterrain\b',
        r'\brayure\b', r'\bdommage\b.*\bvoiture\b', r'\baccident\b.*\bparking\b',
        r'\bparking\b.*\bplein\b', r'\bparking\b.*\bcomplet\b',
        r'\bplus de place\b.*\bparking\b', r'\bparking\b.*\bsature\b',
        r'\bparking\b.*\bsecurite\b', r'\bvol\b.*\bvoiture\b', r'\bvoiture\b.*\bvol\b',
        r'\bvoiture\b.*\bendommage\b', r'\bvoiture\b.*\bcasse\b',
        r'\bvoiture\b.*\bradye\b', r'\bvoiture\b.*\bgrifee\b',
        r'\bvoiture\b.*\baccident\b', r'\bvoiture\b.*\bdisparue\b',
        r'\bvalet\b.*\brayure\b', r'\bvalet\b.*\bdommage\b',
        r'\bfrais\b.*\bparking\b', r'\bparking\b.*\bfrais\b',
        r'\bcar park\b', r'\bparking lot\b', r'\bcar damaged\b',
        r'\bno parking\b', r'\bparking full\b',
        r'\bparkin\b', r'\bsayyara\b', r'\bwoquf\b',
    ],

    "service_reception": [
        r'\breception\b', r'\bréception\b', r'\baccueil\b', r'\bconcierg(e|erie)\b',
        r'\bcheck.?in\b', r'\bcheck.?out\b', r'\bfront.?desk\b',
        r'\bstaff\b', r'\bpersonnel\b', r'\breceptionniste\b',
        r'\bclef\b', r'\bcarte\b.*\bchambre\b', r'\bcle\b.*\bchambre\b',
        r'\bcarte magnetique\b',
        r'\bimpolie?\b', r'\bimpoliment\b', r'\bmauvais accueil\b',
        r'\battente\b.*\breception\b', r'\breception\b.*\battente\b',
        r'\bpersonnel\b.*\bimpoli\b', r'\bpersonnel\b.*\bnegligent\b',
        r'\bpersonnel\b.*\baggressif\b', r'\bpersonnel\b.*\bdesagreable\b',
        r'\bpersonnel\b.*\bpas aimable\b', r'\bpersonnel\b.*\bincompet(ent|ant)\b',
        r'\bstaff\b.*\bimpoli\b', r'\bstaff\b.*\brude\b',
        r'\bstaff\b.*\bnot helpful\b', r'\bstaff\b.*\bunfriendly\b',
        r'\baccueil\b.*\bmauvais\b', r'\baccueil\b.*\bdesagreable\b',
        r'\battente\b.*\bcheck.?in\b', r'\bcheck.?in\b.*\battente\b',
        r'\bchambre\b.*\bpas prete\b', r'\bchambre\b.*\bnon prete\b',
        r'\berreur\b.*\breservation\b', r'\breservation\b.*\berreur\b',
        r'\breservation\b.*\bperdue\b', r'\breservation\b.*\bintrouvable\b',
        r'\bclef\b.*\bmarche pas\b', r'\bcarte\b.*\bmarche pas\b',
        r'\bcle\b.*\bbloquee\b', r'\bcarte\b.*\bbloquee\b',
        r'\bfront desk\b', r'\breception staff\b', r'\bcheck.in\b.*\bproblem\b',
        r'\bunfriendly staff\b', r'\blong wait\b.*\breception\b',
        r'\bkey card\b', r'\brude receptionist\b',
        r'\brezeption\b', r'\bempfang\b', r'\baccettazione\b', r'\bricevimento\b',
        r'\bisti2bal\b', r'\brastiqbal\b',
    ],

    "service_menage": [
        r'\bmenage\b', r'\bménage\b', r'\bnettoyage\b.*\bchambre\b',
        r'\bchambre\b.*\bnettoyage\b', r'\bfemme de chambre\b',
        r'\bhousekeeping\b', r'\bhousekeeper\b', r'\bhomme de chambre\b',
        r'\bvalet de chambre\b', r'\bequipe menage\b',
        r'\bservice d.entretien\b', r'\bentretien\b.*\bchambre\b',
        r'\bserviette(s)?\b.*\bchange\b', r'\bchange\b.*\bserviette\b',
        r'\bdraps\b.*\bchange\b', r'\bchange\b.*\bdraps\b',
        r'\blinge\b.*\bchange\b', r'\bchange\b.*\blinge\b',
        r'\bserviette(s)?\b.*\bmanque\b', r'\bpas de serviette\b',
        r'\bmanque\b.*\bserviette\b',
        r'\bpas nettoy(e|é)\b', r'\bnon nettoy(e|é)\b',
        r'\bchambre\b.*\bpas nettoyee\b', r'\bchambre\b.*\bnon nettoyee\b',
        r'\bmenage\b.*\bpas fait\b', r'\bpas de menage\b',
        r'\bmenage\b.*\binsuffisant\b', r'\bmenage\b.*\bmauvais\b',
        r'\bchambre\b.*\bsales\b', r'\bchambre\b.*\bpas refaite\b',
        r'\bmenage\b.*\bsans frapper\b', r'\bentre sans frapper\b',
        r'\bsans prevenir\b.*\bchambre\b', r'\bintrusion\b.*\bchambre\b',
        r'\bmenage\b.*\bvol\b', r'\baffaires\b.*\bdeplaces\b',
        r'\baffaires\b.*\btouche\b',
        r'\broom not cleaned\b', r'\bdirty room\b.*\bhousekeeping\b',
        r'\bno towels\b', r'\btowels not replaced\b', r'\bsheets not changed\b',
        r'\bhousekeeping\b.*\bdid not come\b', r'\bentered without knocking\b',
        r'\bkhidmet\b.*\bndhafa\b', r'\bghassil\b.*\bghorfa\b',
    ],

    "service_securite": [
        r'\bsecurit(e|é)\b', r'\bgarde\b', r'\bvol\b', r'\bvole\b',
        r'\bdisparu\b', r'\bmanquant\b', r'\bcoffre.?fort\b',
        r'\bporte\b.*\bferme\b', r'\bporte\b.*\bverrou\b',
        r'\bsurveillance\b', r'\bcamera\b', r'\bintrus\b',
        r'\bmenace\b', r'\bdanger\b', r'\bagression\b',
        r'\bvideosurveillance\b', r'\bcctv\b',
        r'\bserrure\b.*\bcassee\b', r'\bserrure\b.*\bdefectueuse\b',
        r'\bserrure\b.*\bmarche pas\b', r'\bporte\b.*\bferme mal\b',
        r'\bporte\b.*\bbloquee\b', r'\bporte\b.*\bverrou\b.*\bcasse\b',
        r'\bcle\b.*\bdupliquee\b', r'\bcarte\b.*\bdupliquee\b',
        r'\bacceder\b.*\bchambre\b.*\binconnu\b', r'\binconnu\b.*\bchambre\b',
        r'\bpersonnes\b.*\bsuspectes\b', r'\bindividu\b.*\bsuspect\b',
        r'\bvol\b.*\baffaires\b', r'\baffaires\b.*\bvolees\b',
        r'\bargent\b.*\bvole\b', r'\bbijoux\b.*\bvole\b',
        r'\btelephone\b.*\bvole\b', r'\bordina(teur|trice)\b.*\bvole\b',
        r'\bsac\b.*\bvole\b', r'\bportefeuille\b.*\bvole\b',
        r'\bcoffre\b.*\bforce\b', r'\bcoffre\b.*\bouvert\b.*\binconnu\b',
        r'\bcoffre.?fort\b.*\bvole\b', r'\bcoffre.?fort\b.*\bprobleme\b',
        r'\bcoffre.?fort\b.*\bfonctionne pas\b',
        r'\bbagarre\b', r'\bconflit\b.*\bsecurite\b',
        r'\bmenace\b.*\bphysique\b', r'\bagression\b.*\bverbale\b',
        r'\bincident\b.*\bsecurite\b', r'\bsentir\b.*\bpas en securite\b',
        r'\bpas en securite\b', r'\bse sentir\b.*\bmenace\b',
        r'\btheft\b', r'\bstolen\b', r'\bsecurity\b.*\bissue\b',
        r'\bunlocked door\b', r'\bno security\b', r'\bfeeling unsafe\b',
        r'\bsafe\b.*\bnot working\b', r'\bbreak.?in\b',
        r'\bsariqa\b', r'\bmarqa\b', r'\bkhawf\b', r'\bamn\b.*\bproblem\b',
    ],

    "facturation": [
        r'\bfacture\b', r'\bfacturation\b', r'\bpaiement\b',
        r'\bcharge\b', r'\bdebit\b.*\bcarte\b', r'\bsurtaxe\b',
        r'\bsurcharge\b', r'\btaxe\b', r'\bfrais\b',
        r'\bmontant\b', r'\bprix\b.*\berreur\b', r'\berreur\b.*\bprix\b',
        r'\baddition\b', r'\bnote\b.*\bpayer\b', r'\bticket\b.*\bcaisse\b',
        r'\bfacturette\b', r'\brecu\b', r'\breceipt\b',
        r'\berreur\b.*\bfacture\b', r'\bfacture\b.*\berreur\b',
        r'\bmontant\b.*\bincorrect\b', r'\bfacture\b.*\bfaux\b',
        r'\bpaye\b.*\bplus\b', r'\btrop\b.*\bfacture\b',
        r'\bcharge\b.*\bdeux fois\b', r'\bdouble\b.*\bfacturation\b',
        r'\bdouble\b.*\bdebit\b', r'\bdebit\b.*\bdeux fois\b',
        r'\bdebite\b.*\bdeux fois\b', r'\bfrais\b.*\bnon\b.*\bconvenu\b',
        r'\bfrais\b.*\bcaches\b', r'\bfrais\b.*\bnon\b.*\bprevus\b',
        r'\bsurprise\b.*\bfacture\b', r'\bfrais\b.*\binattendu\b',
        r'\bfrais\b.*\binexplique\b', r'\bfrais\b.*\babusif\b',
        r'\bprix\b.*\baugmente\b', r'\bprix\b.*\bchange\b.*\barrivee\b',
        r'\bcarte bancaire\b.*\bproblem\b', r'\bpaiement\b.*\berreur\b',
        r'\bbilling error\b', r'\bovercharged\b', r'\bdouble charge\b',
        r'\bhidden fees\b', r'\bwrong amount\b', r'\binvoice\b.*\bwrong\b',
        r'\bcharged twice\b', r'\bunexpected charge\b',
        r'\bfatura\b', r'\bdaf3\b.*\bkhata\b', r'\bhisab\b.*\bghalt\b',
    ],

    "remboursement": [
        r'\bremboursement\b', r'\brembours(er|e)\b', r'\brefund\b',
        r'\bannulation\b', r'\bannuler\b', r'\bcancel\b',
        r'\bargent\b.*\bretour\b', r'\bretour\b.*\bargent\b',
        r'\bcompensation\b', r'\bindemnisation\b', r'\bgeste commercial\b',
        r'\bgeste\b.*\bclient\b', r'\bavoir\b', r'\bvoucher\b',
        r'\bremboursement\b.*\btrop long\b', r'\bremboursement\b.*\battendu\b',
        r'\bpas encore\b.*\brembourse\b', r'\btoujours pas\b.*\brembourse\b',
        r'\bremboursement\b.*\brefuse\b', r'\bremboursement\b.*\brejete\b',
        r'\bpas rembourse\b', r'\bnon rembourse\b', r'\bpas recu\b.*\bremboursement\b',
        r'\battendre\b.*\bremboursement\b', r'\bdelai\b.*\bremboursement\b',
        r'\bannulation\b.*\bremboursement\b', r'\bannule\b.*\bpas rembourse\b',
        r'\bpolitique\b.*\bannulation\b',
        r'\bcompensation\b.*\brefuse\b', r'\bindemnite\b', r'\bindemnisation\b',
        r'\bdedommageme(nt|nts)\b',
        r'\brefund not received\b', r'\brefund denied\b', r'\bno refund\b',
        r'\bcancellation policy\b', r'\brefund pending\b', r'\bcompensation denied\b',
        r'\basterja3\b', r'\birdja3\b.*\bflous\b', r'\bta3wid\b',
    ],

    "chambre": [
        r'\bchambre\b', r'\broom\b', r'\bsuite\b', r'\bappartement\b',
        r'\bbalcon\b', r'\bfenetre\b', r'\bfenêtre\b', r'\bporte\b',
        r'\bserrure\b', r'\bverrou\b', r'\bcle\b', r'\bclé\b',
        r'\bmeuble\b', r'\barmoire\b', r'\bplacard\b', r'\bbureau\b',
        r'\bmoquette\b', r'\brideaux\b', r'\bmiroir\b',
        r'\btable de nuit\b', r'\blampe de chevet\b',
        r'\bfrigo\b', r'\bminibar\b', r'\bcafetiere\b', r'\bbouilloire\b',
        r'\bcasier\b', r'\bcoffre\b', r'\bsafe\b.*\bchambre\b',
        r'\bconforme\b', r'\bpas conforme\b', r'\bnon conforme\b',
        r'\bchambre\b.*\bpas\b.*\breservee\b', r'\bchambre\b.*\bchangee\b',
        r'\bmauvaise chambre\b', r'\bchambre\b.*\bmauvaise\b',
        r'\bchambre\b.*\bdifferente\b', r'\bvue\b.*\bmer\b',
        r'\bvue\b.*\bpiscine\b', r'\bpas de vue\b', r'\bvue\b.*\bbloquee\b',
        r'\bchambre\b.*\btrop petite\b', r'\bchambre\b.*\bexigue\b',
        r'\bchambre\b.*\bmanque\b.*\bplace\b',
        r'\bchambre\b.*\bsombre\b', r'\bchambre\b.*\bpas\b.*\beclairee\b',
        r'\bchambre\b.*\bhumide\b', r'\bchambre\b.*\bodeur\b',
        r'\bchambre\b.*\bmauvaise odeur\b', r'\bmauvaise odeur\b.*\bchambre\b',
        r'\bfumeur\b.*\bchambre\b', r'\bno.?smoking\b', r'\bchambre\b.*\bfumeurs\b',
        r'\bbalcon\b.*\bsale\b', r'\bbalcon\b.*\bferme\b',
        r'\bfenetre\b.*\bferme mal\b', r'\bfenetre\b.*\bcassee\b',
        r'\bmeuble\b.*\bcasse\b', r'\bmeuble\b.*\bnon\b.*\bfonctionnel\b',
        r'\bfrigo\b.*\bpanne\b', r'\bminibar\b.*\bvide\b',
        r'\bcafetiere\b.*\bmarche pas\b', r'\bbouilloire\b.*\bpanne\b',
        r'\broom not as expected\b', r'\bwrong room type\b',
        r'\broom too small\b', r'\broom smells\b', r'\bdark room\b',
        r'\bno balcony\b', r'\broom upgrade\b',
        r'\bzimmer\b', r'\bcamera\b.*\bhotel\b', r'\bstanza\b',
        r'\bghorfa\b', r'\bgurfa\b', r'\bghurfa\b',
    ],
}

# ================================================================
# LABELS
# ================================================================
TYPE_LABELS = {
    "chambre":           "Chambre",
    "salle_de_bain":     "Salle de bain",
    "climatisation":     "Climatisation",
    "chauffage":         "Chauffage",
    "electricite":       "Électricité",
    "wifi":              "Wi-Fi & Internet",
    "television":        "Télévision",
    "bruit":             "Bruit & Nuisances",
    "proprete":          "Propreté",
    "literie":           "Literie & Confort",
    "restauration":      "Restauration",
    "petit_dejeuner":    "Petit-déjeuner",
    "room_service":      "Room Service",
    "piscine":           "Piscine",
    "spa":               "Spa & Hammam",
    "parking":           "Parking",
    "service_reception": "Service — Réception",
    "service_menage":    "Service — Ménage",
    "service_securite":  "Sécurité",
    "facturation":       "Facturation",
    "remboursement":     "Remboursement",
    "autre":             "Autre",
}

# ================================================================
# SCORING TYPE
# ================================================================
def score_text(text: str) -> dict:
    normalized = normalize(text)
    scores = {}
    for intent_type, patterns in INTENT_KEYWORDS.items():
        score = 0
        for pattern in patterns:
            matches = re.findall(pattern, normalized)
            if matches:
                weight = 1 + (len(pattern) / 20)
                score += len(matches) * weight
        if score > 0:
            scores[intent_type] = round(score, 2)
    return scores

PRIORITY_RULES = [
    ({"wifi", "chambre"},              "wifi"),
    ({"climatisation", "chambre"},     "climatisation"),
    ({"chauffage", "chambre"},         "chauffage"),
    ({"salle_de_bain", "chambre"},     "salle_de_bain"),
    ({"electricite", "chambre"},       "electricite"),
    ({"proprete", "chambre"},          "proprete"),
    ({"literie", "chambre"},           "literie"),
    ({"bruit", "chambre"},             "bruit"),
    ({"television", "chambre"},        "television"),
    ({"remboursement", "facturation"}, "remboursement"),
    ({"petit_dejeuner", "restauration"},"petit_dejeuner"),
    ({"room_service", "restauration"}, "room_service"),
    ({"service_menage", "proprete"},   "service_menage"),
    ({"service_menage", "chambre"},    "service_menage"),
    ({"service_securite", "chambre"},  "service_securite"),
    ({"parking", "chambre"},           "parking"),
    ({"chauffage", "climatisation"},   "chauffage"),
    ({"facturation", "remboursement"}, "remboursement"),
    ({"room_service", "chambre"},      "room_service"),
]

def apply_priority_rules(scores: dict):
    detected_types = set(scores.keys())
    for required_types, winner in PRIORITY_RULES:
        if required_types.issubset(detected_types):
            return winner, scores.get(winner, 0)
    return None, 0

def detect_type(description: str) -> dict:
    if not description or not description.strip():
        return {
            "type":       "autre",
            "confidence": 0.0,
            "label":      TYPE_LABELS["autre"],
            "all_scores": {}
        }

    scores = score_text(description)

    if not scores:
        return {
            "type":       "autre",
            "confidence": 0.5,
            "label":      TYPE_LABELS["autre"],
            "all_scores": scores
        }

    priority_type, priority_score = apply_priority_rules(scores)
    if priority_type:
        best_type  = priority_type
        best_score = priority_score
    else:
        best_type  = max(scores, key=scores.get)
        best_score = scores[best_type]

    total      = sum(scores.values())
    confidence = round(best_score / total, 2) if total > 0 else 0.5

    if confidence < 0.20:
        best_type  = "autre"
        confidence = 0.5

    return {
        "type":       best_type,
        "confidence": confidence,
        "label":      TYPE_LABELS.get(best_type, TYPE_LABELS["autre"]),
        "all_scores": scores
    }


# ================================================================
# ████  URGENCE v4 — SCORING MULTI-AXE AMÉLIORÉ  ████
# ================================================================

# ── AXE 1 : GRAVITÉ (×3) — physique, criminalité, sinistres ─────
URGENCY_GRAVITY = [
    # Urgence médicale
    (r'\burgence\b',                     4.0),
    (r'\bemergency\b',                   4.0),
    (r'\bsos\b',                         4.0),
    (r'\bau secours\b',                  4.0),
    (r'\baidez.?moi\b',                  3.5),
    (r'\bhelp.*now\b',                   3.5),
    (r'\bnotfall\b',                     4.0),
    (r'\bemergenza\b',                   4.0),
    (r'\btawari\b',                      4.0),
    # Danger physique
    (r'\bdanger\b',                      3.5),
    (r'\bdangereux\b',                   3.5),
    (r'\bdangerous\b',                   3.5),
    (r'\bgrave\b.*\bprobleme\b',         2.5),
    (r'\bprobleme\b.*\bgrave\b',         2.5),
    (r'\bserieux\b.*\bprobleme\b',       2.0),
    (r'\bsituation\b.*\bgrave\b',        2.5),
    # Blessures
    (r'\bbless(e|u|ure)\b',              3.5),
    (r'\binjured?\b',                    3.5),
    (r'\bwounded?\b',                    3.5),
    (r'\bbrul(e|ure)\b',                 3.5),
    (r'\bburn(ed|ing)?\b',               3.5),
    (r'\belectrocution\b',               4.0),
    (r'\belectric shock\b',              4.0),
    (r'\bchoc electrique\b',             4.0),
    (r'\bperte de connaissance\b',       4.0),
    (r'\bunconsciou(s|sness)\b',         4.0),
    (r'\bevanoui(e)?\b',                 4.0),
    (r'\bfainted?\b',                    4.0),
    (r'\bcoma\b',                        4.0),
    # Médecins / secours
    (r'\bambulance\b',                   4.0),
    (r'\bampulance\b',                   4.0),
    (r'\bpompier\b',                     4.0),
    (r'\bfirefighter\b',                 4.0),
    (r'\bsamu\b',                        4.0),
    (r'\bsecours\b',                     3.5),
    (r'\bmedecin\b',                     3.0),
    (r'\bdocteur\b',                     3.0),
    (r'\binfirmier(e)?\b',              3.0),
    (r'\bhospitalis(e|e|ation)\b',       4.0),
    (r'\bhospital\b',                    4.0),
    (r'\bkrankenhaus\b',                 4.0),
    (r'\bospedale\b',                    4.0),
    # Mort
    (r'\bdead\b',                        4.0),
    (r'\bdecede\b',                      4.0),
    (r'\bdeath\b',                       4.0),
    (r'\bmort\b',                        3.5),
    # Incendie / feu
    (r'\bfire\b',                        4.0),
    (r'\bfeu\b',                         4.0),
    (r'\bincendie\b',                    4.0),
    (r'\bflames?\b',                     4.0),
    (r'\bfumee\b',                       3.5),
    (r'\bsmoke\b',                       3.5),
    (r'\bfeuer\b',                       4.0),
    (r'\bfuoco\b',                       4.0),
    (r'\bharik\b',                       4.0),
    (r'\b7arik\b',                       4.0),
    # Gaz
    (r'\bodeur.*gaz\b',                  4.0),
    (r'\bgaz.*fuite\b',                  4.0),
    (r'\bgas.*leak\b',                   4.0),
    (r'\bgas.*smell\b',                  4.0),
    (r'\bgasgeruch\b',                   4.0),
    # Inondation
    (r'\bflood(ing|ed)?\b',              4.0),
    (r'\binondation\b',                  4.0),
    (r'\beau partout\b',                 3.5),
    (r'\bwater everywhere\b',            3.5),
    (r'\bplafond\b.*\beffondre\b',       4.0),
    (r'\beffondrement\b',                4.0),
    (r'\bcollapse\b',                    4.0),
    (r'\beinflutung\b',                  4.0),
    (r'\ballagamento\b',                 4.0),
    # Danger électrique
    (r'\bspark(s|ing)?\b',               3.5),
    (r'\betincel(les?|ant)\b',           3.5),
    (r'\bprise.*fume\b',                 3.5),
    (r'\boutlet.*smoke\b',               3.5),
    (r'\bcourt.circuit\b',               3.5),
    (r'\bshort circuit\b',               3.5),
    (r'\bkurzschluss\b',                 3.5),
    # Criminalité
    (r'\bagression\b',                   4.0),
    (r'\bassault(ed)?\b',                4.0),
    (r'\battack(ed)?\b',                 4.0),
    (r'\battaque\b',                     4.0),
    (r'\bviolen(ce|t|te)\b',            4.0),
    (r'\bharcele(e|ment)?\b',           3.5),
    (r'\bintru(s|sion)\b',              3.5),
    (r'\beffraction\b',                  3.5),
    (r'\bcoffre.?fort.*force\b',         4.0),
    (r'\bsafe.*broken into\b',           4.0),
    (r'\bbreak.?in\b',                   4.0),
    (r'\bsariqa\b',                      3.5),
    # Empoisonnement
    (r'\bpoisoning\b',                   4.0),
    (r'\bempoisonnement\b',              4.0),
    (r'\bintoxication.*alimentaire\b',   4.0),
    (r'\bfood poison\b',                 4.0),
    (r'\bvergift(ung|et)\b',            4.0),
    (r'\bintossicazione\b',              4.0),
    # Nuisibles graves
    (r'\bbedbugs?\b',                    3.5),
    (r'\bpunaise.*lit\b',                3.5),
    (r'\blit.*punaise\b',                3.5),
    (r'\bwanzen\b',                      3.5),
    (r'\binfest(e|ation|ed)\b',          3.5),
    (r'\bvermine\b',                     3.5),
    (r'\brat(s)?\b',                     3.5),
    (r'\bsouris.*chambre\b',             3.5),
    # Vol
    (r'\btheft\b',                       3.5),
    (r'\bstolen\b',                      3.5),
    (r'\bburglary\b',                    3.5),
    (r'\bvol\b',                         2.5),
    (r'\bvole\b',                        2.5),
    (r'\bvoleur\b',                      3.0),
    (r'\bbijoux\b.*\bvole\b',           3.5),
    (r'\bargent\b.*\bvole\b',           3.5),
    (r'\btelephone\b.*\bvole\b',        3.5),
    (r'\bsac\b.*\bvole\b',              3.0),
    (r'\bportefeuille\b.*\bvole\b',     3.0),
    # Sang
    (r'\bblood\b',                       4.0),
    (r'\bsang\b',                        4.0),
    (r'\bbleed(ing)?\b',                 4.0),
    (r'\bblute(n|nd)?\b',               4.0),
    (r'\bsangue\b',                      4.0),
]

# ── AXE 2 : IMPACT CLIENT (×2) ──────────────────────────────────
URGENCY_IMPACT = [
    # Nuit / sommeil impossible
    (r'\bpas dormi\b',                   3.0),
    (r'\bpas pu dormir\b',               3.0),
    (r'\binsomnie\b',                    2.5),
    (r'\bnuit blanche\b',                3.0),
    (r'\breveille\b.*\bnuit\b',          2.5),
    (r'\bnuit\b.*\breveille\b',          2.5),
    (r'\bnuit\b.*\bhorrible\b',          2.5),
    (r'\bsommeil\b.*\bimpossible\b',     3.0),
    (r"\bcouldn.?t sleep\b",             3.0),
    (r'\bkept awake\b',                  3.0),
    (r'\bno sleep\b',                    3.0),
    (r'\bslept badly\b',                 2.0),
    # Conditions dégradées
    (r'\bpas d.eau\b',                   2.5),
    (r'\bpas d.electricite\b',           2.5),
    (r'\bpas de chauffage\b',            2.5),
    (r'\bpas de climatisation\b',        2.0),
    (r'\bon gele\b',                     2.5),
    (r'\bon etouffe\b',                  2.5),
    (r'\bsuffoque\b',                    2.5),
    (r'\btouffant\b',                    2.0),
    (r'\bgele\b.*\bnuit\b',             2.5),
    (r'\bfroid\b.*\bextrem\b',           2.5),
    (r'\bchaleur\b.*\binsupportable\b',  2.5),
    (r'\bchambre\b.*\binutilisable\b',   2.5),
    (r'\binutilisable\b',                2.5),
    (r'\bno water\b',                    2.5),
    (r'\bno electricity\b',              2.5),
    (r'\bno heating\b',                  2.5),
    (r'\bfreezing\b',                    2.5),
    (r'\bboiling\b.*\broom\b',           2.5),
    (r'\bunlivable\b',                   3.0),
    # Enfants / vulnérables
    (r'\benfant\b.*\bmalade\b',          3.5),
    (r'\bbebe\b.*\bfroid\b',             3.5),
    (r'\bbebe\b.*\bchaud\b',             3.5),
    (r'\bpersonne agee\b.*\bprobleme\b', 3.0),
    (r'\bhandicap(e|é)\b.*\bprobleme\b', 3.0),
    (r'\bchild\b.*\bsick\b',             3.5),
    (r'\bbaby\b.*\bcold\b',              3.5),
    # Émotion forte
    (r'\binacceptable\b',                2.0),
    (r'\bindigne\b',                     2.0),
    (r'\bscandaleux\b',                  2.0),
    (r'\bscandale\b',                    2.0),
    (r'\bhonteux\b',                     1.5),
    (r'\bdesastreux\b',                  2.0),
    (r'\bdesastre\b',                    2.0),
    (r'\bchoquant\b',                    1.5),
    (r'\bfurieux\b',                     1.5),
    (r'\bfurieus(e|es)\b',              1.5),
    (r'\bunacceptable\b',                2.0),
    (r'\boutrageous\b',                  2.0),
    (r'\bdisgusting\b',                  1.5),
    (r'\bshocking\b',                    1.5),
    (r'\bdisgrace\b',                    1.5),
    (r'\bscandal\b',                     2.0),
    (r'\bappalling\b',                   2.0),
    (r'\bfurious\b',                     1.5),
    (r'\boutraged\b',                    1.5),
    # Plainte formelle / juridique
    (r'\bplainte\b.*\bformelle\b',       2.5),
    (r'\bplainte\b.*\bofficielle\b',     2.5),
    (r'\bporter\b.*\bplainte\b',         2.5),
    (r'\bprocedure\b.*\bjuridique\b',    2.5),
    (r'\bavoc(at|ate)\b',                2.5),
    (r'\bpresse\b.*\bcontacter\b',       2.0),
    (r'\btripadvisor\b',                 2.0),
    (r'\bgoogle\b.*\bavis\b',            1.5),
    (r'\bavis\b.*\bnegatif\b',           1.5),
    (r'\bfiling\b.*\bcomplaint\b',       2.5),
    (r'\bsuing\b',                       2.5),
    (r'\blawyer\b',                      2.5),
    (r'\blegal\b.*\baction\b',           2.5),
    # Attente excessive
    (r'\battente\b.*\binacceptable\b',   2.0),
    (r'\battente\b.*\btrop longue\b',    2.0),
    (r'\battente\b.*\bdes heures\b',     2.5),
    (r'\bdes heures\b.*\battente\b',     2.5),
    (r'\bheures\b.*\battendre\b',        2.5),
    (r'\bplusieurs heures\b',            2.5),
    (r'\bwaited hours\b',                2.5),
    (r'\bwaiting hours\b',               2.5),
    # Nourriture / santé (hors triggers critiques)
    (r'\bnourriture\b.*\bperi(mee|me)\b', 3.0),
    (r'\bnourriture\b.*\bavar(iee|ie)\b', 3.0),
    (r'\bnourriture\b.*\bcrue\b',         2.5),
    (r'\bundercooked\b',                  2.5),
    (r'\bvomissements?\b',                3.0),
    (r'\bvomit(ing|e)?\b',               3.0),
    (r'\bdiarrhee\b',                     3.0),
    (r'\bnausees?\b',                     2.5),
]

# ── AXE 3 : TEMPORALITÉ (×1.5) ──────────────────────────────────
URGENCY_TEMPORAL = [
    # Durée
    (r'\bdepuis\b.*\bjour(s)?\b',        2.0),
    (r'\bjour(s)?\b.*\bque\b.*\bprobleme\b', 2.0),
    (r'\bdepuis\b.*\bnuit(s)?\b',        2.0),
    (r'\bdepuis\b.*\bheure(s)?\b',       1.5),
    (r'\bdepuis\b.*\bsemaine(s)?\b',     2.5),
    (r'\bplusieurs\b.*\bjour(s)?\b',     2.0),
    (r'\btoujours\b.*\bpas\b.*\bregle\b',2.0),
    (r'\bpas encore\b.*\bregle\b',       2.0),
    (r'\bpas encore\b.*\brepare\b',      2.0),
    (r'\bdeja\b.*\bsignale\b',           2.0),
    (r'\bdeja\b.*\bdit\b',               1.5),
    (r'\bdeja\b.*\bappele\b',            1.5),
    (r'\brepete\b.*\bfois\b',            2.0),
    (r'\bfois\b.*\bdemande\b',           1.5),
    (r'\bplusieurs fois\b',              2.0),
    (r'\b2 fois\b',                      1.5),
    (r'\b3 fois\b',                      2.0),
    (r'\btroisieme\b.*\bfois\b',         2.5),
    (r'\bfor days\b',                    2.0),
    (r'\bfor hours\b',                   1.5),
    (r'\bfor nights\b',                  2.0),
    (r'\bsince yesterday\b',             1.5),
    (r'\bsince this morning\b',          1.5),
    (r'\bstill not\b.*\bfixed\b',        2.0),
    (r'\bnot yet\b.*\bfixed\b',          2.0),
    (r'\btold them\b.*\balready\b',      2.0),
    (r'\breported\b.*\btimes\b',         2.0),
    # Moment critique (nuit)
    (r'\bnuit\b',                        1.5),
    (r'\bce soir\b',                     1.5),
    (r'\bcette nuit\b',                  2.0),
    (r'\bminuit\b',                      2.0),
    (r'\btard\b.*\bsoir\b',             1.5),
    (r'\bsoir\b.*\btard\b',             1.5),
    (r'\blast night\b',                  1.5),
    (r'\btonight\b',                     1.5),
    (r'\bmidnight\b',                    2.0),
    (r'\bthis evening\b',                1.5),
    # Escalade
    (r'\bagrave\b',                      2.0),
    (r'\bempir(e|ant)\b',               2.0),
    (r'\bde pire en pire\b',             2.5),
    (r'\bpire que\b.*\bhier\b',          2.0),
    (r'\btoujours le meme\b',            1.5),
    (r'\brecidiv(e|ant)\b',              2.0),
    (r'\bgetting worse\b',               2.0),
    (r'\bstill happening\b',             1.5),
    (r'\bkeep happening\b',              1.5),
]


def score_urgency(text: str) -> dict:
    """
    Scoring d'urgence v4 :
      1. Vérifie les CRITICAL_TRIGGERS → court-circuit immédiat Élevée
      2. Scoring pondéré sur 3 axes avec poids individuels par pattern
      3. Seuillage adaptatif (seuils abaissés vs v3)
    """
    normalized = normalize(text)

    # ── ÉTAPE 1 : vérification triggers critiques ────────────────
    triggered = check_critical_triggers(normalized)
    if triggered:
        # Calculer quand même les axes pour la transparence
        ag = ai = at = 0.0
        for pattern, weight in URGENCY_GRAVITY:
            if re.search(pattern, normalized):
                ag += weight * 3.0
        for pattern, weight in URGENCY_IMPACT:
            if re.search(pattern, normalized):
                ai += weight * 2.0
        for pattern, weight in URGENCY_TEMPORAL:
            if re.search(pattern, normalized):
                at += weight * 1.5

        total = round(ag + ai + at, 2)
        # Force à la valeur minimale pour Élevée
        if total < 8.0:
            total = 8.0 + len(triggered) * 2.0
            ag = total * 0.7 if ag == 0 else ag

        return {
            "urgence":            "Élevée",
            "urgence_score":      round(total, 2),
            "urgence_confidence": 1.0,
            "axis_gravity":       round(ag, 2),
            "axis_impact":        round(ai, 2),
            "axis_temporal":      round(at, 2),
            "urgence_triggered_by": triggered,
        }

    # ── ÉTAPE 2 : scoring classique ──────────────────────────────
    ag = 0.0
    ai = 0.0
    at = 0.0

    for pattern, weight in URGENCY_GRAVITY:
        matches = re.findall(pattern, normalized)
        if matches:
            ag += len(matches) * weight * 3.0

    for pattern, weight in URGENCY_IMPACT:
        matches = re.findall(pattern, normalized)
        if matches:
            ai += len(matches) * weight * 2.0

    for pattern, weight in URGENCY_TEMPORAL:
        matches = re.findall(pattern, normalized)
        if matches:
            at += len(matches) * weight * 1.5

    total_score = round(ag + ai + at, 2)

    # Seuils (abaissés vs v3 pour plus de sensibilité)
    if total_score >= 6.0:
        urgence = "Élevée"
    elif total_score >= 2.5:
        urgence = "Moyenne"
    else:
        urgence = "Faible"

    dominant   = max(ag, ai, at)
    confidence = round(dominant / total_score, 2) if total_score > 0 else 0.5

    return {
        "urgence":              urgence,
        "urgence_score":        total_score,
        "urgence_confidence":   confidence,
        "axis_gravity":         round(ag, 2),
        "axis_impact":          round(ai, 2),
        "axis_temporal":        round(at, 2),
        "urgence_triggered_by": [],
    }


# ================================================================
# BOOST PAR TYPE
# ================================================================
TYPE_URGENCY_BOOST = {
    "service_securite": "Élevée",
    "electricite":      "Moyenne",
    "chauffage":        "Moyenne",
    "climatisation":    "Moyenne",
    "salle_de_bain":    "Moyenne",
    "wifi":             "Faible",
    "television":       "Faible",
    "parking":          "Faible",
    "spa":              "Faible",
    "petit_dejeuner":   "Faible",
}

URGENCY_ORDER = {"Faible": 0, "Moyenne": 1, "Élevée": 2}

def apply_urgency_boost(urgence_result: dict, detected_type: str) -> dict:
    boost = TYPE_URGENCY_BOOST.get(detected_type)
    if boost and URGENCY_ORDER.get(boost, 0) > URGENCY_ORDER.get(urgence_result["urgence"], 0):
        urgence_result = dict(urgence_result)
        urgence_result["urgence"]            = boost
        urgence_result["urgence_boosted_by"] = detected_type
    return urgence_result


# ================================================================
# FONCTION PRINCIPALE
# ================================================================
def detect_full(description: str) -> dict:
    type_result    = detect_type(description)
    urgence_result = score_urgency(description)
    urgence_result = apply_urgency_boost(urgence_result, type_result["type"])

    return {
        "type":       type_result["type"],
        "confidence": type_result["confidence"],
        "label":      type_result["label"],
        # Urgence
        "urgence":              urgence_result["urgence"],
        "urgence_score":        urgence_result["urgence_score"],
        "urgence_confidence":   urgence_result["urgence_confidence"],
        "axis_gravity":         urgence_result["axis_gravity"],
        "axis_impact":          urgence_result["axis_impact"],
        "axis_temporal":        urgence_result["axis_temporal"],
        "urgence_boosted_by":   urgence_result.get("urgence_boosted_by"),
        "urgence_triggered_by": urgence_result.get("urgence_triggered_by", []),
        # Debug
        "all_scores": type_result.get("all_scores", {}),
    }


# ================================================================
# ROUTES FLASK
# ================================================================
@app.route('/detect_type', methods=['POST'])
def detect_type_route():
    data        = request.get_json(force=True, silent=True) or {}
    description = data.get('description', '').strip()

    if not description:
        return jsonify({
            "type":       "autre",
            "confidence": 0.0,
            "label":      TYPE_LABELS["autre"],
            "urgence":    "Faible",
            "error":      "description vide"
        }), 400

    result = detect_full(description)
    return jsonify(result)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status":  "ok",
        "service": "reclamation-ml",
        "version": "4.0"
    })


# ================================================================
# TESTS LOCAUX v4
# ================================================================
if __name__ == '__main__':

    URGENCY_LABELS = {"Faible": "🟢", "Moyenne": "🟡", "Élevée": "🔴"}

    TESTS = [
        # ── Triggers directs simples (cas qui échouaient en v3) ─
        ("There is fire in my room",              "Élevée"),
        ("There is blood everywhere",             "Élevée"),
        ("Fire!",                                  "Élevée"),
        ("Blood!",                                 "Élevée"),
        ("I see smoke",                            "Élevée"),
        ("Flooding in the bathroom",               "Élevée"),
        ("I smell gas",                            "Élevée"),
        ("Gas leak",                               "Élevée"),
        ("Help me now",                            "Élevée"),
        ("Emergency please",                       "Élevée"),
        ("SOS",                                    "Élevée"),
        ("My child is injured",                    "Élevée"),
        ("I am bleeding",                          "Élevée"),
        ("Electric shock from the outlet",         "Élevée"),
        ("Il y a du feu dans ma chambre",          "Élevée"),
        ("Il y a du sang",                         "Élevée"),
        ("Au secours !",                           "Élevée"),
        ("Incendie dans le couloir",               "Élevée"),
        ("J'ai été électrocuté",                   "Élevée"),
        ("Inondation dans la chambre",             "Élevée"),
        ("Odeur de gaz dans la chambre",           "Élevée"),
        ("Mon enfant s'est blessé",                "Élevée"),
        ("Je me suis évanoui",                     "Élevée"),
        ("Nos bijoux ont été volés du coffre forcé","Élevée"),
        ("Agression physique dans le parking",     "Élevée"),
        ("There are bedbugs in the bed",           "Élevée"),
        ("Punaises de lit partout",                "Élevée"),
        ("Des rats dans la chambre",               "Élevée"),
        ("Intoxication alimentaire après le dîner","Élevée"),
        ("Food poisoning after dinner",            "Élevée"),
        ("Sparks from the electrical outlet",      "Élevée"),
        ("Short circuit in the room",              "Élevée"),
        ("The room is collapsing",                 "Élevée"),
        # Arabe translittéré
        ("Harik fi lghurfa",                       "Élevée"),
        ("Sariqa — disparition de mes affaires",   "Élevée"),
        ("Tawari, urgence !",                       "Élevée"),
        # ── Élevée par scoring (pas trigger seul) ───────────────
        ("Je suis furieux, cela fait 3 nuits que je ne dors pas à cause du bruit des voisins", "Élevée"),
        ("Chambre inutilisable, enfant malade, besoin d'aide",  "Élevée"),
        ("I filed a formal complaint, my baby is freezing",     "Élevée"),
        # ── Moyenne ─────────────────────────────────────────────
        ("Il fait une chaleur étouffante, la clim est en panne","Moyenne"),
        ("Pas d'eau chaude depuis hier matin",                  "Moyenne"),
        ("Le bruit des voisins nous a empêchés de dormir",      "Moyenne"),
        ("Ce problème persiste depuis 3 jours — inacceptable",  "Moyenne"),
        ("The AC is broken and room is too warm",               "Moyenne"),
        # ── Faible ──────────────────────────────────────────────
        ("Le wifi ne fonctionne pas dans ma chambre",           "Faible"),
        ("La télécommande TV est cassée",                       "Faible"),
        ("Le buffet du petit-déjeuner manquait de croissants",  "Faible"),
        ("La piscine est fermée",                               "Faible"),
        ("J'ai attendu 30 minutes à la réception",              "Faible"),
    ]

    print("=" * 72)
    print("TESTS URGENCE — v4.0  Royal Mansour Iberostar")
    print("=" * 72)

    passed = failed = 0
    for desc, expected in TESTS:
        r      = detect_full(desc)
        got    = r["urgence"]
        ok     = got == expected
        passed += ok
        failed += not ok
        icon   = "✓" if ok else "✗"
        trig   = r.get("urgence_triggered_by", [])
        trig_s = " [TRIGGER: " + ", ".join(trig[:3]) + "]" if trig else ""
        boost  = f" [BOOST: {r['urgence_boosted_by']}]" if r.get('urgence_boosted_by') else ""

        print(f"\n{icon} {desc[:65]}")
        print(f"   Type    : {r['type']:20s}")
        print(f"   Urgence : {URGENCY_LABELS[got]} {got:8s}  score={r['urgence_score']:5.1f}  "
              f"(G={r['axis_gravity']:.1f} I={r['axis_impact']:.1f} T={r['axis_temporal']:.1f})"
              + trig_s + boost
              + (f"  ← ✗ attendu: {expected}" if not ok else ""))

    print(f"\n{'='*72}")
    print(f"Résultat : {passed}/{passed+failed} tests réussis ({100*passed//(passed+failed)}%)")
    print(f"{'='*72}")

    app.run(debug=True, port=5001)