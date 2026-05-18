<?php
/**
 * avis.php — API avis Royal Mansour
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
   GET — Réservation cible pour l'avis (auto-sélection)
   ================================================================ */
if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'reservations') {

    /* 1. Priorité : séjour en cours (checked_in) sans avis */
    $stmt = $pdo->prepare("
        SELECT r.id, r.roomType, r.roomNumber, r.checkInDate, r.checkOutDate, r.status
        FROM reservation r
        LEFT JOIN avis a ON a.reservation_id = r.id
        WHERE r.customer_id = ?
          AND LOWER(r.status) = 'checked_in'
          AND a.id IS NULL
        ORDER BY r.checkInDate DESC
        LIMIT 1
    ");
    $stmt->execute([$customer_id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($row) {
        echo json_encode(['reservation' => $row, 'source' => 'checked_in']);
        exit;
    }

    /* 2. Fallback : dernière réservation terminée sans avis */
    $stmt = $pdo->prepare("
        SELECT r.id, r.roomType, r.roomNumber, r.checkInDate, r.checkOutDate, r.status
        FROM reservation r
        LEFT JOIN avis a ON a.reservation_id = r.id
        WHERE r.customer_id = ?
          AND LOWER(r.status) IN ('checked_out', 'completé', 'complete', 'completed')
          AND a.id IS NULL
        ORDER BY r.checkOutDate DESC
        LIMIT 1
    ");
    $stmt->execute([$customer_id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($row) {
        echo json_encode(['reservation' => $row, 'source' => 'completed']);
        exit;
    }

    /* 3. Aucune réservation éligible */
    echo json_encode(['reservation' => null, 'source' => 'none']);
    exit;
}

/* ================================================================
   POST — Soumettre un avis
   ================================================================ */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {

    if (($body['action'] ?? '') !== 'submit') {
        http_response_code(400);
        echo json_encode(['error' => 'Action invalide']);
        exit;
    }

    $reservation_id = intval($body['reservation_id'] ?? 0);
    $note           = intval($body['note']           ?? 0);
    $commentaire    = trim($body['commentaire']      ?? '');

    if ($reservation_id <= 0) {
        echo json_encode(['error' => 'Réservation introuvable.']);
        exit;
    }
    if ($note < 1 || $note > 5) {
        echo json_encode(['error' => 'Veuillez attribuer une note entre 1 et 5.']);
        exit;
    }

    /* Vérifie que la réservation appartient au client et est éligible */
    $stmt = $pdo->prepare("
        SELECT id FROM reservation
        WHERE id = ?
          AND customer_id = ?
          AND LOWER(status) IN ('checked_in', 'checked_out', 'completé', 'complete', 'completed')
    ");
    $stmt->execute([$reservation_id, $customer_id]);
    if (!$stmt->fetch()) {
        echo json_encode(['error' => 'Réservation invalide ou séjour non éligible.']);
        exit;
    }

    /* Vérifie qu'un avis n'existe pas déjà pour cette réservation */
    $stmt = $pdo->prepare("SELECT id FROM avis WHERE reservation_id = ?");
    $stmt->execute([$reservation_id]);
    if ($stmt->fetch()) {
        echo json_encode(['error' => 'Vous avez déjà laissé un avis pour ce séjour.']);
        exit;
    }

    $stmt = $pdo->prepare("
        INSERT INTO avis (reservation_id, customer_id, note, commentaire)
        VALUES (?, ?, ?, ?)
    ");
    $stmt->execute([$reservation_id, $customer_id, $note, $commentaire ?: null]);

    echo json_encode(['success' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Méthode non autorisée']);