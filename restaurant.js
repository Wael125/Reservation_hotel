/* ============================================
   ROYAL MANSOUR — restaurant.js
   Section Restaurant — même architecture que activites.js
   ============================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     DONNÉES STATIQUES — Menu & Services
     ---------------------------------------------------------- */

  const SERVICES = [
    {
      id: 'petit-dejeuner',
      nom: 'Petit-déjeuner Buffet',
      horaire: '07h00 – 10h30',
      icon: '☕',
      lieu: 'Restaurant Principal – Salle Jasmin',
      description: 'Buffet international avec viennoiseries fraîches, fruits de saison, œufs à la demande, fromages tunisiens et jus pressés. Terrasse disponible en été.',
      capacite: 180,
      image: 'images/restaurant_pdj.jpg',
      tag: 'Inclus All-inclusive',
      tagCls: 'resto-tag--included',
    },
    {
      id: 'dejeuner',
      nom: 'Déjeuner à la carte',
      horaire: '12h30 – 14h30',
      icon: '🍽️',
      lieu: 'Restaurant Principal – Salle Jasmin',
      description: 'Menu à la carte avec spécialités tunisiennes et méditerranéennes. Entrées, plats du jour et desserts maison préparés par notre chef. Réservation recommandée.',
      capacite: 120,
      image: 'images/restaurant_dejeuner.jpg',
      tag: 'Sur réservation',
      tagCls: 'resto-tag--reservation',
    },
    {
      id: 'diner',
      nom: 'Dîner Gastronomique',
      horaire: '19h00 – 22h30',
      icon: '🕯️',
      lieu: 'Restaurant Étoile – Terrasse Panoramique',
      description: 'Expérience gastronomique unique avec vue sur la Méditerranée. Menu dégustation 5 services ou carte. Dress code : tenue de soirée requise.',
      capacite: 60,
      image: 'images/restaurant_diner.jpg',
      tag: 'Gastronomique',
      tagCls: 'resto-tag--gastro',
    },
    {
      id: 'snack',
      nom: 'Snack Piscine & Plage',
      horaire: '10h00 – 18h00',
      icon: '🌊',
      lieu: 'Pool Bar · Plage privée',
      description: 'Restauration légère au bord de la piscine et sur la plage. Salades, sandwichs, mezze tunisiens, boissons fraîches et cocktails. Service en transat inclus.',
      capacite: 80,
      image: 'images/restaurant_snack.jpg',
      tag: 'Service en continu',
      tagCls: 'resto-tag--continu',
    },
    {
      id: 'bar',
      nom: 'Bar Lounge El Mansour',
      horaire: '11h00 – 00h00',
      icon: '🍸',
      lieu: 'Hall Principal – Niveau 0',
      description: 'Bar à cocktails avec sélection de vins tunisiens et internationaux, spiritueux premium et mocktails créatifs. Animation musicale en soirée les vendredi et samedi.',
      capacite: 40,
      image: 'images/restaurant_bar.jpg',
      tag: 'Soirées animées',
      tagCls: 'resto-tag--anim',
    },
    {
      id: 'room-service',
      nom: 'Room Service',
      horaire: '06h00 – 23h30',
      icon: '🛎️',
      lieu: 'Livraison en chambre',
      description: 'Menu complet disponible en chambre. Petit-déjeuner continental, plats chauds, en-cas, boissons. Livraison sous 30 minutes garantie. Commander via votre téléphone ou l\'application.',
      capacite: null,
      image: 'images/restaurant_roomservice.jpg',
      tag: '30 min garanties',
      tagCls: 'resto-tag--fast',
    },
  ];

  const MENU_CATEGORIES = [
    {
      id: 'entrees',
      label: 'Entrées',
      icon: '🥗',
      plats: [
        { nom: 'Salade méchouia',       desc: 'Poivrons et tomates grillés, câpres, thon, huile d\'olive',          prix: '14 TND', badge: 'Signature' },
        { nom: 'Brik à l\'œuf',         desc: 'Feuille de brik croustillante, thon, persil, citron',               prix: '12 TND', badge: null },
        { nom: 'Assiette de mezze',      desc: 'Houmous, harissa maison, olives, fromage frais, pain tabouna',      prix: '18 TND', badge: 'Populaire' },
        { nom: 'Carpaccio de daurade',   desc: 'Daurade marinée, agrumes, huile de coriandre, fleur de sel',       prix: '22 TND', badge: 'Chef' },
        { nom: 'Chorba tunisienne',      desc: 'Soupe traditionnelle, vermicelles, tomates, coriandre fraîche',    prix: '11 TND', badge: null },
      ],
    },
    {
      id: 'plats',
      label: 'Plats',
      icon: '🍖',
      plats: [
        { nom: 'Couscous royal',         desc: 'Semoule fine, légumes de saison, merguez, agneau confit, sauce piquante', prix: '38 TND', badge: 'Signature' },
        { nom: 'Loup de mer grillé',     desc: 'Entier ou en filet, légumes du marché, chermoula, riz au beurre',  prix: '45 TND', badge: 'Chef' },
        { nom: 'Tajine de poulet',       desc: 'Poulet fermier, olives vertes, citron confit, pommes de terre',    prix: '32 TND', badge: null },
        { nom: 'Brochettes mixtes',      desc: 'Bœuf, agneau, poulet marinés, accompagnement au choix',           prix: '36 TND', badge: 'Populaire' },
        { nom: 'Pâtes aux fruits de mer',desc: 'Linguines, calamars, crevettes, palourdes, sauce vierge',         prix: '42 TND', badge: null },
        { nom: 'Risotto safran',         desc: 'Riz carnaroli, safran de Tunisie, parmesan, huile de truffe',      prix: '34 TND', badge: null },
      ],
    },
    {
      id: 'desserts',
      label: 'Desserts',
      icon: '🍮',
      plats: [
        { nom: 'Makroudh maison',        desc: 'Semoule, dattes Deglet Nour, miel de thym, cannelle',             prix: '12 TND', badge: 'Signature' },
        { nom: 'Crème brûlée à la fleur d\'oranger', desc: 'Crème onctueuse, zeste d\'orange, caramel croquant', prix: '14 TND', badge: null },
        { nom: 'Baklawa assortis',       desc: 'Pistache, amandes, miel de lavande, eau de rose',                 prix: '15 TND', badge: 'Populaire' },
        { nom: 'Assiette de fromages',   desc: 'Sélection affinée, confiture de figue, noix, pain grillé',       prix: '22 TND', badge: null },
        { nom: 'Fondant au chocolat',    desc: 'Chocolat noir 70%, cœur coulant, glace vanille bourbon',         prix: '16 TND', badge: 'Chef' },
      ],
    },
    {
      id: 'boissons',
      label: 'Boissons',
      icon: '🥂',
      plats: [
        { nom: 'Vins de Tunisie',        desc: 'Sélection Mornag, Coteaux de Carthage, Muscat de Kelibia',        prix: 'dès 28 TND', badge: 'Local' },
        { nom: 'Jus de fruits frais',    desc: 'Orange, grenade, carotte-gingembre, citronnade à la menthe',     prix: '9 TND', badge: null },
        { nom: 'Cocktails signature',    desc: 'El Mansour Mule, Jasmin Fizz, Sahara Sunset — sans alcool aussi', prix: 'dès 16 TND', badge: null },
        { nom: 'Thé à la menthe',        desc: 'Cérémonie traditionnelle, pignons de pin, sucre maison',         prix: '8 TND', badge: 'Signature' },
        { nom: 'Eaux & Softs',           desc: 'Eau minérale, gazeuse, sodas, Perrier',                          prix: 'dès 5 TND', badge: null },
      ],
    },
  ];

  /* ----------------------------------------------------------
     ÉTAT LOCAL
     ---------------------------------------------------------- */
  let _activeTab       = 'services';   // 'services' | 'menu'
  let _activeMenuCat   = 'entrees';
  let _activeServiceFilter = 'all';
  let _openServiceId   = null;

  /* ----------------------------------------------------------
     HELPERS
     ---------------------------------------------------------- */
  function escHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[ch]));
  }

  /* ----------------------------------------------------------
     SHOW / HIDE — même pattern que Activites
     Cache aussi le bandeau accueil dans la section Restaurant.
     ---------------------------------------------------------- */
  function show() {
    window.MesReservations?.hide();
    window.MonProfil?.hide();
    window.Activites?.hide();
    window.NosChambres?.hide();
    window.FacturesPaiements?.hide();

    document.querySelectorAll('.stats-row, .dashboard-grid, .checkin-banner').forEach(el => {
      el._restaurantHidden = true;
      el.style.display = 'none';
    });

    const roomsSection = document.getElementById('roomsSection');
    if (roomsSection) roomsSection.style.display = 'none';

    const section = document.getElementById('restaurantSection');
    if (section) {
      section.style.display = 'block';
      section.classList.add('active');
    }

    const greeting = document.querySelector('.topbar-greeting');
    if (greeting) greeting.textContent = 'Restaurant & Bar,';
  }

  function hide() {
    document.querySelectorAll('.stats-row, .dashboard-grid, .checkin-banner').forEach(el => {
      if (el._restaurantHidden) {
        el.style.display = '';
        el._restaurantHidden = false;
      }
    });

    const section = document.getElementById('restaurantSection');
    if (section) {
      section.style.display = 'none';
      section.classList.remove('active');
    }
  }

  /* ----------------------------------------------------------
     INIT
     ---------------------------------------------------------- */
  function init() {
    _injectHTML();
    _bindEvents();
  }

  /* ----------------------------------------------------------
     INJECTION HTML SECTION
     ---------------------------------------------------------- */
  function _injectHTML() {
    if (document.getElementById('restaurantSection')) return;

    const section = document.createElement('section');
    section.id = 'restaurantSection';
    section.className = 'restaurant-section';
    section.style.display = 'none';

    section.innerHTML = `

      <!-- ══ HERO ══ -->
      <div class="resto-hero">
        <div class="resto-hero-left">
          <div class="resto-eyebrow">✦ Royal Mansour — Gastronomie</div>
          <h2 class="resto-title">Restaurant <em>&amp; Bar</em></h2>
          <p class="resto-subtitle">Saveurs tunisiennes et méditerranéennes · Terrasse panoramique · Bord de mer</p>
        </div>
        <div class="resto-hero-right">
          <div class="resto-hero-stat">
            <span class="resto-hero-stat-val">6</span>
            <span class="resto-hero-stat-label">Points de restauration</span>
          </div>
          <div class="resto-hero-stat">
            <span class="resto-hero-stat-val">07h–00h</span>
            <span class="resto-hero-stat-label">Service continu</span>
          </div>
        </div>
      </div>

      <!-- ══ TABS ══ -->
      <div class="resto-tabs">
        <button class="resto-tab active" data-tab="services" onclick="Restaurant._switchTab('services', this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Horaires &amp; Services
        </button>
        <button class="resto-tab" data-tab="menu" onclick="Restaurant._switchTab('menu', this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/>
            <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
          </svg>
          Menu &amp; Carte
        </button>
      </div>

      <!-- ══ TAB : SERVICES ══ -->
      <div class="resto-tab-panel active" id="restoTabServices">

        <!-- Filtres -->
        <div class="resto-filters" id="restoFilters">
          <button class="resto-filter active" data-filter="all" onclick="Restaurant._filterServices('all', this)">Tous</button>
          <button class="resto-filter" data-filter="repas" onclick="Restaurant._filterServices('repas', this)">🍽️ Repas</button>
          <button class="resto-filter" data-filter="snack" onclick="Restaurant._filterServices('snack', this)">🌊 Snack</button>
          <button class="resto-filter" data-filter="bar" onclick="Restaurant._filterServices('bar', this)">🍸 Bar</button>
          <button class="resto-filter" data-filter="room" onclick="Restaurant._filterServices('room', this)">🛎️ Room Service</button>
        </div>

        <!-- Grille services -->
        <div class="resto-services-grid" id="restoServicesGrid"></div>

        <!-- Infos pratiques -->
        <div class="resto-info-strip">
          <div class="resto-info-item">
            <div class="resto-info-icon">📍</div>
            <div>
              <div class="resto-info-label">Localisation</div>
              <div class="resto-info-val">Route Touristique · Mahdia 5100</div>
            </div>
          </div>
          <div class="resto-info-item">
            <div class="resto-info-icon">📞</div>
            <div>
              <div class="resto-info-label">Réservations</div>
              <div class="resto-info-val">+216 73 681 100 · Poste 3</div>
            </div>
          </div>
          <div class="resto-info-item">
            <div class="resto-info-icon">💳</div>
            <div>
              <div class="resto-info-label">Paiement</div>
              <div class="resto-info-val">CB · Espèces · Débit chambre</div>
            </div>
          </div>
          <div class="resto-info-item">
            <div class="resto-info-icon">🌿</div>
            <div>
              <div class="resto-info-label">Régimes spéciaux</div>
              <div class="resto-info-val">Végétarien · Halal · Sans gluten</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ TAB : MENU ══ -->
      <div class="resto-tab-panel" id="restoTabMenu">

        <!-- Sélecteur catégorie -->
        <div class="resto-menu-cats" id="restoMenuCats"></div>

        <!-- Liste plats -->
        <div class="resto-menu-list" id="restoMenuList"></div>

        <!-- Note bas de page -->
        <div class="resto-menu-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Les prix s'entendent TTC. Carte susceptible d'évoluer selon les saisons et arrivages.
          Allergènes disponibles sur demande auprès de votre serveur.
        </div>
      </div>

    `;

    /* Insérer après le topbar */
    const topbar = document.querySelector('.topbar');
    if (topbar) topbar.insertAdjacentElement('afterend', section);
    else document.querySelector('.main-content')?.appendChild(section);

    /* Remplir les données */
    _renderServices('all');
    _renderMenuCats();
    _renderMenu('entrees');
  }

  /* ----------------------------------------------------------
     SERVICES — RENDU
     ---------------------------------------------------------- */
  const SERVICE_FILTER_MAP = {
    repas: ['petit-dejeuner', 'dejeuner', 'diner'],
    snack: ['snack'],
    bar:   ['bar'],
    room:  ['room-service'],
  };

  function _filterServices(filter, btnEl) {
    _activeServiceFilter = filter;
    document.querySelectorAll('.resto-filter').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    _renderServices(filter);
  }

  function _renderServices(filter) {
    const grid = document.getElementById('restoServicesGrid');
    if (!grid) return;

    const list = filter === 'all'
      ? SERVICES
      : SERVICES.filter(s => (SERVICE_FILTER_MAP[filter] || []).includes(s.id));

    grid.innerHTML = list.map((s, i) => _buildServiceCard(s, i)).join('');
  }

  function _buildServiceCard(s, idx) {
    const isOpen = _isServiceOpen(s.horaire);
    const statusCls  = isOpen ? 'resto-status--open'   : 'resto-status--closed';
    const statusTxt  = isOpen ? '● Ouvert maintenant'  : '○ Fermé actuellement';

    return `
      <article class="resto-service-card" style="animation-delay:${idx * 0.07}s"
               onclick="Restaurant._toggleServiceDetail('${s.id}')">
        <div class="resto-service-header">
          <div class="resto-service-icon">${s.icon}</div>
          <div class="resto-service-info">
            <div class="resto-service-name">${escHtml(s.nom)}</div>
            <div class="resto-service-lieu">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              ${escHtml(s.lieu)}
            </div>
          </div>
          <div class="resto-service-right">
            <div class="resto-horaire">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              ${escHtml(s.horaire)}
            </div>
            <span class="resto-status ${statusCls}">${statusTxt}</span>
          </div>
        </div>

        <div class="resto-service-detail" id="restoDetail-${s.id}">
          <p class="resto-service-desc">${escHtml(s.description)}</p>
          <div class="resto-service-footer">
            <span class="resto-tag ${escHtml(s.tagCls)}">${escHtml(s.tag)}</span>
            ${s.capacite ? `
            <span class="resto-capacite">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
              </svg>
              ${s.capacite} couverts
            </span>` : ''}
            <button class="resto-reserve-btn" onclick="event.stopPropagation(); Restaurant._openReservation('${s.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Réserver une table
            </button>
          </div>
        </div>

        <div class="resto-card-chevron" id="restoChevron-${s.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </article>
    `;
  }

  function _toggleServiceDetail(id) {
    const detail  = document.getElementById(`restoDetail-${id}`);
    const chevron = document.getElementById(`restoChevron-${id}`);
    if (!detail) return;
    const isOpen = detail.classList.toggle('open');
    if (chevron) chevron.style.transform = isOpen ? 'rotate(180deg)' : '';
  }

  function _isServiceOpen(horaire) {
    if (!horaire) return false;
    const now = new Date();
    const h   = now.getHours() * 60 + now.getMinutes();
    const m   = horaire.match(/(\d{2})h(\d{2})\s*[–-]\s*(\d{2})h(\d{2})/);
    if (!m) return false;
    const start = parseInt(m[1]) * 60 + parseInt(m[2]);
    let   end   = parseInt(m[3]) * 60 + parseInt(m[4]);
    if (end === 0) end = 24 * 60; // minuit
    if (end < start) return h >= start || h < end; // passe minuit
    return h >= start && h < end;
  }

  /* ----------------------------------------------------------
     MENU — RENDU
     ---------------------------------------------------------- */
  function _renderMenuCats() {
    const wrap = document.getElementById('restoMenuCats');
    if (!wrap) return;
    wrap.innerHTML = MENU_CATEGORIES.map(cat => `
      <button
        class="resto-menu-cat${cat.id === 'entrees' ? ' active' : ''}"
        onclick="Restaurant._switchMenuCat('${cat.id}', this)"
      >
        <span class="resto-menu-cat-icon">${cat.icon}</span>
        <span>${escHtml(cat.label)}</span>
      </button>
    `).join('');
  }

  function _switchMenuCat(id, btnEl) {
    _activeMenuCat = id;
    document.querySelectorAll('.resto-menu-cat').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    _renderMenu(id);
  }

  function _renderMenu(catId) {
    const list = document.getElementById('restoMenuList');
    if (!list) return;
    const cat = MENU_CATEGORIES.find(c => c.id === catId);
    if (!cat) return;

    list.innerHTML = `
      <div class="resto-menu-header">
        <span class="resto-menu-cat-label">${cat.icon} ${escHtml(cat.label)}</span>
        <span class="resto-menu-count">${cat.plats.length} plats</span>
      </div>
      <div class="resto-plats-grid">
        ${cat.plats.map((p, i) => `
          <div class="resto-plat" style="animation-delay:${i * 0.06}s">
            <div class="resto-plat-body">
              <div class="resto-plat-top">
                <div class="resto-plat-nom">${escHtml(p.nom)}</div>
                ${p.badge ? `<span class="resto-plat-badge resto-plat-badge--${escHtml(p.badge.toLowerCase())}">${escHtml(p.badge)}</span>` : ''}
              </div>
              <div class="resto-plat-desc">${escHtml(p.desc)}</div>
            </div>
            <div class="resto-plat-prix">${escHtml(p.prix)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /* ----------------------------------------------------------
     SWITCH TABS
     ---------------------------------------------------------- */
  function _switchTab(tab, btnEl) {
    _activeTab = tab;
    document.querySelectorAll('.resto-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.resto-tab-panel').forEach(p => p.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    const panel = document.getElementById(tab === 'services' ? 'restoTabServices' : 'restoTabMenu');
    if (panel) panel.classList.add('active');
  }

  /* ----------------------------------------------------------
     MODAL RÉSERVATION TABLE
     ---------------------------------------------------------- */
  function _openReservation(serviceId) {
    const s = SERVICES.find(sv => sv.id === serviceId);
    if (!s) return;

    /* Toast de confirmation / contact conciergerie */
    const modal = document.getElementById('restoReservModal');
    if (modal) {
      document.getElementById('restoReservTitle').textContent  = s.nom;
      document.getElementById('restoReservHoraire').textContent = s.horaire;
      document.getElementById('restoReservLieu').textContent    = s.lieu;
      modal.classList.add('open');
      document.getElementById('restoReservOverlay')?.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  function _closeReservation() {
    document.getElementById('restoReservModal')?.classList.remove('open');
    document.getElementById('restoReservOverlay')?.classList.remove('open');
    document.body.style.overflow = '';
  }

  function _submitReservation() {
    const date    = document.getElementById('restoReservDate')?.value;
    const heure   = document.getElementById('restoReservHeure')?.value;
    const couverts= document.getElementById('restoReservCouverts')?.value;
    const note    = document.getElementById('restoReservNote')?.value?.trim();

    if (!date || !heure || !couverts) {
      _showRestoToast('Veuillez remplir tous les champs obligatoires.', 'error');
      return;
    }

    /* Simulation envoi — en production, fetch vers reservation_restaurant.php */
    _closeReservation();
    _showRestoToast(`Table réservée pour ${couverts} personne${couverts > 1 ? 's' : ''} le ${_formatDate(date)} à ${heure} ✓`);
  }

  function _formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function _showRestoToast(msg, type) {
    let t = document.querySelector('.dash-toast');
    if (!t) { t = document.createElement('div'); t.className = 'dash-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.borderColor = type === 'error' ? '#ef4444' : 'var(--gold)';
    t.style.color       = type === 'error' ? '#f87171' : 'var(--gold)';
    t.classList.add('visible');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('visible'), 3500);
  }

  /* ----------------------------------------------------------
     INJECTION MODAL RÉSERVATION
     ---------------------------------------------------------- */
  function _injectReservModal() {
    if (document.getElementById('restoReservModal')) return;

    /* Date min = demain */
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const minDate = tomorrow.toISOString().split('T')[0];

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="resto-reserv-overlay" id="restoReservOverlay" onclick="Restaurant._closeReservation()"></div>
      <div class="resto-reserv-modal" id="restoReservModal">

        <div class="resto-reserv-header">
          <div>
            <span class="resto-reserv-eyebrow">Réservation de table</span>
            <h3 class="resto-reserv-title" id="restoReservTitle">—</h3>
            <div class="resto-reserv-meta">
              <span id="restoReservHoraire"></span>
              <span>·</span>
              <span id="restoReservLieu"></span>
            </div>
          </div>
          <button class="resto-reserv-close" onclick="Restaurant._closeReservation()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="resto-reserv-body">

          <div class="resto-reserv-row">
            <div class="resto-reserv-field">
              <label class="resto-reserv-label">Date <span class="resto-req">*</span></label>
              <input type="date" class="resto-reserv-input" id="restoReservDate" min="${minDate}">
            </div>
            <div class="resto-reserv-field">
              <label class="resto-reserv-label">Heure <span class="resto-req">*</span></label>
              <select class="resto-reserv-select" id="restoReservHeure">
                <option value="">Choisir…</option>
                <option>07h00</option><option>07h30</option><option>08h00</option>
                <option>08h30</option><option>09h00</option><option>09h30</option><option>10h00</option>
                <option>12h30</option><option>13h00</option><option>13h30</option><option>14h00</option>
                <option>19h00</option><option>19h30</option><option>20h00</option>
                <option>20h30</option><option>21h00</option><option>21h30</option><option>22h00</option>
              </select>
            </div>
          </div>

          <div class="resto-reserv-field">
            <label class="resto-reserv-label">Nombre de couverts <span class="resto-req">*</span></label>
            <div class="resto-couverts-row">
              ${[1,2,3,4,5,6,7,8].map(n => `
                <button type="button"
                  class="resto-couvert-btn"
                  onclick="Restaurant._selectCouverts(${n}, this)">
                  ${n}
                </button>
              `).join('')}
            </div>
            <input type="hidden" id="restoReservCouverts">
          </div>

          <div class="resto-reserv-field">
            <label class="resto-reserv-label">Demande spéciale <span class="resto-opt">(optionnel)</span></label>
            <textarea class="resto-reserv-textarea" id="restoReservNote"
              placeholder="Allergie, chaise haute, anniversaire, régime particulier…"
              rows="3" maxlength="500"></textarea>
          </div>

          <div class="resto-reserv-notice">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Confirmation par notre équipe sous 2h. Annulation gratuite jusqu'à 2h avant le service.
          </div>
        </div>

        <div class="resto-reserv-footer">
          <button class="btn-outline-sm" onclick="Restaurant._closeReservation()">Annuler</button>
          <button class="btn-gold-sm" onclick="Restaurant._submitReservation()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Confirmer la réservation
          </button>
        </div>

      </div>
    `;
    document.body.appendChild(wrapper);
  }

  function _selectCouverts(n, btnEl) {
    document.querySelectorAll('.resto-couvert-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    const hidden = document.getElementById('restoReservCouverts');
    if (hidden) hidden.value = n;
  }

  /* ----------------------------------------------------------
     BIND EVENTS
     ---------------------------------------------------------- */
  function _bindEvents() {
    _injectReservModal();
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') _closeReservation();
    });
  }

  /* ----------------------------------------------------------
     EXPOSITION PUBLIQUE
     ---------------------------------------------------------- */
  window.Restaurant = {
    init,
    show,
    hide,
    _switchTab,
    _filterServices,
    _switchMenuCat,
    _toggleServiceDetail,
    _openReservation,
    _closeReservation,
    _submitReservation,
    _selectCouverts,
  };

})();
