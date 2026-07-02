/* ═══════════════════════════════════════════════════════════
   gestion_transitions.js
   Cloche de notifications admin unifiée :
     • Transitions de statut (check-in / check-out à confirmer)
     • Arrivées & départs du jour
     • Nouvelles réclamations
     • Nouveaux clients
     • Nouvelles réservations
   Polling toutes les 60s · Badge · Panel latéral · Modal décision
═══════════════════════════════════════════════════════════ */
'use strict';

const TRANS_API  = 'transition_decisions.php';
const NOTIF_API  = 'dashboard_admin.php?action=notifications';

// ── État global ──────────────────────────────────────────
let _transData      = [];   // transitions pending (décision requise)
let _notifData      = {     // données cloche
  today_events  : [],
  reservations  : [],
  clients       : [],
  reclamations  : [],
};
let _transPollTimer = null;
let _transToastTmr  = null;
let _currentTransId = null;

// ── Active tab dans le panel ─────────────────────────────
let _activeTab = 'notifs'; // 'notifs' | 'transitions'

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
function initTransitionsPanel() {
  console.log('✅ initTransitionsPanel() appelée');
  _injectTransHTML();
  _bindTransEvents();
  _fullPoll();
  _transPollTimer = setInterval(_fullPoll, 30_000);
  console.log('✅ Cloche initialisée, polling toutes les 30s');
}

// ═══════════════════════════════════════════════════════════
//  INJECTION HTML
// ═══════════════════════════════════════════════════════════
function _injectTransHTML() {
  if (document.getElementById('uniPanelOverlay')) {
    console.log('ℹ️ Panel déjà créé, on saute _injectTransHTML');
    return;
  }

  /* ── Badge flottant (topbar) ── */
  const badgeWrap = document.createElement('div');
  badgeWrap.id        = 'uniBadgeWrap';
  badgeWrap.innerHTML = `
    <button id="uniBadgeBtn" class="uni-badge-btn" title="Notifications" style="display:none;">
      🔔 <span id="uniBadgeCount" class="uni-badge-count">0</span>
    </button>`;
  /* On insère dans .topbar-right si elle existe, sinon en body */
  const topbarRight = document.querySelector('.topbar-right');
  if (topbarRight) {
    topbarRight.insertBefore(badgeWrap, topbarRight.firstChild);
    console.log('✅ Badge inséré dans .topbar-right');
  } else {
    document.body.appendChild(badgeWrap);
    console.log('⚠️ .topbar-right non trouvé, badge ajouté au body');
  }

  /* ── Panel latéral ── */
  const panel = document.createElement('div');
  panel.id        = 'uniPanelOverlay';
  panel.className = 'uni-panel-overlay';
  panel.innerHTML = `
    <div class="uni-panel-box">

      <div class="uni-panel-header">
        <h3>🔔 Notifications</h3>
        <button class="res-modal-close" id="uniPanelClose">&times;</button>
      </div>

      <!-- Onglets -->
      <div class="uni-tabs">
        <button class="uni-tab active" data-tab="notifs">
          Activités
          <span class="uni-tab-badge" id="tabBadgeNotifs">0</span>
        </button>
        <button class="uni-tab" data-tab="transitions">
          À confirmer
          <span class="uni-tab-badge accent" id="tabBadgeTrans">0</span>
        </button>
      </div>

      <!-- Corps onglet Activités -->
      <div class="uni-panel-body" id="uniPanelBodyNotifs">
        <p class="uni-loading">Chargement…</p>
      </div>

      <!-- Corps onglet Transitions -->
      <div class="uni-panel-body" id="uniPanelBodyTrans" style="display:none;">
        <p class="uni-loading">Chargement…</p>
      </div>

    </div>`;
  document.body.appendChild(panel);

  /* ── Modal décision transition ── */
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
          placeholder="Ex : Client présent à la réception…">
      </div>
      <div class="res-modal-actions">
        <button class="res-btn-cancel" id="transDecReject">🚫 Refuser</button>
        <button class="res-btn-submit" id="transDecAccept">✅ Accepter</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  /* ── Toast ── */
  const toast = document.createElement('div');
  toast.id        = 'transGlobalToast';
  toast.className = 'res-toast';
  document.body.appendChild(toast);

  /* ── Styles inlinés ── */
  _injectStyles();
  
  console.log('✅ HTML et styles injectés avec succès');
}

// ═══════════════════════════════════════════════════════════
//  STYLES DYNAMIQUES
// ═══════════════════════════════════════════════════════════
function _injectStyles() {
  if (document.getElementById('uniPanelStyles')) return;
  const s = document.createElement('style');
  s.id = 'uniPanelStyles';
  s.textContent = `
    /* ── Badge bouton ── */
    #uniBadgeWrap { display:flex; align-items:center; }
    .uni-badge-btn {
      display: flex; align-items: center; gap: 6px;
      padding: 7px 14px; border-radius: 8px;
      background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.07);
      color: var(--text-muted,#6b7280); font-size: .78rem; cursor: pointer;
      transition: .2s; font-family: inherit; position: relative;
    }
    .uni-badge-btn:hover { background: rgba(255,255,255,.1); color: var(--text,#eceef2); }
    .uni-badge-count {
      background: var(--rose,#e07b8a); color: #fff; border-radius: 10px;
      padding: 1px 6px; font-size: .65rem; font-weight: 700; min-width: 18px;
      text-align: center;
    }
    .uni-badge-btn.uni-pulse .uni-badge-count {
      animation: uniPulse 1.2s ease-in-out infinite;
    }
    @keyframes uniPulse {
      0%,100% { transform: scale(1); }
      50%      { transform: scale(1.2); }
    }

    /* ── Panel overlay ── */
    .uni-panel-overlay {
      position: fixed; inset: 0; z-index: 1100;
      background: rgba(0,0,0,.45); backdrop-filter: blur(4px);
      opacity: 0; pointer-events: none;
      transition: opacity .25s;
    }
    .uni-panel-overlay.open {
      opacity: 1; pointer-events: all;
    }
    .uni-panel-box {
      position: absolute; top: 0; right: 0; bottom: 0;
      width: 420px; max-width: 100vw;
      background: var(--bg-card,#1c2130);
      border-left: 1px solid rgba(255,255,255,.07);
      display: flex; flex-direction: column;
      transform: translateX(100%);
      transition: transform .3s cubic-bezier(.4,0,.2,1);
      box-shadow: -8px 0 32px rgba(0,0,0,.5);
    }
    .uni-panel-overlay.open .uni-panel-box {
      transform: translateX(0);
    }

    /* ── Header panel ── */
    .uni-panel-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 18px 20px 14px;
      border-bottom: 1px solid rgba(255,255,255,.07);
      flex-shrink: 0;
    }
    .uni-panel-header h3 { font-size: .95rem; font-weight: 700; color: var(--text,#eceef2); }

    /* ── Onglets ── */
    .uni-tabs {
      display: flex; gap: 4px; padding: 10px 14px 0;
      border-bottom: 1px solid rgba(255,255,255,.07);
      flex-shrink: 0;
    }
    .uni-tab {
      flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
      padding: 8px 10px; border-radius: 8px 8px 0 0;
      background: transparent; border: 1px solid transparent; border-bottom: none;
      color: var(--text-muted,#6b7280); font-size: .78rem; font-weight: 500;
      cursor: pointer; font-family: inherit; transition: .2s;
    }
    .uni-tab:hover { background: rgba(255,255,255,.04); color: var(--text,#eceef2); }
    .uni-tab.active {
      background: rgba(255,255,255,.05); color: var(--text,#eceef2);
      border-color: rgba(255,255,255,.07); border-bottom-color: var(--bg-card,#1c2130);
      margin-bottom: -1px; position: relative; z-index: 1;
    }
    .uni-tab-badge {
      background: rgba(255,255,255,.12); color: var(--text-muted,#6b7280);
      border-radius: 10px; padding: 1px 6px; font-size: .62rem; font-weight: 700;
    }
    .uni-tab-badge.accent {
      background: rgba(224,123,138,.2); color: var(--rose,#e07b8a);
    }

    /* ── Corps ── */
    .uni-panel-body {
      flex: 1; overflow-y: auto;
      scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.07) transparent;
    }
    .uni-loading {
      color: var(--text-muted,#6b7280); text-align: center; padding: 40px 20px; font-size: .82rem;
    }

    /* ── Groupe de notifications ── */
    .uni-group-label {
      font-size: .62rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: .7px; color: var(--text-muted,#6b7280);
      padding: 14px 16px 6px; position: sticky; top: 0;
      background: var(--bg-card,#1c2130); z-index: 1;
    }

    /* ── Item notification ── */
    .uni-notif-item {
      display: flex; gap: 10px; padding: 12px 16px;
      border-bottom: 1px solid rgba(255,255,255,.03);
      transition: background .15s; cursor: default;
    }
    .uni-notif-item:hover { background: rgba(255,255,255,.03); }
    .uni-notif-item.urgent { border-left: 3px solid var(--rose,#e07b8a); }
    .uni-notif-icon {
      font-size: 1.1rem; flex-shrink: 0; margin-top: 1px;
      width: 28px; height: 28px; border-radius: 8px;
      background: rgba(255,255,255,.05);
      display: flex; align-items: center; justify-content: center;
    }
    .uni-notif-body { flex: 1; min-width: 0; }
    .uni-notif-badge {
      display: inline-block; font-size: .6rem; font-weight: 700;
      padding: 1px 6px; border-radius: 6px; text-transform: uppercase;
      letter-spacing: .3px; margin-bottom: 3px;
    }
    .uni-notif-badge.badge-checkin  { background: rgba(78,205,196,.15);  color: var(--teal,#4ecdc4); }
    .uni-notif-badge.badge-checkout { background: rgba(155,143,232,.15); color: var(--violet,#9b8fe8); }
    .uni-notif-badge.badge-rec-high { background: rgba(224,123,138,.2);  color: var(--rose,#e07b8a); }
    .uni-notif-badge.badge-rec-med  { background: rgba(244,162,97,.2);   color: var(--orange,#f4a261); }
    .uni-notif-badge.badge-rec-low  { background: rgba(107,203,139,.15); color: var(--green,#6bcb8b); }
    .uni-notif-badge.badge-res      { background: rgba(201,165,90,.15);  color: var(--gold,#c9a55a); }
    .uni-notif-badge.badge-cli      { background: rgba(78,205,196,.12);  color: var(--teal,#4ecdc4); }
    .uni-notif-title {
      font-size: .8rem; font-weight: 600; color: var(--text,#eceef2);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .uni-notif-sub {
      font-size: .72rem; color: var(--text-muted,#6b7280); margin-top: 2px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .uni-notif-time {
      font-size: .63rem; color: var(--text-muted,#6b7280);
      flex-shrink: 0; margin-top: 2px; white-space: nowrap;
    }
    .uni-empty {
      text-align: center; padding: 50px 20px;
      color: var(--text-muted,#6b7280); font-size: .82rem;
    }
    .uni-empty-icon { font-size: 2.2rem; opacity: .3; margin-bottom: 10px; }

    /* ── Carte transition ── */
    .trans-card {
      display: flex; gap: 12px; padding: 14px 16px;
      border-bottom: 1px solid rgba(255,255,255,.04);
      transition: background .15s;
    }
    .trans-card:hover { background: rgba(255,255,255,.03); }
    .trans-card-left { display: flex; align-items: flex-start; padding-top: 2px; }
    .trans-icon { font-size: 1.3rem; }
    .trans-card-body { flex: 1; min-width: 0; }
    .trans-card-name  { font-size: .84rem; font-weight: 600; color: var(--text,#eceef2); }
    .trans-card-meta  { font-size: .72rem; color: var(--text-muted,#6b7280); margin-top: 2px; }
    .trans-card-arrow { margin-top: 5px; }
    .trans-arrow      { font-size: .72rem; color: var(--text-sub,#9ca3af); font-weight: 500; }
    .trans-card-since { font-size: .68rem; color: var(--text-muted,#6b7280); margin-top: 3px; }
    .trans-card-actions { display: flex; align-items: center; }
    .res-btn-icon {
      width: 30px; height: 30px; border-radius: 8px; border: none;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: .2s; font-family: inherit;
    }
    .res-btn-icon.confirm {
      background: rgba(201,165,90,.12); color: var(--gold,#c9a55a);
    }
    .res-btn-icon.confirm:hover { background: rgba(201,165,90,.25); }

    /* ── Résumé décision ── */
    .trans-dec-content { padding: 0; }
    .trans-dec-summary { padding: 0; }
    .tds-row {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.04);
      font-size: .82rem;
    }
    .tds-row span { color: var(--text-muted,#6b7280); }
    .tds-row strong { color: var(--text,#eceef2); }
    .tds-transition-box {
      display: flex; align-items: center; justify-content: center; gap: 12px;
      margin: 14px 0 10px; padding: 12px;
      background: rgba(255,255,255,.03); border-radius: 10px;
    }
    .tds-hint {
      font-size: .78rem; color: var(--gold,#c9a55a); margin-top: 10px;
      padding: 8px 12px; border-radius: 8px;
      background: rgba(201,165,90,.07); border: 1px solid rgba(201,165,90,.15);
    }
  `;
  document.head.appendChild(s);
}

// ═══════════════════════════════════════════════════════════
//  POLLING UNIFIÉ
// ═══════════════════════════════════════════════════════════
async function _fullPoll() {
  await Promise.allSettled([_pollTransitions(), _pollNotifications()]);
  _updateBadge();
  if (document.getElementById('uniPanelOverlay')?.classList.contains('open')) {
    _renderActiveTab();
  }
}

async function _pollTransitions() {
  try {
    await fetch(
      'auto_status_transition.php?token=a3f8b2c19d4e7f1a2b3c4d5e6f7a8b9c',
      { cache: 'no-store' }
    ).catch(() => {});

    const res  = await fetch(TRANS_API, { cache: 'no-store' });
    const data = await res.json();
    if (!data.success) return;

    const prev = _transData.length;
    _transData = data.data || [];

    if (_transData.length > prev && prev >= 0) {
      const diff = _transData.length - prev;
      _transToast(
        `🔔 ${diff} nouvelle${diff > 1 ? 's' : ''} transition${diff > 1 ? 's' : ''} en attente`,
        'info'
      );
    }
  } catch { /* silencieux */ }
}

async function _pollNotifications() {
  try {
    const res  = await fetch(NOTIF_API, { cache: 'no-store', credentials: 'include' });
    if (!res.ok) {
      console.warn('⚠️ Polling notifications — Erreur HTTP:', res.status);
      return;
    }
    const data = await res.json();
    if (!data.success) {
      console.warn('⚠️ Polling notifications — API error:', data.error);
      return;
    }
    _notifData = {
      today_events : data.today_events  || [],
      reservations : data.reservations  || [],
      clients      : data.clients       || [],
      reclamations : data.reclamations  || [],
    };
    console.log('✅ Notifications chargées:', {
      today_events: _notifData.today_events.length,
      reservations: _notifData.reservations.length,
      clients: _notifData.clients.length,
      reclamations: _notifData.reclamations.length,
    });
  } catch (e) {
    console.error('❌ Erreur polling notifications:', e);
  }
}

// ═══════════════════════════════════════════════════════════
//  BADGE GLOBAL
// ═══════════════════════════════════════════════════════════
function _updateBadge() {
  const btn   = document.getElementById('uniBadgeBtn');
  const count = document.getElementById('uniBadgeCount');
  if (!btn || !count) return;

  const nNotifs =
    _notifData.today_events.length  +
    _notifData.reservations.length  +
    _notifData.clients.length       +
    _notifData.reclamations.length;
  const nTrans = _transData.length;
  const total  = nNotifs + nTrans;

  count.textContent = total > 99 ? '99+' : total;
  btn.style.display = total > 0 ? 'flex' : 'none';
  btn.classList.toggle('uni-pulse', total > 0);

  // ── Mettre à jour les badges des onglets ──
  const badgeNotifs = document.getElementById('tabBadgeNotifs');
  const badgeTrans  = document.getElementById('tabBadgeTrans');
  if (badgeNotifs) badgeNotifs.textContent = nNotifs > 99 ? '99+' : nNotifs;
  if (badgeTrans)  badgeTrans.textContent  = nTrans  > 99 ? '99+' : nTrans;
}

// ═══════════════════════════════════════════════════════════
//  RENDER — dispatch selon onglet actif
// ═══════════════════════════════════════════════════════════
function _renderActiveTab() {
  if (_activeTab === 'notifs')      _renderNotifs();
  else                              _renderTransitions();
}

// ─────────────────────────────────────────────────────────
//  RENDER — Activités (notifications)
// ─────────────────────────────────────────────────────────
function _renderNotifs() {
  const body = document.getElementById('uniPanelBodyNotifs');
  if (!body) {
    console.warn('⚠️ #uniPanelBodyNotifs non trouvé');
    return;
  }

  const { today_events, reservations, clients, reclamations } = _notifData;
  const totalItems = today_events.length + reservations.length + clients.length + reclamations.length;

  console.log('🎨 Rendu _renderNotifs:', {
    today_events: today_events.length,
    reservations: reservations.length,
    clients: clients.length,
    reclamations: reclamations.length,
    totalItems: totalItems
  });

  if (!totalItems) {
    body.innerHTML = `
      <div class="uni-empty">
        <div class="uni-empty-icon">🔔</div>
        <p>Aucune activité récente</p>
      </div>`;
    return;
  }

  let html = '';

  /* ── Check-in / Check-out du jour ── */
  const checkins  = today_events.filter(e => e.event_type === 'checkin');
  const checkouts = today_events.filter(e => e.event_type === 'checkout');

  if (checkins.length) {
    html += `<div class="uni-group-label">🛬 Arrivées aujourd'hui (${checkins.length})</div>`;
    checkins.forEach(ev => {
      html += _notifItem({
        icon   : '🔑',
        badge  : '<span class="uni-notif-badge badge-checkin">Check-in</span>',
        title  : `#${ev.id} — ${_resEsc(ev.clientName || '—')}`,
        sub    : `${ev.roomType || ''} · Chambre ${ev.roomNumber || '?'}`,
        time   : ev.checkInDate,
        urgent : true,
      });
    });
  }

  if (checkouts.length) {
    html += `<div class="uni-group-label">🛫 Départs aujourd'hui (${checkouts.length})</div>`;
    checkouts.forEach(ev => {
      html += _notifItem({
        icon   : '🚪',
        badge  : '<span class="uni-notif-badge badge-checkout">Check-out</span>',
        title  : `#${ev.id} — ${_resEsc(ev.clientName || '—')}`,
        sub    : `${ev.roomType || ''} · Chambre ${ev.roomNumber || '?'}`,
        time   : ev.checkOutDate,
        urgent : false,
      });
    });
  }

  /* ── Réclamations ── */
  if (reclamations.length) {
    html += `<div class="uni-group-label">⚠️ Réclamations récentes (${reclamations.length})</div>`;
    reclamations.forEach(rec => {
      const cls   = rec.priorite === 'Élevée' ? 'badge-rec-high'
                  : rec.priorite === 'Moyenne' ? 'badge-rec-med' : 'badge-rec-low';
      const icon  = rec.priorite === 'Élevée' ? '🔴' : rec.priorite === 'Moyenne' ? '🟠' : '🟢';
      html += _notifItem({
        icon   : icon,
        badge  : `<span class="uni-notif-badge ${cls}">${rec.priorite || 'Réclamation'}</span>`,
        title  : `#${rec.id} — ${_resEsc(rec.clientName || 'Client')}`,
        sub    : (rec.description || '').substring(0, 55) + ((rec.description || '').length > 55 ? '…' : ''),
        time   : rec.created_at,
        urgent : rec.priorite === 'Élevée',
      });
    });
  }

  /* ── Nouvelles réservations ── */
  if (reservations.length) {
    html += `<div class="uni-group-label">📋 Nouvelles réservations (${reservations.length})</div>`;
    reservations.forEach(r => {
      html += _notifItem({
        icon  : '📅',
        badge : '<span class="uni-notif-badge badge-res">Réservation</span>',
        title : `#${r.id} — ${_resEsc(r.clientName || '—')}`,
        sub   : `${r.roomType || '?'} · ${_resFmtMoney ? _resFmtMoney(r.totalPrice) : r.totalPrice + ' TND'}`,
        time  : r.createdAt,
      });
    });
  }

  /* ── Nouveaux clients ── */
  if (clients.length) {
    html += `<div class="uni-group-label">👥 Nouveaux clients (${clients.length})</div>`;
    clients.forEach(c => {
      const name = [c.noml, c.prenom].filter(Boolean).join(' ') || '—';
      html += _notifItem({
        icon  : '👤',
        badge : '<span class="uni-notif-badge badge-cli">Client</span>',
        title : _resEsc(name),
        sub   : c.email || '',
        time  : c.created_at,
      });
    });
  }

  body.innerHTML = html;
}

function _notifItem({ icon, badge, title, sub, time, urgent = false }) {
  return `
    <div class="uni-notif-item${urgent ? ' urgent' : ''}">
      <div class="uni-notif-icon">${icon}</div>
      <div class="uni-notif-body">
        ${badge}
        <div class="uni-notif-title">${title}</div>
        ${sub ? `<div class="uni-notif-sub">${sub}</div>` : ''}
      </div>
      <div class="uni-notif-time">${_transFmtAgo(time)}</div>
    </div>`;
}

// ─────────────────────────────────────────────────────────
//  RENDER — Transitions (à confirmer)
// ─────────────────────────────────────────────────────────
function _renderTransitions() {
  const body = document.getElementById('uniPanelBodyTrans');
  if (!body) return;

  if (!_transData.length) {
    body.innerHTML = `
      <div class="uni-empty">
        <div class="uni-empty-icon">✅</div>
        <p>Aucune transition en attente</p>
      </div>`;
    return;
  }

  body.innerHTML = _transData.map(t => {
    const arrow      = `<span class="trans-arrow">${t.from_status} → ${t.to_status}</span>`;
    const cin        = _resFmtDate(t.checkInDate);
    const cout       = _resFmtDate(t.checkOutDate);
    const since      = _transFmtAgo(t.triggered_at);
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
          <div class="trans-card-meta">Réservation #${t.reservation_id} · ${_resEsc(t.roomType || '')} ${_resEsc(t.roomNumber || '')}</div>
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
      <div class="tds-row"><span>Client</span><strong>${_resEsc(t.clientName)}</strong></div>
      <div class="tds-row"><span>Email</span><strong>${_resEsc(t.email || '—')}</strong></div>
      <div class="tds-row"><span>Téléphone</span><strong>${_resEsc(t.phoneNumber || '—')}</strong></div>
      <div class="tds-row"><span>Chambre</span><strong>${_resEsc(t.roomNumber || '—')} · ${_resEsc(t.roomType || '—')}</strong></div>
      <div class="tds-row"><span>Séjour</span><strong>${_resFmtDate(t.checkInDate)} → ${_resFmtDate(t.checkOutDate)} (${days} nuit${days>1?'s':''})</strong></div>
      <div class="tds-row"><span>Montant</span><strong style="color:var(--gold)">${_resFmtMoney(t.totalPrice)}</strong></div>
      <div class="tds-transition-box">
        <span class="res-badge ${_resStatusMeta(t.from_status).cls}">${_resStatusMeta(t.from_status).label}</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="12 5 19 12 12 19"/>
        </svg>
        <span class="res-badge ${_resStatusMeta(t.to_status).cls}">${_resStatusMeta(t.to_status).label}</span>
      </div>
      <p class="tds-hint">
        ${isCheckIn  ? '⚠️ Le client est-il bien présent à la réception ?' :
          isComplete ? '⚠️ Le client a-t-il bien quitté la chambre ?' :
                       '⚠️ Confirmez-vous cette transition ?'}
      </p>
    </div>`;

  document.getElementById('transDecNote').value = '';
  document.getElementById('transDecisionModal')?.classList.add('open');
}

async function _transDecide(decision) {
  if (!_currentTransId) return;

  const note      = document.getElementById('transDecNote')?.value.trim() || '';
  const acceptBtn = document.getElementById('transDecAccept');
  const rejectBtn = document.getElementById('transDecReject');
  if (acceptBtn) { acceptBtn.disabled = true; acceptBtn.textContent = '⏳…'; }
  if (rejectBtn) { rejectBtn.disabled = true; }

  try {
    const res  = await fetch(TRANS_API, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ transition_id: _currentTransId, decision, note }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    document.getElementById('transDecisionModal')?.classList.remove('open');
    _currentTransId = null;

    _transToast(
      decision === 'accepted'
        ? '✅ ' + data.message
        : '🚫 Transition refusée — statut inchangé',
      decision === 'accepted' ? 'success' : 'info'
    );

    await _fullPoll();
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
  /* Ouvrir le panel via badge */
  document.addEventListener('click', e => {
    if (e.target.closest('#uniBadgeBtn')) {
      document.getElementById('uniPanelOverlay')?.classList.add('open');
      _renderActiveTab();
    }
  });

  /* Fermer panel */
  document.getElementById('uniPanelClose')?.addEventListener('click', () => {
    document.getElementById('uniPanelOverlay')?.classList.remove('open');
  });
  document.getElementById('uniPanelOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'uniPanelOverlay')
      e.target.classList.remove('open');
  });

  /* Onglets */
  document.querySelectorAll('.uni-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeTab = btn.dataset.tab;
      document.querySelectorAll('.uni-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('uniPanelBodyNotifs').style.display = _activeTab === 'notifs'       ? '' : 'none';
      document.getElementById('uniPanelBodyTrans' ).style.display = _activeTab === 'transitions'  ? '' : 'none';
      _renderActiveTab();
    });
  });

  /* Modal décision */
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
  if (diff < 60)    return 'à l\'instant';
  if (diff < 3600)  return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`;
  return `il y a ${Math.floor(diff / 86400)} j`;
}

function _transToast(msg, type = 'success') {
  const t = document.getElementById('transGlobalToast');
  if (!t) return;
  clearTimeout(_transToastTmr);
  t.textContent = msg;
  t.className   = `res-toast ${type} show`;
  _transToastTmr = setTimeout(() => t.classList.remove('show'), 4000);
}

/* Helpers partagés avec gestion_reservation.js — réexportés si absents */
function _resEsc(str) {
  if (typeof window._resEsc === 'function' && window._resEsc !== _resEsc) return window._resEsc(str);
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function _resFmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function _resFmtMoney(n) {
  return Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' TND';
}

function _resStatusMeta(s) {
  const k = String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if (k === 'confirmee'  || k === 'confirmée')                             return { cls: 'confirmée',  label: 'Confirmée'   };
  if (k === 'en attente' || k === 'pending')                               return { cls: 'pending',    label: 'En attente'  };
  if (['annule','annulee','cancelled','canceled','annulé'].includes(k))    return { cls: 'cancelled',  label: 'Annulé'      };
  if (k === 'refuse'     || k === 'refusé')                                return { cls: 'refused',    label: 'Refusé'      };
  if (k === 'checked_in' || k === 'checked in')                            return { cls: 'checked_in', label: 'Checked in'  };
  if (k === 'checked_out'|| k === 'checked out')                           return { cls: 'checked_out',label: 'Checked out' };
  if (k === 'complete'   || k === 'completé' || k === 'completed')         return { cls: 'completed',  label: 'Completé'    };
  if (k === 'supprime'   || k === 'supprimé')                              return { cls: 'supprime',   label: 'Supprimé'    };
  return { cls: k.replace(/\s+/g,'_'), label: s || '—' };
}

// ═══════════════════════════════════════════════════════════
//  FONCTION PUBLIQUE — Notifier l'admin d'une nouvelle réclamation
// ═══════════════════════════════════════════════════════════
function addReclamationNotification(reclamation) {
  if (!reclamation || !reclamation.id) return;
  
  // Ajouter au début du tableau des réclamations
  _notifData.reclamations.unshift({
    id         : reclamation.id,
    clientName : reclamation.clientName || 'Client',
    priorite   : reclamation.urgence || 'Faible',
    description: reclamation.description || '',
    created_at : new Date().toISOString(),
  });
  
  // Mettre à jour le badge
  _updateBadge();
  
  // Si la cloche est ouverte et l'onglet "Activités" est visible, re-rendre
  if (document.getElementById('uniPanelOverlay')?.classList.contains('open') && _activeTab === 'notifs') {
    _renderNotifs();
  }
  
  // Afficher un toast de notification
  _transToast('🔔 Nouvelle réclamation reçue', 'info');
}

// Exposer globalement pour utilisation externe
window.addReclamationNotification = addReclamationNotification;