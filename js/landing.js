// landing.js
// Logika landing page rooftop.ardiancandra.com: login Firebase + tombol
// ajakan (CTA) yang mengarah ke halaman perhitungan (app.html).
//
// Alur: pengunjung membaca landing, klik CTA -> kalau belum login, modal
// login terbuka; begitu login berhasil, browser pindah ke app.html.
// Kalau sudah login, CTA langsung membuka app.html. Sesi login tersimpan
// per origin, jadi app.html langsung mengenali pengguna yang sama.
// Blok auth di sini disengaja mirip dengan yang di main.js (id elemen,
// kunci i18n, dan perilaku pill kuota sama), supaya kedua halaman konsisten.

const API_URL = 'https://rooftop-api-451921864170.asia-southeast2.run.app';
let authUser = null;      // firebase.User | null
let authIdToken = null;   // string | null
let authQuota = null;     // {used, total, plan, exempt} | null
const authConfigured = (typeof FIREBASE_CONFIG !== 'undefined'
  && FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith('PASTE-'));

function authHeaders() {
  return authIdToken ? { 'Authorization': 'Bearer ' + authIdToken } : {};
}

function updateAuthUI() {
  const btn = document.getElementById('auth-btn');
  const chip = document.getElementById('auth-user');
  const label = document.getElementById('auth-user-label');
  const quotaEl = document.getElementById('auth-quota');
  const pill = document.getElementById('auth-quota-pill');
  if (!btn || !chip) return;
  if (authUser) {
    btn.classList.add('hidden');
    chip.classList.remove('hidden');
    chip.classList.add('flex');
    if (label) label.textContent = authUser.email || authUser.displayName || '';
    if (quotaEl) {
      if (authQuota) {
        if (authQuota.exempt) {
          quotaEl.textContent = I18n.t('authQuotaExempt');
          if (pill) {
            pill.classList.remove('hidden');
            pill.classList.add('flex');
            pill.style.background = '#F5E214';
            pill.style.color = '#0f172a';
          }
        } else {
          const left = Math.max(0, authQuota.total - authQuota.used);
          quotaEl.textContent = I18n.t('authQuotaLeft', { v: left, t: authQuota.total });
          if (pill) {
            pill.classList.remove('hidden');
            pill.classList.add('flex');
            // Warna pill mengikuti sisa kuota: kuning saat masih banyak,
            // oranye saat tinggal 1, merah saat habis.
            pill.style.background = left === 0 ? '#BB1326' : left === 1 ? '#D97706' : '#F5E214';
            pill.style.color = left <= 1 ? '#ffffff' : '#0f172a';
          }
        }
      } else {
        quotaEl.textContent = '';
        if (pill) { pill.classList.add('hidden'); pill.classList.remove('flex'); }
      }
    }
  } else {
    btn.classList.remove('hidden');
    chip.classList.add('hidden');
    chip.classList.remove('flex');
  }
  // Teks CTA mengikuti status login (teks dikelola JS, bukan data-i18n).
  document.querySelectorAll('.js-cta-main').forEach((el) => {
    el.textContent = I18n.t(authUser ? 'landCtaGo' : 'landCtaStart');
  });
}

function openAuthModal(noteKey) {
  const modal = document.getElementById('auth-modal');
  const note = document.getElementById('auth-modal-note');
  const notCfg = document.getElementById('auth-not-configured');
  const form = document.getElementById('auth-form');
  const err = document.getElementById('auth-error');
  if (!modal) return;
  if (err) { err.textContent = ''; err.classList.add('hidden'); }
  if (note) {
    if (noteKey) { note.textContent = I18n.t(noteKey); note.classList.remove('hidden'); }
    else note.classList.add('hidden');
  }
  const ready = authConfigured && typeof firebase !== 'undefined';
  if (notCfg) notCfg.classList.toggle('hidden', ready);
  if (form) form.classList.toggle('hidden', !ready);
  modal.classList.remove('hidden');
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('hidden');
}

function authErrorMessage(code) {
  const map = {
    'auth/invalid-email': 'authErrInvalidEmail',
    'auth/user-not-found': 'authErrWrongCreds',
    'auth/wrong-password': 'authErrWrongCreds',
    'auth/invalid-credential': 'authErrWrongCreds',
    'auth/email-already-in-use': 'authErrInUse',
    'auth/weak-password': 'authErrWeakPw',
    'auth/popup-closed-by-user': 'authErrPopupClosed',
    'auth/popup-blocked': 'authErrPopupBlocked',
    'auth/unauthorized-domain': 'authErrUnauthorizedDomain',
    'auth/operation-not-allowed': 'authErrNotAllowed',
    'auth/network-request-failed': 'authErrNetwork'
  };
  return I18n.t(map[code] || 'authErrorGeneric');
}

function setAuthBusy(busy) {
  ['auth-signin', 'auth-register', 'auth-google'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = busy;
  });
}

async function refreshQuota() {
  if (!authIdToken) return;
  try {
    const res = await fetch(API_URL + '/me', { headers: authHeaders() });
    if (res.ok) {
      const me = await res.json();
      if (me.auth_enabled) authQuota = { used: me.quota_used, total: me.quota_total, plan: me.plan, exempt: !!me.exempt };
    }
  } catch (e) { /* tampilan kuota bersifat best-effort */ }
}

async function doEmailAuth(isRegister) {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const err = document.getElementById('auth-error');
  const showErr = (msg) => { if (err) { err.textContent = msg; err.classList.remove('hidden'); } };
  if (!email || !password) { showErr(I18n.t('authErrorGeneric')); return; }
  setAuthBusy(true);
  try {
    if (isRegister) await firebase.auth().createUserWithEmailAndPassword(email, password);
    else await firebase.auth().signInWithEmailAndPassword(email, password);
    closeAuthModal();
    window.location.href = 'app.html';
  } catch (e) {
    showErr(authErrorMessage(e.code));
  } finally {
    setAuthBusy(false);
  }
}

async function doGoogleAuth() {
  const err = document.getElementById('auth-error');
  setAuthBusy(true);
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebase.auth().signInWithPopup(provider);
    closeAuthModal();
    window.location.href = 'app.html';
  } catch (e) {
    if (err) { err.textContent = authErrorMessage(e.code); err.classList.remove('hidden'); }
  } finally {
    setAuthBusy(false);
  }
}

function onCtaClick() {
  if (authUser) window.location.href = 'app.html';
  else openAuthModal('authNeedLogin');
}

function initAuth() {
  const btn = document.getElementById('auth-btn');
  if (btn) btn.addEventListener('click', () => openAuthModal(null));
  const closeBtn = document.getElementById('auth-close');
  if (closeBtn) closeBtn.addEventListener('click', closeAuthModal);
  const modal = document.getElementById('auth-modal');
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeAuthModal(); });
  const logoutBtn = document.getElementById('auth-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    try { await firebase.auth().signOut(); } catch (e) { /* abaikan */ }
  });
  const signinBtn = document.getElementById('auth-signin');
  if (signinBtn) signinBtn.addEventListener('click', () => doEmailAuth(false));
  const registerBtn = document.getElementById('auth-register');
  if (registerBtn) registerBtn.addEventListener('click', () => doEmailAuth(true));
  const googleBtn = document.getElementById('auth-google');
  if (googleBtn) googleBtn.addEventListener('click', doGoogleAuth);
  document.querySelectorAll('.js-cta-main').forEach((el) => {
    el.addEventListener('click', onCtaClick);
  });
  if (!authConfigured || typeof firebase === 'undefined') return;
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
  } catch (e) { /* sudah diinisialisasi */ }
  firebase.auth().onAuthStateChanged(async (user) => {
    authUser = user;
    if (user) {
      try { authIdToken = await user.getIdToken(); } catch (e) { authIdToken = null; }
      await refreshQuota();
    } else {
      authIdToken = null;
      authQuota = null;
    }
    updateAuthUI();
  });
}

function initLanding() {
  I18n.init();
  const langBtn = document.getElementById('language-toggle');
  if (langBtn) langBtn.addEventListener('click', () => {
    I18n.setLanguage(I18n.lang === 'id' ? 'en' : 'id');
    updateAuthUI(); // segarkan teks CTA (dikelola JS, bukan data-i18n)
  });
  initAuth();
  updateAuthUI();
}

document.addEventListener('DOMContentLoaded', initLanding);
