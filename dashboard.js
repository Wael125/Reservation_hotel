/* ============================================
   ROYAL MANSOUR — DASHBOARD JS
   Données réelles PHP + météo live + fidélité calculée
   + bannière checked-in + avis
   ============================================ */

/* ---- GLOBALS injectés par PHP ---- */
const LOGIN_ID      = window.LOGIN_ID;
const reservations  = window.RESERVATIONS || [];
const stats         = window.STATS        || {};
const CLIENT_PRENOM = window.CLIENT_PRENOM || '';
const CLIENT_NOM    = window.CLIENT_NOM    || '';

console.log('✅ Dashboard - login_id:', LOGIN_ID);
console.log('✅ Statuts réservations:', reservations.map(r => r.status));

/* ============================================
   HELPERS DATE / PRIX
   ============================================ */
function formatPrice(amount) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(parseFloat(amount) || 0)) + ' TND';
}

function formatDateLong(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short'
  });
}

function nightsBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 864e5);
}

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.ceil((new Date(dateStr) - today) / 864e5);
}

function isFuture(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  return new Date(dateStr) >= today;
}

function isOngoing(r) {
  const today = new Date(); today.setHours(0,0,0,0);
  return new Date(r.checkInDate) <= today && new Date(r.checkOutDate) > today;
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[ch]));
}

function hasExactCheckedInStatus(r) {
  if (!r) return false;
  const s = String(r.status ?? r.Status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return s === 'checked_in';
}

/* ============================================
   STATUTS QUI COMPTENT COMME "RÉALISÉS" (100%)
   ============================================ */
const STATUTS_REALISES  = ['checked_in', 'checked_out', 'completé', 'complete', 'complété', 'complétée'];
const STATUTS_CONFIRMES = ['confirmée', 'confirmee'];

/* ============================================
   CONDITION UNIQUE BANNIÈRE
   ============================================ */
function isCurrentCheckedInStay(r) {
  return hasExactCheckedInStatus(r);
}

/* ============================================
   STATUT BADGE TABLEAU HISTORIQUE
   ============================================ */
function getReservationStatus(r) {
  const s = normalizeStatus(r.status || r.Status);
  if (s === 'cancelled' || s === 'annulé' || s === 'annule') {
    return { cls: 'badge--cancelled', label: 'Annulé' };
  }
  if (isCurrentCheckedInStay(r)) {
    return { cls: 'badge--checkin', label: 'En cours' };
  }
  if (isFuture(r.checkInDate)) {
    return { cls: 'badge--upcoming', label: 'À venir' };
  }
  return { cls: 'badge--done', label: 'Terminé' };
}

function getBookingBadge(status) {
  const s = normalizeStatus(status);
  if (s === 'confirmée' || s === 'confirmee') return { cls: 'badge--checkin',   label: 'Confirmée'  };
  if (s === 'en attente')                     return { cls: 'badge--upcoming',  label: 'En attente' };
  if (s === 'checked_in')                     return { cls: 'badge--checkin',   label: 'En cours'   };
  if (s === 'cancelled' || s === 'annulé' || s === 'annule') return { cls: 'badge--cancelled', label: 'Annulé' };
  return { cls: 'badge--upcoming', label: 'À venir' };
}

/* ============================================
   CALCUL MONTANT SELON STATUT
   ============================================ */
function getAmountByStatus(r) {
  const s = normalizeStatus(r.status || r.Status);
  const payment = String(r.paymentDetails || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const price = parseFloat(r.totalPrice) || 0;
  if (payment.includes('paye le') || payment.includes('paid')) return price;
  if (STATUTS_REALISES.includes(s))  return price;
  if (STATUTS_CONFIRMES.includes(s)) return price * 0.30;
  return 0;
}

/* ============================================
   SYSTÈME DE FIDÉLITÉ
   ============================================ */
function computeLoyalty(resaList) {
  let totalNights = 0;
  let totalSpent  = 0;
  let nbStays     = 0;

  resaList.forEach(r => {
    const s = normalizeStatus(r.status || r.Status);
    if (s === 'cancelled' || s === 'annulé' || s === 'annule' || s === 'en attente') return;
    const amount = getAmountByStatus(r);
    if (amount === 0) return;
    totalSpent  += amount;
    totalNights += nightsBetween(r.checkInDate, r.checkOutDate);
    nbStays++;
  });

  const pts = Math.round(totalNights * 5 + (totalSpent / 50) + nbStays * 10);

  const paliers = [
    { label: 'Bronze',   min: 0,   max: 49,      next: 'Silver',   nextMin: 50   },
    { label: 'Silver',   min: 50,  max: 99,       next: 'Gold',     nextMin: 100  },
    { label: 'Gold',     min: 100, max: 199,      next: 'Platinum', nextMin: 200  },
    { label: 'Platinum', min: 200, max: 399,      next: 'Diamond',  nextMin: 400  },
    { label: 'Diamond',  min: 400, max: Infinity, next: null,       nextMin: null },
  ];

  const palier   = paliers.find(p => pts >= p.min && pts <= p.max) || paliers[0];
  const progress = palier.nextMin
    ? Math.min(100, Math.round(((pts - palier.min) / (palier.nextMin - palier.min)) * 100))
    : 100;

  return { pts, palier, progress };
}

const LOYALTY_PERKS = {
  Bronze:   ['Accès espace client', 'Newsletter exclusive', 'Offres membres'],
  Silver:   ['Check-in prioritaire', '5% sur les soins Spa', 'Early check-in (si dispo)'],
  Gold:     ['Check-in prioritaire', '10% sur les soins Spa', 'Accès lounge exclusif'],
  Platinum: ['Check-in VIP', '20% sur tous les services', 'Surclassement offert', 'Late check-out garanti'],
  Diamond:  ['Butler dédié', 'Surclassement automatique', 'Tous services offerts', 'Transfert aéroport inclus'],
};

/* ============================================
   DATE COURANTE
   ============================================ */
(function setDate() {
  const el = document.getElementById('currentDate');
  if (!el) return;
  const str = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  el.textContent = str.charAt(0).toUpperCase() + str.slice(1);
})();

/* ============================================
   MÉTÉO RÉELLE — Open-Meteo
   Mahdia, Tunisie : lat=35.5047, lon=11.0622
   ============================================ */
async function loadWeather() {
  const tempEl = document.getElementById('weatherTemp');
  const descEl = document.getElementById('weatherDesc');
  const tile   = document.getElementById('weatherTile');

  const WMO_LABELS = {
    0:'Ciel dégagé', 1:'Peu nuageux', 2:'Partiellement nuageux', 3:'Couvert',
    45:'Brouillard', 48:'Brouillard givrant',
    51:'Bruine légère', 53:'Bruine modérée', 55:'Bruine dense',
    61:'Pluie légère', 63:'Pluie modérée', 65:'Forte pluie',
    71:'Neige légère', 73:'Neige modérée', 75:'Forte neige',
    80:'Averses légères', 81:'Averses modérées', 82:'Fortes averses',
    95:'Orage', 96:'Orage avec grêle', 99:'Orage violent',
  };
  const WMO_ICONS = {
    0:'☀️', 1:'🌤️', 2:'⛅', 3:'☁️',
    45:'🌫️', 48:'🌫️', 51:'🌦️', 53:'🌦️', 55:'🌧️',
    61:'🌧️', 63:'🌧️', 65:'🌧️', 71:'❄️', 73:'❄️', 75:'❄️',
    80:'🌦️', 81:'🌦️', 82:'⛈️', 95:'⛈️', 96:'⛈️', 99:'⛈️',
  };

  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=35.5047&longitude=11.0622'
      + '&current_weather=true'
      + '&current=weathercode,apparent_temperature,wind_speed_10m,relative_humidity_2m'
      + '&wind_speed_unit=kmh&temperature_unit=celsius&timezone=Africa%2FTunis';

    const res  = await fetch(url);
    const data = await res.json();
    const cur  = data.current_weather || data.current || {};

    const temp = Math.round(cur.temperature ?? cur.temperature_2m ?? 0);
    const wmo  = cur.weathercode ?? cur.weather_code ?? 0;
    const icon = WMO_ICONS[wmo]  || '🌡️';
    const desc = WMO_LABELS[wmo] || 'Mahdia';
    const wind = Math.round(cur.windspeed ?? cur.wind_speed_10m ?? 0);

    if (tempEl) tempEl.textContent = icon + ' ' + temp + '°C';
    if (descEl) descEl.textContent = desc + ' · ' + wind + ' km/h';
    if (tile && (wmo === 0 || wmo === 1)) {
      tile.style.borderColor = 'rgba(201,168,76,.35)';
    }
  } catch (err) {
    console.warn('Météo indisponible:', err);
    if (tempEl) tempEl.textContent = '—°C';
    if (descEl) descEl.textContent = 'Mahdia, TN';
  }
}

/* ============================================
   NOTIFICATIONS DYNAMIQUES
   ============================================ */
function buildNotifications() {
  const list     = [];
  const nextStay = stats.nextStay || null;
  const loyalty  = computeLoyalty(reservations);

  if (nextStay && isFuture(nextStay.checkInDate)) {
    const days = daysUntil(nextStay.checkInDate);
    if (days <= 30) {
      const txt = days === 0 ? "C'est aujourd'hui ! Bienvenue au Royal Mansour 🎉"
                : days === 1 ? "Votre séjour commence demain. Bon voyage !"
                : `Votre séjour commence dans ${days} jour${days>1?'s':''}. Préparez-vous !`;
      list.push({ icon:'📅', title:'Rappel de séjour', text: txt,
                  time:'Mise à jour automatique', unread: days <= 7 });
    }
  }

  if (reservations.length > 0) {
    const { pts, palier } = loyalty;
    const txt = `Vous avez ${pts} point${pts>1?'s':''} — Statut ${palier.label}.`
      + (palier.next ? ` Plus que ${palier.nextMin - pts} pts pour atteindre ${palier.next} !`
                     : ' Niveau maximum atteint. Félicitations !');
    list.push({ icon:'⭐', title:'Points de fidélité', text: txt,
                time:'Calculé sur vos séjours', unread: true });
  }

  const offerMap = {
    Bronze:   { txt:'-5% sur votre prochain séjour jusqu\'au 30 Juin.',               unread:false },
    Silver:   { txt:'-10% sur votre prochain séjour jusqu\'au 30 Juin.',              unread:false },
    Gold:     { txt:'-15% sur votre prochain séjour jusqu\'au 30 Juin.',              unread:false },
    Platinum: { txt:'-20% sur votre prochain séjour + surclassement offert.',         unread:true  },
    Diamond:  { txt:'Séjour exclusif Diamond : accès complet all-inclusive offert.',  unread:true  },
  };
  const offer = offerMap[loyalty.palier.label];
  if (offer) {
    list.push({ icon:'🎁', title:`Offre exclusive ${loyalty.palier.label}`,
                text: offer.txt, time:'Valable jusqu\'au 30 Juin', unread: offer.unread });
  }

  const ongoing = reservations.find(hasExactCheckedInStatus);
  const today = new Date();
  today.setHours(0,0,0,0);
  if (ongoing) {
    const dLeft = daysUntil(ongoing.checkOutDate);
    const txt   = dLeft === 0 ? 'Votre départ est aujourd\'hui avant 12h00. Bon voyage !'
                : `Il vous reste ${dLeft} jour${dLeft>1?'s':''} avant votre départ (avant 12h00).`;
    list.push({ icon:'🏨', title:'Checkout imminent', text: txt,
                time:'Séjour en cours', unread: dLeft <= 1 });
  }

  const listEl = document.getElementById('notifList');
  if (!listEl) return;

  if (list.length === 0) {
    listEl.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-light);font-size:13px;">Aucune notification</div>`;
    return;
  }

  let hasUnread = false;
  listEl.innerHTML = list.map(n => {
    if (n.unread) hasUnread = true;
    return `
      <div class="notif-item ${n.unread?'notif-item--unread':''}">
        <div class="notif-icon">${n.icon}</div>
        <div class="notif-body">
          <div class="notif-title">${n.title}</div>
          <div class="notif-text">${n.text}</div>
          <div class="notif-time">${n.time}</div>
        </div>
      </div>`;
  }).join('');

  const dot = document.getElementById('notifDot');
  if (dot) dot.style.display = hasUnread ? 'block' : 'none';
}

/* ============================================
   BANNIÈRE SÉJOUR EN COURS
   ============================================ */
function initCheckinBanner() {
  const banner = document.getElementById('checkinBanner');
  if (!banner) return;

  banner.style.display = 'flex';
  window._ONGOING_RESA = null;

  const ongoing = reservations.find(hasExactCheckedInStatus);
  const today = new Date();
  today.setHours(0,0,0,0);
  const nextStay = stats.nextStay || reservations
    .filter(r => {
      const status = normalizeStatus(r.status || r.Status);
      return new Date(r.checkInDate) >= today
        && ['en attente', 'confirmée', 'confirmee', 'confirmed'].includes(status);
    })
    .sort((a, b) => new Date(a.checkInDate) - new Date(b.checkInDate))[0];

  const labelEl          = banner.querySelector('.checkin-banner-label');
  const countdownLabelEl = banner.querySelector('.checkin-countdown-label');
  const progressEl       = document.getElementById('checkinProgress');
  const startEl          = document.getElementById('checkinStart');
  const endEl            = document.getElementById('checkinEnd');

  if (ongoing) {
    window._ONGOING_RESA = ongoing;
    if (labelEl)          labelEl.textContent          = 'Séjour en cours';
    if (countdownLabelEl) countdownLabelEl.textContent = 'jours restants';

    const roomEl = document.getElementById('checkinRoom');
    if (roomEl) roomEl.textContent = ongoing.roomType + (ongoing.roomNumber ? ' · Chambre ' + ongoing.roomNumber : '');

    const daysLeft    = Math.max(0, daysUntil(ongoing.checkOutDate));
    document.getElementById('checkinDaysLeft').textContent = daysLeft;

    const totalNights = nightsBetween(ongoing.checkInDate, ongoing.checkOutDate);
    const pct         = totalNights > 0 ? Math.round(((totalNights - daysLeft) / totalNights) * 100) : 0;
    setTimeout(() => { document.getElementById('checkinProgress').style.width = pct + '%'; }, 450);

    document.getElementById('checkinStart').textContent = formatDateShort(ongoing.checkInDate);
    document.getElementById('checkinEnd').textContent   = formatDateShort(ongoing.checkOutDate);
    return;
  }

  const roomEl = document.getElementById('checkinRoom');
  const daysEl = document.getElementById('checkinDaysLeft');

  if (nextStay) {
    if (labelEl)          labelEl.textContent          = 'Prochain séjour';
    if (countdownLabelEl) countdownLabelEl.textContent = 'jours avant arrivée';
    if (roomEl)           roomEl.textContent           = (nextStay.roomType || 'Chambre') + (nextStay.roomNumber ? ' · Chambre ' + nextStay.roomNumber : '');
    if (daysEl)           daysEl.textContent           = Math.max(0, daysUntil(nextStay.checkInDate));
    if (progressEl)       progressEl.style.width       = '0%';
    if (startEl)          startEl.textContent          = formatDateShort(nextStay.checkInDate);
    if (endEl)            endEl.textContent            = formatDateShort(nextStay.checkOutDate);
    return;
  }

  if (labelEl)          labelEl.textContent          = 'Bienvenue';
  if (countdownLabelEl) countdownLabelEl.textContent = 'séjour';
  if (roomEl)           roomEl.textContent           = 'Aucun séjour en cours';
  if (daysEl)           daysEl.textContent           = '—';
  if (progressEl)       progressEl.style.width       = '0%';
  if (startEl)          startEl.textContent          = 'À planifier';
  if (endEl)            endEl.textContent            = 'Royal Mansour';
}

/* ============================================
   SHOW DASHBOARD HOME
   ============================================ */
function showDashboardHome() {
  window.MonProfil?.hide();
  window.MesReservations?.hide();
  window.FacturesPaiements?.hide();
  window.Activites?.hide();
  window.Restaurant?.hide();
  window.SpaBienEtre?.hide();   // ← SPA
  NosChambres?.hide();
  document.querySelectorAll('.stats-row, .dashboard-grid').forEach(el => { el.style.display = ''; });
  const greeting = document.querySelector('.topbar-greeting');
  if (greeting) greeting.textContent = 'Bon retour,';
  initCheckinBanner();
}

/* ============================================
   FIDÉLITÉ — RENDU CARTE
   ============================================ */
function renderLoyalty() {
  const { pts, palier, progress } = computeLoyalty(reservations);

  const loyaltyVal = document.querySelector('.loyalty-status-val');
  const loyaltySub = document.querySelector('.loyalty-status-sub');
  if (loyaltyVal) loyaltyVal.textContent = palier.label;
  if (loyaltySub) loyaltySub.textContent = palier.next
    ? `${pts} pts — prochain: ${palier.next}`
    : `${pts} pts — Niveau maximum`;

  const badgeText   = document.getElementById('loyaltyBadgeText');
  const statusLabel = document.getElementById('loyaltyStatusLabel');
  if (badgeText)   badgeText.textContent   = palier.label.toUpperCase();
  if (statusLabel) statusLabel.textContent = palier.label;

  const barFill   = document.getElementById('loyaltyBarFill');
  const ptsEl     = document.getElementById('loyaltyPts');
  const nextLabel = document.getElementById('loyaltyNextLabel');
  if (ptsEl)     ptsEl.textContent     = pts + ' pts';
  if (nextLabel) nextLabel.textContent = palier.next
    ? `${palier.next} à ${palier.nextMin} pts`
    : 'Niveau Diamond atteint ✦';
  if (barFill) {
    barFill.style.width = '0%';
    setTimeout(() => { barFill.style.width = progress + '%'; }, 350);
  }

  const perksEl = document.getElementById('loyaltyPerks');
  if (perksEl) {
    const perks = LOYALTY_PERKS[palier.label] || [];
    perksEl.innerHTML = perks.map(p => `
      <div class="perk">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        ${p}
      </div>`).join('');
  }
}

/* ============================================
   DOMContentLoaded — INIT PRINCIPAL
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {

  /* --- Identité client --- */
  const initiale = CLIENT_PRENOM.charAt(0).toUpperCase() || 'C';

  const topbarName = document.querySelector('.topbar-name');
  if (topbarName && CLIENT_NOM) {
    const parts = CLIENT_NOM.trim().split(' ');
    topbarName.innerHTML = parts[0] + (parts[1] ? ' <em>' + parts.slice(1).join(' ') + '</em>' : '');
  }
  document.querySelectorAll('.sidebar-avatar, .mobile-avatar').forEach(el => {
    el.textContent = initiale;
  });
  const sidebarNameEl = document.querySelector('.sidebar-user-name');
  if (sidebarNameEl && CLIENT_NOM) sidebarNameEl.textContent = CLIENT_NOM;
  const welcomeStrong = document.querySelector('.chat-welcome strong');
  if (welcomeStrong && CLIENT_PRENOM) welcomeStrong.textContent = CLIENT_PRENOM;

  /* --- Stat cards --- */
  const statValues = document.querySelectorAll('.stat-card-value');

  if (statValues[0]) {
    statValues[0].textContent = stats.total ?? reservations.length;
    const sub = statValues[0].closest('.stat-card-body')?.querySelector('.stat-card-sub');
    if (sub) sub.textContent = 'depuis votre inscription';
  }

  renderLoyalty();

  const nextStay = stats.nextStay || null;
  if (statValues[2]) {
    if (nextStay) {
      const diff = daysUntil(nextStay.checkInDate);
      statValues[2].textContent = diff === 0 ? 'Auj.' : diff + 'j';
      const sub = statValues[2].closest('.stat-card-body')?.querySelector('.stat-card-sub');
      if (sub) sub.textContent = formatDateShort(nextStay.checkInDate) + ' — ' + nextStay.roomType;
    } else {
      statValues[2].textContent = '—';
      const sub = statValues[2].closest('.stat-card-body')?.querySelector('.stat-card-sub');
      if (sub) sub.textContent = 'Aucun séjour à venir';
    }
  }

  if (statValues[3]) {
    const total = stats.totalSpent ?? reservations.reduce((s, r) => s + getAmountByStatus(r), 0);
    statValues[3].textContent = formatPrice(total);
    const sub = statValues[3].closest('.stat-card-body')?.querySelector('.stat-card-sub');
    const n   = stats.total ?? reservations.length;
    if (sub) sub.textContent = 'sur ' + n + ' séjour' + (n>1?'s':'');
  }

  /* --- SessionStorage stats pour mon_profil.js --- */
  try {
    const totalResa  = statValues[0]?.textContent?.trim() || '—';
    const totalSpent = statValues[3]?.textContent?.trim() || '—';
    const loyaltyVal = document.querySelector('.loyalty-status-val')?.textContent?.trim() || '—';
    const loyaltyPts = document.getElementById('loyaltyPts')?.textContent?.match(/(\d+)/)?.[1] || '—';

    sessionStorage.setItem('rm_activity_stats', JSON.stringify({
      totalResa:     totalResa === '—' ? '—' : parseInt(totalResa),
      totalSpent,
      loyaltyPts:    loyaltyPts === '—' ? '—' : parseInt(loyaltyPts),
      loyaltyStatus: loyaltyVal
    }));
  } catch(e) {
    console.warn('Erreur sessionStorage:', e);
  }

  /* --- Carte prochaine réservation --- */
  const featCard = document.querySelector('.card--featured');
  if (nextStay && featCard) {
    const nights = nightsBetween(nextStay.checkInDate, nextStay.checkOutDate);
    const ft = featCard.querySelector('.booking-featured-title');
    if (ft) ft.textContent = nextStay.roomType + (nextStay.roomNumber ? ' — Chambre ' + nextStay.roomNumber : '');
    const rt = featCard.querySelector('.booking-room-type');
    if (rt) rt.textContent = nextStay.roomType;
    const dv = featCard.querySelectorAll('.booking-date-val');
    if (dv[0]) dv[0].textContent = formatDateLong(nextStay.checkInDate);
    if (dv[1]) dv[1].textContent = formatDateLong(nextStay.checkOutDate);
    const as = featCard.querySelector('.booking-date-arrow span');
    if (as) as.textContent = nights + ' nuit' + (nights>1?'s':'');
    const tagsEl = featCard.querySelector('.booking-tags');
    if (tagsEl) {
      const adults   = parseInt(nextStay.numberOfAdults)   || 1;
      const children = parseInt(nextStay.numberOfChildren) || 0;
      const pension  = nextStay.pension || '';
      let html = `<span class="tag">${adults} adulte${adults>1?'s':''}</span>`;
      if (children > 0) html += `<span class="tag">${children} enfant${children>1?'s':''}</span>`;
      if (pension)       html += `<span class="tag">${pension}</span>`;
      tagsEl.innerHTML = html;
    }
    const tv = featCard.querySelector('.booking-total-val');
    if (tv) tv.textContent = formatPrice(nextStay.totalPrice);

    const statusBadge = featCard.querySelector('.card-header .badge');
    if (statusBadge) {
      const badgeMeta = getBookingBadge(nextStay.status || nextStay.Status);
      statusBadge.textContent = badgeMeta.label;
      statusBadge.classList.remove('badge--upcoming', 'badge--checkin', 'badge--cancelled', 'badge--done');
      statusBadge.classList.add(badgeMeta.cls);
    }

    const actions = featCard.querySelectorAll('.booking-actions button');
    if (actions[0]) {
      actions[0].textContent = 'Modifier';
      actions[0].onclick = () => window.MesReservations?.openEdit(nextStay.id);
    }
    if (actions[1]) {
      actions[1].textContent = 'Annuler';
      actions[1].classList.remove('btn-gold-sm');
      actions[1].classList.add('btn-danger-sm');
      actions[1].onclick = () => window.MesReservations?.openConfirmCancel(nextStay.id);
    }
  } else if (featCard) {
    featCard.innerHTML = `
      <div class="card-header"><span class="card-eyebrow">Prochaine réservation</span></div>
      <div style="text-align:center;padding:40px 0;color:var(--text-light);">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"
          style="margin:0 auto 14px;opacity:.25;display:block;">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <p style="font-size:13px;margin-bottom:16px;font-weight:300;">Aucune réservation à venir</p>
        <button class="btn-gold-sm" onclick="window.location.href='reserver.html'">Réserver maintenant</button>
      </div>`;
  }

  /* --- Tableau historique --- */
  const tbody = document.querySelector('.history-table tbody');
  if (tbody) {
    if (reservations.length > 0) {
      tbody.innerHTML = '';
      reservations.forEach(r => {
        const dateStr = formatDateShort(r.checkInDate) + '–' + formatDateShort(r.checkOutDate)
                      + ' ' + new Date(r.checkOutDate).getFullYear();
        const { cls, label } = getReservationStatus(r);
        tbody.innerHTML += `
          <tr>
            <td><span class="room-name-cell">${r.roomType||'—'}</span></td>
            <td class="date-cell">${dateStr}</td>
            <td>${r.pension||'—'}</td>
            <td class="amount-cell">${formatPrice(r.totalPrice)}</td>
            <td><span class="badge ${cls}">${label}</span></td>
          </tr>`;
      });
    } else {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-light);padding:28px 0;font-size:13px;font-weight:300;">Aucune réservation trouvée</td></tr>`;
    }
  }

  /* --- Bannière checked-in --- */
  initCheckinBanner();

  /* --- Notifications --- */
  buildNotifications();

  /* --- Météo live --- */
  loadWeather();

  /* --- Nos chambres --- */
  NosChambres?.init();

  /* --- Chat keypress --- */
  const msgInput = document.getElementById('msg');
  if (msgInput) {
    msgInput.addEventListener('keypress', e => { if (e.key === 'Enter') send(); });
  }
});

/* ============================================
   SIDEBAR MOBILE
   ============================================ */
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
}
document.addEventListener('click', e => {
  const sidebar   = document.getElementById('sidebar');
  const burgerBtn = document.querySelector('.burger-btn');
  if (sidebar?.classList.contains('mobile-open') && !sidebar.contains(e.target) && !burgerBtn?.contains(e.target)) {
    sidebar.classList.remove('mobile-open');
  }
});

/* ============================================
   NAVIGATION
   ============================================ */
document.querySelectorAll('.nav-item[data-section]').forEach(item => {
  item.addEventListener('click', function(e) {
    const href = this.getAttribute('href');
    if (href && href !== '#' && !href.startsWith('#')) return;
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    this.classList.add('active');
    document.getElementById('sidebar').classList.remove('mobile-open');

    const section = this.dataset.section;
    if (section && section !== 'chambres' && section !== 'reservations'
        && section !== 'factures' && section !== 'spa') {
      showDashboardHome();
    }
  });
});

/* ============================================
   LOGOUT
   ============================================ */
function logout() {
  if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
    window.location.href = 'logout.php';
  }
}

/* ============================================
   NOTIFICATIONS PANEL
   ============================================ */
let notifOpen = false;
function toggleNotifications() {
  notifOpen = !notifOpen;
  document.getElementById('notifPanel').classList.toggle('open',    notifOpen);
  document.getElementById('notifOverlay').classList.toggle('open',  notifOpen);
}
function markAllRead() {
  document.querySelectorAll('.notif-item--unread').forEach(n => n.classList.remove('notif-item--unread'));
  const dot = document.getElementById('notifDot');
  if (dot) dot.style.display = 'none';
  toggleNotifications();
}

/* ============================================
   QUICK ACTIONS
   ============================================ */
function downloadInvoice() {
  if (window.FacturesPaiements?.openLatestInvoice()) return;
  alert('Aucune facture disponible pour le moment.');
}
function contactConcierge() {
  window.location.href = 'tel:+21673681100';
}

/* ============================================
   MODAL AVIS
   ============================================ */
let reviewRating   = 0;
const catRatings   = { room:0, service:0, food:0, clean:0 };
const ratingLabels = ['','Décevant','Passable','Bien','Très bien','Excellent'];

function openReview() {
  const infoEl = document.getElementById('reviewStayInfo');
  if (infoEl) {
    const resa = window._ONGOING_RESA
      || reservations.find(r => !isFuture(r.checkInDate) && normalizeStatus(r.status||'') !== 'cancelled')
      || null;
    infoEl.innerHTML = resa
      ? `<div class="review-stay-badge">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
             <path d="M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7z"/>
             <path d="M2 12h20"/><path d="M7 12V7"/>
           </svg>
           ${resa.roomType}${resa.roomNumber ? ' · Chambre ' + resa.roomNumber : ''}
           &nbsp;·&nbsp; ${formatDateShort(resa.checkInDate)} – ${formatDateShort(resa.checkOutDate)}
         </div>`
      : '';
  }

  reviewRating = 0;
  Object.keys(catRatings).forEach(k => catRatings[k] = 0);
  document.querySelectorAll('.star, .star-sm').forEach(s => s.classList.remove('active'));
  const rtEl = document.getElementById('reviewRatingText');
  if (rtEl) rtEl.textContent = 'Sélectionnez une note';
  const ta = document.getElementById('reviewComment');
  if (ta) ta.value = '';

  document.getElementById('reviewOverlay').classList.add('open');
  document.getElementById('reviewModal').classList.add('open');
}

function closeReview() {
  document.getElementById('reviewOverlay').classList.remove('open');
  document.getElementById('reviewModal').classList.remove('open');
}

function setRating(val) {
  reviewRating = val;
  document.querySelectorAll('#reviewStars .star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= val);
  });
  const rtEl = document.getElementById('reviewRatingText');
  if (rtEl) rtEl.textContent = ratingLabels[val] || '';
}

function setCatRating(cat, val) {
  catRatings[cat] = val;
  const catId = 'cat' + cat.charAt(0).toUpperCase() + cat.slice(1);
  document.querySelectorAll(`#${catId} .star-sm`).forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= val);
  });
}

function submitReview() {
  if (reviewRating === 0) {
    alert('Veuillez sélectionner une note globale.');
    return;
  }
  const comment = document.getElementById('reviewComment')?.value.trim() || '';
  console.log('Avis soumis:', { rating: reviewRating, cats: { ...catRatings }, comment });
  closeReview();
  showToast('Merci pour votre avis ! ✨');
}

/* ============================================
   TOAST
   ============================================ */
function showToast(msg) {
  let toast = document.getElementById('dashToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id        = 'dashToast';
    toast.className = 'dash-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3500);
}

/* ============================================
   CHATBOT — BULLE DE BIENVENUE
   ============================================ */
setTimeout(() => {
  const el = document.getElementById('chatWelcome');
  if (el) el.style.display = 'none';
}, 6000);

function dismissWelcome() {
  const el = document.getElementById('chatWelcome');
  if (el) el.style.display = 'none';
}

/* ============================================
   CHATBOT — TOGGLE
   ============================================ */
function toggleChat() {
  const chat    = document.getElementById('chatContainer');
  const welcome = document.getElementById('chatWelcome');
  if (chat.style.display === 'flex') {
    chat.style.display = 'none';
  } else {
    chat.style.display = 'flex';
    if (welcome) welcome.style.display = 'none';
    if (!chat.dataset.opened) {
      const prenom = CLIENT_PRENOM || 'cher(e) client(e)';
      appendBot(`👋 Bonjour ${prenom} ! Je suis Yasmine, votre assistante personnelle. Comment puis-je vous aider aujourd'hui ?`);
      chat.dataset.opened = 'true';
    }
    setTimeout(() => { document.getElementById('msg')?.focus(); }, 100);
  }
}

function openChatWithIntent(intentText) {
  const chat = document.getElementById('chatContainer');
  if (chat.style.display !== 'flex') toggleChat();
  if (!intentText) return;
  setTimeout(() => sendMessage(intentText), 400);
}

/* ============================================
   CHATBOT — MESSAGES DOM
   ============================================ */
function appendBot(text) {
  const box = document.getElementById('chatBox');
  const div = document.createElement('div');
  div.className = 'message bot';
  div.innerText = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function appendUser(text) {
  const box = document.getElementById('chatBox');
  const div = document.createElement('div');
  div.className = 'message user';
  div.innerText = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function addMessage(text, type) {
  if (type === 'bot') appendBot(text); else appendUser(text);
}
function showTyping() {
  if (document.getElementById('typing')) return;
  const box = document.getElementById('chatBox');
  const div = document.createElement('div');
  div.className = 'message typing';
  div.id        = 'typing';
  div.innerText = 'Yasmine écrit…';
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function removeTyping() {
  document.getElementById('typing')?.remove();
}

/* ============================================
   CHATBOT — ENVOI API
   ============================================ */
async function sendMessage(message) {
  if (!message?.trim()) return;
  appendUser(message);
  showTyping();
  try {
    const res  = await fetch('http://127.0.0.1:5000/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, login_id: LOGIN_ID })
    });
    const data = await res.json();
    removeTyping();
    appendBot('🤖 ' + data.reply);
  } catch (err) {
    removeTyping();
    appendBot('❌ Erreur serveur : ' + err.message);
  }
}

async function send() {
  const input = document.getElementById('msg');
  const msg   = input.value.trim();
  if (!msg) return;
  input.value = '';
  await sendMessage(msg);
}