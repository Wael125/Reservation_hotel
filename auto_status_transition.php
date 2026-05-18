<?php
/**
 * auto_status_transition.php
 * ──────────────────────────────────────────────────────────────────
 * Détecte les réservations dont le statut doit changer selon les dates
 * et crée des "demandes de confirmation" pour l'admin.
 *
 * LOGIQUE :
 *   • Confirmée  + checkInDate  ≤ aujourd'hui          → propose Checked_in
 *   • Checked_in + checkOutDate < aujourd'hui           → propose Completé
 *     (le checkout physique se fait J+1 à 12h00)
 *     donc condition : (checkOutDate + 1 jour) ≤ aujourd'hui ET heure ≥ 12:00
 *
 * TABLE REQUISE : reservation_transitions
 *   id            INT AUTO_INCREMENT PRIMARY KEY
 *   reservation_id INT NOT NULL
 *   from_status   VARCHAR(32)
 *   to_status     VARCHAR(32)
 *   triggered_at  DATETIME DEFAULT NOW()
 *   admin_decision ENUM('pending','accepted','rejected') DEFAULT 'pending'
 *   decided_at    DATETIME NULL
 *   admin_note    TEXT NULL
 *
 * APPEL :
 *   • Via cron : php auto_status_transition.php
 *   • Via HTTP (protégé par token) : ?token=VOTRE_TOKEN_SECRET
 * ──────────────────────────────────────────────────────────────────
 */

header('Content-Type: application/json; charset=utf-8');

// ── Sécurité HTTP ─────────────────────────────────────────
if (PHP_SAPI !== 'cli') {
    $token = $_GET['token'] ?? '';
$validToken = 'a3f8b2c19d4e7f1a2b3c4d5e6f7a8b9c';
    if (!hash_equals($validToken, $token)) {
        http_response_code(403);
        echo json_encode(['error' => 'Accès refusé']);
        exit;
    }
}

require_once 'db.php';

// ── Créer la table si elle n'existe pas ───────────────────
$pdo->exec("
    CREATE TABLE IF NOT EXISTS reservation_transitions (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        reservation_id  INT NOT NULL,
        from_status     VARCHAR(32) NOT NULL,
        to_status       VARCHAR(32) NOT NULL,
        triggered_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        admin_decision  ENUM('pending','accepted','rejected') DEFAULT 'pending',
        decided_at      DATETIME NULL,
        admin_note      TEXT NULL,
        INDEX idx_res_id (reservation_id),
        INDEX idx_decision (admin_decision)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
");

$now       = new DateTime('now');
$nowDate   = $now->format('Y-m-d');
$nowHour   = (int)$now->format('H');
$results   = [];

// ── 1. Confirmée → Checked_in ─────────────────────────────
// Déclenchement : checkInDate ≤ aujourd'hui
$stmtCI = $pdo->prepare("
    SELECT r.id, r.clientName, r.checkInDate, r.checkOutDate, r.roomNumber, r.roomType
    FROM reservation r
    WHERE r.Status = 'Confirmée'
      AND r.checkInDate <= :today
      AND NOT EXISTS (
          SELECT 1 FROM reservation_transitions t
          WHERE t.reservation_id = r.id
            AND t.to_status = 'Checked_in'
            AND t.admin_decision IN ('pending','accepted')
      )
");
$stmtCI->execute([':today' => $nowDate]);
$toCheckIn = $stmtCI->fetchAll(PDO::FETCH_ASSOC);

foreach ($toCheckIn as $r) {
    _createTransition($pdo, $r['id'], 'Confirmée', 'Checked_in');
    $results[] = [
        'reservation_id' => $r['id'],
        'client'         => $r['clientName'],
        'transition'     => 'Confirmée → Checked_in',
        'trigger'        => "checkInDate {$r['checkInDate']} ≤ {$nowDate}",
    ];
}

// ── 2. Checked_in → Completé ──────────────────────────────
// Déclenchement : (checkOutDate + 1 jour) ≤ aujourd'hui ET heure ≥ 12h
// Ex : checkout 12/05 → transition possible le 13/05 à partir de 12h00
$stmtCO = $pdo->prepare("
    SELECT r.id, r.clientName, r.checkInDate, r.checkOutDate, r.roomNumber, r.roomType
    FROM reservation r
    WHERE r.Status = 'Checked_in'
      AND DATE_ADD(r.checkOutDate, INTERVAL 1 DAY) <= :today
      AND NOT EXISTS (
          SELECT 1 FROM reservation_transitions t
          WHERE t.reservation_id = r.id
            AND t.to_status = 'Completé'
            AND t.admin_decision IN ('pending','accepted')
      )
");
// On ne vérife le filtre heure qu'en PHP pour éviter SQL complexe
$stmtCO->execute([':today' => $nowDate]);
$toComplete = $stmtCO->fetchAll(PDO::FETCH_ASSOC);

foreach ($toComplete as $r) {
    // Condition heure >= 12h00 OU la date est strictement dépassée
    $checkoutPlus1 = date('Y-m-d', strtotime($r['checkOutDate'] . ' +1 day'));
    if ($checkoutPlus1 < $nowDate || ($checkoutPlus1 === $nowDate && $nowHour >= 12)) {
        _createTransition($pdo, $r['id'], 'Checked_in', 'Completé');
        $results[] = [
            'reservation_id' => $r['id'],
            'client'         => $r['clientName'],
            'transition'     => 'Checked_in → Completé',
            'trigger'        => "J+1 après checkOut {$r['checkOutDate']} et heure ≥ 12h",
        ];
    }
}

echo json_encode([
    'success'    => true,
    'checked_at' => $now->format('Y-m-d H:i:s'),
    'transitions_created' => count($results),
    'details'    => $results,
]);

// ─────────────────────────────────────────────────────────
function _createTransition(PDO $pdo, int $resId, string $from, string $to): void
{
    $stmt = $pdo->prepare("
        INSERT INTO reservation_transitions
            (reservation_id, from_status, to_status, triggered_at, admin_decision)
        VALUES (:rid, :from, :to, NOW(), 'pending')
    ");
    $stmt->execute([':rid' => $resId, ':from' => $from, ':to' => $to]);
}