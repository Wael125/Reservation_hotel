/* ═══════════════════════════════════════════════════════════
   gestion_transitions.js
   Panneau de notifications admin pour les transitions de statut
   Polling toutes les 60s · Badge · Modal décision
═══════════════════════════════════════════════════════════ */
'use strict';

const TRANS_API = 'transition_decisions.php';

let _transData      = [];
let _transPollTimer = null;
let _transToastTmr  = null;

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
function initTransitionsPanel() {
  _injectTransHTML();
  _bindTransEvents();
  _transPoll();                        // premier appel immédiat
  _transPollTimer = setInterval(_transPoll, 60_000); // toutes les 60s
}

// ═══════════════════════════════════════════════════════════
//  INJECTION HTML dynamique (badge + panel + modal)
// ═══════════════════════════════════════════════════════════
function _injectTransHTML() {
  if (document.getElementById('transPanelOverlay')) return;

  // Badge flottant (coin supérieur droit de la sidebar ou du header)
  const badge = document.createElement('div');
  badge.id        = 'transBadgeWrap';
  badge.innerHTML = `
    <button id="transBadgeBtn" class="trans-badge-btn" title="Transitions en attente" style="display:none;">
      🔔 <span id="transBadgeCount">0</span>
    </button>`;
  document.body.appendChild(badge);

  // Panel latéral / modal liste
  const panel = document.createElement('div');
  panel.id        = 'transPanelOverlay';
  panel.className = 'trans-panel-overlay';
  panel.innerHTML = `
    <div class="trans-panel-box">
      <div class="trans-panel-header">
        <h3>🔔 Transitions en attente</h3>
        <button class="res-modal-close" id="transPanelClose">&times;</button>
      </div>
      <div id="transPanelBody" class="trans-panel-body">
        <p style="color:var(--text-muted);text-align:center;padding:40px 0">Chargement…</p>
      </div>
    </div>`;
  document.body.appendChild(panel);

  // Modal décision (accepter / refuser)
  const modal = document.createElement('div');
  modal.id        = 'transDecisionModal';
  modal.className = 'res-modal-overlay';
  modal.innerHTML = `
    <div class="res-modal-box" style="width:460px;">
      <div class="res-modal-header">
        <h3 id="transDecTitle">Confirmer la transition</h3>
        <button class="res-modal-close" id="transDecClose">&times;</button>
      </div>
      <div id="transDecContent" class="trans-dec-content"></div>
      <div class="res-form-field" style="margin:16px 0 0;">
        <label>Note (optionnelle)</label>
        <input class="res-form-input" id="transDecNote" type="text"
          placeholder="Ex: Client présent à la réception…">
      </div>
      <div class="res-modal-actions">
        <button class="res-btn-cancel" id="transDecReject">🚫 Refuser</button>
        <button class="res-btn-submit" id="transDecAccept">✅ Accepter</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // Toast transitions
  const toast = document.createElement('div');
  toast.id        = 'transGlobalToast';
  toast.className = 'res-toast';
  document.body.appendChild(toast);
}

// ═══════════════════════════════════════════════════════════
//  POLLING
// ═══════════════════════════════════════════════════════════
async function _transPoll() {
  try {
    // ── Étape 1 : déclencher la détection automatique ──
    await fetch(
      'auto_status_transition.php?token=a3f8b2c19d4e7f1a2b3c4d5e6f7a8b9c',
      { cache: 'no-store' }
    ).catch(() => {}); // silencieux si erreur

    // ── Étape 2 : récupérer les transitions pending ──
    const res  = await fetch(TRANS_API, { cache: 'no-store' });
    const data = await res.json();
    if (!data.success) return;

    const prev = _transData.length;
    _transData = data.data || [];

    _transUpdateBadge();

    // Notification si nouvelles transitions apparues
    if (_transData.length > prev && prev >= 0) {
      const diff = _transData.length - prev;
      _transToast(
        `🔔 ${diff} nouvelle${diff > 1 ? 's' : ''} transition${diff > 1 ? 's' : ''} en attente`,
        'info'
      );
    }

    // Refresh du panel s'il est ouvert
    if (document.getElementById('transPanelOverlay')?.classList.contains('open')) {
      _transRenderPanel();
    }
  } catch { /* silencieux en prod */ }
}

// ═══════════════════════════════════════════════════════════
//  BADGE
// ═══════════════════════════════════════════════════════════
function _transUpdateBadge() {
  const btn   = document.getElementById('transBadgeBtn');
  const count = document.getElementById('transBadgeCount');
  const n     = _transData.length;
  if (!btn || !count) return;
  count.textContent = n;
  btn.style.display = n > 0 ? 'flex' : 'none';
  btn.classList.toggle('trans-badge-pulse', n > 0);
}

// ═══════════════════════════════════════════════════════════
//  RENDER PANEL
// ═══════════════════════════════════════════════════════════
function _transRenderPanel() {
  const body = document.getElementById('transPanelBody');
  if (!body) return;

  if (!_transData.length) {
    body.innerHTML = `
      <div style="text-align:center;padding:50px 20px;color:var(--text-muted);">
        <div style="font-size:2.5rem;margin-bottom:12px;opacity:.4">✅</div>
        <p>Aucune transition en attente</p>
      </div>`;
    return;
  }

  body.innerHTML = _transData.map(t => {
    const arrow = `<span class="trans-arrow">${t.from_status} → ${t.to_status}</span>`;
    const cin   = _resFmtDate(t.checkInDate);
    const cout  = _resFmtDate(t.checkOutDate);
    const since = _transFmtAgo(t.triggered_at);

    // Couleur selon transition
    const isCheckIn  = t.to_status === 'Checked_in';
    const isComplete = t.to_status === 'Completé';
    const iconColor  = isCheckIn ? 'var(--teal)' : isComplete ? 'var(--gold)' : 'var(--violet)';
    const icon       = isCheckIn ? '🔑' : isComplete ? '🏁' : '🔄';

    return `
      <div class="trans-card" data-tid="${t.transition_id}">
        <div class="trans-card-left">
          <span class="trans-icon" style="color:${iconColor}">${icon}</span>
        </div>
        <div class="trans-card-body">
          <div class="trans-card-name">${_resEsc(t.clientName)}</div>
          <div class="trans-card-meta">
            Réservation #${t.reservation_id} · ${_resEsc(t.roomType || '')} ${_resEsc(t.roomNumber || '')}
          </div>
          <div class="trans-card-meta">📅 ${cin} → ${cout}</div>
          <div class="trans-card-arrow">${arrow}</div>
          <div class="trans-card-since">⏱ Déclenché ${since}</div>
        </div>
        <div class="trans-card-actions">
          <button class="res-btn-icon confirm"
            onclick="_transOpenDecision(${t.transition_id})"
            title="Décider">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 8 12 12 14 14"/>
            </svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
//  MODAL DÉCISION
// ═══════════════════════════════════════════════════════════
let _currentTransId = null;

function _transOpenDecision(tid) {
  const t = _transData.find(x => String(x.transition_id) === String(tid));
  if (!t) return;
  _currentTransId = tid;

  const isCheckIn  = t.to_status === 'Checked_in';
  const isComplete = t.to_status === 'Completé';

  document.getElementById('transDecTitle').textContent =
    isCheckIn  ? '🔑 Confirmer le Check-in' :
    isComplete ? '🏁 Confirmer le Check-out / Fin de séjour' :
                 '🔄 Confirmer la transition';

  const days = Math.round(
    (new Date(t.checkOutDate) - new Date(t.checkInDate)) / 86400000
  ) || 0;

  document.getElementById('transDecContent').innerHTML = `
    <div class="trans-dec-summary">
      <div class="tds-row">
        <span>Client</span>
        <strong>${_resEsc(t.clientName)}</strong>
      </div>
      <div class="tds-row">
        <span>Email</span>
        <strong>${_resEsc(t.email || '—')}</strong>
      </div>
      <div class="tds-row">
        <span>Téléphone</span>
        <strong>${_resEsc(t.phoneNumber || '—')}</strong>
      </div>
      <div class="tds-row">
        <span>Chambre</span>
        <strong>${_resEsc(t.roomNumber || '—')} · ${_resEsc(t.roomType || '—')}</strong>
      </div>
      <div class="tds-row">
        <span>Séjour</span>
        <strong>${_resFmtDate(t.checkInDate)} → ${_resFmtDate(t.checkOutDate)} (${days} nuit${days>1?'s':''})</strong>
      </div>
      <div class="tds-row">
        <span>Montant</span>
        <strong style="color:var(--gold)">${_resFmtMoney(t.totalPrice)}</strong>
      </div>
      <div class="tds-transition-box">
        <span class="res-badge ${_resStatusMeta(t.from_status).cls}">${_resStatusMeta(t.from_status).label}</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="12 5 19 12 12 19"/>
        </svg>
        <span class="res-badge ${_resStatusMeta(t.to_status).cls}">${_resStatusMeta(t.to_status).label}</span>
      </div>
      <p class="tds-hint">
        ${isCheckIn
          ? '⚠️ Le client est-il bien présent à la réception ?'
          : isComplete
          ? '⚠️ Le client a-t-il bien quitté la chambre ?'
          : '⚠️ Confirmez-vous cette transition ?'}
      </p>
    </div>`;

  document.getElementById('transDecNote').value = '';
  document.getElementById('transDecisionModal')?.classList.add('open');
}

async function _transDecide(decision) {
  if (!_currentTransId) return;

  const note    = document.getElementById('transDecNote')?.value.trim() || '';
  const acceptBtn = document.getElementById('transDecAccept');
  const rejectBtn = document.getElementById('transDecReject');
  if (acceptBtn) { acceptBtn.disabled = true; acceptBtn.textContent = '⏳…'; }
  if (rejectBtn) { rejectBtn.disabled = true; }

  try {
    const res  = await fetch(TRANS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition_id: _currentTransId, decision, note }),
    });
    const data = await res.json();

    if (!data.success) throw new Error(data.error);

    document.getElementById('transDecisionModal')?.classList.remove('open');
    _currentTransId = null;

    if (decision === 'accepted') {
      _transToast('✅ ' + data.message, 'success');
    } else {
      _transToast('🚫 Transition refusée — statut inchangé', 'info');
    }

    // Refresh données partout
    await _transPoll();
    if (typeof loadReservations === 'function') await loadReservations();
    if (typeof loadHistorique   === 'function') await loadHistorique();

  } catch (err) {
    _transToast('❌ ' + err.message, 'error');
  } finally {
    if (acceptBtn) { acceptBtn.disabled = false; acceptBtn.innerHTML = '✅ Accepter'; }
    if (rejectBtn) { rejectBtn.disabled = false; }
  }
}

// ═══════════════════════════════════════════════════════════
//  BINDS
// ═══════════════════════════════════════════════════════════
function _bindTransEvents() {
  document.addEventListener('click', e => {
    const btn = e.target.closest('#transBadgeBtn');
    if (btn) {
      document.getElementById('transPanelOverlay')?.classList.add('open');
      _transRenderPanel();
    }
  });

  document.getElementById('transPanelClose')?.addEventListener('click', () => {
    document.getElementById('transPanelOverlay')?.classList.remove('open');
  });

  document.getElementById('transPanelOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('transPanelOverlay'))
      document.getElementById('transPanelOverlay').classList.remove('open');
  });

  document.getElementById('transDecClose')?.addEventListener('click', () => {
    document.getElementById('transDecisionModal')?.classList.remove('open');
  });

  document.getElementById('transDecAccept')?.addEventListener('click', () => _transDecide('accepted'));
  document.getElementById('transDecReject')?.addEventListener('click', () => _transDecide('rejected'));
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
function _transFmtAgo(dt) {
  if (!dt) return '—';
  const diff = Math.floor((Date.now() - new Date(dt)) / 1000);
  if (diff < 60)   return 'à l\'instant';
  if (diff < 3600) return `il y a ${Math.floor(diff/60)} min`;
  if (diff < 86400)return `il y a ${Math.floor(diff/3600)}h`;
  return `il y a ${Math.floor(diff/86400)} j`;
}

function _transToast(msg, type = 'success') {
  const t = document.getElementById('transGlobalToast');
  if (!t) return;
  clearTimeout(_transToastTmr);
  t.textContent = msg;
  t.className   = `res-toast ${type} show`;
  _transToastTmr = setTimeout(() => t.classList.remove('show'), 4000);
}