<?php
/**
 * check_availability.php — API disponibilité des chambres
 * Retourne toutes les chambres disponibles pour une plage de dates,
 * avec filtre optionnel par type.
 *
 * POST body (JSON) :
 *   { checkInDate, checkOutDate, roomType? }
 *
 * Réponse :
 *   { status: "available"|"unavailable"|"error", rooms: [...], message? }
 */

header("Content-Type: application/json; charset=UTF-8");
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

require "db.php";
ini_set('display_errors', 0);
error_reporting(0);

try {
    $raw  = file_get_contents("php://input");
    $data = json_decode($raw, true);

    if (!$data) {
        echo json_encode(["status" => "error", "message" => "JSON invalide"]);
        exit;
    }

    $checkIn  = trim($data["checkInDate"]  ?? '');
    $checkOut = trim($data["checkOutDate"] ?? '');
    $roomType = trim($data["roomType"]     ?? ''); // optionnel
    $excludeReservationId = (int) ($data["excludeReservationId"] ?? 0);

    if (!$checkIn || !$checkOut) {
        echo json_encode(["status" => "error", "message" => "checkInDate et checkOutDate sont requis"]);
        exit;
    }

    // Validation dates
    $today = date('Y-m-d');
    if ($checkIn < $today) {
        echo json_encode(["status" => "error", "message" => "La date d'arrivée ne peut pas être dans le passé"]);
        exit;
    }
    if ($checkOut <= $checkIn) {
        echo json_encode(["status" => "error", "message" => "La date de départ doit être après la date d'arrivée"]);
        exit;
    }

    // Construction de la requête — roomType est optionnel
    $typeCondition = '';
    $excludeCondition = '';
    $params = [
        ':checkOut' => $checkOut,
        ':checkIn'  => $checkIn,
    ];

    if ($roomType !== '') {
        $typeCondition   = 'AND r.roomType = :roomType';
        $params[':roomType'] = $roomType;
    }

    if ($excludeReservationId > 0) {
        $excludeCondition = 'AND res.id != :excludeReservationId';
        $params[':excludeReservationId'] = $excludeReservationId;
    }

    $sql = "
        SELECT
            r.roomnumber,
            r.roomType,
            r.price,
            r.availability
        FROM room r
        WHERE r.availability != 'Maintenance'
          $typeCondition
          AND r.roomnumber NOT IN (
              SELECT res.roomNumber
              FROM reservation res
              WHERE res.roomNumber IS NOT NULL
                AND res.roomNumber != ''
                $excludeCondition
                AND LOWER(COALESCE(res.Status,'')) NOT IN ('annulé','annule','annulee','cancelled','canceled')
                AND res.checkInDate  < :checkOut
                AND res.checkOutDate > :checkIn
          )
        ORDER BY r.roomType ASC, r.roomnumber ASC
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rooms = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (!empty($rooms)) {
        echo json_encode([
            "status" => "available",
            "count"  => count($rooms),
            "rooms"  => $rooms,
        ]);
    } else {
        echo json_encode([
            "status"  => "unavailable",
            "count"   => 0,
            "rooms"   => [],
            "message" => "Aucune chambre disponible pour ces dates" .
                         ($roomType ? " et ce type" : ""),
        ]);
    }

} catch (Throwable $e) {
    echo json_encode(["status" => "error", "message" => $e->getMessage()]);
}
