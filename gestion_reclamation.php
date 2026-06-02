<?php
/**
 * gestion_reclamation.php — Admin API : Réclamations
 * Permet à l'admin de lister, filtrer, changer le statut,
 * et récupérer des stats (charts) sur les réclamations.
 */

session_start();
require "db.php";

header('Content-Type: application/json');

/* ── Auth admin ── */
if (empty($_SESSION['admin_id']) && empty($_SESSION['role'])) {
    $body_raw = file_get_contents('php://input');
    $body     = json_decode($body_raw, true) ?? [];
    if (empty($body['admin_token']) || $body['admin_token'] !== 'admin') {
        // Mode développement : on laisse passer, en production mettre une vraie vérif
    }
} else {
    $body_raw = file_get_contents('php://input');
    $body     = json_decode($body_raw, true) ?? [];
}

$body_raw = $body_raw ?? file_get_contents('php://input');
$body     = $body ?? (json_decode($body_raw, true) ?? []);

/* ================================================================
   GET — lecture
   ================================================================ */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? 'list';

    /* ── Liste réclamations ── */
    if ($action === 'list') {
        $where  = [];
        $params = [];

        if (!empty($_GET['urgence'])) {
            $where[]  = 'rec.urgence = ?';
            $params[] = $_GET['urgence'];
        }
        if (!empty($_GET['statut'])) {
            $where[]  = 'rec.statut = ?';
            $params[] = $_GET['statut'];
        }
        if (!empty($_GET['type'])) {
            $where[]  = 'rec.type = ?';
            $params[] = $_GET['type'];
        }
        if (!empty($_GET['search'])) {
            $s        = '%' . $_GET['search'] . '%';
            $where[]  = '(c.nom LIKE ? OR c.prenom LIKE ? OR c.email LIKE ? OR rec.description LIKE ?)';
            $params[] = $s; $params[] = $s; $params[] = $s; $params[] = $s;
        }
        if (!empty($_GET['date_from'])) {
            $where[]  = 'DATE(rec.created_at) >= ?';
            $params[] = $_GET['date_from'];
        }
        if (!empty($_GET['date_to'])) {
            $where[]  = 'DATE(rec.created_at) <= ?';
            $params[] = $_GET['date_to'];
        }

        $sql_where = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $stmt = $pdo->prepare("
            SELECT
                rec.id,
                rec.reservation_id,
                rec.description,
                rec.type,
                rec.urgence,
                rec.statut,
                rec.created_at,
                CONCAT(COALESCE(c.prenom,''), ' ', COALESCE(c.nom,'')) AS client_name,
                c.email AS client_email,
                c.telephone AS client_phone,
                r.roomType,
                r.roomNumber,
                r.checkInDate,
                r.checkOutDate
            FROM reclamations rec
            LEFT JOIN customer   c ON rec.customer_id    = c.id
            LEFT JOIN reservation r ON rec.reservation_id = r.id
            $sql_where
            ORDER BY
                CASE rec.urgence
                    WHEN 'Élevée'  THEN 1
                    WHEN 'Moyenne' THEN 2
                    WHEN 'Faible'  THEN 3
                    ELSE 4
                END,
                CASE rec.statut
                    WHEN 'ouverte'    THEN 1
                    WHEN 'en_cours'   THEN 2
                    WHEN 'resolue'    THEN 3
                    ELSE 4
                END,
                rec.created_at DESC
        ");
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['reclamations' => $rows, 'total' => count($rows)]);
        exit;
    }

    /* ── Stats pour charts ── */
    if ($action === 'stats') {

        /* Count par urgence */
        $stmt = $pdo->query("
            SELECT urgence, COUNT(*) AS cnt
            FROM reclamations
            GROUP BY urgence
        ");
        $by_urgence = $stmt->fetchAll(PDO::FETCH_ASSOC);

        /* Count par type — TOUS les types, même ceux à 0 réclamations */
        $stmt = $pdo->query("
            SELECT t.type, COALESCE(r.cnt, 0) AS cnt
            FROM (
                SELECT 'chambre'           AS type UNION ALL
                SELECT 'salle_de_bain'              UNION ALL
                SELECT 'climatisation'              UNION ALL
                SELECT 'chauffage'                  UNION ALL
                SELECT 'electricite'                UNION ALL
                SELECT 'wifi'                       UNION ALL
                SELECT 'television'                 UNION ALL
                SELECT 'bruit'                      UNION ALL
                SELECT 'proprete'                   UNION ALL
                SELECT 'literie'                    UNION ALL
                SELECT 'restauration'               UNION ALL
                SELECT 'petit_dejeuner'             UNION ALL
                SELECT 'room_service'               UNION ALL
                SELECT 'piscine'                    UNION ALL
                SELECT 'spa'                        UNION ALL
                SELECT 'parking'                    UNION ALL
                SELECT 'service_reception'          UNION ALL
                SELECT 'service_menage'             UNION ALL
                SELECT 'service_securite'           UNION ALL
                SELECT 'facturation'                UNION ALL
                SELECT 'remboursement'              UNION ALL
                SELECT 'autre'
            ) t
            LEFT JOIN (
                SELECT type, COUNT(*) AS cnt
                FROM reclamations
                GROUP BY type
            ) r ON t.type = r.type
            ORDER BY cnt DESC
        ");
        $by_type = $stmt->fetchAll(PDO::FETCH_ASSOC);

        /* Count par statut */
        $stmt = $pdo->query("
            SELECT statut, COUNT(*) AS cnt
            FROM reclamations
            GROUP BY statut
        ");
        $by_statut = $stmt->fetchAll(PDO::FETCH_ASSOC);

        /* Évolution mensuelle (12 derniers mois) */
        $stmt = $pdo->query("
            SELECT
                DATE_FORMAT(created_at, '%Y-%m') AS mois,
                COUNT(*) AS cnt,
                SUM(urgence = 'Élevée')  AS elevee,
                SUM(urgence = 'Moyenne') AS moyenne,
                SUM(urgence = 'Faible')  AS faible
            FROM reclamations
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
            GROUP BY mois
            ORDER BY mois ASC
        ");
        $by_month = $stmt->fetchAll(PDO::FETCH_ASSOC);

        /* KPIs rapides */
        $stmt = $pdo->query("
            SELECT
                COUNT(*)                               AS total,
                SUM(statut = 'ouverte')                AS ouverte,
                SUM(statut = 'en_cours')               AS en_cours,
                SUM(statut = 'resolue')                AS resolue,
                SUM(urgence = 'Élevée')                AS elevee,
                SUM(urgence = 'Moyenne')               AS moyenne,
                SUM(urgence = 'Faible')                AS faible
            FROM reclamations
        ");
        $kpis = $stmt->fetch(PDO::FETCH_ASSOC);

        echo json_encode([
            'kpis'       => $kpis,
            'by_urgence' => $by_urgence,
            'by_type'    => $by_type,
            'by_statut'  => $by_statut,
            'by_month'   => $by_month,
        ]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Action inconnue']);
    exit;
}

/* ================================================================
   POST — écriture
   ================================================================ */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $body['action'] ?? '';

    /* ── Changer statut ── */
    if ($action === 'update_statut') {
        $id     = intval($body['id']   ?? 0);
        $statut = trim($body['statut'] ?? '');

        $valid = ['ouverte', 'en_cours', 'resolue'];
        if ($id <= 0 || !in_array($statut, $valid, true)) {
            echo json_encode(['error' => 'Données invalides']);
            exit;
        }

        $stmt = $pdo->prepare("UPDATE reclamations SET statut = ? WHERE id = ?");
        $stmt->execute([$statut, $id]);

        echo json_encode(['success' => true, 'id' => $id, 'statut' => $statut]);
        exit;
    }

    /* ── Supprimer ── */
    if ($action === 'delete') {
        $id = intval($body['id'] ?? 0);
        if ($id <= 0) { echo json_encode(['error' => 'ID invalide']); exit; }

        $stmt = $pdo->prepare("DELETE FROM reclamations WHERE id = ?");
        $stmt->execute([$id]);

        echo json_encode(['success' => true]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Action invalide']);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Méthode non autorisée']);