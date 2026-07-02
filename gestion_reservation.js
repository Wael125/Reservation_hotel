/* ═══════════════════════════════════════════════════════════
   gestion_reservation.js  —  Version complète
   Réservations : filtres live · CRUD · modals · tri · toast
   + Sélection intelligente chambre/type avec check_availability
   + Calcul automatique du prix total
   + Notification toast quand l'email de confirmation est envoyé
═══════════════════════════════════════════════════════════ */

'use strict';

// ── Constantes API ────────────────────────────────────────
const RES_API   = 'gestion_reservation.php';
const AVAIL_API = 'check_availability.php';

// ── Types de chambres fixes ───────────────────────────────
const ROOM_TYPES = ['Simple', 'Double', 'Triple', 'Suite'];

// ── Modes de paiement fixes ───────────────────────────────
const PAYMENT_MODES = ['Carte bancaire', 'Espèces', 'Virement', 'PayPal'];

// ── Statuts valides ───────────────────────────────────────
const RES_STATUSES = [
  'En attente',
  'Confirmée',
  'Annulé',
  'Refusé',
  'Checked_in',
  'Checked_out',
  'Completé',
];

// ── TARIFS (même logique que le PHP) ─────────────────────
const ROOM_PRICES = {
  simple: { adult: 100, child: 50  },
  double: { adult: 120, child: 60  },
  triple: { adult: 130, child: 65  },
  suite:  { adult: 150, child: 75  },
};
const PENSION_PRICES = {
  'sans_pension':      0,
  'petit_dejeuner':   15,
  'Petit-déjeuner':   15,
  'demi_pension':     30,
  'Demi-pension':     30,
  'pension_complete': 40,
  'Pension complète': 40,
  'tout_inclus':      55,
  'All inclusive':    55,
};

// ── État global ───────────────────────────────────────────
let _resAll        = [];
let _resDeleteId   = null;
let _resEditMode   = false;
let _resSortCol    = 'id';
let _resSortDir    = 'desc';
let _resToastTimer = null;
let _availRooms    = [];
let _priceLocked   = false;

// ═══════════════════════════════════════════════════════════
//  INIT — appelé depuis kpi.js
// ═══════════════════════════════════════════════════════════

function initReservationsView() {
  _bindResFilters();
  _bindResModals();
  _bindResSortHeaders();
  _buildFormSelects();
  _bindAvailabilityLogic();
  _bindPriceCalculation();
}

// ═══════════════════════════════════════════════════════════
//  CALCUL AUTOMATIQUE DU PRIX
// ═══════════════════════════════════════════════════════════

function _calculatePrice() {
  const checkIn  = _resEl('resFormCheckIn')?.value;
  const checkOut = _resEl('resFormCheckOut')?.value;
  const roomType = (_resEl('resFormRoomType')?.value || '').toLowerCase().trim();
  const adults   = parseInt(_resEl('resFormAdults')?.value)   || 1;
  const children = parseInt(_resEl('resFormChildren')?.value) || 0;
  const pension  = _resEl('resFormPension')?.value || '';

  if (!checkIn || !checkOut || !roomType) return null;

  const days = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
  if (days <= 0) return null;

  const tarif = ROOM_PRICES[roomType];
  if (!tarif) return null;

  const roomTotal    = days * ((adults * tarif.adult) + (children * tarif.child));
  const pensionPerDay = PENSION_PRICES[pension] ?? 0;
  const pensionTotal  = days * pensionPerDay * (adults + children);

  return Math.round(roomTotal + pensionTotal);
}

function _updatePriceField() {
  if (_priceLocked) return;

  const price   = _calculatePrice();
  const priceEl = _resEl('resFormPrice');
  if (!priceEl) return;

  if (price !== null) {
    priceEl.value = price;
    _showPriceHint(price);
  } else {
    _hidePriceHint();
  }
}

function _showPriceHint(total) {
  let hint = document.getElementById('resPriceAutoHint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'resPriceAutoHint';
    hint.style.cssText = `
      font-size:.68rem; color:var(--text-muted,#6b7280);
      margin-top:3px; line-height:1.5;
    `;
    _resEl('resFormPrice')?.closest('.res-form-field')?.appendChild(hint);
  }

  const checkIn  = _resEl('resFormCheckIn')?.value;
  const checkOut = _resEl('resFormCheckOut')?.value;
  const roomType = (_resEl('resFormRoomType')?.value || '').toLowerCase();
  const adults   = parseInt(_resEl('resFormAdults')?.value)   || 1;
  const children = parseInt(_resEl('resFormChildren')?.value) || 0;
  const pension  = _resEl('resFormPension')?.value || '';

  if (!checkIn || !checkOut) { hint.textContent = ''; return; }

  const days    = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
  const tarif   = ROOM_PRICES[roomType] || { adult: 0, child: 0 };
  const pensPD  = PENSION_PRICES[pension] ?? 0;
  const roomTot = days * ((adults * tarif.adult) + (children * tarif.child));
  const pensTot = days * pensPD * (adults + children);

  let txt = `🧮 Auto : ${days} nuit(s) × ${roomType} = ${roomTot.toLocaleString('fr-FR')} TND`;
  if (pensTot > 0) txt += ` + pension ${pensTot.toLocaleString('fr-FR')} TND`;

  hint.textContent = txt;
  hint.style.color = 'var(--text-muted,#6b7280)';
}

function _hidePriceHint() {
  const h = document.getElementById('resPriceAutoHint');
  if (h) h.textContent = '';
}

function _bindPriceCalculation() {
  const triggers = ['resFormCheckIn', 'resFormCheckOut', 'resFormRoomType',
                    'resFormAdults', 'resFormChildren', 'resFormPension'];

  triggers.forEach(id => {
    _resEl(id)?.addEventListener('change', () => { _priceLocked = false; _updatePriceField(); });
    _resEl(id)?.addEventListener('input',  () => { _priceLocked = false; _updatePriceField(); });
  });

  _resEl('resFormPrice')?.addEventListener('input', () => {
    _priceLocked = true;
    const h = document.getElementById('resPriceAutoHint');
    if (h) { h.textContent = '✏️ Prix modifié manuellement'; h.style.color = 'var(--violet,#9b8fe8)'; }
  });
}

// ═══════════════════════════════════════════════════════════
//  CONSTRUCTION DES <SELECT> FIXES DU FORMULAIRE
// ═══════════════════════════════════════════════════════════

function _buildFormSelects() {
  // Types de chambre
  const typeEl = _resEl('resFormRoomType');
  if (typeEl && typeEl.tagName === 'SELECT') {
    typeEl.innerHTML = '<option value="">— Choisir un type —</option>';
    ROOM_TYPES.forEach(t => {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      typeEl.appendChild(o);
    });
  }

  // Modes de paiement
  const payEl = _resEl('resFormPayment');
  if (payEl && payEl.tagName === 'SELECT') {
    payEl.innerHTML = '<option value="">— Choisir —</option>';
    PAYMENT_MODES.forEach(p => {
      const o = document.createElement('option');
      o.value = p; o.textContent = p;
      payEl.appendChild(o);
    });
  }

  // Statuts dans le formulaire
  const statEl = _resEl('resFormStatus');
  if (statEl && statEl.tagName === 'SELECT') {
    statEl.innerHTML = '';
    const statusLabels = {
      'En attente':  '⏳ En attente',
      'Confirmée':   '✅ Confirmée',
      'Annulé':      '❌ Annulé',
      'Refusé':      '🚫 Refusé',
      'Checked_in':  '🔑 Checked in',
      'Checked_out': '🚪 Checked out',
      'Completé':    '🏁 Completé',
    };
    RES_STATUSES.forEach(s => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = statusLabels[s] || s;
      statEl.appendChild(o);
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  LOGIQUE DISPONIBILITÉ
// ═══════════════════════════════════════════════════════════

function _bindAvailabilityLogic() {
  const checkIn  = _resEl('resFormCheckIn');
  const checkOut = _resEl('resFormCheckOut');
  const typeEl   = _resEl('resFormRoomType');
  const roomEl   = _resEl('resFormRoomNumber');

  if (!checkIn || !checkOut || !typeEl || !roomEl) return;

  checkIn.addEventListener('change', () => {
    if (checkIn.value && checkOut.value && checkOut.value <= checkIn.value) {
      checkOut.value = '';
    }
    _triggerAvailCheck();
  });

  checkOut.addEventListener('change', _triggerAvailCheck);
  typeEl.addEventListener('change', _triggerAvailCheck);

  roomEl.addEventListener('change', () => {
    const chosen = _availRooms.find(r => r.roomnumber === roomEl.value);
    if (chosen && typeEl) typeEl.value = chosen.roomType;
    _priceLocked = false;
    _updatePriceField();
  });
}

async function _triggerAvailCheck() {
  const checkIn  = _resEl('resFormCheckIn')?.value;
  const checkOut = _resEl('resFormCheckOut')?.value;
  const roomType = _resEl('resFormRoomType')?.value || '';
  const roomEl   = _resEl('resFormRoomNumber');
  const hint     = _resEl('resFormRoomHint');

  if (!roomEl) return;

  if (!checkIn || !checkOut) {
    _resetRoomSelect('Choisissez les dates d\'abord', true);
    if (hint) { hint.textContent = ''; hint.className = 'res-avail-hint'; }
    return;
  }
  if (!roomType) {
    _resetRoomSelect('Choisissez un type de chambre', true);
    if (hint) { hint.textContent = '⚠️ Sélectionnez un type de chambre'; hint.className = 'res-avail-hint'; }
    return;
  }

  _resetRoomSelect('⏳ Recherche…', true);
  if (hint) { hint.textContent = ''; hint.className = 'res-avail-hint'; }

  try {
    const res  = await fetch(AVAIL_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkInDate:  checkIn,
        checkOutDate: checkOut,
        roomType,
        excludeReservationId: _resEditMode ? (_resEl('resFormId')?.value || null) : null,
      }),
    });
    const data = await res.json();

    if (data.status === 'error') {
      _resetRoomSelect('Erreur : ' + data.message, true);
      if (hint) { hint.textContent = '⚠️ ' + data.message; hint.className = 'res-avail-hint hint-error'; }
      return;
    }

    _availRooms = data.rooms || [];

    if (!_availRooms.length) {
      _resetRoomSelect('Aucune chambre disponible', true);
      if (hint) { hint.textContent = '❌ Aucune chambre disponible'; hint.className = 'res-avail-hint hint-unavail'; }
      return;
    }

    roomEl.innerHTML = '<option value="">— Choisir une chambre —</option>';
    _availRooms.forEach(r => {
      const o = document.createElement('option');
      o.value = r.roomnumber;
      o.textContent = `${r.roomnumber}  (${r.roomType} — ${parseFloat(r.price || 0).toLocaleString('fr-FR')} TND/nuit)`;
      roomEl.appendChild(o);
    });
    roomEl.disabled = false;

    if (hint) {
      hint.textContent = `✅ ${_availRooms.length} chambre${_availRooms.length > 1 ? 's' : ''} disponible${_availRooms.length > 1 ? 's' : ''}`;
      hint.className   = 'res-avail-hint hint-ok';
    }

    _priceLocked = false;
    _updatePriceField();

  } catch (err) {
    _resetRoomSelect('Erreur réseau', true);
    if (hint) { hint.textContent = '❌ ' + err.message; hint.className = 'res-avail-hint hint-error'; }
  }
}

function _resetRoomSelect(placeholder, disabled = true) {
  const roomEl = _resEl('resFormRoomNumber');
  if (!roomEl) return;
  roomEl.innerHTML = `<option value="">${placeholder}</option>`;
  roomEl.disabled  = disabled;
  _availRooms = [];
}

// ═══════════════════════════════════════════════════════════
//  FETCH — chargement
// ═══════════════════════════════════════════════════════════

async function loadReservations() {
  _resShowLoading(true);
  try {
    const res  = await fetch(RES_API, { cache: 'no-store' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Erreur API');
    _resAll = (data.data || []).filter(r =>
      ['En attente', 'Confirmée', 'Checked_in', 'Checked_out'].includes(r.Status)
    );
    _populateResFilterDropdowns(
      ['En attente', 'Confirmée', 'Checked_in', 'Checked_out'],
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

// ═══════════════════════════════════════════════════════════
//  FILTRAGE LIVE
// ═══════════════════════════════════════════════════════════

function _getResFilters() {
  return {
    search:   _resEl('resFilterSearch')?.value.trim().toLowerCase() || '',
    status:   _resEl('resFilterStatus')?.value   || '',
    roomType: _resEl('resFilterRoomType')?.value || '',
    dateFrom: _resEl('resFilterDateFrom')?.value || '',
    dateTo:   _resEl('resFilterDateTo')?.value   || '',
  };
}

function _resApplyFilters() {
  const f = _getResFilters();
  let filtered = _resAll.filter(r => {
    const search = `${r.clientName} ${r.email}`.toLowerCase();
    if (f.search   && !search.includes(f.search))    return false;
    if (f.status   && r.Status   !== f.status)       return false;
    if (f.roomType && r.roomType !== f.roomType)      return false;
    if (f.dateFrom && r.checkInDate < f.dateFrom)    return false;
    if (f.dateTo   && r.checkInDate > f.dateTo)      return false;
    return true;
  });
  filtered = _resSortData(filtered, _resSortCol, _resSortDir);
  _resRenderTable(filtered, f.search);
  _resUpdateBadge(filtered.length);
}

// ═══════════════════════════════════════════════════════════
//  TRI
// ═══════════════════════════════════════════════════════════

function _resSortData(data, col, dir) {
  return [...data].sort((a, b) => {
    let va = a[col] ?? '', vb = b[col] ?? '';
    if (['id','totalPrice','numberOfAdults'].includes(col)) {
      va = parseFloat(va) || 0; vb = parseFloat(vb) || 0;
    } else {
      va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
    }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ?  1 : -1;
    return 0;
  });
}

function _resHandleSort(col) {
  _resSortDir = (_resSortCol === col && _resSortDir === 'asc') ? 'desc' : 'asc';
  _resSortCol = col;
  _resUpdateSortHeaders();
  _resApplyFilters();
}

function _resUpdateSortHeaders() {
  document.querySelectorAll('.res-full-table th[data-col]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === _resSortCol)
      th.classList.add(_resSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

// ═══════════════════════════════════════════════════════════
//  RENDER TABLE
// ═══════════════════════════════════════════════════════════

function _resClientScore(r) {
  const total  = parseInt(r._hist_total)       || 0;
  const fiable = parseInt(r._hist_fiables)     || 0;
  const annul  = parseInt(r._hist_annulations) || 0;

  if (total < 3) return {
    cls:   'score-new',
    icon:  '🔘',
    label: 'Nouveau',
    title: `${total} rés. — données insuffisantes`,
  };

  const pct = Math.round((fiable / total) * 100);

  if (pct >= 80) return {
    cls:   'score-ok',
    icon:  '🟢',
    label: `${pct}%`,
    title: `${fiable}/${total} rés. honorées · ${annul} annulation(s)`,
  };
  if (pct >= 50) return {
    cls:   'score-mid',
    icon:  '🟡',
    label: `${pct}%`,
    title: `${fiable}/${total} rés. honorées · ${annul} annulation(s)`,
  };
  return {
    cls:   'score-bad',
    icon:  '🔴',
    label: `${pct}%`,
    title: `${fiable}/${total} rés. honorées · ${annul} annulation(s)`,
  };
}

function _resRenderTable(list, search = '') {
  const tbody = _resEl('resTbody');
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `
      <tr><td colspan="9">
        <div class="res-table-empty">
          <div class="ei">🔍</div>
          <p>Aucune réservation ne correspond aux filtres</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(r => {
    const sm    = _resStatusMeta(r.Status);
    const cin   = _resFmtDate(r.checkInDate);
    const cout  = _resFmtDate(r.checkOutDate);
    const price = _resFmtMoney(r.totalPrice);
    const score = _resClientScore(r);

    const showScore = ['En attente', 'Confirmée'].includes(r.Status);

    let actions = '';

    if (r.Status === 'En attente') {
      actions += `
        <button class="res-btn-icon confirm" onclick="_resQuickStatus(${r.id},'Confirmée',this)" title="Confirmer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </button>`;
      actions += `
        <button class="res-btn-icon cancel-status" onclick="_resQuickStatus(${r.id},'Refusé',this)" title="Refuser">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`;
    } else if (r.Status === 'Confirmée') {
      actions += `
        <button class="res-btn-icon cancel-status" onclick="_resQuickStatus(${r.id},'Annulé',this)" title="Annuler">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>`;
    }

    actions += `
      <button class="res-btn-icon edit" onclick="_resOpenEdit(${r.id})" title="Modifier">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="res-btn-icon del" onclick="_resOpenConfirmDelete(${r.id},'${_resEscAttr(r.clientName)}')" title="Supprimer">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
        </svg>
      </button>`;

    return `
      <tr data-id="${r.id}">
        <td class="res-id">#${r.id}</td>

        <td>
          <div class="res-client">${_resEsc(r.clientName || '—')}</div>
          <div class="res-email">${_resEsc(r.email || '')}</div>
        </td>

        <td style="white-space:nowrap;font-size:.72rem;">${_resEsc(r.phoneNumber || '—')}</td>

        <td class="res-dates">
          ${cin}<br>
          <span style="color:var(--text-muted);font-size:.68rem;">→ ${cout}</span>
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

        <td>
          <span class="res-badge ${sm.cls}">${sm.label}</span>
          ${showScore ? `
          <div style="margin-top:5px;">
            <span class="res-score ${score.cls}" title="${score.title}">
              ${score.icon} ${score.label}
            </span>
          </div>` : ''}
        </td>

        <td><div class="res-action-group">${actions}</div></td>
      </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
//  CHANGEMENT RAPIDE DE STATUT
//  ✉️  Toast spécial si email de confirmation envoyé
// ═══════════════════════════════════════════════════════════

async function _resQuickStatus(id, newStatus, btn) {
  if (!confirm(`Changer le statut à "${newStatus}" ?`)) return;
  btn.disabled = true;
  try {
    const res  = await fetch(RES_API, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, Status: newStatus }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    // ── Feedback selon résultat email ──────────────────────
    if (newStatus === 'Confirmée') {
      if (data.email_sent) {
        _resToast('✅ Réservation confirmée — 📧 Email envoyé au client', 'success');
      } else {
        // Confirmation OK mais email en échec : on avertit sans bloquer
        _resToast('✅ Réservation confirmée — ⚠️ Email non envoyé (vérifiez la config SMTP)', 'warning');
      }
    } else {
      _resToast('✅ Statut mis à jour', 'success');
    }

    await loadReservations();
  } catch (err) {
    _resToast('❌ ' + err.message, 'error');
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
//  MODAL — Ouvrir Ajouter
// ═══════════════════════════════════════════════════════════

function _resOpenAdd() {
  _resEditMode = false;
  _priceLocked = false;
  _resEl('resFormTitle').textContent = '➕ Nouvelle réservation';
  _resEl('resFormId').value          = '';
  _resEl('resFormBtn').innerHTML     = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Créer';

  _resResetForm();

  const today = new Date().toISOString().split('T')[0];
  const ci = _resEl('resFormCheckIn');
  const co = _resEl('resFormCheckOut');
  if (ci) ci.min = today;
  if (co) co.min = today;

  _resOpenModal('resFormModal');
}

// ═══════════════════════════════════════════════════════════
//  MODAL — Ouvrir Modifier
// ═══════════════════════════════════════════════════════════

async function _resOpenEdit(id) {
  const r = _resAll.find(x => String(x.id) === String(id));
  if (!r) return;

  _resEditMode = true;
  _priceLocked = true;

  _resEl('resFormTitle').textContent = '✏️ Modifier la réservation';
  _resEl('resFormId').value          = r.id;
  _resEl('resFormBtn').innerHTML     = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Enregistrer';

  const ci = _resEl('resFormCheckIn');
  const co = _resEl('resFormCheckOut');
  if (ci) { ci.removeAttribute('min'); ci.value = r.checkInDate  || ''; }
  if (co) { co.removeAttribute('min'); co.value = r.checkOutDate || ''; }

  _resEl('resFormClient').value   = r.clientName       || '';
  _resEl('resFormEmail').value    = r.email            || '';
  _resEl('resFormPhone').value    = r.phoneNumber      || '';
  _resEl('resFormAdults').value   = r.numberOfAdults   ?? 1;
  _resEl('resFormChildren').value = r.numberOfChildren ?? 0;
  _resEl('resFormPension').value  = r.pension          || '';
  _resEl('resFormPrice').value    = r.totalPrice       || '';
  _resEl('resFormStatus').value   = r.Status           || 'En attente';

  const payEl = _resEl('resFormPayment');
  if (payEl) payEl.value = r.paymentDetails || '';

  const typeEl = _resEl('resFormRoomType');
  if (typeEl) typeEl.value = r.roomType || '';

  const roomEl = _resEl('resFormRoomNumber');
  const hint   = _resEl('resFormRoomHint');
  if (roomEl) {
    roomEl.innerHTML = `<option value="${_resEsc(r.roomNumber || '')}" selected>${_resEsc(r.roomNumber || '—')} (actuel)</option>`;
    roomEl.disabled  = false;

    if (hint) { hint.textContent = '⏳ Vérification des disponibilités…'; hint.className = 'res-avail-hint'; }

    _loadAvailForEdit(r.checkInDate, r.checkOutDate, r.roomType, r.roomNumber, r.id);
  }

  _showPriceHint(parseFloat(r.totalPrice) || 0);
  _resOpenModal('resFormModal');
}

async function _loadAvailForEdit(checkIn, checkOut, roomType, currentRoom, reservationId) {
  const roomEl = _resEl('resFormRoomNumber');
  const hint   = _resEl('resFormRoomHint');
  if (!roomEl) return;

  try {
    const res = await fetch(AVAIL_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkInDate:  checkIn,
        checkOutDate: checkOut,
        roomType:     roomType || '',
        excludeReservationId: reservationId,
      }),
    });
    const data = await res.json();

    _availRooms = data.rooms || [];

    const alreadyIn = _availRooms.some(rm => rm.roomnumber === currentRoom);
    if (!alreadyIn && currentRoom) {
      _availRooms.unshift({ roomnumber: currentRoom, roomType: roomType, price: 0, _current: true });
    }

    if (!_availRooms.length) {
      if (hint) { hint.textContent = '⚠️ Aucune autre chambre disponible'; hint.className = 'res-avail-hint'; }
      return;
    }

    const prevValue = roomEl.value || currentRoom;
    roomEl.innerHTML = '<option value="">— Choisir une chambre —</option>';
    _availRooms.forEach(r => {
      const o = document.createElement('option');
      o.value = r.roomnumber;
      const suffix = r._current ? ' ★ actuel' : ` — ${parseFloat(r.price || 0).toLocaleString('fr-FR')} TND/nuit`;
      o.textContent = `${r.roomnumber}  (${r.roomType}${suffix})`;
      roomEl.appendChild(o);
    });
    roomEl.disabled = false;
    roomEl.value = prevValue;

    if (hint) {
      const n = _availRooms.length;
      hint.textContent = `✅ ${n} chambre${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''}`;
      hint.className   = 'res-avail-hint hint-ok';
    }

  } catch (err) {
    if (hint) { hint.textContent = '⚠️ Dispo non vérifiée (erreur réseau)'; hint.className = 'res-avail-hint'; }
  }
}

// ═══════════════════════════════════════════════════════════
//  SOUMETTRE LE FORMULAIRE
//  ✉️  Toast selon résultat email si statut = "Confirmée"
// ═══════════════════════════════════════════════════════════

async function _resSubmitForm() {
  const id         = _resEl('resFormId').value;
  const clientName = _resEl('resFormClient').value.trim();
  const email      = _resEl('resFormEmail').value.trim();
  const checkIn    = _resEl('resFormCheckIn').value;
  const checkOut   = _resEl('resFormCheckOut').value;
  const roomType   = _resEl('resFormRoomType').value.trim();
  const roomNumber = _resEl('resFormRoomNumber').value.trim();
  const price      = _resEl('resFormPrice').value;
  const newStatus  = _resEl('resFormStatus').value;

  if (!clientName || !email || !checkIn || !checkOut || !roomType || !price) {
    _resToast('⚠️ Veuillez remplir tous les champs obligatoires', 'error');
    return;
  }
  if (!roomNumber) {
    _resToast('⚠️ Veuillez sélectionner un numéro de chambre', 'error');
    return;
  }
  if (checkOut <= checkIn) {
    _resToast('⚠️ La date de départ doit être après la date d\'arrivée', 'error');
    return;
  }

  const payload = {
    clientName,
    email,
    phoneNumber:      _resEl('resFormPhone').value.trim(),
    checkInDate:      checkIn,
    checkOutDate:     checkOut,
    roomType,
    roomNumber,
    numberOfAdults:   parseInt(_resEl('resFormAdults').value)   || 1,
    numberOfChildren: parseInt(_resEl('resFormChildren').value) || 0,
    paymentDetails:   _resEl('resFormPayment').value,
    pension:          _resEl('resFormPension').value.trim(),
    totalPrice:       parseFloat(price),
    status:           newStatus,
    Status:           newStatus,
  };

  if (_resEditMode && id) payload.id = parseInt(id);

  const btn = _resEl('resFormBtn');
  btn.disabled    = true;
  btn.textContent = '⏳ En cours…';

  try {
    const res  = await fetch(RES_API, {
      method:  _resEditMode ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    _resCloseModal('resFormModal');

    // ── Toast avec feedback email si "Confirmée" ──────────
    if (_resEditMode && newStatus === 'Confirmée') {
      if (data.email_sent) {
        _resToast('✅ Réservation confirmée — 📧 Email envoyé au client', 'success');
      } else {
        _resToast('✅ Réservation confirmée — ⚠️ Email non envoyé (vérifiez SMTP)', 'warning');
      }
    } else {
      _resToast(_resEditMode ? '✅ Réservation modifiée' : '✅ Réservation créée', 'success');
    }

    await loadReservations();
  } catch (err) {
    _resToast('❌ ' + err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = _resEditMode ? 'Enregistrer' : 'Créer';
  }
}

// ═══════════════════════════════════════════════════════════
//  MODAL CONFIRM DELETE
// ═══════════════════════════════════════════════════════════

function _resOpenConfirmDelete(id, name) {
  _resDeleteId = id;
  const p = _resEl('resConfirmText');
  if (p) p.textContent = `Supprimer la réservation de "${name}" ? Cette action est irréversible.`;
  _resOpenModal('resConfirmModal');
}

async function _resConfirmDelete() {
  if (!_resDeleteId) return;
  const btn = _resEl('resConfirmBtn');
  btn.disabled = true; btn.textContent = '⏳ Suppression…';
  try {
    const res  = await fetch(RES_API, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: _resDeleteId }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    _resCloseModal('resConfirmModal');
    _resToast('🗑️ Réservation supprimée', 'success');
    await loadReservations();
  } catch (err) {
    _resToast('❌ ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Supprimer';
    _resDeleteId = null;
  }
}

// ═══════════════════════════════════════════════════════════
//  DROPDOWNS FILTRES
// ═══════════════════════════════════════════════════════════

function _populateResFilterDropdowns(statusList, roomTypes) {
  const sel = _resEl('resFilterStatus');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">Tous les statuts</option>';
    const allStatuses = [...new Set([...statusList])];
    allStatuses.forEach(s => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      if (s === cur) o.selected = true;
      sel.appendChild(o);
    });
  }
  const rt = _resEl('resFilterRoomType');
  if (rt) {
    const cur = rt.value;
    rt.innerHTML = '<option value="">Tous les types</option>';
    roomTypes.forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      if (t === cur) o.selected = true;
      rt.appendChild(o);
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  BIND
// ═══════════════════════════════════════════════════════════

function _bindResFilters() {
  const debounced = _resDebounce(_resApplyFilters, 280);
  _resEl('resFilterSearch')?.addEventListener('input',   debounced);
  _resEl('resFilterStatus')?.addEventListener('change',  _resApplyFilters);
  _resEl('resFilterRoomType')?.addEventListener('change',_resApplyFilters);
  _resEl('resFilterDateFrom')?.addEventListener('change',_resApplyFilters);
  _resEl('resFilterDateTo')?.addEventListener('change',  _resApplyFilters);
  _resEl('resBtnResetFilters')?.addEventListener('click', () => {
    ['resFilterSearch','resFilterStatus','resFilterRoomType','resFilterDateFrom','resFilterDateTo']
      .forEach(id => { const el = _resEl(id); if (el) el.value = ''; });
    _resApplyFilters();
  });
  _resEl('btnAddReservation')?.addEventListener('click', _resOpenAdd);
}

function _bindResModals() {
  _resEl('resFormClose')?.addEventListener('click',   () => _resCloseModal('resFormModal'));
  _resEl('resFormCancel')?.addEventListener('click',  () => _resCloseModal('resFormModal'));
  _resEl('resFormBtn')?.addEventListener('click',     _resSubmitForm);
  _resEl('resFormModal')?.addEventListener('click', e => {
    if (e.target === _resEl('resFormModal')) _resCloseModal('resFormModal');
  });
  _resEl('resConfirmClose')?.addEventListener('click',  () => _resCloseModal('resConfirmModal'));
  _resEl('resConfirmCancel')?.addEventListener('click', () => _resCloseModal('resConfirmModal'));
  _resEl('resConfirmBtn')?.addEventListener('click',    _resConfirmDelete);
  _resEl('resConfirmModal')?.addEventListener('click', e => {
    if (e.target === _resEl('resConfirmModal')) _resCloseModal('resConfirmModal');
  });
}

function _bindResSortHeaders() {
  document.querySelectorAll('.res-full-table th[data-col]').forEach(th => {
    th.addEventListener('click', () => _resHandleSort(th.dataset.col));
  });
  _resUpdateSortHeaders();
}

// ═══════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════

function _resShowLoading(v) {
  const lm = _resEl('loadingMsgRes');
  const ct = _resEl('resTableContainer');
  if (lm) lm.style.display = v ? 'block' : 'none';
  if (ct) ct.style.opacity = v ? '.5' : '1';
}

function _resShowTableError(msg) {
  const tbody = _resEl('resTbody');
  if (tbody) {
    tbody.innerHTML = `
      <tr><td colspan="9">
        <div class="res-table-empty"><div class="ei">❌</div><p>${_resEsc(msg)}</p></div>
      </td></tr>`;
  }
}

function _resUpdateBadge(n) {
  const el = _resEl('resBadgeCount');
  if (el) el.textContent = `${n} réservation${n > 1 ? 's' : ''}`;
}

function _resOpenModal(id)  { _resEl(id)?.classList.add('open'); }
function _resCloseModal(id) { _resEl(id)?.classList.remove('open'); }

function _resResetForm() {
  ['resFormClient','resFormEmail','resFormPhone','resFormCheckIn','resFormCheckOut',
   'resFormPension','resFormPrice'].forEach(id => {
    const el = _resEl(id); if (el) el.value = '';
  });
  const a = _resEl('resFormAdults');   if (a) a.value = 1;
  const c = _resEl('resFormChildren'); if (c) c.value = 0;
  const typeEl = _resEl('resFormRoomType'); if (typeEl) typeEl.value = '';
  const payEl  = _resEl('resFormPayment'); if (payEl)  payEl.value  = '';
  const statEl = _resEl('resFormStatus'); if (statEl) statEl.value  = 'En attente';
  _resetRoomSelect('Choisissez les dates et le type d\'abord', true);
  const hint = _resEl('resFormRoomHint');
  if (hint) { hint.textContent = ''; hint.className = 'res-avail-hint'; }
  _priceLocked = false;
  _hidePriceHint();
}

// ── Toast — supporte aussi le type "warning" ──────────────
function _resToast(msg, type = 'success') {
  const t = _resEl('resGlobalToast');
  if (!t) return;
  clearTimeout(_resToastTimer);
  t.textContent = msg;
  t.className   = `res-toast ${type} show`;
  _resToastTimer = setTimeout(() => t.classList.remove('show'), 4500);
}

// ── Utilitaires ──
function _resEl(id) { return document.getElementById(id); }
function _resDebounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function _resFmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('fr-FR'); } catch { return d; }
}
function _resFmtMoney(n) {
  return (parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0 }) + ' TND';
}
function _resEsc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _resEscAttr(str) { return _resEsc(str).replace(/'/g,"&#39;"); }
function _resHighlight(str, term) {
  if (!term) return str;
  const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return str.replace(re, '<mark>$1</mark>');
}

// ── Métadonnées statut ────────────────────────────────────
function _resStatusMeta(s) {
  const k = String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if (k === 'confirmee'  || k === 'confirmée')                                  return { cls: 'confirmée',   label: 'Confirmée'   };
  if (k === 'en attente' || k === 'pending')                                    return { cls: 'pending',     label: 'En attente'  };
  if (['annule','annulee','cancelled','canceled','annulé'].includes(k))          return { cls: 'cancelled',   label: 'Annulé'      };
  if (k === 'refuse'     || k === 'refusé')                                     return { cls: 'refused',     label: 'Refusé'      };
  if (k === 'checked_in' || k === 'checked in')                                 return { cls: 'checked_in',  label: 'Checked in'  };
  if (k === 'checked_out'|| k === 'checked out')                                return { cls: 'checked_out', label: 'Checked out' };
  if (k === 'complete'   || k === 'completé' || k === 'completed')              return { cls: 'completed',   label: 'Completé'    };
  if (k === 'supprime'   || k === 'supprimé')                              return { cls: 'supprime',   label: 'Supprimé'    };
  return { cls: k.replace(/\s+/g,'_'), label: s || '—' };
}