<?php
/**
 * gestion_chambres.php — API REST Chambres
 * Méthodes : GET, POST, PUT, DELETE
 * Retour    : JSON uniquement
 * Table     : room (roomnumber, roomType, price, availability)
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
session_start();
require "db.php";

// ── Routeur ───────────────────────────────────────────────
$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {

    case 'GET':
        getRooms($pdo);
        break;

    case 'POST':
        $data = json_decode(file_get_contents('php://input'), true);
        createRoom($pdo, $data);
        break;

    case 'PUT':
        $data = json_decode(file_get_contents('php://input'), true);
        updateRoom($pdo, $data);
        break;

    case 'DELETE':
        $data = json_decode(file_get_contents('php://input'), true);
        deleteRoom($pdo, $data);
        break;

    default:
        http_response_code(405);
        echo json_encode(['success' => false, 'error' => 'Méthode non autorisée']);
        break;
}

// ─────────────────────────────────────────────────────────
//  FONCTIONS
// ─────────────────────────────────────────────────────────

function getRooms(PDO $pdo): void
{
    $conditions = [];
    $params     = [];

    // Filtre : numéro de chambre (partiel)
    if (!empty($_GET['search'])) {
        $s = '%' . trim($_GET['search']) . '%';
        $conditions[] = '(r.roomnumber LIKE :search OR r.roomType LIKE :search2)';
        $params[':search']  = $s;
        $params[':search2'] = $s;
    }

    // Filtre : type de chambre
    if (!empty($_GET['roomType'])) {
        $conditions[]        = 'r.roomType = :roomType';
        $params[':roomType'] = $_GET['roomType'];
    }

    // Filtre : disponibilité
    if (!empty($_GET['availability'])) {
        $conditions[]             = 'r.availability = :availability';
        $params[':availability']  = $_GET['availability'];
    }

    // Filtre : prix min
    if (isset($_GET['price_min']) && $_GET['price_min'] !== '') {
        $conditions[]          = 'r.price >= :price_min';
        $params[':price_min']  = (float) $_GET['price_min'];
    }

    // Filtre : prix max
    if (isset($_GET['price_max']) && $_GET['price_max'] !== '') {
        $conditions[]          = 'r.price <= :price_max';
        $params[':price_max']  = (float) $_GET['price_max'];
    }

    $where = count($conditions) ? 'WHERE ' . implode(' AND ', $conditions) : '';

    $sql = "
        SELECT
            r.roomnumber,
            r.roomType,
            r.price,
            r.availability
        FROM room r
        $where
        ORDER BY r.roomnumber ASC
    ";

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rooms = $stmt->fetchAll();

        // Listes distinctes pour les dropdowns
        $typesStmt  = $pdo->query("SELECT DISTINCT roomType   FROM room WHERE roomType   IS NOT NULL AND roomType   != '' ORDER BY roomType ASC");
        $availStmt  = $pdo->query("SELECT DISTINCT availability FROM room WHERE availability IS NOT NULL AND availability != '' ORDER BY availability ASC");

        echo json_encode([
            'success'       => true,
            'count'         => count($rooms),
            'data'          => $rooms,
            'room_types'    => $typesStmt->fetchAll(PDO::FETCH_COLUMN),
            'availability_list' => $availStmt->fetchAll(PDO::FETCH_COLUMN),
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

function createRoom(PDO $pdo, ?array $data): void
{
    if (empty($data['roomnumber']) || empty($data['roomType'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Numéro et type de chambre sont obligatoires']);
        return;
    }

    // Unicité du numéro
    try {
        $chk = $pdo->prepare('SELECT COUNT(*) FROM room WHERE roomnumber = :rn');
        $chk->execute([':rn' => trim($data['roomnumber'])]);
        if ((int) $chk->fetchColumn() > 0) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => 'Ce numéro de chambre existe déjà']);
            return;
        }
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        return;
    }

    $sql = "INSERT INTO room (roomnumber, roomType, price, availability)
            VALUES (:roomnumber, :roomType, :price, :availability)";

    $params = [
        ':roomnumber'   => trim($data['roomnumber']),
        ':roomType'     => trim($data['roomType']),
        ':price'        => isset($data['price']) ? (float) $data['price'] : 0,
        ':availability' => $data['availability'] ?? 'Available',
    ];

    try {
        $pdo->prepare($sql)->execute($params);
        echo json_encode(['success' => true, 'message' => 'Chambre créée avec succès']);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

function updateRoom(PDO $pdo, ?array $data): void
{
    if (empty($data['roomnumber'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Numéro de chambre manquant']);
        return;
    }

    $allowed = ['roomType', 'price', 'availability'];
    $sets    = [];
    $params  = [':roomnumber' => $data['roomnumber']];

    foreach ($allowed as $field) {
        if (array_key_exists($field, $data)) {
            $sets[]           = "$field = :$field";
            $params[":$field"] = $data[$field];
        }
    }

    if (empty($sets)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Aucun champ à modifier']);
        return;
    }

    $sql = 'UPDATE room SET ' . implode(', ', $sets) . ' WHERE roomnumber = :roomnumber';

    try {
        $pdo->prepare($sql)->execute($params);
        echo json_encode(['success' => true, 'message' => 'Chambre mise à jour avec succès']);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

function deleteRoom(PDO $pdo, ?array $data): void
{
    if (empty($data['roomnumber'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Numéro de chambre manquant']);
        return;
    }

    $rn = $data['roomnumber'];

    try {
        $stmt = $pdo->prepare('DELETE FROM room WHERE roomnumber = :rn');
        $stmt->execute([':rn' => $rn]);

        if ($stmt->rowCount() === 0) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Chambre introuvable']);
            return;
        }

        echo json_encode(['success' => true, 'message' => "Chambre $rn supprimée avec succès"]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}