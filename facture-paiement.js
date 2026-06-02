/* ============================================
   FACTURES & PAIEMENTS — Module isolé
   Gestion des factures et paiements sécurisés
   ============================================ */

(function () {
  'use strict';

  let activeFilter = 'all';
  let payingId = null;

  const PAYMENT_LABELS = {
    carte:  'Carte bancaire',
    paypal: 'PayPal',
  };

  function init() {
    injectHTML();
    bindFilters();
    render();
  }

  function show() {
    window.MonProfil?.hide();
    window.MesReservations?.hide();
    window.NosChambres?.hide();

    document.querySelectorAll('.stats-row, .dashboard-grid, .checkin-banner').forEach(el => {
      el.style.display = 'none';
    });

    const section = document.getElementById('facturesSection');
    if (section) {
      section.style.display = 'flex';
      section.classList.add('active');
    }

    render();
  }

  function hide() {
    const section = document.getElementById('facturesSection');
    if (section) {
      section.classList.remove('active');
      section.style.display = 'none';
    }
  }

  function injectHTML() {
    if (document.getElementById('facturesSection')) return;

    const section = document.createElement('section');
    section.id = 'facturesSection';
    section.className = 'factures-section';
    section.innerHTML = `
      <div class="factures-header">
        <div class="factures-title-block">
          <span class="factures-eyebrow">Mon espace</span>
          <h2 class="factures-title">Factures <em>& Paiements</em></h2>
        </div>
        <button class="btn-gold-sm" id="facturesLatestBtn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
          Dernière facture
        </button>
      </div>

      <div class="factures-summary">
        <div class="facture-summary-card">
          <div class="facture-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
          <div><div class="facture-summary-label">Factures</div><div class="facture-summary-val" id="facturesCount">—</div></div>
        </div>
        <div class="facture-summary-card">
          <div class="facture-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div>
          <div><div class="facture-summary-label">Total facturé</div><div class="facture-summary-val" id="facturesTotal">—</div></div>
        </div>
        <div class="facture-summary-card">
          <div class="facture-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="20 6 9 17 4 12"/></svg></div>
          <div><div class="facture-summary-label">Déjà réglé</div><div class="facture-summary-val" id="facturesPaid">—</div></div>
        </div>
        <div class="facture-summary-card">
          <div class="facture-summary-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
          <div><div class="facture-summary-label">Reste à régler</div><div class="facture-summary-val" id="facturesDue">—</div></div>
        </div>
      </div>

      <div class="factures-filters">
        <button class="facture-filter active" data-facture-filter="all">Toutes <span id="facturesAllCount">0</span></button>
        <button class="facture-filter" data-facture-filter="paid">Payées <span id="facturesPaidCount">0</span></button>
        <button class="facture-filter" data-facture-filter="deposit">Acompte <span id="facturesDepositCount">0</span></button>
        <button class="facture-filter" data-facture-filter="due">À régler <span id="facturesDueCount">0</span></button>
      </div>

      <div class="factures-layout">
        <div class="factures-list" id="facturesList"></div>
        <aside class="paiements-panel">
          <div class="paiements-panel-header">
            <span class="factures-eyebrow">Paiements</span>
            <h3>Modes enregistrés</h3>
          </div>
          <div class="paiements-methods" id="paiementsMethods"></div>
          <div class="paiements-note">
            <span>Solde</span>
            <strong id="paiementsDueNote">—</strong>
          </div>
        </aside>
      </div>
    `;

    const topbar = document.querySelector('.topbar');
    topbar
      ? topbar.insertAdjacentElement('afterend', section)
      : document.querySelector('.main-content')?.appendChild(section);

    injectPaymentModal();
  }

  function injectPaymentModal() {
    if (document.getElementById('facturePayModal')) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="facture-pay-overlay" id="facturePayOverlay" onclick="FacturesPaiements.closePayment()"></div>
      <div class="facture-pay-modal" id="facturePayModal" tabindex="-1">
        <div class="facture-pay-header">
          <div>
            <span class="factures-eyebrow">Paiement sécurisé</span>
            <h3 class="facture-pay-title">Régler la facture</h3>
            <div class="facture-pay-ref" id="facturePayRef">—</div>
          </div>
          <button class="edit-modal-close" onclick="FacturesPaiements.closePayment()" title="Fermer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="facture-pay-amount">
          <span>Montant à régler</span>
          <strong id="facturePayAmount">—</strong>
        </div>

        <div class="facture-pay-options">
          <label class="facture-pay-card">
            <input type="radio" name="facturePaiement" value="carte">
            <span class="facture-pay-card-body">
              <span class="facture-pay-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><path d="M6 15h4"/></svg></span>
              <span class="facture-pay-name">Carte bancaire</span>
              <span class="facture-pay-sub">Visa · Mastercard</span>
            </span>
          </label>
          <label class="facture-pay-card">
            <input type="radio" name="facturePaiement" value="paypal">
            <span class="facture-pay-card-body">
              <span class="facture-pay-icon">P</span>
              <span class="facture-pay-name">PayPal</span>
              <span class="facture-pay-sub">Compte PayPal</span>
            </span>
          </label>
        </div>

        <div class="facture-pay-fields" id="factureCardFields" style="display:none;">
          <div class="facture-pay-section-title">Informations de carte</div>
          <div class="facture-pay-grid">
            <div class="facture-pay-field full-width">
              <label>Numéro de carte</label>
              <input id="factureCardNumber" type="text" inputmode="numeric" maxlength="19" placeholder="1234 5678 9012 3456">
            </div>
            <div class="facture-pay-field">
              <label>Expiration</label>
              <input id="factureCardExpiry" type="text" inputmode="numeric" maxlength="5" placeholder="MM/AA">
            </div>
            <div class="facture-pay-field">
              <label>CVV</label>
              <input id="factureCardCvv" type="text" inputmode="numeric" maxlength="3" placeholder="123">
            </div>
            <div class="facture-pay-field full-width">
              <label>Nom sur la carte</label>
              <input id="factureCardName" type="text" placeholder="Nom complet">
            </div>
          </div>
        </div>

        <div class="facture-pay-fields facture-pay-fields--paypal" id="facturePaypalFields" style="display:none;">
          <div class="facture-pay-section-title">Compte PayPal</div>
          <div class="facture-pay-field">
            <label>Email PayPal</label>
            <input id="facturePaypalEmail" type="email" placeholder="votre@paypal.com">
          </div>
        </div>

        <div class="facture-pay-error" id="facturePayError"></div>

        <div class="facture-pay-footer">
          <button class="btn-outline-sm" onclick="FacturesPaiements.closePayment()">Annuler</button>
          <button class="btn-gold-sm" id="facturePaySubmit" onclick="FacturesPaiements.submitPayment()">Confirmer le paiement</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);
    bindPaymentModal();
  }

  function bindFilters() {
    document.querySelectorAll('[data-facture-filter]').forEach(btn => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.factureFilter || 'all';
        document.querySelectorAll('[data-facture-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderList();
      });
    });

    const latestBtn = document.getElementById('facturesLatestBtn');
    if (latestBtn && latestBtn.dataset.bound !== '1') {
      latestBtn.dataset.bound = '1';
      latestBtn.addEventListener('click', openLatestInvoice);
    }
  }

  function bindPaymentModal() {
    document.querySelectorAll("input[name='facturePaiement']").forEach(radio => {
      if (radio.dataset.bound === '1') return;
      radio.dataset.bound = '1';
      radio.addEventListener('change', handlePaymentChange);
    });

    const cardNumber = document.getElementById('factureCardNumber');
    if (cardNumber && cardNumber.dataset.bound !== '1') {
      cardNumber.dataset.bound = '1';
      cardNumber.addEventListener('input', () => {
        let numbers = cardNumber.value.replace(/\D/g, '').slice(0, 16);
        cardNumber.value = numbers.replace(/(.{4})/g, '$1 ').trim();
      });
    }

    const cardExpiry = document.getElementById('factureCardExpiry');
    if (cardExpiry && cardExpiry.dataset.bound !== '1') {
      cardExpiry.dataset.bound = '1';
      cardExpiry.addEventListener('input', () => {
        let v = cardExpiry.value.replace(/\D/g, '').slice(0, 4);
        if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
        cardExpiry.value = v;
      });
    }

    const cardCvv = document.getElementById('factureCardCvv');
    if (cardCvv && cardCvv.dataset.bound !== '1') {
      cardCvv.dataset.bound = '1';
      cardCvv.addEventListener('input', () => {
        cardCvv.value = cardCvv.value.replace(/\D/g, '').slice(0, 3);
      });
    }
  }

  function render() {
    renderSummary();
    renderList();
    renderPaymentMethods();
  }

  function renderSummary() {
    const rows = getReservations();
    const billable = rows.filter(r => paymentState(r).key !== 'cancelled');
    const totals = billable.reduce((acc, r) => {
      const state = paymentState(r);
      const total = parseFloat(r.totalPrice) || 0;
      acc.total += total;
      acc.paid += state.paidAmount;
      acc.due += Math.max(0, total - state.paidAmount);
      return acc;
    }, { total: 0, paid: 0, due: 0 });

    setText('facturesCount', billable.length);
    setText('facturesTotal', formatPrice(totals.total));
    setText('facturesPaid', formatPrice(totals.paid));
    setText('facturesDue', formatPrice(totals.due));
    setText('paiementsDueNote', totals.due > 0 ? formatPrice(totals.due) + ' à régler' : 'Aucun solde ouvert');

    const counts = {
      all: billable.length,
      paid: rows.filter(r => paymentState(r).key === 'paid').length,
      deposit: rows.filter(r => paymentState(r).key === 'deposit').length,
      due: rows.filter(r => paymentState(r).key === 'due').length,
    };
    setText('facturesAllCount', counts.all);
    setText('facturesPaidCount', counts.paid);
    setText('facturesDepositCount', counts.deposit);
    setText('facturesDueCount', counts.due);
  }

  function renderList() {
    const list = document.getElementById('facturesList');
    if (!list) return;

    const rows = getReservations()
      .filter(r => {
        const key = paymentState(r).key;
        return activeFilter === 'all' ? key !== 'cancelled' : key === activeFilter;
      })
      .sort((a, b) => String(b.checkInDate || '').localeCompare(String(a.checkInDate || '')));

    list.innerHTML = rows.length
      ? rows.map(buildFactureCard).join('')
      : `<div class="factures-empty">
          <div class="factures-empty-title">Aucune facture</div>
          <div class="factures-empty-sub">Vos documents de paiement apparaîtront ici après réservation.</div>
          <button class="btn-gold-sm" onclick="window.location.href='reserver.html'">Faire une réservation</button>
        </div>`;
  }

  function buildFactureCard(r) {
    const state = paymentState(r);
    const total = parseFloat(r.totalPrice) || 0;
    const due = Math.max(0, total - state.paidAmount);
    const nights = calcNights(r.checkInDate, r.checkOutDate);

    return `
      <article class="facture-card">
        <div class="facture-card-main">
          <div class="facture-doc-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <div class="facture-card-body">
            <div class="facture-card-top">
              <div>
                <div class="facture-ref">Facture #${escHtml(r.id)}</div>
                <div class="facture-stay">${escHtml(r.roomType || 'Chambre')}${r.roomNumber ? ' · Chambre ' + escHtml(r.roomNumber) : ''}</div>
              </div>
              <span class="facture-status facture-status--${state.key}">${state.label}</span>
            </div>
            <div class="facture-card-meta">
              <span>${formatDateFr(r.checkInDate)} → ${formatDateFr(r.checkOutDate)}</span>
              <span>${nights} nuit${nights > 1 ? 's' : ''}</span>
              <span>${escHtml(r.paymentDetails || 'Mode non précisé')}</span>
            </div>
          </div>
        </div>
          <div class="facture-card-aside">
          <div class="facture-amount">${formatPrice(total)}</div>
          <div class="facture-due">${due > 0 ? formatPrice(due) + ' restant' : 'Solde réglé'}</div>
          ${due > 0 ? `<button class="facture-pay-btn" onclick="FacturesPaiements.openPayment(${Number(r.id) || 0})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/><path d="M7 15h4"/></svg>
            Payer
          </button>` : ''}
          <button class="res-btn-invoice" onclick="FacturesPaiements.openInvoice(${Number(r.id) || 0})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>
            Voir / PDF
          </button>
        </div>
      </article>`;
  }

  function renderPaymentMethods() {
    const wrap = document.getElementById('paiementsMethods');
    if (!wrap) return;

    const methods = getReservations()
      .filter(r => paymentState(r).key !== 'cancelled')
      .reduce((acc, r) => {
        const key = cleanPaymentMethod(r.paymentDetails);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

    const entries = Object.entries(methods);
    wrap.innerHTML = entries.length
      ? entries.map(([label, count]) => `
          <div class="paiement-method">
            <span>${escHtml(label)}</span>
            <strong>${count}</strong>
          </div>
        `).join('')
      : `<div class="paiement-method paiement-method--empty"><span>Aucun paiement</span><strong>0</strong></div>`;
  }

  function openInvoice(id) {
    window.MesReservations?.openInvoice(id);
  }

  function openPayment(id) {
    const r = getReservations().find(row => row.id == id);
    if (!r) return;

    const state = paymentState(r);
    const due = Math.max(0, (parseFloat(r.totalPrice) || 0) - state.paidAmount);
    if (due <= 0) return;

    payingId = id;
    clearPaymentForm();
    setText('facturePayRef', `Facture #${r.id} · ${r.roomType || 'Chambre'}`);
    setText('facturePayAmount', formatPrice(due));

    document.getElementById('facturePayOverlay')?.classList.add('open');
    const modal = document.getElementById('facturePayModal');
    if (modal) {
      modal.classList.add('open');
      modal.focus({ preventScroll: true });
    }
  }

  function closePayment() {
    document.getElementById('facturePayOverlay')?.classList.remove('open');
    document.getElementById('facturePayModal')?.classList.remove('open');
    payingId = null;
  }

  function handlePaymentChange() {
    const val = document.querySelector("input[name='facturePaiement']:checked")?.value;
    const cardFields = document.getElementById('factureCardFields');
    const paypalFields = document.getElementById('facturePaypalFields');
    if (cardFields) cardFields.style.display = val === 'carte' ? 'block' : 'none';
    if (paypalFields) paypalFields.style.display = val === 'paypal' ? 'block' : 'none';
    showPaymentError('');
  }

  function clearPaymentForm() {
    document.querySelectorAll("input[name='facturePaiement']").forEach(input => { input.checked = false; });
    ['factureCardNumber', 'factureCardExpiry', 'factureCardCvv', 'factureCardName', 'facturePaypalEmail'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const cardFields = document.getElementById('factureCardFields');
    const paypalFields = document.getElementById('facturePaypalFields');
    if (cardFields) cardFields.style.display = 'none';
    if (paypalFields) paypalFields.style.display = 'none';
    showPaymentError('');
  }

  function validatePaymentForm() {
    const method = document.querySelector("input[name='facturePaiement']:checked")?.value;
    if (!method) return 'Veuillez choisir un moyen de paiement.';
    if (method === 'espece') return 'Le paiement en especes n\'est pas disponible pour les factures.';

    if (method === 'carte') {
      const num = document.getElementById('factureCardNumber')?.value.replace(/\s/g, '') || '';
      const exp = document.getElementById('factureCardExpiry')?.value || '';
      const cvv = document.getElementById('factureCardCvv')?.value || '';
      const name = document.getElementById('factureCardName')?.value.trim() || '';
      if (!/^\d{16}$/.test(num)) return 'Numéro de carte invalide (16 chiffres).';
      if (!/^\d{2}\/\d{2}$/.test(exp)) return "Date d'expiration invalide (MM/AA).";
      if (!/^\d{3}$/.test(cvv)) return 'CVV invalide (3 chiffres).';
      if (!name) return 'Veuillez saisir le nom sur la carte.';
    }

    if (method === 'paypal') {
      const email = document.getElementById('facturePaypalEmail')?.value.trim() || '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Adresse PayPal invalide.';
    }

    return '';
  }

  function submitPayment() {
    if (!payingId) return;
    const error = validatePaymentForm();
    if (error) {
      showPaymentError(error);
      return;
    }

    const r = getReservations().find(row => row.id == payingId);
    if (!r) return;

    const method = document.querySelector("input[name='facturePaiement']:checked")?.value;
    const methodLabel = PAYMENT_LABELS[method] || method;
    const paidAt = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    const paymentDetails = `${methodLabel} · Payé le ${paidAt}`;
    const payload = {
      id: payingId,
      paymentDetails,
    };

    const currentStatus = normalizeStatusKey(r.status || r.Status);
    if (currentStatus === 'en attente') {
      payload.Status = 'Confirmée';
    }

    const btn = document.getElementById('facturePaySubmit');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Validation…';
    }

    fetch('gestion_reservation.php', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(res => res.json())
      .then(resp => {
        if (!resp.success) throw new Error(resp.error || 'Paiement impossible.');

        Object.assign(r, payload);
        if (payload.Status) r.status = payload.Status;
        render();
        closePayment();
        showToast('Paiement enregistré. Facture réglée.');
      })
      .catch(err => showPaymentError(err.message || 'Erreur lors du paiement.'))
      .finally(() => {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Confirmer le paiement';
        }
      });
  }

  function showPaymentError(message) {
    const el = document.getElementById('facturePayError');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('visible', !!message);
  }

  function showToast(message) {
    if (window.MesReservations?.showToast) {
      window.MesReservations.showToast(message);
      return;
    }
    let toast = document.querySelector('.dash-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'dash-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('visible'), 3200);
  }

  function openLatestInvoice() {
    const latest = getReservations()
      .filter(r => paymentState(r).key !== 'cancelled')
      .sort((a, b) => String(b.checkInDate || '').localeCompare(String(a.checkInDate || '')))[0];

    if (!latest) {
      alert('Aucune facture disponible pour le moment.');
      return false;
    }

    openInvoice(latest.id);
    return true;
  }

  function getReservations() {
    return Array.isArray(window.RESERVATIONS) ? window.RESERVATIONS : [];
  }

  function paymentState(r) {
    const status = normalizeStatusKey(r.status || r.Status);
    const payment = normalizeStatusKey(r.paymentDetails || '');
    const total = parseFloat(r.totalPrice) || 0;

    if (payment.includes('paye le') || payment.includes('payee le') || payment.includes('paid')) {
      return { key: 'paid', label: 'Payée', paidAmount: total };
    }
    if (['annule', 'annulee', 'cancelled', 'canceled'].includes(status)) {
      return { key: 'cancelled', label: 'Annulée', paidAmount: 0 };
    }
    if (['checked_in', 'checked in', 'checked_out', 'checked out', 'complete', 'completed', 'completee', 'complet', 'terminee'].includes(status)) {
      return { key: 'paid', label: 'Payée', paidAmount: total };
    }
    if (['confirmee', 'confirmed'].includes(status)) {
      return { key: 'deposit', label: 'Acompte 30%', paidAmount: total * 0.30 };
    }
    return { key: 'due', label: 'À régler', paidAmount: 0 };
  }

  function cleanPaymentMethod(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'Non précisé';
    return raw.split('·')[0].trim() || raw;
  }

  function normalizeStatusKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function calcNights(a, b) {
    const diff = Math.round((new Date(b) - new Date(a)) / 86400000);
    return Number.isFinite(diff) && diff > 0 ? diff : 1;
  }

  function formatDateFr(dateStr) {
    if (!dateStr) return '—';
    const [y, m, day] = String(dateStr).split('-');
    const months = ['jan','fév','mar','avr','mai','juin','juil','août','sep','oct','nov','déc'];
    return `${parseInt(day, 10)} ${months[(parseInt(m, 10) || 1) - 1]} ${y}`;
  }

  function formatPrice(amount) {
    return (parseFloat(amount) || 0).toLocaleString('fr-TN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }) + ' TND';
  }

  function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[ch]));
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  window.FacturesPaiements = {
    init,
    show,
    hide,
    openInvoice,
    openLatestInvoice,
    openPayment,
    closePayment,
    submitPayment,
  };
})();
