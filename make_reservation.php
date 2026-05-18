<?php
header("Content-Type: application/json; charset=UTF-8");
require "db.php";

ini_set('display_errors', 0);
error_reporting(0);

try {
    $raw = file_get_contents("php://input");
    $data = json_decode($raw, true);

    if (!$data) {
        throw new Exception("JSON invalide reçu");
    }

    // 🔹 récupérer login_id depuis chatbot (peut être username ou numeric login_id)
    $login_identifier = $data["login_id"] ?? null;
    if (!$login_identifier) {
        throw new Exception("login_id manquant");
    }

    // 🔹 Chercher le login_id numérique, OU le créer s'il n'existe pas
    $stmt = $pdo->prepare("SELECT login_id FROM login WHERE login_id = ? OR username = ? LIMIT 1");
    $stmt->execute([$login_identifier, $login_identifier]);
    $login_record = $stmt->fetch();
    
    if (!$login_record) {
        // Login n'existe pas → le créer automatiquement
        try {
            $insert_login = $pdo->prepare("INSERT INTO login (username) VALUES (?)");
            $insert_login->execute([$login_identifier]);
            $numeric_login_id = $pdo->lastInsertId();
        } catch (Exception $e) {
            throw new Exception("Impossible de créer le login: " . $e->getMessage());
        }
    } else {
        $numeric_login_id = $login_record["login_id"];
    }
    
    // 🔹 Chercher le customer associé OU le créer
    $customer_stmt = $pdo->prepare("SELECT id FROM customer WHERE login_id = ? LIMIT 1");
    $customer_stmt->execute([$numeric_login_id]);
    $customer_record = $customer_stmt->fetch();
    
    if (!$customer_record) {
        // Customer n'existe pas → le créer
        try {
            $insert_customer = $pdo->prepare("INSERT INTO customer (login_id) VALUES (?)");
            $insert_customer->execute([$numeric_login_id]);
            $customer_id = $pdo->lastInsertId();
        } catch (Exception $e) {
            throw new Exception("Impossible de créer le customer: " . $e->getMessage());
        }
    } else {
        $customer_id = $customer_record["id"];
    }

    // 🔹 données réservation (correspondant aux clés du chatbot)
    $clientName = $data["clientName"] ?? null;
    $email = $data["email"] ?? null;
    $phone = $data["phoneNumber"] ?? null;  // 🔥 CORRIGÉ: phoneNumber pas phone
    $checkIn = $data["checkInDate"] ?? null;
    $checkOut = $data["checkOutDate"] ?? null;
    $roomType = $data["roomType"] ?? null;
    $roomNumber = $data["roomNumber"] ?? null;
    $adults = $data["numberOfAdults"] ?? 1;  // 🔥 CORRIGÉ: numberOfAdults pas adults
    $children = $data["numberOfChildren"] ?? 0;  // 🔥 CORRIGÉ: numberOfChildren pas children
    $pension = $data["pension"] ?? null;  // 🔥 NOUVEAU: pension
    $paymentDetails = $data["paymentDetails"] ?? null;  // 🔥 NOUVEAU: paymentDetails
    $totalPrice = $data["totalPrice"] ?? null;  // 🔥 NOUVEAU: totalPrice

    // Validation
    if (!$clientName || !$email || !$phone || !$checkIn || !$checkOut || !$roomType) {
        throw new Exception("Paramètres obligatoires manquants");
    }

    $totalPeople = (int)$adults + (int)$children;

    // 🔹 insertion avec customer_id et les nouvelles colonnes
    $sql = "INSERT INTO reservation (
        clientName,
        customer_id,
        email,
        phoneNumber,
        checkInDate,
        checkOutDate,
        roomType,
        roomNumber,
        numberOfAdults,
        numberOfChildren,
        totalNumberOfPeople,
        pension,
        paymentDetails,
        totalPrice,
        Status
    ) VALUES (
        :clientName,
        :customer_id,
        :email,
        :phone,
        :checkIn,
        :checkOut,
        :roomType,
        :roomNumber,
        :adults,
        :children,
        :totalPeople,
        :pension,
        :paymentDetails,
        :totalPrice,
        'En attente'
    )";

    $stmt = $pdo->prepare($sql);
    
    $success = $stmt->execute([
        "clientName" => $clientName,
        "customer_id" => $customer_id,
        "email" => $email,
        "phone" => $phone,
        "checkIn" => $checkIn,
        "checkOut" => $checkOut,
        "roomType" => $roomType,
        "roomNumber" => $roomNumber,
        "adults" => $adults,
        "children" => $children,
        "totalPeople" => $totalPeople,
        "pension" => $pension,  // 🔥 NOUVEAU
        "paymentDetails" => $paymentDetails,  // 🔥 NOUVEAU
        "totalPrice" => $totalPrice  // 🔥 NOUVEAU
    ]);

    if ($success) {
        $reservation_id = $pdo->lastInsertId();
        
        // 🔥 ENVOYER EMAIL AVEC MAIL() ET MERCURY
        $email_sent = false;
        try {
            $to = $email;
            $subject = "Confirmation de réservation #" . $reservation_id . " - Hôtel Royal Mansour";
            
            $n = (int)$adults;
            $e = (int)$children;
            
            $message = "
            <html>
                <head>
                    <meta charset='UTF-8'>
                </head>
                <body style='font-family: Arial, sans-serif; color: #333;'>
                    <div style='max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;'>
                        <div style='background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center;'>
                            <h1>🏨 Hôtel Royal Mansour</h1>
                            <h2>Confirmation de Réservation</h2>
                        </div>
                        
                        <div style='padding: 20px;'>
                            <p>Chère <strong>$clientName</strong>,</p>
                            
                            <p>Merci d'avoir choisi notre hôtel ! Voici les détails de votre réservation :</p>
                            
                            <div style='background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 15px 0;'>
                                <p><strong>📌 Référence de réservation:</strong> <span style='color: #667eea; font-size: 18px;'>#$reservation_id</span></p>
                                <p><strong>👤 Nom:</strong> $clientName</p>
                                <p><strong>📅 Check-in:</strong> $checkIn</p>
                                <p><strong>📅 Check-out:</strong> $checkOut</p>
                                <p><strong>🛏️ Type de chambre:</strong> $roomType</p>
                                <p><strong>🚪 Numéro de chambre:</strong> $roomNumber</p>
                                <p><strong>👥 Nombre de personnes:</strong> $totalPeople (Adultes: $n, Enfants: $e)</p>
                                <p><strong>🍽️ Pension:</strong> $pension</p>
                                <p><strong>💳 Mode de paiement:</strong> $paymentDetails</p>
                                <p><strong>💰 Montant total:</strong> <span style='color: #ff6b6b; font-weight: bold;'>$totalPrice DT</span></p>
                            </div>
                            
                            <p>Nous vous accueillerons avec plaisir ! Si vous avez des questions, n'hésitez pas à nous contacter.</p>
                            
                            <p style='text-align: center; margin-top: 30px; color: #888;'>
                                <em>Cet email a été généré automatiquement.</em>
                            </p>
                        </div>
                        
                        <div style='background: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #888;'>
                            <p>© 2026 Hôtel Royal Mansour. Tous droits réservés.</p>
                        </div>
                    </div>
                </body>
            </html>";
            
            // Headers correctement configurés
            $headers = "MIME-Version: 1.0\r\n";
            $headers .= "Content-type: text/html; charset=UTF-8\r\n";
            $headers .= "From: reservations@hotel-royalmansour.tn\r\n";
            $headers .= "Reply-To: reservations@hotel-royalmansour.tn\r\n";
            $headers .= "X-Mailer: PHP/" . phpversion() . "\r\n";
            
            // Envoyer l'email avec Mercury
            if (@mail($to, $subject, $message, $headers)) {
                $email_sent = true;
            } else {
                error_log("Mail envoyé mais Mercury peut ne pas être configuré correctement");
            }
        } catch (Exception $e) {
            error_log("Email error: " . $e->getMessage());
        }
        
        echo json_encode([
            "status" => "success",
            "message" => "Réservation confirmée",
            "reservation_id" => $reservation_id,
            "email_sent" => $email_sent
        ]);
    } else {
        throw new Exception("Erreur lors de l'insertion en base");
    }

} catch (Throwable $e) {
    echo json_encode([
        "status" => "error",
        "message" => $e->getMessage()
    ]);
}
?>