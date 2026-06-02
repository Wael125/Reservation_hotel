<?php
/**
 * reclamation.php — API Réclamations Royal Mansour Iberostar
 * v4.0 — Moteur ML urgence refondu
 *         Nouveau champ : urgence_triggered_by (liste de termes déclencheurs)
 *         Transmission complète de la réponse ML
 *         Stockage de l'urgence en base de données
 */

session_start();
require "db.php";

header('Content-Type: application/json');

define('ML_URL', 'http://127.0.0.1:5001/detect_type');

/* ----------------------------------------------------------------
   Types valides
   ---------------------------------------------------------------- */
$VALID_TYPES = [
    'chambre','salle_de_bain','climatisation','chauffage','electricite',
    'wifi','television','bruit','proprete','literie','restauration',
    'petit_dejeuner','room_service','piscine','spa','parking',
    'service_reception','service_menage','service_securite',
    'facturation','remboursement','autre',
];

$VALID_URGENCES = ['Faible', 'Moyenne', 'Élevée'];

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
   GET — Actions en lecture
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
                rec.urgence,
                rec.statut,
                rec.created_at,
                r.roomType,
                r.roomNumber,
                r.checkInDate,
                r.checkOutDate
            FROM reclamations rec
            LEFT JOIN reservation r ON rec.reservation_id = r.id
            WHERE rec.customer_id = ?
            ORDER BY
                CASE rec.urgence
                    WHEN 'Élevée'  THEN 1
                    WHEN 'Moyenne' THEN 2
                    WHEN 'Faible'  THEN 3
                    ELSE 4
                END,
                rec.created_at DESC
        ");
        $stmt->execute([$customer_id]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['reclamations' => $rows]);
        exit;
    }

    /* ---- Réservation cible ---- */
    if ($action === 'reservation') {

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

        echo json_encode(['reservation' => null, 'source' => 'none']);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Action inconnue']);
    exit;
}

/* ================================================================
   POST — Actions en écriture
   ================================================================ */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $body['action'] ?? '';

    /* ----------------------------------------------------------------
       ACTION : detect
       v4.0 — transmet aussi urgence_triggered_by (termes déclencheurs)
       ---------------------------------------------------------------- */
    if ($action === 'detect') {
        $description = trim($body['description'] ?? '');

        if (strlen($description) < 5) {
            echo json_encode([
                'type'                 => 'autre',
                'confidence'           => 0,
                'label'                => 'Autre',
                'urgence'              => 'Faible',
                'urgence_score'        => 0,
                'urgence_confidence'   => 0,
                'axis_gravity'         => 0,
                'axis_impact'          => 0,
                'axis_temporal'        => 0,
                'urgence_boosted_by'   => null,
                'urgence_triggered_by' => [],
            ]);
            exit;
        }

        $result = callML($description);
        echo json_encode($result);
        exit;
    }

    /* ----------------------------------------------------------------
       ACTION : submit
       v4.0 — stocke l'urgence, fallback ML côté serveur si absente
       ---------------------------------------------------------------- */
    if ($action === 'submit') {
        global $VALID_TYPES, $VALID_URGENCES;

        $reservation_id = intval($body['reservation_id'] ?? 0);
        $description    = trim($body['description']      ?? '');
        $type           = trim($body['type']             ?? 'autre');
        $urgence        = trim($body['urgence']          ?? '');
        $avis_id        = !empty($body['avis_id']) ? intval($body['avis_id']) : null;

        /* ---- Validations de base ---- */
        if ($reservation_id <= 0) {
            echo json_encode(['error' => 'Réservation introuvable.']);
            exit;
        }
        if (strlen($description) < 10) {
            echo json_encode(['error' => 'La description doit faire au moins 10 caractères.']);
            exit;
        }
        if (!in_array($type, $VALID_TYPES, true)) {
            $type = 'autre';
        }

        /* ---- Validation / fallback urgence ---- */
        if (!in_array($urgence, $VALID_URGENCES, true)) {
            /*
             * L'urgence n'est pas fournie ou invalide :
             * appel ML serveur pour garantir la cohérence
             * même si le JS n'a pas pu détecter (erreur réseau, etc.)
             */
            $ml = callML($description);
            $urgence = in_array($ml['urgence'] ?? '', $VALID_URGENCES, true)
                ? $ml['urgence']
                : 'Moyenne';
        }

        /* ---- Vérifier que la réservation appartient au client ---- */
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

        /* ---- Vérifier l'avis_id si fourni ---- */
        if ($avis_id !== null) {
            $stmt = $pdo->prepare("SELECT id FROM avis WHERE id = ? AND customer_id = ?");
            $stmt->execute([$avis_id, $customer_id]);
            if (!$stmt->fetch()) $avis_id = null;
        }

        /* ---- Insertion ---- */
        $stmt = $pdo->prepare("
            INSERT INTO reclamations
                (reservation_id, customer_id, avis_id, description, type, urgence, statut)
            VALUES
                (?, ?, ?, ?, ?, ?, 'ouverte')
        ");
        $stmt->execute([
            $reservation_id,
            $customer_id,
            $avis_id,
            $description,
            $type,
            $urgence,
        ]);
        $new_id = $pdo->lastInsertId();

        echo json_encode([
            'success' => true,
            'id'      => $new_id,
            'type'    => $type,
            'urgence' => $urgence,
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
   HELPER — Appel au service ML Python (v4.0)
   Retransmet la réponse complète du endpoint /detect_type :
     type, confidence, label,
     urgence, urgence_score, urgence_confidence,
     axis_gravity, axis_impact, axis_temporal,
     urgence_boosted_by, urgence_triggered_by, all_scores
   ================================================================ */
function callML(string $description): array
{
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
        return [
            'type'                 => 'autre',
            'confidence'           => 0.5,
            'label'                => 'Autre',
            'urgence'              => 'Moyenne',
            'urgence_score'        => 0,
            'urgence_confidence'   => 0,
            'axis_gravity'         => 0,
            'axis_impact'          => 0,
            'axis_temporal'        => 0,
            'urgence_boosted_by'   => null,
            'urgence_triggered_by' => [],
            'fallback'             => true,
        ];
    }

    $data = json_decode($response, true);

    if (!$data) {
        return [
            'type'                 => 'autre',
            'confidence'           => 0.5,
            'label'                => 'Autre',
            'urgence'              => 'Moyenne',
            'urgence_score'        => 0,
            'urgence_confidence'   => 0,
            'axis_gravity'         => 0,
            'axis_impact'          => 0,
            'axis_temporal'        => 0,
            'urgence_boosted_by'   => null,
            'urgence_triggered_by' => [],
            'fallback'             => true,
        ];
    }

    /* Garantir que urgence_triggered_by est toujours un tableau */
    if (!isset($data['urgence_triggered_by']) || !is_array($data['urgence_triggered_by'])) {
        $data['urgence_triggered_by'] = [];
    }

    return $data;
}