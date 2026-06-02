/**
 * bi_widget.js  —  Business Intelligence Widget v3 (Ollama/DeepSeek)
 * Compatible avec dashboard_admin.html / dashboard_admin.js (showView, LOGIN_ID, Chart.js)
 */

(function () {
  "use strict";

  /* ══════════════════════════════════════════════
     CONFIG
  ══════════════════════════════════════════════ */
  const BI_API   = "http://127.0.0.1:5001/chat-admin";
  const BI_PANEL = "bi-dashboard-panel";

  /* ══════════════════════════════════════════════
     PALETTE
  ══════════════════════════════════════════════ */
  const PALETTE = {
    gold:   "#c9a55a", teal:   "#4ecdc4", rose:   "#e07b8a",
    violet: "#9b8fe8", green:  "#6bcb8b", blue:   "#60a5fa",
    orange: "#f4a261", pink:   "#f9a8d4", lime:   "#a3e635",
    cyan:   "#22d3ee", amber:  "#fbbf24", red:    "#f87171",
  };
  const COLOR_LIST = Object.values(PALETTE);

  /* ══════════════════════════════════════════════
     STYLES
  ══════════════════════════════════════════════ */
  function injectStyles() {
    if (document.getElementById("bi-styles")) return;
    const s = document.createElement("style");
    s.id = "bi-styles";
    s.textContent = `
      @keyframes biSlideIn {
        from { opacity:0; transform:translateY(-14px); }
        to   { opacity:1; transform:translateY(0); }
      }
      @keyframes biPulse {
        0%,100% { opacity:1; } 50% { opacity:.4; }
      }
      #${BI_PANEL} { animation: biSlideIn .35s cubic-bezier(.4,0,.2,1); }

      .bi-kpi-mini {
        flex:1; min-width:140px;
        background:var(--bg-card2,#212636);
        border:1px solid var(--border,rgba(255,255,255,.07));
        border-radius:10px; padding:14px 16px;
        display:flex; flex-direction:column; gap:4px;
        transition:transform .2s,box-shadow .2s;
        cursor:default;
      }
      .bi-kpi-mini:hover {
        transform:translateY(-2px);
        box-shadow:0 8px 24px rgba(0,0,0,.3);
      }
      .bi-kpi-mini .val { font-size:1.3rem; font-weight:700; }
      .bi-kpi-mini .lbl {
        font-size:.63rem; color:var(--text-muted,#6b7280);
        text-transform:uppercase; letter-spacing:.5px;
      }
      #bi-analysis-text strong { color:var(--text,#eceef2); }
      #bi-analysis-text { white-space:pre-wrap; }

      #bi-chips button { transition:.15s; }
      #bi-chips button:hover {
        background:rgba(201,165,90,.28) !important;
        border-color:rgba(201,165,90,.5) !important;
      }
      #bi-analysis-wrap::-webkit-scrollbar { width:4px; }
      #bi-analysis-wrap::-webkit-scrollbar-thumb {
        background:rgba(255,255,255,.1); border-radius:2px;
      }
      .bi-loading {
        animation:biPulse 1.2s ease-in-out infinite;
        background:rgba(201,165,90,.1);
        border-radius:4px; height:12px; margin:6px 0;
      }
      #bi-history-list .bi-history-item {
        padding:6px 10px; border-radius:6px; font-size:.72rem;
        cursor:pointer; color:var(--text-muted,#6b7280);
        border:1px solid transparent; transition:.15s;
      }
      #bi-history-list .bi-history-item:hover {
        background:rgba(255,255,255,.05);
        border-color:rgba(255,255,255,.08);
        color:var(--text,#eceef2);
      }
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════
     HISTORIQUE SESSION
  ══════════════════════════════════════════════ */
  const _history = [];

  function addToHistory(message, response) {
    _history.unshift({ message, title: response.title, ts: new Date() });
    if (_history.length > 10) _history.pop();
    renderHistory();
  }

  function renderHistory() {
    const el = document.getElementById("bi-history-list");
    if (!el) return;
    el.innerHTML = _history.map((h, i) => `
      <div class="bi-history-item" data-idx="${i}" title="${h.message}">
        📋 ${(h.title || h.message).substring(0, 42)}
        <span style="float:right;opacity:.4;font-size:.6rem;">
          ${h.ts.getHours()}:${String(h.ts.getMinutes()).padStart(2,"0")}
        </span>
      </div>
    `).join("");
    el.querySelectorAll(".bi-history-item").forEach(item => {
      item.addEventListener("click", () => {
        const inp = document.getElementById("msg");
        if (inp) { inp.value = _history[parseInt(item.dataset.idx)].message; window.send(); }
      });
    });
  }

  /* ══════════════════════════════════════════════
     INJECTION DU PANEL
  ══════════════════════════════════════════════ */
  function ensurePanel() {
    if (document.getElementById(BI_PANEL)) return;
    injectStyles();

    const panel = document.createElement("div");
    panel.id = BI_PANEL;
    panel.style.cssText = `
      display:none;
      background:var(--bg-card,#1c2130);
      border:1px solid var(--border,rgba(255,255,255,.07));
      border-radius:14px; margin-bottom:28px; overflow:hidden;
    `;

    panel.innerHTML = `
      <!-- HEADER -->
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:14px 20px;border-bottom:1px solid var(--border,rgba(255,255,255,.07));
        background:rgba(255,255,255,.02);">
        <div style="display:flex;align-items:center;gap:10px;">
          <span id="bi-panel-icon" style="font-size:1.2rem;">📊</span>
          <div>
            <div id="bi-panel-title"
              style="font-size:.88rem;font-weight:700;color:var(--text,#eceef2);">Analyse BI</div>
            <div id="bi-panel-subtitle"
              style="font-size:.63rem;color:var(--text-muted,#6b7280);margin-top:2px;">
              Généré par DeepSeek · Ollama</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="background:rgba(78,205,196,.1);color:#4ecdc4;
            border:1px solid rgba(78,205,196,.2);border-radius:12px;
            padding:2px 8px;font-size:.6rem;font-weight:600;letter-spacing:.5px;">
            🤖 IA Gratuite</span>
          <button id="bi-btn-history" style="
            background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
            color:var(--text-muted,#6b7280);padding:5px 10px;border-radius:6px;
            font-size:.7rem;cursor:pointer;font-family:inherit;transition:.2s;">
            ⏱ Historique</button>
          <button id="bi-btn-sql" style="
            background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
            color:var(--text-muted,#6b7280);padding:5px 10px;border-radius:6px;
            font-size:.7rem;cursor:pointer;font-family:inherit;transition:.2s;">
            SQL</button>
          <button id="bi-btn-close" style="
            background:rgba(224,123,138,.1);border:1px solid rgba(224,123,138,.2);
            color:#e07b8a;width:28px;height:28px;border-radius:6px;
            font-size:1.1rem;cursor:pointer;display:flex;
            align-items:center;justify-content:center;">×</button>
        </div>
      </div>

      <!-- HISTORIQUE DRAWER -->
      <div id="bi-history-drawer" style="display:none;padding:10px 16px;
        background:rgba(0,0,0,.2);border-bottom:1px solid rgba(255,255,255,.05);">
        <div style="font-size:.63rem;color:var(--text-muted,#6b7280);
          text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;font-weight:600;">
          Requêtes récentes</div>
        <div id="bi-history-list" style="display:flex;flex-direction:column;gap:2px;"></div>
      </div>

      <!-- SQL DRAWER -->
      <div id="bi-sql-bar" style="display:none;padding:10px 20px;
        background:rgba(0,0,0,.3);border-bottom:1px solid rgba(255,255,255,.05);
        font-family:'Courier New',monospace;font-size:.68rem;
        color:#a8d8a8;white-space:pre-wrap;line-height:1.6;
        max-height:150px;overflow-y:auto;"></div>

      <!-- DESCRIPTION -->
      <div id="bi-description-bar" style="display:none;padding:7px 20px;
        background:rgba(201,165,90,.06);border-bottom:1px solid rgba(201,165,90,.12);
        font-size:.72rem;color:#c9a55a;font-style:italic;"></div>

      <!-- KPI CARDS -->
      <div id="bi-kpi-row" style="display:none;flex-wrap:wrap;gap:12px;
        padding:16px 20px;border-bottom:1px solid var(--border,rgba(255,255,255,.07));"></div>

      <!-- GRAPHIQUE + ANALYSE -->
      <div style="display:flex;min-height:320px;">
        <div id="bi-chart-wrap" style="flex:1.5;padding:20px;
          border-right:1px solid var(--border,rgba(255,255,255,.07));
          display:flex;align-items:center;justify-content:center;
          position:relative;min-height:300px;">
          <canvas id="bi-chart-canvas" style="max-height:290px;"></canvas>
          <div id="bi-no-chart" style="display:none;color:var(--text-muted,#6b7280);
            font-size:.82rem;text-align:center;line-height:2;">
            📋 Données en mode KPI Cards</div>
          <div id="bi-empty-state" style="display:none;color:var(--text-muted,#6b7280);
            font-size:.82rem;text-align:center;line-height:2;">
            ⚠️ Aucune donnée disponible</div>
        </div>
        <div id="bi-analysis-wrap" style="flex:1;padding:20px;overflow-y:auto;max-height:360px;">
          <div style="font-size:.63rem;text-transform:uppercase;letter-spacing:1px;
            color:var(--text-muted,#6b7280);margin-bottom:12px;font-weight:600;">
            💡 Analyse IA & Insights</div>
          <div id="bi-analysis-text" style="font-size:.8rem;line-height:1.8;
            color:var(--text-sub,#9ca3af);"></div>
        </div>
      </div>

      <!-- TABLE TOGGLE -->
      <div style="padding:8px 20px;border-top:1px solid rgba(255,255,255,.05);
        display:flex;align-items:center;gap:10px;">
        <button id="bi-btn-table" style="
          background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
          color:var(--text-muted,#6b7280);padding:4px 12px;border-radius:5px;
          font-size:.68rem;cursor:pointer;font-family:inherit;">
          📊 Voir données brutes</button>
        <span id="bi-row-count" style="font-size:.65rem;color:var(--text-muted,#6b7280);"></span>
      </div>

      <!-- TABLE -->
      <div id="bi-table-wrap" style="display:none;max-height:250px;overflow:auto;
        border-top:1px solid rgba(255,255,255,.05);">
        <table id="bi-data-table" style="width:100%;border-collapse:collapse;
          font-size:.7rem;color:var(--text-sub,#9ca3af);"></table>
      </div>
    `;

    /* Events */
    panel.querySelector("#bi-btn-close").addEventListener("click",
      () => { panel.style.display = "none"; });

    panel.querySelector("#bi-btn-sql").addEventListener("click", () => {
      const el = panel.querySelector("#bi-sql-bar");
      el.style.display = el.style.display === "none" ? "block" : "none";
    });

    panel.querySelector("#bi-btn-history").addEventListener("click", () => {
      const el = panel.querySelector("#bi-history-drawer");
      el.style.display = el.style.display === "none" ? "block" : "none";
    });

    panel.querySelector("#bi-btn-table").addEventListener("click", () => {
      const wrap = panel.querySelector("#bi-table-wrap");
      const btn  = panel.querySelector("#bi-btn-table");
      const show = wrap.style.display === "none";
      wrap.style.display = show ? "block" : "none";
      btn.textContent = show ? "🔼 Masquer données" : "📊 Voir données brutes";
    });

    const viewDash = document.getElementById("view-dashboard");
    if (viewDash) viewDash.insertBefore(panel, viewDash.firstChild);
    else document.querySelector(".content")?.prepend(panel);
  }

  /* ══════════════════════════════════════════════
     CHART.JS
  ══════════════════════════════════════════════ */
  let _chartInstance = null;

  function destroyChart() {
    if (_chartInstance) { _chartInstance.destroy(); _chartInstance = null; }
  }

  function renderChart(chartType, chartData, title) {
    destroyChart();
    const canvas     = document.getElementById("bi-chart-canvas");
    const noChart    = document.getElementById("bi-no-chart");
    const emptyState = document.getElementById("bi-empty-state");
    if (!canvas || !window.Chart) return;

    [canvas, noChart, emptyState].forEach(el => el && (el.style.display = "none"));

    if (!chartData?.labels?.length) {
      if (emptyState) emptyState.style.display = "block";
      return;
    }

    canvas.style.display = "block";
    canvas.removeAttribute("width");
    canvas.removeAttribute("height");

    const { labels, values } = chartData;
    const ctx = canvas.getContext("2d");

    const tooltip = {
      backgroundColor:"#1c2028", borderColor:"rgba(255,255,255,.1)",
      borderWidth:1, padding:10, titleColor:"#eceef2", bodyColor:"#8a8f9e",
      cornerRadius:8, displayColors:false,
    };
    const grid = { color:"rgba(255,255,255,.05)", drawBorder:false };

    if (chartType === "line") {
      const grad = ctx.createLinearGradient(0,0,0,260);
      grad.addColorStop(0,"rgba(201,165,90,.4)");
      grad.addColorStop(1,"rgba(201,165,90,0)");
      _chartInstance = new Chart(ctx, {
        type: "line",
        data: { labels, datasets:[{
          label:title, data:values,
          borderColor:PALETTE.gold, borderWidth:2.5,
          pointBackgroundColor:PALETTE.gold, pointRadius:4, pointHoverRadius:7,
          fill:true, backgroundColor:grad, tension:0.4,
        }]},
        options:{
          responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{display:false}, tooltip },
          scales:{ x:{grid, ticks:{color:"#8a8f9e",font:{size:10}}},
                   y:{grid, ticks:{color:"#8a8f9e"}, beginAtZero:true} },
        },
      });
      return;
    }

    if (chartType === "histogram" || chartType === "bar") {
      const isH   = labels.length > 6;
      const bgCol = labels.map((_,i) => COLOR_LIST[i % COLOR_LIST.length]);
      _chartInstance = new Chart(ctx, {
        type:"bar",
        data:{ labels, datasets:[{
          label:title, data:values,
          backgroundColor:bgCol.map(c=>c+"cc"), borderColor:bgCol,
          borderWidth:1.5, borderRadius:6, borderSkipped:false,
        }]},
        options:{
          indexAxis: isH ? "y" : "x",
          responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{display:false}, tooltip },
          scales:{ x:{grid, ticks:{color:"#8a8f9e"}, beginAtZero:true},
                   y:{grid, ticks:{color:"#8a8f9e",font:{size:10}}} },
        },
      });
      return;
    }

    if (chartType === "doughnut" || chartType === "pie") {
      _chartInstance = new Chart(ctx, {
        type:"doughnut",
        data:{ labels, datasets:[{
          data:values,
          backgroundColor:COLOR_LIST.slice(0,labels.length).map(c=>c+"cc"),
          borderColor:"#161920", borderWidth:3, hoverOffset:8,
        }]},
        options:{
          responsive:true, maintainAspectRatio:false, cutout:"66%",
          plugins:{
            legend:{ display:true, position:"bottom",
              labels:{color:"#8a8f9e",font:{size:10},padding:12,usePointStyle:true} },
            tooltip,
          },
        },
      });
      return;
    }
  }

  /* ══════════════════════════════════════════════
     KPI CARDS DYNAMIQUES
  ══════════════════════════════════════════════ */
  function renderKPICards(rows) {
    const kpiRow = document.getElementById("bi-kpi-row");
    if (!kpiRow || !rows?.length) return;

    const row    = rows[0];
    const keys   = Object.keys(row);
    const colors = [PALETTE.gold, PALETTE.teal, PALETTE.rose, PALETTE.violet,
                    PALETTE.green, PALETTE.blue, PALETTE.orange, PALETTE.cyan];

    const iconMap = {
      reservation:"📅", revenu:"💰", client:"👥", chambre:"🏨",
      room:"🏨", occup:"🔑", arrivee:"🚪", checkin:"🚪",
      cancel:"❌", annul:"❌", moy:"📊", avg:"📊",
      total:"💎", taux:"📈", pct:"📈", nombre:"🔢",
    };

    function guessIcon(key) {
      const k = key.toLowerCase();
      for (const [kw, ic] of Object.entries(iconMap))
        if (k.includes(kw)) return ic;
      return "📋";
    }

    function fmtVal(v) {
      if (v === null || v === undefined) return "–";
      const n = parseFloat(v);
      if (isNaN(n)) return String(v);
      if (Number.isInteger(n) || String(v).indexOf(".") === -1)
        return Math.round(n).toLocaleString("fr-FR");
      return n.toLocaleString("fr-FR", {minimumFractionDigits:0, maximumFractionDigits:2});
    }

    function humanLabel(k) {
      return k.replace(/_/g," ").replace(/([a-z])([A-Z])/g,"$1 $2");
    }

    kpiRow.innerHTML = keys.map((k,i) => `
      <div class="bi-kpi-mini">
        <div class="val" style="color:${colors[i%colors.length]}">
          ${guessIcon(k)} ${fmtVal(row[k])}
        </div>
        <div class="lbl">${humanLabel(k)}</div>
      </div>
    `).join("");
    kpiRow.style.display = "flex";
  }

  /* ══════════════════════════════════════════════
     TABLE DONNÉES BRUTES
  ══════════════════════════════════════════════ */
  function renderTable(rows) {
    const table   = document.getElementById("bi-data-table");
    const counter = document.getElementById("bi-row-count");
    if (!table || !rows?.length) return;
    if (counter) counter.textContent = `${rows.length} ligne${rows.length>1?"s":""}`;

    const cols    = Object.keys(rows[0]);
    const maxRows = 100;
    const th = c => `<th style="padding:8px 12px;text-align:left;font-size:.63rem;
      text-transform:uppercase;letter-spacing:.5px;color:#6b7280;
      border-bottom:1px solid rgba(255,255,255,.07);
      position:sticky;top:0;background:#1c2130;">${c}</th>`;
    const td = v => `<td style="padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.04);">
      ${v!==null&&v!==undefined?String(v):"–"}</td>`;
    const tr = (r,i) => `<tr style="background:${i%2?"rgba(255,255,255,.02)":"transparent"}">
      ${cols.map(c=>td(r[c])).join("")}</tr>`;

    table.innerHTML =
      `<thead><tr>${cols.map(th).join("")}</tr></thead>` +
      `<tbody>${rows.slice(0,maxRows).map(tr).join("")}</tbody>` +
      (rows.length>maxRows
        ? `<tfoot><tr><td colspan="${cols.length}" style="padding:8px 12px;
            font-size:.65rem;color:#6b7280;text-align:center;">
            … et ${rows.length-maxRows} autres lignes</td></tr></tfoot>`
        : "");
  }

  /* ══════════════════════════════════════════════
     ANALYSE TEXTUELLE (markdown-lite)
  ══════════════════════════════════════════════ */
  function renderAnalysis(text) {
    const el = document.getElementById("bi-analysis-text");
    if (!el) return;
    if (text === "__loading__") {
      el.innerHTML = `
        <div class="bi-loading" style="width:85%;"></div>
        <div class="bi-loading" style="width:70%;"></div>
        <div class="bi-loading" style="width:90%;"></div>
        <div class="bi-loading" style="width:60%;"></div>`;
      return;
    }
    el.innerHTML = (text || "")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/^[•\-]\s*(.+)$/gm,
        '<span style="display:block;margin-bottom:7px;padding-left:4px;">• $1</span>')
      .replace(/\n\n/g,"<br><br>")
      .replace(/\n/g,"<br>");
  }

  /* ══════════════════════════════════════════════
     ICON DYNAMIQUE
  ══════════════════════════════════════════════ */
  function getIcon(intent) {
    if (!intent) return "📊";
    const i = intent.toLowerCase();
    if (i.includes("age"))        return "📊";
    if (i.includes("revenu") || i.includes("chiffre") || i.includes("revenue")) return "💰";
    if (i.includes("reservation")) return "📅";
    if (i.includes("pays") || i.includes("country"))  return "🌍";
    if (i.includes("occup"))      return "🏨";
    if (i.includes("statut") || i.includes("status")) return "📋";
    if (i.includes("pension"))    return "🍽️";
    if (i.includes("paiement") || i.includes("payment")) return "💳";
    if (i.includes("client") || i.includes("vip"))    return "⭐";
    if (i.includes("kpi") || i.includes("general"))   return "📈";
    if (i.includes("chambre") || i.includes("room"))  return "🛏️";
    return "📊";
  }

  /* ══════════════════════════════════════════════
     AFFICHER LE PANEL
  ══════════════════════════════════════════════ */
  function showPanel(response) {
    ensurePanel();
    const panel = document.getElementById(BI_PANEL);
    if (!panel) return;

    if (typeof window.showView === "function") window.showView("dashboard");

    document.getElementById("bi-panel-icon").textContent    = getIcon(response.intent);
    document.getElementById("bi-panel-title").textContent   = response.title || "Analyse BI";
    document.getElementById("bi-panel-subtitle").textContent =
      `${new Date().toLocaleString("fr-FR")} · ${response.intent || "dynamic"}`;

    const descBar = document.getElementById("bi-description-bar");
    if (descBar) {
      descBar.textContent   = response.description || "";
      descBar.style.display = response.description ? "block" : "none";
    }

    const sqlBar = document.getElementById("bi-sql-bar");
    if (sqlBar) { sqlBar.textContent = response.sql_used || "—"; sqlBar.style.display = "none"; }

    const histDrawer = document.getElementById("bi-history-drawer");
    if (histDrawer) histDrawer.style.display = "none";

    const kpiRow    = document.getElementById("bi-kpi-row");
    const chartWrap = document.getElementById("bi-chart-wrap");
    const noChart   = document.getElementById("bi-no-chart");
    destroyChart();

    if (response.chart_type === "kpi_cards" && response.chart_data?.raw?.length) {
      renderKPICards(response.chart_data.raw);
      if (chartWrap) chartWrap.style.display = "none";
      if (noChart)   noChart.style.display   = "block";
    } else {
      if (kpiRow)    { kpiRow.style.display = "none"; kpiRow.innerHTML = ""; }
      if (chartWrap)   chartWrap.style.display = "flex";
      if (noChart)     noChart.style.display   = "none";
      if (response.chart_type && response.chart_data)
        setTimeout(() => renderChart(response.chart_type, response.chart_data, response.title||""), 50);
    }

    renderAnalysis(response.analysis_text || "Analyse terminée.");

    const tableWrap = document.getElementById("bi-table-wrap");
    const tableBtn  = document.getElementById("bi-btn-table");
    if (tableWrap) tableWrap.style.display = "none";
    if (tableBtn)  tableBtn.textContent    = "📊 Voir données brutes";
    renderTable(response.chart_data?.raw || []);

    addToHistory(response._question || "", response);

    panel.style.display = "block";
    setTimeout(() => panel.scrollIntoView({behavior:"smooth", block:"start"}), 100);
  }

  /* ══════════════════════════════════════════════
     CHATBOX HELPERS
  ══════════════════════════════════════════════ */
  function appendMsg(text, type) {
    const box = document.getElementById("chatBox");
    if (!box) return;
    const div     = document.createElement("div");
    div.className = "message " + type;
    div.innerHTML = text
      .replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")
      .replace(/\n/g,"<br>");
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function showTyping() {
    const box = document.getElementById("chatBox");
    if (!box) return;
    const div     = document.createElement("div");
    div.className = "message typing";
    div.id        = "bi-typing";
    div.innerHTML = `<span style="animation:biPulse 1.2s infinite">🤖</span> Analyse DeepSeek en cours…`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  function removeTyping() { document.getElementById("bi-typing")?.remove(); }

  /* ══════════════════════════════════════════════
     PATCH window.send()
  ══════════════════════════════════════════════ */
  function patchSend() {
    const originalSend = window.send;
    if (typeof originalSend !== "function") {
      setTimeout(patchSend, 300);
      return;
    }

    window.send = async function () {
      const input = document.getElementById("msg");
      if (!input) return;
      const message = input.value.trim();
      if (!message) return;

      // Messages très courts (salutations) → chatbot original
      const words = message.split(/\s+/).length;
      if (words <= 2 && !/(kpi|stat|résumé|bilan|top|rapport|dashboard)/i.test(message)) {
        return originalSend.call(this);
      }

      input.value = "";
      appendMsg(message, "user");
      showTyping();

      try {
        const res = await fetch(BI_API, {
          method:  "POST",
          headers: {"Content-Type":"application/json"},
          body:    JSON.stringify({ message, login_id: window.LOGIN_ID ?? "admin" }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        removeTyping();

        if (data.error) { appendMsg("❌ " + data.error, "bot"); return; }

        if (data.intent === "unknown" || !data.chart_type) {
          appendMsg("🤖 " + data.reply, "bot");
          return;
        }

        data._question = message;
        appendMsg(`🤖 **${data.title || "Analyse"}** générée → voir le dashboard ↑`, "bot");
        showPanel(data);

      } catch (err) {
        removeTyping();
        appendMsg("❌ Erreur BI : " + err.message, "bot");
        console.error("[BI Widget]", err);
      }
    };

    console.log("✅ BI Widget (DeepSeek/Ollama): send() patché");
  }

  /* ══════════════════════════════════════════════
     CHIPS DE SUGGESTION
  ══════════════════════════════════════════════ */
  const CHIPS = [
    "KPI généraux", "Réservations ce mois", "Évolution des revenus",
    "Top 10 clients", "Clients par pays", "Taux d'occupation",
    "Modes de paiement", "Réservations annulées", "Âge moyen des clients",
    "Revenu par type de chambre",
  ];

  function addBIChips() {
    const chatContainer = document.getElementById("chatContainer");
    if (!chatContainer || document.getElementById("bi-chips")) return;

    const wrap = document.createElement("div");
    wrap.id    = "bi-chips";
    wrap.style.cssText = `padding:6px 10px 4px;display:flex;flex-wrap:wrap;gap:5px;
      background:rgba(0,0,0,.15);border-top:1px solid rgba(255,255,255,.05);`;

    CHIPS.forEach(s => {
      const btn = document.createElement("button");
      btn.textContent = s;
      btn.style.cssText = `padding:3px 9px;border-radius:10px;font-size:10.5px;
        cursor:pointer;background:rgba(201,165,90,.14);color:#c9a55a;
        border:1px solid rgba(201,165,90,.22);font-family:inherit;white-space:nowrap;`;
      btn.addEventListener("click", () => {
        const inp = document.getElementById("msg");
        if (inp) { inp.value = s; window.send(); }
      });
      wrap.appendChild(btn);
    });

    const inputArea = chatContainer.querySelector(".input-area");
    if (inputArea) chatContainer.insertBefore(wrap, inputArea);
    else chatContainer.appendChild(wrap);
  }

  /* ══════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════ */
  function init() {
    ensurePanel();
    patchSend();
    const chatIcon = document.querySelector(".chat-icon");
    if (chatIcon) chatIcon.addEventListener("click", () => setTimeout(addBIChips, 250));
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else
    init();

})();
