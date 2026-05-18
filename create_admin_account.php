<?php
/**
 * Script pour créer un nouveau compte admin
 * Reçoit: username, password, role
 * Retourne: JSON avec succès ou erreur
 */

header('Content-Type: application/json');

session_start();
require "db.php";

// Vérifier que l'utilisateur est admin
if(!isset($_SESSION['login_id']) || ($_SESSION['role'] ?? 'client') !== 'admin'){
    echo json_encode([
        "success" => false,
        "error" => "Accès refusé. Vous devez être admin."
    ]);
    exit;
}

// Récupérer les données
$username = isset($_POST['username']) ? trim($_POST['username']) : '';
$password = isset($_POST['password']) ? $_POST['password'] : '';
$role = isset($_POST['role']) ? trim($_POST['role']) : 'admin';

// Validations
if (empty($username)) {
    echo json_encode([
        "success" => false,
        "error" => "Le nom d'utilisateur est requis"
    ]);
    exit;
}

if (strlen($username) < 3) {
    echo json_encode([
        "success" => false,
        "error" => "Le nom d'utilisateur doit contenir au moins 3 caractères"
    ]);
    exit;
}

if (empty($password)) {
    echo json_encode([
        "success" => false,
        "error" => "Le mot de passe est requis"
    ]);
    exit;
}

if (strlen($password) < 6) {
    echo json_encode([
        "success" => false,
        "error" => "Le mot de passe doit contenir au moins 6 caractères"
    ]);
    exit;
}

// Vérifier si l'utilisateur existe déjà
try {
    $check_stmt = $pdo->prepare("SELECT login_id FROM login WHERE username = ?");
    $check_stmt->execute([$username]);
    
    if ($check_stmt->rowCount() > 0) {
        echo json_encode([
            "success" => false,
            "error" => "Ce nom d'utilisateur existe déjà"
        ]);
        exit;
    }
    
    // Hasher le mot de passe
    $hashed_password = password_hash($password, PASSWORD_BCRYPT);
    
    // Insérer le nouvel admin
    $insert_stmt = $pdo->prepare("INSERT INTO login (username, password, role) VALUES (?, ?, ?)");
    
    if ($insert_stmt->execute([$username, $hashed_password, $role])) {
        $new_id = $pdo->lastInsertId();
        
        echo json_encode([
            "success" => true,
            "message" => "Compte admin créé avec succès",
            "login_id" => $new_id,
            "username" => $username
        ]);
    } else {
        echo json_encode([
            "success" => false,
            "error" => "Erreur lors de la création du compte"
        ]);
    }
    
} catch (Exception $e) {
    echo json_encode([
        "success" => false,
        "error" => "Erreur serveur: " . $e->getMessage()
    ]);
}

?>
