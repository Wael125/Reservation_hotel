<?php
/* ============================================
   ROYAL MANSOUR — activites_data.php
   Endpoint AJAX : retourne les activités au format JSON
   Usage : fetch('activites_data.php')
   ============================================ */

session_start();
require "db.php";

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// ── Vérification session ──────────────────────────────────────────────────────
if (!isset($_SESSION['login_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Non authentifié']);
    exit;
}

// ── Lecture des activités ─────────────────────────────────────────────────────
try {
    $stmt = $pdo->query("
        SELECT
            id_activite,
            nom_activite,
            description,
            type_activite,
            duree,
            capacite_max,
            localisation,
            statut
        FROM activites
        ORDER BY
            CASE statut
                WHEN 'Disponible'   THEN 0
                WHEN 'Indisponible' THEN 1
                ELSE 2
            END,
            id_activite ASC
    ");

    $activites = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Normaliser les champs numériques
    foreach ($activites as &$a) {
        $a['id_activite']  = (int)  $a['id_activite'];
        $a['capacite_max'] = (int)  $a['capacite_max'];
    }
    unset($a);

    echo json_encode([
        'success'   => true,
        'activites' => $activites,
        'total'     => count($activites),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        'error'   => 'Erreur base de données',
        'message' => $e->getMessage(),
    ]);
}