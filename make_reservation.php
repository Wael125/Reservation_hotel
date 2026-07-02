<?php
header("Content-Type: application/json; charset=UTF-8");
require "db.php";

ini_set('display_errors', 0);
error_reporting(0);

try {
    $raw = file_get_contents("php://input");
    $data = json_decode($raw, true);

    if (!$data) {
        throw new Exception("JSON invalide reçu");
    }

    // 🔹 récupérer login_id depuis chatbot (peut être username ou numeric login_id)
    $login_identifier = $data["login_id"] ?? null;
    if (!$login_identifier) {
        throw new Exception("login_id manquant");
    }

    // 🔹 Chercher le login_id numérique, OU le créer s'il n'existe pas
    $stmt = $pdo->prepare("SELECT login_id FROM login WHERE login_id = ? OR username = ? LIMIT 1");
    $stmt->execute([$login_identifier, $login_identifier]);
    $login_record = $stmt->fetch();

    if (!$login_record) {
        try {
            $insert_login = $pdo->prepare("INSERT INTO login (username) VALUES (?)");
            $insert_login->execute([$login_identifier]);
            $numeric_login_id = $pdo->lastInsertId();
        } catch (Exception $e) {
            throw new Exception("Impossible de créer le login: " . $e->getMessage());
        }
    } else {
        $numeric_login_id = $login_record["login_id"];
    }

    // 🔹 Chercher le customer associé OU le créer
    $customer_stmt = $pdo->prepare("SELECT id, nom, prenom FROM customer WHERE login_id = ? LIMIT 1");
    $customer_stmt->execute([$numeric_login_id]);
    $customer_record = $customer_stmt->fetch();

    if (!$customer_record) {
        try {
            $insert_customer = $pdo->prepare("INSERT INTO customer (login_id) VALUES (?)");
            $insert_customer->execute([$numeric_login_id]);
            $customer_id     = $pdo->lastInsertId();
            $customer_nom    = "";
            $customer_prenom = "";
        } catch (Exception $e) {
            throw new Exception("Impossible de créer le customer: " . $e->getMessage());
        }
    } else {
        $customer_id     = $customer_record["id"];
        $customer_nom    = $customer_record["nom"]    ?? "";
        $customer_prenom = $customer_record["prenom"] ?? "";
    }

    // 🔹 Données réservation
    $clientName     = $data["clientName"]      ?? null;
    $email          = $data["email"]           ?? null;
    $phone          = $data["phoneNumber"]     ?? null;
    $checkIn        = $data["checkInDate"]     ?? null;
    $checkOut       = $data["checkOutDate"]    ?? null;
    $roomType       = $data["roomType"]        ?? null;
    $roomNumber     = $data["roomNumber"]      ?? null;
    $adults         = $data["numberOfAdults"]  ?? 1;
    $children       = $data["numberOfChildren"] ?? 0;
    $pension        = $data["pension"]         ?? null;
    $paymentDetails = $data["paymentDetails"]  ?? null;
    $totalPrice     = $data["totalPrice"]      ?? null;

    // Validation
    if (!$clientName || !$email || !$phone || !$checkIn || !$checkOut || !$roomType) {
        throw new Exception("Paramètres obligatoires manquants");
    }

    $totalPeople = (int)$adults + (int)$children;

    // 🔹 Insertion en base
    $sql = "INSERT INTO reservation (
        clientName,
        customer_id,
        email,
        phoneNumber,
        checkInDate,
        checkOutDate,
        roomType,
        roomNumber,
        numberOfAdults,
        numberOfChildren,
        totalNumberOfPeople,
        pension,
        paymentDetails,
        totalPrice,
        Status
    ) VALUES (
        :clientName,
        :customer_id,
        :email,
        :phone,
        :checkIn,
        :checkOut,
        :roomType,
        :roomNumber,
        :adults,
        :children,
        :totalPeople,
        :pension,
        :paymentDetails,
        :totalPrice,
        'En attente'
    )";

    $stmt    = $pdo->prepare($sql);
    $success = $stmt->execute([
        "clientName"     => $clientName,
        "customer_id"    => $customer_id,
        "email"          => $email,
        "phone"          => $phone,
        "checkIn"        => $checkIn,
        "checkOut"       => $checkOut,
        "roomType"       => $roomType,
        "roomNumber"     => $roomNumber,
        "adults"         => $adults,
        "children"       => $children,
        "totalPeople"    => $totalPeople,
        "pension"        => $pension,
        "paymentDetails" => $paymentDetails,
        "totalPrice"     => $totalPrice,
    ]);

    if (!$success) {
        throw new Exception("Erreur lors de l'insertion en base");
    }

    $reservation_id = $pdo->lastInsertId();

    // ═══════════════════════════════════════════════════════
    //  ENVOI EMAIL — PHPMailer / Composer (même que reserver.php)
    // ═══════════════════════════════════════════════════════
    $email_sent  = false;
    $email_error = "";

    try {
        if (file_exists(__DIR__ . '/vendor/autoload.php')) {
            require __DIR__ . '/vendor/autoload.php';
        } elseif (file_exists(__DIR__ . '/PHPMailer/PHPMailer.php')) {
            require __DIR__ . '/PHPMailer/PHPMailer.php';
            require __DIR__ . '/PHPMailer/SMTP.php';
            require __DIR__ . '/PHPMailer/Exception.php';
        } else {
            throw new Exception("PHPMailer introuvable");
        }

        // ── Calcul nuits & numéro de facture ──────────────────────────────────
        $start  = new DateTime($checkIn);
        $end    = new DateTime($checkOut);
        $nights = $start->diff($end)->days;

        $mois          = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
        $emissionDate  = date("d") . " " . $mois[(int)date("m") - 1] . " " . date("Y");
        $invoiceNumber = "GH-" . date("Y") . "-" . strtoupper(substr(uniqid(), -5));

        // ── Config PHPMailer ──────────────────────────────────────────────────
        $mail = new PHPMailer\PHPMailer\PHPMailer(true);
        $mail->isSMTP();
        $mail->Host       = 'smtp.gmail.com';
        $mail->SMTPAuth   = true;
        $mail->Username   = 'wael.fraj.2023@ihec.ucar.tn';   // ← votre Gmail
        $mail->Password   = 'jlgb acby oaax llly';            // ← App Password (16 chars)
        $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = 587;
        $mail->CharSet    = 'UTF-8';

        $mail->setFrom('wael.fraj.2023@ihec.ucar.tn', 'Mansour Booking');
        $mail->addAddress($email, trim($customer_prenom . ' ' . $customer_nom) ?: $clientName);

        $mail->Subject = "✅ Confirmation de réservation #{$reservation_id} — Royal Mansour";
        $mail->isHTML(true);
        $mail->Body    = buildEmailHtml([
            'reservation_id' => $reservation_id,
            'invoice_number' => $invoiceNumber,
            'client_nom'     => $customer_nom    ?: $clientName,
            'client_prenom'  => $customer_prenom ?: '',
            'email'          => $email,
            'telephone'      => $phone,
            'room_number'    => $roomNumber,
            'room_type'      => $roomType,
            'check_in'       => $checkIn,
            'check_out'      => $checkOut,
            'nights'         => $nights,
            'adults'         => (int)$adults,
            'children'       => (int)$children,
            'pension'        => $pension        ?? 'Sans pension',
            'payment'        => $paymentDetails ?? '',
            'total_price'    => (float)$totalPrice,
            'emission_date'  => $emissionDate,
        ]);
        $mail->AltBody = buildEmailText(
            $reservation_id,
            $customer_prenom ?: '',
            $customer_nom    ?: $clientName,
            $checkIn, $checkOut, $nights,
            $roomNumber, $roomType,
            $pension        ?? 'Sans pension',
            $paymentDetails ?? '',
            (float)$totalPrice
        );

        $mail->send();
        $email_sent = true;

    } catch (Exception $e) {
        $email_error = $e->getMessage();
        error_log("[EMAIL] Échec envoi réservation #{$reservation_id} : {$email_error}");
    }

    // ═══════════════════════════════════════════════════════
    //  RÉPONSE JSON
    // ═══════════════════════════════════════════════════════
    echo json_encode([
        "status"         => "success",
        "message"        => "Réservation confirmée",
        "reservation_id" => $reservation_id,
        "email_sent"     => $email_sent,
        "email_error"    => $email_error,
    ]);

} catch (Throwable $e) {
    echo json_encode([
        "status"  => "error",
        "message" => $e->getMessage(),
    ]);
}


// ═══════════════════════════════════════════════════════════
//  FONCTIONS EMAIL  (identiques à reserver.php)
// ═══════════════════════════════════════════════════════════

function buildEmailHtml(array $r): string
{
    $roomLabels    = [
        "simple"               => "Chambre Simple 🛏",
        "double"               => "Chambre Double 🛏🛏",
        "triple"               => "Chambre Triple 🛏🛏🛏",
        "suite_junior"         => "Suite Junior ✨",
        "suite_presidentielle" => "Suite Présidentielle 👑",
        "suite"                => "Suite ✨",
    ];
    $pensionLabels = [
        "Sans pension"    => "Sans pension",
        "Petit-déjeuner"  => "Petit-déjeuner ☕",
        "Demi-pension"    => "Demi-pension 🥗",
        "Pension complète"=> "Pension complète 🍽",
        "All inclusive"   => "All Inclusive 🍹",
        "petit_dejeuner"  => "Petit-déjeuner ☕",
        "demi_pension"    => "Demi-pension 🥗",
        "complete"        => "Pension complète 🍽",
    ];
    $paymentLabels = [
        "Carte bancaire"   => "Carte bancaire 💳",
        "Virement bancaire"=> "Virement bancaire 🏦",
        "Espèces"          => "Espèces 💵",
        "espece"           => "Espèces 💵",
        "carte"            => "Carte bancaire 💳",
    ];

    $roomLabel    = $roomLabels[$r['room_type']]  ?? ucfirst($r['room_type']);
    $pensionLabel = $pensionLabels[$r['pension']] ?? $r['pension'];
    $paymentLabel = $paymentLabels[$r['payment']] ?? $r['payment'];

    $nights    = $r['nights'];
    $adults    = $r['adults'];
    $children  = $r['children'];
    $occupants = "{$adults} adulte" . ($adults > 1 ? "s" : "")
               . ($children > 0 ? " + {$children} enfant" . ($children > 1 ? "s" : "") : "");

    $fmt  = fn($d) => date("d/m/Y", strtotime($d));
    $year = date("Y");
    $from = 'wael.fraj.2023@ihec.ucar.tn';

    $row = fn($label, $value, $shaded = false) =>
        '<tr style="' . ($shaded ? 'background:#faf8f4;' : 'background:#fff;') . '">'
        . '<td style="padding:10px 20px;color:#888;font-size:13px;width:42%;border-top:1px solid #f0ebe0;">' . htmlspecialchars($label) . '</td>'
        . '<td style="padding:10px 20px;color:#1a1a2e;font-size:13px;font-weight:600;border-top:1px solid #f0ebe0;text-align:right;">' . $value . '</td>'
        . '</tr>';

    return '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:\'Segoe UI\',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:40px 0;">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0"
  style="background:#fff;border-radius:16px;overflow:hidden;
         box-shadow:0 8px 32px rgba(0,0,0,.12);max-width:620px;">

  <tr>
    <td style="background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);
               padding:44px 40px 36px;text-align:center;">
      <div style="font-size:32px;margin-bottom:10px;">✦</div>
      <h1 style="color:#c9a55a;margin:0 0 4px;font-size:24px;font-weight:700;letter-spacing:2px;">Royal Mansour</h1>
      <p style="color:rgba(255,255,255,.5);margin:0 0 20px;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Luxe · Confort · Excellence</p>
      <div style="display:inline-block;background:rgba(201,165,90,.15);border:1px solid rgba(201,165,90,.4);
                  border-radius:30px;padding:8px 24px;">
        <span style="color:#c9a55a;font-size:13px;font-weight:600;letter-spacing:1px;">✅ RÉSERVATION CONFIRMÉE</span>
      </div>
    </td>
  </tr>

  <tr><td style="padding:32px 40px 0;">
    <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:17px;">Bonjour ' . htmlspecialchars(trim($r['client_prenom'] . ' ' . $r['client_nom'])) . ',</h2>
    <p style="margin:0;color:#555;font-size:14px;line-height:1.7;">
      Votre réservation <strong style="color:#1a1a2e;">#' . $r['reservation_id'] . '</strong>
      a bien été enregistrée. Nous avons hâte de vous accueillir dans notre établissement.
    </p>
  </td></tr>

  <tr><td style="padding:20px 40px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-radius:10px;overflow:hidden;border:1px solid #e8e0d0;">
      <tr><td colspan="2" style="background:linear-gradient(90deg,#1a1a2e,#16213e);padding:11px 20px;">
        <span style="color:#c9a55a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">📅 Détails du séjour</span>
      </td></tr>'
      . $row("Arrivée",    $fmt($r['check_in']),   true)
      . $row("Départ",     $fmt($r['check_out']),  false)
      . $row("Durée",      $nights . " nuit" . ($nights > 1 ? "s" : ""), true)
      . $row("Chambre",    "N° " . htmlspecialchars($r['room_number']) . " — " . $roomLabel, false)
      . $row("Occupants",  $occupants, true)
      . $row("Pension",    $pensionLabel, false)
      . '
    </table>
  </td></tr>

  <tr><td style="padding:14px 40px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-radius:10px;overflow:hidden;border:1px solid #e8e0d0;">
      <tr><td colspan="2" style="background:linear-gradient(90deg,#0f3460,#1a1a2e);padding:11px 20px;">
        <span style="color:#c9a55a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">💳 Paiement</span>
      </td></tr>'
      . $row("Mode",    $paymentLabel, true)
      . $row("Numéro de facture", htmlspecialchars($r['invoice_number']), false)
      . '
      <tr style="background:linear-gradient(90deg,#c9a55a,#e8c97a);">
        <td style="padding:15px 20px;color:#1a1a2e;font-size:14px;font-weight:700;">Montant total</td>
        <td style="padding:15px 20px;color:#1a1a2e;font-size:19px;font-weight:800;text-align:right;">' . number_format($r['total_price'], 0) . ' DT</td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:18px 40px 0;">
    <div style="background:#fffbf0;border-left:4px solid #c9a55a;padding:13px 16px;border-radius:0 8px 8px 0;">
      <p style="margin:0;font-size:13px;color:#7a6000;line-height:1.6;">
        <strong>📌 À noter :</strong> Présentez une pièce d\'identité valide à la réception.
        Check-in à partir de <strong>14h00</strong> · Check-out avant <strong>12h00</strong>.
      </p>
    </div>
  </td></tr>

  <tr><td style="padding:22px 40px;text-align:center;">
    <p style="margin:0 0 4px;font-size:13px;color:#888;">Des questions ?</p>
    <a href="mailto:' . $from . '" style="color:#c9a55a;font-size:13px;font-weight:600;text-decoration:none;">' . $from . '</a>
    <span style="color:#ccc;margin:0 8px;">|</span>
    <span style="color:#555;font-size:13px;">📞 +216 73 681 100</span>
  </td></tr>

  <tr><td style="background:#1a1a2e;padding:18px 40px;text-align:center;">
    <p style="margin:0;font-size:11px;color:rgba(255,255,255,.35);">
      © ' . $year . ' Royal Mansour — Zone Touristique, Mahdia, Tunisie
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>';
}

function buildEmailText(
    int    $reservationId,
    string $prenom,
    string $nom,
    string $checkIn,
    string $checkOut,
    int    $nights,
    string $roomNumber,
    string $roomType,
    string $pension,
    string $payment,
    float  $total
): string {
    $fmt = fn($d) => date("d/m/Y", strtotime($d));
    return "Confirmation de réservation #{$reservationId} — Royal Mansour\n\n"
         . "Bonjour {$prenom} {$nom},\n\n"
         . "Votre réservation est confirmée.\n\n"
         . "SÉJOUR\n"
         . "  Arrivée  : " . $fmt($checkIn)  . "\n"
         . "  Départ   : " . $fmt($checkOut) . " ({$nights} nuit" . ($nights > 1 ? "s" : "") . ")\n"
         . "  Chambre  : {$roomNumber} ({$roomType})\n"
         . "  Pension  : {$pension}\n\n"
         . "PAIEMENT\n"
         . "  Mode     : {$payment}\n"
         . "  TOTAL    : " . number_format($total, 0) . " DT\n\n"
         . "Check-in à partir de 14h00 · Check-out avant 12h00\n"
         . "Présentez une pièce d'identité à la réception.\n\n"
         . "Royal Mansour — Zone Touristique, Mahdia, Tunisie\n"
         . "📞 +216 73 681 100";
}