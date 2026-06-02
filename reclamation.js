/* ============================================================
   RECLAMATION.JS — Royal Mansour Iberostar, Mahdia
   v4.0 — Moteur ML urgence refondu
          Affichage du terme déclencheur (urgence_triggered_by)
          Badge "CRITIQUE" pour les cas détectés par liste noire
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     CONFIG — TYPES
     ============================================================ */
  const TYPE_LABELS = {
    chambre:           'Chambre',
    salle_de_bain:     'Salle de bain',
    climatisation:     'Climatisation',
    chauffage:         'Chauffage',
    electricite:       'Électricité',
    wifi:              'Wi-Fi & Internet',
    television:        'Télévision',
    bruit:             'Bruit & Nuisances',
    proprete:          'Propreté',
    literie:           'Literie & Confort',
    restauration:      'Restauration',
    petit_dejeuner:    'Petit-déjeuner',
    room_service:      'Room Service',
    piscine:           'Piscine',
    spa:               'Spa & Hammam',
    parking:           'Parking',
    service_reception: 'Service — Réception',
    service_menage:    'Service — Ménage',
    service_securite:  'Sécurité',
    facturation:       'Facturation',
    remboursement:     'Remboursement',
    autre:             'Autre',
  };

  const TYPE_ICONS = {
    chambre:           '🛏️', salle_de_bain:     '🚿', climatisation:     '❄️',
    chauffage:         '🔥', electricite:       '⚡', wifi:              '📶',
    television:        '📺', bruit:             '🔊', proprete:          '🧹',
    literie:           '🛏️', restauration:      '🍽️', petit_dejeuner:    '☕',
    room_service:      '🛎️', piscine:           '🏊', spa:               '💆',
    parking:           '🚗', service_reception: '👤', service_menage:    '🧺',
    service_securite:  '🔒', facturation:       '🧾', remboursement:     '💰',
    autre:             '📋',
  };

  /* ============================================================
     CONFIG — STATUT
     ============================================================ */
  const STATUT_CONFIG = {
    ouverte:  { cls: 'recl-badge--open',     label: 'Ouverte',  icon: '🔴' },
    en_cours: { cls: 'recl-badge--progress', label: 'En cours', icon: '🟡' },
    resolue:  { cls: 'recl-badge--resolved', label: 'Résolue',  icon: '🟢' },
  };

  /* ============================================================
     CONFIG — URGENCE (v4.0)
     ============================================================ */
  const URGENCE_CONFIG = {
    'Faible':  { cls: 'recl-urgence--low',    icon: '🟢', label: 'Urgence faible'  },
    'Moyenne': { cls: 'recl-urgence--medium', icon: '🟡', label: 'Urgence moyenne' },
    'Élevée':  { cls: 'recl-urgence--high',   icon: '🔴', label: 'Urgence élevée'  },
  };

  /* ============================================================
     ÉTAT INTERNE
     ============================================================ */
  let _resa              = null;
  let _resaSource        = 'none';
  let _detectedType      = 'autre';
  let _detectedConf      = 0;
  let _detectedUrgence   = 'Faible';
  let _triggeredBy       = [];        // v4.0 — termes déclencheurs
  let _typeConfirmed     = false;
  let _debounceTimer     = null;

  /* ============================================================
     OPEN MODAL
     ============================================================ */
  async function openReclamation() {
    _reset();

    const overlay = document.getElementById('reclOverlay');
    const modal   = document.getElementById('reclModal');
    if (overlay) overlay.classList.add('open');
    if (modal)   modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    await _loadReservation();
  }

  /* ============================================================
     CLOSE MODAL
     ============================================================ */
  function closeReclamation() {
    const overlay = document.getElementById('reclOverlay');
    const modal   = document.getElementById('reclModal');
    if (overlay) overlay.classList.remove('open');
    if (modal)   modal.classList.remove('open');
    document.body.style.overflow = '';
    _clearError();
  }

  /* ============================================================
     RESET
     ============================================================ */
  function _reset() {
    _resa            = null;
    _resaSource      = 'none';
    _detectedType    = 'autre';
    _detectedConf    = 0;
    _detectedUrgence = 'Faible';
    _triggeredBy     = [];
    _typeConfirmed   = false;

    const ta = document.getElementById('reclDescription');
    if (ta) ta.value = '';
    _updateCharCount(0);
    _clearDetection();
    _clearUrgence();
    _clearError();
    _toggleSuccessState(false);
    _resetSubmitBtn();

    const sel = document.getElementById('reclTypeSelect');
    if (sel) sel.value = '';

    const typePanel = document.getElementById('reclTypePanel');
    if (typePanel) typePanel.style.display = 'none';

    const urgPanel = document.getElementById('reclUrgencePanel');
    if (urgPanel) urgPanel.style.display = 'none';
  }

  /* ============================================================
     LOAD RESERVATION
     ============================================================ */
  async function _loadReservation() {
    const infoEl = document.getElementById('reclStayInfo');
    if (!infoEl) return;

    infoEl.innerHTML = '<div class="recl-loading">Chargement…</div>';
    _disableSubmit(true);

    try {
      const res  = await fetch('reclamation.php?action=reservation');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      _resa       = data.reservation || null;
      _resaSource = data.source      || 'none';
      _renderStayInfo();

    } catch (e) {
      infoEl.innerHTML =
        '<div class="recl-error-msg">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
        + '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>'
        + '<line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
        + 'Impossible de vérifier votre séjour.</div>';
      _disableSubmit(true);
    }
  }

  /* ---- Render stay card ---- */
  function _renderStayInfo() {
    const infoEl = document.getElementById('reclStayInfo');
    if (!infoEl) return;

    if (!_resa || _resaSource === 'none') {
      infoEl.innerHTML =
        '<div class="recl-empty">'
        + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">'
        + '<path d="M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z"/>'
        + '<path d="M2 12h20"/><path d="M7 12V7"/></svg>'
        + '<span>Vous devez avoir effectué au moins un séjour à l\'hôtel pour soumettre une réclamation.</span>'
        + '</div>';
      _disableSubmit(true);

      const formBody = document.getElementById('reclFormBody');
      if (formBody) formBody.style.display = 'none';
      return;
    }

    const formBody = document.getElementById('reclFormBody');
    if (formBody) formBody.style.display = '';
    _disableSubmit(false);

    const mois = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
    const fmt  = function (ds) {
      if (!ds) return '—';
      const d = new Date(ds);
      return d.getDate() + ' ' + mois[d.getMonth()] + ' ' + d.getFullYear();
    };

    const isActive = _resaSource === 'checked_in';
    const label    = isActive ? 'Séjour en cours' : 'Dernier séjour';
    const dotCls   = isActive ? 'recl-stay-dot--active' : 'recl-stay-dot--done';
    const dotTxt   = isActive ? '●' : '✓';

    infoEl.innerHTML =
      '<div class="recl-stay-card">'
      + '<div class="recl-stay-card-top">'
      +   '<span class="recl-stay-label">' + label + '</span>'
      +   '<span class="recl-stay-dot ' + dotCls + '">' + dotTxt + '</span>'
      + '</div>'
      + '<div class="recl-stay-room">'
      +   _esc(_resa.roomType || 'Chambre')
      +   (_resa.roomNumber ? ' · N° ' + _esc(_resa.roomNumber) : '')
      + '</div>'
      + '<div class="recl-stay-dates">'
      +   '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
      +   '<rect x="3" y="4" width="18" height="18" rx="2"/>'
      +   '<line x1="16" y1="2" x2="16" y2="6"/>'
      +   '<line x1="8" y1="2" x2="8" y2="6"/>'
      +   '<line x1="3" y1="10" x2="21" y2="10"/>'
      +   '</svg>'
      +   fmt(_resa.checkInDate) + ' — ' + fmt(_resa.checkOutDate)
      + '</div>'
      + '</div>';
  }

  /* ============================================================
     DÉTECTION ML (debounced)
     ============================================================ */
  function onDescriptionInput() {
    const ta = document.getElementById('reclDescription');
    if (!ta) return;

    const text = ta.value.trim();
    _updateCharCount(ta.value.length);
    _clearError();

    if (text.length < 10) {
      _clearDetection();
      _clearUrgence();
      return;
    }

    clearTimeout(_debounceTimer);
    _showDetecting();
    _debounceTimer = setTimeout(function () {
      _runDetection(text);
    }, 600);
  }

  /* ============================================================
     _runDetection — v4.0 : récupère aussi urgence_triggered_by
     ============================================================ */
  async function _runDetection(text) {
    try {
      const res = await fetch('reclamation.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'detect', description: text }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      _detectedType    = data.type       || 'autre';
      _detectedConf    = data.confidence || 0;
      _detectedUrgence = data.urgence    || 'Faible';
      _triggeredBy     = Array.isArray(data.urgence_triggered_by)
                           ? data.urgence_triggered_by
                           : [];
      _typeConfirmed   = false;

      _renderDetection(data);
      _renderUrgence(data);

      const sel = document.getElementById('reclTypeSelect');
      if (sel) sel.value = _detectedType;

    } catch (e) {
      _clearDetection();
      _clearUrgence();
    }
  }

  /* ---- Afficher le résultat de détection de type ---- */
  function _renderDetection(data) {
    const panel = document.getElementById('reclTypePanel');
    if (!panel) return;
    panel.style.display = '';

    const icon  = TYPE_ICONS[data.type]  || '📋';
    const label = TYPE_LABELS[data.type] || 'Autre';
    const conf  = Math.round((data.confidence || 0) * 100);
    const barW  = Math.max(8, conf);

    panel.innerHTML =
      '<div class="recl-detection">'
      + '<div class="recl-detection-left">'
      +   '<span class="recl-detection-icon">' + icon + '</span>'
      +   '<div class="recl-detection-info">'
      +     '<span class="recl-detection-label">Type détecté</span>'
      +     '<span class="recl-detection-type">' + label + '</span>'
      +   '</div>'
      + '</div>'
      + '<div class="recl-detection-right">'
      +   '<div class="recl-conf-bar-wrap">'
      +     '<div class="recl-conf-bar-track">'
      +       '<div class="recl-conf-bar-fill" style="width:' + barW + '%"></div>'
      +     '</div>'
      +     '<span class="recl-conf-val">' + conf + '%</span>'
      +   '</div>'
      +   '<span class="recl-detection-sub">Confiance</span>'
      + '</div>'
      + '</div>';
  }

  /* ============================================================
     _renderUrgence — v4.0
     Affiche :
       - badge urgence avec score multi-axe
       - badge CRITIQUE si urgence_triggered_by non vide (liste noire)
       - boost de type si applicable
     ============================================================ */
  function _renderUrgence(data) {
    const panel = document.getElementById('reclUrgencePanel');
    if (!panel) return;
    panel.style.display = '';

    const urgence   = data.urgence || 'Faible';
    const cfg       = URGENCE_CONFIG[urgence] || URGENCE_CONFIG['Faible'];
    const score     = (data.urgence_score      != null) ? Number(data.urgence_score).toFixed(1)      : '—';
    const confPct   = (data.urgence_confidence != null) ? Math.round(data.urgence_confidence * 100) + '%' : '—';

    const g = (data.axis_gravity  || 0).toFixed(1);
    const i = (data.axis_impact   || 0).toFixed(1);
    const t = (data.axis_temporal || 0).toFixed(1);
    const hasAxes = (parseFloat(g) + parseFloat(i) + parseFloat(t)) > 0;

    const axesHtml = hasAxes
      ? '<div class="recl-urgence-axes">'
          + '<span title="Gravité physique / sécurité">⚠️ ' + g + '</span>'
          + '<span title="Impact sur l\'expérience">😟 '    + i + '</span>'
          + '<span title="Durée / récurrence">⏱️ '         + t + '</span>'
        + '</div>'
      : '';

    /* ── v4.0 : badge CRITIQUE (liste noire déclenchée) ── */
    const triggered = Array.isArray(data.urgence_triggered_by)
                        ? data.urgence_triggered_by
                        : [];
    let criticalHtml = '';
    if (triggered.length > 0) {
      const termDisplay = triggered.slice(0, 2).map(function (t) {
        return t.replace(/_/g, ' ');
      }).join(', ');
      criticalHtml =
        '<span class="recl-urgence-critical" '
        + 'title="Terme(s) critique(s) détecté(s) automatiquement : ' + _esc(termDisplay) + '">'
        + '⚡ CRITIQUE — ' + _esc(termDisplay)
        + '</span>';
    }

    /* ── Boost de type ── */
    const boostHtml = data.urgence_boosted_by
      ? '<span class="recl-urgence-boost" '
          + 'title="Urgence remontée automatiquement en raison du type de réclamation">'
          + '↑ boost (' + data.urgence_boosted_by.replace(/_/g, ' ') + ')'
        + '</span>'
      : '';

    panel.innerHTML =
      '<div class="recl-urgence ' + cfg.cls + (triggered.length ? ' recl-urgence--critical-triggered' : '') + '">'
      + '<div class="recl-urgence-left">'
      +   '<span class="recl-urgence-icon">' + cfg.icon + '</span>'
      +   '<div class="recl-urgence-info">'
      +     '<span class="recl-urgence-label">Niveau d\'urgence</span>'
      +     '<span class="recl-urgence-value">' + cfg.label + '</span>'
      +     criticalHtml
      +     boostHtml
      +   '</div>'
      + '</div>'
      + '<div class="recl-urgence-right">'
      +   axesHtml
      +   '<span class="recl-urgence-meta">score ' + score + ' · confiance ' + confPct + '</span>'
      + '</div>'
      + '</div>';
  }

  /* ---- État "en cours d'analyse" ---- */
  function _showDetecting() {
    const typePanel = document.getElementById('reclTypePanel');
    if (typePanel) {
      typePanel.style.display = '';
      typePanel.innerHTML =
        '<div class="recl-detecting">'
        + '<div class="recl-detecting-dots"><span></span><span></span><span></span></div>'
        + '<span>Analyse en cours…</span>'
        + '</div>';
    }

    const urgPanel = document.getElementById('reclUrgencePanel');
    if (urgPanel) urgPanel.style.display = 'none';
  }

  function _clearDetection() {
    const panel = document.getElementById('reclTypePanel');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
    _detectedType  = 'autre';
    _detectedConf  = 0;
    _typeConfirmed = false;
    const sel = document.getElementById('reclTypeSelect');
    if (sel) sel.value = '';
  }

  function _clearUrgence() {
    const panel = document.getElementById('reclUrgencePanel');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
    _detectedUrgence = 'Faible';
    _triggeredBy     = [];
  }

  /* ============================================================
     CHANGEMENT DU TYPE MANUEL (select)
     ============================================================ */
  function onTypeSelectChange() {
    const sel = document.getElementById('reclTypeSelect');
    if (!sel || !sel.value) return;
    _detectedType  = sel.value;
    _typeConfirmed = true;

    const panel = document.getElementById('reclTypePanel');
    if (panel && panel.style.display !== 'none') {
      const icon    = TYPE_ICONS[_detectedType]  || '📋';
      const label   = TYPE_LABELS[_detectedType] || 'Autre';
      const typeEl  = panel.querySelector('.recl-detection-type');
      const iconEl  = panel.querySelector('.recl-detection-icon');
      const detect  = panel.querySelector('.recl-detection');
      if (typeEl) typeEl.textContent = label;
      if (iconEl) iconEl.textContent = icon;
      if (detect) detect.classList.add('recl-detection--manual');
    }
  }

  /* ============================================================
     SUBMIT — v4.0 : envoie urgence + triggered_by au serveur
     ============================================================ */
  async function submitReclamation() {
    _clearError();

    if (!_resa) {
      _showError('Aucune réservation disponible pour soumettre une réclamation.');
      return;
    }

    const ta          = document.getElementById('reclDescription');
    const description = (ta?.value || '').trim();

    if (description.length < 10) {
      _showError('Veuillez décrire votre problème (minimum 10 caractères).');
      ta?.focus();
      return;
    }

    /* Type final : sélection manuelle > ML */
    const sel  = document.getElementById('reclTypeSelect');
    const type = (sel && sel.value) ? sel.value : _detectedType;

    const btn = document.getElementById('reclSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours…'; }

    try {
      const res = await fetch('reclamation.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:         'submit',
          reservation_id: _resa.id,
          description:    description,
          type:           type,
          urgence:        _detectedUrgence,
          avis_id:        null,
        }),
      });
      const data = await res.json();

      if (data.success) {
        _toggleSuccessState(true, type, _detectedUrgence, _triggeredBy);
        if (typeof window.showToast === 'function') {
          showToast('Réclamation soumise avec succès ✓');
        }
        setTimeout(function () { closeReclamation(); }, 3500);
      } else {
        _showError(data.error || 'Une erreur est survenue.');
        _resetSubmitBtn();
      }
    } catch (e) {
      _showError('Erreur réseau. Vérifiez votre connexion.');
      _resetSubmitBtn();
    }
  }

  /* ============================================================
     ÉTAT SUCCÈS — v4.0 : affiche aussi badge CRITIQUE si applicable
     ============================================================ */
  function _toggleSuccessState(show, type, urgence, triggeredBy) {
    const body   = document.getElementById('reclModalBody');
    const footer = document.getElementById('reclModalFooter');

    let success = document.getElementById('reclSuccessState');

    if (show) {
      const icon      = TYPE_ICONS[type]   || '📋';
      const label     = TYPE_LABELS[type]  || 'Autre';
      const urgCfg    = URGENCE_CONFIG[urgence] || URGENCE_CONFIG['Faible'];
      const triggers  = Array.isArray(triggeredBy) ? triggeredBy : [];

      const critHtml = triggers.length > 0
        ? '<div class="recl-success-critical">'
            + '⚡ Intervention prioritaire déclenchée'
          + '</div>'
        : '';

      if (!success) {
        success = document.createElement('div');
        success.id = 'reclSuccessState';
        const modal = document.getElementById('reclModal');
        if (modal) modal.appendChild(success);
      }

      success.className = 'recl-success-state';
      success.innerHTML =
        '<div class="recl-success-icon">✓</div>'
        + '<div class="recl-success-title">Réclamation envoyée</div>'
        + '<div class="recl-success-body">'
        +   '<div class="recl-success-type">' + icon + ' ' + label + '</div>'
        +   '<div class="recl-success-urgence ' + urgCfg.cls + '">'
        +     urgCfg.icon + ' ' + urgCfg.label
        +   '</div>'
        +   critHtml
        +   '<p>Votre réclamation a été enregistrée avec le statut <strong>Ouverte</strong>.</p>'
        +   '<p>Notre équipe prendra contact avec vous dans les plus brefs délais.</p>'
        + '</div>';

      success.style.display = 'flex';
      if (body)   body.style.display   = 'none';
      if (footer) footer.style.display = 'none';

    } else {
      if (success) success.style.display = 'none';
      if (body)    body.style.display    = '';
      if (footer)  footer.style.display  = '';
    }
  }

  /* ============================================================
     LISTE DES RÉCLAMATIONS — v4.0 : badge critique + classe urgent
     ============================================================ */
  async function loadReclamationsList(targetId) {
    const target = document.getElementById(targetId || 'reclListContainer');
    if (!target) return;

    target.innerHTML = '<div class="recl-loading">Chargement…</div>';

    try {
      const res  = await fetch('reclamation.php?action=list');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const list = data.reclamations || [];

      if (list.length === 0) {
        target.innerHTML =
          '<div class="recl-list-empty">'
          + '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">'
          + '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>'
          + '<polyline points="14 2 14 8 20 8"/>'
          + '</svg>'
          + '<p>Aucune réclamation enregistrée</p>'
          + '</div>';
        return;
      }

      target.innerHTML = list.map(r => _renderReclCard(r)).join('');

    } catch (e) {
      target.innerHTML = '<div class="recl-error-msg">Impossible de charger les réclamations.</div>';
    }
  }

  /* ============================================================
     _renderReclCard — v4.0
     ============================================================ */
  function _renderReclCard(r) {
    const statut   = STATUT_CONFIG[r.statut]   || STATUT_CONFIG.ouverte;
    const urgCfg   = URGENCE_CONFIG[r.urgence] || URGENCE_CONFIG['Faible'];
    const icon     = TYPE_ICONS[r.type]        || '📋';
    const label    = TYPE_LABELS[r.type]       || 'Autre';
    const mois     = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
    const d        = new Date(r.created_at);
    const date     = d.getDate() + ' ' + mois[d.getMonth()] + ' ' + d.getFullYear();
    const desc     = _esc(r.description || '');
    const room     = _esc(r.roomType    || '—');
    const isUrgent = r.urgence === 'Élevée';

    return '<div class="recl-card' + (isUrgent ? ' recl-card--urgent' : '') + '">'
      + '<div class="recl-card-header">'
      +   '<div class="recl-card-type">'
      +     '<span class="recl-type-icon">' + icon + '</span>'
      +     '<span class="recl-type-label">' + label + '</span>'
      +   '</div>'
      +   '<div class="recl-card-badges">'
      +     '<span class="recl-urgence-badge ' + urgCfg.cls + '">'
      +       urgCfg.icon + ' ' + (r.urgence || 'Faible')
      +     '</span>'
      +     '<span class="recl-badge ' + statut.cls + '">'
      +       statut.icon + ' ' + statut.label
      +     '</span>'
      +   '</div>'
      + '</div>'
      + '<p class="recl-card-desc">' + desc + '</p>'
      + '<div class="recl-card-footer">'
      +   '<span class="recl-card-room">🛏️ ' + room + '</span>'
      +   '<span class="recl-card-date">📅 ' + date + '</span>'
      + '</div>'
      + '</div>';
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  function _updateCharCount(len) {
    const el = document.getElementById('reclCharCount');
    if (!el) return;
    el.textContent = len + ' / 1000';
    el.classList.toggle('warn', len > 900);
  }

  function _showError(msg) {
    let el = document.getElementById('reclError');
    if (!el) {
      el           = document.createElement('div');
      el.id        = 'reclError';
      el.className = 'recl-inline-error';
      const footer = document.getElementById('reclModalFooter');
      if (footer) footer.before(el);
    }
    el.textContent   = msg;
    el.style.display = 'block';
  }

  function _clearError() {
    const el = document.getElementById('reclError');
    if (el) el.style.display = 'none';
  }

  function _disableSubmit(disabled) {
    const btn = document.getElementById('reclSubmitBtn');
    if (btn) btn.disabled = disabled;
  }

  function _resetSubmitBtn() {
    const btn = document.getElementById('reclSubmitBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Soumettre la réclamation'; }
  }

  function _esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch];
    });
  }

  /* ============================================================
     EXPOSITION GLOBALE
     ============================================================ */
  window.openReclamation      = openReclamation;
  window.closeReclamation     = closeReclamation;
  window.submitReclamation    = submitReclamation;
  window.onDescriptionInput   = onDescriptionInput;
  window.onTypeSelectChange   = onTypeSelectChange;
  window.loadReclamationsList = loadReclamationsList;

})();