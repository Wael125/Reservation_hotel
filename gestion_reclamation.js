/* ═══════════════════════════════════════════════════════════════
   gestion_reclamation.js  —  Admin : Gestion des Réclamations
   v1.0
═══════════════════════════════════════════════════════════════ */

(() => {
  /* ── Config ── */
  const API = 'gestion_reclamation.php';

  /* ── State ── */
  let allReclamations = [];
  let filteredRecs    = [];
  let recCharts       = {};           // instances Chart.js
  let deleteTargetId  = null;
  let detailCurrentId = null;

  /* Filtres actifs */
  const activeFilters = {
    search   : '',
    urgence  : '',          // '' = tous
    statut   : 'ouverte',   // défaut : ouverte
    type     : '',
    date_from: '',
    date_to  : '',
  };

  /* ── DOM ── */
  const tbody       = () => document.getElementById('recAdmTbody');
  const badgeCount  = () => document.getElementById('recAdmBadgeCount');
  const toast       = () => document.getElementById('recAdmToast');

  /* ── Init ── */
  document.addEventListener('DOMContentLoaded', () => {
    bindFilters();
    bindQuickPills();
    bindConfirmModal();
    bindDetailModal();
    // Chargement déclenché quand la vue devient active (cf. gestion_transitions.js)
    // On écoute aussi le bouton nav directement
    const navBtn = document.getElementById('nav-reclamations');
    if (navBtn) navBtn.addEventListener('click', initRecView);
  });

  /* ── Appelé par showView('reclamations') depuis dashboard_admin.html ── */
  window.initRecView = function () {
    loadStats();
    loadReclamations();
  };

  /* ════════════════════════════════════════════════
     CHARGEMENT DONNÉES
  ════════════════════════════════════════════════ */
  async function loadReclamations() {
    setLoading(true);
    try {
      const qs = buildQueryString();
      const r  = await fetch(`${API}?action=list&${qs}`);
      const d  = await r.json();
      allReclamations = d.reclamations || [];
      filteredRecs    = [...allReclamations];
      renderTable();
      updateBadge(allReclamations.length);
    } catch (e) {
      console.error('loadReclamations:', e);
      showToast('Erreur chargement réclamations', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      const r = await fetch(`${API}?action=stats`);
      const d = await r.json();
      renderKpis(d.kpis || {});
      renderCharts(d);
    } catch (e) {
      console.error('loadStats:', e);
    }
  }

  /* ════════════════════════════════════════════════
     RENDU TABLE
  ════════════════════════════════════════════════ */
  function renderTable() {
    const tb = tbody();
    if (!tb) return;

    if (filteredRecs.length === 0) {
      tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:36px">
        Aucune réclamation trouvée</td></tr>`;
      return;
    }

    tb.innerHTML = filteredRecs.map(rec => {
      const urgClass  = urgenceClass(rec.urgence);
      const rowClass  = rec.urgence === 'Élevée' ? 'row-elevee' : '';
      const icon      = urgenceIcon(rec.urgence);
      const typeLabel = typeToLabel(rec.type);
      const descShort = escHtml(rec.description || '').substring(0, 100)
                        + (rec.description?.length > 100 ? '…' : '');
      const dateStr   = formatDate(rec.created_at);
      const roomInfo  = rec.roomType
        ? `${escHtml(rec.roomType)} · ${escHtml(rec.roomNumber || '—')}`
        : '—';

      return `
      <tr class="${rowClass}" data-id="${rec.id}">
        <td style="font-size:.72rem;color:var(--text-muted)">#${rec.id}</td>
        <td>
          <div style="font-size:.8rem;font-weight:600;color:var(--text)">${escHtml(rec.client_name || '—')}</div>
          <div style="font-size:.7rem;color:var(--text-muted)">${escHtml(rec.client_email || '')}</div>
        </td>
        <td>
          <span class="badge-urgence ${urgClass}">${icon} ${rec.urgence}</span>
        </td>
        <td><span class="badge-type">${typeLabel}</span></td>
        <td>
          <div class="rec-desc-cell">
            <div class="rec-desc-short" onclick="openRecDetail(${rec.id})" title="${escHtml(rec.description || '')}">${descShort}</div>
          </div>
        </td>
        <td style="font-size:.72rem;color:var(--text-muted)">${roomInfo}<br>${dateStr}</td>
        <td>
          <div class="rec-statut-btns">
            ${statutBtn(rec.id, 'ouverte',  '📬',  rec.statut)}
            ${statutBtn(rec.id, 'en_cours', '⚙️',  rec.statut)}
            ${statutBtn(rec.id, 'resolue',  '✅',  rec.statut)}
          </div>
        </td>
        <td>
          <button class="btn-icon-sm" onclick="openRecDetail(${rec.id})" title="Détail" style="background:rgba(155,143,232,.12);color:var(--violet);border:1px solid rgba(155,143,232,.25);padding:5px 9px;border-radius:7px;cursor:pointer;font-size:.75rem;transition:.2s">
            👁 Voir
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  function statutBtn(id, statut, icon, current) {
    const isActive  = current === statut;
    const activeClass = isActive
      ? `active-${statut === 'en_cours' ? 'encours' : statut}`
      : '';
    const labels = { ouverte: 'Ouvert', en_cours: 'En cours', resolue: 'Résolu' };
    return `<button class="rec-statut-btn ${activeClass}"
      onclick="changeStatut(${id},'${statut}',this)"
      title="${labels[statut]}">${icon} ${labels[statut]}</button>`;
  }

  /* ════════════════════════════════════════════════
     CHANGEMENT STATUT
  ════════════════════════════════════════════════ */
  window.changeStatut = async function (id, statut, btn) {
    try {
      const r = await fetch(API, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ action: 'update_statut', id, statut }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Erreur');

      /* Mise à jour locale + re-render */
      const rec = allReclamations.find(x => x.id == id);
      if (rec) rec.statut = statut;

      /* Mettre à jour le bloc de boutons dans la ligne */
      const row = btn?.closest('tr');
      if (row) {
        const cell = row.querySelector('.rec-statut-btns');
        if (cell) {
          cell.innerHTML = [
            statutBtn(id, 'ouverte',  '📬', statut),
            statutBtn(id, 'en_cours', '⚙️', statut),
            statutBtn(id, 'resolue',  '✅', statut),
          ].join('');
        }
      }

      /* Si modal détail ouverte sur ce record → update */
      if (detailCurrentId == id) syncDetailStatut(statut);

      const labels = { ouverte: 'Ouvert', en_cours: 'En cours', resolue: 'Résolu' };
      showToast(`Statut → ${labels[statut]}`, 'success');
      loadStats(); // refresh KPIs + charts
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  /* ════════════════════════════════════════════════
     KPIs
  ════════════════════════════════════════════════ */
  function renderKpis(kpis) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val ?? '0';
    };
    set('recKpiTotal',   kpis.total   || 0);
    set('recKpiOuverte', kpis.ouverte || 0);
    set('recKpiEncours', kpis.en_cours || 0);
    set('recKpiResolue', kpis.resolue  || 0);
    set('recKpiElevee',  kpis.elevee   || 0);
    set('recKpiMoyenne', kpis.moyenne  || 0);
    set('recKpiFaible',  kpis.faible   || 0);
  }

  /* ════════════════════════════════════════════════
     CHARTS
  ════════════════════════════════════════════════ */
  function renderCharts(data) {
    renderUrgenceChart(data.by_urgence || []);
    renderTypeChart(data.by_type || []);
    renderStatutChart(data.by_statut || []);
    renderMonthChart(data.by_month || []);
  }

  function destroyChart(key) {
    if (recCharts[key]) { recCharts[key].destroy(); delete recCharts[key]; }
  }

  function renderUrgenceChart(rows) {
    destroyChart('urgence');
    const ctx = document.getElementById('recChartUrgence');
    if (!ctx) return;
    const colors = { 'Élevée': '#e07b8a', 'Moyenne': '#f4a261', 'Faible': '#6bcb8b' };
    const labels = rows.map(r => r.urgence);
    const cnts   = rows.map(r => parseInt(r.cnt));
    recCharts.urgence = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: cnts,
          backgroundColor: labels.map(l => (colors[l] || '#9b8fe8') + '44'),
          borderColor    : labels.map(l =>  colors[l] || '#9b8fe8'),
          borderWidth: 2,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#9ca3af', font: { size: 11 }, padding: 14, boxWidth: 10, borderRadius: 4 },
          },
          tooltip: { callbacks: { label: c => ` ${c.raw} réclamation(s)` } },
        },
      },
    });
  }

  function renderStatutChart(rows) {
    destroyChart('statut');
    const ctx = document.getElementById('recChartStatut');
    if (!ctx) return;
    const colors = { ouverte: '#c9a55a', en_cours: '#9b8fe8', resolue: '#4ecdc4' };
    const labels = rows.map(r => r.statut);
    const cnts   = rows.map(r => parseInt(r.cnt));
    recCharts.statut = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: cnts,
          backgroundColor: labels.map(l => (colors[l] || '#6b7280') + '44'),
          borderColor    : labels.map(l =>  colors[l] || '#6b7280'),
          borderWidth: 2,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#9ca3af', font: { size: 11 }, padding: 14, boxWidth: 10, borderRadius: 4 },
          },
          tooltip: { callbacks: { label: c => ` ${c.raw} réclamation(s)` } },
        },
      },
    });
  }

function renderTypeChart(rows) {
  destroyChart('type');
  const ctx = document.getElementById('recChartType');
  if (!ctx) return;

  const palette = [
    '#c9a55a','#4ecdc4','#e07b8a','#9b8fe8','#6bcb8b',
    '#f4a261','#60a5fa','#f472b6','#a78bfa','#34d399',
    '#fb923c','#2dd4bf','#facc15','#e879f9','#38bdf8',
    '#4ade80','#f87171','#818cf8','#fb7185','#a3e635',
    '#67e8f9','#fda4af',
  ];

  // Filtrer les types à 0 si tu veux, ou garder tous
  const filtered = rows.filter(r => parseInt(r.cnt) > 0);

  recCharts.type = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: filtered.map(r => typeToLabel(r.type)),
      datasets: [{
        label: 'Réclamations',
        data : filtered.map(r => parseInt(r.cnt)),
        backgroundColor: filtered.map((_, i) => palette[i % palette.length] + '55'),
        borderColor    : filtered.map((_, i) => palette[i % palette.length]),
        borderWidth: 1.5,
        borderRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: c => ` ${c.raw} réclamation(s)`,
          },
        },
      },
      scales: {
        x: {
          grid : { color: 'rgba(255,255,255,.05)' },
          ticks: { color: '#6b7280', font: { size: 10 } },
        },
        y: {
          grid : { display: false },
          ticks: { color: '#9ca3af', font: { size: 10 } },
        },
      },
    },
  });
}

  function renderMonthChart(rows) {
    destroyChart('month');
    const ctx = document.getElementById('recChartMonth');
    if (!ctx) return;
    recCharts.month = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.mois),
        datasets: [
          {
            label: '🔴 Élevée',
            data : rows.map(r => parseInt(r.elevee  || 0)),
            backgroundColor: 'rgba(224,123,138,.55)',
            borderColor    : '#e07b8a',
            borderWidth: 1.5,
            borderRadius: 4,
            stack: 'urgence',
          },
          {
            label: '🟠 Moyenne',
            data : rows.map(r => parseInt(r.moyenne || 0)),
            backgroundColor: 'rgba(244,162,97,.55)',
            borderColor    : '#f4a261',
            borderWidth: 1.5,
            borderRadius: 0,
            stack: 'urgence',
          },
          {
            label: '🟢 Faible',
            data : rows.map(r => parseInt(r.faible  || 0)),
            backgroundColor: 'rgba(107,203,139,.55)',
            borderColor    : '#6bcb8b',
            borderWidth: 1.5,
            borderRadius: 0,
            stack: 'urgence',
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 10, padding: 12 },
          },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: { stacked: true, grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#6b7280', font: { size: 10 } } },
          y: { stacked: true, grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#6b7280', font: { size: 10 }, precision: 0 } },
        },
      },
    });
  }

  /* ════════════════════════════════════════════════
     MODAL DÉTAIL
  ════════════════════════════════════════════════ */
  window.openRecDetail = function (id) {
    const rec = allReclamations.find(x => x.id == id);
    if (!rec) return;
    detailCurrentId = id;

    const modal = document.getElementById('recDetailModal');
    if (!modal) return;

    /* Remplir contenu */
    const set = (sel, val) => {
      const el = modal.querySelector(sel);
      if (el) el.textContent = val ?? '—';
    };
    const setHtml = (sel, val) => {
      const el = modal.querySelector(sel);
      if (el) el.innerHTML = val ?? '—';
    };

    set('#recDetailId',        `#${rec.id}`);
    set('#recDetailClient',    rec.client_name   || '—');
    set('#recDetailEmail',     rec.client_email  || '—');
    set('#recDetailPhone',     rec.client_phone  || '—');
    set('#recDetailType',      typeToLabel(rec.type));
    set('#recDetailRoomType',  rec.roomType      || '—');
    set('#recDetailRoom',      rec.roomNumber    || '—');
    set('#recDetailCheckin',   formatDate(rec.checkInDate));
    set('#recDetailCheckout',  formatDate(rec.checkOutDate));
    set('#recDetailDate',      formatDate(rec.created_at));
    set('#recDetailDesc',      rec.description   || '—');

    /* Badge urgence */
    const urgEl = modal.querySelector('#recDetailUrgence');
    if (urgEl) urgEl.innerHTML = `<span class="badge-urgence ${urgenceClass(rec.urgence)}">${urgenceIcon(rec.urgence)} ${rec.urgence}</span>`;

    /* Sync boutons statut */
    syncDetailStatut(rec.statut);

    modal.classList.add('open');
  };

  function syncDetailStatut(statut) {
    const modal = document.getElementById('recDetailModal');
    if (!modal) return;
    modal.querySelectorAll('.rec-detail-statut-btn').forEach(btn => {
      const s = btn.dataset.statut;
      btn.className = 'rec-detail-statut-btn';
      if (s === statut) {
        const cls = statut === 'en_cours' ? 'active-encours' : `active-${statut}`;
        btn.classList.add(cls);
      }
    });
  }

  function bindDetailModal() {
    const modal   = document.getElementById('recDetailModal');
    const closeBtn = document.getElementById('recDetailClose');
    if (!modal) return;

    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('open');
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

    /* Boutons statut dans modal */
    modal.querySelectorAll('.rec-detail-statut-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const statut = btn.dataset.statut;
        if (!detailCurrentId) return;
        await changeStatut(detailCurrentId, statut, null);
        // sync buttons in table row
        const rowBtn = document.querySelector(
          `tr[data-id="${detailCurrentId}"] .rec-statut-btn.active-${statut === 'en_cours' ? 'encours' : statut}`
        );
      });
    });
  }

  /* ════════════════════════════════════════════════
     CONFIRM DELETE
  ════════════════════════════════════════════════ */
  window.deleteRec = function (id) {
    deleteTargetId = id;
    const modal = document.getElementById('recConfirmModalAdm');
    if (modal) modal.classList.add('open');
  };

  function bindConfirmModal() {
    const modal     = document.getElementById('recConfirmModalAdm');
    const cancelBtn = document.getElementById('recConfirmCancelAdm');
    const confirmBtn = document.getElementById('recConfirmBtnAdm');
    const closeBtn  = document.getElementById('recConfirmCloseAdm');
    if (!modal) return;

    const close = () => { modal.classList.remove('open'); deleteTargetId = null; };
    if (cancelBtn) cancelBtn.onclick  = close;
    if (closeBtn)  closeBtn.onclick   = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    if (confirmBtn) confirmBtn.onclick = async () => {
      if (!deleteTargetId) return;
      try {
        const r = await fetch(API, {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ action: 'delete', id: deleteTargetId }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error || 'Erreur');
        allReclamations = allReclamations.filter(x => x.id != deleteTargetId);
        filteredRecs    = filteredRecs.filter(x => x.id != deleteTargetId);
        renderTable();
        updateBadge(allReclamations.length);
        showToast('Réclamation supprimée', 'success');
        loadStats();
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        close();
      }
    };
  }

  /* ════════════════════════════════════════════════
     FILTRES & PILLS
  ════════════════════════════════════════════════ */
  function bindFilters() {
    const listen = (id, key, reloadFn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input',  () => { activeFilters[key] = el.value.trim(); reloadFn(); });
      el.addEventListener('change', () => { activeFilters[key] = el.value.trim(); reloadFn(); });
    };
    listen('recAdmFilterSearch',   'search',    debounce(loadReclamations, 300));
    listen('recAdmFilterType',     'type',      loadReclamations);
    listen('recAdmFilterDateFrom', 'date_from', loadReclamations);
    listen('recAdmFilterDateTo',   'date_to',   loadReclamations);

    const resetBtn = document.getElementById('recAdmBtnReset');
    if (resetBtn) resetBtn.addEventListener('click', resetFilters);
  }

  function bindQuickPills() {
    document.querySelectorAll('.rec-qf-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const filterType = pill.dataset.filterType; // 'urgence' or 'statut'
        const value      = pill.dataset.value;

        // Toggle
        const currentVal = activeFilters[filterType];
        activeFilters[filterType] = currentVal === value ? '' : value;

        // Sync classes
        document.querySelectorAll(`.rec-qf-pill[data-filter-type="${filterType}"]`).forEach(p => {
          p.classList.toggle('active-pill', p.dataset.value === activeFilters[filterType]);
        });

        loadReclamations();
      });
    });

    /* Activer la pill "ouverte" + pill urgences par défaut désactivées */
    const pill = document.querySelector('.rec-qf-pill[data-filter-type="statut"][data-value="ouverte"]');
    if (pill) pill.classList.add('active-pill');
  }

  function resetFilters() {
    Object.assign(activeFilters, { search: '', urgence: '', statut: '', type: '', date_from: '', date_to: '' });
    ['recAdmFilterSearch','recAdmFilterType','recAdmFilterDateFrom','recAdmFilterDateTo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.querySelectorAll('.rec-qf-pill').forEach(p => p.classList.remove('active-pill'));
    loadReclamations();
  }

  function buildQueryString() {
    const p = new URLSearchParams();
    if (activeFilters.search)    p.set('search',    activeFilters.search);
    if (activeFilters.urgence)   p.set('urgence',   activeFilters.urgence);
    if (activeFilters.statut)    p.set('statut',    activeFilters.statut);
    if (activeFilters.type)      p.set('type',      activeFilters.type);
    if (activeFilters.date_from) p.set('date_from', activeFilters.date_from);
    if (activeFilters.date_to)   p.set('date_to',   activeFilters.date_to);
    return p.toString();
  }

  /* ════════════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════════════ */
  function setLoading(on) {
    const el = document.getElementById('recAdmLoadingMsg');
    if (el) el.style.display = on ? 'block' : 'none';
  }

  function updateBadge(n) {
    const el = badgeCount();
    if (el) el.textContent = n;
  }

  function showToast(msg, type = 'success') {
    const el = toast();
    if (!el) return;
    el.textContent = msg;
    el.className   = `rec-adm-toast ${type} show`;
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  function urgenceClass(u) {
    if (!u) return 'faible';
    const map = { 'Élevée': 'elevee', 'Moyenne': 'moyenne', 'Faible': 'faible' };
    return map[u] || 'faible';
  }

  function urgenceIcon(u) {
    return { 'Élevée': '🔴', 'Moyenne': '🟠', 'Faible': '🟢' }[u] || '⚪';
  }

  const TYPE_LABELS = {
    chambre:'Chambre', salle_de_bain:'Salle de bain', climatisation:'Climatisation',
    chauffage:'Chauffage', electricite:'Électricité', wifi:'WiFi',
    television:'Télévision', bruit:'Bruit', proprete:'Propreté', literie:'Literie',
    restauration:'Restauration', petit_dejeuner:'Petit-déj.', room_service:'Room Service',
    piscine:'Piscine', spa:'Spa', parking:'Parking', service_reception:'Réception',
    service_menage:'Ménage', service_securite:'Sécurité',
    facturation:'Facturation', remboursement:'Remboursement', autre:'Autre',
  };
  function typeToLabel(t) { return TYPE_LABELS[t] || t || 'Autre'; }

  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' });
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

})();