<?php
/**
 * gestion_clients.php — API REST Clients
 * Méthodes : GET, POST, PUT, DELETE
 * Retour    : JSON uniquement
 */

// ── Headers ──────────────────────────────────────────────
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Pre-flight CORS
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

    // ════════════════════════════════════
    //  GET — Liste / Filtres
    // ════════════════════════════════════
    case 'GET':
        getClients($pdo);
        break;

    // ════════════════════════════════════
    //  POST — Créer un client
    // ════════════════════════════════════
    case 'POST':
        $data = json_decode(file_get_contents('php://input'), true);
        createClient($pdo, $data);
        break;

    // ════════════════════════════════════
    //  PUT — Modifier un client
    // ════════════════════════════════════
    case 'PUT':
        $data = json_decode(file_get_contents('php://input'), true);
        updateClient($pdo, $data);
        break;

    // ════════════════════════════════════
    //  DELETE — Supprimer un client
    // ════════════════════════════════════
    case 'DELETE':
        $data = json_decode(file_get_contents('php://input'), true);
        deleteClient($pdo, $data);
        break;

    default:
        http_response_code(405);
        echo json_encode(['success' => false, 'error' => 'Méthode non autorisée']);
        break;
}

// ─────────────────────────────────────────────────────────
//  FONCTIONS
// ─────────────────────────────────────────────────────────

/**
 * Récupère les clients avec filtres dynamiques optionnels.
 */
function getClients(PDO $pdo): void
{
    $conditions = [];
    $params     = [];

    // Filtre : nom, prénom ou email (LIKE partiel)
    if (!empty($_GET['search'])) {
        $search = '%' . trim($_GET['search']) . '%';
        $conditions[] = '(c.nom LIKE :search OR c.prenom LIKE :search2 OR c.email LIKE :search3)';
        $params[':search']  = $search;
        $params[':search2'] = $search;
        $params[':search3'] = $search;
    }

    // Filtre : genre
    if (!empty($_GET['genre']) && in_array($_GET['genre'], ['Homme', 'Femme'])) {
        $conditions[]     = 'c.genre = :genre';
        $params[':genre'] = $_GET['genre'];
    }

    // Filtre : pays
    if (!empty($_GET['pays'])) {
        $conditions[]    = 'c.pays LIKE :pays';
        $params[':pays'] = '%' . trim($_GET['pays']) . '%';
    }

    // Filtre : date de naissance (de)
    if (!empty($_GET['date_from'])) {
        $conditions[]         = 'c.date_naissance >= :date_from';
        $params[':date_from'] = $_GET['date_from'];
    }

    // Filtre : date de naissance (à)
    if (!empty($_GET['date_to'])) {
        $conditions[]       = 'c.date_naissance <= :date_to';
        $params[':date_to'] = $_GET['date_to'];
    }

    $where = count($conditions) ? 'WHERE ' . implode(' AND ', $conditions) : '';

    $sql = "
        SELECT
            c.id,
            c.nom,
            c.prenom,
            c.genre,
            c.email,
            c.telephone,
            c.date_naissance,
            c.pays,
            c.login_id
        FROM customer c
        $where
        ORDER BY c.id DESC
    ";

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $clients = $stmt->fetchAll();

        // Liste distincte des pays pour le datalist
        $paysStmt = $pdo->query(
            "SELECT DISTINCT pays FROM customer
             WHERE pays IS NOT NULL AND pays != ''
             ORDER BY pays ASC"
        );
        $paysList = $paysStmt->fetchAll(PDO::FETCH_COLUMN);

        echo json_encode([
            'success'   => true,
            'count'     => count($clients),
            'data'      => $clients,
            'pays_list' => $paysList,
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Créer un nouveau client.
 */
function createClient(PDO $pdo, ?array $data): void
{
    // Champs obligatoires
    if (empty($data['nom']) || empty($data['prenom']) || empty($data['email'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Nom, prénom et email sont obligatoires']);
        return;
    }

    // Vérifier unicité de l'email
    try {
        $checkStmt = $pdo->prepare('SELECT COUNT(*) FROM customer WHERE email = :email');
        $checkStmt->execute([':email' => trim($data['email'])]);
        if ((int) $checkStmt->fetchColumn() > 0) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => 'Un client avec cet email existe déjà']);
            return;
        }
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        return;
    }

    $sql = "
        INSERT INTO customer (nom, prenom, genre, email, telephone, date_naissance, pays)
        VALUES (:nom, :prenom, :genre, :email, :telephone, :date_naissance, :pays)
    ";

    $params = [
        ':nom'            => trim($data['nom']),
        ':prenom'         => trim($data['prenom']),
        ':genre'          => $data['genre']          ?? 'Homme',
        ':email'          => trim($data['email']),
        ':telephone'      => trim($data['telephone']      ?? ''),
        ':date_naissance' => !empty($data['date_naissance']) ? $data['date_naissance'] : null,
        ':pays'           => trim($data['pays']            ?? ''),
    ];

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $newId = (int) $pdo->lastInsertId();

        echo json_encode([
            'success' => true,
            'message' => 'Client créé avec succès',
            'id'      => $newId,
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Modifier les données d'un client.
 */
function updateClient(PDO $pdo, ?array $data): void
{
    if (empty($data['id'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'ID client manquant']);
        return;
    }

    $allowed = ['nom', 'prenom', 'genre', 'email', 'telephone', 'date_naissance', 'pays'];
    $sets    = [];
    $params  = [':id' => (int) $data['id']];

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

    $sql = 'UPDATE customer SET ' . implode(', ', $sets) . ' WHERE id = :id';

    try {
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        echo json_encode(['success' => true, 'message' => 'Client mis à jour avec succès']);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Supprimer un client par son ID.
 */
function deleteClient(PDO $pdo, ?array $data): void
{
    if (empty($data['id'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'ID client manquant']);
        return;
    }

    $id = (int) $data['id'];

    try {
        $stmt = $pdo->prepare('DELETE FROM customer WHERE id = :id');
        $stmt->execute([':id' => $id]);

        if ($stmt->rowCount() === 0) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Client introuvable']);
            return;
        }

        echo json_encode(['success' => true, 'message' => "Client #$id supprimé avec succès"]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}