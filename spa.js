/* ============================================
   ROYAL MANSOUR — spa.js
   Section Spa & Bien-être
   ============================================ */

(function () {
  'use strict';

  const TREATMENTS = [
    {
      id: 'rituel-royal',
      category: 'rituels',
      name: 'Rituel Royal Relaxation',
      duration: '90 min',
      price: '180 TND',
      image: 'images/Spa_Relaxation.png',
      tag: 'Signature',
      tagClass: 'spa-tag--signature',
      short: 'Massage relaxant, aromathérapie et soin visage express pour une détente complète.',
      benefits: ['Aromathérapie', 'Massage complet', 'Soin visage'],
    },
    {
      id: 'hammam-traditionnel',
      category: 'hammam',
      name: 'Hammam Traditionnel',
      duration: '60 min',
      price: '95 TND',
      image: 'images/Spa_Relaxation2.png',
      tag: 'Tradition',
      tagClass: 'spa-tag--tradition',
      short: 'Rituel oriental avec vapeur, savon noir, gommage au gant kessa et pause infusion.',
      benefits: ['Gommage', 'Vapeur douce', 'Infusion offerte'],
    },
    {
      id: 'massage-balinais',
      category: 'massages',
      name: 'Massage Balinais',
      duration: '75 min',
      price: '145 TND',
      image: 'images/Spa_Relaxation3.png',
      tag: 'Relaxation',
      tagClass: 'spa-tag--relax',
      short: 'Pressions profondes et mouvements fluides pour libérer les tensions musculaires.',
      benefits: ['Tensions', 'Dos & épaules', 'Huiles chaudes'],
    },
    {
      id: 'soin-eclat',
      category: 'soins',
      name: 'Soin Éclat Méditerranéen',
      duration: '50 min',
      price: '120 TND',
      image: 'images/Spa_Relaxation4.png',
      tag: 'Visage',
      tagClass: 'spa-tag--face',
      short: 'Nettoyage, masque hydratant et massage liftant pour raviver l’éclat du visage.',
      benefits: ['Hydratation', 'Éclat', 'Massage liftant'],
    },
    {
      id: 'duo-serenite',
      category: 'rituels',
      name: 'Duo Sérénité',
      duration: '100 min',
      price: '320 TND',
      image: 'images/Spa_Relaxation.png',
      tag: 'Duo',
      tagClass: 'spa-tag--duo',
      short: 'Expérience à deux avec bain aromatique, massage relaxant et tisane en salon privé.',
      benefits: ['Salon privé', 'Bain aromatique', 'Massage duo'],
    },
    {
      id: 'reflexologie',
      category: 'massages',
      name: 'Réflexologie Plantaire',
      duration: '40 min',
      price: '85 TND',
      image: 'images/Spa_Relaxation3.png',
      tag: 'Énergie',
      tagClass: 'spa-tag--energy',
      short: 'Stimulation des zones réflexes pour relancer la circulation et alléger les jambes.',
      benefits: ['Circulation', 'Jambes légères', 'Équilibre'],
    },
  ];

  const SLOTS = ['09:00', '10:30', '12:00', '14:30', '16:00', '17:30', '19:00'];
  let _activeFilter = 'all';
  let _selectedTreatmentId = null;

  function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[ch]));
  }

  function init() {
    _injectHTML();
    _injectBookingModal();
    _bindEvents();
    _renderTreatments('all');
  }

  function show() {
    window.MesReservations?.hide();
    window.MonProfil?.hide();
    window.Activites?.hide();
    window.NosChambres?.hide();
    window.FacturesPaiements?.hide();
    window.Restaurant?.hide();

    document.querySelectorAll('.stats-row, .dashboard-grid, .checkin-banner').forEach(el => {
      el._spaHidden = true;
      el.style.display = 'none';
    });

    const roomsSection = document.getElementById('roomsSection');
    if (roomsSection) roomsSection.style.display = 'none';

    const section = document.getElementById('spaSection');
    if (section) {
      section.style.display = 'block';
      section.classList.add('active');
    }

    const greeting = document.querySelector('.topbar-greeting');
    if (greeting) greeting.textContent = 'Spa & Bien-être,';
  }

  function hide() {
    document.querySelectorAll('.stats-row, .dashboard-grid, .checkin-banner').forEach(el => {
      if (el._spaHidden) {
        el.style.display = '';
        el._spaHidden = false;
      }
    });

    const section = document.getElementById('spaSection');
    if (section) {
      section.style.display = 'none';
      section.classList.remove('active');
    }
  }

  function _injectHTML() {
    if (document.getElementById('spaSection')) return;

    const section = document.createElement('section');
    section.id = 'spaSection';
    section.className = 'spa-section';
    section.style.display = 'none';

    section.innerHTML = `
      <div class="spa-hero">
        <div class="spa-hero-copy">
          <div class="spa-eyebrow">✦ Royal Mansour — Spa</div>
          <h2 class="spa-title">Spa <em>&amp; Bien-être</em></h2>
          <p class="spa-subtitle">Rituels relaxants, hammam traditionnel et soins personnalisés.</p>
        </div>
        <div class="spa-hero-meta">
          <div class="spa-hero-stat">
            <span class="spa-hero-stat-val">6</span>
            <span class="spa-hero-stat-label">Soins disponibles</span>
          </div>
          <div class="spa-hero-stat">
            <span class="spa-hero-stat-val">09h–20h</span>
            <span class="spa-hero-stat-label">Tous les jours</span>
          </div>
        </div>
      </div>

      <div class="spa-toolbar">
        <button class="spa-filter active" data-spa-filter="all" onclick="SpaBienEtre.filter('all', this)">Tous</button>
        <button class="spa-filter" data-spa-filter="rituels" onclick="SpaBienEtre.filter('rituels', this)">Rituels</button>
        <button class="spa-filter" data-spa-filter="massages" onclick="SpaBienEtre.filter('massages', this)">Massages</button>
        <button class="spa-filter" data-spa-filter="hammam" onclick="SpaBienEtre.filter('hammam', this)">Hammam</button>
        <button class="spa-filter" data-spa-filter="soins" onclick="SpaBienEtre.filter('soins', this)">Soins visage</button>
      </div>

      <div class="spa-layout">
        <div class="spa-treatments-grid" id="spaTreatmentsGrid"></div>

        <aside class="spa-side-panel">
          <div class="spa-side-header">
            <span class="spa-eyebrow">Votre parenthèse</span>
            <h3>Conseils bien-être</h3>
          </div>
          <div class="spa-advice-list">
            <div class="spa-advice-item">
              <span>01</span>
              <p>Arrivez 15 minutes avant le soin pour profiter de l’espace détente.</p>
            </div>
            <div class="spa-advice-item">
              <span>02</span>
              <p>Le hammam est recommandé avant les massages profonds.</p>
            </div>
            <div class="spa-advice-item">
              <span>03</span>
              <p>Les soins duo se confirment selon disponibilité du salon privé.</p>
            </div>
          </div>
          <button class="spa-contact-btn" onclick="SpaBienEtre.openBooking('rituel-royal')">
            Réserver un soin
          </button>
        </aside>
      </div>

      <div class="spa-info-strip">
        <div class="spa-info-item">
          <div class="spa-info-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div><span>Horaires</span><strong>09h00 à 20h00</strong></div>
        </div>
        <div class="spa-info-item">
          <div class="spa-info-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
          </div>
          <div><span>Lieu</span><strong>Niveau piscine intérieure</strong></div>
        </div>
        <div class="spa-info-item">
          <div class="spa-info-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
          </div>
          <div><span>Personnalisation</span><strong>Pression, huiles et rythme au choix</strong></div>
        </div>
      </div>
    `;

    const topbar = document.querySelector('.topbar');
    if (topbar) topbar.insertAdjacentElement('afterend', section);
    else document.querySelector('.main-content')?.appendChild(section);
  }

  function _renderTreatments(filter) {
    _activeFilter = filter || 'all';
    const grid = document.getElementById('spaTreatmentsGrid');
    if (!grid) return;

    const list = _activeFilter === 'all'
      ? TREATMENTS
      : TREATMENTS.filter(item => item.category === _activeFilter);

    grid.innerHTML = list.map((item, idx) => _buildTreatmentCard(item, idx)).join('');
  }

  function _buildTreatmentCard(item, idx) {
    return `
      <article class="spa-card" style="animation-delay:${idx * 0.06}s">
        <div class="spa-card-img" style="background-image:url('${escHtml(item.image)}')">
          <span class="spa-tag ${escHtml(item.tagClass)}">${escHtml(item.tag)}</span>
        </div>
        <div class="spa-card-body">
          <div class="spa-card-top">
            <h3>${escHtml(item.name)}</h3>
            <span>${escHtml(item.price)}</span>
          </div>
          <p class="spa-card-desc">${escHtml(item.short)}</p>
          <div class="spa-card-meta">
            <span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${escHtml(item.duration)}
            </span>
            <span>${escHtml(_categoryLabel(item.category))}</span>
          </div>
          <div class="spa-benefits">
            ${item.benefits.map(benefit => `<span>${escHtml(benefit)}</span>`).join('')}
          </div>
          <div class="spa-card-actions">
            <button class="spa-outline-btn" onclick="SpaBienEtre.toggleDetail('${escHtml(item.id)}')">Détails</button>
            <button class="spa-gold-btn" onclick="SpaBienEtre.openBooking('${escHtml(item.id)}')">Réserver</button>
          </div>
          <div class="spa-detail" id="spaDetail-${escHtml(item.id)}">
            <p>Ce soin est adapté après un voyage, une journée plage ou une séance sportive. Votre praticien ajuste l’intensité au début de la séance.</p>
          </div>
        </div>
      </article>
    `;
  }

  function _categoryLabel(category) {
    return {
      rituels: 'Rituel',
      massages: 'Massage',
      hammam: 'Hammam',
      soins: 'Soin visage',
    }[category] || 'Soin';
  }

  function filter(filterName, btnEl) {
    document.querySelectorAll('.spa-filter').forEach(btn => btn.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    _renderTreatments(filterName);
  }

  function toggleDetail(id) {
    const el = document.getElementById('spaDetail-' + id);
    if (!el) return;
    el.classList.toggle('open');
  }

  function _injectBookingModal() {
    if (document.getElementById('spaBookingModal')) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="spa-booking-overlay" id="spaBookingOverlay" onclick="SpaBienEtre.closeBooking()"></div>
      <div class="spa-booking-modal" id="spaBookingModal" role="dialog" aria-modal="true">
        <div class="spa-booking-header">
          <div>
            <span class="spa-eyebrow">Réservation Spa</span>
            <h3 id="spaBookingTitle">Soin</h3>
            <p id="spaBookingMeta">Durée et tarif</p>
          </div>
          <button class="spa-modal-close" onclick="SpaBienEtre.closeBooking()" aria-label="Fermer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="spa-booking-body">
          <div class="spa-booking-grid">
            <div class="spa-field">
              <label>Date souhaitée</label>
              <input type="date" id="spaBookingDate">
            </div>
            <div class="spa-field">
              <label>Horaire</label>
              <select id="spaBookingSlot">
                ${SLOTS.map(slot => `<option value="${slot}">${slot}</option>`).join('')}
              </select>
            </div>
            <div class="spa-field">
              <label>Nombre de personnes</label>
              <select id="spaBookingGuests">
                <option value="1">1 personne</option>
                <option value="2">2 personnes</option>
              </select>
            </div>
            <div class="spa-field">
              <label>Préférence praticien</label>
              <select id="spaBookingPreference">
                <option value="sans-preference">Sans préférence</option>
                <option value="femme">Praticienne</option>
                <option value="homme">Praticien</option>
              </select>
            </div>
            <div class="spa-field spa-field--full">
              <label>Note particulière</label>
              <textarea id="spaBookingNote" rows="3" maxlength="300" placeholder="Allergie, pression souhaitée, occasion spéciale..."></textarea>
            </div>
          </div>
          <div class="spa-booking-error" id="spaBookingError"></div>
        </div>

        <div class="spa-booking-footer">
          <button class="spa-outline-btn" onclick="SpaBienEtre.closeBooking()">Annuler</button>
          <button class="spa-gold-btn" onclick="SpaBienEtre.submitBooking()">Confirmer la demande</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);
  }

  function _bindEvents() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeBooking();
    });
  }

  function openBooking(id) {
    const treatment = TREATMENTS.find(item => item.id === id) || TREATMENTS[0];
    _selectedTreatmentId = treatment.id;

    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('spaBookingDate');
    if (dateInput) {
      dateInput.min = today;
      if (!dateInput.value) dateInput.value = today;
    }

    const titleEl = document.getElementById('spaBookingTitle');
    const metaEl = document.getElementById('spaBookingMeta');
    if (titleEl) titleEl.textContent = treatment.name;
    if (metaEl) metaEl.textContent = `${treatment.duration} · ${treatment.price}`;

    _showBookingError('');
    document.getElementById('spaBookingOverlay')?.classList.add('open');
    document.getElementById('spaBookingModal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeBooking() {
    document.getElementById('spaBookingOverlay')?.classList.remove('open');
    document.getElementById('spaBookingModal')?.classList.remove('open');
    document.body.style.overflow = '';
  }

  function submitBooking() {
    const treatment = TREATMENTS.find(item => item.id === _selectedTreatmentId);
    const date = document.getElementById('spaBookingDate')?.value;
    const slot = document.getElementById('spaBookingSlot')?.value;
    const guests = document.getElementById('spaBookingGuests')?.value;

    if (!treatment || !date || !slot || !guests) {
      _showBookingError('Veuillez compléter la date, l’horaire et le nombre de personnes.');
      return;
    }

    closeBooking();
    _showSpaToast(`Demande Spa envoyée : ${treatment.name} le ${_formatDate(date)} à ${slot}.`);
  }

  function _showBookingError(message) {
    const el = document.getElementById('spaBookingError');
    if (!el) return;
    el.textContent = message || '';
  }

  function _formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  function _showSpaToast(message, type) {
    let toast = document.querySelector('.dash-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'dash-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.borderColor = type === 'error' ? '#ef4444' : 'var(--gold)';
    toast.style.color = type === 'error' ? '#f87171' : 'var(--gold)';
    toast.classList.add('visible');
    clearTimeout(toast._spaTimer);
    toast._spaTimer = setTimeout(() => toast.classList.remove('visible'), 3600);
  }

  window.SpaBienEtre = {
    init,
    show,
    hide,
    filter,
    toggleDetail,
    openBooking,
    closeBooking,
    submitBooking,
  };
})();
