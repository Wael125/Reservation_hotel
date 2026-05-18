(function () {
  'use strict';

  const API = 'gestion_reservation.php';
  const AVAIL_API = 'check_availability.php';

  const ROOM_PRICES = {
    simple: { adult: 100, child: 50 },
    double: { adult: 120, child: 60 },
    triple: { adult: 130, child: 65 },
    suite:  { adult: 150, child: 75 },
  };
  const PENSION_PRICES = {
    '': 0,
    'sans_pension': 0,
    'Logement seul': 0,
    'logement_seul': 0,
    'petit_dejeuner': 15,
    'Petit-déjeuner': 15,
    'Petit-déjeuner inclus': 15,
    'petit_dejeuner_inclus': 15,
    'demi_pension': 30,
    'Demi-pension': 30,
    'pension_complete': 40,
    'Pension complète': 40,
    'tout_inclus': 55,
    'All inclusive': 55,
    'all_inclusive': 55,
  };

  let allReservations        = [];
  let activeFilter           = 'all';
  let editingId              = null;
  let cancellingId           = null;
  let editAvailableRooms     = [];
  let editAssignedRoomNumber = '';
  
  // Données admin
  let roomTypes       = [];
  let pensions        = ['Logement seul', 'Petit-déjeuner inclus', 'Demi-pension', 'Pension complète', 'All inclusive'];
  let paymentMethods  = ['Carte bancaire', 'Espèces', 'Virement', 'Chèque'];

  /* ─────────────────────────────────────────
     INIT
  ───────────────────────────────────────── */
  function init() {
    injectHTML();

    allReservations = Array.isArray(window.RESERVATIONS) ? window.RESERVATIONS : [];
    
    // Récupérer les types de chambres depuis la BD
    fetchRoomTypes();

    document.getElementById('resFilterAll')?.addEventListener('click',       () => setFilter('all'));
    document.getElementById('resFilterUpcoming')?.addEventListener('click',  () => setFilter('upcoming'));
    document.getElementById('resFilterActive')?.addEventListener('click',    () => setFilter('active'));
    document.getElementById('resFilterDone')?.addEventListener('click',      () => setFilter('done'));
    document.getElementById('resFilterCancelled')?.addEventListener('click', () => setFilter('cancelled'));

    document.getElementById('editOverlay')?.addEventListener('click',    closeEditModal);
    document.getElementById('confirmOverlay')?.addEventListener('click', closeConfirmModal);
    document.getElementById('invoiceOverlay')?.addEventListener('click', closeInvoiceModal);

    bindEditAvailabilityLogic();

    patchTopbar();
    injectDashboardStats();
  }
  
  /* ─────────────────────────────────────────
     FETCH ROOM TYPES FROM DATABASE
  ───────────────────────────────────────── */
  function fetchRoomTypes() {
    fetch('gestion_chambres.php')
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.data)) {
          const uniqueTypes = [...new Set(data.data.map(r => r.roomType).filter(Boolean))];
          roomTypes = uniqueTypes.sort();
          // Pré-remplir les selects dans le formulaire
          populateRoomTypeSelects();
        }
      })
      .catch(err => console.log('Erreur récupération types chambres:', err));
  }
  
  /* ─────────────────────────────────────────
     POPULATE ROOM TYPE SELECTS
  ───────────────────────────────────────── */
  function populateRoomTypeSelects() {
    const roomTypeSelect = document.getElementById('editRoomType');
    if (roomTypeSelect && roomTypes.length) {
      // Garder l'option "Sélectionner"
      const firstOption = roomTypeSelect.querySelector('option');
      roomTypeSelect.innerHTML = '';
      if (firstOption) roomTypeSelect.appendChild(firstOption);
      roomTypes.forEach(type => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type;
        roomTypeSelect.appendChild(opt);
      });
    }
  }

  function bindEditAvailabilityLogic() {
    const checkIn  = document.getElementById('editCheckIn');
    const checkOut = document.getElementById('editCheckOut');
    const roomType = document.getElementById('editRoomType');
    const pension  = document.getElementById('editPension');
    const adults   = document.getElementById('editAdults');
    const children = document.getElementById('editChildren');

    if (!checkIn || !checkOut || !roomType) return;

    checkIn.addEventListener('change', () => {
      if (checkIn.value && checkOut.value && checkOut.value <= checkIn.value) {
        checkOut.value = '';
      }
      checkEditAvailability();
    });

    checkOut.addEventListener('change', checkEditAvailability);
    roomType.addEventListener('change', checkEditAvailability);

    [checkIn, checkOut, roomType, pension, adults, children].forEach(el => {
      el?.addEventListener('change', updateEditPricePreview);
      el?.addEventListener('input', updateEditPricePreview);
    });
  }

  function updateEditRoomAvailabilityHint(message, cssClass = '') {
    const hint = document.getElementById('editRoomHint');
    if (!hint) return;
    hint.textContent = message;
    hint.className = 'res-avail-hint' + (cssClass ? ' ' + cssClass : '');
  }

  async function checkEditAvailability() {
    const checkIn  = getVal('editCheckIn');
    const checkOut = getVal('editCheckOut');
    const roomType = getVal('editRoomType');
    const info     = document.getElementById('editRoomInfo');
    const currentReservation = allReservations.find(r => r.id == editingId);
    const currentRoomNumber  = currentReservation?.roomNumber || editAssignedRoomNumber || '';
    const keepsCurrentStay   = currentReservation
      && currentReservation.checkInDate === checkIn
      && currentReservation.checkOutDate === checkOut
      && currentReservation.roomType === roomType;

    updateEditPricePreview();

    if (info) {
      info.textContent = 'La chambre sera attribuée automatiquement selon le type et les dates.';
    }

    if (!checkIn || !checkOut) {
      updateEditRoomAvailabilityHint('Sélectionnez d\'abord les dates.', '');
      return;
    }

    if (!roomType) {
      editAssignedRoomNumber = '';
      updateEditRoomAvailabilityHint('⚠️ Sélectionnez un type de chambre.', 'hint-error');
      return;
    }

    editAssignedRoomNumber = keepsCurrentStay ? currentRoomNumber : '';
    updateEditRoomAvailabilityHint('⏳ Vérification des disponibilités…', '');

    try {
      const res  = await fetch(AVAIL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkInDate:  checkIn,
          checkOutDate: checkOut,
          roomType,
          excludeReservationId: editingId || null,
        }),
      });
      const data = await res.json();

      if (!data || data.status === 'error' || !Array.isArray(data.rooms)) {
        updateEditRoomAvailabilityHint(data?.message ? '⚠️ ' + data.message : '❌ Erreur disponibilité', 'hint-error');
        return;
      }

      editAvailableRooms = data.rooms;
      if (!editAvailableRooms.length) {
        if (keepsCurrentStay && currentRoomNumber) {
          editAssignedRoomNumber = currentRoomNumber;
          updateEditRoomAvailabilityHint('Chambre actuelle conservée.', 'hint-ok');
          if (info) {
            info.textContent = `Numéro de chambre conservé : ${currentRoomNumber}`;
          }
          return;
        }

        updateEditRoomAvailabilityHint('❌ Aucune chambre disponible.', 'hint-unavail');
        if (info) {
          info.textContent = 'Aucune chambre ne peut être attribuée pour ces dates.';
        }
        return;
      }

      const assignedRoom = editAvailableRooms.find(room =>
        String(room.roomnumber || '') === String(currentRoomNumber || '')
      ) || editAvailableRooms[0];
      editAssignedRoomNumber = assignedRoom.roomnumber || '';
      if (info) {
        info.textContent = assignedRoom.roomnumber
          ? `Numéro de chambre attribué : ${assignedRoom.roomnumber}`
          : 'Une chambre sera attribuée automatiquement.';
      }
      updateEditRoomAvailabilityHint('', '');
    } catch (err) {
      updateEditRoomAvailabilityHint('❌ Erreur réseau. Veuillez réessayer.', 'hint-error');
    }
  }

  function normalizePriceKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\s-]+/g, '_');
  }

  function normalizeRoomPriceKey(roomType) {
    const key = normalizePriceKey(roomType);
    if (key.includes('simple')) return 'simple';
    if (key.includes('double')) return 'double';
    if (key.includes('triple')) return 'triple';
    if (key.includes('suite')) return 'suite';
    return key;
  }

  function getPensionPrice(pension) {
    if (Object.prototype.hasOwnProperty.call(PENSION_PRICES, pension)) {
      return PENSION_PRICES[pension];
    }
    return PENSION_PRICES[normalizePriceKey(pension)] ?? 0;
  }

  function calculateReservationPrice(values) {
    const checkIn  = values.checkInDate;
    const checkOut = values.checkOutDate;
    const roomType = normalizeRoomPriceKey(values.roomType);
    const adults   = parseInt(values.numberOfAdults, 10) || 1;
    const children = parseInt(values.numberOfChildren, 10) || 0;

    if (!checkIn || !checkOut || !roomType) return null;

    const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
    if (nights <= 0) return null;

    const tariff = ROOM_PRICES[roomType];
    if (!tariff) return null;

    const roomTotal    = nights * ((adults * tariff.adult) + (children * tariff.child));
    const pensionTotal = nights * getPensionPrice(values.pension) * (adults + children);

    return Math.round(roomTotal + pensionTotal);
  }

  function calculateEditFormPrice() {
    return calculateReservationPrice({
      checkInDate:      getVal('editCheckIn'),
      checkOutDate:     getVal('editCheckOut'),
      roomType:         getVal('editRoomType'),
      pension:          getVal('editPension'),
      numberOfAdults:   getVal('editAdults'),
      numberOfChildren: getVal('editChildren'),
    });
  }

  function updateEditPricePreview() {
    const notice = document.getElementById('editPriceNotice');
    if (!notice) return null;

    const price  = calculateEditFormPrice();
    const nights = calcNights(getVal('editCheckIn'), getVal('editCheckOut'));

    if (price === null) {
      notice.textContent = 'Le total sera recalculé automatiquement après le choix des dates et du type de chambre.';
      return null;
    }

    notice.innerHTML = `Total recalculé : <strong>${formatPrice(price)}</strong> TTC pour ${nights} nuit${nights > 1 ? 's' : ''}.`;
    return price;
  }

  /* ─────────────────────────────────────────
     PATCH TOPBAR
  ───────────────────────────────────────── */
  function patchTopbar() {
    const nameEl = document.querySelector('.topbar-name');
    if (nameEl && window.CLIENT_NOM) {
      const prenom = window.CLIENT_PRENOM || '';
      const nom    = (window.CLIENT_NOM || '').replace(prenom, '').trim();
      nameEl.innerHTML = `${escHtml(prenom)} <em>${escHtml(nom)}</em>`;
    }
    const sidebarName = document.querySelector('.sidebar-user-name');
    if (sidebarName && window.CLIENT_NOM) sidebarName.textContent = window.CLIENT_NOM;

    const initiale = (window.CLIENT_PRENOM || '').charAt(0).toUpperCase() || 'C';
    document.querySelectorAll('.sidebar-avatar, .mobile-avatar').forEach(el => {
      el.textContent = initiale;
    });

    const welcomeBubble = document.querySelector('.chat-welcome strong');
    if (welcomeBubble && window.CLIENT_PRENOM) welcomeBubble.textContent = window.CLIENT_PRENOM;
  }

  /* ─────────────────────────────────────────
     STATS DASHBOARD
  ───────────────────────────────────────── */
  function injectDashboardStats() {
    const stats    = window.STATS || {};
    const statVals = document.querySelectorAll('.stat-card-value');
    const statSubs = document.querySelectorAll('.stat-card-sub');

    if (statVals[0]) statVals[0].textContent = stats.total ?? allReservations.length;

    /* Statut fidélité */
    const loyalty = stats.loyalty || calcLoyaltyFromReservations();
    if (statVals[1]) {
      statVals[1].textContent = loyalty.status;
      statVals[1].classList.add('loyalty-status-val');
    }
    if (statSubs[1]) statSubs[1].textContent = loyalty.sub;
    injectLoyaltyCard(loyalty);

    if (statVals[2]) {
      if (stats.nextStay) {
        statVals[2].textContent = formatDateFr(stats.nextStay.checkInDate);
        if (statSubs[2]) statSubs[2].textContent = stats.nextStay.roomType || '';
      } else {
        statVals[2].textContent = '—';
        if (statSubs[2]) statSubs[2].textContent = 'Aucun séjour planifié';
      }
    }

    if (statVals[3]) {
      statVals[3].textContent = formatPrice(stats.totalSpent ?? 0);
      if (statSubs[3]) statSubs[3].textContent = `sur ${stats.total ?? 0} réservation(s)`;
    }

    if (stats.nextStay) injectFeaturedBooking(stats.nextStay);
    injectHistoryTable();
    initCheckinBanner();
  }

  function calcLoyaltyFromReservations() {
    const done = allReservations.filter(r =>
      ['Terminée','Complétée','Checked-out','Completé','Completed'].includes(normalizeStatus(r.status || r.Status))
    ).length;

    if (done >= 10) return { status: 'Platinum', sub: 'Membre privilégié', pts: done * 120, next: null,    nextPts: 0,   pct: 100 };
    if (done >= 5)  return { status: 'Gold',     sub: 'Client fidèle',     pts: done * 100, next: 'Platinum', nextPts: 10 * 120, pct: Math.round((done / 10) * 100) };
    if (done >= 2)  return { status: 'Silver',   sub: 'Client régulier',   pts: done * 80,  next: 'Gold',     nextPts: 5 * 100,  pct: Math.round((done / 5)  * 100) };
    return             { status: 'Bronze',   sub: 'Nouveau client',    pts: done * 50,  next: 'Silver',   nextPts: 2 * 80,   pct: Math.round((done / 2)  * 100) };
  }

  function injectLoyaltyCard(loyalty) {
    const lblEl  = document.getElementById('loyaltyStatusLabel');
    const badgeEl = document.getElementById('loyaltyBadge');
    const badgeTxt = document.getElementById('loyaltyBadgeText');
    const ptsEl  = document.getElementById('loyaltyPts');
    const nextEl = document.getElementById('loyaltyNextLabel');
    const fillEl = document.getElementById('loyaltyBarFill');
    const perksEl= document.getElementById('loyaltyPerks');

    if (lblEl)   lblEl.textContent    = loyalty.status;
    if (badgeTxt)badgeTxt.textContent = loyalty.status;
    if (ptsEl)   ptsEl.textContent    = `${loyalty.pts} pts`;
    if (nextEl)  nextEl.textContent   = loyalty.next ? `Prochain : ${loyalty.next}` : 'Niveau maximum';
    if (fillEl)  fillEl.style.width   = `${Math.min(loyalty.pct, 100)}%`;

    const perks = {
      Bronze:   ['Tarifs préférentiels', 'Newsletter exclusive'],
      Silver:   ['Early check-in', 'Late check-out', 'Remise 5%'],
      Gold:     ['Surclassement offert', 'Spa -15%', 'Remise 10%'],
      Platinum: ['Suite garantie', 'Transfert offert', 'Spa gratuit', 'Remise 20%'],
    };

    if (perksEl) {
      const list = perks[loyalty.status] || [];
      perksEl.innerHTML = list.map(p =>
        `<div class="loyalty-perk">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
           ${escHtml(p)}
         </div>`
      ).join('');
    }
  }

  function injectFeaturedBooking(r) {
    const nights = calcNights(r.checkInDate, r.checkOutDate);
    const st     = normalizeStatus(r.status || r.Status || '');
    const stKey  = getStatusKey(st);

    const q = sel => document.querySelector(sel);

    const roomTypeEl = q('.booking-room-type');
    if (roomTypeEl) roomTypeEl.textContent = r.roomType || '—';

    const titleEl = q('.booking-featured-title');
    if (titleEl) titleEl.textContent = (r.roomType || 'Chambre') + (r.roomNumber ? ' · ' + r.roomNumber : '');

    const dateVals = document.querySelectorAll('.booking-date-val');
    if (dateVals[0]) dateVals[0].textContent = formatDateFr(r.checkInDate);
    if (dateVals[1]) dateVals[1].textContent = formatDateFr(r.checkOutDate);

    const nightsEl = q('.booking-date-arrow span');
    if (nightsEl) nightsEl.textContent = `${nights} nuit${nights > 1 ? 's' : ''}`;

    const totalEl = q('.booking-total-val');
    if (totalEl) totalEl.textContent = formatPrice(r.totalPrice);

    const badgeEl = q('.card--featured .badge');
    if (badgeEl) { badgeEl.textContent = st; badgeEl.className = `badge badge--${stKey}`; }

    const tagsEl = q('.booking-tags');
    if (tagsEl) {
      const tags = [r.pension, r.roomNumber ? 'Chambre ' + r.roomNumber : null].filter(Boolean);
      tagsEl.innerHTML = tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('');
    }
  }

  function injectHistoryTable() {
    const tbody = document.querySelector('.history-table tbody');
    if (!tbody || !allReservations.length) return;

    tbody.innerHTML = allReservations.slice(0, 6).map(r => {
      const st    = normalizeStatus(r.status || r.Status || '');
      const stKey = getStatusKey(st);
      return `
        <tr>
          <td class="room-name-cell">${escHtml(r.roomType || '—')}</td>
          <td class="date-cell" style="font-size:12px;">${formatDateFr(r.checkInDate)} → ${formatDateFr(r.checkOutDate)}</td>
          <td>${escHtml(r.pension || '—')}</td>
          <td class="amount-cell">${formatPrice(r.totalPrice)}</td>
          <td><span class="badge badge--${stKey}" style="font-size:9px;">${escHtml(st)}</span></td>
        </tr>`;
    }).join('');
  }

  function initCheckinBanner() {
    const banner = document.getElementById('checkinBanner');
    if (!banner) return;

    banner.style.display = 'none';

    const ongoing = allReservations.find(r => String(r.status ?? r.Status ?? '').trim() === 'Checked_in');
    if (!ongoing) return;

    banner.style.display = '';

    const today     = todayStr();
    const nights    = calcNights(ongoing.checkInDate, ongoing.checkOutDate);
    const elapsed   = calcNights(ongoing.checkInDate, today);
    const remaining = Math.max(0, nights - elapsed);
    const pct       = Math.min(100, Math.round((elapsed / nights) * 100));

    setInner('checkinRoom',     `${ongoing.roomType || ''}${ongoing.roomNumber ? ' · ' + ongoing.roomNumber : ''}`);
    setInner('checkinDaysLeft', remaining);
    setInner('checkinStart',    formatDateFr(ongoing.checkInDate));
    setInner('checkinEnd',      formatDateFr(ongoing.checkOutDate));
    const prog = document.getElementById('checkinProgress');
    if (prog) prog.style.width = `${pct}%`;
  }

  /* ─────────────────────────────────────────
     SHOW / HIDE SECTION
  ───────────────────────────────────────── */
  function show() {
    document.querySelectorAll('.stats-row, .dashboard-grid, .checkin-banner').forEach(el => {
      el._prev = el.style.display;
      el.style.display = 'none';
    });
    const sec = document.getElementById('reservationsSection');
    if (sec) sec.classList.add('active');

    allReservations = Array.isArray(window.RESERVATIONS) ? window.RESERVATIONS : [];
    renderSummary();
    renderCards();
    updateTabCounts();
  }

  function hide() {
    document.querySelectorAll('.stats-row, .dashboard-grid, .checkin-banner').forEach(el => {
      el.style.display = el._prev !== undefined ? el._prev : '';
    });
    const sec = document.getElementById('reservationsSection');
    if (sec) sec.classList.remove('active');
  }

  /* ─────────────────────────────────────────
     FILTRES
  ───────────────────────────────────────── */
  function setFilter(f) {
    activeFilter = f;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('resFilter' + capitalize(f))?.classList.add('active');
    renderCards();
  }

  function filterReservations() {
    const today = todayStr();
    return allReservations.filter(r => {
      const st = normalizeStatus(r.status || r.Status);
      if (activeFilter === 'all')       return true;
      if (activeFilter === 'upcoming')  return ['En attente', 'Confirmée'].includes(st) && r.checkInDate > today;
      if (activeFilter === 'active')    return st === 'En cours';
      if (activeFilter === 'done')      return ['Terminée', 'Complétée', 'Checked-out', 'Completé', 'Completed'].includes(st);
      if (activeFilter === 'cancelled') return st === 'Annulé';
      return true;
    });
  }

  function updateTabCounts() {
    const today = todayStr();
    const c = {
      all:       allReservations.length,
      upcoming:  allReservations.filter(r => ['En attente', 'Confirmée'].includes(normalizeStatus(r.status || r.Status)) && r.checkInDate > today).length,
      active:    allReservations.filter(r => normalizeStatus(r.status || r.Status) === 'En cours').length,
      done:      allReservations.filter(r => ['Terminée', 'Complétée', 'Checked-out', 'Completé', 'Completed'].includes(normalizeStatus(r.status || r.Status))).length,
      cancelled: allReservations.filter(r => normalizeStatus(r.status || r.Status) === 'Annulé').length,
    };
    Object.keys(c).forEach(k => {
      const el = document.querySelector(`#resFilter${capitalize(k)} .tab-count`);
      if (el) el.textContent = c[k];
    });
  }

  /* ─────────────────────────────────────────
     RÉSUMÉ MINI-STATS
  ───────────────────────────────────────── */
  function renderSummary() {
    const today = todayStr();
    const upcoming = allReservations.filter(r =>
      ['En attente', 'Confirmée'].includes(normalizeStatus(r.status || r.Status)) && r.checkInDate > today).length;
    const spent = allReservations
      .filter(r => normalizeStatus(r.status || r.Status) !== 'Annulé')
      .reduce((s, r) => s + parseFloat(r.totalPrice || 0), 0);
    const next = allReservations
      .filter(r => ['En attente', 'Confirmée'].includes(normalizeStatus(r.status || r.Status)) && r.checkInDate >= today)
      .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))[0];

    setInner('resSummaryTotal',    allReservations.length);
    setInner('resSummaryUpcoming', upcoming);
    setInner('resSummarySpent',    formatPrice(spent));
    setInner('resSummaryNext',     next ? formatDateFr(next.checkInDate) : '—');
  }

  /* ─────────────────────────────────────────
     RENDER CARDS
  ───────────────────────────────────────── */
  function renderCards() {
    const list      = filterReservations().sort((a, b) => b.checkInDate.localeCompare(a.checkInDate));
    const container = document.getElementById('reservationsList');
    if (!container) return;
    container.innerHTML = list.length ? list.map((r, i) => buildCard(r, i)).join('') : emptyState();
  }

  /* ─────────────────────────────────────────
     BUILD CARD
  ───────────────────────────────────────── */
  function buildCard(r, idx) {
    const st     = normalizeStatus(r.status || r.Status);
    const stKey  = getStatusKey(st);
    const nights = calcNights(r.checkInDate, r.checkOutDate);
    const today  = todayStr();

    const isEnAttente  = st === 'En attente';
    const isConfirmee  = st === 'Confirmée';
    const isTermine    = ['Terminée', 'Complétée', 'Checked-out', 'Completé', 'Completed'].includes(st);
    const isCancelled  = st === 'Annulé';

    /* Modification : "En attente" → tout, "Confirmée" → infos perso seulement */
    const canFullEdit    = isEnAttente && r.checkInDate > today;
    const canLimitedEdit = isConfirmee && r.checkInDate > today;
    const canEdit        = canFullEdit || canLimitedEdit;

    /* Annulation : avant check-in, statuts ouverts */
    const canCancel = (isEnAttente || isConfirmee) && r.checkInDate > today;

    /* Facture : séjours terminés */
    const hasInvoice = isTermine;

    return `
    <div class="res-card" data-status="${stKey}" data-id="${r.id}" style="animation-delay:${idx * 0.06}s">
      <div class="res-card-main">

        <!-- Visuel -->
        <div class="res-card-visual">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <path d="M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z"/>
            <path d="M2 12h20"/><path d="M7 12V7"/>
          </svg>
          <div class="res-card-room-num">${escHtml(r.roomNumber || '—')}</div>
          <div class="res-card-room-label">${escHtml(r.roomType || '—')}</div>
        </div>

        <!-- Corps -->
        <div class="res-card-body">
          <div class="res-card-top">
            <div>
              <div class="res-card-name">${escHtml(r.roomType || 'Chambre')}${r.roomNumber ? ' · ' + escHtml(r.roomNumber) : ''}</div>
              <div class="res-card-id">Réservation #${r.id}</div>
            </div>
            <span class="res-status-badge status-${stKey}">${escHtml(st)}</span>
          </div>

          <div class="res-card-dates">
            <div class="res-date-block">
              <span class="res-date-label">Arrivée</span>
              <span class="res-date-val">${formatDateFr(r.checkInDate)}</span>
              <span class="res-date-sub">Après 14h00</span>
            </div>
            <div class="res-date-sep">
              <svg width="22" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              <span class="res-nights">${nights} nuit${nights > 1 ? 's' : ''}</span>
            </div>
            <div class="res-date-block">
              <span class="res-date-label">Départ</span>
              <span class="res-date-val">${formatDateFr(r.checkOutDate)}</span>
              <span class="res-date-sub">Avant 12h00</span>
            </div>
          </div>

          <div class="res-card-meta">
            ${r.pension ? `<span class="res-meta-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
              ${escHtml(r.pension)}</span>` : ''}
            <span class="res-meta-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
              ${parseInt(r.numberOfAdults || 1)} adulte${(r.numberOfAdults || 1) > 1 ? 's' : ''}${parseInt(r.numberOfChildren || 0) > 0 ? ', ' + r.numberOfChildren + ' enfant' + (r.numberOfChildren > 1 ? 's' : '') : ''}
            </span>
          </div>
        </div>

        <!-- Prix -->
        <div class="res-card-aside">
          <div class="res-price-block">
            <div class="res-price-label">Total séjour</div>
            <div class="res-price-val">${formatPrice(r.totalPrice)}</div>
            <div class="res-price-sub">TTC · ${nights} nuit${nights > 1 ? 's' : ''}</div>
          </div>

          <div class="res-card-actions">
            <!-- Détails -->
            <button class="res-btn res-btn--detail" onclick="MesReservations.toggleDetail(${r.id})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Détails
            </button>

            <!-- Modifier -->
            <button
              class="res-btn res-btn--edit${canEdit ? '' : ' res-btn--disabled'}"
              ${canEdit ? `onclick="MesReservations.openEdit(${r.id})"` : ''}
              ${canEdit ? '' : 'disabled'}
              title="${canFullEdit ? 'Modifier la réservation' : canLimitedEdit ? 'Modifier les informations personnelles seulement' : 'Modification non disponible'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              ${canLimitedEdit && !canFullEdit ? 'Modifier (limité)' : 'Modifier'}
            </button>

            <!-- Annuler -->
            <button
              class="res-btn res-btn--cancel${canCancel ? '' : ' res-btn--disabled'}"
              ${canCancel ? `onclick="MesReservations.openConfirmCancel(${r.id})"` : ''}
              ${canCancel ? '' : 'disabled'}
              title="${canCancel ? 'Annuler la réservation' : 'Annulation non disponible'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              Annuler
            </button>
          </div>
        </div>
      </div>

      <!-- Détail expandable -->
      <div class="res-card-detail" id="detail-${r.id}">
        <div class="detail-grid">
          <div class="detail-group">
            <div class="detail-group-label">Séjour</div>
            <div class="detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>${formatDateFr(r.checkInDate)} → ${formatDateFr(r.checkOutDate)}</span>
            </div>
            <div class="detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z"/><path d="M2 12h20"/><path d="M7 12V7"/></svg>
              <span>Chambre <strong>${escHtml(r.roomNumber || '—')}</strong> · ${escHtml(r.roomType || '—')}</span>
            </div>
            ${r.pension ? `<div class="detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/></svg>
              <span>Pension : <strong>${escHtml(r.pension)}</strong></span></div>` : ''}
          </div>
          <div class="detail-group">
            <div class="detail-group-label">Voyageurs</div>
            <div class="detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
              <span>${parseInt(r.numberOfAdults || 1)} adulte${(r.numberOfAdults || 1) > 1 ? 's' : ''}</span>
            </div>
            ${parseInt(r.numberOfChildren || 0) > 0 ? `<div class="detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
              <span>${r.numberOfChildren} enfant${r.numberOfChildren > 1 ? 's' : ''}</span></div>` : ''}
          </div>
          <div class="detail-group">
            <div class="detail-group-label">Paiement</div>
            <div class="detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              <span>${escHtml(r.paymentDetails || 'Non précisé')}</span>
            </div>
            <div class="detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
              <span>Montant : <strong>${formatPrice(r.totalPrice)}</strong></span>
            </div>
            <div class="detail-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span>Statut : <strong>${escHtml(st)}</strong></span>
            </div>
          </div>
        </div>

        <!-- Bouton Facture : visible pour TOUTES les réservations depuis les détails -->
        <div class="detail-invoice-row">
          <button class="res-btn-invoice" onclick="MesReservations.openInvoice(${r.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
            Voir ma facture
          </button>
          <span class="invoice-hint">Visualiser · Imprimer · PDF</span>
        </div>
      </div>
    </div>`;
  }

  /* ─────────────────────────────────────────
     TOGGLE DÉTAIL
  ───────────────────────────────────────── */
  function toggleDetail(id) {
    const panel = document.getElementById(`detail-${id}`);
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    const btn = panel.closest('.res-card')?.querySelector('.res-btn--detail');
    if (btn) btn.innerHTML = isOpen
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Masquer`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>Détails`;
  }

  /* ─────────────────────────────────────────
     MODALE FACTURE
  ───────────────────────────────────────── */
  function openInvoice(id) {
    const r = allReservations.find(r => r.id == id);
    if (!r) return;

    const nights     = calcNights(r.checkInDate, r.checkOutDate);
    const clientNom  = window.CLIENT_NOM || r.clientName || '—';
    const today      = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    const st         = normalizeStatus(r.status || r.Status);

    const html = `
      <div class="invoice-paper" id="invoicePrintArea">
        <div class="invoice-head">
          <div class="invoice-brand">
            <div class="invoice-brand-name">Royal <span>Mansour</span></div>
            <div class="invoice-brand-sub">Iberostar · Mahdia, Tunisie</div>
          </div>
          <div class="invoice-meta">
            <div class="invoice-label">FACTURE</div>
            <div class="invoice-ref">#${r.id}</div>
            <div class="invoice-date">Émise le ${today}</div>
          </div>
        </div>

        <div class="invoice-parties">
          <div class="invoice-party">
            <div class="invoice-party-label">HÔTEL</div>
            <div class="invoice-party-name">Royal Mansour Iberostar</div>
            <div class="invoice-party-info">Route Touristique · Mahdia 5100</div>
            <div class="invoice-party-info">Tunisie · +216 73 681 100</div>
          </div>
          <div class="invoice-party">
            <div class="invoice-party-label">CLIENT</div>
            <div class="invoice-party-name">${escHtml(clientNom)}</div>
            ${r.email ? `<div class="invoice-party-info">${escHtml(r.email)}</div>` : ''}
            ${r.phoneNumber ? `<div class="invoice-party-info">${escHtml(r.phoneNumber)}</div>` : ''}
          </div>
        </div>

        <div class="invoice-stay-block">
          <div class="invoice-stay-row">
            <span class="invoice-stay-label">Chambre</span>
            <span class="invoice-stay-val">${escHtml(r.roomType || '—')}${r.roomNumber ? ' · N°' + r.roomNumber : ''}</span>
          </div>
          <div class="invoice-stay-row">
            <span class="invoice-stay-label">Arrivée</span>
            <span class="invoice-stay-val">${formatDateFr(r.checkInDate)}</span>
          </div>
          <div class="invoice-stay-row">
            <span class="invoice-stay-label">Départ</span>
            <span class="invoice-stay-val">${formatDateFr(r.checkOutDate)}</span>
          </div>
          <div class="invoice-stay-row">
            <span class="invoice-stay-label">Durée</span>
            <span class="invoice-stay-val">${nights} nuit${nights > 1 ? 's' : ''}</span>
          </div>
          ${r.pension ? `<div class="invoice-stay-row">
            <span class="invoice-stay-label">Pension</span>
            <span class="invoice-stay-val">${escHtml(r.pension)}</span>
          </div>` : ''}
          <div class="invoice-stay-row">
            <span class="invoice-stay-label">Voyageurs</span>
            <span class="invoice-stay-val">${parseInt(r.numberOfAdults || 1)} adulte${(r.numberOfAdults || 1) > 1 ? 's' : ''}${parseInt(r.numberOfChildren || 0) > 0 ? ', ' + r.numberOfChildren + ' enfant' + (r.numberOfChildren > 1 ? 's' : '') : ''}</span>
          </div>
          <div class="invoice-stay-row">
            <span class="invoice-stay-label">Statut</span>
            <span class="invoice-stay-val">${escHtml(st)}</span>
          </div>
        </div>

        <table class="invoice-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Qté</th>
              <th>P.U.</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${escHtml(r.roomType || 'Chambre')}${r.pension ? ' — ' + escHtml(r.pension) : ''}</td>
              <td>${nights} nuit${nights > 1 ? 's' : ''}</td>
              <td>${formatPrice(parseFloat(r.totalPrice) / Math.max(nights, 1))}</td>
              <td><strong>${formatPrice(r.totalPrice)}</strong></td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="invoice-subtotal">
              <td colspan="3">Sous-total HT</td>
              <td>${formatPrice(parseFloat(r.totalPrice) * 0.81)}</td>
            </tr>
            <tr class="invoice-tax">
              <td colspan="3">TVA (19%)</td>
              <td>${formatPrice(parseFloat(r.totalPrice) * 0.19)}</td>
            </tr>
            <tr class="invoice-total-row">
              <td colspan="3">TOTAL TTC</td>
              <td>${formatPrice(r.totalPrice)}</td>
            </tr>
          </tfoot>
        </table>

        <div class="invoice-payment-info">
          <div class="invoice-payment-label">Mode de paiement</div>
          <div class="invoice-payment-val">${escHtml(r.paymentDetails || 'Non précisé')}</div>
        </div>

        <div class="invoice-footer-note">
          Merci pour votre confiance. Nous espérons vous accueillir à nouveau très prochainement.<br>
          Royal Mansour Iberostar · Mahdia, Tunisie · www.royalmansour.tn
        </div>
      </div>
    `;

    const body = document.getElementById('invoiceModalBody');
    if (body) body.innerHTML = html;

    const modal = document.getElementById('invoiceModal');
    if (modal) {
      modal.classList.add('open');
      modal.setAttribute('tabindex', '-1');
      modal.focus({ preventScroll: true });
    }
    document.getElementById('invoiceOverlay')?.classList.add('open');
  }

  function closeInvoiceModal() {
    document.getElementById('invoiceOverlay')?.classList.remove('open');
    document.getElementById('invoiceModal')?.classList.remove('open');
  }

  function printInvoice() {
    const area = document.getElementById('invoicePrintArea');
    if (!area) return;
    const w = window.open('', '_blank', 'width=800,height=900');
    w.document.write(`
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <title>Facture Royal Mansour</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Jost', sans-serif; font-weight: 300; color: #1a1a2e; background: #fff; padding: 40px; }
          .invoice-paper { max-width: 720px; margin: 0 auto; }
          .invoice-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #c9a84c; padding-bottom: 24px; margin-bottom: 32px; }
          .invoice-brand-name { font-family: 'Cormorant Garamond', serif; font-size: 30px; font-weight: 300; color: #1a1a2e; }
          .invoice-brand-name span { color: #c9a84c; }
          .invoice-brand-sub { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #888; margin-top: 4px; }
          .invoice-meta { text-align: right; }
          .invoice-label { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: #c9a84c; font-weight: 600; }
          .invoice-ref { font-family: 'Cormorant Garamond', serif; font-size: 28px; color: #1a1a2e; margin: 2px 0; }
          .invoice-date { font-size: 11px; color: #888; }
          .invoice-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
          .invoice-party-label { font-size: 8.5px; letter-spacing: 2.5px; text-transform: uppercase; color: #c9a84c; font-weight: 600; margin-bottom: 8px; }
          .invoice-party-name { font-size: 15px; font-weight: 400; color: #1a1a2e; margin-bottom: 3px; }
          .invoice-party-info { font-size: 12px; color: #666; margin-bottom: 1px; }
          .invoice-stay-block { background: #f8f5ec; border-left: 3px solid #c9a84c; padding: 16px 20px; margin-bottom: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
          .invoice-stay-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
          .invoice-stay-label { color: #888; }
          .invoice-stay-val { color: #1a1a2e; font-weight: 400; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: #888; font-weight: 600; padding: 10px 12px; border-bottom: 1px solid #e0d9c8; text-align: left; }
          td { padding: 12px 12px; font-size: 13px; color: #333; border-bottom: 1px solid #f0ebe0; }
          .invoice-subtotal td, .invoice-tax td { font-size: 11.5px; color: #777; padding: 6px 12px; }
          .invoice-total-row td { font-size: 15px; font-weight: 600; color: #c9a84c; padding: 12px 12px; border-top: 2px solid #c9a84c; }
          .invoice-payment-info { margin: 16px 0; font-size: 12px; color: #666; }
          .invoice-payment-label { font-size: 8.5px; letter-spacing: 2px; text-transform: uppercase; color: #c9a84c; font-weight: 600; margin-bottom: 4px; }
          .invoice-footer-note { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e0d9c8; font-size: 11px; color: #aaa; line-height: 1.6; text-align: center; }
        </style>
      </head>
      <body>${area.outerHTML}</body>
      </html>
    `);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 600);
  }

  /* ─────────────────────────────────────────
     MODALE MODIFICATION — fixée en position
     "En attente" = tout modifiable
     "Confirmée"  = infos perso seulement
  ───────────────────────────────────────── */
  function openEdit(id) {
    const res = allReservations.find(r => r.id == id);
    if (!res) return;
    editingId = id;
    editAssignedRoomNumber = res.roomNumber || '';

    const st           = normalizeStatus(res.status || res.Status);
    const isFullEdit   = st === 'En attente';
    const isLimitedEdit= st === 'Confirmée';

    // Remplir les champs texte
    setVal('editClientName',  res.clientName  || (window.CLIENT_NOM || ''));
    setVal('editEmail',       res.email       || '');
    setVal('editPhone',       res.phoneNumber || '');
    setVal('editCheckIn',     res.checkInDate);
    setVal('editCheckOut',    res.checkOutDate);
    setVal('editAdults',      res.numberOfAdults   || 1);
    setVal('editChildren',    res.numberOfChildren || 0);

    // Remplir les selects avec les valeurs exactes de la BD
    const roomTypeEl = document.getElementById('editRoomType');
    if (roomTypeEl) {
      roomTypeEl.value = res.roomType || '';
      // Si la valeur n'existe pas dans les options, l'ajouter temporairement
      if (res.roomType && !Array.from(roomTypeEl.options).some(o => o.value === res.roomType)) {
        const opt = document.createElement('option');
        opt.value = res.roomType;
        opt.textContent = res.roomType;
        opt.selected = true;
        roomTypeEl.appendChild(opt);
      }
    }
    
    const pensionEl = document.getElementById('editPension');
    if (pensionEl) {
      pensionEl.value = res.pension || '';
      // Si la valeur n'existe pas, l'ajouter
      if (res.pension && !Array.from(pensionEl.options).some(o => o.value === res.pension)) {
        const opt = document.createElement('option');
        opt.value = res.pension;
        opt.textContent = res.pension;
        opt.selected = true;
        pensionEl.appendChild(opt);
      }
    }

    // Charger les chambres disponibles pour le type et les dates sélectionnés
    checkEditAvailability();
    updateEditPricePreview();
    
    const paymentEl = document.getElementById('editPayment');
    if (paymentEl) {
      paymentEl.value = res.paymentDetails || '';
      // Si la valeur n'existe pas, l'ajouter
      if (res.paymentDetails && !Array.from(paymentEl.options).some(o => o.value === res.paymentDetails)) {
        const opt = document.createElement('option');
        opt.value = res.paymentDetails;
        opt.textContent = res.paymentDetails;
        opt.selected = true;
        paymentEl.appendChild(opt);
      }
    }

    setInner('editModalRef', `Réf. #${res.id} · ${res.roomType || ''}${res.roomNumber ? ' – ' + res.roomNumber : ''}`);

    const bannerEl = document.getElementById('editModeBanner');
    if (bannerEl) {
      if (isLimitedEdit) {
        bannerEl.innerHTML = `⚠️ Réservation <strong>confirmée</strong> — seules les informations personnelles (nom, email, téléphone) sont modifiables.`;
        bannerEl.style.display = 'block';
      } else if (isFullEdit) {
        bannerEl.innerHTML = `✏️ Réservation <strong>en attente</strong> — toutes les informations sont modifiables.`;
        bannerEl.style.display = 'block';
        bannerEl.style.borderColor = 'rgba(201,168,76,.4)';
        bannerEl.style.background  = 'rgba(201,168,76,.06)';
        bannerEl.style.color       = 'var(--gold)';
      } else {
        bannerEl.style.display = 'none';
      }
    }

    const sensitiveFields = ['editCheckIn', 'editCheckOut', 'editRoomType', 'editPension', 'editAdults', 'editChildren', 'editPayment'];
    sensitiveFields.forEach(fid => {
      const el = document.getElementById(fid);
      if (!el) return;
      el.disabled = !isFullEdit;
    });

    const sensitiveSection = document.getElementById('editSensitiveSection');
    if (sensitiveSection) {
      sensitiveSection.style.opacity       = isFullEdit ? '1' : '0.4';
      sensitiveSection.style.pointerEvents = isFullEdit ? 'auto' : 'none';
    }

    if (isFullEdit) {
      const min = new Date(); min.setDate(min.getDate() + 1);
      const minStr = min.toISOString().split('T')[0];
      ['editCheckIn', 'editCheckOut'].forEach(fid => {
        const el = document.getElementById(fid);
        if (el) el.min = minStr;
      });
    }

    /* ─ Afficher la modale fixe ─ */
    const modal = document.getElementById('editModal');
    if (modal) {
      modal.classList.add('open');
      modal.setAttribute('tabindex', '-1');
      modal.focus({ preventScroll: true });
    }
    document.getElementById('editOverlay')?.classList.add('open');
  }

  function closeEditModal() {
    document.getElementById('editOverlay')?.classList.remove('open');
    document.getElementById('editModal')?.classList.remove('open');
    editingId = null;
  }

  function submitEdit() {
    if (!editingId) return;

    const res = allReservations.find(r => r.id == editingId);
    if (!res) return;

    const st         = normalizeStatus(res.status || res.Status);
    const isFullEdit = st === 'En attente';

    const checkIn  = getVal('editCheckIn');
    const checkOut = getVal('editCheckOut');

    if (isFullEdit) {
      if (!checkIn || !checkOut) { showToast('Dates requises.', 'error'); return; }
      if (checkIn >= checkOut)   { showToast("Le départ doit être après l'arrivée.", 'error'); return; }
      if (!getVal('editRoomType')) { showToast('Type de chambre requis.', 'error'); return; }
    }

    const payload = { id: editingId };

    payload.clientName  = getVal('editClientName');
    payload.email       = getVal('editEmail');
    payload.phoneNumber = getVal('editPhone');

    if (isFullEdit) {
      payload.checkInDate      = checkIn;
      payload.checkOutDate     = checkOut;
      payload.roomType         = getVal('editRoomType');
      if (editAssignedRoomNumber) {
        payload.roomNumber = editAssignedRoomNumber;
      }
      payload.pension          = getVal('editPension');
      payload.numberOfAdults   = parseInt(getVal('editAdults'))   || 1;
      payload.numberOfChildren = parseInt(getVal('editChildren')) || 0;
      payload.paymentDetails   = getVal('editPayment');

      if (!payload.roomNumber) {
        showToast('Veuillez attendre l’attribution d’une chambre disponible.', 'error');
        return;
      }

      const recalculatedPrice = calculateReservationPrice(payload);
      if (recalculatedPrice === null) {
        showToast('Impossible de recalculer le prix avec ces informations.', 'error');
        return;
      }
      payload.totalPrice = recalculatedPrice;
      updateEditPricePreview();
    }

    const btn = document.getElementById('editSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => r.json())
      .then(resp => {
        if (!resp.success) throw new Error(resp.error || 'Erreur serveur');
        const idx = window.RESERVATIONS.findIndex(r => r.id == editingId);
        if (idx !== -1) Object.assign(window.RESERVATIONS[idx], payload);
        allReservations = [...window.RESERVATIONS];
        closeEditModal();
        showToast('Réservation modifiée ✓');
        renderCards(); renderSummary(); updateTabCounts(); injectHistoryTable();
      })
      .catch(err => showToast('Erreur : ' + err.message, 'error'))
      .finally(() => { if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; } });
  }

  /* ─────────────────────────────────────────
     MODALE ANNULATION — fixée en position
  ───────────────────────────────────────── */
  function openConfirmCancel(id) {
    const res = allReservations.find(r => r.id == id);
    if (!res) return;
    cancellingId = id;
    setInner('confirmCancelRef',
      `#${id} · ${res.roomType || ''}${res.roomNumber ? ' – ' + res.roomNumber : ''} · du ${formatDateFr(res.checkInDate)}`);

    const modal = document.getElementById('confirmModal');
    if (modal) {
      modal.classList.add('open');
      modal.setAttribute('tabindex', '-1');
      modal.focus({ preventScroll: true });
    }
    document.getElementById('confirmOverlay')?.classList.add('open');
  }

  function closeConfirmModal() {
    document.getElementById('confirmOverlay')?.classList.remove('open');
    document.getElementById('confirmModal')?.classList.remove('open');
    cancellingId = null;
  }

  function submitCancel() {
    if (!cancellingId) return;
    const btn = document.getElementById('confirmCancelBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Annulation…'; }

    fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: cancellingId, Status: 'Annulé' }) })
      .then(r => r.json())
      .then(resp => {
        if (!resp.success) throw new Error(resp.error || 'Erreur serveur');
        const idx = window.RESERVATIONS.findIndex(r => r.id == cancellingId);
        if (idx !== -1) {
          window.RESERVATIONS[idx].status = 'Annulé';
          window.RESERVATIONS[idx].Status = 'Annulé';
        }
        allReservations = [...window.RESERVATIONS];
        closeConfirmModal();
        showToast('Réservation annulée.');
        renderCards(); renderSummary(); updateTabCounts(); injectHistoryTable();
      })
      .catch(err => showToast('Erreur : ' + err.message, 'error'))
      .finally(() => { if (btn) { btn.disabled = false; btn.textContent = "Confirmer l'annulation"; } });
  }

  /* ─────────────────────────────────────────
     EMPTY STATE
  ───────────────────────────────────────── */
  function emptyState() {
    const msgs = {
      all:       ['Aucune réservation',    "Vous n'avez pas encore effectué de réservation."],
      upcoming:  ['Aucun séjour à venir',  'Pas de réservation à venir pour le moment.'],
      active:    ['Aucun séjour en cours', "Vous n'avez pas de séjour en cours."],
      done:      ['Aucun séjour terminé',  'Votre historique apparaîtra ici.'],
      cancelled: ['Aucune annulation',     "Vous n'avez aucune réservation annulée."],
    };
    const [title, sub] = msgs[activeFilter] || msgs.all;
    return `<div class="res-empty">
      <div class="res-empty-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
      <div class="res-empty-title">${title}</div>
      <div class="res-empty-sub">${sub}</div>
      <button class="btn-gold-sm" style="margin-top:12px;" onclick="window.location.href='reserver.html'">Faire une réservation</button>
    </div>`;
  }

  /* ─────────────────────────────────────────
     INJECT HTML
  ───────────────────────────────────────── */
  function injectHTML() {
    if (document.getElementById('reservationsSection')) return;

    const section = document.createElement('section');
    section.id        = 'reservationsSection';
    section.className = 'reservations-section';
    section.innerHTML = `
      <div class="reservations-header">
        <div class="reservations-title-block">
          <span class="reservations-eyebrow">Mon espace</span>
          <h2 class="reservations-title">Mes <em>Réservations</em></h2>
        </div>
      </div>

      <!-- Mini-stats -->
      <div class="reservations-summary">
        <div class="res-summary-card">
          <div class="res-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
          <div><div class="res-summary-label">Total</div><div class="res-summary-val" id="resSummaryTotal">—</div></div>
        </div>
        <div class="res-summary-card">
          <div class="res-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
          <div><div class="res-summary-label">À venir</div><div class="res-summary-val" id="resSummaryUpcoming">—</div></div>
        </div>
        <div class="res-summary-card">
          <div class="res-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div>
          <div><div class="res-summary-label">Total dépensé</div><div class="res-summary-val" id="resSummarySpent">—</div></div>
        </div>
        <div class="res-summary-card">
          <div class="res-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg></div>
          <div><div class="res-summary-label">Prochain check-in</div><div class="res-summary-val" id="resSummaryNext">—</div></div>
        </div>
      </div>

      <!-- Filtres -->
      <div class="reservations-filters">
        <button class="filter-tab active" id="resFilterAll">
          <span class="filter-tab-label">Tout</span>
          <span class="tab-count">0</span>
        </button>
        <button class="filter-tab" id="resFilterUpcoming">
          <span class="filter-tab-label">À venir</span>
          <span class="tab-count">0</span>
        </button>
        <button class="filter-tab" id="resFilterActive">
          <span class="filter-tab-label">En cours</span>
          <span class="tab-count">0</span>
        </button>
        <button class="filter-tab" id="resFilterDone">
          <span class="filter-tab-label">Terminés</span>
          <span class="tab-count">0</span>
        </button>
        <button class="filter-tab" id="resFilterCancelled">
          <span class="filter-tab-label">Annulés</span>
          <span class="tab-count">0</span>
        </button>
      </div>

      <!-- Liste -->
      <div class="reservations-list" id="reservationsList"></div>
    `;

    const topbar = document.querySelector('.topbar');
    topbar
      ? topbar.insertAdjacentElement('afterend', section)
      : document.querySelector('.main-content')?.appendChild(section);

    const modalWrapper = document.createElement('div');
    modalWrapper.innerHTML = `
      <div class="edit-overlay" id="editOverlay"></div>
      <div class="edit-modal" id="editModal" tabindex="-1">
        <div class="edit-modal-header">
          <div>
            <span class="reservations-eyebrow">Modification</span>
            <h3 class="edit-modal-title">Modifier la réservation</h3>
            <div class="edit-modal-ref" id="editModalRef"></div>
          </div>
          <button class="edit-modal-close" onclick="MesReservations.closeEditModal()" title="Fermer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- Bandeau info -->
        <div id="editModeBanner" class="edit-mode-banner" style="display:none;"></div>

        <div class="edit-form-grid">
          <div class="edit-section-title full-width">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Informations personnelles
          </div>
          <div class="edit-field">
            <label class="edit-label">Nom complet</label>
            <input type="text" class="edit-input" id="editClientName" placeholder="Nom et prénom">
          </div>
          <div class="edit-field">
            <label class="edit-label">Email</label>
            <input type="email" class="edit-input" id="editEmail" placeholder="email@exemple.com">
          </div>
          <div class="edit-field full-width">
            <label class="edit-label">Téléphone</label>
            <input type="tel" class="edit-input" id="editPhone" placeholder="+216 xx xxx xxx">
          </div>

          <div class="edit-section-title full-width" id="editSensitiveSection">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Dates &amp; Séjour
            <span id="editLockIcon" style="margin-left:6px;font-size:11px;opacity:.5;">🔒</span>
          </div>
          <div class="edit-field">
            <label class="edit-label">Date d'arrivée</label>
            <input type="date" class="edit-input" id="editCheckIn">
          </div>
          <div class="edit-field">
            <label class="edit-label">Date de départ</label>
            <input type="date" class="edit-input" id="editCheckOut">
          </div>
          <div class="edit-field">
            <label class="edit-label">Type de chambre</label>
            <select class="edit-select" id="editRoomType">
              <option value="">Sélectionner…</option>
            </select>
          </div>
          <div class="edit-field">
            <label class="edit-label">Numéro de chambre</label>
            <div class="edit-info" id="editRoomInfo">La chambre sera attribuée automatiquement selon le type et les dates.</div>
            <div class="res-avail-hint" id="editRoomHint"></div>
          </div>
          <div class="edit-field">
            <label class="edit-label">Pension</label>
            <select class="edit-select" id="editPension">
              <option value="">Sélectionner…</option>
              <option>Logement seul</option>
              <option>Petit-déjeuner inclus</option>
              <option>Demi-pension</option>
              <option>Pension complète</option>
              <option>All inclusive</option>
            </select>
          </div>
          <div class="edit-field">
            <label class="edit-label">Adultes</label>
            <input type="number" class="edit-input" id="editAdults" min="1" max="8">
          </div>
          <div class="edit-field">
            <label class="edit-label">Enfants</label>
            <input type="number" class="edit-input" id="editChildren" min="0" max="8">
          </div>
          <div class="edit-field full-width">
            <label class="edit-label">Mode de paiement</label>
            <select class="edit-select" id="editPayment">
              <option value="">Sélectionner…</option>
              <option>Carte bancaire</option>
              <option>Espèces</option>
              <option>Virement</option>
              <option>Chèque</option>
            </select>
          </div>
        </div>

        <div class="edit-price-notice" id="editPriceNotice">
          Le total sera recalculé automatiquement après le choix des dates et du type de chambre.
        </div>

        <div class="edit-modal-footer">
          <button class="btn-outline-sm" onclick="MesReservations.closeEditModal()">Annuler</button>
          <button class="btn-gold-sm" id="editSubmitBtn" onclick="MesReservations.submitEdit()">Enregistrer</button>
        </div>
      </div>

      <div class="confirm-overlay" id="confirmOverlay"></div>
      <div class="confirm-modal" id="confirmModal" tabindex="-1">
        <div class="confirm-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div class="confirm-title">Annuler la réservation ?</div>
        <div class="confirm-text">
          Vous êtes sur le point d'annuler la réservation<br>
          <span class="confirm-highlight" id="confirmCancelRef"></span><br><br>
          Cette action est <strong>irréversible</strong>. Contactez la conciergerie pour toute question.
        </div>
        <div class="confirm-footer">
          <button class="btn-outline-sm" onclick="MesReservations.closeConfirmModal()">Retour</button>
          <button class="btn-danger-sm" id="confirmCancelBtn" onclick="MesReservations.submitCancel()">Confirmer l'annulation</button>
        </div>
      </div>

      <div class="invoice-overlay" id="invoiceOverlay"></div>
      <div class="invoice-modal" id="invoiceModal" tabindex="-1">
        <div class="invoice-modal-header">
          <div>
            <span class="reservations-eyebrow">Document officiel</span>
            <h3 class="edit-modal-title">Ma Facture</h3>
          </div>
          <div style="display:flex;gap:10px;align-items:center;">
            <button class="res-btn-invoice" onclick="MesReservations.printInvoice()" style="white-space:nowrap;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Imprimer / PDF
            </button>
            <button class="edit-modal-close" onclick="MesReservations.closeInvoiceModal()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div class="invoice-modal-body" id="invoiceModalBody"></div>
      </div>
    `;
    document.body.appendChild(modalWrapper);
  }

  /* ─────────────────────────────────────────
     TOAST
  ───────────────────────────────────────── */
  function showToast(msg, type) {
    let t = document.querySelector('.dash-toast');
    if (!t) { t = document.createElement('div'); t.className = 'dash-toast'; document.body.appendChild(t); }
    t.textContent       = msg;
    t.style.borderColor = type === 'error' ? '#ef4444' : 'var(--gold)';
    t.style.color       = type === 'error' ? '#f87171' : 'var(--gold)';
    t.classList.add('visible');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('visible'), 3200);
  }

  /* ─────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────── */
  function normalizeStatus(s) {
    if (!s) return '—';
    const map = {
      'en attente':   'En attente',
      'confirmée':    'Confirmée',
      'confirmee':    'Confirmée',
      'confirmed':    'Confirmée',
      'en cours':     'En cours',
      'checked_in':   'En cours',
      'checked in':   'En cours',
      'checkin':      'En cours',
      'terminée':     'Terminée',
      'terminee':     'Terminée',
      'complete':     'Complétée',
      'completed':    'Complétée',
      'complète':     'Complétée',
      'completee':    'Complétée',
      'complétée':    'Complétée',
      'completé':     'Complétée',
      'checked_out':  'Checked-out',
      'checked out':  'Checked-out',
      'annulé':       'Annulé',
      'annule':       'Annulé',
      'annulee':      'Annulé',
      'cancelled':    'Annulé',
      'canceled':     'Annulé',
    };
    return map[s.toLowerCase().trim()] || s;
  }

  function getStatusKey(st) {
    return {
      'En attente':  'upcoming',
      'Confirmée':   'confirmed',
      'En cours':    'checkin',
      'Checked-out': 'done',
      'Terminée':    'done',
      'Complétée':   'done',
      'Annulé':      'cancelled',
    }[st] || 'done';
  }

  function todayStr()        { return new Date().toISOString().split('T')[0]; }
  function calcNights(a, b)  { return Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000)); }
  function formatDateFr(d)   {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    const months = ['jan','fév','mar','avr','mai','juin','juil','août','sep','oct','nov','déc'];
    return `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`;
  }
  function formatPrice(p)    { return (parseFloat(p) || 0).toLocaleString('fr-TN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' TND'; }
  function escHtml(s)        { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function setInner(id, v)   { const el = document.getElementById(id); if (el) el.textContent = v; }
  function setVal(id, v)     { const el = document.getElementById(id); if (el) el.value = v; }
  function getVal(id)        { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function capitalize(s)     { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ─────────────────────────────────────────
     API PUBLIQUE
  ───────────────────────────────────────── */
  window.MesReservations = {
    init,
    show,
    hide,
    toggleDetail,
    openEdit,
    closeEditModal,
    submitEdit,
    openConfirmCancel,
    closeConfirmModal,
    submitCancel,
    openInvoice,
    closeInvoiceModal,
    printInvoice,
  };

})();
