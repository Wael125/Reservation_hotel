/* ═══════════════════════════════════════════════════════════════
   prediction.js — Gestion vue Prédictions ML  v2
   CORRECTIONS :
   - Avertissement visuel si données insuffisantes
   - MAPE 0.0% masqué / remplacé par message explicite
   - Sanity check visuel sur les valeurs prédites
   - renderModelBadge : évite les doublons de DOM
   - Tendance cohérente avec le graphique
   ═══════════════════════════════════════════════════════════════ */

"use strict";

let predictionChart  = null;
let predRevenueChart = null;

/* ═══════════════════════════════════════════════════════════════
   LOAD PREDICTION — Point d'entrée principal
   ═══════════════════════════════════════════════════════════════ */

async function loadPrediction() {
  const period  = document.getElementById("predPeriod")?.value  || "monthly";
  const horizon = document.getElementById("predHorizon")?.value || 6;

  const btn = document.querySelector(".pred-btn-refresh");
  if (btn) {
    btn.classList.add("loading");
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Calcul en cours…`;
  }

  const insightEl = document.getElementById("predInsight");
  if (insightEl) insightEl.innerHTML = _predSkeletonHTML();

  try {
    const res  = await fetch(`prediction.php?period=${period}&horizon=${horizon}`);
    const data = await res.json();

    if (data.error) {
      _showPredError(data.error);
      return;
    }

    // Avertissement qualité données
    _renderDataQualityBanner(data);

    renderPredictionChart(data);
    renderPredInsight(data);
    renderPredKPIs(data);
    renderPredPeaks(data);
    renderModelBadge(data);
    renderPredMetrics(data);

  } catch (err) {
    console.error("[Prediction]", err);
    _showPredError("Erreur réseau : " + err.message);
  } finally {
    if (btn) {
      btn.classList.remove("loading");
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Lancer prédiction`;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   BANNER : avertissement qualité des données
   ═══════════════════════════════════════════════════════════════ */

function _renderDataQualityBanner(data) {
  const trained = data.prediction?.trained_on || 0;
  let banner    = document.getElementById("predDataQualityBanner");

  // Créer le banner s'il n'existe pas
  if (!banner) {
    banner    = document.createElement("div");
    banner.id = "predDataQualityBanner";
    banner.style.cssText = `
      display:none; align-items:center; gap:10px;
      padding:10px 16px; border-radius:10px; margin-bottom:4px;
      font-size:.8rem; font-weight:600;
    `;
    // Insérer avant le graphique
    const chartCard = document.querySelector(".pred-chart-card");
    if (chartCard) chartCard.parentNode.insertBefore(banner, chartCard);
  }

  if (trained < 15) {
    banner.style.display      = "flex";
    banner.style.background   = "rgba(245,158,11,.12)";
    banner.style.border       = "1px solid rgba(245,158,11,.3)";
    banner.style.color        = "#f59e0b";
    banner.innerHTML = `
      ⚠️ Données limitées (${trained} points) — Les prédictions sont approximatives.
      Idéalement, collectez 24+ mois pour une meilleure précision.
    `;
  } else {
    banner.style.display = "none";
  }
}

/* ═══════════════════════════════════════════════════════════════
   CHART — Superposition historique + prédiction + intervalles
   ═══════════════════════════════════════════════════════════════ */

function renderPredictionChart(data) {
  const canvas = document.getElementById("predChart");
  if (!canvas || typeof Chart === "undefined") return;

  if (predictionChart) { predictionChart.destroy(); predictionChart = null; }

  const pred = data.prediction;
  const hist = data.historical;

  const histLabels = hist.labels  || [];
  const histVals   = hist.values  || [];
  const predLabels = pred.labels  || [];
  const predVals   = pred.values  || [];

  // Combiner les labels pour l'axe X
  const allLabels = [...histLabels, ...predLabels];
  const histLen   = histLabels.length;
  const predLen   = predLabels.length;

  // Historique : padding null à droite
  const histData = [...histVals, ...Array(predLen).fill(null)];

  // Prédiction : 1 point de jonction + padding null à gauche
  const lastHistVal = histVals.length ? histVals[histVals.length - 1] : null;
  const predData = [
    ...Array(Math.max(0, histLen - 1)).fill(null),
    lastHistVal,
    ...predVals,
  ];

  // Intervalles de confiance
  const upperData = [
    ...Array(Math.max(0, histLen - 1)).fill(null),
    lastHistVal,
    ...(pred.upper || []),
  ];
  const lowerData = [
    ...Array(Math.max(0, histLen - 1)).fill(null),
    lastHistVal,
    ...(pred.lower || []),
  ];

  const ctx      = canvas.getContext("2d");
  const grad     = ctx.createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0, "rgba(108,99,255,.35)");
  grad.addColorStop(1, "rgba(108,99,255,0)");

  const gradHist = ctx.createLinearGradient(0, 0, 0, 300);
  gradHist.addColorStop(0, "rgba(52,211,153,.2)");
  gradHist.addColorStop(1, "rgba(52,211,153,0)");

  // Calculer le max Y pour une échelle cohérente
  const allNonNull = [...histVals, ...predVals].filter(v => v !== null);
  const yMax       = allNonNull.length ? Math.ceil(Math.max(...allNonNull) * 1.2) : 10;

  predictionChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: allLabels,
      datasets: [
        // Zone de confiance upper
        {
          label: "Intervalle confiance",
          data: upperData,
          borderColor: "transparent",
          backgroundColor: "rgba(108,99,255,.10)",
          fill: "+1",
          tension: 0.4,
          pointRadius: 0,
          order: 3,
        },
        // Zone de confiance lower (masquée dans la légende)
        {
          label: "_lower",
          data: lowerData,
          borderColor: "transparent",
          backgroundColor: "transparent",
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          order: 4,
        },
        // Historique
        {
          label: "Historique",
          data: histData,
          borderColor: "#34d399",
          backgroundColor: gradHist,
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: "#34d399",
          order: 2,
        },
        // Prédiction
        {
          label: "Prédiction",
          data: predData,
          borderColor: "#6c63ff",
          backgroundColor: grad,
          fill: true,
          tension: 0.4,
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: "#6c63ff",
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: "#9ca3af",
            font: { size: 11 },
            usePointStyle: true,
            padding: 16,
            filter: item => !item.text.startsWith("_"),
          },
        },
        tooltip: {
          backgroundColor: "#1c2028",
          borderColor: "rgba(255,255,255,.1)",
          borderWidth: 1,
          padding: 12,
          titleColor: "#eceef2",
          bodyColor: "#8a8f9e",
          cornerRadius: 8,
          callbacks: {
            label: ctx => {
              if (ctx.dataset.label === "Intervalle confiance" || ctx.dataset.label === "_lower")
                return null;
              const val = ctx.raw !== null ? Math.round(ctx.raw) : null;
              return val !== null ? ` ${ctx.dataset.label} : ${val} rés.` : null;
            },
          },
        },
        // Ligne verticale séparant historique et prédiction
        annotation: undefined,
      },
      scales: {
        x: {
          grid:  { color: "rgba(255,255,255,.05)", drawBorder: false },
          ticks: { color: "#8a8f9e", font: { size: 10 }, maxTicksLimit: 12 },
        },
        y: {
          grid:        { color: "rgba(255,255,255,.05)", drawBorder: false },
          ticks:       { color: "#8a8f9e", beginAtZero: true },
          beginAtZero: true,
          max:         yMax,   // FIX : échelle cohérente avec les données réelles
          suggestedMin: 0,
        },
      },
    },
  });
}

/* ═══════════════════════════════════════════════════════════════
   MÉTRIQUES — MAE / RMSE / MAPE / Points
   ═══════════════════════════════════════════════════════════════ */

function renderPredMetrics(data) {
  const metrics  = data.prediction?.metrics  || {};
  const trained  = data.prediction?.trained_on;

  // MAE
  const maeEl = document.getElementById("metricMAE");
  if (maeEl) {
    if (metrics.mae !== null && metrics.mae !== undefined) {
      maeEl.textContent = metrics.mae.toFixed(1);
      maeEl.className   = "pred-metric-val " + _mapeClass(metrics.mae, 2, 5);
    } else {
      maeEl.textContent = "N/A";
      maeEl.className   = "pred-metric-val na";
    }
  }

  // RMSE
  const rmseEl = document.getElementById("metricRMSE");
  if (rmseEl) {
    if (metrics.rmse !== null && metrics.rmse !== undefined) {
      rmseEl.textContent = metrics.rmse.toFixed(1);
      rmseEl.className   = "pred-metric-val " + _mapeClass(metrics.rmse, 3, 7);
    } else {
      rmseEl.textContent = "N/A";
      rmseEl.className   = "pred-metric-val na";
    }
  }

  // MAPE — masquer 0.0 non fiable
  const mapeEl = document.getElementById("metricMAPE");
  if (mapeEl) {
    if (metrics.mape !== null && metrics.mape !== undefined && metrics.mape > 0) {
      mapeEl.textContent = metrics.mape.toFixed(1) + "%";
      mapeEl.className   = "pred-metric-val " + _mapeClass(metrics.mape, 10, 25);
    } else {
      mapeEl.textContent = "N/A";
      mapeEl.className   = "pred-metric-val na";
      if (mapeEl.parentElement) {
        mapeEl.parentElement.title = "Métrique non fiable avec peu de données";
      }
    }
  }

  // Points d'entraînement
  const ptsEl = document.getElementById("metricPoints");
  if (ptsEl && trained !== undefined) {
    ptsEl.textContent = trained;
    ptsEl.className   = "pred-metric-val " + (trained >= 24 ? "good" : trained >= 12 ? "medium" : "bad");
  }
}

/** Retourne "good" / "medium" / "bad" selon les seuils */
function _mapeClass(val, good, medium) {
  if (val <= good)  return "good";
  if (val <= medium) return "medium";
  return "bad";
}

/* ═══════════════════════════════════════════════════════════════
   KPI
   ═══════════════════════════════════════════════════════════════ */

function renderPredKPIs(data) {
  const pred = data.prediction?.values || [];
  if (!pred.length) return;

  const total = pred.reduce((a, b) => a + b, 0);
  const avg   = total / pred.length;
  const max   = Math.max(...pred);

  _setPredEl("kpiTotal", Math.round(total).toLocaleString("fr-FR"));
  _setPredEl("kpiAvg",   Math.round(avg).toLocaleString("fr-FR"));
  _setPredEl("kpiMax",   Math.round(max).toLocaleString("fr-FR"));
}

/* ═══════════════════════════════════════════════════════════════
   INSIGHT
   ═══════════════════════════════════════════════════════════════ */

function renderPredInsight(data) {
  const el = document.getElementById("predInsight");
  if (!el) return;

  const text = data.insight || "Analyse non disponible.";

  el.innerHTML = text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/^[•\-]\s*(.+)$/gm,
      '<span style="display:block;margin-bottom:5px;padding-left:4px;">• $1</span>')
    .replace(/→\s*(.+)/g,
      '<span style="display:block;padding-left:16px;color:#c9a55a;margin-bottom:3px;">→ $1</span>')
    .replace(/\n\n/g, "<br><br>")
    .replace(/\n/g,   "<br>");
}

/* ═══════════════════════════════════════════════════════════════
   PEAKS
   ═══════════════════════════════════════════════════════════════ */

function renderPredPeaks(data) {
  const container = document.getElementById("predPeaks");
  if (!container) return;

  const peaks = data.prediction?.peaks || [];

  if (!peaks.length) {
    container.innerHTML = '<p class="pred-peak-empty">Aucun pic significatif détecté sur la période</p>';
  } else {
    container.innerHTML = peaks.map(p => `
      <div class="pred-peak-item">
        <span class="pred-peak-dot"></span>
        <span class="pred-peak-date">${_formatPredDate(p)}</span>
        <span class="pred-peak-tag">🔥 Pic</span>
      </div>
    `).join("");
  }

  // XGBoost peak days (30 prochains jours)
  const xgbDays = data.xgboost?.peak_days_next30 || [];
  if (xgbDays.length > 0) {
    container.innerHTML += `
      <div style="margin-top:14px;font-size:.68rem;text-transform:uppercase;
        letter-spacing:.5px;color:var(--text-muted,#6b7280);font-weight:600;margin-bottom:8px;">
        🤖 XGBoost — 30 prochains jours
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">
        ${xgbDays.slice(0, 6).map(d =>
          `<span class="pred-xgb-day">${_formatPredDate(d)}</span>`
        ).join("")}
      </div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   MODEL BADGE — évite les doublons au re-rendu
   ═══════════════════════════════════════════════════════════════ */

function renderModelBadge(data) {
  const badge = document.getElementById("modelBadge");
  if (!badge) return;

  const model   = data.prediction?.model   || "Inconnu";
  const metrics = data.prediction?.metrics || {};
  const trend   = data.prediction?.trend   || "stable";

  const modelClass = { "Prophet": "prophet", "ARIMA": "arima", "NaiveWMA": "naive" }[model] || "prophet";
  badge.className   = `pred-model-badge ${modelClass}`;
  badge.textContent = model;

  const trendEmoji = { hausse: "📈", baisse: "📉", stable: "➡️" }[trend] || "➡️";
  const trendColor = { hausse: "#34d399", baisse: "#ef4444", stable: "#94a3b8" }[trend];

  // Trend pill — réutiliser si déjà présent
  let trendEl = document.getElementById("predTrendPill");
  if (!trendEl) {
    trendEl    = document.createElement("span");
    trendEl.id = "predTrendPill";
    trendEl.style.cssText = `
      font-size:.72rem; font-weight:700; padding:3px 10px;
      border-radius:20px; margin-left:8px;
    `;
    badge.parentNode.appendChild(trendEl);
  }
  trendEl.textContent       = `${trendEmoji} ${trend.charAt(0).toUpperCase() + trend.slice(1)}`;
  trendEl.style.color       = trendColor;
  trendEl.style.background  = `${trendColor}22`;

  // MAPE info — masquer si 0.0 (non fiable) ou null
  let mapeEl = document.getElementById("predMapeInfo");
  if (!mapeEl) {
    mapeEl    = document.createElement("span");
    mapeEl.id = "predMapeInfo";
    mapeEl.style.cssText = `font-size:.65rem; color:var(--text-muted,#6b7280); margin-left:8px;`;
    badge.parentNode.appendChild(mapeEl);
  }

  const mape = metrics.mape;
  if (mape !== null && mape !== undefined && mape > 0) {
    mapeEl.textContent = `MAPE: ${mape.toFixed(1)}%`;
  } else if (mape === 0) {
    // MAPE = 0 est suspect → indiquer "N/A"
    mapeEl.textContent = `MAPE: N/A`;
    mapeEl.title = "Métrique non fiable avec peu de données";
  } else {
    mapeEl.textContent = "";
  }
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function _setPredEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _formatPredDate(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("fr-FR", {
      day: "numeric", month: "short", year: "numeric"
    });
  } catch { return dateStr; }
}

function _predSkeletonHTML() {
  return `
    <div class="pred-insight-skeleton">
      <div class="pred-skel-line" style="width:80%"></div>
      <div class="pred-skel-line" style="width:65%"></div>
      <div class="pred-skel-line" style="width:90%"></div>
      <div class="pred-skel-line" style="width:70%"></div>
      <div class="pred-skel-line" style="width:55%"></div>
    </div>`;
}

function _showPredError(message) {
  const insightEl = document.getElementById("predInsight");
  if (insightEl) {
    insightEl.innerHTML = `
      <div style="color:#ef4444;display:flex;align-items:center;gap:8px;font-size:.85rem;">
        ❌ ${message}
      </div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════
   AUTO-LOAD quand la vue prédictions devient active
   ═══════════════════════════════════════════════════════════════ */

(function () {
  const _origShowView = window.showView;
  window.showView = function (viewName) {
    if (typeof _origShowView === "function") _origShowView(viewName);
    if (viewName === "predictions" && !predictionChart) {
      setTimeout(loadPrediction, 200);
    }
  };
})();