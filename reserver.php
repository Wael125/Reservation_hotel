<?php
session_start();
require "db.php";

if ($_SERVER["REQUEST_METHOD"] === "POST") {

    // ═══════════════════════════════════════════
    //  1. DONNÉES
    // ═══════════════════════════════════════════
    $nom          = trim($_POST["nom"]);
    $email        = $_POST["email"];
    $tel          = $_POST["telephone"];
    $date_arrivee = $_POST["date_arrivee"];
    $date_depart  = $_POST["date_depart"];
    $roomType     = $_POST["type_chambre"];
    $adultes      = (int)$_POST["adultes"];
    $enfants      = (int)$_POST["enfants"];
    $paiement     = $_POST["paiement"];
    $pension      = $_POST["pension"];
    $today        = date("Y-m-d");

    // ═══════════════════════════════════════════
    //  2. VALIDATIONS
    // ═══════════════════════════════════════════
    if (!preg_match("/^[A-Za-zÀ-ÿ\s]+$/", $nom))     die("Nom invalide");
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))    die("Email invalide");
    if (!preg_match("/^[0-9]{8}$/", $tel))             die("Téléphone invalide");
    if ($date_arrivee < $today)                        die("Date arrivée invalide");
    if ($date_depart <= $date_arrivee)                 die("Date départ invalide");
    if ($adultes < 1)                                  die("Au moins 1 adulte");
    if (($adultes + $enfants) > 4)                     die("Max 4 personnes");

    // ═══════════════════════════════════════════
    //  3. CUSTOMER
    // ═══════════════════════════════════════════
    $login_id = $_SESSION["login_id"];
    $stmt = $pdo->prepare("SELECT id, nom, prenom FROM customer WHERE login_id = ?");
    $stmt->execute([$login_id]);
    $customer = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$customer) die("❌ Client introuvable");
    $customer_id     = $customer["id"];
    $customer_nom    = $customer["nom"]    ?? "";
    $customer_prenom = $customer["prenom"] ?? "";

    // ═══════════════════════════════════════════
    //  4. CALCUL PRIX
    // ═══════════════════════════════════════════
    $start = new DateTime($date_arrivee);
    $end   = new DateTime($date_depart);
    $days  = $start->diff($end)->days;

    $pricePerAdult = match($roomType) {
        "simple" => 100, "double" => 120, "suite" => 150, default => 0
    };
    $pricePerChild = match($roomType) {
        "simple" => 50,  "double" => 60,  "suite" => 75,  default => 0
    };
    $pensionPricePerDay = match($pension) {
        "petit_dejeuner" => 15, "demi_pension" => 30, "complete" => 40, default => 0
    };

    $totalRoomPrice    = $days * ($adultes * $pricePerAdult + $enfants * $pricePerChild);
    $totalPensionPrice = $days * $pensionPricePerDay * ($adultes + $enfants);
    $totalPrice        = $totalRoomPrice + $totalPensionPrice;

    // ═══════════════════════════════════════════
    //  5. CHAMBRE DISPONIBLE
    // ═══════════════════════════════════════════
    $roomStmt = $pdo->prepare("
        SELECT roomNumber FROM room
        WHERE roomType = ?
          AND roomNumber NOT IN (
              SELECT roomNumber FROM reservation
              WHERE NOT (checkOutDate <= ? OR checkInDate >= ?)
          )
        LIMIT 1
    ");
    $roomStmt->execute([$roomType, $date_arrivee, $date_depart]);
    $room = $roomStmt->fetch(PDO::FETCH_ASSOC);
    if (!$room) die("❌ Aucune chambre disponible pour ces dates");
    $roomNumber = $room["roomNumber"];

    // ═══════════════════════════════════════════
    //  6. NUMÉRO DE FACTURE
    // ═══════════════════════════════════════════
    $mois         = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
    $emissionDate = date("d") . " " . $mois[(int)date("m")-1] . " " . date("Y");
    $invoiceNumber = "GH-" . date("Y") . "-" . strtoupper(substr(uniqid(), -5));

    // ═══════════════════════════════════════════
    //  7. INSERTION EN BASE
    // ═══════════════════════════════════════════
    $insert = $pdo->prepare("
        INSERT INTO reservation (
            clientName, customer_id, email, phoneNumber,
            checkInDate, checkOutDate, roomType, roomNumber,
            numberOfAdults, numberOfChildren, totalNumberOfPeople,
            paymentDetails, pension, totalPrice, Status
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ");
    $insert->execute([
        $nom, $customer_id, $email, $tel,
        $date_arrivee, $date_depart, $roomType, $roomNumber,
        $adultes, $enfants, $adultes + $enfants,
        $paiement, $pension, $totalPrice, "En attente"
    ]);
    $reservationId = $pdo->lastInsertId();

    // ═══════════════════════════════════════════
    //  8. ENVOI EMAIL (PHPMailer via Composer)
    // ═══════════════════════════════════════════
    $emailSent = false;
    $emailError = "";

    try {
        if (file_exists(__DIR__ . '/vendor/autoload.php')) {
            require __DIR__ . '/vendor/autoload.php';
        } elseif (file_exists(__DIR__ . '/PHPMailer/PHPMailer.php')) {
            require __DIR__ . '/PHPMailer/PHPMailer.php';
            require __DIR__ . '/PHPMailer/SMTP.php';
            require __DIR__ . '/PHPMailer/Exception.php';
        } else {
            throw new Exception("PHPMailer introuvable — voir commentaires dans reserver.php");
        }

        $mail = new PHPMailer\PHPMailer\PHPMailer(true);

        // ── Config SMTP ──────────────────────────────────
        $mail->isSMTP();
        $mail->Host       = 'smtp.gmail.com';
        $mail->SMTPAuth   = true;
        $mail->Username   = 'wael.fraj.2023@ihec.ucar.tn';
        $mail->Password   = 'jlgb acby oaax llly';
        $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = 587;
        $mail->CharSet    = 'UTF-8';

        // ── Expéditeur / Destinataire ────────────────────
        $mail->setFrom('royal.mansour@iberostar.tn', 'Royal Mansour');
        $mail->addAddress($email, $customer_prenom . ' ' . $customer_nom);

        // ── Sujet ────────────────────────────────────────
        $mail->Subject = "⏳ Réservation #{$reservationId} reçue — En attente de confirmation — Royal Mansour";

        // ── Corps HTML ───────────────────────────────────
        $mail->isHTML(true);
        $mail->Body    = buildEmailHtml([
            'reservation_id'  => $reservationId,
            'invoice_number'  => $invoiceNumber,
            'client_nom'      => $customer_nom,
            'client_prenom'   => $customer_prenom,
            'email'           => $email,
            'telephone'       => $tel,
            'room_number'     => $roomNumber,
            'room_type'       => $roomType,
            'check_in'        => $date_arrivee,
            'check_out'       => $date_depart,
            'nights'          => $days,
            'adults'          => $adultes,
            'children'        => $enfants,
            'pension'         => $pension,
            'payment'         => $paiement,
            'total_room'      => $totalRoomPrice,
            'total_pension'   => $totalPensionPrice,
            'total_price'     => $totalPrice,
            'price_adult'     => $pricePerAdult,
            'price_child'     => $pricePerChild,
            'price_pension'   => $pensionPricePerDay,
            'emission_date'   => $emissionDate,
        ]);
        $mail->AltBody = buildEmailText($reservationId, $customer_prenom, $customer_nom,
                                        $date_arrivee, $date_depart, $days,
                                        $roomNumber, $roomType, $pension,
                                        $paiement, $totalPrice);

        $mail->send();
        $emailSent = true;

    } catch (Exception $e) {
        $emailError = $e->getMessage();
        error_log("[EMAIL] Échec envoi réservation #{$reservationId} : {$emailError}");
    }

    // ═══════════════════════════════════════════
    //  LABELS POUR LA PAGE DE CONFIRMATION
    // ═══════════════════════════════════════════
    $roomLabels    = ["simple" => "Chambre Simple", "double" => "Chambre Double", "suite" => "Suite"];
    $pensionLabels = ["petit_dejeuner" => "Petit déjeuner", "demi_pension" => "Demi-pension", "complete" => "Pension complète"];
    $paiementLabels = ["espece" => "Espèces (à l'hôtel)", "carte" => "Carte bancaire", "paypal" => "PayPal"];
    $formatDate    = fn($d) => date("d/m/Y", strtotime($d));
    $occupants     = $adultes . " adulte" . ($adultes > 1 ? "s" : "") .
                     ($enfants > 0 ? " + " . $enfants . " enfant" . ($enfants > 1 ? "s" : "") : "");
    $priceAdultLine = $days * $adultes * $pricePerAdult;
    $priceChildLine = $days * $enfants * $pricePerChild;
    $pensionLine    = $totalPensionPrice;

    // ═══════════════════════════════════════════
    //  PAGE DE CONFIRMATION (HTML)
    // ═══════════════════════════════════════════
?>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Facture — Royal Mansour</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,400&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="reserver.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <style>
    .success-banner {
      background: linear-gradient(135deg, #2e7d52, #1e5c3a);
      color: #fff; padding: 14px 24px; border-radius: 12px;
      display: flex; align-items: center; gap: 12px;
      margin-bottom: 20px; font-size: .9rem; font-weight: 500;
    }
    .email-banner {
      padding: 10px 18px; border-radius: 8px; margin-bottom: 24px;
      font-size: .82rem; display: flex; align-items: center; gap: 8px;
    }
    .email-banner.ok  { background: rgba(78,205,196,.12); border: 1px solid rgba(78,205,196,.3); color: #4ecdc4; }
    .email-banner.err { background: rgba(224,123,138,.12); border: 1px solid rgba(224,123,138,.3); color: #e07b8a; }
    .conf-actions {
      display: flex; gap: 12px; justify-content: flex-end;
      margin-top: 24px; flex-wrap: wrap;
    }
  </style>
</head>
<body>
  <div class="bg-overlay"></div>
  <div class="page-wrap">
    <header class="site-header">
      <div class="logo"><span class="logo-star">✦</span><span class="logo-text">Royal Mansour</span></div>
      <a href="dashboard.php" class="btn-back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        Tableau de bord
      </a>
    </header>

    <main class="reservation-card" style="padding:40px 48px;">

      <!-- Bandeau succès -->
      <div class="success-banner">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <div>
          <strong>Réservation reçue !</strong><br>
          Chambre <b><?= htmlspecialchars($roomNumber) ?></b> pré-réservée pour <?= htmlspecialchars($occupants) ?>. En attente de confirmation par l'administrateur.
        </div>
      </div>

      <!-- Bandeau email -->
      <?php if ($emailSent): ?>
      <div class="email-banner ok">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        📧 Email de notification envoyé à <strong><?= htmlspecialchars($email) ?></strong> — vous recevrez un second email à la confirmation.
      </div>
      <?php else: ?>
      <div class="email-banner err">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Réservation enregistrée — email non envoyé (vérifiez la config SMTP).
      </div>
      <?php endif; ?>

      <!-- FACTURE -->
      <div class="invoice-wrapper">
        <div class="invoice" id="invoicePrint">

          <div class="invoice-header">
            <div class="invoice-brand">
              <div class="invoice-logo">
                <span class="inv-logo-star">✦</span>
                <span class="inv-logo-text">Royal Mansour</span>
              </div>
              <p class="invoice-tagline">Luxe · Confort · Excellence</p>
              <p class="invoice-address">Zone Touristique, Mahdia, Tunisie<br>Tél : +216 71 681 100</p>
            </div>
            <div class="invoice-meta">
              <div class="invoice-badge">FACTURE</div>
              <p class="invoice-num">N° <?= htmlspecialchars($invoiceNumber) ?></p>
              <p class="invoice-date">Émise le <?= $emissionDate ?></p>
              <div class="invoice-status-badge">
                <span class="status-dot"></span>En attente de confirmation
              </div>
            </div>
          </div>

          <div class="invoice-divider"></div>

          <div class="invoice-info-row">
            <div class="invoice-info-block">
              <p class="inv-block-title">Client</p>
              <p class="inv-name"><?= htmlspecialchars($customer_prenom . ' ' . $customer_nom) ?></p>
              <p class="inv-detail"><?= htmlspecialchars($email) ?></p>
              <p class="inv-detail"><?= htmlspecialchars($tel) ?></p>
            </div>
            <div class="invoice-info-block">
              <p class="inv-block-title">Séjour</p>
              <p class="inv-detail"><span class="inv-label">Arrivée :</span> <?= $formatDate($date_arrivee) ?></p>
              <p class="inv-detail"><span class="inv-label">Départ :</span> <?= $formatDate($date_depart) ?></p>
              <p class="inv-detail"><span class="inv-label">Durée :</span> <?= $days ?> nuit<?= $days > 1 ? "s" : "" ?></p>
              <p class="inv-detail"><span class="inv-label">Chambre :</span> <?= htmlspecialchars($roomNumber) ?> (<?= htmlspecialchars($roomLabels[$roomType] ?? $roomType) ?>)</p>
              <p class="inv-detail"><span class="inv-label">Occupants :</span> <?= htmlspecialchars($occupants) ?></p>
            </div>
            <div class="invoice-info-block">
              <p class="inv-block-title">Paiement</p>
              <p class="inv-detail"><span class="inv-label">Mode :</span> <?= htmlspecialchars($paiementLabels[$paiement] ?? $paiement) ?></p>
              <p class="inv-detail"><span class="inv-label">Statut :</span> <span class="inv-status">En attente de confirmation</span></p>
            </div>
          </div>

          <div class="invoice-divider"></div>

          <table class="invoice-table">
            <thead>
              <tr><th>Désignation</th><th>Unité</th><th>Quantité</th><th>Prix unitaire</th><th>Total</th></tr>
            </thead>
            <tbody>
              <?php if ($adultes > 0): ?>
              <tr>
                <td><?= htmlspecialchars($roomLabels[$roomType] ?? $roomType) ?> — Adultes</td>
                <td>nuit</td><td><?= $days ?> × <?= $adultes ?> pers.</td>
                <td><?= $pricePerAdult ?> DT</td><td><?= $priceAdultLine ?> DT</td>
              </tr>
              <?php endif; ?>
              <?php if ($enfants > 0): ?>
              <tr>
                <td><?= htmlspecialchars($roomLabels[$roomType] ?? $roomType) ?> — Enfants</td>
                <td>nuit</td><td><?= $days ?> × <?= $enfants ?> pers.</td>
                <td><?= $pricePerChild ?> DT</td><td><?= $priceChildLine ?> DT</td>
              </tr>
              <?php endif; ?>
              <?php if ($pensionPricePerDay > 0): ?>
              <tr>
                <td><?= htmlspecialchars($pensionLabels[$pension] ?? $pension) ?></td>
                <td>nuit</td><td><?= $days ?> × <?= ($adultes + $enfants) ?> pers.</td>
                <td><?= $pensionPricePerDay ?> DT</td><td><?= $pensionLine ?> DT</td>
              </tr>
              <?php endif; ?>
            </tbody>
          </table>

          <div class="invoice-divider"></div>

          <div class="invoice-totals">
            <div class="inv-total-row"><span>Sous-total hébergement</span><span><?= $totalRoomPrice ?> DT</span></div>
            <?php if ($totalPensionPrice > 0): ?>
            <div class="inv-total-row"><span>Pension</span><span><?= $totalPensionPrice ?> DT</span></div>
            <?php endif; ?>
            <div class="inv-total-row inv-tva-row"><span>TVA (0%)</span><span>0 DT</span></div>
            <div class="inv-grand-total"><span>Montant total</span><strong><?= $totalPrice ?> DT</strong></div>
          </div>

          <div class="invoice-footer-note">
            Cette facture est un justificatif de votre demande de réservation (Réf. #<?= $reservationId ?>).
            Elle sera définitivement validée après confirmation par notre équipe. Aucun paiement n'est dû avant cette confirmation.
          </div>

        </div>
      </div>

      <div class="conf-actions">
        <button type="button" class="btn-export btn-print" onclick="window.print()">🖨 Imprimer</button>
        <button type="button" class="btn-export btn-pdf"   onclick="exportPDF()">📄 Exporter PDF</button>
        <a href="dashboard.php" class="btn-export" style="text-decoration:none;">🏠 Tableau de bord</a>
      </div>

    </main>
    <footer class="site-footer"><p>© 2025 Royal Mansour — Tous droits réservés</p></footer>
  </div>

  <script>
  function exportPDF() {
    const el = document.getElementById("invoicePrint");
    html2pdf().set({
      margin: [10,10,10,10],
      filename: "<?= addslashes($invoiceNumber) ?>.pdf",
      image: { type:"jpeg", quality:0.98 },
      html2canvas: { scale:2, useCORS:true },
      jsPDF: { unit:"mm", format:"a4", orientation:"portrait" }
    }).from(el).save();
  }
  </script>
  <style>
  @media print {
    .bg-overlay,.site-header,.conf-actions,.site-footer,.email-banner { display:none!important; }
    .reservation-card { box-shadow:none;border-radius:0;padding:0!important; }
    .success-banner   { display:none!important; }
    .invoice          { padding:20px 28px; }
    .status-dot       { animation:none; }
  }
  </style>
</body>
</html>
<?php
} // end POST


// ═══════════════════════════════════════════════════════════
//  FONCTIONS EMAIL
// ═══════════════════════════════════════════════════════════

/**
 * Corps HTML de l'email — design Royal Mansour (dark luxury)
 * Email de RÉCEPTION de demande — EN ATTENTE de confirmation admin
 */
function buildEmailHtml(array $r): string
{
    $roomLabels    = ["simple" => "Chambre Simple 🛏", "double" => "Chambre Double 🛏🛏", "suite" => "Suite ✨"];
    $pensionLabels = ["petit_dejeuner" => "Petit-déjeuner ☕ (+15 DT/pers/nuit)", "demi_pension" => "Demi-pension 🥗 (+30 DT/pers/nuit)", "complete" => "Pension complète 🍽 (+40 DT/pers/nuit)"];
    $paymentLabels = ["espece" => "Espèces 💵 (à l'hôtel)", "carte" => "Carte bancaire 💳", "paypal" => "PayPal 🅿"];

    $roomLabel    = $roomLabels[$r['room_type']]    ?? ucfirst($r['room_type']);
    $pensionLabel = $pensionLabels[$r['pension']]   ?? $r['pension'];
    $paymentLabel = $paymentLabels[$r['payment']]   ?? $r['payment'];

    $nights      = $r['nights'];
    $adults      = $r['adults'];
    $children    = $r['children'];
    $occupants   = "{$adults} adulte" . ($adults > 1 ? "s" : "") . ($children > 0 ? " + {$children} enfant" . ($children > 1 ? "s" : "") : "");

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

  <!-- HEADER -->
  <tr>
    <td style="background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);
               padding:44px 40px 36px;text-align:center;">
      <div style="font-size:32px;margin-bottom:10px;">✦</div>
      <h1 style="color:#c9a55a;margin:0 0 4px;font-size:24px;font-weight:700;letter-spacing:2px;">Royal Mansour</h1>
      <p style="color:rgba(255,255,255,.5);margin:0 0 20px;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Luxe · Confort · Excellence</p>
      <div style="display:inline-block;background:rgba(201,165,90,.15);border:1px solid rgba(201,165,90,.4);
                  border-radius:30px;padding:8px 24px;">
        <span style="color:#c9a55a;font-size:13px;font-weight:600;letter-spacing:1px;">⏳ RÉSERVATION REÇUE — EN ATTENTE DE CONFIRMATION</span>
      </div>
    </td>
  </tr>

  <!-- INTRO -->
  <tr><td style="padding:32px 40px 0;">
    <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:17px;">Bonjour ' . htmlspecialchars($r['client_prenom'] . ' ' . $r['client_nom']) . ',</h2>
    <p style="margin:0;color:#555;font-size:14px;line-height:1.7;">
      Votre demande de réservation <strong style="color:#1a1a2e;">#' . $r['reservation_id'] . '</strong>
      a bien été <strong>reçue</strong> et est actuellement
      <strong style="color:#c9a55a;">en attente de confirmation</strong> par notre équipe.<br><br>
      Vous recevrez un <strong>second email de confirmation définitive</strong> dès qu\'un administrateur
      aura validé votre demande. Aucun paiement n\'est requis avant cette étape.
    </p>
  </td></tr>

  <!-- BLOC ÉTAPES -->
  <tr><td style="padding:24px 40px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-radius:10px;overflow:hidden;border:1px solid #e8e0d0;">
      <tr><td colspan="2" style="background:linear-gradient(90deg,#0f3460,#1a1a2e);padding:11px 20px;">
        <span style="color:#c9a55a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">📋 Prochaines étapes</span>
      </td></tr>
      <tr style="background:#faf8f4;">
        <td style="padding:12px 20px;border-top:1px solid #f0ebe0;width:36px;">
          <div style="width:28px;height:28px;border-radius:50%;background:#c9a55a;color:#1a1a2e;
                      font-weight:700;font-size:13px;text-align:center;line-height:28px;">1</div>
        </td>
        <td style="padding:12px 20px;border-top:1px solid #f0ebe0;color:#444;font-size:13px;">
          <strong style="color:#1a1a2e;">Demande reçue</strong> ✅<br>
          <span style="color:#888;">Votre réservation #' . $r['reservation_id'] . ' est enregistrée dans notre système.</span>
        </td>
      </tr>
      <tr style="background:#fff;">
        <td style="padding:12px 20px;border-top:1px solid #f0ebe0;">
          <div style="width:28px;height:28px;border-radius:50%;background:#e0d5c0;color:#888;
                      font-weight:700;font-size:13px;text-align:center;line-height:28px;">2</div>
        </td>
        <td style="padding:12px 20px;border-top:1px solid #f0ebe0;color:#888;font-size:13px;">
          <strong style="color:#555;">Examen par notre équipe</strong> ⏳<br>
          <span>Nous vérifions la disponibilité et traitons votre demande.</span>
        </td>
      </tr>
      <tr style="background:#faf8f4;">
        <td style="padding:12px 20px;border-top:1px solid #f0ebe0;">
          <div style="width:28px;height:28px;border-radius:50%;background:#e0d5c0;color:#888;
                      font-weight:700;font-size:13px;text-align:center;line-height:28px;">3</div>
        </td>
        <td style="padding:12px 20px;border-top:1px solid #f0ebe0;color:#888;font-size:13px;">
          <strong style="color:#555;">Email de confirmation</strong> 📧<br>
          <span>Vous recevrez un email définitif avec tous les détails de votre séjour.</span>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- DÉTAILS DU SÉJOUR -->
  <tr><td style="padding:20px 40px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-radius:10px;overflow:hidden;border:1px solid #e8e0d0;">
      <tr><td colspan="2" style="background:linear-gradient(90deg,#1a1a2e,#16213e);padding:11px 20px;">
        <span style="color:#c9a55a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">📅 Récapitulatif de votre demande</span>
      </td></tr>'
      . $row("Référence",  "#" . $r['reservation_id'], true)
      . $row("Arrivée",    $fmt($r['check_in']),  false)
      . $row("Départ",     $fmt($r['check_out']), true)
      . $row("Durée",      $nights . " nuit" . ($nights > 1 ? "s" : ""), false)
      . $row("Chambre",    "N° " . htmlspecialchars($r['room_number']) . " — " . $roomLabel, true)
      . $row("Occupants",  $occupants, false)
      . $row("Pension",    $pensionLabel, true)
      . '
    </table>
  </td></tr>

  <!-- PAIEMENT -->
  <tr><td style="padding:14px 40px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"
      style="border-radius:10px;overflow:hidden;border:1px solid #e8e0d0;">
      <tr><td colspan="2" style="background:linear-gradient(90deg,#0f3460,#1a1a2e);padding:11px 20px;">
        <span style="color:#c9a55a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">💳 Estimation financière</span>
      </td></tr>'
      . $row("Mode de paiement", $paymentLabel, true)
      . $row("Hébergement", number_format($r['total_room'], 0) . " DT", false)
      . ($r['total_pension'] > 0 ? $row("Pension", number_format($r['total_pension'], 0) . " DT", true) : "")
      . '
      <tr style="background:linear-gradient(90deg,#c9a55a,#e8c97a);">
        <td style="padding:15px 20px;color:#1a1a2e;font-size:14px;font-weight:700;">Montant estimé</td>
        <td style="padding:15px 20px;color:#1a1a2e;font-size:19px;font-weight:800;text-align:right;">' . number_format($r['total_price'], 0) . ' DT</td>
      </tr>
    </table>
  </td></tr>

  <!-- NOTE IMPORTANTE -->
  <tr><td style="padding:18px 40px 0;">
    <div style="background:#fffbf0;border-left:4px solid #c9a55a;padding:13px 16px;border-radius:0 8px 8px 0;">
      <p style="margin:0;font-size:13px;color:#7a6000;line-height:1.6;">
        <strong>⚠️ Important :</strong> Cette notification confirme uniquement la <strong>réception</strong> de votre demande.
        Votre réservation sera effective uniquement après réception de l\'email de confirmation officiel de notre équipe.
        <strong>Aucun paiement n\'est dû à ce stade.</strong>
      </p>
    </div>
  </td></tr>

  <!-- CONTACT -->
  <tr><td style="padding:22px 40px;text-align:center;">
    <p style="margin:0 0 4px;font-size:13px;color:#888;">Des questions ? Contactez-nous</p>
    <a href="mailto:' . $from . '" style="color:#c9a55a;font-size:13px;font-weight:600;text-decoration:none;">' . $from . '</a>
    <span style="color:#ccc;margin:0 8px;">|</span>
    <span style="color:#555;font-size:13px;">📞 +216 71 681 100</span>
  </td></tr>

  <!-- FOOTER -->
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

/**
 * Version texte brut (fallback clients mail basiques)
 * Email de RÉCEPTION — EN ATTENTE de confirmation admin
 */
function buildEmailText(
    int $reservationId, string $prenom, string $nom,
    string $checkIn, string $checkOut, int $days,
    string $roomNumber, string $roomType, string $pension,
    string $payment, float $total
): string {
    $fmt = fn($d) => date("d/m/Y", strtotime($d));
    return "Demande de réservation #{$reservationId} reçue — En attente de confirmation — Royal Mansour\n\n"
         . "Bonjour {$prenom} {$nom},\n\n"
         . "Votre demande de réservation a bien été reçue et est EN ATTENTE DE CONFIRMATION par notre équipe.\n"
         . "Vous recevrez un second email dès qu'un administrateur aura validé votre demande.\n"
         . "Aucun paiement n'est requis avant cette confirmation.\n\n"
         . "RÉCAPITULATIF DE VOTRE DEMANDE\n"
         . "  Référence : #{$reservationId}\n"
         . "  Arrivée   : " . $fmt($checkIn)  . "\n"
         . "  Départ    : " . $fmt($checkOut) . " ({$days} nuit" . ($days > 1 ? "s" : "") . ")\n"
         . "  Chambre   : {$roomNumber} ({$roomType})\n"
         . "  Pension   : {$pension}\n\n"
         . "ESTIMATION FINANCIÈRE\n"
         . "  Mode      : {$payment}\n"
         . "  TOTAL     : " . number_format($total, 0) . " DT\n\n"
         . "PROCHAINES ÉTAPES\n"
         . "  1. ✅ Demande reçue (étape actuelle)\n"
         . "  2. ⏳ Examen par notre équipe\n"
         . "  3. 📧 Email de confirmation définitive\n\n"
         . "Royal Mansour — Zone Touristique, Mahdia, Tunisie — +216 71 681 100";
}