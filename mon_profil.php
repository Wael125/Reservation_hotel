<?php
/**
 * mon_profil.php
 * API REST – Profil client
 * GET  → récupère les infos du client connecté
 * PUT  → met à jour les infos du client connecté
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, PUT, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ─── Connexion BDD ─── */
require_once 'db.php'; // Adapter selon votre config

/* ─── Session / Authentification ─── */
session_start();

// Vérifier que le client est connecté
if (!isset($_SESSION['login_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Non authentifié. Veuillez vous connecter.']);
    exit;
}

$loginId = (int) $_SESSION['login_id'];

/* ════════════════════════════════════════════
   GET — Récupérer le profil du client connecté
   ════════════════════════════════════════════ */
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        $stmt = $pdo->prepare(
            'SELECT
                c.id,
                c.nom,
                c.prenom,
                c.genre,
                c.email,
                c.telephone,
                c.date_naissance,
                c.pays,
                c.login_id,
                l.username,
                l.role
             FROM customer c
             INNER JOIN login l ON l.login_id = c.login_id
             WHERE c.login_id = :login_id
             LIMIT 1'
        );
        $stmt->execute([':login_id' => $loginId]);
        $client = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$client) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Client introuvable.']);
            exit;
        }

        // Ne jamais exposer le mot de passe
        echo json_encode([
            'success' => true,
            'data'    => [
                'id'             => (int) $client['id'],
                'nom'            => $client['nom']            ?? '',
                'prenom'         => $client['prenom']         ?? '',
                'genre'          => $client['genre']          ?? '',
                'email'          => $client['email']          ?? '',
                'telephone'      => $client['telephone']      ?? '',
                'date_naissance' => $client['date_naissance'] ?? '',
                'pays'           => $client['pays']           ?? '',
                'login_id'       => (int) $client['login_id'],
                'username'       => $client['username']       ?? '',
                'role'           => $client['role']           ?? '',
            ],
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Erreur base de données : ' . $e->getMessage()]);
    }
    exit;
}

/* ════════════════════════════════════════════
   PUT — Mettre à jour le profil du client
   ════════════════════════════════════════════ */
if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    $input = json_decode(file_get_contents('php://input'), true);

    if (!$input) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Corps de la requête invalide.']);
        exit;
    }

    /* ── Champs autorisés ── */
    $allowedCustomer = ['nom', 'prenom', 'genre', 'email', 'telephone', 'date_naissance', 'pays'];
    $allowedLogin    = ['username', 'password'];

    $customerFields = [];
    $loginFields    = [];
    $errors         = [];

    /* ── Validation & collecte ── */
    foreach ($allowedCustomer as $field) {
        if (array_key_exists($field, $input)) {
            $val = trim($input[$field]);

            // Validations spécifiques
            if ($field === 'email') {
                if ($val !== '' && !filter_var($val, FILTER_VALIDATE_EMAIL)) {
                    $errors[] = 'Adresse e-mail invalide.';
                    continue;
                }
                // Vérifier unicité email (hors client actuel)
                if ($val !== '') {
                    $chk = $pdo->prepare(
                        'SELECT COUNT(*) FROM customer c
                         WHERE c.email = :email AND c.login_id != :login_id'
                    );
                    $chk->execute([':email' => $val, ':login_id' => $loginId]);
                    if ((int) $chk->fetchColumn() > 0) {
                        $errors[] = 'Cette adresse e-mail est déjà utilisée par un autre compte.';
                        continue;
                    }
                }
            }

            if ($field === 'telephone' && $val !== '') {
                // Format international basique
                if (!preg_match('/^\+?[\d\s\-().]{6,20}$/', $val)) {
                    $errors[] = 'Numéro de téléphone invalide.';
                    continue;
                }
            }

            if ($field === 'date_naissance' && $val !== '') {
                $dob = DateTime::createFromFormat('Y-m-d', $val);
                if (!$dob) {
                    $errors[] = 'Format de date de naissance invalide (YYYY-MM-DD attendu).';
                    continue;
                }
                $age = (new DateTime())->diff($dob)->y;
                if ($age < 18) {
                    $errors[] = 'Vous devez avoir au moins 18 ans.';
                    continue;
                }
            }

            if ($field === 'genre' && $val !== '') {
                $allowed = ['Homme', 'Femme', 'Autre', 'Non précisé'];
                if (!in_array($val, $allowed, true)) {
                    $errors[] = 'Genre invalide.';
                    continue;
                }
            }

            $customerFields[$field] = $val;
        }
    }

    // Champ username (table login)
    if (array_key_exists('username', $input)) {
        $val = trim($input['username']);
        if ($val !== '') {
            if (strlen($val) < 3 || strlen($val) > 50) {
                $errors[] = "Le nom d'utilisateur doit contenir entre 3 et 50 caractères.";
            } else {
                // Unicité username
                $chk = $pdo->prepare(
                    'SELECT COUNT(*) FROM login WHERE username = :username AND login_id != :login_id'
                );
                $chk->execute([':username' => $val, ':login_id' => $loginId]);
                if ((int) $chk->fetchColumn() > 0) {
                    $errors[] = "Ce nom d'utilisateur est déjà pris.";
                } else {
                    $loginFields['username'] = $val;
                }
            }
        }
    }

    // Champ password (table login) — optionnel
    if (!empty($input['password'])) {
        $newPwd = $input['password'];
        if (strlen($newPwd) < 8) {
            $errors[] = 'Le mot de passe doit contenir au moins 8 caractères.';
        } else {
            // Vérifier ancien mot de passe si fourni
            if (!empty($input['current_password'])) {
                $stmt = $pdo->prepare('SELECT password FROM login WHERE login_id = :login_id');
                $stmt->execute([':login_id' => $loginId]);
                $row = $stmt->fetch(PDO::FETCH_ASSOC);

                // Support hash MD5 (héritage) et password_hash
                $oldPwd = $input['current_password'];
                $stored = $row['password'] ?? '';
                $valid  = password_verify($oldPwd, $stored)
                       || (strlen($stored) === 32 && md5($oldPwd) === $stored)
                       || $oldPwd === $stored; // plain text fallback

                if (!$valid) {
                    $errors[] = 'Mot de passe actuel incorrect.';
                }
            }

            if (!in_array('Mot de passe actuel incorrect.', $errors)) {
                $loginFields['password'] = password_hash($newPwd, PASSWORD_DEFAULT);
            }
        }
    }

    // Retourner les erreurs de validation
    if (!empty($errors)) {
        http_response_code(422);
        echo json_encode(['success' => false, 'errors' => $errors]);
        exit;
    }

    if (empty($customerFields) && empty($loginFields)) {
        echo json_encode(['success' => false, 'error' => 'Aucune donnée à mettre à jour.']);
        exit;
    }

    try {
        $pdo->beginTransaction();

        /* ── UPDATE customer ── */
        if (!empty($customerFields)) {
            $sets = implode(', ', array_map(fn($k) => "$k = :$k", array_keys($customerFields)));
            $customerFields[':login_id_where'] = $loginId;
            $stmt = $pdo->prepare("UPDATE customer SET $sets WHERE login_id = :login_id_where");
            // Rebind proprement
            $params = [];
            foreach ($customerFields as $k => $v) {
                $key = $k === ':login_id_where' ? ':login_id_where' : ":$k";
                $params[$key] = $v;
            }
            $stmt->execute($params);
        }

        /* ── UPDATE login ── */
        if (!empty($loginFields)) {
            $sets = implode(', ', array_map(fn($k) => "$k = :$k", array_keys($loginFields)));
            $loginFields['login_id_where'] = $loginId;
            $stmt = $pdo->prepare("UPDATE login SET $sets WHERE login_id = :login_id_where");
            $params = [];
            foreach ($loginFields as $k => $v) {
                $key = $k === 'login_id_where' ? ':login_id_where' : ":$k";
                $params[$key] = $v;
            }
            $stmt->execute($params);
        }

        $pdo->commit();

        // Mettre à jour la session si le nom a changé
        if (isset($customerFields['prenom'])) $_SESSION['prenom'] = $customerFields['prenom'];
        if (isset($customerFields['nom']))    $_SESSION['nom']    = $customerFields['nom'];
        if (isset($loginFields['username']))  $_SESSION['username'] = $loginFields['username'];

        echo json_encode([
            'success' => true,
            'message' => 'Profil mis à jour avec succès.',
        ]);

    } catch (PDOException $e) {
        $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Erreur lors de la mise à jour : ' . $e->getMessage()]);
    }
    exit;
}

/* ── Méthode non supportée ── */
http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Méthode non autorisée.']);