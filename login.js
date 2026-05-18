/* ============================================
   ROYAL MANSOUR — HOTEL IBEROSTAR MAHDIA
   login.js — All client-side logic
   ============================================ */

/* ============ NAV SCROLL ============ */
window.addEventListener("scroll", () => {
  const nav = document.getElementById("mainNav");
  if (nav) {
    nav.classList.toggle("scrolled", window.scrollY > 60);
  }
});

/* ============ MOBILE MENU ============ */
function toggleMenu() {
  const menu = document.getElementById("mobileMenu");
  if (menu) menu.classList.toggle("open");
}

/* ============ SMOOTH SCROLL ============ */
function scrollTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

/* ============ BOOKING BAR DATES ============ */
(function initDates() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const fmt = (d) => d.toISOString().split("T")[0];

  const checkin = document.getElementById("bar_checkin");
  const checkout = document.getElementById("bar_checkout");

  if (checkin) {
    checkin.value = fmt(today);
    checkin.min = fmt(today);
    checkin.addEventListener("change", () => {
      if (checkout && checkout.value <= checkin.value) {
        const next = new Date(checkin.value);
        next.setDate(next.getDate() + 1);
        checkout.value = fmt(next);
      }
    });
  }

  if (checkout) {
    checkout.value = fmt(tomorrow);
    checkout.min = fmt(tomorrow);
  }
})();

/* ============ AUTH MODAL ============ */
let _pendingRoom = null;

function openAuth(tab, isReservation, roomName) {
  const overlay = document.getElementById("authOverlay");
  const banner = document.getElementById("intentBanner");
  const intentRoom = document.getElementById("intentRoom");

  if (!overlay) return;

  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  // Show reservation intent banner
  if (isReservation) {
    _pendingRoom = roomName || null;
    if (banner) banner.classList.add("show");
    if (intentRoom) {
      intentRoom.textContent = roomName || "votre chambre";
    }
  } else {
    if (banner) banner.classList.remove("show");
  }

  switchTab(tab || "login");
  clearMsg();
}

function closeAuth() {
  const overlay = document.getElementById("authOverlay");
  if (overlay) overlay.classList.remove("open");
  document.body.style.overflow = "";
  clearMsg();
  resetForms();
}

// Close on overlay click
document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("authOverlay");
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeAuth();
    });
  }

  // Close on ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAuth();
  });

  loadCountries();
});

/* ============ TABS ============ */
function switchTab(tab) {
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const tabLogin = document.getElementById("tabLogin");
  const tabRegister = document.getElementById("tabRegister");
  const authTitle = document.getElementById("authTitle");
  const authSubtitle = document.getElementById("authSubtitle");

  clearMsg();

  if (tab === "login") {
    if (loginForm) loginForm.style.display = "block";
    if (registerForm) registerForm.style.display = "none";
    if (tabLogin) tabLogin.classList.add("active");
    if (tabRegister) tabRegister.classList.remove("active");
    if (authTitle) authTitle.textContent = "Bienvenue";
    if (authSubtitle) authSubtitle.textContent = "Connectez-vous à votre espace client";
  } else {
    if (loginForm) loginForm.style.display = "none";
    if (registerForm) registerForm.style.display = "block";
    if (tabLogin) tabLogin.classList.remove("active");
    if (tabRegister) tabRegister.classList.add("active");
    if (authTitle) authTitle.textContent = "Créer un compte";
    if (authSubtitle) authSubtitle.textContent = "Rejoignez Royal Mansour en quelques étapes";
    backStep1(false);
  }
}

/* ============ MESSAGES ============ */
function showMsg(text, type) {
  const msg = document.getElementById("authMsg");
  if (!msg) return;
  msg.innerHTML = text;
  msg.className = "auth-msg " + type;
}

function clearMsg() {
  const msg = document.getElementById("authMsg");
  if (msg) {
    msg.innerHTML = "";
    msg.className = "auth-msg";
  }
}

/* ============ LOGIN ============ */
function login() {
  const username = document.getElementById("username");
  const password = document.getElementById("password");

  if (!username || !password) return;

  if (!username.value.trim() || !password.value.trim()) {
    showMsg("⚠️ Veuillez remplir tous les champs !", "error");
    return;
  }

  const data = new FormData();
  data.append("login", true);
  data.append("username", username.value.trim());
  data.append("password", password.value);

  fetch("login.php", { method: "POST", body: data })
    .then((r) => r.json())
    .then((r) => {
      showMsg(r.message, r.status);
if (r.status === "success") {
  setTimeout(() => {
    const pendingRoom = sessionStorage.getItem('pendingRoom');
    if (pendingRoom) {
      // ✅ 'general' redirige vers reserver.html sans paramètre
      if (pendingRoom === 'general') {
        window.location.href = "reserver.html";
      } else {
        window.location.href = "reserver.html?room=" + pendingRoom;
      }
      sessionStorage.removeItem('pendingRoom'); // nettoyage
    } else {
      window.location.href = r.redirect;
    }
  }, 800);
}
    })
    .catch(() => {
      showMsg("❌ Erreur de connexion au serveur.", "error");
    });
}

// Allow Enter key on login fields
document.addEventListener("DOMContentLoaded", () => {
  ["username", "password"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") login();
      });
    }
  });
});

/* ============ REGISTER — STEP 1 ============ */
function goStep2() {
  let ok = true;

  // Clear all errors
  ["err_nom", "err_prenom", "err_email", "err_tel", "err_dob"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerText = "";
  });

  const nom = document.getElementById("nom");
  const prenom = document.getElementById("prenom");
  const email = document.getElementById("email");
  const tel = document.getElementById("tel");
  const dob = document.getElementById("dob");

  if (!nom || nom.value.trim() === "") {
    const e = document.getElementById("err_nom");
    if (e) e.innerText = "Nom obligatoire";
    ok = false;
  }

  if (!prenom || prenom.value.trim() === "") {
    const e = document.getElementById("err_prenom");
    if (e) e.innerText = "Prénom obligatoire";
    ok = false;
  }

  if (!email || !email.value.includes("@")) {
    const e = document.getElementById("err_email");
    if (e) e.innerText = "Email invalide";
    ok = false;
  }

  if (!tel || !/^[0-9]{8}$/.test(tel.value)) {
    const e = document.getElementById("err_tel");
    if (e) e.innerText = "Téléphone invalide (8 chiffres)";
    ok = false;
  }

  // Age check
  if (!dob || dob.value === "") {
    const e = document.getElementById("err_dob");
    if (e) e.innerText = "Date obligatoire";
    ok = false;
  } else {
    const today = new Date();
    const birthDate = new Date(dob.value);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;

    if (age < 18) {
      const e = document.getElementById("err_dob");
      if (e) e.innerText = "Vous devez avoir au moins 18 ans";
      ok = false;
    }
  }

  if (!ok) return;

  // Move to step 2
  document.getElementById("step1").style.display = "none";
  document.getElementById("step2").style.display = "block";

  // Update step indicators
  const sd1 = document.getElementById("sd1");
  const sd2 = document.getElementById("sd2");
  if (sd1) { sd1.classList.remove("active"); sd1.classList.add("done"); }
  if (sd2) sd2.classList.add("active");
}

/* ============ REGISTER — BACK TO STEP 1 ============ */
function backStep1(clearErrors = true) {
  document.getElementById("step1").style.display = "block";
  document.getElementById("step2").style.display = "none";

  const sd1 = document.getElementById("sd1");
  const sd2 = document.getElementById("sd2");
  if (sd1) { sd1.classList.add("active"); sd1.classList.remove("done"); }
  if (sd2) sd2.classList.remove("active");

  if (clearErrors) {
    ["err_user", "err_pass"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerText = "";
    });
  }
}

/* ============ REGISTER — FINAL ============ */
function register() {
  const new_username = document.getElementById("new_username");
  const new_password = document.getElementById("new_password");
  const confirm_password = document.getElementById("confirm_password");

  document.getElementById("err_pass").innerText = "";
  document.getElementById("err_user").innerText = "";

  if (!new_username || new_username.value.trim() === "") {
    document.getElementById("err_user").innerText = "Username obligatoire";
    return;
  }

  if (!new_password || new_password.value.length < 4) {
    document.getElementById("err_pass").innerText = "Mot de passe trop court (min 4 caractères)";
    return;
  }

  if (!confirm_password || new_password.value !== confirm_password.value) {
    document.getElementById("err_pass").innerText = "Mots de passe différents";
    return;
  }

  const genre = document.querySelector('input[name="genre"]:checked');

  const nom = document.getElementById("nom");
  const prenom = document.getElementById("prenom");
  const email = document.getElementById("email");
  const tel = document.getElementById("tel");
  const dob = document.getElementById("dob");
  const pays = document.getElementById("pays");

  const data = new FormData();
  data.append("register", true);
  data.append("nom", nom ? nom.value : "");
  data.append("prenom", prenom ? prenom.value : "");
  data.append("email", email ? email.value : "");
  data.append("tel", tel ? tel.value : "");
  data.append("genre", genre ? genre.value : "");
  data.append("dob", dob ? dob.value : "");
  data.append("pays", pays ? pays.value : "");
  data.append("username", new_username.value.trim());
  data.append("password", new_password.value);

  fetch("login.php", { method: "POST", body: data })
    .then((r) => r.json())
    .then((r) => {
      showMsg(r.message, r.status);
      if (r.status === "success") {
        setTimeout(() => {
          switchTab("login");
          showMsg("✅ Compte créé ! Connectez-vous maintenant.", "success");
        }, 1200);
      }
    })
    .catch(() => {
      showMsg("❌ Erreur de connexion au serveur.", "error");
    });
}

/* ============ COUNTRIES ============ */
function loadCountries() {
  const countries = [
    "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia",
    "Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium",
    "Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria",
    "Burkina Faso","Burundi","Cambodia","Cameroon","Canada","Cape Verde","Central African Republic","Chad",
    "Chile","China","Colombia","Comoros","Congo","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic",
    "Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea",
    "Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany",
    "Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hungary",
    "Iceland","India","Indonesia","Iran","Iraq","Ireland","Italy","Ivory Coast","Jamaica","Japan","Jordan",
    "Kazakhstan","Kenya","Kiribati","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia",
    "Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali",
    "Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia",
    "Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand",
    "Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau",
    "Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar",
    "Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines",
    "Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles",
    "Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa",
    "South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria",
    "Taiwan","Tajikistan","Tanzania","Thailand","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey",
    "Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States",
    "Uruguay","Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"
  ];

  countries.sort();

  const select = document.getElementById("pays");
  if (!select) return;

  select.innerHTML = '<option value="">-- Choisir un pays --</option>';
  countries.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
}

/* ============ RESET FORMS ============ */
function resetForms() {
  // Login
  ["username", "password"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // Register step 1
  ["nom", "prenom", "email", "tel", "dob"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["err_nom", "err_prenom", "err_email", "err_tel", "err_dob"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerText = "";
  });

  // Register step 2
  ["new_username", "new_password", "confirm_password"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["err_user", "err_pass"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerText = "";
  });

  const genre = document.querySelector('input[name="genre"]:checked');
  if (genre) genre.checked = false;

  const pays = document.getElementById("pays");
  if (pays) pays.value = "";

  // Reset step display
  backStep1(false);
}