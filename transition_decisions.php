<?php
/**
 * transition_decisions.php
 * ──────────────────────────────────────────────────────────────────
 * API pour gérer les décisions admin sur les transitions de statut.
 *
 * GET  → liste des transitions en attente (admin_decision = 'pending')
 * POST → { transition_id, decision: 'accepted'|'rejected', note? }
 *         Si accepted : met à jour le Status de la réservation
 *         Si rejected : marque comme rejeté, aucun changement
 * ──────────────────────────────────────────────────────────────────
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

session_start();
require_once 'db.php';

// ── Auth admin ────────────────────────────────────────────
if (!isset($_SESSION['login_id']) || ($_SESSION['role'] ?? 'client') !== 'admin') {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Accès refusé']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

// ── GET : transitions en attente ──────────────────────────
if ($method === 'GET') {
    try {
        $stmt = $pdo->query("
            SELECT
                t.id              AS transition_id,
                t.reservation_id,
                t.from_status,
                t.to_status,
                t.triggered_at,
                t.admin_decision,
                r.clientName,
                r.email,
                r.phoneNumber,
                r.checkInDate,
                r.checkOutDate,
                r.roomType,
                r.roomNumber,
                r.totalPrice,
                r.Status          AS current_status
            FROM reservation_transitions t
            JOIN reservation r ON r.id = t.reservation_id
            WHERE t.admin_decision = 'pending'
            ORDER BY t.triggered_at ASC
        ");
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        echo json_encode([
            'success' => true,
            'count'   => count($rows),
            'data'    => $rows,
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

// ── POST : prendre une décision ───────────────────────────
if ($method === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);

    $transitionId = isset($data['transition_id']) ? (int)$data['transition_id'] : null;
    $decision     = trim($data['decision'] ?? '');
    $note         = trim($data['note']     ?? '');

    if (!$transitionId) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'transition_id manquant']);
        exit;
    }
    if (!in_array($decision, ['accepted', 'rejected'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Décision invalide (accepted|rejected)']);
        exit;
    }

    try {
        // Charger la transition
        $t = $pdo->prepare("SELECT * FROM reservation_transitions WHERE id = ? AND admin_decision = 'pending'");
        $t->execute([$transitionId]);
        $transition = $t->fetch(PDO::FETCH_ASSOC);

        if (!$transition) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Transition introuvable ou déjà traitée']);
            exit;
        }

        $pdo->beginTransaction();

        // Marquer la décision
        $upd = $pdo->prepare("
            UPDATE reservation_transitions
            SET admin_decision = :dec,
                decided_at     = NOW(),
                admin_note     = :note
            WHERE id = :id
        ");
        $upd->execute([
            ':dec'  => $decision,
            ':note' => $note ?: null,
            ':id'   => $transitionId,
        ]);

        $message = '';

        // Si accepté → changer le statut de la réservation
        if ($decision === 'accepted') {
            // Vérifier que le statut courant n'a pas déjà changé
            $chk = $pdo->prepare("SELECT Status FROM reservation WHERE id = ?");
            $chk->execute([$transition['reservation_id']]);
            $current = $chk->fetchColumn();

            if ($current !== $transition['from_status']) {
                $pdo->rollBack();
                echo json_encode([
                    'success' => false,
                    'error'   => "Le statut de la réservation a déjà changé ({$current}). Transition annulée.",
                ]);
                exit;
            }

            $set = $pdo->prepare("UPDATE reservation SET Status = ? WHERE id = ?");
            $set->execute([$transition['to_status'], $transition['reservation_id']]);
            $message = "Réservation #{$transition['reservation_id']} passée à « {$transition['to_status']} »";
        } else {
            $message = "Transition refusée — réservation #{$transition['reservation_id']} conserve le statut « {$transition['from_status']} »";
        }

        $pdo->commit();

        echo json_encode([
            'success'        => true,
            'message'        => $message,
            'transition_id'  => $transitionId,
            'decision'       => $decision,
            'reservation_id' => $transition['reservation_id'],
            'new_status'     => $decision === 'accepted' ? $transition['to_status'] : $transition['from_status'],
        ]);

    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Méthode non autorisée']);