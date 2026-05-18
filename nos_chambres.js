(function () {
  const HOTEL_ROOMS = [
    {
      name: 'Chambre Double Vue Mer',
      category: 'double',
      bookingRoom: 'double',
      area: '25 m²',
      price: '110 DT / nuit',
      image: 'images/double.png',
      kind: 'Double',
      desc: 'Élégante chambre avec balcon, vue sur la Méditerranée et équipements premium inspirés du Royal El Mansour.',
      features: ['Vue mer', 'Balcon privé', 'Climatisation']
    },
    {
      name: 'Chambre Double Vue Piscine',
      category: 'double',
      bookingRoom: 'double',
      area: '25 m²',
      price: '115 DT / nuit',
      image: 'images/double.png',
      kind: 'Double',
      desc: 'Chambre confortable avec vue sur la piscine, idéale pour un séjour détente à Mahdia.',
      features: ['Vue piscine', 'Wi-Fi gratuit', 'Salle de bains moderne']
    },
    {
      name: 'Chambre Supérieure Vue Mer',
      category: 'double',
      bookingRoom: 'double',
      area: '28 m²',
      price: '130 DT / nuit',
      image: 'images/double.png',
      kind: 'Double',
      desc: 'Plus d’espace et un balcon spacieux pour profiter pleinement du panorama côtier.',
      features: ['28 m²', 'Balcon large', 'Lit king size']
    },
    {
      name: 'Chambre Familiale Vue Mer',
      category: 'family',
      bookingRoom: 'suite',
      area: '45 m²',
      price: '170 DT / nuit',
      image: 'images/suite.png',
      kind: 'Familiale',
      desc: 'Espace pensé pour les familles avec deux zones séparées et vue sur la mer.',
      features: ['Vue mer', 'Espace enfants', 'Deux salles de bains']
    },
    {
      name: 'Chambre Familiale Communicante',
      category: 'family',
      bookingRoom: 'suite',
      area: '50 m²',
      price: '180 DT / nuit',
      image: 'images/suite.png',
      kind: 'Familiale',
      desc: 'Deux chambres communicantes pour un confort optimal en famille ou entre amis.',
      features: ['Chambres communicantes', 'Espaces séparés', 'Balcon']
    },
    {
      name: 'Junior Suite Vue Mer',
      category: 'suite',
      bookingRoom: 'suite',
      area: '42 m²',
      price: '220 DT / nuit',
      image: 'images/suite.png',
      kind: 'Suite',
      desc: 'Suite avec salon, espace détente et vue panoramique sur la côte de Mahdia.',
      features: ['Salon séparé', 'Terrasse', 'Lit king size']
    }
  ];

  function escHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderRooms(filter = 'all') {
    const grid = document.getElementById('roomsGrid');
    if (!grid) return;

    const rooms = filter === 'all'
      ? HOTEL_ROOMS
      : HOTEL_ROOMS.filter(room => room.category === filter);

    grid.innerHTML = rooms.map(room => `
      <article class="room-showcase-card" data-room-category="${escHtml(room.category)}">
        <div class="room-showcase-img" style="background-image:url('${escHtml(room.image)}')"></div>
        <div class="room-showcase-body">
          <div class="room-showcase-top">
            <h3 class="room-showcase-title">${escHtml(room.name)}</h3>
            <div class="room-showcase-meta">
              <span class="room-showcase-area">${escHtml(room.area)}</span>
              ${room.price ? `<span class="room-showcase-price">${escHtml(room.price)}</span>` : ''}
            </div>
          </div>
          <p class="room-showcase-desc">${escHtml(room.desc)}</p>
          <div class="room-showcase-tags">
            ${room.features.map(feature => `<span>${escHtml(feature)}</span>`).join('')}
          </div>
          <div class="room-showcase-actions">
            <span class="room-showcase-kind">${escHtml(room.kind)}</span>
            <button class="btn-gold-sm" onclick="NosChambres.bookRoom('${escHtml(room.bookingRoom)}')">Réserver</button>
          </div>
        </div>
      </article>
    `).join('');
  }

  function initRoomsSection() {
    renderRooms('all');
    document.querySelectorAll('.rooms-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rooms-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderRooms(btn.dataset.roomFilter || 'all');
      });
    });
  }

  function bookRoom(roomType) {
    window.location.href = `reserver.html?room=${encodeURIComponent(roomType)}`;
  }

  function show() {
    window.MesReservations?.hide();
    document.querySelectorAll('.stats-row, .dashboard-grid, .checkin-banner').forEach(el => {
      el._prev = el.style.display;
      el.style.display = 'none';
    });

    const roomsSection = document.getElementById('roomsSection');
    if (roomsSection) {
      roomsSection.style.display = 'block';
      roomsSection.classList.add('active');
    }

    const greeting = document.querySelector('.topbar-greeting');
    if (greeting) greeting.textContent = 'Nos chambres,';
  }

  function hide() {
    document.querySelectorAll('.stats-row, .dashboard-grid, .checkin-banner').forEach(el => {
      el.style.display = el._prev !== undefined ? el._prev : '';
    });

    const roomsSection = document.getElementById('roomsSection');
    if (roomsSection) {
      roomsSection.style.display = 'none';
      roomsSection.classList.remove('active');
    }
  }

  window.NosChambres = {
    init: initRoomsSection,
    show,
    hide,
    bookRoom,
  };
})();
