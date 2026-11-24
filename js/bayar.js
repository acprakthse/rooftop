// bayar.js
// Logika halaman pembayaran (/bayar/): ringkasan pesanan + Midtrans Snap.
// SEMENTARA (sampai website launching): kanal pembayaran ditutup.
// Halaman ini menampilkan popup pembangunan saat dibuka dengan paket
// valid, dan tombol Bayar hanya membuka popup itu; Snap.js tidak
// dimuat. Untuk membuka kembali: hapus guard di startPayment, panggil
// loadSnapJs() lagi di initBayar, dan hapus pemanggilan
// openPaySoonModal() saat init.
// Paket dibaca dari ?paket= (satuan/pack5/pack10). Harga di sini HANYA
// untuk tampilan; harga yang ditagihkan selalu dari katalog backend.
// Alur: klik Bayar -> POST /payment/create (dapat Snap token) ->
// snap.pay(token) -> onSuccess memanggil POST /payment/confirm (fallback
// bila webhook telat), onPending memberi tahu pengguna menyelesaikan
// pembayaran, onError/onClose memberi tahu untuk mencoba lagi.
// Blok auth disengaja mirip dengan landing.js (id elemen, kunci i18n,
// dan perilaku pill kuota sama), supaya halaman-halaman konsisten.

const API_URL = 'https://rooftop-api-451921864170.asia-southeast2.run.app';
// Tampilan saja; backend yang menentukan harga sebenarnya.
const PACKAGES = {
  satuan: { nameKey: 'pktSingleName', sims: 1, price: 10000 },
  pack5: { nameKey: 'pktPack5Name', sims: 5, price: 50000 },
  pack10: { nameKey: 'pktPack10Name', sims: 10, price: 75000 }
};
// Biaya pembayaran per metode (tampilan saja; backend yang menentukan
// total yang ditagihkan). QRIS gratis, VA flat Rp 4.500, GoPay 2%.
const PAYMENT_FEES = {
  qris: { kind: 'flat', value: 0 },
  va: { kind: 'flat', value: 4500 },
  gopay: { kind: 'percent', value: 0.02 }
};
function paymentFee(method, price) {
  const f = PAYMENT_FEES[method] || PAYMENT_FEES.qris;
  return f.kind === 'percent' ? Math.round(price * f.value) : f.value;
}
function feeLabel(method, price) {
  const fee = paymentFee(method, price);
  if (fee === 0) return I18n.t('bayFeeFree');
  return '+' + fmtRp(fee) + (PAYMENT_FEES[method].kind === 'percent' ? ' (2%)' : '');
}
let authUser = null;      // firebase.User | null
let authIdToken = null;   // string | null
let authQuota = null;     // {used, total, plan, exempt} | null
let selectedPackage = null;
let selectedMethod = 'qris'; // qris | va | gopay
let snapReady = false;
const authConfigured = (typeof FIREBASE_CONFIG !== 'undefined'
  && FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith('PASTE-'));

function authHeaders() {
  return authIdToken ? { 'Authorization': 'Bearer ' + authIdToken } : {};
}

function midtransConfigured() {
  return (typeof MidtransConfig !== 'undefined'
    && MidtransConfig.clientKey && !MidtransConfig.clientKey.startsWith('PASTE-'));
}

function fmtRp(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
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
  renderOrder();
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

// Popup kanal pembayaran masih dalam pembangunan (sementara,
// sampai website launching).
function openPaySoonModal() {
  const modal = document.getElementById('pay-soon-modal');
  if (modal) modal.classList.remove('hidden');
}

function closePaySoonModal() {
  const modal = document.getElementById('pay-soon-modal');
  if (modal) modal.classList.add('hidden');
}

function initPaySoonModal() {
  const x = document.getElementById('pay-soon-close-x');
  if (x) x.addEventListener('click', closePaySoonModal);
  const btn = document.getElementById('pay-soon-close');
  if (btn) btn.addEventListener('click', closePaySoonModal);
  const modal = document.getElementById('pay-soon-modal');
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closePaySoonModal(); });
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
  } catch (e) {
    if (err) { err.textContent = authErrorMessage(e.code); err.classList.remove('hidden'); }
  } finally {
    setAuthBusy(false);
  }
}

// ---- Ringkasan pesanan ----

function renderOrder() {
  if (!selectedPackage) return;
  const pkg = PACKAGES[selectedPackage];
  const nameEl = document.getElementById('bay-package-name');
  if (nameEl) nameEl.textContent = I18n.t(pkg.nameKey);
  const simsEl = document.getElementById('bay-package-sims');
  if (simsEl) simsEl.textContent = String(pkg.sims);
  const priceEl = document.getElementById('bay-package-price');
  if (priceEl) priceEl.textContent = fmtRp(pkg.price);
  const fee = paymentFee(selectedMethod, pkg.price);
  const feeEl = document.getElementById('bay-fee');
  if (feeEl) feeEl.textContent = fee === 0 ? I18n.t('bayFeeFree') : fmtRp(fee);
  const totalEl = document.getElementById('bay-total');
  if (totalEl) totalEl.textContent = fmtRp(pkg.price + fee);
  ['qris', 'va', 'gopay'].forEach((m) => {
    const el = document.getElementById('bay-fee-' + m);
    if (el) el.textContent = feeLabel(m, pkg.price);
  });
  const emailEl = document.getElementById('bay-email');
  if (emailEl) emailEl.textContent = authUser ? (authUser.email || authUser.displayName || '-') : '-';
  const quotaEl = document.getElementById('bay-quota');
  if (quotaEl) {
    if (!authUser) quotaEl.textContent = '-';
    else if (authQuota && authQuota.exempt) quotaEl.textContent = I18n.t('authQuotaExempt');
    else if (authQuota) quotaEl.textContent = I18n.t('authQuotaLeft', { v: Math.max(0, authQuota.total - authQuota.used), t: authQuota.total });
    else quotaEl.textContent = '-';
  }
}

function setPayStatus(msg) {
  const el = document.getElementById('bay-status');
  if (el) el.textContent = msg || '';
}

function setPayBusy(busy) {
  const btn = document.getElementById('bay-pay');
  if (btn) btn.disabled = busy;
}

// ---- Pilihan metode pembayaran ----

function selectMethod(method) {
  selectedMethod = method;
  renderOrder();
  document.querySelectorAll('.js-bay-method').forEach((el) => {
    const on = el.getAttribute('data-method') === method;
    el.setAttribute('aria-checked', on ? 'true' : 'false');
    el.classList.toggle('border-brand', on);
    el.classList.toggle('bg-brand/5', on);
    el.classList.toggle('border-slate-200', !on);
  });
}

function initMethodPicker() {
  document.querySelectorAll('.js-bay-method').forEach((el) => {
    el.addEventListener('click', () => selectMethod(el.getAttribute('data-method')));
  });
}

// ---- Midtrans Snap ----

function loadSnapJs() {
  if (!midtransConfigured()) {
    const note = document.getElementById('bay-not-configured');
    if (note) note.classList.remove('hidden');
    setPayBusy(true);
    return;
  }
  const base = MidtransConfig.isProduction
    ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
  const script = document.createElement('script');
  script.src = base + '/snap/snap.js';
  script.setAttribute('data-client-key', MidtransConfig.clientKey);
  script.onload = () => { snapReady = true; };
  script.onerror = () => { setPayStatus(I18n.t('bayError')); };
  document.head.appendChild(script);
}

async function confirmPayment(orderId) {
  setPayStatus(I18n.t('bayConfirming'));
  try {
    const res = await fetch(API_URL + '/payment/confirm', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ order_id: orderId })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.status === 'paid') {
      const pkg = PACKAGES[selectedPackage];
      await refreshQuota();
      setPayStatus(I18n.t('baySuccess', { n: pkg.sims })
        + (authQuota && !authQuota.exempt
          ? ' ' + I18n.t('bayQuotaAfter', { left: Math.max(0, authQuota.total - authQuota.used), total: authQuota.total })
          : ''));
      const toApp = document.getElementById('bay-to-app');
      if (toApp) { toApp.classList.remove('hidden'); toApp.classList.add('inline-block'); }
      updateAuthUI();
      return;
    }
    if (res.ok) { setPayStatus(I18n.t('bayPending')); return; }
    setPayStatus(data.detail || I18n.t('bayError'));
  } catch (e) {
    setPayStatus(I18n.t('bayError'));
  }
}

async function startPayment() {
  // SEMENTARA: pembayaran belum dibuka, tampilkan popup. Isi fungsi di
  // bawah ini tidak berjalan sampai guard ini dihapus saat launching.
  openPaySoonModal();
  return;
  if (!selectedPackage) return;
  if (!authUser) { openAuthModal('bayNeedLogin'); return; }
  if (!snapReady || typeof window.snap === 'undefined') {
    setPayStatus(I18n.t('bayError'));
    return;
  }
  setPayBusy(true);
  setPayStatus(I18n.t('bayPaying'));
  try {
    const res = await fetch(API_URL + '/payment/create', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ package: selectedPackage, payment_method: selectedMethod })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) { openAuthModal('authSessionExpired'); setPayStatus(''); }
      else setPayStatus(data.detail || I18n.t('bayError'));
      return;
    }
    window.snap.pay(data.snap_token, {
      onSuccess: function () { confirmPayment(data.order_id); },
      onPending: function () { setPayStatus(I18n.t('bayPending')); },
      onError: function () { setPayStatus(I18n.t('bayError')); },
      onClose: function () { setPayStatus(I18n.t('bayError')); }
    });
  } catch (e) {
    setPayStatus(I18n.t('bayError'));
  } finally {
    setPayBusy(false);
  }
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
    window.location.href = '/';
  });
  const signinBtn = document.getElementById('auth-signin');
  if (signinBtn) signinBtn.addEventListener('click', () => doEmailAuth(false));
  const registerBtn = document.getElementById('auth-register');
  if (registerBtn) registerBtn.addEventListener('click', () => doEmailAuth(true));
  const googleBtn = document.getElementById('auth-google');
  if (googleBtn) googleBtn.addEventListener('click', doGoogleAuth);
  const payBtn = document.getElementById('bay-pay');
  if (payBtn) payBtn.addEventListener('click', startPayment);
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

function initBayar() {
  I18n.init();
  const params = new URLSearchParams(window.location.search);
  const pkg = params.get('paket');
  if (!pkg || !PACKAGES[pkg]) {
    selectedPackage = null;
    const invalid = document.getElementById('bay-invalid');
    const order = document.getElementById('bay-order');
    if (invalid) invalid.classList.remove('hidden');
    if (order) order.classList.add('hidden');
  } else {
    selectedPackage = pkg;
  }
  const langBtn = document.getElementById('language-toggle');
  if (langBtn) langBtn.addEventListener('click', () => {
    I18n.setLanguage(I18n.lang === 'id' ? 'en' : 'id');
    updateAuthUI(); // renderOrder dipanggil dari updateAuthUI
  });
  initAuth();
  initMethodPicker();
  initPaySoonModal();
  updateAuthUI();
  if (selectedPackage) {
    // SEMENTARA: pembayaran belum dibuka; Snap.js tidak dimuat dan
    // popup pembangunan tampil saat halaman dibuka.
    openPaySoonModal();
  }
}

document.addEventListener('DOMContentLoaded', initBayar);
