<?php
session_start();
require "db.php";

header("Content-Type: application/json");

/* ================= RESPONSE ================= */
function response($status, $message){
    echo json_encode([
        "status" => $status,
        "message" => $message
    ]);
    exit;
}

/* ================= LOGIN ================= */
if(isset($_POST['login'])){

    $username = trim($_POST['username'] ?? '');
    $password = trim($_POST['password'] ?? '');

    if(empty($username) || empty($password)){
        response("error", "⚠️ Veuillez remplir tous les champs !");
    }

    // chercher user
    $stmt = $pdo->prepare("SELECT * FROM login WHERE username = ?");
    $stmt->execute([$username]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if(!$user){
        response("error", "❌ Utilisateur introuvable !");
    }

    if(!password_verify($password, $user['password'])){
        response("error", "❌ Mot de passe incorrect !");
    }

    // 🔥 VÉRIFIER LE RÔLE
    $role = $user['role'] ?? 'client';  // Role par défaut: client
    
    // ✅ SESSION
    $_SESSION['login_id'] = $user['login_id'];
    $_SESSION['username'] = $user['username'];
    $_SESSION['role'] = $role;

    // 🔥 REDIRECTION SELON LE RÔLE
    $redirect = ($role === 'admin') ? "dashboard_admin.php" : "dashboard.php";

    echo json_encode([
        "status" => "success",
        "message" => "👋 Bienvenue " . $user['username'],
        "redirect" => $redirect,
        "role" => $role
    ]);
    exit;
}

/* ================= REGISTER ================= */
if(isset($_POST['register'])){

    // ===== DATA =====
    $nom = trim($_POST['nom'] ?? '');
    $prenom = trim($_POST['prenom'] ?? '');
    $email = trim($_POST['email'] ?? '');
    $tel = trim($_POST['tel'] ?? '');
    $genre = trim($_POST['genre'] ?? '');
    $dob = trim($_POST['dob'] ?? '');
    $pays = trim($_POST['pays'] ?? '');

    $username = trim($_POST['username'] ?? '');
    $password = trim($_POST['password'] ?? '');

    // ================= VALIDATION =================
    if(empty($nom) || empty($prenom) || empty($email) || empty($tel)){
        response("error", "⚠️ Informations personnelles manquantes !");
    }

    if(!filter_var($email, FILTER_VALIDATE_EMAIL)){
        response("error", "⚠️ Email invalide !");
    }

    if(!preg_match("/^[0-9]{8}$/", $tel)){
        response("error", "⚠️ Téléphone invalide !");
    }

    // 🔞 AGE CHECK
    if(!empty($dob)){
        $birthDate = new DateTime($dob);
        $today = new DateTime();
        $age = $today->diff($birthDate)->y;

        if($age < 18){
            response("error", "❌ Vous devez avoir au moins 18 ans !");
        }
    }

    if(empty($username) || empty($password)){
        response("error", "⚠️ Username et mot de passe obligatoires !");
    }

    if(strlen($username) < 3){
        response("error", "⚠️ Username trop court !");
    }

    if(strlen($password) < 4){
        response("error", "⚠️ Mot de passe trop court !");
    }

    // ================= CHECK USER =================
    $check = $pdo->prepare("SELECT * FROM login WHERE username = ?");
    $check->execute([$username]);

    if($check->rowCount() > 0){
        response("error", "❌ Username déjà utilisé !");
    }

    try{

        $pdo->beginTransaction();

        // ================= INSERT LOGIN =================
        $hash = password_hash($password, PASSWORD_DEFAULT);

        $stmtLogin = $pdo->prepare("
            INSERT INTO login (username, password, role)
            VALUES (?, ?, 'client')
        ");
        $stmtLogin->execute([$username, $hash]);

        $login_id = $pdo->lastInsertId();

        // ================= INSERT CUSTOMER =================
        $stmtCustomer = $pdo->prepare("
            INSERT INTO customer
            (nom, prenom, genre, email, telephone, date_naissance, pays, login_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ");

        $stmtCustomer->execute([
            $nom,
            $prenom,
            $genre,
            $email,
            $tel,
            $dob,
            $pays,
            $login_id
        ]);

        $pdo->commit();

        response("success", "✅ Compte créé avec succès !");

    } catch(Exception $e){
        $pdo->rollBack();
        response("error", "❌ Erreur serveur !");
    }
}
?>