<?php
/**
 * gestion_reservation.php — API REST Réservations
 * Méthodes : GET (liste + filtres), POST (créer), PUT (modifier), DELETE (supprimer)
 * Retour    : JSON uniquement
 *
 * ✉️  Envoi automatique d'un email de confirmation au client
 *     lorsque l'admin passe le statut à "Confirmée".
 */

// ── Headers ──────────────────────────────────────────────
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ── Connexion BDD ─────────────────────────────────────────
require_once 'db.php';

// ── Routeur ───────────────────────────────────────────────
$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {

    case 'GET':
        getReservations($pdo);
        break;

    case 'POST':
        $data = json_decode(file_get_contents('php://input'), true);
        createReservation($pdo, $data);
        break;

    case 'PUT':
        $data = json_decode(file_get_contents('php://input'), true);
        updateReservation($pdo, $data);
        break;

    case 'DELETE':
        $data = json_decode(file_get_contents('php://input'), true);
        deleteReservation($pdo, $data);
        break;

    default:
        http_response_code(405);
        echo json_encode(['success' => false, 'error' => 'Méthode non autorisée']);
        break;
}

// ─────────────────────────────────────────────────────────
//  GET — Liste des réservations avec filtres optionnels
// ─────────────────────────────────────────────────────────
function getReservations(PDO $pdo): void
{
    $conditions = [];
    $params     = [];

    if (!empty($_GET['search'])) {
        $s = '%' . trim($_GET['search']) . '%';
        $conditions[] = '(r.clientName LIKE :search OR r.email LIKE :search2)';
        $params[':search']  = $s;
        $params[':search2'] = $s;
    }

    if (!empty($_GET['status'])) {
        $conditions[]      = 'r.Status = :status';
        $params[':status'] = trim($_GET['status']);
    }

    if (!empty($_GET['roomType'])) {
        $conditions[]        = 'r.roomType = :roomType';
        $params[':roomType'] = trim($_GET['roomType']);
    }

    if (!empty($_GET['date_from'])) {
        $conditions[]         = 'r.checkInDate >= :date_from';
        $params[':date_from'] = $_GET['date_from'];
    }

    if (!empty($_GET['date_to'])) {
        $conditions[]       = 'r.checkInDate <= :date_to';
        $params[':date_to'] = $_GET['date_to'];
    }

    if (isset($_GET['price_min']) && $_GET['price_min'] !== '') {
        $conditions[]         = 'r.totalPrice >= :price_min';
        $params[':price_min'] = (float) $_GET['price_min'];
    }

    if (isset($_GET['price_max']) && $_GET['price_max'] !== '') {
        $conditions[]         = 'r.totalPrice <= :price_max';
        $params[':price_max'] = (float) $_GET['price_max'];
    }

    $where = count($conditions) ? 'WHERE ' . implode(' AND ', $conditions) : '';

    $sql = "
        SELECT
            r.id,
            r.clientName,
            r.email,
            r.phoneNumber,
            r.checkInDate,
            r.checkOutDate,
            r.roomType,
            r.roomNumber,
            r.numberOfAdults,
            r.numberOfChildren,
            r.paymentDetails,
            r.pension,
            r.totalPrice,
            r.Status
        FROM reservation r
        $where
        ORDER BY r.id DESC
    ";

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $reservations = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Enrichir avec le score client (historique)
        $stmtHist = $pdo->prepare("
            SELECT
                COUNT(CASE WHEN LOWER(COALESCE(Status,''))
                    IN ('checked_in','checked in','checked_out','checked out',
                        'complete','completé','completed',
                        'annule','annulee','annulé','cancelled','canceled')
                    THEN 1 END) AS total,
                SUM(CASE WHEN LOWER(COALESCE(Status,''))
                    IN ('checked_in','checked in','checked_out','checked out',
                        'complete','completé','completed')
                    THEN 1 ELSE 0 END) AS fiables,
                SUM(CASE WHEN LOWER(COALESCE(Status,''))
                    IN ('annule','annulee','annulé','cancelled','canceled')
                    THEN 1 ELSE 0 END) AS annulations
            FROM reservation
            WHERE email = :email
        ");

        foreach ($reservations as &$r) {
            $stmtHist->execute([':email' => $r['email']]);
            $hist = $stmtHist->fetch(PDO::FETCH_ASSOC);
            $r['_hist_total']       = (int) $hist['total'];
            $r['_hist_fiables']     = (int) $hist['fiables'];
            $r['_hist_annulations'] = (int) $hist['annulations'];
        }
        unset($r);

        $statusList  = $pdo->query("SELECT DISTINCT Status FROM reservation WHERE Status IS NOT NULL ORDER BY Status")->fetchAll(PDO::FETCH_COLUMN);
        $roomTypes   = $pdo->query("SELECT DISTINCT roomType FROM reservation WHERE roomType IS NOT NULL ORDER BY roomType")->fetchAll(PDO::FETCH_COLUMN);
        $roomNumbers = $pdo->query("SELECT DISTINCT roomNumber FROM reservation WHERE roomNumber IS NOT NULL ORDER BY roomNumber")->fetchAll(PDO::FETCH_COLUMN);

        echo json_encode([
            'success'      => true,
            'count'        => count($reservations),
            'data'         => $reservations,
            'status_list'  => $statusList,
            'room_types'   => $roomTypes,
            'room_numbers' => $roomNumbers,
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

// ─────────────────────────────────────────────────────────
//  POST — Créer une réservation
// ─────────────────────────────────────────────────────────
function createReservation(PDO $pdo, ?array $data): void
{
    $required = ['clientName', 'email', 'checkInDate', 'checkOutDate', 'roomType', 'totalPrice'];
    foreach ($required as $field) {
        if (empty($data[$field])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => "Champ requis manquant : $field"]);
            return;
        }
    }

    $sql = "
        INSERT INTO reservation
            (clientName, email, phoneNumber, checkInDate, checkOutDate,
             roomType, roomNumber, numberOfAdults, numberOfChildren,
             paymentDetails, pension, totalPrice, Status)
        VALUES
            (:clientName, :email, :phoneNumber, :checkInDate, :checkOutDate,
             :roomType, :roomNumber, :numberOfAdults, :numberOfChildren,
             :paymentDetails, :pension, :totalPrice, :status)
    ";

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':clientName'       => trim($data['clientName']),
            ':email'            => trim($data['email']),
            ':phoneNumber'      => trim($data['phoneNumber']      ?? ''),
            ':checkInDate'      => $data['checkInDate'],
            ':checkOutDate'     => $data['checkOutDate'],
            ':roomType'         => trim($data['roomType']),
            ':roomNumber'       => trim($data['roomNumber']       ?? ''),
            ':numberOfAdults'   => (int) ($data['numberOfAdults']   ?? 1),
            ':numberOfChildren' => (int) ($data['numberOfChildren']  ?? 0),
            ':paymentDetails'   => trim($data['paymentDetails']   ?? ''),
            ':pension'          => trim($data['pension']          ?? ''),
            ':totalPrice'       => (float) $data['totalPrice'],
            ':status'           => trim($data['status']           ?? 'En attente'),
        ]);

        echo json_encode([
            'success' => true,
            'id'      => (int) $pdo->lastInsertId(),
            'message' => 'Réservation créée avec succès',
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

// ─────────────────────────────────────────────────────────
//  PUT — Modifier une réservation
//  ✉️  Si le statut passe à "Confirmée" → email au client
// ─────────────────────────────────────────────────────────
function updateReservation(PDO $pdo, ?array $data): void
{
    if (empty($data['id'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'ID réservation manquant']);
        return;
    }

    // ── Récupérer le statut AVANT la mise à jour ──────────
    $stmtBefore = $pdo->prepare('SELECT Status FROM reservation WHERE id = :id');
    $stmtBefore->execute([':id' => (int) $data['id']]);
    $before = $stmtBefore->fetch(PDO::FETCH_ASSOC);
    $statusBefore = $before['Status'] ?? '';

    $allowed = [
        'clientName', 'email', 'phoneNumber', 'checkInDate', 'checkOutDate',
        'roomType', 'roomNumber', 'numberOfAdults', 'numberOfChildren',
        'paymentDetails', 'pension', 'totalPrice', 'Status',
    ];

    $sets   = [];
    $params = [':id' => (int) $data['id']];

    foreach ($allowed as $field) {
        if (array_key_exists($field, $data)) {
            $sets[]            = "$field = :$field";
            $params[":$field"] = $data[$field];
        }
    }

    if (empty($sets)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Aucun champ à modifier']);
        return;
    }

    try {
        $stmt = $pdo->prepare('UPDATE reservation SET ' . implode(', ', $sets) . ' WHERE id = :id');
        $stmt->execute($params);

        // ── Récupérer le statut APRÈS la mise à jour ──────
        $newStatus = $data['Status'] ?? $statusBefore;

        // ── Déclencher l'email si : AVANT ≠ "Confirmée" ET APRÈS = "Confirmée" ──
        $emailResult = ['sent' => false, 'error' => null];

        if ($statusBefore !== 'Confirmée' && $newStatus === 'Confirmée') {
            // Recharger la réservation complète depuis la BDD
            $stmtRes = $pdo->prepare('SELECT * FROM reservation WHERE id = :id');
            $stmtRes->execute([':id' => (int) $data['id']]);
            $res = $stmtRes->fetch(PDO::FETCH_ASSOC);

            if ($res) {
                $emailResult = _sendConfirmationEmail($res);
            }
        }

        echo json_encode([
            'success'      => true,
            'message'      => 'Réservation modifiée avec succès',
            'email_sent'   => $emailResult['sent'],
            'email_error'  => $emailResult['error'],
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

// ─────────────────────────────────────────────────────────
//  DELETE — Supprimer une réservation
// ─────────────────────────────────────────────────────────
function deleteReservation(PDO $pdo, ?array $data): void
{
    if (empty($data['id'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'ID réservation manquant']);
        return;
    }

    $id = (int) $data['id'];
    try {
        // Au lieu de supprimer, on passe le statut à "Supprimé"
        $stmt = $pdo->prepare("UPDATE reservation SET Status = 'Supprimé' WHERE id = :id");
        $stmt->execute([':id' => $id]);

        if ($stmt->rowCount() === 0) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Réservation introuvable']);
            return;
        }
        echo json_encode(['success' => true, 'message' => "Réservation #$id archivée"]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

// ═══════════════════════════════════════════════════════════
//  ✉️  ENVOI EMAIL DE CONFIRMATION — appelé par updateReservation
// ═══════════════════════════════════════════════════════════

/**
 * Envoie un email de confirmation de réservation au client.
 *
 * @param  array $r  Ligne complète de la table reservation
 * @return array     ['sent' => bool, 'error' => string|null]
 */
function _sendConfirmationEmail(array $r): array
{
    try {
        // ── Charger PHPMailer ──────────────────────────────
        if (file_exists(__DIR__ . '/vendor/autoload.php')) {
            require_once __DIR__ . '/vendor/autoload.php';
        } elseif (file_exists(__DIR__ . '/PHPMailer/PHPMailer.php')) {
            require_once __DIR__ . '/PHPMailer/PHPMailer.php';
            require_once __DIR__ . '/PHPMailer/SMTP.php';
            require_once __DIR__ . '/PHPMailer/Exception.php';
        } else {
            throw new Exception('PHPMailer introuvable');
        }

        $mail = new PHPMailer\PHPMailer\PHPMailer(true);

        // ── Config SMTP (identique à reserver.php) ─────────
        $mail->isSMTP();
        $mail->Host       = 'smtp.gmail.com';
        $mail->SMTPAuth   = true;
        $mail->Username   = 'wael.fraj.2023@ihec.ucar.tn';
        $mail->Password   = 'jlgb acby oaax llly';
        $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = 587;
        $mail->CharSet    = 'UTF-8';

        // ── Expéditeur / Destinataire ──────────────────────
        $mail->setFrom('royal.mansour@iberostar.tn', 'Royal Mansour');
        $mail->addAddress(trim($r['email']), trim($r['clientName']));

        // ── Sujet ──────────────────────────────────────────
        $mail->Subject = "✅ Réservation #{$r['id']} confirmée — Royal Mansour";

        // ── Corps HTML & texte ─────────────────────────────
        $mail->isHTML(true);
        $mail->Body    = _buildConfirmHtml($r);
        $mail->AltBody = _buildConfirmText($r);

        $mail->send();
        return ['sent' => true, 'error' => null];

    } catch (Exception $e) {
        error_log("[EMAIL CONFIRM] Réservation #{$r['id']} : " . $e->getMessage());
        return ['sent' => false, 'error' => $e->getMessage()];
    }
}

// ─────────────────────────────────────────────────────────
//  Corps HTML — Email de confirmation (design Royal Mansour)
// ─────────────────────────────────────────────────────────
function _buildConfirmHtml(array $r): string
{
    $roomLabels    = ['Simple' => 'Chambre Simple 🛏', 'Double' => 'Chambre Double 🛏🛏', 'Triple' => 'Chambre Triple 🛏🛏🛏', 'Suite' => 'Suite ✨'];
    $pensionLabels = [
        'sans_pension'     => 'Sans pension',
        'petit_dejeuner'   => 'Petit-déjeuner ☕',
        'Petit-déjeuner'   => 'Petit-déjeuner ☕',
        'demi_pension'     => 'Demi-pension 🥗',
        'Demi-pension'     => 'Demi-pension 🥗',
        'pension_complete' => 'Pension complète 🍽',
        'Pension complète' => 'Pension complète 🍽',
        'tout_inclus'      => 'All inclusive 🌟',
        'All inclusive'    => 'All inclusive 🌟',
    ];
    $paymentLabels = [
        'Carte bancaire' => 'Carte bancaire 💳',
        'Espèces'        => 'Espèces 💵 (à l\'hôtel)',
        'Virement'       => 'Virement bancaire 🏦',
        'PayPal'         => 'PayPal 🅿',
        'espece'         => 'Espèces 💵 (à l\'hôtel)',
        'carte'          => 'Carte bancaire 💳',
        'paypal'         => 'PayPal 🅿',
    ];

    $roomLabel    = $roomLabels[$r['roomType']]           ?? ucfirst($r['roomType']        ?? '');
    $pensionLabel = $pensionLabels[$r['pension'] ?? '']   ?? ($r['pension']                ?? '—');
    $paymentLabel = $paymentLabels[$r['paymentDetails'] ?? ''] ?? ($r['paymentDetails']    ?? '—');

    $adults   = (int) ($r['numberOfAdults']   ?? 1);
    $children = (int) ($r['numberOfChildren'] ?? 0);
    $nights   = 0;
    if (!empty($r['checkInDate']) && !empty($r['checkOutDate'])) {
        $nights = (int) round((strtotime($r['checkOutDate']) - strtotime($r['checkInDate'])) / 86400);
    }
    $occupants = $adults . ' adulte' . ($adults > 1 ? 's' : '') .
                 ($children > 0 ? ' + ' . $children . ' enfant' . ($children > 1 ? 's' : '') : '');

    // ── Formatage des dates ────────────────────────────────
    $checkInFmt  = !empty($r['checkInDate'])  ? date('d/m/Y', strtotime($r['checkInDate']))  : '—';
    $checkOutFmt = !empty($r['checkOutDate']) ? date('d/m/Y', strtotime($r['checkOutDate'])) : '—';

    $year          = date('Y');
    $from          = 'wael.fraj.2023@ihec.ucar.tn';
    $clientName    = htmlspecialchars($r['clientName'] ?? '');
    $reservationId = $r['id'];
    $roomNumber    = htmlspecialchars($r['roomNumber'] ?? '—');
    $totalPrice    = number_format((float)($r['totalPrice'] ?? 0), 0, ',', ' ');

    $moisFr       = ['','janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    $emissionDate = date('d') . ' ' . $moisFr[(int)date('m')] . ' ' . date('Y');

    // ── Générateur de ligne de tableau (closure interne) ──
    $row = function(string $label, string $value, bool $shaded = false): string {
        $bg = $shaded ? 'background:#faf8f4;' : 'background:#fff;';
        return '<tr style="' . $bg . '">'
            . '<td style="padding:10px 20px;color:#888;font-size:13px;width:42%;border-top:1px solid #f0ebe0;">' . htmlspecialchars($label) . '</td>'
            . '<td style="padding:10px 20px;color:#1a1a2e;font-size:13px;font-weight:600;border-top:1px solid #f0ebe0;text-align:right;">' . $value . '</td>'
            . '</tr>';
    };

    // ── Construction du HTML par concaténation ─────────────
    $html  = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>';
    $html .= '<body style="margin:0;padding:0;background:#f0f2f5;font-family:\'Segoe UI\',Arial,sans-serif;">';
    $html .= '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:40px 0;">';
    $html .= '<tr><td align="center">';
    $html .= '<table width="620" cellpadding="0" cellspacing="0"';
    $html .= ' style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.12);max-width:620px;">';

    // HEADER
    $html .= '<tr>';
    $html .= '<td style="background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);padding:44px 40px 36px;text-align:center;">';
    $html .= '<div style="font-size:32px;margin-bottom:10px;">✦</div>';
    $html .= '<h1 style="color:#c9a55a;margin:0 0 4px;font-size:24px;font-weight:700;letter-spacing:2px;">Royal Mansour</h1>';
    $html .= '<p style="color:rgba(255,255,255,.5);margin:0 0 20px;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Luxe · Confort · Excellence</p>';
    $html .= '<div style="display:inline-block;background:rgba(201,165,90,.15);border:1px solid rgba(201,165,90,.4);border-radius:30px;padding:8px 24px;">';
    $html .= '<span style="color:#c9a55a;font-size:13px;font-weight:600;letter-spacing:1px;">✅ RÉSERVATION CONFIRMÉE</span>';
    $html .= '</div></td></tr>';

    // INTRO
    $html .= '<tr><td style="padding:32px 40px 0;">';
    $html .= '<h2 style="margin:0 0 8px;color:#1a1a2e;font-size:17px;">Bonjour ' . $clientName . ',</h2>';
    $html .= '<p style="margin:0;color:#555;font-size:14px;line-height:1.7;">';
    $html .= 'Excellente nouvelle ! Votre réservation <strong style="color:#1a1a2e;">#' . $reservationId . '</strong>';
    $html .= ' a été <strong style="color:#2e7d52;">officiellement confirmée</strong> par notre équipe.<br><br>';
    $html .= 'Nous avons hâte de vous accueillir au <strong>Royal Mansour</strong> et de vous offrir une expérience inoubliable.';
    $html .= '</p></td></tr>';

    // ALERTE VERTE DE CONFIRMATION
    $nightsLabel = $nights . ' nuit' . ($nights > 1 ? 's' : '');
    $html .= '<tr><td style="padding:20px 40px 0;">';
    $html .= '<div style="background:linear-gradient(135deg,#1e5c3a,#2e7d52);border-radius:10px;padding:16px 20px;text-align:center;">';
    $html .= '<p style="margin:0;color:#fff;font-size:14px;font-weight:600;">';
    $html .= '🎉 Votre séjour est confirmé du <strong>' . $checkInFmt . '</strong> au <strong>' . $checkOutFmt . '</strong>';
    $html .= '</p>';
    $html .= '<p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:12px;">';
    $html .= 'Chambre ' . $roomNumber . ' · ' . $nightsLabel . ' · ' . htmlspecialchars($occupants);
    $html .= '</p></div></td></tr>';

    // DÉTAILS DU SÉJOUR
    $html .= '<tr><td style="padding:20px 40px 0;">';
    $html .= '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid #e8e0d0;">';
    $html .= '<tr><td colspan="2" style="background:linear-gradient(90deg,#1a1a2e,#16213e);padding:11px 20px;">';
    $html .= '<span style="color:#c9a55a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">📅 Détails de votre séjour</span>';
    $html .= '</td></tr>';
    $html .= $row('Référence', '#' . $reservationId, true);
    $html .= $row('Arrivée',   $checkInFmt, false);
    $html .= $row('Départ',    $checkOutFmt, true);
    $html .= $row('Durée',     $nightsLabel, false);
    $html .= $row('Chambre',   'N° ' . $roomNumber . ' — ' . $roomLabel, true);
    $html .= $row('Occupants', htmlspecialchars($occupants), false);
    $html .= $row('Pension',   htmlspecialchars($pensionLabel), true);
    $html .= '</table></td></tr>';

    // PAIEMENT
    $html .= '<tr><td style="padding:14px 40px 0;">';
    $html .= '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid #e8e0d0;">';
    $html .= '<tr><td colspan="2" style="background:linear-gradient(90deg,#0f3460,#1a1a2e);padding:11px 20px;">';
    $html .= '<span style="color:#c9a55a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">💳 Récapitulatif de paiement</span>';
    $html .= '</td></tr>';
    $html .= $row('Mode de paiement', htmlspecialchars($paymentLabel), true);
    $html .= $row('Statut paiement', '<span style="color:#2e7d52;font-weight:700;">À régler à l\'arrivée</span>', false);
    $html .= '<tr style="background:linear-gradient(90deg,#c9a55a,#e8c97a);">';
    $html .= '<td style="padding:15px 20px;color:#1a1a2e;font-size:14px;font-weight:700;">Montant total</td>';
    $html .= '<td style="padding:15px 20px;color:#1a1a2e;font-size:19px;font-weight:800;text-align:right;">' . $totalPrice . ' TND</td>';
    $html .= '</tr></table></td></tr>';

    // INFORMATIONS PRATIQUES
    $html .= '<tr><td style="padding:18px 40px 0;">';
    $html .= '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid #e8e0d0;">';
    $html .= '<tr><td colspan="2" style="background:linear-gradient(90deg,#1a1a2e,#16213e);padding:11px 20px;">';
    $html .= '<span style="color:#c9a55a;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">ℹ️ Informations pratiques</span>';
    $html .= '</td></tr>';

    $html .= '<tr style="background:#faf8f4;">';
    $html .= '<td style="padding:12px 20px;border-top:1px solid #f0ebe0;width:36px;vertical-align:top;font-size:18px;">🔑</td>';
    $html .= '<td style="padding:12px 20px;border-top:1px solid #f0ebe0;color:#444;font-size:13px;">';
    $html .= '<strong style="color:#1a1a2e;">Check-in</strong><br>';
    $html .= '<span style="color:#888;">À partir de <strong>14h00</strong>. Présentez une pièce d\'identité valide à la réception.</span>';
    $html .= '</td></tr>';

    $html .= '<tr style="background:#fff;">';
    $html .= '<td style="padding:12px 20px;border-top:1px solid #f0ebe0;vertical-align:top;font-size:18px;">🚪</td>';
    $html .= '<td style="padding:12px 20px;border-top:1px solid #f0ebe0;color:#444;font-size:13px;">';
    $html .= '<strong style="color:#1a1a2e;">Check-out</strong><br>';
    $html .= '<span style="color:#888;">Avant <strong>12h00</strong>. Un départ tardif peut être arrangé selon disponibilité.</span>';
    $html .= '</td></tr>';

    $html .= '<tr style="background:#faf8f4;">';
    $html .= '<td style="padding:12px 20px;border-top:1px solid #f0ebe0;vertical-align:top;font-size:18px;">📍</td>';
    $html .= '<td style="padding:12px 20px;border-top:1px solid #f0ebe0;color:#444;font-size:13px;">';
    $html .= '<strong style="color:#1a1a2e;">Adresse</strong><br>';
    $html .= '<span style="color:#888;">Zone Touristique, Mahdia, Tunisie — <strong>+216 71 681 100</strong></span>';
    $html .= '</td></tr>';
    $html .= '</table></td></tr>';

    // NOTE IMPORTANTE
    $html .= '<tr><td style="padding:18px 40px 0;">';
    $html .= '<div style="background:#fffbf0;border-left:4px solid #c9a55a;padding:13px 16px;border-radius:0 8px 8px 0;">';
    $html .= '<p style="margin:0;font-size:13px;color:#7a6000;line-height:1.6;">';
    $html .= '<strong>📌 Rappel :</strong> Conservez cet email comme justificatif de réservation (Réf. #' . $reservationId . '). ';
    $html .= 'En cas de modification ou d\'annulation, contactez-nous au moins <strong>48h à l\'avance</strong>.';
    $html .= '</p></div></td></tr>';

    // CONTACT
    $html .= '<tr><td style="padding:22px 40px;text-align:center;">';
    $html .= '<p style="margin:0 0 4px;font-size:13px;color:#888;">Une question ? Notre équipe est à votre disposition</p>';
    $html .= '<a href="mailto:' . $from . '" style="color:#c9a55a;font-size:13px;font-weight:600;text-decoration:none;">' . $from . '</a>';
    $html .= '<span style="color:#ccc;margin:0 8px;">|</span>';
    $html .= '<span style="color:#555;font-size:13px;">📞 +216 71 681 100</span>';
    $html .= '</td></tr>';

    // FOOTER
    $html .= '<tr><td style="background:#1a1a2e;padding:18px 40px;text-align:center;">';
    $html .= '<p style="margin:0;font-size:11px;color:rgba(255,255,255,.35);">';
    $html .= '© ' . $year . ' Royal Mansour — Zone Touristique, Mahdia, Tunisie<br>';
    $html .= 'Cet email a été envoyé automatiquement suite à la confirmation de votre réservation.';
    $html .= '</p></td></tr>';

    $html .= '</table></td></tr></table></body></html>';

    return $html;
}

// ─────────────────────────────────────────────────────────
//  Corps TEXTE — fallback clients mail basiques
// ─────────────────────────────────────────────────────────
function _buildConfirmText(array $r): string
{
    $checkInFmt  = !empty($r['checkInDate'])  ? date('d/m/Y', strtotime($r['checkInDate']))  : '—';
    $checkOutFmt = !empty($r['checkOutDate']) ? date('d/m/Y', strtotime($r['checkOutDate'])) : '—';

    $nights = 0;
    if (!empty($r['checkInDate']) && !empty($r['checkOutDate'])) {
        $nights = (int) round((strtotime($r['checkOutDate']) - strtotime($r['checkInDate'])) / 86400);
    }

    $adults   = (int) ($r['numberOfAdults']   ?? 1);
    $children = (int) ($r['numberOfChildren'] ?? 0);

    return "✅ Réservation #{$r['id']} CONFIRMÉE — Royal Mansour\n\n"
         . "Bonjour {$r['clientName']},\n\n"
         . "Excellente nouvelle ! Votre réservation a été officiellement confirmée par notre équipe.\n\n"
         . "═══════════════════════════════════\n"
         . " DÉTAILS DE VOTRE SÉJOUR\n"
         . "═══════════════════════════════════\n"
         . "  Référence   : #{$r['id']}\n"
         . "  Arrivée     : " . $checkInFmt  . "\n"
         . "  Départ      : " . $checkOutFmt . " ({$nights} nuit" . ($nights > 1 ? 's' : '') . ")\n"
         . "  Chambre     : " . ($r['roomNumber'] ?? '—') . " (" . ($r['roomType'] ?? '—') . ")\n"
         . "  Pension     : " . ($r['pension'] ?? '—') . "\n"
         . "  Occupants   : " . $adults . " adulte(s)"
           . ($children > 0 ? " + " . $children . " enfant(s)" : "") . "\n\n"
         . "═══════════════════════════════════\n"
         . " PAIEMENT\n"
         . "═══════════════════════════════════\n"
         . "  Mode        : " . ($r['paymentDetails'] ?? '—') . "\n"
         . "  TOTAL       : " . number_format((float)($r['totalPrice'] ?? 0), 0) . " TND\n"
         . "  → À régler à l'arrivée\n\n"
         . "═══════════════════════════════════\n"
         . " INFORMATIONS PRATIQUES\n"
         . "═══════════════════════════════════\n"
         . "  Check-in    : à partir de 14h00\n"
         . "  Check-out   : avant 12h00\n"
         . "  Adresse     : Zone Touristique, Mahdia, Tunisie\n"
         . "  Téléphone   : +216 71 681 100\n\n"
         . "Présentez une pièce d'identité valide à la réception.\n"
         . "Conservez cet email comme justificatif (Réf. #{$r['id']}).\n\n"
         . "À très bientôt au Royal Mansour !\n"
         . "L'équipe Royal Mansour";
}