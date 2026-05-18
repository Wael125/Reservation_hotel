<?php
/**
 * kpi.php — Point d'entrée principal du dashboard
 *
 * GET ?action=all  → retourne les données JSON pour le dashboard
 * Sinon            → sert kpi.html (avec vérification de session admin)
 */

session_start();

// ─────────────────────────────────────────────────────────
//  Helpers d'accès
// ─────────────────────────────────────────────────────────

function redirectForDashboard(): void
{
    if (!isset($_SESSION['login_id'])) {
        header('Location: login.html');
        exit;
    }
    if (($_SESSION['role'] ?? 'client') !== 'admin') {
        header('Location: dashboard.php');
        exit;
    }
}

function denyApiAccess(): void
{
    http_response_code(403);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode(['error' => 'Acces refuse']);
    exit;
}

// ─────────────────────────────────────────────────────────
//  CORS (Live Server : ports 3000 / 5500 / 5501)
// ─────────────────────────────────────────────────────────

$allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5500',
    'http://localhost:5501',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:5501',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins, true)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ─────────────────────────────────────────────────────────
//  Routing
// ─────────────────────────────────────────────────────────

$action = $_GET['action'] ?? null;

if ($action !== 'all') {
    redirectForDashboard();
    header('Content-Type: text/html; charset=UTF-8');
    echo '<script>window.LOGIN_ID = '   . json_encode($_SESSION['login_id'])          . ';';
    echo 'window.ADMIN_NAME = '         . json_encode($_SESSION['username'] ?? 'Admin') . ';</script>';
    include 'kpi.html';
    exit;
}

if (!isset($_SESSION['login_id']) || (($_SESSION['role'] ?? 'client') !== 'admin')) {
    denyApiAccess();
}

header('Content-Type: application/json; charset=UTF-8');

require 'db.php';
require_once 'update_room_availability.php';

// ─────────────────────────────────────────────────────────
//  Utilitaires
// ─────────────────────────────────────────────────────────

function query(PDO $pdo, string $sql, array $params = []): PDOStatement
{
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return $stmt;
}

/**
 * Condition SQL pour les statuts "annulé/refusé" exclus du revenu.
 */
function isCancelledCondition(string $column = 'Status'): string
{
    return "LOWER(COALESCE($column, '')) LIKE 'annul%'
            OR LOWER(COALESCE($column, '')) IN ('cancelled','canceled','refusé','refuse')";
}

/**
 * Condition SQL pour les chambres occupées.
 * La colonne availability contient exactement : 'Disponible', 'Occupé', 'Maintenance'
 */
function isOccupiedCondition(string $column = 'availability'): string
{
    return "COALESCE($column, '') = 'Occupé'";
}

// ─────────────────────────────────────────────────────────
//  Fonctions de données
// ─────────────────────────────────────────────────────────

function getKPIs(PDO $pdo): array
{
    $totalReservations = (int) query($pdo, 'SELECT COUNT(*) FROM reservation')->fetchColumn();

    $totalRevenue = (float) query($pdo,
        'SELECT COALESCE(SUM(totalPrice), 0)
         FROM reservation
         WHERE NOT (' . isCancelledCondition('Status') . ')'
    )->fetchColumn();

    $totalCustomers = (int) query($pdo, 'SELECT COUNT(*) FROM customer')->fetchColumn();

// ── Check-in du jour ──────────────────────────────────
$todayCheckinTotal = (int) query($pdo,
    "SELECT COUNT(*) FROM reservation
     WHERE DATE(checkInDate) = CURDATE()
       AND LOWER(COALESCE(Status,'')) IN ('confirmee', 'checked_in', 'checked in')"
)->fetchColumn();

$todayCheckinDone = (int) query($pdo,
    "SELECT COUNT(*) FROM reservation
     WHERE DATE(checkInDate) = CURDATE()
       AND LOWER(COALESCE(Status,'')) IN ('checked_in','checked in')"
)->fetchColumn();

// ── Check-out du jour ─────────────────────────────────
$todayCheckoutTotal = (int) query($pdo,
    "SELECT COUNT(*) FROM reservation
     WHERE DATE(checkOutDate) = CURDATE() - INTERVAL 1 DAY
       AND LOWER(COALESCE(Status,'')) IN ('checked_in','checked out','checked_in','checked_out')"
)->fetchColumn();

$todayCheckoutDone = (int) query($pdo,
    "SELECT COUNT(*) FROM reservation
     WHERE DATE(checkOutDate) = CURDATE() - INTERVAL 1 DAY
       AND LOWER(COALESCE(Status,'')) IN ('checked_out','checked out')"
)->fetchColumn();

    // ── Occupation ────────────────────────────────────────
    $totalRooms = (int) query($pdo, 'SELECT COUNT(*) FROM room')->fetchColumn();

    $occupiedRooms = (int) query($pdo,
        "SELECT COUNT(*) FROM room WHERE availability = 'Occupé'"
    )->fetchColumn();

    $occupancyRate = $totalRooms > 0
        ? round(($occupiedRooms / $totalRooms) * 100, 1)
        : 0;

    return [
        'total_reservations'  => $totalReservations,
        'total_revenue'       => $totalRevenue,
        'total_customers'     => $totalCustomers,
        'today_checkin_total' => $todayCheckinTotal,
        'today_checkin_done'  => $todayCheckinDone,
        'today_checkout_total'=> $todayCheckoutTotal,
        'today_checkout_done' => $todayCheckoutDone,
        'occupancy_rate'      => $occupancyRate,
        'total_rooms'         => $totalRooms,
        'occupied_rooms'      => $occupiedRooms,
    ];
}

function getReservationsPerMonth(PDO $pdo): array
{
    return query($pdo,
        "SELECT DATE_FORMAT(checkInDate, '%Y-%m') AS month, COUNT(*) AS count
         FROM reservation
         WHERE checkInDate >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
           AND checkInDate <  DATE_ADD(CURDATE(), INTERVAL  1 MONTH)
         GROUP BY month
         ORDER BY month ASC"
    )->fetchAll(PDO::FETCH_ASSOC);
}

function getRevenuePerMonth(PDO $pdo): array
{
    return query($pdo,
        'SELECT DATE_FORMAT(checkInDate, \'%Y-%m\') AS month,
                COALESCE(SUM(totalPrice), 0) AS revenue
         FROM reservation
         WHERE NOT (' . isCancelledCondition('Status') . ')
           AND checkInDate >= DATE_SUB(CURDATE(), INTERVAL 11 MONTH)
           AND checkInDate <  DATE_ADD(CURDATE(), INTERVAL  1 MONTH)
         GROUP BY month
         ORDER BY month ASC'
    )->fetchAll(PDO::FETCH_ASSOC);
}

function getRoomOccupancy(PDO $pdo): array
{
    return query($pdo,
        'SELECT roomType, COUNT(*) AS count
         FROM reservation
         WHERE NOT (' . isCancelledCondition('Status') . ')
           AND roomType IS NOT NULL AND roomType <> \'\'
         GROUP BY roomType
         ORDER BY count DESC'
    )->fetchAll(PDO::FETCH_ASSOC);
}

function getRecentReservations(PDO $pdo): array
{
    return query($pdo,
        'SELECT id, clientName, roomType, roomNumber,
                checkInDate, checkOutDate, totalPrice, Status AS status
         FROM reservation
         ORDER BY id DESC
         LIMIT 8'
    )->fetchAll(PDO::FETCH_ASSOC);
}

/**
 * getRoomStatus — aliases alignés avec renderRoomStatus() dans kpi.js.
 * La colonne availability contient exactement 3 valeurs :
 *   'Disponible' | 'Occupé' | 'Maintenance'
 */
function getRoomStatus(PDO $pdo): array
{
    return query($pdo,
        "SELECT
            roomType,
            COUNT(*) AS total,
            SUM(CASE WHEN availability = 'Disponible'  THEN 1 ELSE 0 END) AS disponible,
            SUM(CASE WHEN availability = 'Occupé'      THEN 1 ELSE 0 END) AS occupied,
            SUM(CASE WHEN availability = 'Maintenance' THEN 1 ELSE 0 END) AS maintenance
         FROM room
         GROUP BY roomType
         ORDER BY roomType ASC"
    )->fetchAll(PDO::FETCH_ASSOC);
}

// ─────────────────────────────────────────────────────────
//  Réponse JSON
// ─────────────────────────────────────────────────────────

try {
    echo json_encode([
        'kpis'                   => getKPIs($pdo),
        'reservations_per_month' => getReservationsPerMonth($pdo),
        'revenue_per_month'      => getRevenuePerMonth($pdo),
        'room_occupancy'         => getRoomOccupancy($pdo),
        'recent_reservations'    => getRecentReservations($pdo),
        'room_status'            => getRoomStatus($pdo),
    ], JSON_THROW_ON_ERROR);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}