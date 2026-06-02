/* ═══════════════════════════════════════════════════════════
   HOTEL DASHBOARD — dashboard_admin.js
   Navigation + KPI + Modal Admin + Chatbot
   Réservations → gestion_reservation.js
   Clients      → gestion_clients.js
   Chambres     → gestion_chambres.js
   Historique   → gestion_historique.js
   Transitions  → gestion_transitions.js
═══════════════════════════════════════════════════════════ */

// ── LOGIN_ID ──────────────────────────────────────────────
var LOGIN_ID = window.LOGIN_ID ?? null;
console.log('✅ Admin Dashboard — login_id:', LOGIN_ID, '(type:', typeof LOGIN_ID, ')');

// ── Résolution URL API ────────────────────────────────────
const _port = window.location.port;
const _isLiveServer = _port === '3000' || _port === '5500' || _port === '5501';

const API = _isLiveServer
  ? 'http://localhost/reservation_hotel/dashboard_admin.php?action=all'
  : 'dashboard_admin.php?action=all';

const LOGIN_URL = _isLiveServer
  ? 'http://localhost/reservation_hotel/login.html'
  : 'login.html';

const _loginLink = document.getElementById('loginLink');
if (_loginLink) _loginLink.href = LOGIN_URL;

// ══════════════════════════════════════════════════════════
//  NAVIGATION — showView()
// ══════════════════════════════════════════════════════════

const VIEW_META = {
  dashboard:    { title: 'Dashboard Admin',          breadcrumb: "Aperçu global de l'établissement"      },
  reservations: { title: 'Gestion des Réservations', breadcrumb: 'Réservations actives'                  },
  clients:      { title: 'Gestion des Clients',      breadcrumb: 'Liste et gestion de la clientèle'      },
  chambres:     { title: 'Gestion des Chambres',     breadcrumb: 'Disponibilité et tarifs des chambres'  },
  stats:        { title: 'Statistiques',             breadcrumb: 'Rapports & analyses'                   },
  historique:   { title: 'Historique',               breadcrumb: 'Réservations terminées · Lecture seule'},
  predictions:  { title: 'Prédictions ML',           breadcrumb: 'Analyse des tendances et prévisions'   },
};

function showView(viewName) {
  document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

  const targetSection = document.getElementById('view-' + viewName);
  if (targetSection) targetSection.classList.add('active');

  const targetNav = document.getElementById('nav-' + viewName);
  if (targetNav) targetNav.classList.add('active');

  const meta    = VIEW_META[viewName] || {};
  const titleEl = document.getElementById('topbarTitle');
  const breadEl = document.getElementById('topbarBreadcrumb');
  if (titleEl) titleEl.textContent = meta.title      || viewName;
  if (breadEl) breadEl.textContent = meta.breadcrumb || '';

if (viewName === 'reservations') { loadReservations(); _transPoll(); }
  if (viewName === 'clients')      fetchClients();
  if (viewName === 'chambres')     fetchChambres();
  if (viewName === 'historique')   loadHistorique();
}

// ══════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════

function logout() {
  if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
    window.location.href = 'logout.php';
  }
}

// ══════════════════════════════════════════════════════════
//  UI STATE HELPERS
// ══════════════════════════════════════════════════════════

function showLoading(v) {
  document.getElementById('loadingOverlay')?.classList.toggle('hidden', !v);
}

function showError(elementIdOrMsg, message) {
  if (typeof message === 'undefined') {
    const banner = document.getElementById('errorBanner');
    if (!banner) return;
    if (elementIdOrMsg) {
      banner.textContent = elementIdOrMsg;
      banner.classList.add('visible');
    } else {
      banner.classList.remove('visible');
    }
    return;
  }
  const el = document.getElementById(elementIdOrMsg);
  if (el) { el.textContent = message; el.style.display = 'block'; }
}

function showSessionBanner(v) {
  document.getElementById('sessionBanner')?.classList.toggle('visible', v);
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ══════════════════════════════════════════════════════════
//  FORMATTERS
// ══════════════════════════════════════════════════════════

function fmt(n, decimals = 0) {
  return Number(n || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
function fmtMoney(n) { return fmt(n, 0) + ' TND'; }

function fmtMonth(ym) {
  if (!ym || !ym.includes('-')) return ym || '-';
  const [y, m] = ym.split('-');
  const names  = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'];
  return `${names[Math.max(parseInt(m, 10) - 1, 0)] || m} ${y.slice(2)}`;
}

function normalizeStatus(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getStatusMeta(status) {
  const k = normalizeStatus(status);
  if (k === 'confirmee')                                                                         return { className: 'confirmée',   label: 'Confirmée'   };
  if (k === 'en attente' || k === 'pending')                                                    return { className: 'pending',     label: 'En attente'  };
  if (k === 'annule' || k === 'annulee' || k === 'cancelled' || k === 'canceled' || k === 'annulé')
                                                                                                 return { className: 'cancelled',   label: 'Annulé'      };
  if (k === 'refuse' || k === 'refusé')                                                         return { className: 'refused',     label: 'Refusé'      };
  if (k === 'checked_out' || k === 'checked out')                                               return { className: 'checked_out', label: 'Checked out' };
  if (k === 'checked_in'  || k === 'checked in')                                                return { className: 'checked_in',  label: 'Checked in'  };
  if (k === 'complete' || k === 'completé' || k === 'completed')                                return { className: 'completed',   label: 'Completé'    };
  return { className: k.replace(/\s+/g, '_'), label: status || '-' };
}

// ══════════════════════════════════════════════════════════
//  CHART.JS CONFIG
// ══════════════════════════════════════════════════════════

const C = {
  gold: '#c9a55a', goldL: '#e8c97a',
  teal: '#4ecdc4', rose:  '#e07b8a',
  violet: '#9b8fe8', green: '#6bcb8b',
  grid: 'rgba(255,255,255,.05)', text: '#8a8f9e',
};

const chartsEnabled = typeof Chart !== 'undefined';
if (chartsEnabled) {
  Chart.defaults.color       = C.text;
  Chart.defaults.font.family = "'DM Sans', sans-serif";
  Chart.defaults.font.size   = 11;
}

let charts = {};

function destroyChart(key) {
  if (!charts[key]) return;
  charts[key].destroy();
  delete charts[key];
}

function tooltipStyle() {
  return {
    backgroundColor: '#1c2028', borderColor: 'rgba(255,255,255,.1)', borderWidth: 1,
    padding: 10, titleColor: '#eceef2', bodyColor: '#8a8f9e',
    titleFont: { weight: '600', size: 12 }, cornerRadius: 8, displayColors: false,
  };
}

function lineScales() {
  const grid  = { color: C.grid, drawBorder: false };
  const ticks = { color: C.text };
  return { x: { grid, ticks }, y: { grid, ticks, beginAtZero: true } };
}

// ══════════════════════════════════════════════════════════
//  KPI RENDER
// ══════════════════════════════════════════════════════════

function renderKPIs(d = {}) {
  setEl('kpi-total-res', fmt(d.total_reservations));
  setEl('kpi-revenue',   fmtMoney(d.total_revenue));
  setEl('kpi-customers', fmt(d.total_customers));

  // ── Check-in du jour ──────────────────────────────────
  const ciTotal = d.today_checkin_total || 0;
  const ciDone  = d.today_checkin_done  || 0;
  const ciLeft  = ciTotal - ciDone;
  const ciPct   = ciTotal > 0 ? Math.round((ciDone / ciTotal) * 100) : 0;

  setEl('kpi-today', ciTotal > 0 ? `${ciDone} / ${ciTotal}` : '0');
  setEl('kpi-checkin-sub', ciLeft > 0
    ? `${ciLeft} restant${ciLeft > 1 ? 's' : ''} à check-in`
    : ciTotal > 0 ? '✓ Tous arrivés' : 'Aucune arrivée');

  setTimeout(() => {
    const bar = document.getElementById('checkinBar');
    if (bar) bar.style.width = `${ciPct}%`;
  }, 200);

  // ── Check-out du jour ─────────────────────────────────
  const coTotal = d.today_checkout_total || 0;
  const coDone  = d.today_checkout_done  || 0;
  const coLeft  = coTotal - coDone;
  const coPct   = coTotal > 0 ? Math.round((coDone / coTotal) * 100) : 0;

  setEl('kpi-today-checkout', coTotal > 0 ? `${coDone} / ${coTotal}` : '0');
  setEl('kpi-checkout-sub', coLeft > 0
    ? `${coLeft} restant${coLeft > 1 ? 's' : ''} à check-out`
    : coTotal > 0 ? '✓ Tous partis' : 'Aucun départ');

  setTimeout(() => {
    const bar = document.getElementById('checkoutBar');
    if (bar) bar.style.width = `${coPct}%`;
  }, 200);

  // ── Taux d'occupation ─────────────────────────────────
  setEl('kpi-occ-rate',   `${d.occupancy_rate || 0}%`);
  setEl('kpi-occ-detail', `${d.occupied_rooms || 0} / ${d.total_rooms || 0} chambres`);

  setTimeout(() => {
    const bar = document.getElementById('occBar');
    if (bar) bar.style.width = `${d.occupancy_rate || 0}%`;
  }, 200);
}

function renderResChart(rows = []) {
  if (!chartsEnabled) return;
  const canvas = document.getElementById('chartRes');
  if (!canvas) return;
  destroyChart('res');
  const ctx  = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 220);
  grad.addColorStop(0, 'rgba(201,165,90,.35)');
  grad.addColorStop(1, 'rgba(201,165,90,0)');
  charts.res = new Chart(ctx, {
    type: 'line',
    data: {
      labels: rows.map(r => fmtMonth(r.month)),
      datasets: [{
        label: 'Réservations', data: rows.map(r => parseInt(r.count, 10) || 0),
        borderColor: C.gold, borderWidth: 2.5, pointBackgroundColor: C.gold,
        pointRadius: 4, pointHoverRadius: 6, fill: true, backgroundColor: grad, tension: 0.4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tooltipStyle() },
      scales: lineScales(),
    },
  });
}

function renderRevChart(rows = []) {
  if (!chartsEnabled) return;
  const canvas = document.getElementById('chartRev');
  if (!canvas) return;
  destroyChart('rev');
  const ctx  = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 220);
  grad.addColorStop(0, 'rgba(78,205,196,.7)');
  grad.addColorStop(1, 'rgba(78,205,196,.1)');
  charts.rev = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: rows.map(r => fmtMonth(r.month)),
      datasets: [{
        label: 'Revenu (TND)', data: rows.map(r => parseFloat(r.revenue) || 0),
        backgroundColor: grad, borderColor: C.teal, borderWidth: 1.5,
        borderRadius: 5, borderSkipped: false,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipStyle(), callbacks: { label: ctx => ` ${fmtMoney(ctx.raw)}` } },
      },
      scales: lineScales(),
    },
  });
}

function renderOccChart(rows = []) {
  if (!chartsEnabled) return;
  const canvas = document.getElementById('chartOcc');
  if (!canvas) return;
  destroyChart('occ');
  const ctx        = canvas.getContext('2d');
  const roomColors = [C.gold, C.teal, C.rose, C.violet, C.green, '#f4a261', '#a8dadc'];
  const total      = rows.reduce((s, r) => s + (parseInt(r.count, 10) || 0), 0);
  charts.occ = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: rows.map(r => r.roomType),
      datasets: [{
        data: rows.map(r => parseInt(r.count, 10) || 0),
        backgroundColor: roomColors.slice(0, rows.length),
        borderColor: '#161920', borderWidth: 3, hoverOffset: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '72%',
      plugins: { legend: { display: false }, tooltip: tooltipStyle() },
    },
  });
  const legend = document.getElementById('occLegend');
  if (!legend) return;
  legend.innerHTML = '';
  rows.forEach((row, i) => {
    const count = parseInt(row.count, 10) || 0;
    const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
    legend.innerHTML += `
      <div class="legend-item">
        <span class="legend-dot" style="background:${roomColors[i]}"></span>
        <span>${row.roomType}</span>
        <span class="legend-val">${pct}%</span>
      </div>`;
  });
}

function renderTable(rows = []) {
  const tbody = document.getElementById('resTableBody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px">Aucune réservation</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(row => {
    const s = getStatusMeta(row.status);
    return `<tr>
      <td>#${row.id}</td>
      <td>${row.clientName  || '-'}</td>
      <td>${row.roomType    || '-'}</td>
      <td>${row.roomNumber  || '-'}</td>
      <td>${row.checkInDate || '-'}</td>
      <td>${fmtMoney(row.totalPrice)}</td>
      <td><span class="badge ${s.className}">${s.label}</span></td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
//  ROOM STATUS  (widget "Occupation par type")
//
//  Le PHP retourne maintenant ces champs par ligne :
//    roomType | total | disponible | occupied | maintenance
//
//  renderRoomStatus() affiche une barre de progression par type,
//  colorée selon le taux d'occupation réel.
// ══════════════════════════════════════════════════════════

function renderRoomStatus(rows = []) {
  const list = document.getElementById('roomStatusList');
  if (!list) return;

  if (!rows.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:.82rem">Aucune donnée</div>';
    return;
  }

  const barColors = [C.gold, C.teal, C.rose, C.violet, C.green];

  list.innerHTML = rows.map((row, i) => {
    // ── Lecture des champs avec fallback 0 ──────────────────────
    const total       = parseInt(row.total,       10) || 0;
    const occupied    = parseInt(row.occupied,    10) || 0;  // ← alias SQL corrigé
    const maintenance = parseInt(row.maintenance, 10) || 0;
    const disponible  = parseInt(row.disponible,  10) || 0;

    // Taux basé sur les chambres occupées / total
    const pct   = total > 0 ? Math.round((occupied / total) * 100) : 0;
    const color = barColors[i % barColors.length];

    // Ligne de détail : adapte selon ce qu'on a
    let detail = `${occupied} occupée${occupied > 1 ? 's' : ''} / ${total} total`;
    if (maintenance > 0) detail += ` · ${maintenance} maintenance`;
    if (disponible  > 0) detail += ` · ${disponible} libre${disponible > 1 ? 's' : ''}`;

    return `
      <div class="room-row">
        <div class="room-row-header">
          <span class="room-type-name">${row.roomType || '—'}</span>
          <span class="room-counts">${detail}</span>
        </div>
        <div class="room-bar-bg">
          <div class="room-bar-fill"
               style="width:0%;background:${color}"
               data-pct="${pct}">
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:3px;">
          <span style="font-size:.65rem;color:${color};font-weight:700;">${pct}%</span>
        </div>
      </div>`;
  }).join('');

  // Animation des barres après insertion dans le DOM
  setTimeout(() => {
    list.querySelectorAll('.room-bar-fill')
      .forEach(el => { el.style.width = `${el.dataset.pct}%`; });
  }, 300);
}

// ══════════════════════════════════════════════════════════
//  LOAD DASHBOARD (KPI)
// ══════════════════════════════════════════════════════════

async function loadDashboard() {
  showLoading(true);
  showError('');
  showSessionBanner(false);

  try {
    const res = await fetch(API, { credentials: 'include', cache: 'no-store' });
    if (res.status === 403) { showSessionBanner(true); showLoading(false); return; }
    if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);

    const data = await res.json();
    if (data.error)              throw new Error(data.error);
    if (data.status === 'error') throw new Error(data.message || 'Erreur serveur');

    renderKPIs(data.kpis);
    renderResChart(data.reservations_per_month);
    renderRevChart(data.revenue_per_month);
    renderOccChart(data.room_occupancy);
    renderTable(data.recent_reservations);
    renderRoomStatus(data.room_status);

    if (!chartsEnabled) showError("Chart.js n'a pas pu être chargé — graphiques désactivés.");
    setEl('lastUpdated', `Mis à jour : ${new Date().toLocaleTimeString('fr-FR')}`);

  } catch (err) {
    console.error('[Dashboard Admin]', err);
    showError(`Impossible de charger les données : ${err.message}`);
    setEl('lastUpdated', 'Erreur de chargement');
  } finally {
    showLoading(false);
  }
}

// ══════════════════════════════════════════════════════════
//  MODAL NEW ADMIN
// ══════════════════════════════════════════════════════════

function openNewAdminModal() {
  document.getElementById('newAdminModal').style.display = 'block';
  clearNewAdminForm();
}
function closeNewAdminModal() {
  document.getElementById('newAdminModal').style.display = 'none';
  clearNewAdminForm();
}
function clearNewAdminForm() {
  document.getElementById('newAdminForm').reset();
  document.querySelectorAll('.error-msg').forEach(e => e.style.display = 'none');
  document.getElementById('successMsg').style.display = 'none';
}

function validateAndCreateAdmin(event) {
  event.preventDefault();
  document.querySelectorAll('.error-msg').forEach(e => e.style.display = 'none');
  document.getElementById('successMsg').style.display = 'none';

  const username        = document.getElementById('newAdminUsername').value.trim();
  const password        = document.getElementById('newAdminPassword').value;
  const confirmPassword = document.getElementById('newAdminConfirmPassword').value;

  if (!username)           return showError('usernameError', "Le nom d'utilisateur est requis");
  if (username.length < 3) return showError('usernameError', 'Minimum 3 caractères requis');
  if (password.length < 6) return showError('passwordError', 'Minimum 6 caractères requis');
  if (password !== confirmPassword)
    return showError('confirmPasswordError', 'Les mots de passe ne correspondent pas');

  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled    = true;
  submitBtn.textContent = '⏳ Création...';

  fetch('create_admin_account.php', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    'username=' + encodeURIComponent(username) +
             '&password=' + encodeURIComponent(password) + '&role=admin',
  })
  .then(r => r.json())
  .then(data => {
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Créer Admin';
    if (data.success) {
      document.getElementById('successMsg').style.display = 'block';
      document.getElementById('newAdminForm').reset();
      setTimeout(closeNewAdminModal, 2000);
    } else {
      showError('usernameError', data.error || 'Erreur lors de la création');
    }
  })
  .catch(err => {
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Créer Admin';
    showError('usernameError', 'Erreur serveur : ' + err.message);
  });

  return false;
}

window.addEventListener('click', function (event) {
  const modal = document.getElementById('newAdminModal');
  if (event.target === modal) modal.style.display = 'none';
});

// ══════════════════════════════════════════════════════════
//  CHATBOT
// ══════════════════════════════════════════════════════════

function toggleChat() {
  const chat = document.getElementById('chatContainer');
  if (!chat) return;
  if (chat.style.display === 'flex') {
    chat.style.display = 'none';
  } else {
    chat.style.display = 'flex';
    if (!chat.dataset.opened) { moveWelcomeToChat(); chat.dataset.opened = 'true'; }
  }
}

function moveWelcomeToChat() {
  const outside = document.getElementById('welcomeOutside');
  if (!outside) return;
  const text = outside.innerText;
  outside.remove();
  appendMessage(text, 'bot');
}

function appendMessage(text, type) {
  const chatBox = document.getElementById('chatBox');
  if (!chatBox) return;
  const div       = document.createElement('div');
  div.className   = 'message ' + type;
  div.innerText   = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function showTyping() {
  const box = document.getElementById('chatBox');
  if (!box) return;
  const div     = document.createElement('div');
  div.className = 'message typing';
  div.id        = 'typing';
  div.innerText = '🤖 typing';
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function removeTyping() { document.getElementById('typing')?.remove(); }

async function send() {
  const input = document.getElementById('msg');
  if (!input) return;
  const message = input.value.trim();
  if (!message) return;
  appendMessage(message, 'user');
  input.value = '';
  showTyping();
  try {
    const res  = await fetch('http://127.0.0.1:5000/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, login_id: LOGIN_ID }),
    });
    const data = await res.json();
    removeTyping();
    appendMessage('🤖 ' + data.reply, 'bot');
  } catch (err) {
    removeTyping();
    appendMessage('❌ Erreur serveur : ' + err.message, 'bot');
  }
}

// ══════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════════════

let notificationsData = { reclamations: [], clients: [], reservations: [] };
let lastNotificationTime = new Date().toISOString();

function getTimeAgo(dateStr) {
  if (!dateStr) return 'Il y a peu';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'À l\'instant';
  if (diffMins < 60) return `Il y a ${diffMins}m`;
  if (diffHours < 24) return `Il y a ${diffHours}h`;
  return `Il y a ${diffDays}j`;
}

async function loadNotifications() {
  try {
    const res = await fetch('dashboard_admin.php?action=notifications', { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return;
    
    const data = await res.json();
    notificationsData = data;
    updateNotificationBell();
  } catch (err) {
    console.error('[Notifications]', err);
  }
}

function updateNotificationBell() {
  const totalNotifs = (notificationsData.reclamations?.length || 0) +
                      (notificationsData.clients?.length || 0) +
                      (notificationsData.reservations?.length || 0);
  
  const badge = document.getElementById('notificationBadge');
  if (badge) {
    if (totalNotifs > 0) {
      badge.textContent = totalNotifs > 99 ? '99+' : totalNotifs;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
  
  renderNotificationList();
}

function renderNotificationList() {
  const list = document.getElementById('notificationList');
  if (!list) return;
  
  const items = [];
  
  // Réclamations
  (notificationsData.reclamations || []).forEach(rec => {
    items.push({
      type: 'reclamation',
      title: `Réclamation #${rec.id}`,
      text: `${rec.clientName || 'Client'} - Priorité: ${rec.priorite}`,
      time: rec.created_at,
      timestamp: new Date(rec.created_at).getTime(),
    });
  });
  
  // Clients
  (notificationsData.clients || []).forEach(client => {
    items.push({
      type: 'client',
      title: `Nouveau client`,
      text: `${client.firstName} ${client.lastName}`,
      time: client.created_at,
      timestamp: new Date(client.created_at).getTime(),
    });
  });
  
  // Réservations
  (notificationsData.reservations || []).forEach(res => {
    items.push({
      type: 'reservation',
      title: `Réservation #${res.id}`,
      text: `${res.clientName} - ${res.roomType}`,
      time: res.createdAt,
      timestamp: new Date(res.createdAt).getTime(),
    });
  });
  
  // Trier par date décroissante
  items.sort((a, b) => b.timestamp - a.timestamp);
  
  if (!items.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:.82rem">Aucune notification</div>';
    return;
  }
  
  list.innerHTML = items.map(item => `
    <div class="notification-item new">
      <div class="notification-item-type ${item.type}">${item.type === 'reclamation' ? '⚠️ Réclamation' : item.type === 'client' ? '👤 Client' : '📅 Réservation'}</div>
      <div class="notification-item-text"><strong>${item.title}</strong></div>
      <div class="notification-item-text">${item.text}</div>
      <div class="notification-item-time">${getTimeAgo(item.time)}</div>
    </div>
  `).join('');
}

function toggleNotificationDropdown() {
  const dropdown = document.getElementById('notificationDropdown');
  if (!dropdown) return;
  dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function () {
  const dateEl = document.getElementById('currentDate');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  const adminName = document.getElementById('adminName');
  if (adminName) adminName.textContent = window.ADMIN_NAME || 'Admin';

  document.getElementById('btnRefresh')?.addEventListener('click', loadDashboard);

  document.getElementById('msg')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') send();
  });

  document.getElementById('btnNotificationBell')?.addEventListener('click', toggleNotificationDropdown);
  
  // Fermer le dropdown quand on clique ailleurs
  document.addEventListener('click', function(e) {
    const bell = document.getElementById('btnNotificationBell');
    const dropdown = document.getElementById('notificationDropdown');
    if (!bell?.contains(e.target) && !dropdown?.contains(e.target)) {
      if (dropdown) dropdown.style.display = 'none';
    }
  });

  initClientsView();
  initReservationsView();
  initChambresView();
  initHistoriqueView();
  initTransitionsPanel();

  loadDashboard();
  loadNotifications();
  setInterval(loadDashboard, 60_000);
  setInterval(loadNotifications, 30_000);
});
