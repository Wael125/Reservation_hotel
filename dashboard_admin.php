<?php
/**
 * dashboard_admin.php — Point d'entrée principal du dashboard admin
 */

session_start();

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

function query(PDO $pdo, string $sql, array $params = []): PDOStatement
{
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return $stmt;
}

function isCancelledCondition(string $column = 'status'): string
{
    return "LOWER(COALESCE($column, '')) LIKE 'annul%'
            OR LOWER(COALESCE($column, '')) IN ('cancelled','canceled','refusé','refuse')";
}

$action = $_GET['action'] ?? null;

// ══════════════════════════════════════════════════════════
//  ACTION : notifications
// ══════════════════════════════════════════════════════════

if ($action === 'notifications') {

    if (!isset($_SESSION['login_id']) || (($_SESSION['role'] ?? 'client') !== 'admin')) {
        denyApiAccess();
    }

    header('Content-Type: application/json; charset=UTF-8');
    require_once 'db.php';

    $today = date('Y-m-d');

    try {

        // ── 1. Check-in du jour ───────────────────────────────
        // Réservations confirmées dont l'arrivée est aujourd'hui (pas encore checked_in)
        $checkinsToday = query($pdo, "
            SELECT id, clientName, roomType, roomNumber,
                   checkInDate AS eventDate, status,
                   'checkin' AS event_type
            FROM reservation
            WHERE DATE(checkInDate) = :today
              AND LOWER(COALESCE(status,'')) IN ('confirmée','confirmee','confirmed','en attente')
            ORDER BY checkInDate ASC
        ", [':today' => $today])->fetchAll(PDO::FETCH_ASSOC);

        // ── 2. Check-out du jour ──────────────────────────────
        // Réservations checked_out ou completé dont le départ est aujourd'hui
        $checkoutsToday = query($pdo, "
            SELECT id, clientName, roomType, roomNumber,
                   checkOutDate AS eventDate, status,
                   'checkout' AS event_type
            FROM reservation
            WHERE DATE(checkOutDate) = :today
              AND LOWER(COALESCE(status,'')) IN (
                  'checked_in','checked in',
                  'checked_out','checked out',
                  'completé','complete','completed',
                  'confirmée','confirmee','confirmed'
              )
            ORDER BY checkOutDate ASC
        ", [':today' => $today])->fetchAll(PDO::FETCH_ASSOC);

        // ── 3. Nouvelles réservations (récentes) ──────────────
        $newReservations = query($pdo, "
            SELECT id, clientName, roomType, totalPrice,
                   status AS Status,
                   checkInDate AS createdAt
            FROM reservation
            ORDER BY id DESC
            LIMIT 20
        ")->fetchAll(PDO::FETCH_ASSOC);

        // ── 4. Nouveaux clients (48h via id récents) ──────────
        $newClients = query($pdo, "
            SELECT id, nom, prenom, email
            FROM customer
            ORDER BY id DESC
            LIMIT 10
        ")->fetchAll(PDO::FETCH_ASSOC);

        // ── 5. Réclamations récentes ou ouvertes ──────────────
        $newReclamations = query($pdo, "
            SELECT
                r.id,
                CONCAT(COALESCE(c.nom,''), ' ', COALESCE(c.prenom,'')) AS clientName,
                r.urgence    AS priorite,
                r.statut,
                r.description,
                r.type,
                r.created_at
            FROM reclamations r
            LEFT JOIN customer c ON c.id = r.customer_id
            WHERE LOWER(COALESCE(r.statut,'')) IN ('ouverte', 'ouvert', 'open', 'en_cours')
               OR r.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            ORDER BY
                CASE COALESCE(r.urgence,'')
                    WHEN 'Élevée'  THEN 1
                    WHEN 'Moyenne' THEN 2
                    WHEN 'Faible'  THEN 3
                    ELSE 4
                END,
                r.created_at DESC
            LIMIT 50
        ")->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode([
            'success'      => true,
            'today_events' => array_merge($checkinsToday, $checkoutsToday),
            'reservations' => $newReservations,
            'clients'      => $newClients,
            'reclamations' => $newReclamations,
        ], JSON_THROW_ON_ERROR);

    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error'   => $e->getMessage(),
        ]);
    }
    exit;
}

// ══════════════════════════════════════════════════════════
//  Servir le HTML
// ══════════════════════════════════════════════════════════

if ($action !== 'all') {
    redirectForDashboard();
    header('Content-Type: text/html; charset=UTF-8');
    echo '<script>window.LOGIN_ID = '   . json_encode($_SESSION['login_id'])            . ';';
    echo 'window.ADMIN_NAME = '         . json_encode($_SESSION['username'] ?? 'Admin') . ';</script>';
    include 'dashboard_admin.html';
    exit;
}

// ══════════════════════════════════════════════════════════
//  ACTION : all (données KPI dashboard)
// ══════════════════════════════════════════════════════════

if (!isset($_SESSION['login_id']) || (($_SESSION['role'] ?? 'client') !== 'admin')) {
    denyApiAccess();
}

header('Content-Type: application/json; charset=UTF-8');

require 'db.php';
require_once 'update_room_availability.php';

function getKPIs(PDO $pdo): array
{
    $totalReservations = (int) query($pdo, 'SELECT COUNT(*) FROM reservation')->fetchColumn();

    $totalRevenue = (float) query($pdo,
        'SELECT COALESCE(SUM(totalPrice), 0)
         FROM reservation
         WHERE NOT (' . isCancelledCondition('status') . ')'
    )->fetchColumn();

    $totalCustomers = (int) query($pdo, 'SELECT COUNT(*) FROM customer')->fetchColumn();

    // ── Check-in du jour ─────────────────────────────────
    // Total : confirmées + en attente ayant checkInDate = aujourd'hui
    $todayCheckinTotal = (int) query($pdo,
        "SELECT COUNT(*) FROM reservation
         WHERE DATE(checkInDate) = CURDATE()
           AND LOWER(COALESCE(status,'')) IN (
               'confirmée','confirmee','confirmed',
               'en attente','pending',
               'checked_in','checked in'
           )"
    )->fetchColumn();

    // Done : ceux déjà checked_in
    $todayCheckinDone = (int) query($pdo,
        "SELECT COUNT(*) FROM reservation
         WHERE DATE(checkInDate) = CURDATE()
           AND LOWER(COALESCE(status,'')) IN ('checked_in','checked in')"
    )->fetchColumn();

    // ── Check-out du jour ─────────────────────────────────
    // Total : tous ceux dont le checkOutDate est aujourd'hui et qui sont en séjour
    $todayCheckoutTotal = (int) query($pdo,
        "SELECT COUNT(*) FROM reservation
         WHERE DATE(checkOutDate) = CURDATE()
           AND LOWER(COALESCE(status,'')) IN (
               'checked_in','checked in',
               'confirmée','confirmee','confirmed',
               'checked_out','checked out'
           )"
    )->fetchColumn();

    // Done : ceux effectivement partis
    $todayCheckoutDone = (int) query($pdo,
        "SELECT COUNT(*) FROM reservation
         WHERE DATE(checkOutDate) = CURDATE()
           AND LOWER(COALESCE(status,'')) IN ('checked_out','checked out')"
    )->fetchColumn();

    $totalRooms = (int) query($pdo, 'SELECT COUNT(*) FROM room')->fetchColumn();

    $occupiedRooms = (int) query($pdo,
        "SELECT COUNT(*) FROM room WHERE availability = 'Occupé'"
    )->fetchColumn();

    $occupancyRate = $totalRooms > 0
        ? round(($occupiedRooms / $totalRooms) * 100, 1)
        : 0;

    return [
        'total_reservations'   => $totalReservations,
        'total_revenue'        => $totalRevenue,
        'total_customers'      => $totalCustomers,
        'today_checkin_total'  => $todayCheckinTotal,
        'today_checkin_done'   => $todayCheckinDone,
        'today_checkout_total' => $todayCheckoutTotal,
        'today_checkout_done'  => $todayCheckoutDone,
        'occupancy_rate'       => $occupancyRate,
        'total_rooms'          => $totalRooms,
        'occupied_rooms'       => $occupiedRooms,
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
         WHERE NOT (' . isCancelledCondition('status') . ')
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
         WHERE NOT (' . isCancelledCondition('status') . ')
           AND roomType IS NOT NULL AND roomType <> \'\'
         GROUP BY roomType
         ORDER BY count DESC'
    )->fetchAll(PDO::FETCH_ASSOC);
}

function getRecentReservations(PDO $pdo): array
{
    return query($pdo,
        'SELECT id, clientName, roomType, roomNumber,
                checkInDate, checkOutDate, totalPrice, status
         FROM reservation
         ORDER BY id DESC
         LIMIT 8'
    )->fetchAll(PDO::FETCH_ASSOC);
}

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