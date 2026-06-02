<?php
/**
 * avis.php — API avis Royal Mansour
 * 1 client = 1 seul avis modifiable (UPDATE si existe, INSERT sinon)
 * Lié automatiquement à la dernière réservation valide
 */
session_start();
require "db.php";

header('Content-Type: application/json');

/* ================================================================
   GET — Avis publics (pas besoin d'être connecté)
   ================================================================ */
if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'public_reviews') {

    $limit  = intval($_GET['limit']  ?? 8);
    $offset = intval($_GET['offset'] ?? 0);
    if ($limit <= 0)  $limit  = 8;
    if ($limit > 50)  $limit  = 50;
    if ($offset < 0)  $offset = 0;

    $stmt = $pdo->prepare("
        SELECT
            a.id,
            a.note,
            a.commentaire,
            a.created_at,
            c.prenom,
            c.nom,
            c.genre,
            c.pays
        FROM avis a
        JOIN customer c ON a.customer_id = c.id
        ORDER BY a.created_at DESC
        LIMIT :limitPlusOne OFFSET :offset
    ");
    $stmt->bindValue(':limitPlusOne', $limit + 1, PDO::PARAM_INT);
    $stmt->bindValue(':offset',       $offset,    PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $has_more = count($rows) > $limit;
    if ($has_more) array_pop($rows);

    echo json_encode([
        'reviews'  => $rows,
        'has_more' => $has_more,
        'offset'   => $offset,
        'limit'    => $limit,
    ]);
    exit;
}

/* ================================================================
   Résolution du login_id
   Priorité : 1) session  2) body JSON  3) query param GET
   ================================================================ */
$body_raw = file_get_contents('php://input');
$body     = json_decode($body_raw, true) ?? [];

$login_id = null;
if (!empty($_SESSION['login_id'])) {
    $login_id = $_SESSION['login_id'];
} elseif (!empty($body['login_id'])) {
    $login_id = $body['login_id'];
} elseif (!empty($_GET['login_id'])) {
    $login_id = $_GET['login_id'];
}

if (!$login_id) {
    http_response_code(401);
    echo json_encode(['error' => 'Non authentifié']);
    exit;
}

$stmt = $pdo->prepare("SELECT id FROM customer WHERE login_id = ?");
$stmt->execute([$login_id]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$user) {
    http_response_code(403);
    echo json_encode(['error' => 'Client introuvable']);
    exit;
}

$customer_id = $user['id'];

/* ================================================================
   HELPER — Dernière réservation valide du client
   Priorité : Checked_in > Checked_out/Completed (par date DESC)
   ================================================================ */
function getLastValidReservation($pdo, $customer_id) {

    // 1. Séjour en cours (Checked_in)
    $stmt = $pdo->prepare("
        SELECT id, roomType, roomNumber, checkInDate, checkOutDate, status
        FROM reservation
        WHERE customer_id = ?
          AND LOWER(status) = 'checked_in'
        ORDER BY checkInDate DESC
        LIMIT 1
    ");
    $stmt->execute([$customer_id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row) return ['reservation' => $row, 'source' => 'checked_in'];

    // 2. Dernière réservation terminée
    $stmt = $pdo->prepare("
        SELECT id, roomType, roomNumber, checkInDate, checkOutDate, status
        FROM reservation
        WHERE customer_id = ?
          AND LOWER(status) IN ('checked_out', 'completé', 'complete', 'completed')
        ORDER BY checkOutDate DESC
        LIMIT 1
    ");
    $stmt->execute([$customer_id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row) return ['reservation' => $row, 'source' => 'completed'];

    return ['reservation' => null, 'source' => 'none'];
}

/* ================================================================
   HELPER — Avis existant du client
   ================================================================ */
function getExistingAvis($pdo, $customer_id) {
    $stmt = $pdo->prepare("
        SELECT a.id, a.note, a.commentaire, a.reservation_id, a.created_at
        FROM avis a
        WHERE a.customer_id = ?
        ORDER BY a.created_at DESC
        LIMIT 1
    ");
    $stmt->execute([$customer_id]);
    return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
}

/* ================================================================
   GET — Réservation cible + avis existant pour la modal
   ================================================================ */
if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'reservations') {

    $result      = getLastValidReservation($pdo, $customer_id);
    $existingAvis = getExistingAvis($pdo, $customer_id);

    echo json_encode([
        'reservation'   => $result['reservation'],
        'source'        => $result['source'],
        'existing_avis' => $existingAvis,   // null si aucun avis
        'is_edit'       => $existingAvis !== null,
    ]);
    exit;
}

/* ================================================================
   POST — Soumettre ou modifier un avis (UPSERT)
   ================================================================ */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {

    if (($body['action'] ?? '') !== 'submit') {
        http_response_code(400);
        echo json_encode(['error' => 'Action invalide']);
        exit;
    }

    $note        = intval($body['note']        ?? 0);
    $commentaire = trim($body['commentaire']   ?? '');

    if ($note < 1 || $note > 5) {
        echo json_encode(['error' => 'Veuillez attribuer une note entre 1 et 5.']);
        exit;
    }

    // Récupérer la dernière réservation valide (toujours lié à celle-ci)
    $result = getLastValidReservation($pdo, $customer_id);
    if (!$result['reservation']) {
        echo json_encode(['error' => 'Aucune réservation éligible pour laisser un avis (Checked_in, Checked_out ou Completed requis).']);
        exit;
    }
    $reservation_id = $result['reservation']['id'];

    // Vérifier si un avis existe déjà pour ce client
    $existingAvis = getExistingAvis($pdo, $customer_id);

    if ($existingAvis) {
        // UPDATE — modifier l'avis existant + mettre à jour la réservation liée
        $stmt = $pdo->prepare("
            UPDATE avis
            SET note           = ?,
                commentaire    = ?,
                reservation_id = ?,
                created_at     = NOW()
            WHERE id = ?
              AND customer_id = ?
        ");
        $stmt->execute([
            $note,
            $commentaire ?: null,
            $reservation_id,
            $existingAvis['id'],
            $customer_id,
        ]);
        echo json_encode(['success' => true, 'action' => 'updated']);
    } else {
        // INSERT — premier avis
        $stmt = $pdo->prepare("
            INSERT INTO avis (reservation_id, customer_id, note, commentaire)
            VALUES (?, ?, ?, ?)
        ");
        $stmt->execute([$reservation_id, $customer_id, $note, $commentaire ?: null]);
        echo json_encode(['success' => true, 'action' => 'created']);
    }
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Méthode non autorisée']);