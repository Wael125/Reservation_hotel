"""
reclamation.py — Détection d'intention ML pour les réclamations
Royal Mansour Iberostar — Mahdia, Tunisie

Endpoint Flask : POST /detect_type
Body JSON      : { "description": "texte de la réclamation" }
Réponse JSON   : { "type": "wifi", "confidence": 0.92, "label": "Wi-Fi & Internet" }

v2.0 — Base de mots-clés étendue (FR / AR translittéré / EN / IT / DE)
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import re
import unicodedata

app = Flask(__name__)
CORS(app)

# ================================================================
# BASE DE CONNAISSANCES — MOTS-CLÉS PAR TYPE
# Chaque type = liste de patterns (regex ou mots-clés)
# Ordre = priorité (le plus spécifique en premier)
# ================================================================
INTENT_KEYWORDS = {

    # ── WIFI ─────────────────────────────────────────────────────
    "wifi": [
        # Termes techniques directs
        r'\bwi.?fi\b', r'\binternet\b', r'\bconnexion\b', r'\breseau\b',
        r'\bsignal\b', r'\bdebit\b', r'\bbande passante\b', r'\bip\b',
        r'\bwireless\b', r'\bconnect(er|e|ion)?\b', r'\bnavigation\b',
        r'\brouter\b', r'\bbox\b', r'\bmodem\b', r'\bfirewall\b',
        r'\blatence\b', r'\bping\b', r'\bbandwidth\b', r'\blan\b',
        # Problèmes courants
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
        # Anglais
        r'\bno wifi\b', r'\bwifi down\b', r'\bslow internet\b',
        r'\bno internet\b', r'\binternet not working\b', r'\bwifi password\b',
        r'\bcannot connect\b', r'\bunstable connection\b',
        # Arabe translittéré
        r'\bwayfi\b', r'\bintirnet\b', r'\bconnexyon\b',
    ],

    # ── CLIMATISATION ────────────────────────────────────────────
    "climatisation": [
        # Termes directs
        r'\bclimatis(ation|eur|er|e)\b', r'\bclim\b', r'\bair condit(ionn)?e?\b',
        r'\bventil(ateur|ation)\b', r'\bac\b', r'\breglage temperature\b',
        r'\bthermostat\b', r'\bsplit\b', r'\bconditionnement\b',
        # Problèmes de température
        r'\bfroid\b.*\bchambre\b', r'\bchambre\b.*\bfroid\b',
        r'\btemperature\b.*\bchambre\b', r'\btrop chaud\b', r'\btrop froid\b',
        r'\bchambre\b.*\bchaud\b', r'\bchambre\b.*\bsurchauff(e|é)\b',
        r'\btouffant\b', r'\btouffante\b', r'\bsuffocant\b', r'\bethuffant\b',
        r'\bon etouffe\b', r'\bon suffoque\b', r'\bair irrespirable\b',
        r'\bchambre\b.*\bgelée?\b', r'\bchambre\b.*\bglaciale?\b',
        r'\btemperature\b.*\bregler\b', r'\bregler\b.*\btemperature\b',
        r'\btemperature\b.*\bcontroler\b', r'\btemperature\b.*\bcontrole\b',
        # Pannes / bruits
        r'\bclim\b.*\bne fonctionne pas\b', r'\bclim\b.*\bmarche pas\b',
        r'\bclim\b.*\bpanne\b', r'\bclim\b.*\bbruit\b', r'\bclim\b.*\bbruyante\b',
        r'\bclim\b.*\bdrip\b', r'\bclim\b.*\bfuite\b', r'\bclim\b.*\bgoutter\b',
        r'\bclim\b.*\bgouttiere\b', r'\bclim\b.*\bmoisissure\b',
        r'\bair conditionne\b.*\bpanne\b', r'\bair conditionne\b.*\bmarche pas\b',
        r'\bventilateur\b.*\bbruyant\b', r'\bventilateur\b.*\bpanne\b',
        r'\bventilateur\b.*\bcasse\b', r'\boutput\b.*\bfroid\b',
        # Anglais
        r'\bair conditioning\b', r'\bac not working\b', r'\bac broken\b',
        r'\bac too cold\b', r'\bac too hot\b', r'\broom temperature\b',
        r'\btoo warm\b', r'\btoo cool\b', r'\boverheating\b',
        # Allemand / Italien
        r'\bklima\b', r'\bklimaanlage\b', r'\bcondizionatore\b',
        # Arabe translittéré
        r'\btakyi(f|if)\b', r'\bklima\b', r'\bbared\b.*\bghorfa\b',
    ],

    # ── CHAUFFAGE ────────────────────────────────────────────────
    "chauffage": [
        # Termes directs
        r'\bchauffage\b', r'\bradiateur\b', r'\bchauffa(nt|ge)\b',
        r'\bchauffer\b', r'\bcalorifere\b', r'\bconvecteur\b',
        r'\bpompe a chaleur\b', r'\bplancher chauffant\b',
        # Problèmes
        r'\bpas de chaleur\b', r'\bfroid la nuit\b', r'\bfroid\b.*\bnuit\b',
        r'\bnuit\b.*\bfroid\b', r'\bchambre\b.*\bfroid(e)?\b',
        r'\bchambre\b.*\bgelée?\b', r'\bchambre\b.*\bglaciale?\b',
        r'\bhibern(ation|er)?\b', r'\bhiver\b.*\bfroid\b',
        r'\bradiateur\b.*\bfroid\b', r'\bradiateur\b.*\bmarche pas\b',
        r'\bradiateur\b.*\bpanne\b', r'\bradiateur\b.*\bne chauffe pas\b',
        r'\bradiateur\b.*\beteint\b', r'\bchauffage\b.*\bpanne\b',
        r'\bchauffage\b.*\bmarche pas\b', r'\bchauffage\b.*\bne fonctionne pas\b',
        r'\bchauffage\b.*\bcasse\b', r'\bchauffage\b.*\beteint\b',
        r'\bon gele\b', r'\bje gele\b', r'\bil fait\b.*\bfroid\b',
        r'\btemperature\b.*\btrop basse\b', r'\bfrigide\b',
        # Anglais
        r'\bno heating\b', r'\bheating broken\b', r'\bheater not working\b',
        r'\bno heat\b', r'\broom is cold\b', r'\bfreezing room\b',
        # Allemand / Italien
        r'\bheizung\b', r'\briscaldamento\b',
        # Arabe translittéré
        r'\bdafa\b', r'\btadfi2a\b', r'\bghorfa\b.*\bbarda\b',
    ],

    # ── ÉLECTRICITÉ ──────────────────────────────────────────────
    "electricite": [
        # Termes directs
        r'\belectricit(e|é)\b', r'\bprise\b', r'\bpanne\b',
        r'\bcourant\b', r'\blumiere\b', r'\blumière\b', r'\blampe\b',
        r'\binterrupteur\b', r'\bfusible\b', r'\belectrique\b',
        r'\bcourt.circuit\b', r'\bvoltage\b', r'\bdisjoncteur\b',
        r'\bprise electrique\b', r'\bsocket\b', r'\bplug\b',
        r'\bambiance\b.*\belectrique\b', r'\belectricite\b.*\bproblem\b',
        r'\bprise\b.*\busb\b', r'\busb\b.*\bcharge\b', r'\bchargeur\b',
        r'\bcharger\b', r'\balimentation\b', r'\btension\b',
        # Problèmes
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
        # Anglais
        r'\bno electricity\b', r'\bpower outage\b', r'\boutlet not working\b',
        r'\bno power\b', r'\belectric\b.*\bproblem\b', r'\blight\b.*\bnot working\b',
        # Allemand / Italien
        r'\bstrom\b', r'\bsteckdose\b', r'\belettricita\b', r'\bpresa\b',
        # Arabe translittéré
        r'\bkahraba\b', r'\bprise\b.*\btahdim\b',
    ],

    # ── TÉLÉVISION ───────────────────────────────────────────────
    "television": [
        # Termes directs
        r'\btele(vision)?\b', r'\btv\b', r'\becran\b', r'\bchaine\b',
        r'\bprogramme\b', r'\btelecommande\b', r'\bhdmi\b',
        r'\bcable\b.*\btv\b', r'\bsatellite\b', r'\bcanalsat\b',
        r'\bbeinsport\b', r'\bnetflix\b', r'\byoutube\b.*\btv\b',
        r'\bsmart tv\b', r'\bdecodeur\b', r'\bset.?top.?box\b',
        r'\bremote\b', r'\bremote control\b', r'\bcontrol\b.*\btv\b',
        # Problèmes
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
        r'\bimage\b.*\btv\b', r'\bchaîne\b.*\bdisparue\b',
        # Anglais
        r'\btelevision\b', r'\bscreen\b.*\bblack\b', r'\bchannel\b.*\bnot working\b',
        r'\btv\b.*\bnot working\b', r'\bno channels\b', r'\btv\b.*\bbroken\b',
        # Allemand / Italien
        r'\bfernseher\b', r'\btelevisore\b',
        # Arabe translittéré
        r'\btilifizyun\b', r'\btilifizyon\b', r'\bteleziyon\b',
    ],

    # ── BRUIT ────────────────────────────────────────────────────
    "bruit": [
        # Termes directs
        r'\bbruit\b', r'\bbruyant\b', r'\bvoisin(s)?\b', r'\btapage\b',
        r'\bnuisance\b', r'\bson(ore)?\b', r'\bsono(re)?\b',
        r'\bnuisance sonore\b', r'\bpollution sonore\b',
        # Sources de bruit
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
        # Anglais
        r'\bnoisy\b', r'\bnoise\b', r'\bneighbors?\b.*\bnoisy\b',
        r'\bcouldn.?t sleep\b', r'\bkept awake\b', r'\bloud music\b',
        r'\bloud neighbors?\b', r'\bconstant noise\b', r'\bstreet noise\b',
        # Allemand / Italien
        r'\blärm\b', r'\brumore\b', r'\brumori\b',
        # Arabe translittéré
        r'\bdawsha\b', r'\bdaja\b', r'\bsawt\b.*\bali\b',
    ],

    # ── PROPRETÉ ─────────────────────────────────────────────────
    "proprete": [
        # Termes directs
        r'\bproprete\b', r'\bpropreté\b', r'\bsale\b', r'\bmalpropr(e|ete)\b',
        r'\bordure(s)?\b', r'\bdechets\b', r'\bpoussier(e|e)\b',
        r'\bpoussi(ere|ère)\b', r'\bnettoyage\b', r'\btaches\b',
        r'\bsalete\b', r'\bsaleté\b', r'\bcrasse\b', r'\bsordide\b',
        r'\bdegoutant\b', r'\bdégoûtant\b', r'\bimmonde\b',
        # Nuisibles
        r'\binsecte(s)?\b', r'\bblatte(s)?\b', r'\bcafard(s)?\b',
        r'\bmoustique(s)?\b', r'\bvermine\b', r'\bpuce(s)?\b',
        r'\bpunaise(s)?\b', r'\bpunaise de lit\b', r'\bbedbug(s)?\b',
        r'\brat(s)?\b', r'\bsouris\b', r'\brongeur(s)?\b',
        r'\bfourmis\b', r'\bmouche(s)?\b', r'\baraiign(ee|ée)\b',
        # Problèmes de propreté
        r'\bpropre\b.*\bnon\b', r'\bnon nettoy(e|é)\b',
        r'\bnon propre\b', r'\bpas propre\b', r'\bpas nettoy(e|é)\b',
        r'\bchambre\b.*\bsale\b', r'\bsale\b.*\bchambre\b',
        r'\btaches\b.*\bmur\b', r'\btaches\b.*\bsol\b', r'\btaches\b.*\bdrap\b',
        r'\btaches\b.*\bnappe\b', r'\bmoisissures?\b', r'\bmoisi\b',
        r'\bchampignon(s)?\b.*\bmur\b', r'\bhumidite\b.*\bmoisissure\b',
        r'\bcheveux\b.*\bdouche\b', r'\bcorbeille\b.*\bpleine\b',
        r'\bpoubelle\b.*\bpleine\b', r'\bodeur\b.*\bmauvaise\b',
        r'\bmauvaise odeur\b', r'\bodeur\b.*\bdesagreable\b',
        r'\bunite\b.*\bnettoyage\b', r'\bservice\b.*\bnettoyage\b',
        # Anglais
        r'\bdirty\b', r'\bunclean\b', r'\bfilthy\b', r'\bcockroach\b',
        r'\bbugs\b', r'\bbed bugs\b', r'\bmold\b', r'\bmould\b',
        r'\bdust\b', r'\bstain(s)?\b', r'\bnot cleaned\b',
        # Allemand / Italien
        r'\bschmutzig\b', r'\bsporca\b', r'\bsporcizia\b',
        # Arabe translittéré
        r'\bndhafa\b', r'\bwsakh\b', r'\bkhashra\b', r'\bnaml\b',
    ],

    # ── LITERIE ──────────────────────────────────────────────────
    "literie": [
        # Termes directs
        r'\bliterie\b', r'\bmatelas\b', r'\boreil(ler|lers)\b',
        r'\blit\b', r'\bdraps\b', r'\bcouverture(s)?\b', r'\bcoussins\b',
        r'\bmousse\b', r'\bsommier\b', r'\bbase\b.*\blit\b',
        r'\btaie\b', r'\bdrap housse\b', r'\bcouette\b', r'\bedredon\b',
        r'\bprotege\b.*\bmatelas\b', r'\bsurmatelas\b',
        # Problèmes
        r'\bconfort\b.*\blit\b', r'\blit\b.*\bconfort\b',
        r'\blit\b.*\bcass(e|é)\b', r'\blit\b.*\bdur\b',
        r'\bmatelas\b.*\bmauvais\b', r'\bmatelas\b.*\btrop dur\b',
        r'\bmatelas\b.*\btrop mou\b', r'\bmatelas\b.*\bcreuse\b',
        r'\bmatelas\b.*\baffaisse\b', r'\bmatelas\b.*\bvieux\b',
        r'\bmatelas\b.*\busé\b', r'\bmatelas\b.*\binconfort\b',
        r'\boreillers\b.*\bdurs\b', r'\boreillers\b.*\bmous\b',
        r'\boreillers\b.*\binsuffisant\b', r'\boreillers\b.*\bmanque\b',
        r'\bdraps\b.*\bsales\b', r'\bdraps\b.*\btrou(e|é)s?\b',
        r'\bdraps\b.*\busés?\b', r'\bdraps\b.*\bfine\b',
        r'\bcouverture\b.*\binsuffisante\b', r'\bcouverture\b.*\btrop fine\b',
        r'\bit grinc(e|é)\b', r'\blit\b.*\bgrinc\b', r'\bgrincement\b',
        r'\bsommier\b.*\bcass(e|é)\b', r'\bsommier\b.*\bgrinc\b',
        r'\blit\b.*\bruis(selle|selant)\b', r'\bpunaise(s)?\b.*\blit\b',
        r'\blit\b.*\bpunaise(s)?\b', r'\bmal dorm(i|ir)\b',
        r'\bpas dormi\b.*\blit\b', r'\bdos\b.*\blit\b',
        r'\bmal au dos\b.*\bmatelas\b', r'\blit\b.*\bvieux\b',
        # Anglais
        r'\bbedding\b', r'\bmattress\b', r'\bpillow(s)?\b',
        r'\bsheets?\b', r'\bblanket\b', r'\buncomfortable bed\b',
        r'\bhard mattress\b', r'\bsqueaky bed\b', r'\bdirty sheets\b',
        # Allemand / Italien
        r'\bbettwäsche\b', r'\bmatratze\b', r'\bcuscini\b', r'\blenzuola\b',
        # Arabe translittéré
        r'\bfirrash\b', r'\bmatareh\b', r'\bwissada\b', r'\bghtaa\b',
    ],

    # ── SALLE DE BAIN ────────────────────────────────────────────
    "salle_de_bain": [
        # Termes directs
        r'\bsalle de bain\b', r'\bsdb\b', r'\bdouche\b', r'\bbaignoire\b',
        r'\btoilette(s)?\b', r'\bwc\b', r'\brobinet\b', r'\beau chaude\b',
        r'\beau froide\b', r'\bpression\b.*\beau\b', r'\bfuite\b',
        r'\bpomme de douche\b', r'\blavabo\b', r'\bmitigeur\b', r'\bsiphon\b',
        r'\bchasse d.eau\b', r'\btasse\b.*\bwc\b', r'\bwc\b.*\bbloque\b',
        r'\bwc\b.*\bbouche\b', r'\btuyau\b.*\bbouche\b',
        r'\bcanalisation\b.*\bbouchee\b', r'\bevacuation\b.*\bbouchee\b',
        # Équipements manquants
        r'\bsavon\b', r'\bserviette\b', r'\bshampoing\b', r'\bbain\b',
        r'\bproduit(s)?\b.*\btoilette\b', r'\bgel douche\b',
        r'\bconditionneur\b', r'\bcreme\b.*\bbain\b', r'\bpapier toilette\b',
        r'\bpapier wc\b', r'\bmiroir\b.*\bsalle de bain\b',
        r'\bseche.cheveux\b', r'\bseche cheveux\b', r'\bhairdryer\b',
        r'\bcrochet\b.*\bsalle de bain\b', r'\bporte.serviette\b',
        # Problèmes d'eau
        r'\beau\b.*\bnon chaude\b', r'\bpas d.eau chaude\b',
        r'\beau\b.*\bfroide\b.*\bdouche\b', r'\bdouche\b.*\bfroide\b',
        r'\bpression\b.*\bfaible\b', r'\bpression\b.*\beau\b.*\bfaible\b',
        r'\brobinet\b.*\bgoutte\b', r'\brobinet\b.*\bfuit\b',
        r'\bfuite\b.*\beau\b', r'\beau\b.*\bfuite\b',
        r'\bgouttiere\b.*\bsalle de bain\b', r'\bhumidite\b.*\bsalle de bain\b',
        # Pannes / bouchages
        r'\bdouche\b.*\bbouchee\b', r'\bdouche\b.*\bmarcherait pas\b',
        r'\bdouche\b.*\bpanne\b', r'\bdouche\b.*\bfonctionne pas\b',
        r'\bdouche\b.*\bcassee\b', r'\bbaignoire\b.*\bbouchee\b',
        r'\bbaignoire\b.*\bfuite\b', r'\beau\b.*\bstagne\b',
        r'\beau\b.*\bs.evacue pas\b', r'\bevacuation\b.*\blente\b',
        r'\bwc\b.*\bdeborde\b', r'\bwc\b.*\bfuite\b', r'\bwc\b.*\bodeur\b',
        r'\btoilette(s)?\b.*\bbouche(e)?\b', r'\btoilette(s)?\b.*\bodeur\b',
        r'\btoilette(s)?\b.*\bfonctionne pas\b',
        # Anglais
        r'\bbathroom\b', r'\bshower\b.*\bnot working\b', r'\bno hot water\b',
        r'\btoilet\b.*\bclogged\b', r'\bleaking\b.*\bbathroom\b',
        r'\bweak water pressure\b', r'\bmissing towels\b',
        # Allemand / Italien
        r'\bbad(ezimmer|ewanne)\b', r'\bdusche\b', r'\bbagno\b', r'\bdoccia\b',
        # Arabe translittéré
        r'\bhamm(am|em)\b', r'\bdush\b', r'\bmaya\b.*\bsakhna\b',
        r'\brobini\b', r'\btwalet\b',
    ],

    # ── RESTAURATION ─────────────────────────────────────────────
    "restauration": [
        # Termes directs
        r'\brestauration\b', r'\brestaurant\b', r'\brepas\b', r'\bdiner\b',
        r'\bdéjeuner\b', r'\bnourriture\b', r'\bmanger\b',
        r'\bplat\b', r'\bmenu\b', r'\bcarte\b', r'\bcuisine\b',
        r'\bchef\b', r'\bcuisinier\b', r'\bcook\b', r'\brecette\b',
        r'\bingredient\b', r'\bportion\b', r'\bdose\b', r'\bquantite\b',
        r'\bprésentation\b', r'\bpresentation\b.*\bplat\b',
        # Problèmes de qualité
        r'\bqualite\b.*\bnourriture\b', r'\bnourriture\b.*\bqualite\b',
        r'\bnourriture\b.*\bmauvaise\b', r'\bmauvaise\b.*\bnourriture\b',
        r'\bplat\b.*\bfroid\b', r'\bfroid\b.*\bservi\b', r'\bservi froid\b',
        r'\bgoût\b', r'\bgout\b', r'\bsaveur\b', r'\bmauvais gout\b',
        r'\bmauvais plat\b', r'\bplat\b.*\bmauvais\b', r'\bimmangeable\b',
        r'\binsipide\b', r'\bnon comestible\b', r'\bpas bon\b',
        r'\btrop sale\b', r'\btrop sucre\b', r'\btrop epice\b',
        r'\bpas frais\b', r'\bnourriture\b.*\bperimee\b',
        r'\bnourriture\b.*\bavariee\b', r'\bintoxication\b.*\balimentaire\b',
        r'\bempoisonnement\b.*\balimentaire\b', r'\bdiarrhee\b.*\brepas\b',
        # Problèmes de service
        r'\battente\b.*\brestaurant\b', r'\brestaurant\b.*\battente\b',
        r'\btrop long\b.*\bcommande\b', r'\bcommande\b.*\btrop long\b',
        r'\bcommande\b.*\bwrong\b', r'\bcommande\b.*\berreur\b',
        r'\bcommande\b.*\bmauvaise\b', r'\bcommande\b.*\bmanquante\b',
        r'\bserveur\b.*\bimpoli\b', r'\bserveur\b.*\bnegligent\b',
        r'\bserveur\b.*\blent\b', r'\bservice\b.*\blent\b.*\brestaurant\b',
        r'\brestaurant\b.*\bferme\b', r'\brestaurant\b.*\bcomplet\b',
        r'\brestaurant\b.*\bplein\b', r'\btable\b.*\bsale\b',
        r'\bnappe\b.*\bsale\b', r'\bcouvert\b.*\bsale\b',
        # Allergies
        r'\ballergie\b', r'\ballergique\b', r'\bintolerance\b',
        r'\bgluten\b', r'\blactose\b', r'\bnoisette\b', r'\bnoix\b',
        r'\bregime\b.*\bhalal\b', r'\bhalal\b', r'\bkosher\b',
        r'\bvegetarien\b', r'\bvegan\b',
        # Anglais
        r'\bfood quality\b', r'\bbad food\b', r'\bwrong order\b',
        r'\bovercooked\b', r'\bundercooked\b', r'\braw food\b',
        r'\bfood poisoning\b', r'\bwaiter\b.*\brude\b',
        # Allemand / Italien
        r'\bessen\b', r'\bspeise\b', r'\bcibo\b', r'\bpasto\b',
        # Arabe translittéré
        r'\bakl\b', r'\bta3am\b', r'\bmat3am\b', r'\bwajba\b',
    ],

    # ── PETIT-DÉJEUNER ───────────────────────────────────────────
    "petit_dejeuner": [
        # Termes directs
        r'\bpetit.?dejeuner\b', r'\bpetit.?déjeuner\b', r'\bbreakfast\b',
        r'\bbuffet\b.*\bmatin\b', r'\bmatin\b.*\bbuffet\b',
        r'\bviennoiserie\b', r'\bjus\b.*\bmatin\b', r'\boeufs\b.*\bmatin\b',
        r'\bbuffet\b.*\bfroid\b', r'\bheure\b.*\bpetit\b.*\bdejeuner\b',
        r'\bdejeuner\b.*\bmatin\b', r'\bbrunch\b', r'\bcontinental\b',
        # Composants du buffet
        r'\bcroissant\b', r'\bbaguette\b', r'\bpain\b.*\bmatin\b',
        r'\bconfiture\b', r'\bbeurre\b.*\bmatin\b', r'\byaourt\b',
        r'\bfromage\b.*\bmatin\b', r'\bcharcuterie\b', r'\bcereal(e)?\b',
        r'\boceufs\b', r'\bomelet(te)?\b', r'\bjus d.orange\b',
        r'\bjus\b.*\bfruit(s)?\b', r'\bcafe\b.*\bmatin\b', r'\bthe\b.*\bmatin\b',
        r'\bnescafe\b', r'\bespresso\b.*\bmatin\b',
        # Problèmes
        r'\bbuffet\b.*\bvide\b', r'\bbuffet\b.*\bmanque\b',
        r'\bbuffet\b.*\btrop petit\b', r'\bbuffet\b.*\binsuffisant\b',
        r'\bbuffet\b.*\bpas frais\b', r'\bpas de buffet\b',
        r'\bbuffet\b.*\bnon recharge\b', r'\bproduits\b.*\bepuise(s)?\b',
        r'\bdejeuner\b.*\bfroid\b', r'\bpas assez\b.*\bdejeuner\b',
        r'\bpas varié\b.*\bdejeuner\b', r'\bmanque\b.*\bchoix\b.*\bmatin\b',
        r'\bchoix\b.*\blimite\b.*\bmatin\b', r'\bpeu de choix\b.*\bmatin\b',
        r'\bheure\b.*\bfin\b.*\bdejeuner\b', r'\btrop tot\b.*\bdejeuner\b',
        r'\btard\b.*\bdejeuner\b', r'\bdejeuner\b.*\btard\b',
        r'\bferme\b.*\btot\b.*\bdejeuner\b',
        # Anglais
        r'\bno breakfast\b', r'\bempty buffet\b', r'\bcold breakfast\b',
        r'\blimited breakfast\b', r'\bbreakfast not included\b',
        # Allemand / Italien
        r'\bfrühstück\b', r'\bcolazione\b',
        # Arabe translittéré
        r'\bftour\b', r'\biftar\b.*\bsabah\b', r'\bsabahiya\b',
    ],

    # ── ROOM SERVICE ─────────────────────────────────────────────
    "room_service": [
        # Termes directs
        r'\broom.?service\b', r'\bservice\b.*\bchambre\b',
        r'\bchambre\b.*\bservice\b', r'\blivraison\b.*\bchambre\b',
        r'\bcommande\b.*\bchambre\b', r'\brepas\b.*\bchambre\b',
        r'\bcommande\b.*\blongtemps\b', r'\battente\b.*\broom\b',
        r'\bservice\b.*\bnuit\b', r'\bcommande\b.*\bnuit\b',
        r'\bcommande\b.*\blever\b', r'\bpetit.?dejeuner\b.*\bchambre\b',
        r'\bchambre\b.*\bpetit.?dejeuner\b', r'\bdiner\b.*\bchambre\b',
        # Problèmes de délai
        r'\battente\b.*\btrop longue\b.*\broom\b',
        r'\broom service\b.*\btrop long\b',
        r'\blivraison\b.*\btard\b', r'\blivraison\b.*\bfroid\b',
        r'\bcommande\b.*\bfroid\b.*\bchambre\b',
        r'\bcommande\b.*\bmauvaise\b.*\bchambre\b',
        r'\broom service\b.*\berreur\b', r'\broom service\b.*\bmanquant\b',
        r'\broom service\b.*\bferme\b', r'\broom service\b.*\bindisponible\b',
        r'\broom service\b.*\bnon disponible\b', r'\bpas de room service\b',
        r'\btray\b', r'\bplat(eau)?\b.*\bchambre\b',
        # Anglais
        r'\broom service\b.*\bnot available\b', r'\broom service\b.*\blate\b',
        r'\broom service\b.*\bwrong order\b', r'\bno room service\b',
        r'\bdelivery\b.*\broom\b', r'\bin.room dining\b',
        # Arabe translittéré
        r'\bkhidmet\b.*\bghurfa\b', r'\broom\b.*\bservis\b',
    ],

    # ── PISCINE ──────────────────────────────────────────────────
    "piscine": [
        # Termes directs
        r'\bpiscine\b', r'\bpool\b', r'\bnager\b', r'\bbaignade\b',
        r'\btransat\b', r'\bchaise longue\b', r'\beau\b.*\bpiscine\b',
        r'\baquatique\b', r'\bjacuzzi\b', r'\bbain a remous\b',
        r'\bpiscine\b.*\binterieure\b', r'\bpiscine\b.*\bexterieure\b',
        r'\bpiscine\b.*\binfinite\b', r'\bpiscine\b.*\bchauffee\b',
        # Problèmes
        r'\bpiscine\b.*\bsale\b', r'\bpiscine\b.*\bferme\b',
        r'\bpiscine\b.*\bindisponible\b', r'\bpiscine\b.*\bfermee\b',
        r'\bpiscine\b.*\bverdie\b', r'\bpiscine\b.*\bverte\b',
        r'\bpiscine\b.*\bchloree\b', r'\bpiscine\b.*\border\b',
        r'\bpiscine\b.*\bpleine\b', r'\bpiscine\b.*\bsurpeuplee\b',
        r'\bpiscine\b.*\btrop froide\b', r'\bpiscine\b.*\btrop chaude\b',
        r'\beau\b.*\bpiscine\b.*\bsale\b', r'\beau\b.*\bpiscine\b.*\bverte\b',
        r'\btransat(s)?\b.*\bmanque\b', r'\bpas de transat(s)?\b',
        r'\btransat(s)?\b.*\bsale(s)?\b', r'\bchaise\b.*\bpiscine\b.*\bmanque\b',
        r'\bpas de parasol\b', r'\bparasol\b.*\bmanque\b',
        r'\bdouche\b.*\bpiscine\b', r'\bvestiaire\b.*\bpiscine\b',
        r'\bmaître.?nageur\b', r'\bsurveillant\b.*\bpiscine\b',
        r'\bpas de surveillance\b.*\bpiscine\b',
        # Anglais
        r'\bpool closed\b', r'\bdirty pool\b', r'\bno pool access\b',
        r'\bpool too cold\b', r'\bno loungers\b', r'\bswimming pool\b',
        # Allemand / Italien
        r'\bschwimmbad\b', r'\bpiscina\b',
        # Arabe translittéré
        r'\bmasba7\b', r'\bmesbahe\b', r'\bsibaha\b',
    ],

    # ── SPA ──────────────────────────────────────────────────────
    "spa": [
        # Termes directs
        r'\bspa\b', r'\bhammam\b', r'\bmassage\b', r'\bsoin\b',
        r'\bbeaute\b', r'\bbeauté\b', r'\bwellness\b', r'\bbien.?etre\b',
        r'\bsauna\b', r'\bvapeur\b', r'\bestheti(que|cien)\b',
        r'\brelaxation\b', r'\btherapie\b', r'\bthérapie\b',
        r'\bhydrotherapie\b', r'\bbalneotherapie\b', r'\bjacuzzi\b.*\bspa\b',
        r'\bmasseur\b', r'\bmasseuse\b', r'\bkinesitherapie\b',
        r'\baromatotherapie\b', r'\bgommage\b', r'\benveloppe\b.*\bcorps\b',
        r'\bsoins\b.*\bvisage\b', r'\bsoins\b.*\bcorps\b',
        r'\bmanucure\b', r'\bpedicure\b', r'\bcoiffure\b.*\bspa\b',
        # Problèmes
        r'\bspa\b.*\bferme\b', r'\bspa\b.*\bindisponible\b',
        r'\bspa\b.*\bcomplet\b', r'\bspa\b.*\bpanne\b',
        r'\bmassage\b.*\bmauvais\b', r'\bmassage\b.*\bdouloureux\b',
        r'\bmassage\b.*\btrop fort\b', r'\bmassage\b.*\btrop doux\b',
        r'\bmassage\b.*\bmanque\b.*\bprofessionnalisme\b',
        r'\bsoin\b.*\bmauvais\b', r'\bsoin\b.*\bdecevant\b',
        r'\bhammam\b.*\bsale\b', r'\bhammam\b.*\bferme\b',
        r'\bhammam\b.*\btrop chaud\b', r'\bhammam\b.*\btrop froid\b',
        r'\bsauna\b.*\bpanne\b', r'\bsauna\b.*\bfroid\b',
        r'\breservation\b.*\bspa\b', r'\bspa\b.*\breservation\b',
        # Anglais
        r'\bspa not available\b', r'\bbad massage\b', r'\bsteam room\b',
        r'\btreatment\b.*\bspa\b', r'\bspa\b.*\bclosed\b',
        # Arabe translittéré
        r'\bsba\b', r'\bmasaj\b', r'\bmasaj\b.*\bsii\b',
    ],

    # ── PARKING ──────────────────────────────────────────────────
    "parking": [
        # Termes directs
        r'\bparking\b', r'\bvoiture\b', r'\bvehicule\b', r'\bvéhicule\b',
        r'\bgarer\b', r'\bstationnement\b', r'\bgarage\b', r'\bvalet\b',
        r'\bplace\b.*\bparking\b', r'\bparking\b.*\bplace\b',
        r'\bparking\b.*\bgratuit\b', r'\bparking\b.*\bpayant\b',
        r'\bsouterrain\b', r'\bparking\b.*\bsouterrain\b',
        # Problèmes
        r'\brayure\b', r'\bdommage\b.*\bvoiture\b', r'\baccident\b.*\bparking\b',
        r'\bparking\b.*\bplein\b', r'\bparking\b.*\bcomplet\b',
        r'\bplus de place\b.*\bparking\b', r'\bparking\b.*\bsaturé\b',
        r'\bparking\b.*\bsecurite\b', r'\bparking\b.*\bsurveille\b',
        r'\bparking\b.*\bnon surveille\b', r'\bparking\b.*\binsecure\b',
        r'\bvol\b.*\bvoiture\b', r'\bvoiture\b.*\bvol\b',
        r'\bvoiture\b.*\bendommage\b', r'\bvoiture\b.*\bcasse\b',
        r'\bvoiture\b.*\bradye\b', r'\bvoiture\b.*\bgrifee\b',
        r'\bvoiture\b.*\baccident\b', r'\bvoiture\b.*\bdisparue\b',
        r'\bvalet\b.*\bproblem\b', r'\bvalet\b.*\brayure\b',
        r'\bvalet\b.*\bdommage\b', r'\bfrais\b.*\bparking\b',
        r'\bparking\b.*\bfrais\b', r'\bparking\b.*\bcher\b',
        # Anglais
        r'\bcar park\b', r'\bparking lot\b', r'\bcar damaged\b',
        r'\bno parking\b', r'\bparking full\b', r'\bparking not safe\b',
        # Arabe translittéré
        r'\bparkin\b', r'\bsayyara\b', r'\bwoquf\b',
    ],

    # ── SERVICE RÉCEPTION ────────────────────────────────────────
    "service_reception": [
        # Termes directs
        r'\breception\b', r'\bréception\b', r'\baccueil\b', r'\bconcierg(e|erie)\b',
        r'\bcheck.?in\b', r'\bcheck.?out\b', r'\bfront.?desk\b',
        r'\bstaff\b', r'\bpersonnel\b', r'\breceptionniste\b',
        r'\bclef\b', r'\bcarte\b.*\bchambre\b', r'\bcle\b.*\bchambre\b',
        r'\bclé magétique\b', r'\bcarte magnetique\b',
        # Attitude du personnel
        r'\bimpolie?\b', r'\bimpoliment\b', r'\bmauvais accueil\b',
        r'\battente\b.*\breception\b', r'\breception\b.*\battente\b',
        r'\bpersonnel\b.*\bimpoli\b', r'\bpersonnel\b.*\bnegligent\b',
        r'\bpersonnel\b.*\baggressif\b', r'\bpersonnel\b.*\bdesagreable\b',
        r'\bpersonnel\b.*\bpas aimable\b', r'\bpersonnel\b.*\bincompe(tent|tant)\b',
        r'\bpersonnel\b.*\blent\b', r'\bpersonnel\b.*\bfroid\b',
        r'\bstaff\b.*\bimpoli\b', r'\bstaff\b.*\brude\b',
        r'\bstaff\b.*\bnot helpful\b', r'\bstaff\b.*\bunfriendly\b',
        r'\baccueil\b.*\bmauvais\b', r'\baccueil\b.*\bfroi(d|de)\b',
        r'\baccueil\b.*\bdesagreable\b', r'\bpas accueil(li)?\b',
        # Check-in / check-out
        r'\battente\b.*\bcheck.?in\b', r'\bcheck.?in\b.*\battente\b',
        r'\battente\b.*\bcheck.?out\b', r'\bcheck.?out\b.*\blent\b',
        r'\bcheck.?in\b.*\btard\b', r'\bchambre\b.*\bpas prete\b',
        r'\bchambre\b.*\bnon prete\b', r'\bcheck.?in\b.*\bprobleme\b',
        r'\berreur\b.*\breservation\b', r'\breservation\b.*\berreur\b',
        r'\breservation\b.*\bperdue\b', r'\breservation\b.*\bintrouvable\b',
        # Clé / accès chambre
        r'\bclef\b.*\bmarche pas\b', r'\bcarte\b.*\bmarche pas\b',
        r'\bcle\b.*\bbloquee\b', r'\bcarte\b.*\bbloquee\b',
        r'\bacceder\b.*\bchambre\b', r'\bpas acceder\b.*\bchambre\b',
        # Anglais
        r'\bfront desk\b', r'\breception staff\b', r'\bcheck.in\b.*\bproblem\b',
        r'\bunfriendly staff\b', r'\blong wait\b.*\breception\b',
        r'\bkey card\b', r'\brude receptionist\b',
        # Allemand / Italien
        r'\brezeption\b', r'\bempfang\b', r'\baccettazione\b', r'\bricevimento\b',
        # Arabe translittéré
        r'\bisti2bal\b', r'\brastiqbal\b', r'\bkaritit\b.*\bghorfa\b',
    ],

    # ── SERVICE MÉNAGE ───────────────────────────────────────────
    "service_menage": [
        # Termes directs
        r'\bmenage\b', r'\bménage\b', r'\bnettoyage\b.*\bchambre\b',
        r'\bchambre\b.*\bnettoyage\b', r'\bfemme de chambre\b',
        r'\bhousekeeping\b', r'\bhousekeeper\b', r'\bhomme de chambre\b',
        r'\bvalet de chambre\b', r'\bgovernante\b', r'\bequipe menage\b',
        r'\bservice d.entretien\b', r'\bentretien\b.*\bchambre\b',
        # Serviettes et linge
        r'\bserviette(s)?\b.*\bchange\b', r'\bchange\b.*\bserviette\b',
        r'\bdraps\b.*\bchange\b', r'\bchange\b.*\bdraps\b',
        r'\blinge\b.*\bchange\b', r'\bchange\b.*\blinge\b',
        r'\bserviette(s)?\b.*\bmanque\b', r'\bpas de serviette\b',
        r'\bserviette(s)?\b.*\bresupply\b', r'\bmanque\b.*\bserviette\b',
        # Chambres non nettoyées
        r'\bpas nettoy(e|é)\b', r'\bnon nettoy(e|é)\b',
        r'\bchambre\b.*\bpas nettoyee\b', r'\bchambre\b.*\bnon nettoyee\b',
        r'\bchambre\b.*\bpas ete nettoyee\b', r'\bchambre\b.*\bsale\b.*\bservice\b',
        r'\bmenage\b.*\bpas fait\b', r'\bpas de menage\b',
        r'\bmenage\b.*\binsuffisant\b', r'\bmenage\b.*\bmauvais\b',
        r'\bchambre\b.*\bsales\b', r'\bchambre\b.*\bpas refaite\b',
        r'\bchambre\b.*\bnon refaite\b', r'\bnon renouvele\b',
        # Comportement du personnel
        r'\bmenage\b.*\bsans frapper\b', r'\bentre sans frapper\b',
        r'\bsans prevenir\b.*\bchambre\b', r'\bintrusion\b.*\bchambre\b',
        r'\bmenage\b.*\bvol\b', r'\bage\b.*\bmenage\b.*\bvol\b',
        r'\baffaires\b.*\bdeplaces\b', r'\baffaires\b.*\btouche\b',
        r'\bpersonnel\b.*\bmenage\b.*\bimpoli\b',
        # Ravitaillement
        r'\bsavon\b.*\bnon renouvele\b', r'\bshampoing\b.*\bnon renouvele\b',
        r'\bproduites\b.*\btoilette\b.*\bmanque\b', r'\bpapier\b.*\bnon renouvele\b',
        r'\bcorbeille\b.*\bpas videe\b', r'\bpoubelle\b.*\bpas videe\b',
        # Anglais
        r'\broom not cleaned\b', r'\bdirty room\b.*\bhousekeeping\b',
        r'\bno towels\b', r'\btowels not replaced\b', r'\bsheets not changed\b',
        r'\bhousekeeping\b.*\bdid not come\b', r'\bentered without knocking\b',
        # Arabe translittéré
        r'\bkhidmet\b.*\bndhafa\b', r'\bghassil\b.*\bghorfa\b',
    ],

    # ── SERVICE SÉCURITÉ ─────────────────────────────────────────
    "service_securite": [
        # Termes directs
        r'\bsecurit(e|é)\b', r'\bgarde\b', r'\bvol\b', r'\bvole\b',
        r'\bdisparu\b', r'\bmanquant\b', r'\bcoffre.?fort\b',
        r'\bporte\b.*\bferme\b', r'\bporte\b.*\bverrou\b',
        r'\bsurveillance\b', r'\bcamera\b', r'\bintrus\b',
        r'\bmenace\b', r'\bdanger\b', r'\bagression\b',
        r'\bvideosurveillance\b', r'\bcctv\b', r'\bgarde\b.*\bcorps\b',
        # Accès et serrures
        r'\bserrure\b.*\bcassee\b', r'\bserrure\b.*\bdefectueuse\b',
        r'\bserrure\b.*\bmarche pas\b', r'\bporte\b.*\bferme mal\b',
        r'\bporte\b.*\bbloquee\b', r'\bporte\b.*\bverrou\b.*\bcasse\b',
        r'\bcle\b.*\bdupliquee\b', r'\bcarte\b.*\bdupliquee\b',
        r'\bacceder\b.*\bchambre\b.*\binconnu\b', r'\binconnu\b.*\bchambre\b',
        r'\bpersonnes\b.*\bsuspectes\b', r'\bindividu\b.*\bsuspect\b',
        r'\bcomportement\b.*\bbizarre\b.*\bpersonnel\b',
        # Vols
        r'\bvol\b.*\baffaires\b', r'\baffaires\b.*\bvolees\b',
        r'\bargent\b.*\bvole\b', r'\bbijoux\b.*\bvole\b',
        r'\btelephone\b.*\bvole\b', r'\bordina(teur|trice)\b.*\bvole\b',
        r'\bsac\b.*\bvole\b', r'\bportefeuille\b.*\bvole\b',
        r'\bcoffre\b.*\bforce\b', r'\bcoffre\b.*\bouvert\b.*\binconnu\b',
        r'\bcoffre.?fort\b.*\bvole\b', r'\bcoffre.?fort\b.*\bprobleme\b',
        r'\bcoffre.?fort\b.*\bfonctionne pas\b',
        # Incidents
        r'\bbagarre\b', r'\bconflit\b.*\bsecurite\b',
        r'\bmenace\b.*\bphysique\b', r'\bagression\b.*\bverbale\b',
        r'\bincident\b.*\bsecurite\b', r'\bsentir\b.*\bpas en securite\b',
        r'\bpas en securite\b', r'\bse sentir\b.*\bmenace\b',
        # Anglais
        r'\btheft\b', r'\bstolen\b', r'\bsecurity\b.*\bissue\b',
        r'\bunlocked door\b', r'\bno security\b', r'\bfeeling unsafe\b',
        r'\bsafe\b.*\bnot working\b', r'\bbreak.?in\b',
        # Arabe translittéré
        r'\bsariqa\b', r'\bmarqa\b', r'\bkhawf\b', r'\bamn\b.*\bproblem\b',
    ],

    # ── FACTURATION ──────────────────────────────────────────────
    "facturation": [
        # Termes directs
        r'\bfacture\b', r'\bfacturation\b', r'\bpaiement\b',
        r'\bcharge\b', r'\bdebit\b.*\bcarte\b', r'\bsurtaxe\b',
        r'\bsurcharge\b', r'\btaxe\b', r'\bfrais\b',
        r'\bmontant\b', r'\bprix\b.*\berreur\b', r'\berreur\b.*\bprix\b',
        r'\baddition\b', r'\bnote\b.*\bpayer\b', r'\bticket\b.*\bcaisse\b',
        r'\bfacturette\b', r'\brecu\b', r'\breceipt\b',
        # Erreurs de facturation
        r'\berreur\b.*\bfacture\b', r'\bfacture\b.*\berreur\b',
        r'\bmontant\b.*\bincorrect\b', r'\bfacture\b.*\bfaux\b',
        r'\bpaye\b.*\bplus\b', r'\btrop\b.*\bfacture\b',
        r'\bcharge\b.*\bdeux fois\b', r'\bdouble\b.*\bfacturation\b',
        r'\bdouble\b.*\bdebit\b', r'\bdebit\b.*\bdeux fois\b',
        r'\bdebite\b.*\bdeux fois\b', r'\bprelevé\b.*\bdeux fois\b',
        r'\bfrais\b.*\bnon\b.*\bconvenu\b', r'\bfrais\b.*\bcaches\b',
        r'\bfrais\b.*\bcachés\b', r'\bfrais\b.*\bnon\b.*\bprevus\b',
        r'\bfrais\b.*\bnon\b.*\bprévus\b', r'\bsurprise\b.*\bfacture\b',
        r'\bfrais\b.*\bnon\b.*\bdiscutes\b', r'\bfrais\b.*\binattendu\b',
        r'\bfrais\b.*\binexplique\b', r'\bfrais\b.*\babusif\b',
        r'\bprix\b.*\baugmente\b', r'\bprix\b.*\bchange\b.*\barrivee\b',
        r'\bprix\b.*\bconforme\b.*\bnon\b', r'\bnon conforme\b.*\bprix\b',
        # Carte bancaire
        r'\bcarte bancaire\b.*\bproblem\b', r'\bcarte\b.*\bdebit\b.*\berreur\b',
        r'\bcarte\b.*\bcharge\b.*\berreur\b', r'\bpaiement\b.*\berreur\b',
        r'\bpaiement\b.*\berreur\b', r'\bvirement\b.*\berreur\b',
        # Anglais
        r'\bbilling error\b', r'\bovercharged\b', r'\bdouble charge\b',
        r'\bhidden fees\b', r'\bwrong amount\b', r'\binvoice\b.*\bwrong\b',
        r'\bcharged twice\b', r'\bunexpected charge\b',
        # Arabe translittéré
        r'\bfatura\b', r'\bfattura\b', r'\bdaf3\b.*\bkhata\b',
        r'\bhisab\b.*\bghalt\b',
    ],

    # ── REMBOURSEMENT ────────────────────────────────────────────
    "remboursement": [
        # Termes directs
        r'\bremboursement\b', r'\brembours(er|e)\b', r'\brefund\b',
        r'\bannulation\b', r'\bannuler\b', r'\bcancel\b',
        r'\bargent\b.*\bretour\b', r'\bretour\b.*\bargent\b',
        r'\bcompensation\b', r'\bindemnisation\b', r'\bgeste commercial\b',
        r'\bremboursement\b.*\battente\b', r'\battente\b.*\bremboursement\b',
        r'\bgeste\b.*\bclient\b', r'\bbon\b.*\bretour\b',
        r'\bavoir\b', r'\bvoucher\b', r'\bcredit\b.*\bremboursement\b',
        # Processus de remboursement
        r'\bremboursement\b.*\btrop long\b', r'\bremboursement\b.*\battendu\b',
        r'\bpas encore\b.*\brembourse\b', r'\btoujoures pas\b.*\brembourse\b',
        r'\bremboursement\b.*\brefuse\b', r'\bremboursement\b.*\brejete\b',
        r'\bpas rembourse\b', r'\bnon rembourse\b', r'\bpas recu\b.*\bremboursement\b',
        r'\battendre\b.*\bremboursement\b', r'\bdelai\b.*\bremboursement\b',
        r'\bremboursement\b.*\bdelai\b', r'\bprocedure\b.*\bremboursement\b',
        r'\bremboursement\b.*\bprocedure\b', r'\bremboursement\b.*\bcomplique\b',
        # Annulation
        r'\bannulation\b.*\bremboursement\b', r'\bremboursement\b.*\bannulation\b',
        r'\bannule\b.*\bpas rembourse\b', r'\bannulation\b.*\brefuse\b',
        r'\bannulation\b.*\bfrais\b', r'\bpolitique\b.*\bannulation\b',
        r'\breservation\b.*\bannulee\b.*\bremboursement\b',
        # Compensation
        r'\bcompensation\b.*\brefuse\b', r'\bindemnite\b', r'\bindemnisation\b',
        r'\brepare\b.*\bprejudice\b', r'\bprejudice\b', r'\bdommages\b.*\binterets\b',
        r'\bdedommageme(nt|nts)\b',
        # Anglais
        r'\brefund not received\b', r'\brefund denied\b', r'\bno refund\b',
        r'\bcancellation policy\b', r'\brefund pending\b', r'\bcompensation denied\b',
        # Arabe translittéré
        r'\basterja3\b', r'\birdja3\b.*\bflous\b', r'\bta3wid\b',
    ],

    # ── CHAMBRE ──────────────────────────────────────────────────
    "chambre": [
        # Termes directs
        r'\bchambre\b', r'\broom\b', r'\bsuite\b', r'\bappartement\b',
        r'\bbalcon\b', r'\bfenetre\b', r'\bfenêtre\b', r'\bporte\b',
        r'\bserrure\b', r'\bverrou\b', r'\bcle\b', r'\bclé\b',
        r'\bmeuble\b', r'\barmoire\b', r'\bplacard\b', r'\bbureau\b',
        r'\bsol\b.*\bchambre\b', r'\bmoquette\b', r'\brideaux\b',
        r'\bmiroir\b', r'\btable de nuit\b', r'\blampe de chevet\b',
        r'\bfrigo\b', r'\bminibar\b', r'\bcafetiere\b', r'\bbouilloire\b',
        r'\bcasier\b', r'\bcoffre\b', r'\bsafe\b.*\bchambre\b',
        # Conformité
        r'\bconforme\b', r'\bpas conforme\b', r'\bnon conforme\b',
        r'\bchambre\b.*\bpas\b.*\breservee\b', r'\bchambre\b.*\bchangee\b',
        r'\bmauvaise chambre\b', r'\bchambre\b.*\bmauvaise\b',
        r'\bchambre\b.*\bdifferente\b', r'\bchambre\b.*\bmodifiee\b',
        r'\bchambre\b.*\bpas\b.*\bcommandee\b', r'\bchambre\b.*\bpas\b.*\bdemandee\b',
        r'\bcategorie\b.*\bchambre\b', r'\btypegh\b.*\bchambre\b',
        r'\bvue\b.*\bmer\b', r'\bvue\b.*\bjardine\b', r'\bvue\b.*\bpiscine\b',
        r'\bpas de vue\b', r'\bvue\b.*\bbloquee\b',
        # Taille et équipement
        r'\bchambre\b.*\btrop petite\b', r'\btrop petite\b.*\bchambre\b',
        r'\bchambre\b.*\bexigue\b', r'\bchambre\b.*\bmanque\b.*\bplace\b',
        r'\bchambre\b.*\bsombre\b', r'\bchambre\b.*\bpas\b.*\beclairee\b',
        r'\bchambre\b.*\bhumide\b', r'\bchambre\b.*\bodeur\b',
        r'\bchambre\b.*\bmauvaise odeur\b', r'\bmauvaise odeur\b.*\bchambre\b',
        r'\bfumeur\b.*\bchambre\b', r'\bno.?smoking\b', r'\bchambre\b.*\bfumeurs\b',
        # Balcon / fenêtre
        r'\bbalcon\b.*\bsale\b', r'\bbalcon\b.*\bferme\b',
        r'\bfenetre\b.*\bferme mal\b', r'\bfenetre\b.*\bcassee\b',
        r'\bfenetre\b.*\bbloque\b', r'\bfenetre\b.*\bnon\b.*\bisolée?\b',
        # Meubles et équipements
        r'\bmeuble\b.*\bcasse\b', r'\bmeuble\b.*\bnon\b.*\bfonctionnel\b',
        r'\barmoire\b.*\bcassee\b', r'\bbureau\b.*\bcasse\b',
        r'\bfrigo\b.*\bpanne\b', r'\bminibar\b.*\bvide\b',
        r'\bcafetiere\b.*\bmarche pas\b', r'\bbouilloire\b.*\bpanne\b',
        # Anglais
        r'\broom not as expected\b', r'\bwrong room type\b',
        r'\broom too small\b', r'\broom smells\b', r'\bdark room\b',
        r'\bno balcony\b', r'\broom upgrade\b',
        # Allemand / Italien
        r'\bzimmer\b', r'\bcamera\b.*\bhotel\b', r'\bstanza\b',
        # Arabe translittéré
        r'\bghorfa\b', r'\bgurfa\b', r'\bghurfa\b',
    ],
}

# ================================================================
# LABELS LISIBLES PAR TYPE
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
# NORMALISATION DU TEXTE
# ================================================================
def normalize(text):
    """Supprime accents, met en minuscules, nettoie."""
    text = text.lower().strip()
    # Normaliser les accents
    nfkd = unicodedata.normalize('NFKD', text)
    text = ''.join(c for c in nfkd if not unicodedata.combining(c))
    # Supprimer ponctuation excessive
    text = re.sub(r'[^\w\s\-]', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text

# ================================================================
# SCORING — COMPTER LES MATCHES PAR TYPE
# ================================================================
def score_text(text):
    """Retourne un dict {type: score} basé sur les matches regex."""
    normalized = normalize(text)
    scores = {}
    for intent_type, patterns in INTENT_KEYWORDS.items():
        score = 0
        for pattern in patterns:
            matches = re.findall(pattern, normalized)
            if matches:
                # Pondération : patterns plus longs = plus spécifiques = plus de poids
                weight = 1 + (len(pattern) / 20)
                score += len(matches) * weight
        if score > 0:
            scores[intent_type] = round(score, 2)
    return scores

# ================================================================
# RÈGLES DE PRIORITÉ (résolution d'ambiguïté)
# Ex: "eau chaude" → salle_de_bain > chambre
# ================================================================
PRIORITY_RULES = [
    # Si wifi + chambre → wifi gagne
    ({"wifi", "chambre"}, "wifi"),
    # Si climatisation + chambre → climatisation gagne
    ({"climatisation", "chambre"}, "climatisation"),
    # Si chauffage + chambre → chauffage gagne
    ({"chauffage", "chambre"}, "chauffage"),
    # Si salle_de_bain + chambre → salle_de_bain gagne
    ({"salle_de_bain", "chambre"}, "salle_de_bain"),
    # Si electricite + chambre → electricite gagne
    ({"electricite", "chambre"}, "electricite"),
    # Si proprete + chambre → proprete gagne
    ({"proprete", "chambre"}, "proprete"),
    # Si literie + chambre → literie gagne
    ({"literie", "chambre"}, "literie"),
    # Si bruit + chambre → bruit gagne
    ({"bruit", "chambre"}, "bruit"),
    # Si television + chambre → television gagne
    ({"television", "chambre"}, "television"),
    # Si remboursement + facturation → remboursement gagne
    ({"remboursement", "facturation"}, "remboursement"),
    # Si petit_dejeuner + restauration → petit_dejeuner gagne
    ({"petit_dejeuner", "restauration"}, "petit_dejeuner"),
    # Si room_service + restauration → room_service gagne
    ({"room_service", "restauration"}, "room_service"),
    # Si service_menage + proprete → service_menage gagne
    ({"service_menage", "proprete"}, "service_menage"),
    # Si service_menage + chambre → service_menage gagne
    ({"service_menage", "chambre"}, "service_menage"),
    # Si service_securite + chambre → service_securite gagne
    ({"service_securite", "chambre"}, "service_securite"),
    # Si parking + voiture → parking gagne sur chambre
    ({"parking", "chambre"}, "parking"),
    # Si salle_de_bain + proprete → proprete peut gagner si score > 2x
    # (géré dynamiquement dans apply_priority_rules)
    # Si chauffage + climatisation → chauffage gagne (hiver)
    ({"chauffage", "climatisation"}, "chauffage"),
    # Si facturation + remboursement → remboursement gagne
    ({"facturation", "remboursement"}, "remboursement"),
    # Si room_service + chambre → room_service gagne
    ({"room_service", "chambre"}, "room_service"),
    # Si piscine + spa → piscine gagne (si score piscine >= spa)
    # (géré dynamiquement)
]

def apply_priority_rules(scores):
    """Applique les règles de priorité sur les types détectés."""
    detected_types = set(scores.keys())
    for required_types, winner in PRIORITY_RULES:
        if required_types.issubset(detected_types):
            return winner, scores.get(winner, 0)
    return None, 0

# ================================================================
# DÉTECTION PRINCIPALE
# ================================================================
def detect_type(description):
    """
    Détecte le type de réclamation depuis une description textuelle.
    Retourne: { type, confidence, label, all_scores }
    """
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

    # Appliquer règles de priorité si plusieurs types détectés
    priority_type, priority_score = apply_priority_rules(scores)
    if priority_type:
        best_type  = priority_type
        best_score = priority_score
    else:
        best_type  = max(scores, key=scores.get)
        best_score = scores[best_type]

    # Calculer la confiance : score relatif au total
    total = sum(scores.values())
    confidence = round(best_score / total, 2) if total > 0 else 0.5

    # Seuil minimum de confiance
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
# ROUTE FLASK
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
            "error":      "description vide"
        }), 400

    result = detect_type(description)
    return jsonify(result)

# ================================================================
# ROUTE TEST
# ================================================================
@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "reclamation-ml"})

# ================================================================
# TESTS LOCAUX (à exécuter directement)
# ================================================================
if __name__ == '__main__':
    tests = [
        # Originaux
        "Le wifi ne fonctionne pas dans ma chambre depuis ce matin",
        "La climatisation fait du bruit et ne refroidit pas correctement",
        "Ma salle de bain est sale, il n'y a pas d'eau chaude",
        "Le petit déjeuner était froid et il manquait des viennoiseries",
        "Je n'ai pas reçu ma commande du room service depuis 2 heures",
        "La chambre n'est pas conforme à ce que j'ai réservé sur le site",
        "Le voisin du dessus fait du bruit toute la nuit, je ne dors pas",
        "Ma facture comporte des erreurs, j'ai été débité deux fois",
        "Je souhaite être remboursé suite à l'annulation de mon séjour",
        "L'écran de la télévision est cassé",
        "Il y a des cafards dans ma chambre",
        "Le radiateur ne fonctionne pas et il fait froid la nuit",
        "J'ai besoin d'aide pour ma voiture au parking",
        "Le personnel de la réception a été très impoli avec moi",
        "Les draps n'ont pas été changés depuis 3 jours",
        "La piscine est fermée alors qu'elle devrait être ouverte",
        "J'ai perdu des objets dans le coffre-fort de la chambre",
        "Problème général avec mon séjour",
        # Nouveaux tests étendus
        "Le signal Wi-Fi est inexistant dans notre chambre, impossible de se connecter",
        "Il fait une chaleur étouffante, on suffoque, la clim est en panne",
        "On gèle dans la chambre, le chauffage ne répond plus",
        "Les prises électriques ne fonctionnent pas, impossible de charger mon téléphone",
        "La télécommande de la TV est cassée, aucune chaîne ne s'affiche",
        "Des travaux nocturnes nous empêchent de dormir, vacarme insupportable",
        "La chambre est dégoutante, moisissures sur les murs et cafards sous le lit",
        "Le matelas est trop dur, j'ai mal au dos, il s'affaisse au milieu",
        "Il n'y a pas de pression d'eau dans la douche et la baignoire est bouchée",
        "Le restaurant a servi un plat immangeable et froid, mauvais goût",
        "Le buffet du matin est vide dès 8h, plus de croissants ni de jus",
        "Le room service a mis 2 heures, la commande était froide et incorrecte",
        "La piscine est verte et fermée sans aucun avertissement",
        "Le hammam du spa est froid, le sauna est en panne",
        "Notre voiture a été rayée dans le parking, personne ne répond",
        "La réceptionniste a été agressive et notre réservation était introuvable",
        "La femme de chambre est entrée sans frapper et n'a pas changé les serviettes",
        "Des bijoux ont disparu de notre chambre, le coffre-fort est forcé",
        "Frais cachés sur la facture, débité deux fois pour la même nuit",
        "Le remboursement de notre annulation n'est toujours pas arrivé après 3 semaines",
        # Tests multilingues
        "The AC is broken, room temperature is unbearable",
        "No hot water in the shower since yesterday morning",
        "Wifi password doesn't work, I cannot connect at all",
        "الواي فاي لا يعمل في الغرفة منذ الصباح",
        "الحمام قذر ولا توجد مياه ساخنة في الدش",
        "التكييف معطل والغرفة خانقة جداً",
    ]

    print("=" * 70)
    print("TESTS DE DÉTECTION D'INTENTION — v2.0 étendue")
    print("=" * 70)
    for test in tests:
        result = detect_type(test)
        conf   = int(result['confidence'] * 100)
        bar    = '█' * (conf // 5) + '░' * (20 - conf // 5)
        print(f"\n📝 {test[:65]}")
        print(f"   → [{result['type']:20s}]  {bar}  {conf}%  ({result['label']})")
    print("=" * 70)

    # Démarrer le serveur Flask
    app.run(debug=True, port=5001)