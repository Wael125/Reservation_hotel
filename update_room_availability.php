<?php
/**
 * update_room_availability.php
 * ─────────────────────────────────────────────────────────
 * Met à jour automatiquement la disponibilité des chambres
 * selon les réservations actives du jour.
 *
 * Règles :
 *   • checkInDate  <= TODAY  ET checkOutDate  > TODAY  → "Occupied"
 *   • checkOutDate <= TODAY  (séjour terminé)           → "Available"
 *   • Aucune réservation active                         → "Available"
 *
 * Usage :
 *   1. CRON quotidien à minuit :
 *      0 0 * * * php /var/www/html/reservation_hotel/update_room_availability.php
 *
 *   2. OU inclure en haut de kpi.php / dashboard.php :
 *      require_once 'update_room_availability.php';
 * ─────────────────────────────────────────────────────────
 */

require_once __DIR__ . '/db.php'; // connexion $pdo

/**
 * Met à jour la disponibilité de toutes les chambres.
 * Retourne un résumé des changements effectués.
 */
function syncRoomAvailability(PDO $pdo): array
{
    $today   = date('Y-m-d');
    $summary = ['occupé' => 0, 'disponible' => 0, 'errors' => []];

    try {
        // ── 1. Chambres à passer en "Occupied" ───────────────
        // Réservation confirmée ou en attente dont le check-in est aujourd'hui
        // ou déjà passé ET le check-out n'est pas encore arrivé.
        $sqlOccupy = "
            UPDATE room r
            INNER JOIN reservation res
                ON  res.roomNumber = r.roomnumber
                AND DATE(res.checkInDate)  <= :today
                AND DATE(res.checkOutDate) >  :today2
                AND LOWER(COALESCE(res.Status,'')) NOT IN ('annulé','annule','annulee','cancelled','canceled')
            SET r.availability = 'Occupé'
            WHERE r.availability != 'Occupé'
        ";

        $stmt = $pdo->prepare($sqlOccupy);
        $stmt->execute([':today' => $today, ':today2' => $today]);
        $summary['occupé'] = $stmt->rowCount();

        // ── 2. Chambres à remettre en "Available" ────────────
        // Aucune réservation active aujourd'hui → chambre libre.
        // On ne touche PAS les chambres en "Maintenance".
        $sqlFree = "
            UPDATE room r
            SET r.availability = 'Disponible'
            WHERE r.availability = 'Occupé'
              AND r.roomnumber NOT IN (
                  SELECT DISTINCT res.roomNumber
                  FROM reservation res
                  WHERE DATE(res.checkInDate)  <= :today
                    AND DATE(res.checkOutDate) >  :today2
                    AND LOWER(COALESCE(res.Status,'')) NOT IN ('annulé','annule','annulee','cancelled','canceled')
              )
        ";

        $stmt2 = $pdo->prepare($sqlFree);
        $stmt2->execute([':today' => $today, ':today2' => $today]);
        $summary['disponible'] = $stmt2->rowCount();

    } catch (PDOException $e) {
        $summary['errors'][] = $e->getMessage();
        error_log('[syncRoomAvailability] ' . $e->getMessage());
    }

    return $summary;
}

// ── Exécution directe (CRON ou appel direct) ─────────────
// Si le fichier est appelé directement (pas inclus), on affiche un résumé.
if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $result = syncRoomAvailability($pdo);

    // Réponse JSON si appelé en CLI ou via fetch()
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success'   => empty($result['errors']),
        'date'      => date('Y-m-d H:i:s'),
        'occupé'  => $result['occupé'],
        'disponible' => $result['disponible'],
        'errors'    => $result['errors'],
        'message'   => sprintf(
            '%d chambre(s) → Occupé, %d chambre(s) → Disponible',
            $result['occupé'],
            $result['disponible']
        ),
    ]);
    exit;
}

// Si inclus dans un autre fichier : on exécute silencieusement
syncRoomAvailability($pdo);