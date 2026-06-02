/* ============================================
   ROYAL MANSOUR — activites.js
   Section Activités — même architecture que nos_chambres.js
   ============================================ */

(function () {

  /* ----------------------------------------------------------
     MAPPING IMAGES PAR NOM D'ACTIVITÉ
     ---------------------------------------------------------- */
  const IMAGES_MAP = {
    'Spa Relaxation':              [
      'images/Spa_Relaxation.png',
      'images/Spa_Relaxation2.png',
      'images/Spa_Relaxation3.png',
      'images/Spa_Relaxation4.png',
    ],
    'Excursion en bateau':         [
      'images/Excursion_en_bateau.png',
      'images/Excursion_en_bateau2.png',
      'images/Excursion_en_bateau3.png',
      'images/Excursion_en_bateau4.png',
      'images/Excursion_en_bateau5.png',
    ],
    'Salle de sport':              [
      'images/Salle_de_sport_hotel.png',
      'images/Salle_de_sport_hotel1.png',
      'images/Salle_de_sport_hotel2.png',
      'images/Salle_de_sport_hotel3.png',
    ],
    'Cours de cuisine tunisienne': [
      'images/Cours_de_cuisine_tunisienne.png',
      'images/Cours_de_cuisine_tunisienne1.png',
    ],
    'Piscine VIP':                 [
      'images/Piscine_VIP.png',
      'images/Piscine_VIP1.png',
    ],
    'Soirée musicale':             [
      'images/Soirée_musicale.png',
      'images/Soirée_musicale2.png',
      'images/Soirée_musicale3.png',
    ],
    'Yoga matinal':                [
      'images/Yoga_matinal.png',
      'images/Yoga_matinal2.png',
      'images/Yoga_matinal3.png',
    ],
  };

  /* Image principale (index 0) */
  function getMainImage(nom) {
    const imgs = IMAGES_MAP[nom];
    return (imgs && imgs.length > 0) ? imgs[0] : 'images/double.png';
  }

  /* Toutes les images d'une activité */
  function getGallery(nom) {
    return IMAGES_MAP[nom] || [getMainImage(nom)];
  }

  /* ----------------------------------------------------------
     MAPPING TYPE → CLASSE CSS badge
     ---------------------------------------------------------- */
  const TYPE_CLASS = {
    'Bien-être':       'activite-badge-type--bienetre',
    'Loisir':          'activite-badge-type--loisir',
    'Sport':           'activite-badge-type--sport',
    'Culture':         'activite-badge-type--culture',
    'Détente':         'activite-badge-type--detente',
    'Divertissement':  'activite-badge-type--divertissement',
  };

  function getTypeCls(type) {
    return TYPE_CLASS[type] || 'activite-badge-type--loisir';
  }

  /* ----------------------------------------------------------
     MAPPING TYPE → ICÔNE EMOJI
     ---------------------------------------------------------- */
  const TYPE_ICON = {
    'Bien-être':       '🌿',
    'Loisir':          '⛵',
    'Sport':           '🏋️',
    'Culture':         '🍽️',
    'Détente':         '🏊',
    'Divertissement':  '🎵',
  };

  function getTypeIcon(type) {
    return TYPE_ICON[type] || '✦';
  }

  /* ----------------------------------------------------------
     ÉTAT LOCAL
     ---------------------------------------------------------- */
  let _activites    = [];         // données brutes chargées depuis PHP
  let _filterActive = 'all';      // filtre actif
  let _modalIndex   = null;       // index activité ouverte dans le modal
  let _thumbIndex   = 0;          // image active dans le modal

  /* ----------------------------------------------------------
     HELPERS HTML
     ---------------------------------------------------------- */
  function escHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[ch]));
  }

  /* ----------------------------------------------------------
     CHARGEMENT DONNÉES (fetch PHP)
     ---------------------------------------------------------- */
  async function loadActivites() {
    try {
      const res  = await fetch('activites_data.php');
      const data = await res.json();
      if (data.success) {
        _activites = data.activites;
      } else {
        console.error('Activités — erreur serveur:', data.error);
        _activites = [];
      }
    } catch (err) {
      console.error('Activités — fetch échoué:', err);
      _activites = [];
    }
    renderActivites();
    updateCountLabel();
  }

  /* ----------------------------------------------------------
     RENDU GRILLE
     ---------------------------------------------------------- */
  function renderActivites(filter) {
    if (filter !== undefined) _filterActive = filter;

    const grid = document.getElementById('activitesGrid');
    if (!grid) return;

    const list = _filterActive === 'all'
      ? _activites
      : _activites.filter(a => normalizeType(a.type_activite) === _filterActive);

    if (list.length === 0) {
      grid.innerHTML = `
        <div class="activites-empty">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p>Aucune activité dans cette catégorie</p>
        </div>`;
      return;
    }

    grid.innerHTML = list.map((a, idx) => buildCard(a, idx)).join('');
    updateCountLabel(list.length);
  }

  /* Normaliser le type pour les filtres */
  function normalizeType(type) {
    if (!type) return '';
    return type
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '-');
  }

  /* ----------------------------------------------------------
     HTML D'UNE CARD
     ---------------------------------------------------------- */
  function buildCard(a, localIdx) {
    const globalIdx  = _activites.indexOf(a);
    const mainImg    = getMainImage(a.nom_activite);
    const isDispo    = a.statut === 'Disponible';
    const typeCls    = getTypeCls(a.type_activite);
    const typeIcon   = getTypeIcon(a.type_activite);

    return `
      <article
        class="activite-card${isDispo ? '' : ' activite-card--indisponible'}"
        onclick="${isDispo ? `Activites.openModal(${globalIdx})` : ''}"
        title="${isDispo ? 'Voir les détails' : 'Activité temporairement indisponible'}"
      >
        <!-- Image -->
        <div class="activite-card-img" style="background-image:url('${escHtml(mainImg)}')">
          <div class="activite-card-img-overlay"></div>

          <!-- Badges -->
          <div class="activite-card-badges">
            <span class="activite-badge-type ${escHtml(typeCls)}">${typeIcon} ${escHtml(a.type_activite)}</span>
          </div>

          ${!isDispo ? `<span class="activite-badge-indispo">Indisponible</span>` : ''}

          <!-- Capacité -->
          <div class="activite-card-capacity-overlay">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87"/>
              <path d="M16 3.13a4 4 0 010 7.75"/>
            </svg>
            ${escHtml(String(a.capacite_max))} pers. max
          </div>
        </div>

        <!-- Body -->
        <div class="activite-card-body">
          <div class="activite-card-header">
            <h3 class="activite-card-title">${escHtml(a.nom_activite)}</h3>
          </div>

          <!-- Méta -->
          <div class="activite-card-meta">
            <div class="activite-meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <strong>${escHtml(a.duree)}</strong>
            </div>
          </div>

          <!-- Description -->
          <p class="activite-card-desc">${escHtml(a.description)}</p>

          <!-- Footer -->
          <div class="activite-card-footer">
            <div class="activite-card-loc">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              ${escHtml(a.localisation)}
            </div>
            ${isDispo
              ? `<button class="activite-detail-btn" onclick="event.stopPropagation(); Activites.openModal(${globalIdx})">
                   Détails
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                     <path d="M9 18l6-6-6-6"/>
                   </svg>
                 </button>`
              : `<span style="font-size:10px;font-weight:600;letter-spacing:1.3px;text-transform:uppercase;color:#f87171;">Bientôt disponible</span>`
            }
          </div>
        </div>
      </article>
    `;
  }

  /* ----------------------------------------------------------
     MODAL DÉTAIL
     ---------------------------------------------------------- */
  function openModal(idx) {
    const a = _activites[idx];
    if (!a) return;

    _modalIndex = idx;
    _thumbIndex = 0;

    const gallery  = getGallery(a.nom_activite);
    const isDispo  = a.statut === 'Disponible';
    const typeCls  = getTypeCls(a.type_activite);
    const typeIcon = getTypeIcon(a.type_activite);

    // --- Hero image ---
    const heroEl = document.getElementById('activiteModalHero');
    if (heroEl) heroEl.style.backgroundImage = `url('${gallery[0]}')`;

    // --- Galerie miniatures ---
    const thumbsEl = document.getElementById('activiteModalThumbs');
    if (thumbsEl) {
      if (gallery.length > 1) {
        thumbsEl.style.display = 'flex';
        thumbsEl.innerHTML = gallery.map((img, i) => `
          <div
            class="activite-thumb${i === 0 ? ' active' : ''}"
            style="background-image:url('${escHtml(img)}')"
            onclick="Activites.setThumb(${i})"
            title="Photo ${i + 1}"
          ></div>
        `).join('');
      } else {
        thumbsEl.style.display = 'none';
      }
    }

    // --- Titre ---
    const titleEl = document.getElementById('activiteModalTitle');
    if (titleEl) {
      const words = a.nom_activite.split(' ');
      const last  = words.pop();
      titleEl.innerHTML = words.join(' ') + (words.length ? ' <em>' + escHtml(last) + '</em>' : escHtml(last));
    }

    // --- Stats bande ---
    const statsEl = document.getElementById('activiteModalStats');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="activite-modal-stat">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span class="activite-modal-stat-val">${escHtml(a.duree)}</span>
          <span class="activite-modal-stat-label">Durée</span>
        </div>
        <div class="activite-modal-stat">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87"/>
            <path d="M16 3.13a4 4 0 010 7.75"/>
          </svg>
          <span class="activite-modal-stat-val">${escHtml(String(a.capacite_max))}</span>
          <span class="activite-modal-stat-label">Capacité max</span>
        </div>
        <div class="activite-modal-stat">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <span class="activite-modal-stat-val" style="font-size:14px;line-height:1.2;">${escHtml(a.localisation)}</span>
          <span class="activite-modal-stat-label">Lieu</span>
        </div>
        <div class="activite-modal-stat">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span class="activite-modal-stat-val" style="font-size:13px;line-height:1.2;">${escHtml(a.type_activite)}</span>
          <span class="activite-modal-stat-label">Catégorie</span>
        </div>
      `;
    }

    // --- Statut badge ---
    const statutEl = document.getElementById('activiteModalStatut');
    if (statutEl) {
      if (isDispo) {
        statutEl.className = 'activite-modal-statut activite-modal-statut--dispo';
        statutEl.innerHTML = 'Disponible';
      } else {
        statutEl.className = 'activite-modal-statut activite-modal-statut--indispo';
        statutEl.innerHTML = '⛔ Temporairement indisponible';
      }
    }

    // --- Description ---
    const descEl = document.getElementById('activiteModalDesc');
    if (descEl) descEl.textContent = a.description;

    // --- Badge type dans modal ---
    const badgeTypeEl = document.getElementById('activiteModalBadgeType');
    if (badgeTypeEl) {
      badgeTypeEl.className = 'activite-badge-type ' + typeCls;
      badgeTypeEl.textContent = typeIcon + ' ' + a.type_activite;
    }

    // --- Bouton action footer ---
    const actionBtn = document.getElementById('activiteModalActionBtn');
    if (actionBtn) {
      if (isDispo) {
        actionBtn.style.display = 'flex';
        actionBtn.onclick = function () {
          closeModal();
          contactConcierge();
        };
      } else {
        actionBtn.style.display = 'none';
      }
    }

    // --- Ouvrir modal ---
    document.getElementById('activiteOverlay').classList.add('open');
    document.getElementById('activiteModal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('activiteOverlay').classList.remove('open');
    document.getElementById('activiteModal').classList.remove('open');
    document.body.style.overflow = '';
    _modalIndex = null;
  }

  /* Changer image dans le modal */
  function setThumb(i) {
    if (_modalIndex === null) return;
    const a       = _activites[_modalIndex];
    const gallery = getGallery(a.nom_activite);
    if (!gallery[i]) return;

    _thumbIndex = i;

    const heroEl = document.getElementById('activiteModalHero');
    if (heroEl) {
      heroEl.style.transition = 'opacity .25s';
      heroEl.style.opacity    = '0';
      setTimeout(() => {
        heroEl.style.backgroundImage = `url('${gallery[i]}')`;
        heroEl.style.opacity = '1';
      }, 250);
    }

    document.querySelectorAll('.activite-thumb').forEach((t, idx) => {
      t.classList.toggle('active', idx === i);
    });
  }

  /* ----------------------------------------------------------
     FILTRES — construction dynamique
     ---------------------------------------------------------- */
  function buildFilters() {
    const toolbar = document.getElementById('activitesToolbar');
    if (!toolbar) return;

    // Types uniques présents dans les données
    const types = [...new Set(_activites.map(a => a.type_activite).filter(Boolean))];

    toolbar.innerHTML = `
      <button class="activites-filter active" data-filter="all" onclick="Activites.setFilter('all', this)">
        Toutes
      </button>
      ${types.map(t => `
        <button
          class="activites-filter"
          data-filter="${escHtml(normalizeType(t))}"
          onclick="Activites.setFilter('${escHtml(normalizeType(t))}', this)"
        >
          ${getTypeIcon(t)} ${escHtml(t)}
        </button>
      `).join('')}
      <span class="activites-filter-count" id="activitesCountLabel"></span>
    `;
    updateCountLabel();
  }

  function setFilter(filter, btnEl) {
    document.querySelectorAll('.activites-filter').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    renderActivites(filter);
  }

  function updateCountLabel(count) {
    const el = document.getElementById('activitesCountLabel');
    if (!el) return;
    const n = count !== undefined ? count : _activites.length;
    el.textContent = n + ' activité' + (n > 1 ? 's' : '');
  }

  /* ----------------------------------------------------------
     SHOW / HIDE (même pattern que NosChambres)
     ---------------------------------------------------------- */
  function show() {
    window.MesReservations?.hide();
    window.MonProfil?.hide();

    document.querySelectorAll('.stats-row, .dashboard-grid, .checkin-banner').forEach(el => {
      el._activitesHidden = true;
      el.style.display    = 'none';
    });

    const roomsSection = document.getElementById('roomsSection');
    if (roomsSection) roomsSection.style.display = 'none';

    const section = document.getElementById('activitesSection');
    if (section) {
      section.style.display = 'block';
      section.classList.add('active');
    }

    const greeting = document.querySelector('.topbar-greeting');
    if (greeting) greeting.textContent = 'Activités & Loisirs,';

    // Charger les données si pas encore chargées
    if (_activites.length === 0) {
      loadActivites();
    }
  }

  function hide() {
    document.querySelectorAll('.stats-row, .dashboard-grid, .checkin-banner').forEach(el => {
      if (el._activitesHidden) {
        el.style.display    = '';
        el._activitesHidden = false;
      }
    });

    const section = document.getElementById('activitesSection');
    if (section) {
      section.style.display = 'none';
      section.classList.remove('active');
    }
  }

  /* ----------------------------------------------------------
     INIT
     ---------------------------------------------------------- */
  function init() {
    // Fermer modal sur overlay click
    const overlay = document.getElementById('activiteOverlay');
    if (overlay) overlay.addEventListener('click', closeModal);

    // Fermer avec Echap
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
  }

  /* ----------------------------------------------------------
     EXPOSITION PUBLIQUE
     ---------------------------------------------------------- */
  window.Activites = {
    init,
    show,
    hide,
    setFilter,
    openModal,
    closeModal,
    setThumb,
    loadActivites,
  };

})();