/* ============================================================
   MON PROFIL — mon_profil.js  (version corrigée)
   - Fix fidélité : lit window.RESERVATIONS en priorité
   - Ajout : photo de profil (upload, preview, suppression)
   ============================================================ */

const MonProfil = (() => {

  let _clientData  = null;
  let _activeTab   = 'infos';
  let _dirty       = false;

  const $  = (id)  => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  /* ─────────────────────────────────────────
     PHOTO DE PROFIL — localStorage
  ───────────────────────────────────────── */
  const PHOTO_KEY = 'rm_profile_photo';

  function _getPhoto() {
    try { return localStorage.getItem(PHOTO_KEY) || null; } catch(_) { return null; }
  }
  function _setPhoto(dataUrl) {
    try { localStorage.setItem(PHOTO_KEY, dataUrl); } catch(_) {}
  }
  function _deletePhoto() {
    try { localStorage.removeItem(PHOTO_KEY); } catch(_) {}
  }

  /* Met à jour TOUS les avatars de la page */
  function _applyPhoto(dataUrl) {
    document.querySelectorAll('.profil-avatar, .sidebar-avatar, .mobile-avatar').forEach(el => {
      if (dataUrl) {
        el.style.backgroundImage  = `url(${dataUrl})`;
        el.style.backgroundSize   = 'cover';
        el.style.backgroundPosition = 'center';
        el.style.color            = 'transparent';
      } else {
        el.style.backgroundImage  = '';
        el.style.backgroundSize   = '';
        el.style.backgroundPosition = '';
        el.style.color            = '';
      }
    });
    /* bouton supprimer dans le modal */
    const btn = $('profilDeletePhotoBtn');
    if (btn) btn.style.display = dataUrl ? 'inline-flex' : 'none';
  }

  /* ─────────────────────────────────────────
     INIT
  ───────────────────────────────────────── */
  function init() {
    _injectSection();
    _bindEditModal();
    /* Appliquer la photo sauvegardée dès l'init */
    const saved = _getPhoto();
    if (saved) _applyPhoto(saved);
  }

  /* ─────────────────────────────────────────
     SHOW / HIDE
  ───────────────────────────────────────── */
  function show() {
    document.querySelectorAll(
      '.stats-row, .dashboard-grid, .rooms-section, .reservations-section, .checkin-banner'
    ).forEach(el => el.style.display = 'none');

    const section = $('profilSection');
    if (section) { section.style.display = 'flex'; section.classList.add('active'); }

    if (!_clientData) { _loadProfile(); } else { _renderAll(); }
  }

  function hide() {
    const section = $('profilSection');
    if (section) { section.style.display = 'none'; section.classList.remove('active'); }
  }

  /* ─────────────────────────────────────────
     CALCUL FIDÉLITÉ — MÊME LOGIQUE QUE dashboard.js
  ───────────────────────────────────────── */
  function _computeLoyalty(resaList) {
    const STATUTS_REALISES  = ['checked_in','checked_out','completé','complete','complété','complétée'];
    const STATUTS_CONFIRMES = ['confirmée','confirmee'];

    let totalNights = 0, totalSpent = 0, nbStays = 0;

    (resaList || []).forEach(r => {
      const s = String(r.status || r.Status || '').trim().toLowerCase();
      const payment = String(r.paymentDetails || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (['cancelled','annulé','annule','en attente'].includes(s)) return;

      const price = parseFloat(r.totalPrice) || 0;
      const amount = payment.includes('paye le') || payment.includes('paid') ? price
                   : STATUTS_REALISES.includes(s)  ? price
                   : STATUTS_CONFIRMES.includes(s) ? price * 0.30
                   : 0;
      if (amount === 0) return;

      totalSpent  += amount;
      totalNights += Math.round((new Date(r.checkOutDate) - new Date(r.checkInDate)) / 864e5);
      nbStays++;
    });

    const pts = Math.round(totalNights * 5 + (totalSpent / 50) + nbStays * 10);

    const paliers = [
      { label:'Bronze',   min:0,   max:49,      next:'Silver',   nextMin:50  },
      { label:'Silver',   min:50,  max:99,       next:'Gold',     nextMin:100 },
      { label:'Gold',     min:100, max:199,      next:'Platinum', nextMin:200 },
      { label:'Platinum', min:200, max:399,      next:'Diamond',  nextMin:400 },
      { label:'Diamond',  min:400, max:Infinity, next:null,       nextMin:null},
    ];
    const palier = paliers.find(p => pts >= p.min && pts <= p.max) || paliers[0];
    return { pts, palier };
  }

  /* ─────────────────────────────────────────
     STATS ACTIVITÉ — SOURCE UNIQUE DE VÉRITÉ
     Priorité : window.RESERVATIONS (dashboard)
                > sessionStorage
                > API fallback
  ───────────────────────────────────────── */
  function _buildActivityStats() {
    /* 1. Source principale : données injectées par PHP dans window */
    if (window.RESERVATIONS && Array.isArray(window.RESERVATIONS)) {
      const resa = window.RESERVATIONS;
      const { pts, palier } = _computeLoyalty(resa);

      /* Calcul total dépensé (même règle que dashboard.js) */
      const STATUTS_REALISES  = ['checked_in','checked_out','completé','complete','complété','complétée'];
      const STATUTS_CONFIRMES = ['confirmée','confirmee'];
      const totalSpent = resa.reduce((sum, r) => {
        const s = String(r.status || r.Status || '').trim().toLowerCase();
        const payment = String(r.paymentDetails || '')
          .trim()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        const price = parseFloat(r.totalPrice) || 0;
        if (payment.includes('paye le') || payment.includes('paid')) return sum + price;
        if (STATUTS_REALISES.includes(s))  return sum + price;
        if (STATUTS_CONFIRMES.includes(s)) return sum + price * 0.30;
        return sum;
      }, 0);

      return {
        totalResa:     resa.length,
        totalSpent:    new Intl.NumberFormat('fr-FR').format(Math.round(totalSpent)) + ' TND',
        loyaltyPts:    pts,
        loyaltyStatus: palier.label,
        _source:       'window'
      };
    }

    /* 2. Fallback : sessionStorage écrit par dashboard.js */
    try {
      const raw = sessionStorage.getItem('rm_activity_stats');
      if (raw) {
        const s = JSON.parse(raw);
        /* Recalculer fidélité depuis les pts si nécessaire */
        if (s.loyaltyPts && !s.loyaltyStatus) {
          const pts = parseInt(s.loyaltyPts);
          const paliers = [
            {label:'Bronze',min:0,max:49},{label:'Silver',min:50,max:99},
            {label:'Gold',min:100,max:199},{label:'Platinum',min:200,max:399},
            {label:'Diamond',min:400,max:Infinity}
          ];
          s.loyaltyStatus = (paliers.find(p => pts >= p.min && pts <= p.max) || paliers[0]).label;
        }
        return { ...s, _source: 'session' };
      }
    } catch(_) {}

    return null; /* déclenchera le fetch API */
  }

  /* ─────────────────────────────────────────
     CHARGEMENT PROFIL VIA API
  ───────────────────────────────────────── */
  function _loadProfile() {
    _showSkeleton(true);
    fetch('mon_profil.php', { method:'GET', credentials:'include', headers:{'Accept':'application/json'} })
      .then(r => r.json())
      .then(res => {
        _showSkeleton(false);
        if (res.success && res.data) {
          _clientData = res.data;
          _storeSession(res.data);
          _renderAll();
        } else {
          const fb = _getSessionData();
          if (fb) { _clientData = fb; _renderAll(); }
          else _showError(res.error || 'Impossible de charger votre profil.');
        }
      })
      .catch(() => {
        _showSkeleton(false);
        const fb = _getSessionData();
        if (fb) { _clientData = fb; _renderAll(); }
        else _showError('Erreur de connexion au serveur.');
      });
  }

  /* ─────────────────────────────────────────
     SESSION STORAGE
  ───────────────────────────────────────── */
  function _storeSession(data) {
    try { sessionStorage.setItem('rm_client_profil', JSON.stringify(data)); } catch(_) {}
  }
  function _getSessionData() {
    try { const r = sessionStorage.getItem('rm_client_profil'); return r ? JSON.parse(r) : null; } catch(_) { return null; }
  }
  function _updateSession(patch) {
    try {
      const stored = _getSessionData() || {};
      sessionStorage.setItem('rm_client_profil', JSON.stringify({ ...stored, ...patch }));
    } catch(_) {}
  }

  /* ─────────────────────────────────────────
     RENDU COMPLET
  ───────────────────────────────────────── */
  function _renderAll() {
    const d = _clientData;
    if (!d) return;

    const initials = ((d.prenom||'?')[0] + (d.nom||'?')[0]).toUpperCase();

    _setText('profilAvatar',       initials);
    _setText('profilAvatarBadge',  _formatRole(d.role));
    _setHtml('profilHeroName',     `${d.prenom || '—'} <em>${d.nom || ''}</em>`);
    _setText('profilHeroUsername', d.username  || '—');
    _setText('profilHeroEmail',    d.email     || '—');
    _setText('profilHeroTel',      d.telephone || '—');
    _setText('profilHeroPays',     d.pays      || '—');

    const heroEl = $('profilHeroCard');
    if (heroEl) heroEl.style.display = 'flex';

    _setText('infoPrenom',    d.prenom         || _empty('Non renseigné'));
    _setText('infoNom',       d.nom            || _empty('Non renseigné'));
    _setText('infoGenre',     _renderGenre(d.genre));
    _setText('infoNaissance', d.date_naissance ? _formatDate(d.date_naissance) : _empty('Non renseignée'));
    _setText('infoPays',      d.pays           || _empty('Non renseigné'));
    _setText('infoEmail',     d.email          || _empty('Non renseigné'));
    _setText('infoTel',       d.telephone      || _empty('Non renseigné'));
    _setText('infoUsername',  d.username       || '—');
    _setText('infoRole',      _formatRole(d.role));
    _setText('secUsername',   d.username       || '—');
    _setText('secEmail',      d.email          || '—');

    _renderActivityTiles();

    const grid = $('profilMainGrid');
    if (grid) grid.style.display = 'grid';

    _syncTopbarName(d);

    /* Ré-appliquer la photo */
    const saved = _getPhoto();
    if (saved) _applyPhoto(saved);
  }

  /* ─────────────────────────────────────────
     TILES ACTIVITÉ
  ───────────────────────────────────────── */
  function _renderActivityTiles() {
    const grid = $('profilActivityGrid');
    if (!grid) return;

    const stats = _buildActivityStats();
    if (stats) {
      _renderTilesHTML(grid, stats);
    } else {
      /* Fetch API en dernier recours */
      fetch('mes_reservations.php', { method:'GET', credentials:'include', headers:{'Accept':'application/json'} })
        .then(r => r.json())
        .then(res => {
          if (res.success && res.reservations) {
            const { pts, palier } = _computeLoyalty(res.reservations);
            const totalSpent = res.reservations.reduce((s, r) => {
              const st = String(r.status||'').trim().toLowerCase();
              const payment = String(r.paymentDetails || '')
                .trim()
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
              const p  = parseFloat(r.totalPrice)||0;
              if (payment.includes('paye le') || payment.includes('paid')) return s+p;
              if (['checked_in','checked_out','completé','complete','complété','complétée'].includes(st)) return s+p;
              if (['confirmée','confirmee'].includes(st)) return s+p*0.30;
              return s;
            }, 0);
            _renderTilesHTML(grid, {
              totalResa:     res.reservations.length,
              totalSpent:    new Intl.NumberFormat('fr-FR').format(Math.round(totalSpent)) + ' TND',
              loyaltyPts:    pts,
              loyaltyStatus: palier.label
            });
          } else { _renderTilesHTML(grid, null); }
        })
        .catch(() => _renderTilesHTML(grid, null));
    }
  }

  function _renderTilesHTML(grid, stats) {
    const tiles = [
      {
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
        val:   stats?.totalResa     ?? '—',
        label: 'Réservations totales'
      },
      {
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
        val:   stats?.totalSpent    ?? '—',
        label: 'Total dépensé'
      },
      {
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
        val:   stats?.loyaltyPts != null ? stats.loyaltyPts + ' pts' : '—',
        label: 'Points fidélité'
      },
      {
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
        val:   stats?.loyaltyStatus ?? '—',
        label: 'Statut fidélité'
      }
    ];
    grid.innerHTML = tiles.map(t => `
      <div class="profil-activity-tile">
        <div class="profil-activity-tile-icon">${t.icon}</div>
        <span class="profil-activity-val">${t.val}</span>
        <span class="profil-activity-label">${t.label}</span>
      </div>`).join('');
  }

  /* ─────────────────────────────────────────
     SYNC TOPBAR / SIDEBAR
  ───────────────────────────────────────── */
  function _syncTopbarName(d) {
    const topbarName = document.querySelector('.topbar-name');
    if (topbarName && d.prenom) topbarName.innerHTML = `${d.prenom} <em>${d.nom || ''}</em>`;
    const sidebarName = document.querySelector('.sidebar-user-name');
    if (sidebarName && d.prenom) sidebarName.textContent = `${d.prenom} ${d.nom || ''}`.trim();
    const sidebarAvatar = document.querySelector('.sidebar-avatar');
    if (sidebarAvatar && d.prenom) sidebarAvatar.textContent = d.prenom[0].toUpperCase();
    const mobileAvatar = document.querySelector('.mobile-avatar');
    if (mobileAvatar && d.prenom) mobileAvatar.textContent = d.prenom[0].toUpperCase();
  }

  /* ─────────────────────────────────────────
     HELPERS RENDU
  ───────────────────────────────────────── */
  function _setText(id, val) {
    const el = $(id);
    if (!el) return;
    if (val && String(val).startsWith('<')) { el.innerHTML = val; } else { el.textContent = val; }
  }
  function _setHtml(id, val) { const el=$(id); if(el) el.innerHTML = val; }
  function _empty(txt) { return `<span class="empty">${txt}</span>`; }

  function _formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return isNaN(d) ? dateStr : d.toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' });
  }
  function _formatRole(role) {
    const map = {client:'Client',admin:'Administrateur',receptionist:'Réceptionniste',manager:'Manager',gold:'Client Gold',platinum:'Client Platine'};
    return map[(role||'').toLowerCase()] || (role || 'Client');
  }
  function _renderGenre(genre) {
    if (!genre) return _empty('Non précisé');
    const icons = {Homme:'♂',Femme:'♀',Autre:'⚧','Non précisé':'—'};
    return `<span class="genre-pill">${icons[genre]||''} ${genre}</span>`;
  }
  function _showSkeleton(show) {
    const skel = $('profilSkeleton'), hero = $('profilHeroCard'), grid = $('profilMainGrid');
    if (skel) skel.style.display = show ? 'flex' : 'none';
    if (!show) return;
    if (hero) hero.style.display = 'none';
    if (grid) grid.style.display = 'none';
  }
  function _showError(msg) {
    const section = $('profilSection'); if (!section) return;
    const existing = section.querySelector('.profil-error-notice'); if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'profil-notice profil-error-notice';
    div.style.cssText = 'border-left-color:#ef4444;background:rgba(239,68,68,.06);color:#f87171;';
    div.textContent = '⚠ ' + msg;
    section.insertBefore(div, section.children[1]);
  }

  /* ─────────────────────────────────────────
     MODAL — OUVERTURE / FERMETURE
  ───────────────────────────────────────── */
  function openEditModal(tab) {
    _resetModal(); _fillModal();
    if (tab) switchTab(tab);
    $('profilEditOverlay').classList.add('open');
    $('profilEditModal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeEditModal() {
    $('profilEditOverlay').classList.remove('open');
    $('profilEditModal').classList.remove('open');
    document.body.style.overflow = '';
    _dirty = false;
  }
  function switchTab(tab) {
    _activeTab = tab;
    $$('.profil-modal-tab').forEach(b => b.classList.remove('active'));
    $$('.profil-tab-panel').forEach(p => p.classList.remove('active'));
    const key = tab.charAt(0).toUpperCase() + tab.slice(1);
    const btn = $(`tabBtn${key}`), panel = $(`tab${key}`);
    if (btn)   btn.classList.add('active');
    if (panel) panel.classList.add('active');

    const saveBtn = $('profilSaveBtn');
    if (saveBtn) {
      saveBtn.style.display = 'inline-flex';
      saveBtn.textContent = tab === 'photo' ? 'Enregistrer la photo' : 'Enregistrer les modifications';
      saveBtn.disabled = false;
    }
  }

  /* ─────────────────────────────────────────
     REMPLISSAGE DU FORMULAIRE
  ───────────────────────────────────────── */
  function _fillModal() {
    const d = _clientData; if (!d) return;
    _setVal('editPrenom',    d.prenom         || '');
    _setVal('editNom',       d.nom            || '');
    _setVal('editGenre',     d.genre          || '');
    _setVal('editNaissance', d.date_naissance || '');
    _setVal('editPays',      d.pays           || '');
    _setVal('editEmail',     d.email          || '');
    _setVal('editTelephone', d.telephone      || '');
    _setVal('editUsername',  d.username       || '');
    _setVal('editCurrentPwd','');
    _setVal('editNewPwd',    '');
    _setVal('editConfirmPwd','');
    const wrap = $('pwdStrengthWrap'); if (wrap) wrap.style.display = 'none';
    /* Photo preview dans le modal */
    const preview = $('profilPhotoPreview');
    const saved   = _getPhoto();
    const initialsEl = $('profilPhotoInitials');
    const initials = ((d.prenom || '')[0] || '') + ((d.nom || '')[0] || '');
    if (preview) preview.src = saved || '';
    if (preview) preview.style.display = saved ? 'block' : 'none';
    if (initialsEl) {
      initialsEl.textContent = saved ? '' : initials.toUpperCase();
      initialsEl.style.display = saved ? 'none' : '';
    }
    const deleteBtn = $('profilDeletePhotoBtn');
    if (deleteBtn) deleteBtn.style.display = saved ? 'inline-flex' : 'none';
  }
  function _setVal(id, val) { const el=$(id); if(el) el.value=val; }
  function _resetModal() {
    $('profilSaveSuccess')?.classList.remove('visible');
    const errList = $('profilErrorsList');
    if (errList) { errList.classList.remove('visible'); errList.innerHTML = ''; }
    $$('.profil-input').forEach(i => i.classList.remove('error'));
    switchTab('infos');
  }

  /* ─────────────────────────────────────────
     PASSWORD HELPERS
  ───────────────────────────────────────── */
  function _togglePwd(inputId, iconId) {
    const inp = $(inputId); if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    const ico = $(iconId); if (ico) ico.style.opacity = inp.type === 'text' ? '1' : '.5';
  }
  function _onNewPwdInput() {
    _markDirty();
    const val = $('editNewPwd')?.value || '';
    const wrap = $('pwdStrengthWrap'); if (!wrap) return;
    if (!val) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    const s = _pwdStrength(val);
    const classes = ['filled-weak','filled-medium','filled-strong'];
    const labels  = ['Faible','Moyen','Fort'];
    ['pwdBar1','pwdBar2','pwdBar3'].forEach((b,i) => {
      const el = $(b); if (!el) return;
      el.className = 'profil-pwd-bar';
      if (i < s) el.classList.add(classes[s-1]);
    });
    const lbl = $('pwdStrengthLabel'); if (lbl) lbl.textContent = labels[s-1] || '';
  }
  function _pwdStrength(pwd) {
    let s=0;
    if (pwd.length >= 8) s++;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) s++;
    if (/[0-9]/.test(pwd) || /[^a-zA-Z0-9]/.test(pwd)) s++;
    return Math.min(s, 3);
  }
  function _markDirty() { _dirty = true; }

  /* ─────────────────────────────────────────
     PHOTO — UPLOAD HANDLER
  ───────────────────────────────────────── */
  function _bindPhotoUpload() {
    const input = $('profilPhotoInput');
    if (!input) return;
    if (input.dataset.photoBound === '1') return;
    input.dataset.photoBound = '1';
    input.addEventListener('change', function() {
      const file = this.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        alert('La photo ne doit pas dépasser 5 Mo.');
        return;
      }
      if (!file.type.startsWith('image/')) {
        alert('Veuillez sélectionner une image.');
        return;
      }
      const reader = new FileReader();
      reader.onload = function(e) {
        const dataUrl = e.target.result;
        /* Redimensionner à 256×256 pour économiser localStorage */
        const img = new Image();
        img.onload = function() {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 256;
          const ctx = canvas.getContext('2d');
          /* crop carré centré */
          const side = Math.min(img.width, img.height);
          const sx = (img.width  - side) / 2;
          const sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, 256, 256);
          const final = canvas.toDataURL('image/jpeg', 0.85);
          _setPhoto(final);
          _applyPhoto(final);
          /* Preview dans le modal */
          const preview = $('profilPhotoPreview');
          if (preview) { preview.src = final; preview.style.display = 'block'; }
          const initialsEl = $('profilPhotoInitials');
          if (initialsEl) { initialsEl.textContent = ''; initialsEl.style.display = 'none'; }
          const deleteBtn = $('profilDeletePhotoBtn');
          if (deleteBtn) deleteBtn.style.display = 'inline-flex';
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ─────────────────────────────────────────
     PHOTO — SUPPRESSION
  ───────────────────────────────────────── */
  function deletePhoto() {
    if (!confirm('Supprimer votre photo de profil ?')) return;
    _deletePhoto();
    _applyPhoto(null);
    const preview = $('profilPhotoPreview');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    const initialsEl = $('profilPhotoInitials');
    if (initialsEl) {
      const d = _clientData || {};
      const initials = (((d.prenom || '')[0] || '') + ((d.nom || '')[0] || '')).toUpperCase();
      initialsEl.textContent = initials;
      initialsEl.style.display = '';
    }
    const deleteBtn = $('profilDeletePhotoBtn');
    if (deleteBtn) deleteBtn.style.display = 'none';
  }

  /* ─────────────────────────────────────────
     SAUVEGARDE
  ───────────────────────────────────────── */
  function saveProfile() {
    _hideErrors();
    if (_activeTab === 'photo') {
      const btn = $('profilSaveBtn');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Photo enregistrée';
      }
      const success = $('profilSaveSuccess');
      if (success) {
        success.classList.add('visible');
        setTimeout(() => success.classList.remove('visible'), 2500);
      }
      setTimeout(() => {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Enregistrer la photo';
        }
      }, 900);
      return;
    }

    const btn = $('profilSaveBtn');
    btn.disabled = true; btn.textContent = 'Enregistrement…';

    const payload = {};
    if (_activeTab === 'infos') {
      payload.prenom         = $('editPrenom')?.value.trim()     || '';
      payload.nom            = $('editNom')?.value.trim()        || '';
      payload.genre          = $('editGenre')?.value             || '';
      payload.date_naissance = $('editNaissance')?.value         || '';
      payload.pays           = $('editPays')?.value.trim()       || '';
      payload.email          = $('editEmail')?.value.trim()      || '';
      payload.telephone      = $('editTelephone')?.value.trim()  || '';
    } else {
      const uname   = $('editUsername')?.value.trim()    || '';
      const newPwd  = $('editNewPwd')?.value             || '';
      const confPwd = $('editConfirmPwd')?.value         || '';
      const curPwd  = $('editCurrentPwd')?.value         || '';
      if (uname && uname !== (_clientData?.username || '')) payload.username = uname;
      if (newPwd) {
        if (newPwd !== confPwd) { _showErrors(['Les mots de passe ne correspondent pas.']); _resetBtn(btn); return; }
        if (newPwd.length < 8)  { _showErrors(['Le mot de passe doit contenir au moins 8 caractères.']); _resetBtn(btn); return; }
        payload.password = newPwd; payload.current_password = curPwd;
      }
      if (!Object.keys(payload).length) { _showErrors(['Aucune modification détectée.']); _resetBtn(btn); return; }
    }

    fetch('mon_profil.php', { method:'PUT', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
      .then(r => r.json())
      .then(res => {
        _resetBtn(btn);
        if (res.success) {
          _clientData = { ..._clientData, ...payload };
          delete _clientData.password; delete _clientData.current_password;
          _updateSession(_clientData);
          _renderAll();
          $('profilSaveSuccess').classList.add('visible');
          setTimeout(() => $('profilSaveSuccess').classList.remove('visible'), 3500);
        } else {
          _showErrors(res.errors || [res.error || 'Une erreur est survenue.']);
        }
      })
      .catch(() => { _resetBtn(btn); _showErrors(['Erreur de connexion. Veuillez réessayer.']); });
  }

  function _resetBtn(btn) { btn.disabled = false; btn.textContent = 'Enregistrer les modifications'; }
  function _showErrors(errs) {
    const list = $('profilErrorsList');
    if (!list) return;
    list.innerHTML = errs.map(e => `<li>${e}</li>`).join('');
    list.classList.add('visible');
    list.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }
  function _hideErrors() {
    const list = $('profilErrorsList');
    if (list) { list.classList.remove('visible'); list.innerHTML = ''; }
  }

  /* ─────────────────────────────────────────
     BIND ESC + PHOTO INPUT
  ───────────────────────────────────────── */
  function _bindEditModal() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && $('profilEditModal')?.classList.contains('open')) closeEditModal();
    });
    /* Bind photo input une fois le DOM ready */
    document.addEventListener('DOMContentLoaded', _bindPhotoUpload);
    /* Si DOM déjà chargé */
    if (document.readyState !== 'loading') _bindPhotoUpload();
  }

  /* ─────────────────────────────────────────
     INJECTION HTML
  ───────────────────────────────────────── */
  function _injectSection() {
    if ($('profilSection')) return;

    const html = `
    <section class="profil-section" id="profilSection" style="display:none;">

      <div class="profil-header">
        <div class="profil-title-block">
          <span class="profil-eyebrow">Compte client</span>
          <h2 class="profil-title">Mon <em>Profil</em></h2>
        </div>
        <button class="profil-hero-edit-btn" onclick="MonProfil.openEditModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Modifier mon profil
        </button>
      </div>

      <div class="profil-skeleton" id="profilSkeleton">
        <div class="profil-skeleton-avatar skel"></div>
        <div class="profil-skeleton-lines">
          <div class="skel" style="height:20px;width:200px;"></div>
          <div class="skel" style="height:12px;width:140px;"></div>
          <div class="skel" style="height:12px;width:260px;"></div>
        </div>
      </div>

      <div class="profil-hero-card" id="profilHeroCard" style="display:none;">
        <div class="profil-avatar-wrap">
          <div class="profil-avatar" id="profilAvatar">—</div>
          <!-- Bouton overlay photo sur l'avatar -->
          <button type="button" class="profil-avatar-photo-btn" onclick="MonProfil.openEditModal('photo')" title="Changer la photo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
        </div>
        <div class="profil-hero-info">
          <div class="profil-hero-name" id="profilHeroName">— <em>—</em></div>
          <div class="profil-hero-username"><span>Username</span><span id="profilHeroUsername">—</span></div>
          <div class="profil-hero-meta">
            <div class="profil-hero-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              <span id="profilHeroEmail">—</span>
            </div>
            <div class="profil-hero-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 010 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
              <span id="profilHeroTel">—</span>
            </div>
            <div class="profil-hero-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
              <span id="profilHeroPays">—</span>
            </div>
          </div>
        </div>
        <button class="profil-hero-edit-btn" onclick="MonProfil.openEditModal()" style="align-self:flex-start;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Modifier
        </button>
      </div>

      <div class="profil-main-grid" id="profilMainGrid" style="display:none;">

        <div class="profil-info-card">
          <div class="profil-card-header">
            <span class="profil-card-eyebrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Informations personnelles
            </span>
            <button class="profil-card-edit-link" onclick="MonProfil.openEditModal('infos')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Modifier
            </button>
          </div>
          <div class="profil-info-rows" id="profilInfoRows">
            <div class="profil-info-row"><span class="profil-info-label">Prénom</span><span class="profil-info-value" id="infoPrenom">—</span></div>
            <div class="profil-info-row"><span class="profil-info-label">Nom</span><span class="profil-info-value" id="infoNom">—</span></div>
            <div class="profil-info-row"><span class="profil-info-label">Genre</span><span class="profil-info-value" id="infoGenre">—</span></div>
            <div class="profil-info-row"><span class="profil-info-label">Date de naissance</span><span class="profil-info-value" id="infoNaissance">—</span></div>
            <div class="profil-info-row"><span class="profil-info-label">Pays</span><span class="profil-info-value" id="infoPays">—</span></div>
          </div>
        </div>

        <div class="profil-info-card">
          <div class="profil-card-header">
            <span class="profil-card-eyebrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              Coordonnées & Compte
            </span>
            <button class="profil-card-edit-link" onclick="MonProfil.openEditModal('infos')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Modifier
            </button>
          </div>
          <div class="profil-info-rows">
            <div class="profil-info-row"><span class="profil-info-label">E-mail</span><span class="profil-info-value" id="infoEmail">—</span></div>
            <div class="profil-info-row"><span class="profil-info-label">Téléphone</span><span class="profil-info-value" id="infoTel">—</span></div>
            <div class="profil-info-row"><span class="profil-info-label">Identifiant</span><span class="profil-info-value" id="infoUsername">—</span></div>
            <div class="profil-info-row"><span class="profil-info-label">Rôle</span><span class="profil-info-value" id="infoRole">—</span></div>
            <div class="profil-info-row"><span class="profil-info-label">Mot de passe</span><span class="profil-info-value"><span style="color:var(--muted);font-size:16px;letter-spacing:3px;">••••••••</span></span></div>
          </div>
        </div>

        <div class="profil-security-card">
          <div class="profil-card-header">
            <span class="profil-card-eyebrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Sécurité
            </span>
          </div>
          <div class="profil-security-item">
            <div class="profil-security-item-left">
              <div class="profil-security-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></div>
              <div><div class="profil-security-label">Mot de passe</div><div class="profil-security-sub">Modifiez votre mot de passe de connexion</div></div>
            </div>
            <button class="profil-security-action" onclick="MonProfil.openEditModal('securite')">Modifier</button>
          </div>
          <div class="profil-security-item">
            <div class="profil-security-item-left">
              <div class="profil-security-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
              <div><div class="profil-security-label">Identifiant</div><div class="profil-security-sub" id="secUsername">—</div></div>
            </div>
            <button class="profil-security-action" onclick="MonProfil.openEditModal('securite')">Modifier</button>
          </div>
          <div class="profil-security-item">
            <div class="profil-security-item-left">
              <div class="profil-security-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div>
              <div><div class="profil-security-label">Adresse e-mail</div><div class="profil-security-sub" id="secEmail">—</div></div>
            </div>
            <button class="profil-security-action" onclick="MonProfil.openEditModal('infos')">Modifier</button>
          </div>
        </div>

        <div class="profil-activity-card">
          <div class="profil-card-header">
            <span class="profil-card-eyebrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Activité & Statistiques
            </span>
          </div>
          <div class="profil-activity-grid" id="profilActivityGrid"></div>
        </div>

      </div>
    </section>

    <!-- ========== MODAL MODIFICATION PROFIL ========== -->
    <div class="profil-edit-overlay" id="profilEditOverlay" onclick="MonProfil.closeEditModal()"></div>
    <div class="profil-edit-modal" id="profilEditModal">

      <div class="profil-modal-header">
        <div>
          <span class="profil-eyebrow" style="font-size:8.5px;">Modifier</span>
          <h2 class="profil-modal-title">Mon <em style="font-style:italic;color:var(--gold-light);">Profil</em></h2>
        </div>
        <button class="profil-modal-close" onclick="MonProfil.closeEditModal()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="profil-modal-tabs">
        <button class="profil-modal-tab active" id="tabBtnInfos"    onclick="MonProfil.switchTab('infos')">Informations</button>
        <button class="profil-modal-tab"         id="tabBtnPhoto"   onclick="MonProfil.switchTab('photo')">Photo</button>
        <button class="profil-modal-tab"         id="tabBtnSecurite" onclick="MonProfil.switchTab('securite')">Sécurité</button>
      </div>

      <div class="profil-save-success" id="profilSaveSuccess">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        Profil mis à jour avec succès.
      </div>
      <ul class="profil-errors-list" id="profilErrorsList"></ul>

      <!-- ── TAB INFOS ── -->
      <div class="profil-tab-panel active" id="tabInfos">
        <div class="profil-form-grid">
          <div class="profil-form-section-title">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Identité
          </div>
          <div class="profil-field"><label class="profil-field-label" for="editPrenom">Prénom</label><input class="profil-input" type="text" id="editPrenom" placeholder="Votre prénom" oninput="MonProfil._markDirty()"></div>
          <div class="profil-field"><label class="profil-field-label" for="editNom">Nom</label><input class="profil-input" type="text" id="editNom" placeholder="Votre nom de famille" oninput="MonProfil._markDirty()"></div>
          <div class="profil-field"><label class="profil-field-label" for="editGenre">Genre</label><select class="profil-select" id="editGenre" onchange="MonProfil._markDirty()"><option value="">— Non précisé —</option><option value="Homme">Homme</option><option value="Femme">Femme</option><option value="Autre">Autre</option><option value="Non précisé">Préfère ne pas préciser</option></select></div>
          <div class="profil-field"><label class="profil-field-label" for="editNaissance">Date de naissance</label><input class="profil-input" type="date" id="editNaissance" oninput="MonProfil._markDirty()"></div>
          <div class="profil-field full-width"><label class="profil-field-label" for="editPays">Pays</label><input class="profil-input" type="text" id="editPays" placeholder="Ex : France, Tunisie…" oninput="MonProfil._markDirty()"></div>
          <div class="profil-form-section-title">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Coordonnées
          </div>
          <div class="profil-field full-width"><label class="profil-field-label" for="editEmail">Adresse e-mail</label><input class="profil-input" type="email" id="editEmail" placeholder="votre@email.com" oninput="MonProfil._markDirty()"><span class="profil-field-hint">Utilisée pour les confirmations de réservation</span></div>
          <div class="profil-field full-width"><label class="profil-field-label" for="editTelephone">Téléphone</label><input class="profil-input" type="tel" id="editTelephone" placeholder="+33 6 00 00 00 00" oninput="MonProfil._markDirty()"></div>
        </div>
      </div>

      <!-- ── TAB PHOTO ── -->
      <div class="profil-tab-panel" id="tabPhoto">
        <div class="profil-photo-upload-area">

          <!-- Preview actuelle -->
          <div class="profil-photo-preview-wrap">
            <div class="profil-photo-circle" id="profilPhotoCurrent">
              <img id="profilPhotoPreview" src="" alt="Photo de profil" style="display:none;width:100%;height:100%;object-fit:cover;border-radius:50%;">
              <span id="profilPhotoInitials" style="font-family:var(--serif);font-size:36px;font-weight:300;color:var(--gold);"></span>
            </div>
            <div class="profil-photo-preview-label">Photo actuelle</div>
          </div>

          <!-- Zone de drop / clic -->
          <label class="profil-photo-drop-zone" for="profilPhotoInput" id="profilPhotoDropZone">
            <input type="file" id="profilPhotoInput" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
            <span class="profil-photo-drop-title">Choisir une photo</span>
            <span class="profil-photo-drop-sub">JPEG, PNG, WebP · max 5 Mo</span>
          </label>

          <!-- Actions -->
          <div class="profil-photo-actions">
            <button type="button" class="btn-gold-sm" onclick="document.getElementById('profilPhotoInput').click()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Uploader une photo
            </button>
            <button type="button" class="btn-danger-sm profil-photo-delete-btn" id="profilDeletePhotoBtn" onclick="MonProfil.deletePhoto()" style="display:none;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              Supprimer la photo
            </button>
          </div>

          <p class="profil-photo-note">La photo est stockée localement sur cet appareil. Elle s'affiche sur votre avatar dans la sidebar et sur cette page.</p>
        </div>
      </div>

      <!-- ── TAB SÉCURITÉ ── -->
      <div class="profil-tab-panel" id="tabSecurite">
        <div class="profil-form-grid">
          <div class="profil-form-section-title">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Identifiant de connexion
          </div>
          <div class="profil-field full-width"><label class="profil-field-label" for="editUsername">Nom d'utilisateur</label><input class="profil-input" type="text" id="editUsername" placeholder="nom.utilisateur" oninput="MonProfil._markDirty()"><span class="profil-field-hint">Entre 3 et 50 caractères</span></div>
          <div class="profil-form-section-title">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            Changer le mot de passe
          </div>
          <div class="profil-notice full-width">Laissez les champs vides si vous ne souhaitez pas modifier votre mot de passe.</div>
          <div class="profil-field full-width">
            <label class="profil-field-label" for="editCurrentPwd">Mot de passe actuel</label>
            <div style="position:relative;">
              <input class="profil-input" type="password" id="editCurrentPwd" placeholder="••••••••" oninput="MonProfil._markDirty()" style="padding-right:42px;">
              <button type="button" onclick="MonProfil._togglePwd('editCurrentPwd','eyeCurrent')" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;padding:0;display:flex;align-items:center;">
                <svg id="eyeCurrent" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>
          <div class="profil-field">
            <label class="profil-field-label" for="editNewPwd">Nouveau mot de passe</label>
            <div style="position:relative;">
              <input class="profil-input" type="password" id="editNewPwd" placeholder="Min. 8 caractères" oninput="MonProfil._onNewPwdInput()" style="padding-right:42px;">
              <button type="button" onclick="MonProfil._togglePwd('editNewPwd','eyeNew')" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;padding:0;display:flex;align-items:center;">
                <svg id="eyeNew" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
            <div class="profil-pwd-strength" id="pwdStrengthWrap" style="display:none;">
              <div class="profil-pwd-bars"><div class="profil-pwd-bar" id="pwdBar1"></div><div class="profil-pwd-bar" id="pwdBar2"></div><div class="profil-pwd-bar" id="pwdBar3"></div></div>
              <span class="profil-pwd-label" id="pwdStrengthLabel">—</span>
            </div>
          </div>
          <div class="profil-field">
            <label class="profil-field-label" for="editConfirmPwd">Confirmer</label>
            <div style="position:relative;">
              <input class="profil-input" type="password" id="editConfirmPwd" placeholder="Répétez le mot de passe" oninput="MonProfil._markDirty()" style="padding-right:42px;">
              <button type="button" onclick="MonProfil._togglePwd('editConfirmPwd','eyeConfirm')" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;padding:0;display:flex;align-items:center;">
                <svg id="eyeConfirm" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="profil-modal-footer">
        <button class="btn-outline-sm" onclick="MonProfil.closeEditModal()">Annuler</button>
        <button class="btn-gold-sm" id="profilSaveBtn" onclick="MonProfil.saveProfile()">Enregistrer les modifications</button>
      </div>
    </div>
    `;

    const main = document.querySelector('main.main-content');
    if (main) main.insertAdjacentHTML('beforeend', html);

    /* Bind photo input après injection */
    setTimeout(_bindPhotoUpload, 0);
  }

  /* ─────────────────────────────────────────
     API PUBLIQUE
  ───────────────────────────────────────── */
  return {
    init, show, hide,
    openEditModal, closeEditModal, switchTab,
    saveProfile, deletePhoto,
    _markDirty, _togglePwd, _onNewPwdInput,
    getClientData: () => _clientData,
  };

})();

document.addEventListener('DOMContentLoaded', () => { MonProfil.init(); });
