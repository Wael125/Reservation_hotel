<?php
/**
 * reclamation.php — API Réclamations Royal Mansour
 */
session_start();
require "db.php";

header('Content-Type: application/json');

define('ML_URL', 'http://127.0.0.1:5001/detect_type');

$VALID_TYPES = [
    'chambre','salle_de_bain','climatisation','chauffage','electricite',
    'wifi','television','bruit','proprete','literie','restauration',
    'petit_dejeuner','room_service','piscine','spa','parking',
    'service_reception','service_menage','service_securite',
    'facturation','remboursement','autre'
];

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
   GET — Récupérer les réclamations du client
   ================================================================ */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? 'list';

    /* ---- Liste des réclamations ---- */
    if ($action === 'list') {
        $stmt = $pdo->prepare("
            SELECT
                rec.id,
                rec.reservation_id,
                rec.avis_id,
                rec.description,
                rec.type,
                rec.statut,
                rec.created_at,
                r.roomType,
                r.roomNumber,
                r.checkInDate,
                r.checkOutDate
            FROM reclamations rec
            LEFT JOIN reservation r ON rec.reservation_id = r.id
            WHERE rec.customer_id = ?
            ORDER BY rec.created_at DESC
        ");
        $stmt->execute([$customer_id]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['reclamations' => $rows]);
        exit;
    }

    /* ---- Réservation cible ---- */
    if ($action === 'reservation') {

        /* 1. Priorité : checked_in */
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

        if ($row) {
            echo json_encode(['reservation' => $row, 'source' => 'checked_in']);
            exit;
        }

        /* 2. Fallback : dernière terminée */
        $stmt = $pdo->prepare("
            SELECT id, roomType, roomNumber, checkInDate, checkOutDate, status
            FROM reservation
            WHERE customer_id = ?
              AND LOWER(status) IN ('checked_out','completé','complete','completed')
            ORDER BY checkOutDate DESC
            LIMIT 1
        ");
        $stmt->execute([$customer_id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($row) {
            echo json_encode(['reservation' => $row, 'source' => 'completed']);
            exit;
        }

        /* 3. Aucune */
        echo json_encode(['reservation' => null, 'source' => 'none']);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Action inconnue']);
    exit;
}

/* ================================================================
   POST — Soumettre une réclamation
   ================================================================ */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $body['action'] ?? '';

    /* ---- Détecter le type via ML ---- */
    if ($action === 'detect') {
        $description = trim($body['description'] ?? '');
        if (strlen($description) < 5) {
            echo json_encode(['type' => 'autre', 'confidence' => 0, 'label' => 'Autre']);
            exit;
        }
        $result = callML($description);
        echo json_encode($result);
        exit;
    }

    /* ---- Soumettre la réclamation ---- */
    if ($action === 'submit') {
        global $VALID_TYPES;

        $reservation_id = intval($body['reservation_id'] ?? 0);
        $description    = trim($body['description']    ?? '');
        $type           = trim($body['type']           ?? 'autre');
        $avis_id        = !empty($body['avis_id']) ? intval($body['avis_id']) : null;

        if ($reservation_id <= 0) {
            echo json_encode(['error' => 'Réservation introuvable.']);
            exit;
        }
        if (strlen($description) < 10) {
            echo json_encode(['error' => 'La description doit faire au moins 10 caractères.']);
            exit;
        }
        if (!in_array($type, $VALID_TYPES)) {
            $type = 'autre';
        }

        /* Vérifier que la réservation appartient au client et est éligible */
        $stmt = $pdo->prepare("
            SELECT id FROM reservation
            WHERE id = ?
              AND customer_id = ?
              AND LOWER(status) IN ('checked_in','checked_out','completé','complete','completed')
        ");
        $stmt->execute([$reservation_id, $customer_id]);
        if (!$stmt->fetch()) {
            echo json_encode(['error' => 'Réservation invalide ou non éligible.']);
            exit;
        }

        /* Vérifier l'avis_id si fourni */
        if ($avis_id !== null) {
            $stmt = $pdo->prepare("SELECT id FROM avis WHERE id = ? AND customer_id = ?");
            $stmt->execute([$avis_id, $customer_id]);
            if (!$stmt->fetch()) $avis_id = null;
        }

        /* Insertion */
        $stmt = $pdo->prepare("
            INSERT INTO reclamations
                (reservation_id, customer_id, avis_id, description, type, statut)
            VALUES
                (?, ?, ?, ?, ?, 'ouverte')
        ");
        $stmt->execute([$reservation_id, $customer_id, $avis_id, $description, $type]);
        $new_id = $pdo->lastInsertId();

        echo json_encode([
            'success' => true,
            'id'      => $new_id,
            'type'    => $type,
            'statut'  => 'ouverte',
        ]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Action invalide']);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Méthode non autorisée']);

/* ================================================================
   HELPER — Appel au service ML Python
   ================================================================ */
function callML(string $description): array {
    $payload = json_encode(['description' => $description]);

    $ch = curl_init(ML_URL);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_TIMEOUT        => 3,
        CURLOPT_CONNECTTIMEOUT => 2,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($error || $httpCode !== 200 || !$response) {
        return ['type' => 'autre', 'confidence' => 0.5, 'label' => 'Autre', 'fallback' => true];
    }

    $data = json_decode($response, true);
    return $data ?? ['type' => 'autre', 'confidence' => 0.5, 'label' => 'Autre'];
}