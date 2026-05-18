<?php
session_start();
require "db.php";

// ── Vérification session ──────────────────────────────────────────────────────
if (!isset($_SESSION['login_id'])) {
    header("Location: login.html");
    exit;
}

$login_id = $_SESSION['login_id'];

// ── Récupérer le customer lié au login ───────────────────────────────────────
$stmt = $pdo->prepare("
    SELECT c.id, c.nom, c.prenom
    FROM customer c
    WHERE c.login_id = ?
");
$stmt->execute([$login_id]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);

$nom         = $user['nom']    ?? '';
$prenom      = $user['prenom'] ?? '';
$customer_id = $user['id']     ?? null;

// ── Initialisation ────────────────────────────────────────────────────────────
$reservations = [];
$stats = [
    'total'      => 0,
    'totalSpent' => 0,
    'nextStay'   => null,
];

if ($customer_id) {

    // ── Réservations DESC pour l'historique affiché ───────────────────────────
    $stmtDesc = $pdo->prepare("
        SELECT
            id,
            roomType,
            roomNumber,
            checkInDate,
            checkOutDate,
            numberOfAdults,
            numberOfChildren,
            pension,
            totalPrice,
            Status AS status
        FROM reservation
        WHERE customer_id = ?
        ORDER BY checkInDate DESC
    ");
    $stmtDesc->execute([$customer_id]);
    $reservations = $stmtDesc->fetchAll(PDO::FETCH_ASSOC);

    // ── Réservations ASC pour calculer nextStay ───────────────────────────────
    $stmtAsc = $pdo->prepare("
        SELECT
            id,
            roomType,
            roomNumber,
            checkInDate,
            checkOutDate,
            numberOfAdults,
            numberOfChildren,
            pension,
            totalPrice,
            Status AS status
        FROM reservation
        WHERE customer_id = ?
        ORDER BY checkInDate ASC
    ");
    $stmtAsc->execute([$customer_id]);
    $reservationsAsc = $stmtAsc->fetchAll(PDO::FETCH_ASSOC);

    // ── Calcul stats ──────────────────────────────────────────────────────────
    $stats['total'] = count($reservations);

    foreach ($reservationsAsc as $r) {
        $status = strtolower(trim($r['status']));

        // Total dépensé : hors annulées
        if ($status !== 'cancelled' && $status !== 'annulé' && $status !== 'annule') {
            $stats['totalSpent'] += floatval($r['totalPrice']);
        }

        // Prochain séjour :
        //   • checkInDate >= aujourd'hui
        //   • status En attente ou Confirmée
        //   • NON annulé
        //   • NON Checked_in (séjour en cours → géré par la bannière)
        if (
            $stats['nextStay'] === null
            && strtotime($r['checkInDate']) >= strtotime('today')
            && in_array($status, ['en attente', 'confirmée'], true)
            && $status !== 'cancelled'
            && $status !== 'annulé'
            && $status !== 'annule'
            && $status !== 'checked_in'
        ) {
            $stats['nextStay'] = $r;
        }
    }
}
?>
<script>
window.LOGIN_ID      = <?php echo json_encode($login_id);            ?>;
window.CLIENT_NOM    = <?php echo json_encode($prenom . ' ' . $nom); ?>;
window.CLIENT_PRENOM = <?php echo json_encode($prenom);              ?>;
window.RESERVATIONS  = <?php echo json_encode($reservations);        ?>;
window.STATS         = <?php echo json_encode($stats);               ?>;
</script>

<?php include "dashboard.html"; ?>