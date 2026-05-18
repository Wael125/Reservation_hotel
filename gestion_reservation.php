<?php
/**
 * gestion_reservation.php — API REST Réservations
 * Méthodes : GET (liste + filtres), POST (créer), PUT (modifier), DELETE (supprimer)
 * Retour    : JSON uniquement
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
require_once 'db.php'; // votre fichier de connexion existant ($pdo)

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

    // Filtre : recherche client (nom ou email)
    if (!empty($_GET['search'])) {
        $s = '%' . trim($_GET['search']) . '%';
        $conditions[] = '(r.clientName LIKE :search OR r.email LIKE :search2)';
        $params[':search']  = $s;
        $params[':search2'] = $s;
    }

    // Filtre : statut
    if (!empty($_GET['status'])) {
        $conditions[]      = 'r.Status = :status';
        $params[':status'] = trim($_GET['status']);
    }

    // Filtre : type de chambre
    if (!empty($_GET['roomType'])) {
        $conditions[]        = 'r.roomType = :roomType';
        $params[':roomType'] = trim($_GET['roomType']);
    }

    // Filtre : date arrivée (de)
    if (!empty($_GET['date_from'])) {
        $conditions[]         = 'r.checkInDate >= :date_from';
        $params[':date_from'] = $_GET['date_from'];
    }

    // Filtre : date arrivée (à)
    if (!empty($_GET['date_to'])) {
        $conditions[]       = 'r.checkInDate <= :date_to';
        $params[':date_to'] = $_GET['date_to'];
    }

    // Filtre : montant min
    if (isset($_GET['price_min']) && $_GET['price_min'] !== '') {
        $conditions[]           = 'r.totalPrice >= :price_min';
        $params[':price_min']   = (float) $_GET['price_min'];
    }

    // Filtre : montant max
    if (isset($_GET['price_max']) && $_GET['price_max'] !== '') {
        $conditions[]           = 'r.totalPrice <= :price_max';
        $params[':price_max']   = (float) $_GET['price_max'];
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
        // Après fetchAll des réservations, enrichir avec le score client
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
    $r['_hist_total']      = (int) $hist['total'];
    $r['_hist_fiables']    = (int) $hist['fiables'];
    $r['_hist_annulations']= (int) $hist['annulations'];
}
unset($r);
        // Listes pour les filtres dropdown
        $statusList   = $pdo->query("SELECT DISTINCT Status FROM reservation WHERE Status IS NOT NULL ORDER BY Status")->fetchAll(PDO::FETCH_COLUMN);
        $roomTypes    = $pdo->query("SELECT DISTINCT roomType FROM reservation WHERE roomType IS NOT NULL ORDER BY roomType")->fetchAll(PDO::FETCH_COLUMN);
        $roomNumbers  = $pdo->query("SELECT DISTINCT roomNumber FROM reservation WHERE roomNumber IS NOT NULL ORDER BY roomNumber")->fetchAll(PDO::FETCH_COLUMN);

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
            ':clientName'      => trim($data['clientName']),
            ':email'           => trim($data['email']),
            ':phoneNumber'     => trim($data['phoneNumber']     ?? ''),
            ':checkInDate'     => $data['checkInDate'],
            ':checkOutDate'    => $data['checkOutDate'],
            ':roomType'        => trim($data['roomType']),
            ':roomNumber'      => trim($data['roomNumber']      ?? ''),
            ':numberOfAdults'  => (int) ($data['numberOfAdults']  ?? 1),
            ':numberOfChildren'=> (int) ($data['numberOfChildren'] ?? 0),
            ':paymentDetails'  => trim($data['paymentDetails']  ?? ''),
            ':pension'         => trim($data['pension']         ?? ''),
            ':totalPrice'      => (float) $data['totalPrice'],
            ':status'          => trim($data['status']          ?? 'En attente'),
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
// ─────────────────────────────────────────────────────────
function updateReservation(PDO $pdo, ?array $data): void
{
    if (empty($data['id'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'ID réservation manquant']);
        return;
    }

    $allowed = [
        'clientName', 'email', 'phoneNumber', 'checkInDate', 'checkOutDate',
        'roomType', 'roomNumber', 'numberOfAdults', 'numberOfChildren',
        'paymentDetails', 'pension', 'totalPrice', 'Status',
    ];

    $sets   = [];
    $params = [':id' => (int) $data['id']];

    foreach ($allowed as $field) {
        if (array_key_exists($field, $data)) {
            $sets[]          = "$field = :$field";
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
        echo json_encode(['success' => true, 'message' => 'Réservation modifiée avec succès']);
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
        $stmt = $pdo->prepare('DELETE FROM reservation WHERE id = :id');
        $stmt->execute([':id' => $id]);

        if ($stmt->rowCount() === 0) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Réservation introuvable']);
            return;
        }
        echo json_encode(['success' => true, 'message' => "Réservation #$id supprimée"]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}