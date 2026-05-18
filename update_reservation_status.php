<?php
/**
 * API: Mettre à jour le status d'une réservation
 * Paramètres: reservation_id, new_status
 */

header('Content-Type: application/json');

session_start();
require "db.php";

// Vérifier que l'utilisateur est admin
if(!isset($_SESSION['login_id']) || ($_SESSION['role'] ?? 'client') !== 'admin'){
    echo json_encode([
        "success" => false,
        "error" => "Accès refusé"
    ]);
    exit;
}

$reservation_id = isset($_POST['reservation_id']) ? (int)$_POST['reservation_id'] : null;
$new_status = isset($_POST['new_status']) ? trim($_POST['new_status']) : null;

// Validations
if (!$reservation_id) {
    echo json_encode([
        "success" => false,
        "error" => "ID de réservation manquant"
    ]);
    exit;
}

if (!$new_status) {
    echo json_encode([
        "success" => false,
        "error" => "Nouveau status manquant"
    ]);
    exit;
}

// Vérifier que le status est valide
$valid_statuses = ["En attente", "Confirmée", "Annulé"];
if (!in_array($new_status, $valid_statuses)) {
    echo json_encode([
        "success" => false,
        "error" => "Status invalide"
    ]);
    exit;
}

try {
    // Vérifier que la réservation existe
    $check = $pdo->prepare("SELECT id, Status FROM reservation WHERE id = ?");
    $check->execute([$reservation_id]);
    $reservation = $check->fetch();
    
    if (!$reservation) {
        echo json_encode([
            "success" => false,
            "error" => "Réservation non trouvée"
        ]);
        exit;
    }
    
    // Mettre à jour le status
    $update = $pdo->prepare("UPDATE reservation SET Status = ? WHERE id = ?");
    
    if ($update->execute([$new_status, $reservation_id])) {
        echo json_encode([
            "success" => true,
            "message" => "Status mis à jour avec succès",
            "reservation_id" => $reservation_id,
            "old_status" => $reservation['Status'],
            "new_status" => $new_status
        ]);
    } else {
        echo json_encode([
            "success" => false,
            "error" => "Erreur lors de la mise à jour"
        ]);
    }
    
} catch (Exception $e) {
    echo json_encode([
        "success" => false,
        "error" => $e->getMessage()
    ]);
}

?>
