/**
 * reserver.js — Grand Hôtel Reservation Form
 * Gestion : navigation multi-étapes, validation, compteurs,
 *            champs de paiement dynamiques, récapitulatif prix,
 *            génération de facture (étape 4), impression & export PDF
 */

"use strict";

// ═══════════════════ ÉTAT ═══════════════════
let currentSection = 1;
const TOTAL_SECTIONS = 4; // ← maintenant 4 étapes

// ═══════════════════ NAVIGATION SECTIONS ═══════════════════
function showSection(n) {
  document.querySelectorAll(".form-section").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(`section-${n}`);
  if (target) target.classList.add("active");
  currentSection = n;
  updateStepper(n);
}

function updateStepper(n) {
  for (let i = 1; i <= TOTAL_SECTIONS; i++) {
    const dot = document.getElementById(`step-dot-${i}`);
    if (!dot) continue;
    dot.classList.remove("active", "done");
    if (i < n)        dot.classList.add("done");
    else if (i === n) dot.classList.add("active");
  }
}

function nextSection(from) {
  if (!validateSection(from)) return;
  const next = from + 1;
  if (next <= TOTAL_SECTIONS) showSection(next);
  if (next === 3) updatePriceSummary();
  if (next === 4) buildInvoice();   // ← génère la facture à l'étape 4
}

function prevSection(from) {
  if (from > 1) showSection(from - 1);
}

// ═══════════════════ COMPTEURS ═══════════════════
function adjustCounter(fieldId, delta) {
  const input = document.getElementById(fieldId);
  let val = parseInt(input.value, 10) + delta;

  const adultes = parseInt(document.getElementById("adultes").value, 10);
  const enfants = parseInt(document.getElementById("enfants").value, 10);
  const total   = fieldId === "adultes" ? val + enfants : adultes + val;

  if (total > 4) {
    showError("err-enfants", "Maximum 4 personnes au total.");
    return;
  }
  clearError("err-enfants");
  clearError("err-adultes");

  const min = parseInt(input.min, 10);
  const max = parseInt(input.max, 10);
  val = Math.max(min, Math.min(max, val));
  input.value = val;
  updatePriceSummary();
}

// ═══════════════════ PAIEMENT DYNAMIQUE ═══════════════════
document.addEventListener("DOMContentLoaded", () => {
  // ═══════════════════ PRÉ-SÉLECTION CHAMBRE (depuis URL) ═══════════════════
const urlParams = new URLSearchParams(window.location.search);
const preselectedRoom = urlParams.get('room') || sessionStorage.getItem('pendingRoom');

if (preselectedRoom) {
  const radioToCheck = document.querySelector(`input[name='type_chambre'][value='${preselectedRoom}']`);
  if (radioToCheck) {
    radioToCheck.checked = true;
    // Mettre en évidence visuellement la carte sélectionnée
    radioToCheck.closest('.room-card')?.classList.add('selected');
    updatePriceSummary();
  }
  // Nettoyer le sessionStorage
  sessionStorage.removeItem('pendingRoom');
}
  // Min date = aujourd'hui
  const today    = new Date().toISOString().split("T")[0];
  const arrInput = document.getElementById("date_arrivee");
  const depInput = document.getElementById("date_depart");
  if (arrInput) arrInput.min = today;

  arrInput.addEventListener("change", () => {
    depInput.min = arrInput.value;
    if (depInput.value && depInput.value <= arrInput.value) {
      depInput.value = "";
      showError("err-depart", "La date de départ doit être après l'arrivée.");
    }
    updatePriceSummary();
  });
  depInput.addEventListener("change", updatePriceSummary);

  // Chambre / pension → recalcul
  document.querySelectorAll("input[name='type_chambre'], input[name='pension']")
    .forEach(r => r.addEventListener("change", updatePriceSummary));

  // Mode de paiement → afficher champs supplémentaires
  document.querySelectorAll("input[name='paiement']").forEach(r => {
    r.addEventListener("change", handlePaymentChange);
  });

  // Formatage numéro de carte
  const cardNum = document.getElementById("card_number");
  if (cardNum) {
    cardNum.addEventListener("input", () => {
      let numbers = cardNum.value.replace(/\D/g, "").slice(0, 16);
      cardNum.value = numbers.replace(/(.{4})/g, "$1 ").trim();
    });
  }

  // Formatage expiration
  const cardExp = document.getElementById("card_expiry");
  if (cardExp) {
    cardExp.addEventListener("input", () => {
      let v = cardExp.value.replace(/\D/g, "").slice(0, 4);
      if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
      cardExp.value = v;
    });
  }

  // CVV chiffres seulement
  const cardCvv = document.getElementById("card_cvv");
  if (cardCvv) {
    cardCvv.addEventListener("input", () => {
      cardCvv.value = cardCvv.value.replace(/\D/g, "").slice(0, 3);
    });
  }

  // Soumission du formulaire
  document.getElementById("reservationForm")
    .addEventListener("submit", handleSubmit);
});

function handlePaymentChange() {
  const val = document.querySelector("input[name='paiement']:checked")?.value;
  const cardFields   = document.getElementById("cardFields");
  const paypalFields = document.getElementById("paypalFields");

  cardFields.classList.add("hidden");
  paypalFields.classList.add("hidden");

  if (val === "carte")  cardFields.classList.remove("hidden");
  if (val === "paypal") paypalFields.classList.remove("hidden");
}

// ═══════════════════ CALCUL DES PRIX ═══════════════════
const ROOM_PRICES = {
  simple: { adult: 100, child: 50  },
  double: { adult: 120, child: 60  },
  suite:  { adult: 150, child: 75  }
};
const PENSION_PRICES = {
  petit_dejeuner: 15,
  demi_pension:   30,
  complete:       40
};

function calculatePrice() {
  const arrivee  = document.getElementById("date_arrivee").value;
  const depart   = document.getElementById("date_depart").value;
  const adultes  = parseInt(document.getElementById("adultes").value, 10) || 0;
  const enfants  = parseInt(document.getElementById("enfants").value, 10) || 0;
  const roomType = document.querySelector("input[name='type_chambre']:checked")?.value;
  const pension  = document.querySelector("input[name='pension']:checked")?.value;

  if (!arrivee || !depart || !roomType) return null;

  const d1   = new Date(arrivee);
  const d2   = new Date(depart);
  const days = Math.round((d2 - d1) / 86400000);
  if (days <= 0) return null;

  const rp   = ROOM_PRICES[roomType];
  const pp   = PENSION_PRICES[pension] || 0;

  const roomTotal    = days * (adultes * rp.adult + enfants * rp.child);
  const pensionTotal = days * pp * (adultes + enfants);
  const total        = roomTotal + pensionTotal;

  return { days, adultes, enfants, roomType, pension, roomTotal, pensionTotal, total, arrivee, depart };
}

function updatePriceSummary() {
  const data = calculatePrice();
  const rowsEl       = document.getElementById("summaryRows");
  const totalEl      = document.getElementById("summaryTotal");
  const totalDisplay = document.getElementById("totalDisplay");

  if (!data) {
    rowsEl.innerHTML = '<p class="summary-placeholder">Complétez le formulaire pour voir l\'estimation.</p>';
    totalEl.classList.add("hidden");
    return;
  }

  const roomLabel    = { simple: "Chambre Simple", double: "Chambre Double", suite: "Suite" }[data.roomType];
  const pensionLabel = { petit_dejeuner: "Petit déjeuner", demi_pension: "Demi-pension", complete: "Pension complète" }[data.pension] || "—";

  rowsEl.innerHTML = `
    <div class="summary-row"><span>Durée du séjour</span><span class="val">${data.days} nuit${data.days > 1 ? "s" : ""}</span></div>
    <div class="summary-row"><span>Occupants</span><span class="val">${data.adultes} adulte${data.adultes > 1 ? "s" : ""}${data.enfants > 0 ? " + " + data.enfants + " enfant" + (data.enfants > 1 ? "s" : "") : ""}</span></div>
    <div class="summary-row"><span>${roomLabel}</span><span class="val">${data.roomTotal} DT</span></div>
    ${data.pensionTotal > 0 ? `<div class="summary-row"><span>${pensionLabel}</span><span class="val">${data.pensionTotal} DT</span></div>` : ""}
  `;

  totalDisplay.textContent = data.total + " DT";
  totalEl.classList.remove("hidden");
}

// ═══════════════════ GÉNÉRATION FACTURE (ÉTAPE 4) ═══════════════════

function buildInvoice() {
  const data = calculatePrice();
  if (!data) return;

  // ── Infos client ──
  const nom       = document.getElementById("nom").value.trim();
  const email     = document.getElementById("email").value.trim();
  const telephone = document.getElementById("telephone").value.trim();

  // ── Mode de paiement ──
  const paiementVal = document.querySelector("input[name='paiement']:checked")?.value || "";
  const paiementLabels = {
    espece: "Espèces (à l'hôtel)",
    carte:  "Carte bancaire",
    paypal: "PayPal"
  };

  // ── Numéro de facture unique ──
  const invoiceNum = "GH-" + new Date().getFullYear() + "-" + String(Math.floor(Math.random() * 90000) + 10000);

  // ── Date d'émission ──
  const now = new Date();
  const emissionDate = now.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

  // ── Labels ──
  const roomLabels    = { simple: "Chambre Simple", double: "Chambre Double", suite: "Suite" };
  const pensionLabels = { petit_dejeuner: "Petit déjeuner (+15 DT/pers/nuit)", demi_pension: "Demi-pension (+30 DT/pers/nuit)", complete: "Pension complète (+40 DT/pers/nuit)" };

  const formatDate = iso => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };

  const occupants = `${data.adultes} adulte${data.adultes > 1 ? "s" : ""}` +
    (data.enfants > 0 ? ` + ${data.enfants} enfant${data.enfants > 1 ? "s" : ""}` : "");

  // ── Remplissage des champs d'en-tête ──
  setText("inv-number",   invoiceNum);
  setText("inv-date",     emissionDate);
  setText("inv-nom",      nom);
  setText("inv-email",    email);
  setText("inv-tel",      telephone);
  setText("inv-arrivee",  formatDate(data.arrivee));
  setText("inv-depart",   formatDate(data.depart));
  setText("inv-duree",    `${data.days} nuit${data.days > 1 ? "s" : ""}`);
  setText("inv-occupants",occupants);
  setText("inv-paiement", paiementLabels[paiementVal] || paiementVal);

  // ── Tableau des lignes ──
  const rp = ROOM_PRICES[data.roomType];
  const pp = PENSION_PRICES[data.pension] || 0;
  const tbody = document.getElementById("invoiceTableBody");

  let rows = "";

  // Ligne adultes hébergement
  if (data.adultes > 0) {
    const unitAdult = rp.adult;
    const totalAdult = data.days * data.adultes * unitAdult;
    rows += invoiceRow(
      `${roomLabels[data.roomType]} — Adultes`,
      "nuit",
      `${data.days} × ${data.adultes} pers.`,
      `${unitAdult} DT`,
      `${totalAdult} DT`
    );
  }

  // Ligne enfants hébergement
  if (data.enfants > 0) {
    const unitChild = rp.child;
    const totalChild = data.days * data.enfants * unitChild;
    rows += invoiceRow(
      `${roomLabels[data.roomType]} — Enfants`,
      "nuit",
      `${data.days} × ${data.enfants} pers.`,
      `${unitChild} DT`,
      `${totalChild} DT`
    );
  }

  // Ligne pension (si choisie)
  if (pp > 0 && data.pension) {
    const totalPersonnes = data.adultes + data.enfants;
    const totalPension   = data.days * pp * totalPersonnes;
    rows += invoiceRow(
      pensionLabels[data.pension] || "Pension",
      "nuit",
      `${data.days} × ${totalPersonnes} pers.`,
      `${pp} DT`,
      `${totalPension} DT`
    );
  }

  tbody.innerHTML = rows;

  // ── Totaux ──
  setText("inv-subtotal-room",    data.roomTotal    + " DT");
  setText("inv-subtotal-pension", data.pensionTotal > 0 ? data.pensionTotal + " DT" : "0 DT");
  setText("inv-total",            data.total        + " DT");

  // Masquer ligne pension si inutile
  const pensionRow = document.getElementById("inv-pension-row");
  if (pensionRow) {
    pensionRow.style.display = data.pensionTotal > 0 ? "" : "none";
  }
}

function invoiceRow(designation, unite, quantite, prixUnit, total) {
  return `
    <tr>
      <td>${designation}</td>
      <td>${unite}</td>
      <td>${quantite}</td>
      <td>${prixUnit}</td>
      <td>${total}</td>
    </tr>
  `;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ═══════════════════ IMPRESSION ═══════════════════
function printInvoice() {
  window.print();
}

// ═══════════════════ EXPORT PDF ═══════════════════
function exportPDF() {
  const element = document.getElementById("invoicePrint");
  if (!element) return;

  // Récupérer le numéro de facture pour le nom du fichier
  const invNum = document.getElementById("inv-number")?.textContent || "facture";

  const options = {
    margin:      [10, 10, 10, 10],
    filename:    `${invNum}.pdf`,
    image:       { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" }
  };

  // Désactiver temporairement les animations pour le rendu PDF
  element.style.animation = "none";

  html2pdf()
    .set(options)
    .from(element)
    .save()
    .then(() => {
      element.style.animation = "";
    });
}

// ═══════════════════ VALIDATION ═══════════════════
function validateSection(n) {
  let valid = true;

  if (n === 1) {
    const nom   = document.getElementById("nom").value.trim();
    const email = document.getElementById("email").value.trim();
    const tel   = document.getElementById("telephone").value.trim();

    clearError("err-nom"); clearError("err-email"); clearError("err-tel");

    if (!nom || !/^[A-Za-zÀ-ÿ\s]+$/.test(nom)) {
      showError("err-nom", "Nom invalide (lettres uniquement).");
      valid = false;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("err-email", "Adresse email invalide.");
      valid = false;
    }
    if (!tel || !/^[0-9]{8}$/.test(tel)) {
      showError("err-tel", "8 chiffres requis.");
      valid = false;
    }
  }

  if (n === 2) {
    const today   = new Date().toISOString().split("T")[0];
    const arrivee = document.getElementById("date_arrivee").value;
    const depart  = document.getElementById("date_depart").value;
    const room    = document.querySelector("input[name='type_chambre']:checked");
    const adultes = parseInt(document.getElementById("adultes").value, 10);
    const enfants = parseInt(document.getElementById("enfants").value, 10);

    clearError("err-arrivee"); clearError("err-depart");
    clearError("err-room"); clearError("err-adultes"); clearError("err-enfants");

    if (!arrivee || arrivee < today) {
      showError("err-arrivee", "La date d'arrivée doit être aujourd'hui ou après.");
      valid = false;
    }
    if (!depart || depart <= arrivee) {
      showError("err-depart", "La date de départ doit être après l'arrivée.");
      valid = false;
    }
    if (!room) {
      showError("err-room", "Veuillez choisir un type de chambre.");
      valid = false;
    }
    if (adultes < 1) {
      showError("err-adultes", "Minimum 1 adulte.");
      valid = false;
    }
    if ((adultes + enfants) > 4) {
      showError("err-enfants", "Maximum 4 personnes.");
      valid = false;
    }
  }

  if (n === 3) {
    const pension  = document.querySelector("input[name='pension']:checked");
    const paiement = document.querySelector("input[name='paiement']:checked");

    clearError("err-pension"); clearError("err-paiement");

    if (!pension) {
      showError("err-pension", "Veuillez choisir une formule pension.");
      valid = false;
    }
    if (!paiement) {
      showError("err-paiement", "Veuillez choisir un moyen de paiement.");
      valid = false;
    }

    if (paiement?.value === "carte") {
      const num  = document.getElementById("card_number").value.replace(/\s/g, "");
      const exp  = document.getElementById("card_expiry").value;
      const cvv  = document.getElementById("card_cvv").value;
      const name = document.getElementById("card_name").value.trim();
      if (num.length < 16 || !/^\d{16}$/.test(num)) {
        showError("err-paiement", "Numéro de carte invalide (16 chiffres).");
        valid = false;
      } else if (!/^\d{2}\/\d{2}$/.test(exp)) {
        showError("err-paiement", "Date d'expiration invalide (MM/AA).");
        valid = false;
      } else if (!/^\d{3}$/.test(cvv)) {
        showError("err-paiement", "CVV invalide (3 chiffres).");
        valid = false;
      } else if (!name) {
        showError("err-paiement", "Veuillez saisir le nom sur la carte.");
        valid = false;
      }
    }

    if (paiement?.value === "paypal") {
      const ppEmail = document.getElementById("paypal_email").value.trim();
      if (!ppEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ppEmail)) {
        showError("err-paiement", "Adresse PayPal invalide.");
        valid = false;
      }
    }
  }

  // Étape 4 : pas de validation supplémentaire côté JS (le submit PHP s'en charge)
  return valid;
}

// ═══════════════════ SUBMIT ═══════════════════
function handleSubmit(e) {
  // On valide les étapes 1 à 3 avant soumission finale
  const ok1 = validateSection(1);
  const ok2 = validateSection(2);
  const ok3 = validateSection(3);

  if (!ok1 || !ok2 || !ok3) {
    e.preventDefault();
    return;
  }
  // Laisser le formulaire soumettre normalement vers reserver.php
}

// ═══════════════════ HELPERS ═══════════════════
function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}
function clearError(id) {
  const el = document.getElementById(id);
  if (el) el.textContent = "";
}