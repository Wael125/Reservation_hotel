/* ═══════════════════════════════════════════════════════════
   gestion_chambres.js — Logique complète de la vue Chambres
   Table : room (roomnumber, roomType, price, availability)
   Même pattern que gestion_clients.js / gestion_reservation.js
═══════════════════════════════════════════════════════════ */

'use strict';

// ── URL de l'API PHP ──────────────────────────────────────
const CHB_API = 'gestion_chambres.php';

// ── État global ───────────────────────────────────────────
let _chbAll        = [];
let _chbDeleteId   = null;
let _chbEditMode   = false;
let _chbSortCol    = 'roomnumber';
let _chbSortDir    = 'asc';
let _chbToastTimer = null;

// Valeurs disponibilité reconnues
const CHB_AVAIL = {
  disponible:   { cls: 'disponible',   label: 'Disponible'   },
  occupé:    { cls: 'occupé',    label: 'Occupé'      },
  maintenance: { cls: 'maintenance', label: 'Maintenance'  },
};

// ═══════════════════════════════════════════════════════════
//  INIT — appelé par kpi.js au DOMContentLoaded
// ═══════════════════════════════════════════════════════════

function initChambresView() {
  _bindChbFilters();
  _bindChbModals();
  _bindChbSortHeaders();
}

// ═══════════════════════════════════════════════════════════
//  FETCH
// ═══════════════════════════════════════════════════════════

async function fetchChambres() {
  _chbShowLoading(true);
  try {
    const res  = await fetch(CHB_API, { cache: 'no-store' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erreur API');

    _chbAll = data.data || [];
    _chbPopulateDropdowns(data.room_types || [], data.availability_list || []);
    _chbApplyFilters();
  } catch (err) {
    console.error('[Chambres]', err);
    _chbShowTableError(err.message);
  } finally {
    _chbShowLoading(false);
  }
}

// ═══════════════════════════════════════════════════════════
//  FILTRAGE LIVE (client-side)
// ═══════════════════════════════════════════════════════════

function _getChbFilters() {
  return {
    search:       _chbEl('chbFilterSearch')?.value.trim().toLowerCase() || '',
    roomType:     _chbEl('chbFilterType')?.value                        || '',
    availability: _chbEl('chbFilterAvail')?.value                       || '',
    priceMin:     parseFloat(_chbEl('chbFilterPriceMin')?.value)        || null,
    priceMax:     parseFloat(_chbEl('chbFilterPriceMax')?.value)        || null,
  };
}

function _chbApplyFilters() {
  const f = _getChbFilters();

  let filtered = _chbAll.filter(r => {
    const hay = `${r.roomnumber} ${r.roomType}`.toLowerCase();
    if (f.search       && !hay.includes(f.search))                     return false;
    if (f.roomType     && r.roomType !== f.roomType)                   return false;
    if (f.availability && r.availability !== f.availability)           return false;
    if (f.priceMin !== null && (parseFloat(r.price) || 0) < f.priceMin) return false;
    if (f.priceMax !== null && (parseFloat(r.price) || 0) > f.priceMax) return false;
    return true;
  });

  filtered = _chbSortData(filtered, _chbSortCol, _chbSortDir);
  _chbRenderTable(filtered, f.search);
  _chbUpdateBadge(filtered.length);
}

// ═══════════════════════════════════════════════════════════
//  TRI
// ═══════════════════════════════════════════════════════════

function _chbSortData(data, col, dir) {
  return [...data].sort((a, b) => {
    let va = a[col] ?? '';
    let vb = b[col] ?? '';
    if (col === 'price') { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    if (va < vb) return dir === 'asc' ? -1 :  1;
    if (va > vb) return dir === 'asc' ?  1 : -1;
    return 0;
  });
}

function _chbHandleSort(col) {
  if (_chbSortCol === col) {
    _chbSortDir = _chbSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _chbSortCol = col;
    _chbSortDir = 'asc';
  }
  _chbUpdateSortHeaders();
  _chbApplyFilters();
}

function _chbUpdateSortHeaders() {
  document.querySelectorAll('.chb-full-table th[data-col]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === _chbSortCol) {
      th.classList.add(_chbSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  RENDER TABLE
// ═══════════════════════════════════════════════════════════

function _chbRenderTable(list, search = '') {
  const tbody = _chbEl('chbTbody');
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `
      <tr><td colspan="5">
        <div class="chb-table-empty">
          <div class="ei">🔍</div>
          <p>Aucune chambre ne correspond aux filtres</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(r => {
    const avKey  = (r.availability || '').toLowerCase().replace(/\s+/g, '');
    const avMeta = CHB_AVAIL[avKey] || { cls: avKey, label: r.availability || '—' };
    const price  = (parseFloat(r.price) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0 }) + ' TND';
    const numHl  = search ? _chbHighlight(_chbEsc(r.roomnumber || ''), search) : _chbEsc(r.roomnumber || '');
    const typeHl = search ? _chbHighlight(_chbEsc(r.roomType   || ''), search) : _chbEsc(r.roomType   || '');

    return `
      <tr data-rn="${_chbEscAttr(r.roomnumber)}">
        <td><span class="chb-number">${numHl}</span></td>
        <td><span class="chb-type">${typeHl}</span></td>
        <td><span class="chb-price">${price}</span></td>
        <td><span class="chb-badge ${avMeta.cls}">${avMeta.label}</span></td>
        <td>
          <div class="chb-action-group">
            <button class="chb-btn-icon edit"
              onclick="_chbOpenEdit('${_chbEscAttr(r.roomnumber)}')"
              title="Modifier">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="chb-btn-icon del"
              onclick="_chbOpenConfirmDelete('${_chbEscAttr(r.roomnumber)}')"
              title="Supprimer">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
//  MODAL FORMULAIRE — Ajouter / Modifier
// ═══════════════════════════════════════════════════════════

function _chbOpenAdd() {
  _chbEditMode = false;
  _chbEl('chbFormTitle').textContent  = '➕ Nouvelle chambre';
  _chbEl('chbFormRoomNumber').value   = '';
  _chbEl('chbFormRoomNumber').readOnly = false;
  _chbEl('chbFormBtn').textContent    = 'Créer';
  _chbResetForm();
  _chbOpenModal('chbFormModal');
}

function _chbOpenEdit(roomnumber) {
  const r = _chbAll.find(x => String(x.roomnumber) === String(roomnumber));
  if (!r) return;

  _chbEditMode = true;
  _chbEl('chbFormTitle').textContent   = '✏️ Modifier la chambre';
  _chbEl('chbFormBtn').textContent     = 'Enregistrer';

  _chbEl('chbFormRoomNumber').value    = r.roomnumber    || '';
  _chbEl('chbFormRoomNumber').readOnly = true; // le numéro est la clé primaire
  _chbEl('chbFormRoomType').value      = r.roomType      || '';
  _chbEl('chbFormPrice').value         = r.price         || '';
  _chbEl('chbFormAvail').value         = r.availability  || 'Disponible';

  _chbOpenModal('chbFormModal');
}

async function _chbSubmitForm() {
  const roomnumber = _chbEl('chbFormRoomNumber').value.trim();
  const roomType   = _chbEl('chbFormRoomType').value.trim();

  if (!roomnumber || !roomType) {
    _chbToast('⚠️ Numéro et type de chambre sont obligatoires', 'error');
    return;
  }

  const payload = {
    roomnumber,
    roomType,
    price:        parseFloat(_chbEl('chbFormPrice').value) || 0,
    availability: _chbEl('chbFormAvail').value,
  };

  const btn = _chbEl('chbFormBtn');
  btn.disabled    = true;
  btn.textContent = '⏳ En cours…';

  try {
    const res  = await fetch(CHB_API, {
      method:  _chbEditMode ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    _chbCloseModal('chbFormModal');
    _chbToast(
      _chbEditMode ? '✅ Chambre modifiée' : '✅ Chambre créée',
      'success'
    );
    await fetchChambres();
  } catch (err) {
    _chbToast('❌ ' + err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = _chbEditMode ? 'Enregistrer' : 'Créer';
  }
}

// ═══════════════════════════════════════════════════════════
//  MODAL CONFIRM DELETE
// ═══════════════════════════════════════════════════════════

function _chbOpenConfirmDelete(roomnumber) {
  _chbDeleteId = roomnumber;
  const p = _chbEl('chbConfirmText');
  if (p) p.textContent = `Supprimer définitivement la chambre "${roomnumber}" ? Cette action est irréversible.`;
  _chbOpenModal('chbConfirmModal');
}

async function _chbConfirmDelete() {
  if (!_chbDeleteId) return;

  const btn = _chbEl('chbConfirmBtn');
  btn.disabled    = true;
  btn.textContent = '⏳ Suppression…';

  try {
    const res  = await fetch(CHB_API, {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ roomnumber: _chbDeleteId }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    _chbCloseModal('chbConfirmModal');
    _chbToast('🗑️ Chambre supprimée', 'success');
    await fetchChambres();
  } catch (err) {
    _chbToast('❌ ' + err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Supprimer';
    _chbDeleteId    = null;
  }
}

// ═══════════════════════════════════════════════════════════
//  DROPDOWNS DYNAMIQUES
// ═══════════════════════════════════════════════════════════

function _chbPopulateDropdowns(types, availList) {
  // Type de chambre
  const typeSel = _chbEl('chbFilterType');
  if (typeSel) {
    const cur = typeSel.value;
    typeSel.innerHTML = '<option value="">Tous les types</option>';
    types.forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      if (t === cur) o.selected = true;
      typeSel.appendChild(o);
    });
  }

  // Disponibilité (filtre)
  const availSel = _chbEl('chbFilterAvail');
  if (availSel) {
    const cur = availSel.value;
    availSel.innerHTML = '<option value="">Toutes</option>';
    availList.forEach(a => {
      const o = document.createElement('option');
      o.value = a; o.textContent = _chbAvailLabel(a);
      if (a === cur) o.selected = true;
      availSel.appendChild(o);
    });
  }
}

function _chbAvailLabel(v) {
  const k = (v || '').toLowerCase().replace(/\s+/g, '');
  return CHB_AVAIL[k]?.label || v;
}

// ═══════════════════════════════════════════════════════════
//  BIND
// ═══════════════════════════════════════════════════════════

function _bindChbFilters() {
  const debounced = _chbDebounce(_chbApplyFilters, 280);

  _chbEl('chbFilterSearch')?.addEventListener('input',   debounced);
  _chbEl('chbFilterType')?.addEventListener('change',    _chbApplyFilters);
  _chbEl('chbFilterAvail')?.addEventListener('change',   _chbApplyFilters);
  _chbEl('chbFilterPriceMin')?.addEventListener('input', debounced);
  _chbEl('chbFilterPriceMax')?.addEventListener('input', debounced);

  _chbEl('chbBtnReset')?.addEventListener('click', () => {
    ['chbFilterSearch', 'chbFilterPriceMin', 'chbFilterPriceMax']
      .forEach(id => { const el = _chbEl(id); if (el) el.value = ''; });
    ['chbFilterType', 'chbFilterAvail']
      .forEach(id => { const el = _chbEl(id); if (el) el.value = ''; });
    _chbApplyFilters();
  });

  _chbEl('btnAddChambre')?.addEventListener('click', _chbOpenAdd);
}

function _bindChbModals() {
  _chbEl('chbFormClose')?.addEventListener('click',  () => _chbCloseModal('chbFormModal'));
  _chbEl('chbFormCancel')?.addEventListener('click', () => _chbCloseModal('chbFormModal'));
  _chbEl('chbFormBtn')?.addEventListener('click',    _chbSubmitForm);
  _chbEl('chbFormModal')?.addEventListener('click', e => {
    if (e.target === _chbEl('chbFormModal')) _chbCloseModal('chbFormModal');
  });

  _chbEl('chbConfirmClose')?.addEventListener('click',  () => _chbCloseModal('chbConfirmModal'));
  _chbEl('chbConfirmCancel')?.addEventListener('click', () => _chbCloseModal('chbConfirmModal'));
  _chbEl('chbConfirmBtn')?.addEventListener('click',    _chbConfirmDelete);
  _chbEl('chbConfirmModal')?.addEventListener('click', e => {
    if (e.target === _chbEl('chbConfirmModal')) _chbCloseModal('chbConfirmModal');
  });
}

function _bindChbSortHeaders() {
  document.querySelectorAll('.chb-full-table th[data-col]').forEach(th => {
    th.addEventListener('click', () => _chbHandleSort(th.dataset.col));
  });
  _chbUpdateSortHeaders();
}

// ═══════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════

function _chbShowLoading(v) {
  document.getElementById('loadingOverlay')?.classList.toggle('hidden', !v);
}

function _chbShowTableError(msg) {
  const tbody = _chbEl('chbTbody');
  if (tbody) {
    tbody.innerHTML = `
      <tr><td colspan="5">
        <div class="chb-table-empty">
          <div class="ei">❌</div>
          <p>${_chbEsc(msg)}</p>
        </div>
      </td></tr>`;
  }
}

function _chbUpdateBadge(n) {
  const el = _chbEl('chambreCount');
  if (el) el.textContent = `${n} chambre${n > 1 ? 's' : ''}`;
}

function _chbOpenModal(id)  { _chbEl(id)?.classList.add('open'); }
function _chbCloseModal(id) { _chbEl(id)?.classList.remove('open'); }

function _chbResetForm() {
  ['chbFormRoomNumber', 'chbFormRoomType', 'chbFormPrice'].forEach(id => {
    const el = _chbEl(id); if (el) el.value = '';
  });
  const a = _chbEl('chbFormAvail');
  if (a) a.value = 'Disponible';
}

function _chbToast(msg, type = 'success') {
  const t = _chbEl('chbGlobalToast');
  if (!t) return;
  clearTimeout(_chbToastTimer);
  t.textContent = msg;
  t.className   = `chb-toast ${type} show`;
  _chbToastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ── Utilitaires ──
function _chbEl(id)    { return document.getElementById(id); }
function _chbDebounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function _chbEsc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _chbEscAttr(str) { return _chbEsc(str).replace(/'/g,"&#39;"); }
function _chbHighlight(str, term) {
  if (!term) return str;
  const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return str.replace(re, '<mark>$1</mark>');
}