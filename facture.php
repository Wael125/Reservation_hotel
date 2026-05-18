<?php
/**
 * facture.php — Facture de réservation
 * Données depuis $_SESSION["last_reservation"]
 * Export PDF via window.print() + CSS @media print
 */
session_start();

if (empty($_SESSION["last_reservation"])) {
    header("Location: reserver.html");
    exit;
}
$r = $_SESSION["last_reservation"];

// Helpers
function h($v): string { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); }
function money($v): string { return number_format((float)$v, 3, ',', ' ') . ' DT'; }

$refNum   = str_pad($r["id"], 7, "0", STR_PAD_LEFT);
$isPaid   = (bool)($r["isPaid"] ?? false);
$statusTxt  = $isPaid ? "PAYÉ" : "À PAYER SUR PLACE";
$statusCls  = $isPaid ? "paid" : "unpaid";
$checkIn    = DateTime::createFromFormat('Y-m-d', $r["checkInDate"]);
$checkOut   = DateTime::createFromFormat('Y-m-d', $r["checkOutDate"]);
$fmtDate    = fn($d) => $d ? $d->format('d/m/Y') : h($r["checkInDate"]);
?>
<?php include "facture.html"; ?>
