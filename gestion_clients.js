/* ═══════════════════════════════════════════════════════════
   gestion_clients.js — Logique complète de la vue Clients
   Fetch API · Filtrage live · Debounce · CRUD · Sort · Toast
   Aligné sur le pattern gestion_reservation.js
═══════════════════════════════════════════════════════════ */

'use strict';

// ── URL de l'API PHP ──────────────────────────────────────
const CLI_API = 'gestion_clients.php';

// ── État global ───────────────────────────────────────────
let _cliAll        = [];      // tous les clients (brut API)
let _cliDeleteId   = null;    // id à supprimer
let _cliEditMode   = false;   // true = édition, false = création
let _cliSortCol    = 'id';
let _cliSortDir    = 'desc';
let _cliToastTimer = null;
let _cliPaysList   = [];

// ═══════════════════════════════════════════════════════════
//  INIT — appelé par kpi.js au DOMContentLoaded
// ═══════════════════════════════════════════════════════════

function initClientsView() {
  _bindCliFilters();
  _bindCliModals();
  _bindCliSortHeaders();
}

// ═══════════════════════════════════════════════════════════
//  FETCH — chargement depuis l'API
// ═══════════════════════════════════════════════════════════

async function fetchClients() {
  _cliShowLoading(true);

  try {
    const res  = await fetch(CLI_API, { cache: 'no-store' });
    const data = await res.json();

    if (!data.success) throw new Error(data.error || 'Erreur API');

    _cliAll      = data.data     || [];
    _cliPaysList = data.pays_list || [];

    _cliPopulatePaysDatalist(_cliPaysList);
    _cliApplyFilters();

  } catch (err) {
    console.error('[Clients]', err);
    _cliShowTableError(err.message);
  } finally {
    _cliShowLoading(false);
  }
}

// ═══════════════════════════════════════════════════════════
//  FILTRAGE LIVE (client-side)
// ═══════════════════════════════════════════════════════════

function _getCliFilters() {
  return {
    search:   _cliEl('cliFilterSearch')?.value.trim().toLowerCase()  || '',
    genre:    _cliEl('cliFilterGenre')?.value                        || '',
    pays:     _cliEl('cliFilterPays')?.value.trim().toLowerCase()    || '',
    dateFrom: _cliEl('cliFilterDateFrom')?.value                     || '',
    dateTo:   _cliEl('cliFilterDateTo')?.value                       || '',
  };
}

function _cliApplyFilters() {
  const f = _getCliFilters();

  let filtered = _cliAll.filter(c => {
    // Recherche sur nom + prénom + email
    const haystack = `${c.nom} ${c.prenom} ${c.email || ''}`.toLowerCase();
    if (f.search   && !haystack.includes(f.search))                         return false;
    if (f.genre    && c.genre !== f.genre)                                  return false;
    if (f.pays     && !(c.pays || '').toLowerCase().includes(f.pays))       return false;
    if (f.dateFrom && c.date_naissance && c.date_naissance < f.dateFrom)    return false;
    if (f.dateTo   && c.date_naissance && c.date_naissance > f.dateTo)      return false;
    return true;
  });

  filtered = _cliSortData(filtered, _cliSortCol, _cliSortDir);
  _cliRenderTable(filtered, f.search);
  _cliUpdateBadge(filtered.length);
}

// ═══════════════════════════════════════════════════════════
//  TRI
// ═══════════════════════════════════════════════════════════

function _cliSortData(data, col, dir) {
  return [...data].sort((a, b) => {
    let va = a[col] ?? '';
    let vb = b[col] ?? '';
    if (col === 'id') { va = parseInt(va, 10) || 0; vb = parseInt(vb, 10) || 0; }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    if (va < vb) return dir === 'asc' ? -1 :  1;
    if (va > vb) return dir === 'asc' ?  1 : -1;
    return 0;
  });
}

function _cliHandleSort(col) {
  if (_cliSortCol === col) {
    _cliSortDir = _cliSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    _cliSortCol = col;
    _cliSortDir = 'asc';
  }
  _cliUpdateSortHeaders();
  _cliApplyFilters();
}

function _cliUpdateSortHeaders() {
  document.querySelectorAll('.cli-full-table th[data-col]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === _cliSortCol) {
      th.classList.add(_cliSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  RENDER TABLE
// ═══════════════════════════════════════════════════════════

function _cliRenderTable(list, search = '') {
  const tbody = _cliEl('cliTbody');
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="cli-table-empty">
          <div class="ei">🔍</div>
          <p>Aucun client ne correspond aux filtres</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(c => {
    const fullName   = `${_cliEsc(c.prenom || '')} ${_cliEsc(c.nom || '')}`;
    const nameHl     = search ? _cliHighlight(fullName, search) : fullName;
    const genreClass = (c.genre || '').toLowerCase() === 'femme' ? 'cli-badge-femme' : 'cli-badge-homme';
    const genreIcon  = (c.genre || '').toLowerCase() === 'femme' ? '♀' : '♂';
    const dob        = c.date_naissance
      ? new Date(c.date_naissance).toLocaleDateString('fr-FR')
      : '—';

    return `
      <tr data-id="${c.id}">
        <td class="cli-id">#${c.id}</td>
        <td>
          <div class="cli-name">${nameHl}</div>
          <div class="cli-email">${_cliEsc(c.email || '—')}</div>
        </td>
        <td><span class="cli-badge-genre ${genreClass}">${genreIcon} ${_cliEsc(c.genre || '—')}</span></td>
        <td class="cli-phone">${_cliEsc(c.telephone || '—')}</td>
        <td>${dob}</td>
        <td>${_cliEsc(c.pays || '—')}</td>
        <td>
          <div class="cli-action-group">
            <button class="cli-btn-icon edit"
              onclick="_cliOpenEdit(${c.id})"
              title="Modifier">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="cli-btn-icon del"
              onclick="_cliOpenConfirmDelete(${c.id},'${_cliEscAttr(c.prenom + ' ' + c.nom)}')"
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

function _cliOpenAdd() {
  _cliEditMode = false;
  _cliEl('cliFormTitle').textContent = '➕ Nouveau client';
  _cliEl('cliFormId').value          = '';
  _cliEl('cliFormBtn').textContent   = 'Créer';
  _cliResetForm();
  _cliOpenModal('cliFormModal');
}

function _cliOpenEdit(id) {
  const c = _cliAll.find(x => String(x.id) === String(id));
  if (!c) return;

  _cliEditMode = true;
  _cliEl('cliFormTitle').textContent = '✏️ Modifier le client';
  _cliEl('cliFormId').value          = c.id;
  _cliEl('cliFormBtn').textContent   = 'Enregistrer';

  _cliEl('cliFormNom').value            = c.nom            || '';
  _cliEl('cliFormPrenom').value         = c.prenom         || '';
  _cliEl('cliFormGenre').value          = c.genre          || 'Homme';
  _cliEl('cliFormEmail').value          = c.email          || '';
  _cliEl('cliFormTelephone').value      = c.telephone      || '';
  _cliEl('cliFormDateNaissance').value  = c.date_naissance || '';
  _cliEl('cliFormPays').value           = c.pays           || '';

  _cliOpenModal('cliFormModal');
}

async function _cliSubmitForm() {
  const id     = _cliEl('cliFormId').value;
  const nom    = _cliEl('cliFormNom').value.trim();
  const prenom = _cliEl('cliFormPrenom').value.trim();
  const email  = _cliEl('cliFormEmail').value.trim();

  if (!nom || !prenom || !email) {
    _cliToast('⚠️ Nom, prénom et email sont obligatoires', 'error');
    return;
  }

  const payload = {
    nom,
    prenom,
    genre:          _cliEl('cliFormGenre').value,
    email,
    telephone:      _cliEl('cliFormTelephone').value.trim(),
    date_naissance: _cliEl('cliFormDateNaissance').value,
    pays:           _cliEl('cliFormPays').value.trim(),
  };

  if (_cliEditMode && id) payload.id = parseInt(id, 10);

  const btn = _cliEl('cliFormBtn');
  btn.disabled    = true;
  btn.textContent = '⏳ En cours…';

  try {
    const res  = await fetch(CLI_API, {
      method:  _cliEditMode ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    _cliCloseModal('cliFormModal');
    _cliToast(
      _cliEditMode ? '✅ Client modifié avec succès' : '✅ Client créé avec succès',
      'success'
    );
    await fetchClients();
  } catch (err) {
    _cliToast('❌ ' + err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = _cliEditMode ? 'Enregistrer' : 'Créer';
  }
}

// ═══════════════════════════════════════════════════════════
//  MODAL CONFIRM DELETE
// ═══════════════════════════════════════════════════════════

function _cliOpenConfirmDelete(id, name) {
  _cliDeleteId = id;
  const p = _cliEl('cliConfirmText');
  if (p) p.textContent = `Supprimer définitivement "${name}" ? Cette action est irréversible.`;
  _cliOpenModal('cliConfirmModal');
}

async function _cliConfirmDelete() {
  if (!_cliDeleteId) return;

  const btn = _cliEl('cliConfirmBtn');
  btn.disabled    = true;
  btn.textContent = '⏳ Suppression…';

  try {
    const res  = await fetch(CLI_API, {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: _cliDeleteId }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    _cliCloseModal('cliConfirmModal');
    _cliToast('🗑️ Client supprimé', 'success');
    await fetchClients();
  } catch (err) {
    _cliToast('❌ ' + err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Supprimer';
    _cliDeleteId    = null;
  }
}

// ═══════════════════════════════════════════════════════════
//  DATALIST PAYS
// ═══════════════════════════════════════════════════════════

function _cliPopulatePaysDatalist(list) {
  ['cliPaysDatalist', 'cliPaysFilterList'].forEach(dlId => {
    const dl = _cliEl(dlId);
    if (!dl) return;
    dl.innerHTML = list.map(p => `<option value="${_cliEscAttr(p)}">`).join('');
  });
}

// ═══════════════════════════════════════════════════════════
//  BIND — Filtres, Modals, Tri
// ═══════════════════════════════════════════════════════════

function _bindCliFilters() {
  const debounced = _cliDebounce(_cliApplyFilters, 280);

  _cliEl('cliFilterSearch')?.addEventListener('input',   debounced);
  _cliEl('cliFilterGenre')?.addEventListener('change',   _cliApplyFilters);
  _cliEl('cliFilterPays')?.addEventListener('input',     debounced);
  _cliEl('cliFilterDateFrom')?.addEventListener('change', _cliApplyFilters);
  _cliEl('cliFilterDateTo')?.addEventListener('change',   _cliApplyFilters);

  _cliEl('cliBtnResetFilters')?.addEventListener('click', () => {
    ['cliFilterSearch', 'cliFilterPays', 'cliFilterDateFrom', 'cliFilterDateTo']
      .forEach(id => { const el = _cliEl(id); if (el) el.value = ''; });
    const g = _cliEl('cliFilterGenre');
    if (g) g.value = '';
    _cliApplyFilters();
  });

  _cliEl('btnAddClient')?.addEventListener('click', _cliOpenAdd);
}

function _bindCliModals() {
  // Modal formulaire
  _cliEl('cliFormClose')?.addEventListener('click',  () => _cliCloseModal('cliFormModal'));
  _cliEl('cliFormCancel')?.addEventListener('click', () => _cliCloseModal('cliFormModal'));
  _cliEl('cliFormBtn')?.addEventListener('click',    _cliSubmitForm);
  _cliEl('cliFormModal')?.addEventListener('click', e => {
    if (e.target === _cliEl('cliFormModal')) _cliCloseModal('cliFormModal');
  });

  // Modal confirm delete
  _cliEl('cliConfirmClose')?.addEventListener('click',  () => _cliCloseModal('cliConfirmModal'));
  _cliEl('cliConfirmCancel')?.addEventListener('click', () => _cliCloseModal('cliConfirmModal'));
  _cliEl('cliConfirmBtn')?.addEventListener('click',    _cliConfirmDelete);
  _cliEl('cliConfirmModal')?.addEventListener('click', e => {
    if (e.target === _cliEl('cliConfirmModal')) _cliCloseModal('cliConfirmModal');
  });
}

function _bindCliSortHeaders() {
  document.querySelectorAll('.cli-full-table th[data-col]').forEach(th => {
    th.addEventListener('click', () => _cliHandleSort(th.dataset.col));
  });
  _cliUpdateSortHeaders();
}

// ═══════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════

function _cliShowLoading(v) {
  document.getElementById('loadingOverlay')?.classList.toggle('hidden', !v);
}

function _cliShowTableError(msg) {
  const tbody = _cliEl('cliTbody');
  if (tbody) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="cli-table-empty">
          <div class="ei">❌</div>
          <p>${_cliEsc(msg)}</p>
        </div>
      </td></tr>`;
  }
}

function _cliUpdateBadge(n) {
  const el = _cliEl('clientCount');
  if (el) el.textContent = `${n} client${n > 1 ? 's' : ''}`;
}

function _cliOpenModal(id)  { _cliEl(id)?.classList.add('open'); }
function _cliCloseModal(id) { _cliEl(id)?.classList.remove('open'); }

function _cliResetForm() {
  ['cliFormNom', 'cliFormPrenom', 'cliFormEmail',
   'cliFormTelephone', 'cliFormDateNaissance', 'cliFormPays']
    .forEach(id => { const el = _cliEl(id); if (el) el.value = ''; });
  const g = _cliEl('cliFormGenre');
  if (g) g.value = 'Homme';
}

function _cliToast(msg, type = 'success') {
  const t = _cliEl('cliGlobalToast');
  if (!t) return;
  clearTimeout(_cliToastTimer);
  t.textContent = msg;
  t.className   = `cli-toast ${type} show`;
  _cliToastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ── Petits utilitaires ──
function _cliEl(id) { return document.getElementById(id); }

function _cliDebounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function _cliEsc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _cliEscAttr(str) { return _cliEsc(str).replace(/'/g, '&#39;'); }

function _cliHighlight(str, term) {
  if (!term) return str;
  const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return str.replace(re, '<mark>$1</mark>');
}