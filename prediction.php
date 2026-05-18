<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");

$period  = $_GET["period"]  ?? "monthly";
$horizon = intval($_GET["horizon"] ?? 6);

// Valider les paramètres
$allowed_periods = ["daily", "weekly", "monthly"];
if (!in_array($period, $allowed_periods)) {
    $period = "monthly";
}
$horizon = max(1, min($horizon, 24));

$url = "http://127.0.0.1:5002/predict-reservations?period=" . urlencode($period) . "&horizon=" . $horizon;

$context = stream_context_create([
    "http" => [
        "timeout"       => 60,
        "ignore_errors" => true,
    ]
]);

$response = @file_get_contents($url, false, $context);

if ($response === false) {
    http_response_code(503);
    echo json_encode([
        "error" => "Impossible de contacter le serveur de prédiction (port 5002). Vérifiez que prediction_server.py est lancé."
    ]);
    exit;
}

$decoded = json_decode($response, true);
if ($decoded === null) {
    http_response_code(502);
    echo json_encode([
        "error" => "Réponse invalide du serveur de prédiction."
    ]);
    exit;
}

echo $response;