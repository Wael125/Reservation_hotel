<?php
session_start();
require "db.php";

if ($_SERVER["REQUEST_METHOD"] === "POST") {

    // ================= DATA =================
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

    $today = date("Y-m-d");

    // ================= VALIDATIONS =================
    if (!preg_match("/^[A-Za-zÀ-ÿ\s]+$/", $nom))        die("Nom invalide");
    if (!filter_var($email, FILTER_VALIDATE_EMAIL))       die("Email invalide");
    if (!preg_match("/^[0-9]{8}$/", $tel))                die("Téléphone invalide");
    if ($date_arrivee < $today)                           die("Date arrivée invalide");
    if ($date_depart <= $date_arrivee)                    die("Date départ invalide");
    if ($adultes < 1)                                     die("Au moins 1 adulte");
    if (($adultes + $enfants) > 4)                        die("Max 4 personnes");

    // ================= CUSTOMER ID =================
    $login_id = $_SESSION["login_id"];

    $stmt = $pdo->prepare("SELECT id FROM customer WHERE login_id = ?");
    $stmt->execute([$login_id]);
    $customer = $stmt->fetch();

    if (!$customer) {
        die("❌ Client introuvable (vérifie relation login/customer)");
    }
    $customer_id = $customer["id"];

    // ================= DAYS =================
    $start = new DateTime($date_arrivee);
    $end   = new DateTime($date_depart);
    $days  = $start->diff($end)->days;

    // ================= PRICE CALCULATION =================
    $pricePerAdult = 0;
    $pricePerChild = 0;

    if ($roomType === "simple") {
        $pricePerAdult = 100; $pricePerChild = 50;
    } elseif ($roomType === "double") {
        $pricePerAdult = 120; $pricePerChild = 60;
    } elseif ($roomType === "suite") {
        $pricePerAdult = 150; $pricePerChild = 75;
    }

    $pensionPricePerDay = 0;
    if ($pension === "demi_pension")    $pensionPricePerDay = 30;
    elseif ($pension === "complete")    $pensionPricePerDay = 40;
    elseif ($pension === "petit_dejeuner") $pensionPricePerDay = 15;

    $totalRoomPrice    = $days * (($adultes * $pricePerAdult) + ($enfants * $pricePerChild));
    $totalPensionPrice = $days * $pensionPricePerDay * ($adultes + $enfants);
    $totalPrice        = $totalRoomPrice + $totalPensionPrice;

    // ================= ROOM SELECTION =================
    $roomStmt = $pdo->prepare("
        SELECT r.roomNumber
        FROM room r
        WHERE r.roomType = ?
        AND r.roomNumber NOT IN (
            SELECT roomNumber FROM reservation
            WHERE NOT (checkOutDate <= ? OR checkInDate >= ?)
        )
        LIMIT 1
    ");
    $roomStmt->execute([$roomType, $date_arrivee, $date_depart]);
    $room = $roomStmt->fetch();

    if (!$room) {
        die("❌ Aucune chambre disponible pour ces dates");
    }
    $roomNumber = $room["roomNumber"];

    // ================= INVOICE NUMBER =================
    // Générer un numéro de facture unique côté serveur
    $invoiceNumber = "GH-" . date("Y") . "-" . strtoupper(substr(uniqid(), -5));

    // ================= INSERT RESERVATION =================
    $insert = $pdo->prepare("
        INSERT INTO reservation (
            clientName, customer_id, email, phoneNumber,
            checkInDate, checkOutDate,
            roomType, roomNumber,
            numberOfAdults, numberOfChildren, totalNumberOfPeople,
            paymentDetails, pension, totalPrice, Status
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ");

    $insert->execute([
        $nom,
        $customer_id,
        $email,
        $tel,
        $date_arrivee,
        $date_depart,
        $roomType,
        $roomNumber,
        $adultes,
        $enfants,
        $adultes + $enfants,
        $paiement,
        $pension,
        $totalPrice,
        "En attente"
    ]);

    $reservationId = $pdo->lastInsertId();

    // ================= LABELS =================
    $roomLabels = [
        "simple" => "Chambre Simple",
        "double" => "Chambre Double",
        "suite"  => "Suite"
    ];
    $pensionLabels = [
        "petit_dejeuner" => "Petit déjeuner",
        "demi_pension"   => "Demi-pension",
        "complete"       => "Pension complète"
    ];
    $paiementLabels = [
        "espece" => "Espèces (à l'hôtel)",
        "carte"  => "Carte bancaire",
        "paypal" => "PayPal"
    ];

    $formatDate = fn($d) => date("d/m/Y", strtotime($d));
    $occupants  = $adultes . " adulte" . ($adultes > 1 ? "s" : "") .
                  ($enfants > 0 ? " + " . $enfants . " enfant" . ($enfants > 1 ? "s" : "") : "");

    // Calcul des lignes de facture
    $priceAdultLine  = $days * $adultes * $pricePerAdult;
    $priceChildLine  = $days * $enfants * $pricePerChild;
    $pensionLine     = $totalPensionPrice;

    $emissionDate = date("d") . " " . strftime("%B %Y"); // ex: 29 avril 2026
    // Pour compatibilité (strftime déprécié PHP 8.1+), alternative :
    $mois = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
    $emissionDate = date("d") . " " . $mois[(int)date("m")-1] . " " . date("Y");

    // ================= SUCCESS PAGE =================
    ?>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Facture — Grand Hôtel</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,400&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="reserver.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  <style>
    .success-banner {
      background: linear-gradient(135deg, #2e7d52 0%, #1e5c3a 100%);
      color: #fff;
      padding: 14px 24px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 28px;
      font-size: .9rem;
      font-weight: 500;
    }
    .success-banner svg { flex-shrink: 0; }
    .success-banner strong { font-size: 1rem; }
    .conf-actions {
      display: flex; gap: 12px; justify-content: flex-end;
      margin-top: 24px; flex-wrap: wrap;
    }
    @media (max-width: 640px) {
      .conf-actions { flex-direction: column; }
      .conf-actions a, .conf-actions button { justify-content: center; }
    }
  </style>
</head>
<body>
  <div class="bg-overlay"></div>
  <div class="page-wrap">

    <header class="site-header">
      <div class="logo">
        <span class="logo-star">✦</span>
        <span class="logo-text">Grand Hôtel</span>
      </div>
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
          <strong>Réservation confirmée !</strong><br>
          Chambre <b><?= htmlspecialchars($roomNumber) ?></b> réservée pour <?= htmlspecialchars($occupants) ?>.
        </div>
      </div>

      <!-- ══ FACTURE ══ -->
      <div class="invoice-wrapper">
        <div class="invoice" id="invoicePrint">

          <!-- En-tête -->
          <div class="invoice-header">
            <div class="invoice-brand">
              <div class="invoice-logo">
                <span class="inv-logo-star">✦</span>
                <span class="inv-logo-text">Grand Hôtel</span>
              </div>
              <p class="invoice-tagline">Luxe · Confort · Excellence</p>
              <p class="invoice-address">Avenue de la République, Tunis 1000<br>Tél : +216 71 000 000 · contact@grandhotel.tn</p>
            </div>
            <div class="invoice-meta">
              <div class="invoice-badge">FACTURE</div>
              <p class="invoice-num">N° <?= htmlspecialchars($invoiceNumber) ?></p>
              <p class="invoice-date">Émise le <?= $emissionDate ?></p>
              <div class="invoice-status-badge">
                <span class="status-dot"></span>
                En attente de paiement
              </div>
            </div>
          </div>

          <div class="invoice-divider"></div>

          <!-- Client / Séjour / Paiement -->
          <div class="invoice-info-row">
            <div class="invoice-info-block">
              <p class="inv-block-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                Client
              </p>
              <p class="inv-name"><?= htmlspecialchars($nom) ?></p>
              <p class="inv-detail"><?= htmlspecialchars($email) ?></p>
              <p class="inv-detail"><?= htmlspecialchars($tel) ?></p>
            </div>
            <div class="invoice-info-block">
              <p class="inv-block-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                Séjour
              </p>
              <p class="inv-detail"><span class="inv-label">Arrivée :</span> <?= $formatDate($date_arrivee) ?></p>
              <p class="inv-detail"><span class="inv-label">Départ :</span> <?= $formatDate($date_depart) ?></p>
              <p class="inv-detail"><span class="inv-label">Durée :</span> <?= $days ?> nuit<?= $days > 1 ? "s" : "" ?></p>
              <p class="inv-detail"><span class="inv-label">Chambre :</span> <?= htmlspecialchars($roomNumber) ?> (<?= htmlspecialchars($roomLabels[$roomType] ?? $roomType) ?>)</p>
              <p class="inv-detail"><span class="inv-label">Occupants :</span> <?= htmlspecialchars($occupants) ?></p>
            </div>
            <div class="invoice-info-block">
              <p class="inv-block-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                Paiement
              </p>
              <p class="inv-detail"><span class="inv-label">Mode :</span> <?= htmlspecialchars($paiementLabels[$paiement] ?? $paiement) ?></p>
              <p class="inv-detail"><span class="inv-label">Statut :</span> <span class="inv-status">En attente</span></p>
            </div>
          </div>

          <div class="invoice-divider"></div>

          <!-- Tableau des lignes -->
          <table class="invoice-table">
            <thead>
              <tr>
                <th>Désignation</th>
                <th>Unité</th>
                <th>Quantité</th>
                <th>Prix unitaire</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <?php if ($adultes > 0): ?>
              <tr>
                <td><?= htmlspecialchars($roomLabels[$roomType] ?? $roomType) ?> — Adultes</td>
                <td>nuit</td>
                <td><?= $days ?> × <?= $adultes ?> pers.</td>
                <td><?= $pricePerAdult ?> DT</td>
                <td><?= $priceAdultLine ?> DT</td>
              </tr>
              <?php endif; ?>
              <?php if ($enfants > 0): ?>
              <tr>
                <td><?= htmlspecialchars($roomLabels[$roomType] ?? $roomType) ?> — Enfants</td>
                <td>nuit</td>
                <td><?= $days ?> × <?= $enfants ?> pers.</td>
                <td><?= $pricePerChild ?> DT</td>
                <td><?= $priceChildLine ?> DT</td>
              </tr>
              <?php endif; ?>
              <?php if ($pensionPricePerDay > 0): ?>
              <tr>
                <td><?= htmlspecialchars($pensionLabels[$pension] ?? $pension) ?></td>
                <td>nuit</td>
                <td><?= $days ?> × <?= ($adultes + $enfants) ?> pers.</td>
                <td><?= $pensionPricePerDay ?> DT</td>
                <td><?= $pensionLine ?> DT</td>
              </tr>
              <?php endif; ?>
            </tbody>
          </table>

          <div class="invoice-divider"></div>

          <!-- Totaux -->
          <div class="invoice-totals">
            <div class="inv-total-row">
              <span>Sous-total hébergement</span>
              <span><?= $totalRoomPrice ?> DT</span>
            </div>
            <?php if ($totalPensionPrice > 0): ?>
            <div class="inv-total-row">
              <span>Pension</span>
              <span><?= $totalPensionPrice ?> DT</span>
            </div>
            <?php endif; ?>
            <div class="inv-total-row inv-tva-row">
              <span>TVA (0%)</span>
              <span>0 DT</span>
            </div>
            <div class="inv-grand-total">
              <span>Montant total</span>
              <strong><?= $totalPrice ?> DT</strong>
            </div>
          </div>

          <!-- Note de bas de page -->
          <div class="invoice-footer-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Cette facture est générée automatiquement et constitue un justificatif de votre réservation (N° <?= $reservationId ?>). Le paiement sera encaissé à l'arrivée sauf indication contraire.
          </div>

        </div><!-- /invoicePrint -->
      </div><!-- /invoice-wrapper -->

      <!-- Actions -->
      <div class="conf-actions">
        <button type="button" class="btn-export btn-print" onclick="window.print()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Imprimer
        </button>
        <button type="button" class="btn-export btn-pdf" onclick="exportPDF()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Exporter PDF
        </button>
        <a href="dashboard.php" class="btn-export" style="text-decoration:none;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Tableau de bord
        </a>
      </div>

    </main>

    <footer class="site-footer">
      <p>© 2025 Grand Hôtel &nbsp;·&nbsp; Tous droits réservés</p>
    </footer>
  </div>

  <script>
  function exportPDF() {
    const element = document.getElementById("invoicePrint");
    const options = {
      margin:      [10, 10, 10, 10],
      filename:    "<?= addslashes($invoiceNumber) ?>.pdf",
      image:       { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" }
    };
    html2pdf().set(options).from(element).save();
  }
  </script>

  <style>
  @media print {
    .bg-overlay, .site-header, .conf-actions, .site-footer { display: none !important; }
    .page-wrap { padding: 0; }
    .reservation-card { box-shadow: none; border-radius: 0; padding: 0 !important; }
    .success-banner { display: none !important; }
    .invoice { padding: 20px 28px; }
    .status-dot { animation: none; }
  }
  </style>

</body>
</html>
<?php
} // end if POST
?>