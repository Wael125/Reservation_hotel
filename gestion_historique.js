/* ═══════════════════════════════════════════════════════════
   gestion_historique.js  —  Historique des réservations
   Statuts terminaux : Annulé · Refusé · Completé
   Lecture seule · Filtres · Tri · Export CSV · Détail modal
═══════════════════════════════════════════════════════════ */
'use strict';

const HIST_API = 'gestion_reservation.php';

// Statuts qui appartiennent à l'historique
const HIST_STATUSES = ['Annulé', 'Refusé', 'Completé', 'Supprimé'];

let _histAll     = [];
let _histSortCol = 'id';
let _histSortDir = 'desc';
let _histToastTmr = null;

// ── Init ──────────────────────────────────────────────────
function initHistoriqueView() {
  _bindHistFilters();
  _bindHistModals();
  _bindHistSortHeaders();
}

// ── Chargement ────────────────────────────────────────────
async function loadHistorique() {
  _histShowLoading(true);
  try {
    const res  = await fetch(HIST_API, { cache: 'no-store' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erreur API');

    // Filtrer côté client : uniquement les statuts terminaux
    _histAll = (data.data || []).filter(r => HIST_STATUSES.includes(r.Status));

    _histPopulateRoomTypes(data.room_types || []);
    _histApplyFilters();
    _histUpdateStats();
  } catch (err) {
    console.error('[Historique]', err);
    _histShowTableError(err.message);
  } finally {
    _histShowLoading(false);
  }
}

// ── Filtrage ──────────────────────────────────────────────
function _histGetFilters() {
  return {
    search:   _hEl('histFilterSearch')?.value.trim().toLowerCase() || '',
    status:   _hEl('histFilterStatus')?.value   || '',
    roomType: _hEl('histFilterRoomType')?.value || '',
    dateFrom: _hEl('histFilterDateFrom')?.value || '',
    dateTo:   _hEl('histFilterDateTo')?.value   || '',
  };
}

function _histApplyFilters() {
  const f = _histGetFilters();
  let filtered = _histAll.filter(r => {
    const txt = `${r.clientName} ${r.email}`.toLowerCase();
    if (f.search   && !txt.includes(f.search))     return false;
    if (f.status   && r.Status   !== f.status)      return false;
    if (f.roomType && r.roomType !== f.roomType)    return false;
    if (f.dateFrom && r.checkInDate < f.dateFrom)  return false;
    if (f.dateTo   && r.checkInDate > f.dateTo)    return false;
    return true;
  });
  filtered = _histSort(filtered);
  _histRenderTable(filtered, f.search);
  _histUpdateBadge(filtered.length);
}

// ── Tri ───────────────────────────────────────────────────
function _histSort(data) {
  return [...data].sort((a, b) => {
    let va = a[_histSortCol] ?? '', vb = b[_histSortCol] ?? '';
    if (['id','totalPrice','numberOfAdults'].includes(_histSortCol)) {
      va = parseFloat(va)||0; vb = parseFloat(vb)||0;
    } else {
      va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
    }
    if (va < vb) return _histSortDir === 'asc' ? -1 : 1;
    if (va > vb) return _histSortDir === 'asc' ?  1 : -1;
    return 0;
  });
}

function _histHandleSort(col) {
  _histSortDir = (_histSortCol === col && _histSortDir === 'asc') ? 'desc' : 'asc';
  _histSortCol = col;
  document.querySelectorAll('#view-historique .res-full-table th[data-col]').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.dataset.col === _histSortCol)
      th.classList.add(_histSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
  _histApplyFilters();
}

// ── Render ────────────────────────────────────────────────
function _histRenderTable(list, search = '') {
  const tbody = _hEl('histTbody');
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="res-table-empty">
          <div class="ei">📭</div>
          <p>Aucun enregistrement dans l'historique</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(r => {
    const sm    = _resStatusMeta(r.Status);      // réutilise la fonction du module res
    const cin   = _resFmtDate(r.checkInDate);
    const cout  = _resFmtDate(r.checkOutDate);
    const price = _resFmtMoney(r.totalPrice);
    const name  = search
      ? _resHighlight(_resEsc(r.clientName), search)
      : _resEsc(r.clientName);

    // Durée séjour
    const days = Math.round(
      (new Date(r.checkOutDate) - new Date(r.checkInDate)) / 86400000
    ) || '—';

    return `
      <tr data-id="${r.id}">
        <td class="res-id">#${r.id}</td>
        <td>
          <div class="res-client">${name}</div>
          <div class="res-email">${_resEsc(r.email || '')}</div>
        </td>
        <td class="res-dates">
          ${cin}<br>
          <span style="color:var(--text-muted);font-size:.68rem;">→ ${cout}</span><br>
          <span class="hist-nights">${days} nuit${days > 1 ? 's' : ''}</span>
        </td>
        <td style="white-space:nowrap;">
          ${_resEsc(r.roomType || '—')}<br>
          <span style="font-size:.7rem;color:var(--text-muted)">${_resEsc(r.roomNumber || '')}</span>
        </td>
        <td style="text-align:center;">
          ${r.numberOfAdults}
          <span style="color:var(--text-muted);font-size:.68rem;">+${r.numberOfChildren}e</span>
        </td>
        <td class="res-price">${price}</td>
        <td><span class="res-badge ${sm.cls}">${sm.label}</span></td>
        <td>
          <button class="res-btn-icon edit"
            onclick="_histOpenDetail(${r.id})"
            title="Voir détail"
            style="background:rgba(78,205,196,.1);border-color:rgba(78,205,196,.25);color:var(--teal);">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
        </td>
      </tr>`;
  }).join('');
}

// ── Détail modal ──────────────────────────────────────────
function _histOpenDetail(id) {
  const r = _histAll.find(x => String(x.id) === String(id));
  if (!r) return;

  const sm  = _resStatusMeta(r.Status);
  const cin = _resFmtDate(r.checkInDate);
  const cout= _resFmtDate(r.checkOutDate);
  const days= Math.round((new Date(r.checkOutDate) - new Date(r.checkInDate)) / 86400000) || 0;

  const content = _hEl('histDetailContent');
  if (!content) return;

  content.innerHTML = `
    <div class="hist-detail-grid">
      <div class="hdg-header">
        <span class="res-badge ${sm.cls}" style="font-size:.75rem;padding:4px 12px;">${sm.label}</span>
        <span class="hdg-id">#${r.id}</span>
      </div>

      <div class="hdg-section">👤 Client</div>
      <div class="hdg-row"><span>Nom</span><strong>${_resEsc(r.clientName)}</strong></div>
      <div class="hdg-row"><span>Email</span><strong>${_resEsc(r.email || '—')}</strong></div>
      <div class="hdg-row"><span>Téléphone</span><strong>${_resEsc(r.phoneNumber || '—')}</strong></div>

      <div class="hdg-section">🏨 Séjour</div>
      <div class="hdg-row"><span>Arrivée</span><strong>${cin}</strong></div>
      <div class="hdg-row"><span>Départ</span><strong>${cout}</strong></div>
      <div class="hdg-row"><span>Durée</span><strong>${days} nuit${days > 1 ? 's' : ''}</strong></div>
      <div class="hdg-row"><span>Chambre</span><strong>${_resEsc(r.roomNumber || '—')} (${_resEsc(r.roomType || '—')})</strong></div>
      <div class="hdg-row"><span>Personnes</span><strong>${r.numberOfAdults} adulte${r.numberOfAdults>1?'s':''} + ${r.numberOfChildren} enfant${r.numberOfChildren>1?'s':''}</strong></div>
      <div class="hdg-row"><span>Pension</span><strong>${_resEsc(r.pension || '—')}</strong></div>

      <div class="hdg-section">💳 Paiement</div>
      <div class="hdg-row"><span>Mode</span><strong>${_resEsc(r.paymentDetails || '—')}</strong></div>
      <div class="hdg-row"><span>Total</span><strong class="hist-price-big">${_resFmtMoney(r.totalPrice)}</strong></div>
    </div>`;

  _hEl('histDetailModal')?.classList.add('open');
}

// ── Stats ─────────────────────────────────────────────────
function _histUpdateStats() {
  const completed = _histAll.filter(r => r.Status === 'Completé').length;
  const cancelled = _histAll.filter(r => r.Status === 'Annulé').length;
  const refused   = _histAll.filter(r => r.Status === 'Refusé').length;
  const deleted   = _histAll.filter(r => r.Status === 'Supprimé').length;
  const revenue   = _histAll
    .filter(r => r.Status === 'Completé')
    .reduce((s, r) => s + (parseFloat(r.totalPrice) || 0), 0);

  const s = n => _hEl(n);
  if (s('histStatCompleted')) s('histStatCompleted').textContent = completed;
  if (s('histStatCancelled')) s('histStatCancelled').textContent = cancelled;
  if (s('histStatRefused'))   s('histStatRefused').textContent   = refused;
  if (s('histStatDeleted'))   s('histStatDeleted').textContent   = deleted;
  if (s('histStatRevenue'))   s('histStatRevenue').textContent   = revenue.toLocaleString('fr-FR') + ' TND';
}

// ── Export CSV ────────────────────────────────────────────
function _histExportCSV() {
  const f = _histGetFilters();
  let data = _histAll.filter(r => {
    const txt = `${r.clientName} ${r.email}`.toLowerCase();
    if (f.search   && !txt.includes(f.search))     return false;
    if (f.status   && r.Status   !== f.status)      return false;
    if (f.roomType && r.roomType !== f.roomType)    return false;
    if (f.dateFrom && r.checkInDate < f.dateFrom)  return false;
    if (f.dateTo   && r.checkInDate > f.dateTo)    return false;
    return true;
  });

  const header = ['ID','Client','Email','Téléphone','Arrivée','Départ','Chambre','N°','Adultes','Enfants','Pension','Paiement','Total TND','Statut'];
  const rows   = data.map(r => [
    r.id, r.clientName, r.email, r.phoneNumber||'',
    r.checkInDate, r.checkOutDate,
    r.roomType||'', r.roomNumber||'',
    r.numberOfAdults, r.numberOfChildren,
    r.pension||'', r.paymentDetails||'',
    r.totalPrice, r.Status
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));

  const csv  = [header.join(','), ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `historique_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  _histToast('📥 Export CSV téléchargé', 'success');
}

// ── Binds ─────────────────────────────────────────────────
function _bindHistFilters() {
  const deb = _resDebounce(_histApplyFilters, 280);
  _hEl('histFilterSearch')?.addEventListener('input',   deb);
  _hEl('histFilterStatus')?.addEventListener('change',  _histApplyFilters);
  _hEl('histFilterRoomType')?.addEventListener('change',_histApplyFilters);
  _hEl('histFilterDateFrom')?.addEventListener('change',_histApplyFilters);
  _hEl('histFilterDateTo')?.addEventListener('change',  _histApplyFilters);
  _hEl('histBtnResetFilters')?.addEventListener('click', () => {
    ['histFilterSearch','histFilterStatus','histFilterRoomType','histFilterDateFrom','histFilterDateTo']
      .forEach(id => { const el = _hEl(id); if (el) el.value = ''; });
    _histApplyFilters();
  });
  _hEl('btnHistExport')?.addEventListener('click', _histExportCSV);
}

function _bindHistModals() {
  _hEl('histDetailClose')?.addEventListener('click', () => _hEl('histDetailModal')?.classList.remove('open'));
  _hEl('histDetailModal')?.addEventListener('click', e => {
    if (e.target === _hEl('histDetailModal')) _hEl('histDetailModal').classList.remove('open');
  });
}

function _bindHistSortHeaders() {
  document.querySelectorAll('#view-historique .res-full-table th[data-col]').forEach(th => {
    th.addEventListener('click', () => _histHandleSort(th.dataset.col));
  });
}

function _histPopulateRoomTypes(types) {
  const el = _hEl('histFilterRoomType');
  if (!el) return;
  const cur = el.value;
  el.innerHTML = '<option value="">Tous les types</option>';
  types.forEach(t => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    if (t === cur) o.selected = true;
    el.appendChild(o);
  });
}

// ── UI helpers ────────────────────────────────────────────
function _histShowLoading(v) {
  const ct = _hEl('histTableContainer');
  if (ct) ct.style.opacity = v ? '.5' : '1';
}
function _histShowTableError(msg) {
  const tb = _hEl('histTbody');
  if (tb) tb.innerHTML = `<tr><td colspan="8"><div class="res-table-empty"><div class="ei">❌</div><p>${_resEsc(msg)}</p></div></td></tr>`;
}
function _histUpdateBadge(n) {
  const el = _hEl('histBadgeCount');
  if (el) el.textContent = `${n} entrée${n>1?'s':''}`;
}
function _histToast(msg, type='success') {
  const t = _hEl('histGlobalToast');
  if (!t) return;
  clearTimeout(_histToastTmr);
  t.textContent = msg;
  t.className = `res-toast ${type} show`;
  _histToastTmr = setTimeout(() => t.classList.remove('show'), 3500);
}
function _hEl(id) { return document.getElementById(id); }