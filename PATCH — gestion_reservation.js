/* ═══════════════════════════════════════════════════════════
   PATCH — gestion_reservation.js
   À AJOUTER / REMPLACER dans le fichier existant.

   1. Filtrer les statuts "actifs" uniquement dans la vue Réservations
   2. Adapter les statuts du filtre dropdown
═══════════════════════════════════════════════════════════ */

// ── Statuts ACTIFS (vue Réservations principale) ──────────
// REMPLACER la constante RES_STATUSES existante par :
const RES_STATUSES_ACTIVE = [
  'En attente',
  'Confirmée',
  'Checked_in',
  'Checked_out',   // checked_out reste visible car peut nécessiter action manuelle
];

// ── Statuts TERMINAUX (vue Historique) ────────────────────
// Déjà dans gestion_historique.js :
// const HIST_STATUSES = ['Annulé', 'Refusé', 'Completé'];

/* ──────────────────────────────────────────────────────────
   REMPLACER la fonction loadReservations() existante par :
────────────────────────────────────────────────────────── */
async function loadReservations() {
  _resShowLoading(true);
  try {
    const res  = await fetch(RES_API, { cache: 'no-store' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erreur API');

    // ★ FILTRE CÔTÉ CLIENT : uniquement les statuts actifs
    _resAll = (data.data || []).filter(r =>
      RES_STATUSES_ACTIVE.includes(r.Status)
    );

    _populateResFilterDropdowns(
      RES_STATUSES_ACTIVE,   // ← liste statuts filtrée
      data.room_types || []
    );
    _resApplyFilters();
  } catch (err) {
    console.error('[Reservations]', err);
    _resShowTableError(err.message);
  } finally {
    _resShowLoading(false);
  }
}

/* ──────────────────────────────────────────────────────────
   REMPLACER _buildFormSelects() — section statuts formulaire
   (uniquement les statuts actifs dans le formulaire d'ajout/modif)
────────────────────────────────────────────────────────── */
function _buildFormSelects_PATCHED() {
  // ... (garder Types chambre et Modes paiement identiques)

  // Statuts dans le formulaire → uniquement statuts actifs
  const statEl = _resEl('resFormStatus');
  if (statEl && statEl.tagName === 'SELECT') {
    statEl.innerHTML = '';
    const statusLabels = {
      'En attente':  '⏳ En attente',
      'Confirmée':   '✅ Confirmée',
      'Checked_in':  '🔑 Checked in',
      'Checked_out': '🚪 Checked out',
    };
    RES_STATUSES_ACTIVE.forEach(s => {
      const o = document.createElement('option');
      o.value       = s;
      o.textContent = statusLabels[s] || s;
      statEl.appendChild(o);
    });
  }
}

/* ──────────────────────────────────────────────────────────
   REMPLACER _resStatusMeta() pour inclure TOUS les statuts
   (nécessaire car utilisée aussi dans l'historique)
────────────────────────────────────────────────────────── */
function _resStatusMeta(s) {
  const k = String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'');

  if (k === 'confirmee'   || k === 'confirmée')                   return { cls: 'confirmée',   label: 'Confirmée'   };
  if (k === 'en attente'  || k === 'pending')                     return { cls: 'pending',     label: 'En attente'  };
  if (['annule','annulee','cancelled','canceled','annulé'].includes(k))
                                                                  return { cls: 'cancelled',   label: 'Annulé'      };
  if (k === 'refuse'      || k === 'refusé')                      return { cls: 'refused',     label: 'Refusé'      };
  if (k === 'checked_in'  || k === 'checked in')                  return { cls: 'checked_in',  label: 'Checked in'  };
  if (k === 'checked_out' || k === 'checked out')                 return { cls: 'checked_out', label: 'Checked out' };
  if (k === 'complete'    || k === 'completé' || k === 'completed')
                                                                  return { cls: 'completed',   label: 'Completé'    };
  return { cls: k.replace(/\s+/g,'_'), label: s || '—' };
}

/* ══════════════════════════════════════════════════════════
   INTÉGRATION DANS kpi.js (ou le fichier principal)
   Ajouter ces appels dans la fonction d'initialisation :
══════════════════════════════════════════════════════════ */
/*
  // Dans la fonction qui gère le changement de vue :
  case 'reservations':
    loadReservations();
    break;

  case 'historique':
    loadHistorique();          // gestion_historique.js
    break;

  // Au démarrage de l'app admin :
  initTransitionsPanel();      // gestion_transitions.js
  // Lance automatiquement le polling toutes les 60 secondes
*/

/* ══════════════════════════════════════════════════════════
   NAVIGATION — Ajouter dans le menu sidebar (kpi.html)
   Exemple de lien à ajouter après "Réservations" :
══════════════════════════════════════════════════════════ */
/*
  <li class="nav-item" data-view="historique">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
    Historique
  </li>
*/

/* ══════════════════════════════════════════════════════════
   <link> ET <script> À AJOUTER DANS kpi.html :
══════════════════════════════════════════════════════════ */
/*
  <link rel="stylesheet" href="gestion_historique.css">

  <script src="gestion_historique.js"></script>
  <script src="gestion_transitions.js"></script>
*/

/* ══════════════════════════════════════════════════════════
   CRON (crontab -e) :
   Vérification toutes les 30 minutes
══════════════════════════════════════════════════════════ */
/*
  # ┌────────── minute (0-59)
  # │  ┌─────── heure (0-23)
  # │  │  ┌──── jour du mois (1-31)
  # │  │  │  ┌─ mois (1-12)
  # │  │  │  │  ┌── jour semaine (0-7)
  # *  *  *  *  *  commande
  30 * * * * php /var/www/html/auto_status_transition.php >> /var/log/hotel_cron.log 2>&1
  0  12 * * * php /var/www/html/auto_status_transition.php >> /var/log/hotel_cron.log 2>&1
*/