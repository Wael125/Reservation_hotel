<?php
require 'db.php';

header('Content-Type: application/json');

// Test 1: Nombre d'avis
$stmt = $pdo->query('SELECT COUNT(*) FROM avis');
$count = $stmt->fetchColumn();

// Test 2: Récupérer quelques avis publics
$stmt = $pdo->prepare("SELECT
        a.id,
        a.note,
        a.commentaire,
        c.prenom,
        c.nom,
        c.genre,
        c.pays,
        r.roomType,
        r.checkInDate,
        r.checkOutDate
    FROM avis a
    JOIN reservation r ON a.reservation_id = r.id
    JOIN customer c ON a.customer_id = c.id
    WHERE LOWER(r.status) = 'checked_out'
    ORDER BY a.id DESC
    LIMIT 12");
$stmt->execute();
$reviews = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo json_encode([
    'total_avis' => $count,
    'reviews' => $reviews,
    'message' => $count > 0 ? 'OK: Avis trouvés' : 'ATTENTION: Aucun avis trouvé'
]);
?>
