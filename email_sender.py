import smtplib
import re
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

# ═══════════════════════════════════════════════════════════
#  CONFIGURATION SMTP — à adapter selon ton fournisseur
# ═══════════════════════════════════════════════════════════

SMTP_CONFIG = {
    "host":     "smtp.gmail.com",   # Gmail (ou smtp.office365.com pour Outlook)
    "port":     587,
    "use_tls":  True,
    "username": "wael.fraj.2023@ihec.ucar.tn",     # ← ton adresse email
    "password": "123456789",     # ← mot de passe d'application Gmail (pas ton vrai mdp)
    "from_name": "Hôtel 5 Étoiles",
    "from_addr": "wael.fraj.2023@ihec.ucar.tn"
}


# ═══════════════════════════════════════════════════════════
#  VALIDATION EMAIL
# ═══════════════════════════════════════════════════════════

def is_valid_email(email: str) -> bool:
    """Vérifie que l'adresse email a un format valide."""
    pattern = r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"
    return bool(re.match(pattern, str(email or "").strip()))


# ═══════════════════════════════════════════════════════════
#  TEMPLATE HTML EMAIL
# ═══════════════════════════════════════════════════════════

def build_email_html(data: dict, room: dict, reservation_id) -> str:
    """Construit le corps HTML de l'email de confirmation."""
    from datetime import datetime

    try:
        checkin  = datetime.strptime(data["checkInDate"],  "%Y-%m-%d")
        checkout = datetime.strptime(data["checkOutDate"], "%Y-%m-%d")
        nights   = (checkout - checkin).days
        checkin_fmt  = checkin.strftime("%d %B %Y")
        checkout_fmt = checkout.strftime("%d %B %Y")
    except Exception:
        checkin_fmt  = data.get("checkInDate", "N/A")
        checkout_fmt = data.get("checkOutDate", "N/A")
        nights = "?"

    price = float(room.get("price", 0))
    total = round(price * (nights if isinstance(nights, int) else 0), 2)

    pension_labels = {
        "sans_pension":     "Sans pension",
        "demi_pension":     "Demi-pension",
        "pension_complete": "Pension complète",
        "tout_inclus":      "Tout inclus ⭐"
    }
    payment_labels = {
        "carte_bancaire": "Carte bancaire 💳",
        "espèces":        "Espèces 💵",
        "virement":       "Virement bancaire 🏦",
        "chèque":         "Chèque 📝"
    }

    pension_label  = pension_labels.get(data.get("pension", ""), data.get("pension", "N/A"))
    payment_label  = payment_labels.get(data.get("paymentDetails", ""), data.get("paymentDetails", "N/A"))

    return f"""
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirmation de réservation</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:40px 40px 30px;text-align:center;">
            <div style="font-size:42px;margin-bottom:10px;">🏨</div>
            <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:600;letter-spacing:1px;">
              Confirmation de Réservation
            </h1>
            <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">
              Référence : <strong style="color:#fff;">#{reservation_id}</strong>
            </p>
          </td>
        </tr>

        <!-- GREETING -->
        <tr>
          <td style="padding:32px 40px 0;">
            <p style="font-size:16px;color:#333;margin:0;">
              Bonjour <strong>{data.get('clientName', 'Client')}</strong>,
            </p>
            <p style="font-size:14px;color:#555;margin:12px 0 0;line-height:1.6;">
              Nous avons le plaisir de vous confirmer votre réservation dans notre établissement.
              Voici le récapitulatif de votre séjour :
            </p>
          </td>
        </tr>

        <!-- DETAILS TABLE -->
        <tr>
          <td style="padding:24px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid #e8e8e8;">

              <!-- Section séjour -->
              <tr>
                <td colspan="2" style="background:#667eea;padding:10px 20px;">
                  <span style="color:#fff;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">
                    📅 Séjour
                  </span>
                </td>
              </tr>
              <tr style="background:#fafafa;">
                <td style="padding:12px 20px;color:#666;font-size:13px;width:45%;">Arrivée</td>
                <td style="padding:12px 20px;color:#333;font-size:13px;font-weight:600;">{checkin_fmt}</td>
              </tr>
              <tr>
                <td style="padding:12px 20px;color:#666;font-size:13px;border-top:1px solid #f0f0f0;">Départ</td>
                <td style="padding:12px 20px;color:#333;font-size:13px;font-weight:600;border-top:1px solid #f0f0f0;">{checkout_fmt}</td>
              </tr>
              <tr style="background:#fafafa;">
                <td style="padding:12px 20px;color:#666;font-size:13px;border-top:1px solid #f0f0f0;">Durée</td>
                <td style="padding:12px 20px;color:#333;font-size:13px;font-weight:600;border-top:1px solid #f0f0f0;">{nights} nuit(s)</td>
              </tr>

              <!-- Section chambre -->
              <tr>
                <td colspan="2" style="background:#764ba2;padding:10px 20px;">
                  <span style="color:#fff;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">
                    🛏️ Chambre
                  </span>
                </td>
              </tr>
              <tr style="background:#fafafa;">
                <td style="padding:12px 20px;color:#666;font-size:13px;">Numéro</td>
                <td style="padding:12px 20px;color:#333;font-size:13px;font-weight:600;">{room.get('roomnumber', 'N/A')}</td>
              </tr>
              <tr>
                <td style="padding:12px 20px;color:#666;font-size:13px;border-top:1px solid #f0f0f0;">Type</td>
                <td style="padding:12px 20px;color:#333;font-size:13px;font-weight:600;border-top:1px solid #f0f0f0;">{data.get('roomType', 'N/A').capitalize()}</td>
              </tr>
              <tr style="background:#fafafa;">
                <td style="padding:12px 20px;color:#666;font-size:13px;border-top:1px solid #f0f0f0;">Occupants</td>
                <td style="padding:12px 20px;color:#333;font-size:13px;font-weight:600;border-top:1px solid #f0f0f0;">
                  {data.get('adults', 1)} adulte(s) + {data.get('children', 0)} enfant(s)
                </td>
              </tr>
              <tr>
                <td style="padding:12px 20px;color:#666;font-size:13px;border-top:1px solid #f0f0f0;">Pension</td>
                <td style="padding:12px 20px;color:#333;font-size:13px;font-weight:600;border-top:1px solid #f0f0f0;">{pension_label}</td>
              </tr>

              <!-- Section paiement -->
              <tr>
                <td colspan="2" style="background:#5a4a9e;padding:10px 20px;">
                  <span style="color:#fff;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">
                    💰 Paiement
                  </span>
                </td>
              </tr>
              <tr style="background:#fafafa;">
                <td style="padding:12px 20px;color:#666;font-size:13px;">Mode</td>
                <td style="padding:12px 20px;color:#333;font-size:13px;font-weight:600;">{payment_label}</td>
              </tr>
              <tr>
                <td style="padding:12px 20px;color:#666;font-size:13px;border-top:1px solid #f0f0f0;">Prix / nuit</td>
                <td style="padding:12px 20px;color:#333;font-size:13px;font-weight:600;border-top:1px solid #f0f0f0;">{price:.2f} DT</td>
              </tr>

              <!-- TOTAL -->
              <tr style="background:linear-gradient(135deg,#667eea,#764ba2);">
                <td style="padding:16px 20px;color:#fff;font-size:15px;font-weight:700;">TOTAL</td>
                <td style="padding:16px 20px;color:#fff;font-size:18px;font-weight:700;">{total:.2f} DT</td>
              </tr>

            </table>
          </td>
        </tr>

        <!-- NOTE -->
        <tr>
          <td style="padding:0 40px 24px;">
            <div style="background:#fff8e1;border-left:4px solid #ffc107;padding:14px 16px;border-radius:0 6px 6px 0;">
              <p style="margin:0;font-size:13px;color:#7a6000;line-height:1.5;">
                ℹ️ Veuillez vous présenter à la réception avec une pièce d'identité valide.
                L'enregistrement se fait à partir de <strong>14h00</strong> et le départ avant <strong>12h00</strong>.
              </p>
            </div>
          </td>
        </tr>

        <!-- CONTACT -->
        <tr>
          <td style="padding:0 40px 32px;text-align:center;">
            <p style="font-size:13px;color:#888;line-height:1.6;margin:0;">
              Pour toute question, contactez-nous à<br>
              <a href="mailto:{SMTP_CONFIG['from_addr']}" style="color:#667eea;text-decoration:none;">
                {SMTP_CONFIG['from_addr']}
              </a>
              &nbsp;|&nbsp; 📞 +216 XX XXX XXX
            </p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#f8f8f8;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;font-size:12px;color:#aaa;">
              © {datetime.now().year} {SMTP_CONFIG['from_name']} — Tous droits réservés
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def build_email_text(data: dict, room: dict, reservation_id) -> str:
    """Version texte brut (fallback)."""
    try:
        checkin  = datetime.strptime(data["checkInDate"],  "%Y-%m-%d")
        checkout = datetime.strptime(data["checkOutDate"], "%Y-%m-%d")
        nights   = (checkout - checkin).days
    except Exception:
        nights = "?"

    price = float(room.get("price", 0))
    total = round(price * (nights if isinstance(nights, int) else 0), 2)

    return f"""
Confirmation de Réservation — Réf. #{reservation_id}

Bonjour {data.get('clientName', 'Client')},

Votre réservation est confirmée :

SÉJOUR
  Arrivée  : {data.get('checkInDate')}
  Départ   : {data.get('checkOutDate')} ({nights} nuit(s))

CHAMBRE
  N°       : {room.get('roomnumber', 'N/A')}
  Type     : {data.get('roomType', 'N/A')}
  Pension  : {data.get('pension', 'N/A')}

PAIEMENT
  Mode     : {data.get('paymentDetails', 'N/A')}
  Total    : {total:.2f} DT

Présentez-vous à la réception avec une pièce d'identité.
Check-in à partir de 14h00, check-out avant 12h00.

{SMTP_CONFIG['from_name']}
{SMTP_CONFIG['from_addr']}
""".strip()


# ═══════════════════════════════════════════════════════════
#  FONCTION PRINCIPALE D'ENVOI
# ═══════════════════════════════════════════════════════════

def send_confirmation_email(data: dict, room: dict, reservation_id) -> dict:
    """
    Envoie l'email de confirmation au client.
    Retourne {"success": True} ou {"success": False, "error": "..."}
    """
    to_email = data.get("email", "").strip()

    # Valider l'email
    if not is_valid_email(to_email):
        return {"success": False, "error": f"Email invalide ou absent : '{to_email}'"}

    try:
        # Construire le message multipart (HTML + texte)
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"✅ Confirmation de réservation #{reservation_id} — {SMTP_CONFIG['from_name']}"
        msg["From"]    = f"{SMTP_CONFIG['from_name']} <{SMTP_CONFIG['from_addr']}>"
        msg["To"]      = to_email

        # Attacher les deux versions (texte d'abord, HTML en dernier = prioritaire)
        msg.attach(MIMEText(build_email_text(data, room, reservation_id), "plain", "utf-8"))
        msg.attach(MIMEText(build_email_html(data, room, reservation_id), "html",  "utf-8"))

        # Connexion SMTP
        with smtplib.SMTP(SMTP_CONFIG["host"], SMTP_CONFIG["port"]) as server:
            if SMTP_CONFIG["use_tls"]:
                server.starttls()
            server.login(SMTP_CONFIG["username"], SMTP_CONFIG["password"])
            server.sendmail(SMTP_CONFIG["from_addr"], to_email, msg.as_string())

        print(f"[EMAIL] ✅ Envoyé à {to_email} (réservation #{reservation_id})")
        return {"success": True}

    except smtplib.SMTPAuthenticationError:
        err = "Authentification SMTP échouée — vérifiez username/password dans SMTP_CONFIG"
        print(f"[EMAIL] ❌ {err}")
        return {"success": False, "error": err}

    except smtplib.SMTPException as e:
        err = f"Erreur SMTP : {str(e)}"
        print(f"[EMAIL] ❌ {err}")
        return {"success": False, "error": err}

    except Exception as e:
        err = f"Erreur inattendue : {str(e)}"
        print(f"[EMAIL] ❌ {err}")
        return {"success": False, "error": err}