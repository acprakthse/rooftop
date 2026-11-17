/**
 * main.js
 * Application Controller connecting UI Inputs, 3D WebGL Scene, and KPI Dashboard
 */

const AppState = {
  roofType: 'gable-dual',
  orientation: 180,
  roofLength: 24,
  roofWidth: 14,
  roofTilt: 18,
  wallHeight: 6.0,
  roofSetback: 0.8,
  panelOrientation: 'portrait',
  panelWp: 610,
  customModule: null, // uploaded PV module spec {name, wp, length, width, ...} or null
  rowGap: 0.35,
  rackTilt: 12,
  bessChemistry: 'LFP',
  siteLocation: 'jakarta',
  bessKwh: 120,
  bessKw: 60,
  sunHour: 10.5,
  currency: 'IDR'
};

// 8-point compass names, in azimuth order (0 = North, clockwise).
const COMPASS_KEYS = ['dirN', 'dirNE', 'dirE', 'dirSE', 'dirS', 'dirSW', 'dirW', 'dirNW'];

function formatCompass(deg) {
  const idx = Math.round(deg / 45) % 8;
  return I18n.t('compassVal', { deg, dir: I18n.t(COMPASS_KEYS[idx]) });
}

function formatCurrency(metrics) {
  if (AppState.currency === 'IDR') {
    const juta = metrics.savingsIdr / 1e6;
    return I18n.t('savingsIdr', { v: juta.toFixed(1) });
  } else {
    const amount = Math.round(metrics.savingsEur).toLocaleString(I18n.lang === 'id' ? 'id-ID' : 'en-US');
    return I18n.t('savingsEur', { v: amount });
  }
}

// ---- Roof-shape shading state ----
// The shading result belongs to one exact roof geometry. Any geometry
// change (roof size, tilt, orientation, obstacles, location) invalidates
// it, so the KPIs never silently use a stale shading factor.
let shadingResult = null;
let shadingFingerprint = '';
let shadingRunning = false;
let lastMetrics = null;

// ---- Detailed PySAM simulation state ----
// The PySAM result belongs to one exact request payload (slopes,
// shading, BESS, load, location). Any input change marks it stale.
const PYSAM_API_URL = 'https://rooftop-api-451921864170.asia-southeast2.run.app';
let pysamResult = null;
let pysamFingerprint = '';
let pysamRunning = false;
let pysamQuickMwh = null; // quick-estimate yield at run time, for comparison

// ---- Interactive dispatch chart state ----
// simDay: the typical_day being drawn (null = empty state). hidden:
// series the user toggled off via the legend. hoverHour: hour under
// the mouse (crosshair + tooltip). geom: plot geometry from the last draw.
const dispatchChart = { simDay: null, hidden: {}, hoverHour: null, geom: null };

// ---- Login (Firebase Auth) + kuota simulasi ----
// authConfigured: false selama FIREBASE_CONFIG masih placeholder (login
// belum disiapkan di console) -> simulasi tetap terbuka seperti dulu.
// Bila Firebase terisi: simulasi detail mewajibkan login; backend
// menegakkan kuota (gratis 5 simulasi per akun; field plan + quota
// di Firestore dipersiapkan untuk fitur berbayar).
let authUser = null;      // firebase.User | null
let authIdToken = null;   // string | null
let authQuota = null;     // {used, total, plan} | null
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
    const res = await fetch(PYSAM_API_URL + '/me', { headers: authHeaders() });
    if (res.ok) {
      const me = await res.json();
      if (me.auth_enabled) authQuota = { used: me.quota_used, total: me.quota_total, plan: me.plan };
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

// ---- User-supplied input data (uploads + manual load) ----
// Load profile: auto (annual load derived from kWp, commercial shape),
// manual (annual kWh + shape preset), or csv (uploaded 8760 hourly kW).
let loadInput = { mode: 'auto', annualKwh: null, shape: 'commercial', csv: null, error: null };
// Weather: tmy (built-in TMYx per location) or epw (uploaded .epw file).
// prevLocation remembers the TMYx location the EPW replaced, so the API
// still gets a valid location code alongside the uploaded file.
let weatherInput = { mode: 'tmy', prevLocation: null, epw: null, error: null };
// Custom BESS from an uploaded CSV spec (null = built-in chemistry).
let customBess = null;

const MONTH_NAMES = {
  id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
};

function geometryFingerprint() {
  return JSON.stringify([
    AppState.roofType, AppState.orientation, AppState.roofLength,
    AppState.roofWidth, AppState.roofTilt, AppState.wallHeight,
    AppState.roofSetback, AppState.panelOrientation, AppState.rowGap,
    AppState.rackTilt, AppState.bessKwh, AppState.siteLocation,
    AppState.customModule,
    [...Scene3D.disabledSlots].sort()
  ]);
}

function slopeLabel(side) {
  if (side === 'S') return I18n.t('dirS');
  if (side === 'N') return I18n.t('dirN');
  if (side === 'E') return I18n.t('dirE');
  if (side === 'W') return I18n.t('dirW');
  if (side === 'FLAT') return I18n.t('slopeFlat');
  return side; // SHED and anything else keep their code
}

function renderShadingUI() {
  const statusEl = document.getElementById('shading-status');
  const resultsEl = document.getElementById('shading-results');
  if (!statusEl || !resultsEl) return;

  if (shadingRunning) {
    resultsEl.classList.add('hidden');
    return; // status line is driven by the progress callback
  }
  if (!shadingResult) {
    statusEl.textContent = I18n.t('shadingNotRun');
    resultsEl.classList.add('hidden');
    return;
  }

  statusEl.textContent = '';
  resultsEl.classList.remove('hidden');
  document.getElementById('shading-annual').textContent = shadingResult.annualLossPercent.toFixed(1);
  document.getElementById('shading-modules').textContent = I18n.t('shadingModules', {
    n: shadingResult.moduleCount, m: shadingResult.samplePoints
  });
  document.getElementById('shading-split').textContent = I18n.t('shadingSplit', {
    b: shadingResult.beamLossPercent.toFixed(1),
    d: shadingResult.diffuseLossPercent.toFixed(1),
    f: Math.round(shadingResult.diffuseFraction * 100)
  });
  if (lastMetrics) {
    const shaded = lastMetrics.annualMwh;
    const unshaded = shadingResult.annualLossPercent > 0
      ? shaded / (1 - shadingResult.annualLossPercent / 100)
      : shaded;
    document.getElementById('shading-corrected').textContent = I18n.t('shadingCorrected', {
      v: shaded.toFixed(1), u: unshaded.toFixed(1)
    });
  }

  const slopesEl = document.getElementById('shading-slopes');
  slopesEl.innerHTML = '';
  for (const side of Object.keys(shadingResult.perSlope).sort()) {
    const s = shadingResult.perSlope[side];
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 text-xs font-sans';
    const barW = Math.min(100, s.lossPercent * 5); // 20% loss fills the bar
    row.innerHTML =
      '<span class="w-16 shrink-0 text-slate-600"></span>' +
      '<span class="flex-1 h-2.5 rounded bg-slate-100 overflow-hidden"><span class="block h-full bg-[#D97706] rounded" style="width:' + barW.toFixed(1) + '%"></span></span>' +
      '<span class="w-14 shrink-0 text-right text-slate-700 tabular-nums"></span>';
    row.children[0].textContent = slopeLabel(side) + ' · ' + s.modules;
    row.children[2].textContent = s.lossPercent.toFixed(1) + '%';
    slopesEl.appendChild(row);
  }

  const monthsEl = document.getElementById('shading-months');
  const labelsEl = document.getElementById('shading-month-labels');
  monthsEl.innerHTML = '';
  labelsEl.innerHTML = '';
  const names = MONTH_NAMES[I18n.lang] || MONTH_NAMES.en;
  shadingResult.monthlyLossPercent.forEach((loss, i) => {
    const bar = document.createElement('div');
    bar.className = 'flex-1 rounded-t bg-[#12579B] min-h-[2px]';
    bar.style.height = Math.min(100, loss * 10) + '%'; // 10% loss fills the height
    bar.title = names[i] + ': ' + loss.toFixed(1) + '%';
    monthsEl.appendChild(bar);
    const lab = document.createElement('div');
    lab.className = 'flex-1 text-center text-[10px] font-sans text-slate-400';
    lab.textContent = names[i];
    labelsEl.appendChild(lab);
  });
}

async function runShadingAnalysis(onProgress) {
  if (shadingRunning) return;
  const statusEl = document.getElementById('shading-status');
  shadingRunning = true;
  renderShadingUI();
  updateAll(); // make sure the scene matches the current inputs
  const fingerprintAtStart = geometryFingerprint();

  try {
    const result = await ShadingAnalyzer.analyze(AppState, Scene3D, (frac) => {
      if (statusEl) statusEl.textContent = I18n.t('shadingRunning', { v: Math.round(frac * 100) });
      if (onProgress) onProgress(frac);
    });
    if (!result) {
      if (statusEl) statusEl.textContent = I18n.t('shadingNoModules');
      return;
    }
    // Accept only if the geometry did not change mid-run.
    if (geometryFingerprint() !== fingerprintAtStart) {
      if (statusEl) statusEl.textContent = I18n.t('shadingStale');
      return;
    }
    shadingResult = result;
    shadingFingerprint = fingerprintAtStart;
  } finally {
    shadingRunning = false;
    updateAll(); // refresh KPIs with the new shading factor + render results
  }
}

// ---- Detailed PySAM simulation (per-slope, via Cloud Run) ----

// Azimuth each slope faces in the scene's default pose (orientation
// 180), PVWatts convention: 0 = North, 90 = East, 180 = South,
// 270 = West. The building rotation (rootGroup.rotation.y =
// 180 - orientation) shifts every slope by (orientation - 180), so
// the true azimuth is the default plus that shift, mod 360.
const SLOPE_DEFAULT_AZIMUTH = { S: 180, N: 0, E: 90, W: 270, SHED: 180, FLAT: 180 };
const SLOPE_ORDER = ['S', 'N', 'E', 'W', 'SHED', 'FLAT'];

function slopePanelCounts() {
  // Same collection rule as ShadingAnalyzer._collectModules: holder
  // groups are active modules; obstacle cylinders are meshes, not groups.
  const counts = {};
  for (const holder of Scene3D.panelMeshes) {
    if (!holder.isGroup) continue;
    const side = ((holder.userData && holder.userData.slotKey) || '').split('-')[0];
    if (!side) continue;
    counts[side] = (counts[side] || 0) + 1;
  }
  return counts;
}

// Build the POST /simulate payload from the live 3D scene: one slope
// entry per slope with active modules (kWp from the module count, tilt
// and true azimuth from the roof geometry + building orientation, and
// the raycast shading loss when measured, else 0).
function buildPysamPayload() {
  const counts = slopePanelCounts();
  const slopes = [];
  for (const side of SLOPE_ORDER) {
    const n = counts[side] || 0;
    if (n === 0) continue;
    const tilt = side === 'FLAT' ? AppState.rackTilt : AppState.roofTilt;
    const azimuth = (((SLOPE_DEFAULT_AZIMUTH[side] + AppState.orientation - 180) % 360) + 360) % 360;
    const shading = shadingResult && shadingResult.perSlope[side]
      ? shadingResult.perSlope[side].lossPercent
      : 0;
    slopes.push({
      name: side,
      pv_kwp: (n * AppState.panelWp) / 1000,
      tilt_deg: tilt,
      azimuth_deg: azimuth,
      shading_percent: Math.round(shading * 100) / 100
    });
  }
  const annualLoadKwh = effectiveAnnualLoadKwh();
  const payload = {
    location: weatherInput.mode === 'epw' && weatherInput.epw
      ? weatherInput.prevLocation
      : AppState.siteLocation,
    slopes,
    bess_power_kw: AppState.bessKw,
    bess_capacity_kwh: AppState.bessKwh,
    annual_load_kwh: Math.round(annualLoadKwh),
    include_economics: true
  };
  // Manual load: the API builds the 8760h profile from annual kWh + shape.
  if (loadInput.mode === 'manual') payload.load_profile_type = loadInput.shape;
  // Uploaded load profile: the full 8760 hourly values go to the API.
  if (loadInput.mode === 'csv' && loadInput.csv) payload.load_profile_kw = loadInput.csv.hours;
  // Custom BESS: efficiency + SoC window from the uploaded spec. DoD maps
  // to a SoC window of [100-DoD, 100], e.g. DoD 90% -> SoC 10-100%.
  if (customBess) {
    payload.batt_eff_charge_percent = customBess.rte * 100;
    payload.batt_eff_discharge_percent = customBess.rte * 100;
    payload.soc_min_percent = Math.round((1 - customBess.dod) * 100);
    payload.soc_max_percent = 100;
  }
  // The EPW file itself travels as multipart; its name rides along so the
  // fingerprint (and the API log) still identifies the weather used.
  if (weatherInput.mode === 'epw' && weatherInput.epw) payload.epw_name = weatherInput.epw.name;
  return payload;
}

async function runPysamSimulation() {
  if (pysamRunning) return;
  // Bila login sudah disiapkan, simulasi detail mewajibkan login (kuota
  // dihitung per akun). Bila belum disiapkan, simulasi tetap terbuka.
  if (authConfigured && !authUser) {
    openAuthModal('authNeedLogin');
    return;
  }
  const statusEl = document.getElementById('pysam-status');
  const runBtn = document.getElementById('run-pysam');
  pysamRunning = true;
  renderPysamUI();
  updateAll(); // fresh scene + metrics before building the payload

  try {
    if (AppState.bessKwh <= 0) {
      if (statusEl) statusEl.textContent = I18n.t('pysamNoBess');
      return;
    }
    const counts = slopePanelCounts();
    const totalModules = Object.values(counts).reduce((a, b) => a + b, 0);
    if (totalModules === 0) {
      if (statusEl) statusEl.textContent = I18n.t('pysamNoModules');
      return;
    }

    // Shading feeds the per-slope losses: compute it first when missing
    // (updateAll already cleared a stale result).
    if (!shadingResult) {
      if (statusEl) statusEl.textContent = I18n.t('pysamRunningShading', { v: 0 });
      await runShadingAnalysis((frac) => {
        if (statusEl) statusEl.textContent = I18n.t('pysamRunningShading', { v: Math.round(frac * 100) });
      });
      if (!shadingResult) {
        if (statusEl) statusEl.textContent = I18n.t('shadingNoModules');
        return;
      }
    }

    // CSV load mode needs an uploaded file before simulating.
    if (loadInput.mode === 'csv' && !loadInput.csv) {
      if (statusEl) statusEl.textContent = I18n.t('loadStatusCsvMissing');
      return;
    }

    const payload = buildPysamPayload();
    if (statusEl) statusEl.textContent = I18n.t('pysamRunningApi');
    if (runBtn) runBtn.textContent = I18n.t('pysamRunningApi');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    let response;
    try {
      if (weatherInput.mode === 'epw' && weatherInput.epw) {
        // Uploaded EPW: dedicated multipart endpoint (JSON payload + .epw file).
        const form = new FormData();
        form.append('payload', JSON.stringify(payload));
        form.append('epw', new Blob([weatherInput.epw.text], { type: 'text/plain' }), weatherInput.epw.name);
        response = await fetch(PYSAM_API_URL + '/simulate-epw', {
          method: 'POST',
          headers: authHeaders(),
          body: form,
          signal: controller.signal
        });
      } else {
        response = await fetch(PYSAM_API_URL + '/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      }
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401) {
      authIdToken = null;
      authUser = null;
      updateAuthUI();
      openAuthModal('authSessionExpired');
      throw new Error(I18n.t('authSessionExpired'));
    }
    if (response.status === 402) {
      throw new Error(I18n.t('authQuotaOut'));
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error('HTTP ' + response.status + ' ' + text.slice(0, 120));
    }
    pysamResult = await response.json();
    pysamFingerprint = JSON.stringify(payload);
    pysamQuickMwh = lastMetrics ? lastMetrics.annualMwh : null;
    if (pysamResult.quota) {
      authQuota = { used: pysamResult.quota.used, total: pysamResult.quota.total, plan: pysamResult.quota.plan };
      updateAuthUI();
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = I18n.t('pysamError', { msg: err.message || String(err) });
  } finally {
    pysamRunning = false;
    updateAll(); // refresh everything, including the PySAM results
  }
}

// ---- Unduh laporan (PDF / Excel / Word via backend, CSV dari browser) ----
// PDF/Excel/Word dirender backend dari hasil simulasi yang sudah ada
// (tanpa simulasi ulang, tanpa kuota). CSV dibuat di browser dari
// array hourly (8760 jam) yang ikut dalam respons simulasi.
let reportRunning = false;

function buildReportMeta() {
  const r = pysamResult;
  const roofSel = document.getElementById('roof-type');
  const roofLabel = roofSel && roofSel.selectedIndex >= 0
    ? roofSel.options[roofSel.selectedIndex].textContent.trim() : AppState.roofType;
  const chem = EnergyModel.chemistries[AppState.bessChemistry];
  const meta = {
    location_name: r.inputs.location_name,
    weather_source: r.inputs.weather_source,
    load_label: r.inputs.load_profile,
    roof_type_label: roofLabel,
    roof_length_m: AppState.roofLength,
    roof_width_m: AppState.roofWidth,
    roof_tilt_deg: AppState.roofTilt,
    orientation_deg: AppState.orientation,
    module_label: AppState.customModule
      ? AppState.customModule.name + ' (' + AppState.customModule.wp + ' Wp)'
      : AppState.panelWp + ' Wp',
    bess_label: customBess
      ? customBess.name
      : (chem ? chem.label : AppState.bessChemistry) + ' · ' + AppState.bessKwh + ' kWh / ' + AppState.bessKw + ' kW',
    generated_at_iso: new Date().toISOString()
  };
  if (shadingResult) {
    const perSlope = {};
    Object.keys(shadingResult.perSlope || {}).forEach((side) => {
      perSlope[side] = shadingResult.perSlope[side].lossPercent;
    });
    meta.shading = {
      annual_loss_percent: shadingResult.annualLossPercent,
      beam_loss_percent: shadingResult.beamLossPercent,
      diffuse_loss_percent: shadingResult.diffuseLossPercent,
      monthly_loss_percent: shadingResult.monthlyLossPercent,
      per_slope: perSlope
    };
  }
  return meta;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function setReportBusy(busy) {
  document.querySelectorAll('.report-btn').forEach((b) => { b.disabled = busy; });
}

function downloadHourlyCsv() {
  const statusEl = document.getElementById('report-status');
  const h = pysamResult.hourly;
  if (!h || !h.pv_kw || h.pv_kw.length !== 8760) {
    if (statusEl) statusEl.textContent = I18n.t('reportError');
    return;
  }
  const cols = ['pv_kw', 'load_kw', 'import_kw', 'export_kw', 'battery_kw', 'soc_percent', 'curtailed_kw'];
  const lines = ['hour,' + cols.join(',')];
  for (let i = 0; i < 8760; i++) {
    lines.push(i + ',' + cols.map((c) => h[c][i]).join(','));
  }
  downloadTextFile('profil-per-jam.csv', lines.join('\n'));
  if (statusEl) statusEl.textContent = I18n.t('reportDone');
}

async function downloadReport(format) {
  if (reportRunning) return;
  const statusEl = document.getElementById('report-status');
  if (!pysamIsFresh() || !pysamResult) {
    if (statusEl) statusEl.textContent = I18n.t('reportNeedSim');
    return;
  }
  if (format === 'csv') {
    downloadHourlyCsv();
    return;
  }
  reportRunning = true;
  setReportBusy(true);
  try {
    if (statusEl) statusEl.textContent = I18n.t('reportDownloading');
    const roofImage = (format === 'pdf' || format === 'docx')
      ? (typeof Scene3D !== 'undefined' ? Scene3D.snapshot() : null)
      : null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    let response;
    try {
      response = await fetch(PYSAM_API_URL + '/report-' + format, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          result: pysamResult,
          meta: buildReportMeta(),
          roof_image: roofImage,
          lang: I18n.lang
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401) {
      openAuthModal('authSessionExpired');
      throw new Error(I18n.t('authSessionExpired'));
    }
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const blob = await response.blob();
    const cd = response.headers.get('Content-Disposition') || '';
    const m = /filename="([^"]+)"/.exec(cd);
    downloadBlob(m ? m[1] : 'laporan-simulasi.' + format, blob);
    if (statusEl) statusEl.textContent = I18n.t('reportDone');
  } catch (err) {
    if (statusEl) statusEl.textContent = I18n.t('reportError');
  } finally {
    reportRunning = false;
    setReportBusy(false);
  }
}

function fmtIdrJuta(rp) {
  const juta = rp / 1e6;
  const v = Math.abs(juta) >= 100 ? juta.toFixed(0) : juta.toFixed(1);
  return 'Rp ' + v.replace('.', ',') + ' jt';
}

// ---- User-supplied input data: CSV/EPW parsing, templates, uploads ----

function parseCsv(text) {
  // Minimal CSV parser: comma-separated, optional double-quoted fields.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const splitLine = (line) => {
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') quoted = !quoted;
      else if (c === ',' && !quoted) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out;
  };
  return { header: splitLine(lines[0]).map((h) => h.toLowerCase()), rows: lines.slice(1).map(splitLine) };
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Annual load (kWh/yr) actually in effect: manual input, uploaded CSV
// total, or the automatic value derived from installed kWp.
function effectiveAnnualLoadKwh() {
  if (loadInput.mode === 'manual' && loadInput.annualKwh) return loadInput.annualKwh;
  if (loadInput.mode === 'csv' && loadInput.csv) return loadInput.csv.totalKwh;
  return lastMetrics ? EnergyModel.annualLoadKwh(AppState, lastMetrics) : 0;
}

function renderLoadUI() {
  const statusEl = document.getElementById('load-status');
  const manualEl = document.getElementById('load-manual');
  const csvEl = document.getElementById('load-csv');
  const clearBtn = document.getElementById('load-clear');
  if (manualEl) manualEl.classList.toggle('hidden', loadInput.mode !== 'manual');
  if (csvEl) csvEl.classList.toggle('hidden', loadInput.mode !== 'csv');
  if (clearBtn) clearBtn.classList.toggle('hidden', !loadInput.csv);
  if (!statusEl) return;
  if (loadInput.error) {
    statusEl.textContent = loadInput.error;
    return;
  }
  if (loadInput.mode === 'manual') {
    const shapeKey = { commercial: 'loadShapeCommercial', office: 'loadShapeOffice', residential: 'loadShapeResidential', flat: 'loadShapeFlat' }[loadInput.shape] || 'loadShapeCommercial';
    statusEl.textContent = I18n.t('loadStatusManual', {
      v: (effectiveAnnualLoadKwh() / 1000).toFixed(1),
      shape: I18n.t(shapeKey)
    });
  } else if (loadInput.mode === 'csv') {
    statusEl.textContent = loadInput.csv
      ? I18n.t('loadStatusCsv', { name: loadInput.csv.name, v: (loadInput.csv.totalKwh / 1000).toFixed(1), p: loadInput.csv.peakKw.toFixed(1) })
      : I18n.t('loadStatusCsvMissing');
  } else {
    statusEl.textContent = I18n.t('loadStatusAuto', {
      v: (effectiveAnnualLoadKwh() / 1000).toFixed(1),
      kwp: lastMetrics ? lastMetrics.kwp.toFixed(1) : '0'
    });
  }
}

function renderWeatherUI() {
  const statusEl = document.getElementById('weather-status');
  if (!statusEl) return;
  if (weatherInput.error) {
    statusEl.textContent = weatherInput.error;
    return;
  }
  if (weatherInput.mode === 'epw' && weatherInput.epw) {
    statusEl.textContent = I18n.t('weatherStatusEpw', { name: weatherInput.epw.name });
  } else {
    const loc = EnergyModel.locations[AppState.siteLocation] || EnergyModel.locations.jakarta;
    statusEl.textContent = I18n.t('weatherStatusTmy', { loc: loc.name });
  }
}

// EPW weather file: header LOCATION line + 8760 hourly rows. GHI is field
// 13 and DHI field 15 (0-based) of each data row, in Wh/m2.
function parseEpw(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 9 || !lines[0].startsWith('LOCATION')) {
    throw new Error(I18n.t('epwErrorHeader'));
  }
  const loc = lines[0].split(',');
  const dataRows = lines.slice(8).filter((l) => l.trim().length > 0);
  if (dataRows.length !== 8760) throw new Error(I18n.t('epwErrorRows', { n: dataRows.length }));
  let ghi = 0, dhi = 0;
  for (const row of dataRows) {
    const f = row.split(',');
    ghi += parseFloat(f[13]) || 0;
    dhi += parseFloat(f[15]) || 0;
  }
  const ghiKwh = ghi / 1000;
  const lat = parseFloat(loc[6]);
  const lon = parseFloat(loc[7]);
  return {
    name: (loc[1] || 'EPW').trim() || 'EPW',
    lat: isNaN(lat) ? null : lat,
    lon: isNaN(lon) ? null : lon,
    ghiKwhM2: ghiKwh,
    psh: ghiKwh / 365,
    diffuseFraction: ghi > 0 ? dhi / ghi : null
  };
}

async function onEpwFile(file) {
  const infoEl = document.getElementById('epw-info');
  const clearBtn = document.getElementById('epw-clear');
  try {
    const text = await readFileAsText(file);
    const parsed = parseEpw(text);
    const prevLocation = AppState.siteLocation === 'CUSTOM_EPW' ? weatherInput.prevLocation : AppState.siteLocation;
    const base = EnergyModel.locations[prevLocation] || EnergyModel.locations.jakarta;
    // The quick estimate + shading use this location entry while the EPW
    // is active; tariffs come from the site it replaces.
    EnergyModel.locations.CUSTOM_EPW = {
      name: parsed.name, psh: parsed.psh, lat: parsed.lat != null ? parsed.lat : base.lat,
      gridEf: base.gridEf, tariffIdr: base.tariffIdr, tariffEur: base.tariffEur,
      diffuseFraction: parsed.diffuseFraction != null ? parsed.diffuseFraction : base.diffuseFraction
    };
    weatherInput = { mode: 'epw', prevLocation, epw: { name: file.name, text, ...parsed }, error: null };
    const sel = document.getElementById('site-location');
    let opt = sel.querySelector('option[value="CUSTOM_EPW"]');
    if (!opt) {
      opt = document.createElement('option');
      opt.value = 'CUSTOM_EPW';
      sel.appendChild(opt);
    }
    opt.textContent = 'EPW: ' + parsed.name + ' (PSH ' + parsed.psh.toFixed(1) + 'h)';
    sel.value = 'CUSTOM_EPW';
    AppState.siteLocation = 'CUSTOM_EPW';
    if (clearBtn) clearBtn.classList.remove('hidden');
    if (infoEl) {
      infoEl.classList.remove('hidden');
      infoEl.textContent = I18n.t('epwInfo', {
        loc: parsed.name,
        lat: parsed.lat != null ? parsed.lat.toFixed(2) : '-',
        lon: parsed.lon != null ? parsed.lon.toFixed(2) : '-',
        ghi: parsed.ghiKwhM2.toFixed(0),
        psh: parsed.psh.toFixed(2),
        diff: parsed.diffuseFraction != null ? (parsed.diffuseFraction * 100).toFixed(0) : '-'
      });
    }
    updateAll();
  } catch (err) {
    weatherInput.error = I18n.t('epwError', { msg: err.message });
    renderWeatherUI();
  }
}

function clearEpw() {
  const prev = weatherInput.prevLocation || 'jakarta';
  weatherInput = { mode: 'tmy', prevLocation: null, epw: null, error: null };
  delete EnergyModel.locations.CUSTOM_EPW;
  const sel = document.getElementById('site-location');
  const opt = sel.querySelector('option[value="CUSTOM_EPW"]');
  if (opt) opt.remove();
  sel.value = prev;
  AppState.siteLocation = prev;
  document.getElementById('epw-clear').classList.add('hidden');
  const infoEl = document.getElementById('epw-info');
  if (infoEl) { infoEl.classList.add('hidden'); infoEl.textContent = ''; }
  updateAll();
}

async function onLoadFile(file) {
  try {
    const text = await readFileAsText(file);
    const { header, rows } = parseCsv(text);
    if (header.length === 0) throw new Error(I18n.t('loadErrorEmpty'));
    // A headerless file starts with a numeric row; treat it as data.
    let dataRows = rows;
    if (!isNaN(parseFloat(header[0])) && !isNaN(parseFloat(header[1]))) dataRows = [header].concat(rows);
    dataRows = dataRows.filter((r) => r.length >= 2);
    if (dataRows.length !== 8760) throw new Error(I18n.t('loadErrorRows', { n: dataRows.length }));
    const hours = new Array(8760);
    for (let i = 0; i < 8760; i++) {
      const v = parseFloat(dataRows[i][1]);
      if (isNaN(v) || v < 0 || v > 100000) throw new Error(I18n.t('loadErrorValue', { n: i + 1, v: dataRows[i][1] }));
      hours[i] = v;
    }
    const total = hours.reduce((a, b) => a + b, 0);
    loadInput.csv = { name: file.name, hours, totalKwh: total, peakKw: Math.max.apply(null, hours) };
    loadInput.error = null;
    loadInput.mode = 'csv';
    document.getElementById('load-mode').value = 'csv';
    updateAll();
  } catch (err) {
    loadInput.error = err.message;
    renderLoadUI();
  }
}

function downloadLoadTemplate() {
  // 8760 hourly values from the same synthetic daily shape the 24h chart
  // draws, scaled to the current installed kWp. Edit in Excel, then upload.
  const baseLoad = lastMetrics ? Math.max(15, lastMetrics.kwp * 0.32) : 15;
  const day = [];
  for (let hr = 0; hr < 24; hr++) {
    const morningPeak = Math.exp(-0.5 * Math.pow((hr - 9) / 2.2, 2)) * 0.45;
    const eveningPeak = Math.exp(-0.5 * Math.pow((hr - 19) / 2.0, 2)) * 0.65;
    day.push(baseLoad * (0.6 + morningPeak + eveningPeak));
  }
  let csv = 'hour,load_kw\n';
  for (let h = 0; h < 8760; h++) csv += h + ',' + day[h % 24].toFixed(2) + '\n';
  downloadTextFile('load_profile_template.csv', csv);
}

function downloadModuleTemplate() {
  downloadTextFile(
    'pv_module_template.csv',
    'name,p_mpp_w,length_m,width_m,efficiency_percent,temp_coeff_percent_per_c\n' +
    'Contoh Modul 610W,610,2.278,1.134,21.5,-0.34\n'
  );
}

function downloadBessTemplate() {
  downloadTextFile(
    'bess_template.csv',
    'name,capacity_kwh,power_kw,rte_percent,dod_percent\n' +
    'Contoh BESS LFP 120kWh,120,60,92,90\n'
  );
}

function applyCustomModule(m) {
  // Remember the Wp that was active, so clearing restores it.
  m.prevWp = AppState.panelWp;
  AppState.customModule = m;
  const sel = document.getElementById('panel-wp');
  let opt = sel.querySelector('option[value="custom"]');
  if (!opt) {
    opt = document.createElement('option');
    opt.value = 'custom';
    sel.appendChild(opt);
  }
  opt.textContent = m.name + ' (' + m.wp + ' Wp)';
  sel.value = 'custom';
  AppState.panelWp = m.wp;
  const orientSel = document.getElementById('panel-orientation');
  const pOpt = orientSel.querySelector('option[value="portrait"]');
  const lOpt = orientSel.querySelector('option[value="landscape"]');
  if (pOpt) pOpt.textContent = 'Portrait (' + m.width.toFixed(2) + 'm x ' + m.length.toFixed(2) + 'm)';
  if (lOpt) lOpt.textContent = 'Landscape (' + m.length.toFixed(2) + 'm x ' + m.width.toFixed(2) + 'm)';
  document.getElementById('module-clear').classList.remove('hidden');
  document.getElementById('module-status').textContent = I18n.t('moduleStatusActive', {
    name: m.name, wp: m.wp, l: m.length.toFixed(2), w: m.width.toFixed(2),
    eff: m.efficiency != null ? m.efficiency.toFixed(1) : '-',
    tc: m.tempCoeff != null ? m.tempCoeff.toFixed(2) : '-'
  });
}

function clearCustomModule(resetWp) {
  const prevWp = AppState.customModule ? AppState.customModule.prevWp : null;
  AppState.customModule = null;
  const sel = document.getElementById('panel-wp');
  const opt = sel.querySelector('option[value="custom"]');
  if (opt) opt.remove();
  const orientSel = document.getElementById('panel-orientation');
  const pOpt = orientSel.querySelector('option[value="portrait"]');
  const lOpt = orientSel.querySelector('option[value="landscape"]');
  if (pOpt) pOpt.textContent = 'Portrait (1.13m × 2.27m)';
  if (lOpt) lOpt.textContent = 'Landscape (2.27m × 1.13m)';
  document.getElementById('module-clear').classList.add('hidden');
  document.getElementById('module-status').textContent = I18n.t('moduleStatusDefault');
  if (resetWp) {
    // Restore the Wp that was active before the upload (default 610).
    const wp = prevWp || 610;
    sel.value = String(wp);
    AppState.panelWp = wp;
  }
}

async function onModuleFile(file) {
  const statusEl = document.getElementById('module-status');
  try {
    const text = await readFileAsText(file);
    const { header, rows } = parseCsv(text);
    const need = ['name', 'p_mpp_w', 'length_m', 'width_m', 'efficiency_percent', 'temp_coeff_percent_per_c'];
    const idx = {};
    need.forEach((c) => { idx[c] = header.indexOf(c); });
    if (idx.name < 0 || idx.p_mpp_w < 0 || idx.length_m < 0 || idx.width_m < 0) {
      throw new Error(I18n.t('csvErrorHeader', { cols: header.join(', ') }));
    }
    if (rows.length !== 1) throw new Error(I18n.t('csvErrorRows'));
    const r = rows[0];
    const num = (col) => {
      const v = parseFloat(r[idx[col]]);
      if (isNaN(v)) throw new Error(I18n.t('csvErrorNumber', { col, v: r[idx[col]] }));
      return v;
    };
    const m = {
      name: ((r[idx.name] || 'Custom').trim() || 'Custom'),
      wp: num('p_mpp_w'),
      length: num('length_m'),
      width: num('width_m'),
      efficiency: idx.efficiency_percent >= 0 && r[idx.efficiency_percent] !== '' ? num('efficiency_percent') : null,
      tempCoeff: idx.temp_coeff_percent_per_c >= 0 && r[idx.temp_coeff_percent_per_c] !== '' ? num('temp_coeff_percent_per_c') : null
    };
    const range = (v, lo, hi, col) => { if (v < lo || v > hi) throw new Error(I18n.t('csvErrorRange', { col, v })); };
    range(m.wp, 50, 1000, 'p_mpp_w');
    range(m.length, 0.5, 3.0, 'length_m');
    range(m.width, 0.3, 2.0, 'width_m');
    if (m.efficiency != null) range(m.efficiency, 5, 30, 'efficiency_percent');
    if (m.tempCoeff != null) range(m.tempCoeff, -1.0, 0, 'temp_coeff_percent_per_c');
    applyCustomModule(m);
    updateAll();
  } catch (err) {
    if (statusEl) statusEl.textContent = I18n.t('moduleError', { msg: err.message });
  }
}

function applyCustomBess(b) {
  // Remember the sizing that was active, so clearing restores it.
  b.prevKwh = AppState.bessKwh;
  b.prevKw = AppState.bessKw;
  customBess = b;
  EnergyModel.chemistries.CUSTOM = { label: b.name, rte: b.rte, dod: b.dod };
  const sel = document.getElementById('bess-chemistry');
  let opt = sel.querySelector('option[value="CUSTOM"]');
  if (!opt) {
    opt = document.createElement('option');
    opt.value = 'CUSTOM';
    sel.appendChild(opt);
  }
  opt.textContent = b.name + ' (' + Math.round(b.rte * 100) + '% RTE)';
  sel.value = 'CUSTOM';
  AppState.bessChemistry = 'CUSTOM';
  AppState.bessKwh = b.capacityKwh;
  AppState.bessKw = b.powerKw;
  document.getElementById('bess-kwh').value = Math.min(500, b.capacityKwh);
  document.getElementById('bess-kw').value = Math.min(500, b.powerKw);
  document.getElementById('bess-clear').classList.remove('hidden');
  document.getElementById('bess-status').textContent = I18n.t('bessStatusActive', {
    name: b.name, kwh: b.capacityKwh, kw: b.powerKw,
    rte: (b.rte * 100).toFixed(0), dod: (b.dod * 100).toFixed(0)
  });
}

function clearCustomBess(resetChem) {
  // Restore the pre-upload sizing, but only if the sliders still hold the
  // uploaded values (if the user moved them since, their choice stands).
  const prev = customBess;
  const sizingUntouched = prev && AppState.bessKwh === prev.capacityKwh && AppState.bessKw === prev.powerKw;
  customBess = null;
  delete EnergyModel.chemistries.CUSTOM;
  const sel = document.getElementById('bess-chemistry');
  const opt = sel.querySelector('option[value="CUSTOM"]');
  if (opt) opt.remove();
  document.getElementById('bess-clear').classList.add('hidden');
  document.getElementById('bess-status').textContent = I18n.t('bessStatusDefault');
  if (resetChem) { sel.value = 'LFP'; AppState.bessChemistry = 'LFP'; }
  if (resetChem && sizingUntouched) {
    AppState.bessKwh = prev.prevKwh;
    AppState.bessKw = prev.prevKw;
    document.getElementById('bess-kwh').value = Math.min(500, prev.prevKwh);
    document.getElementById('bess-kw').value = Math.min(500, prev.prevKw);
  }
}

async function onBessFile(file) {
  const statusEl = document.getElementById('bess-status');
  try {
    const text = await readFileAsText(file);
    const { header, rows } = parseCsv(text);
    const need = ['name', 'capacity_kwh', 'power_kw', 'rte_percent', 'dod_percent'];
    const idx = {};
    need.forEach((c) => { idx[c] = header.indexOf(c); });
    if (need.some((c) => idx[c] < 0)) {
      throw new Error(I18n.t('csvErrorHeader', { cols: header.join(', ') }));
    }
    if (rows.length !== 1) throw new Error(I18n.t('csvErrorRows'));
    const r = rows[0];
    const num = (col) => {
      const v = parseFloat(r[idx[col]]);
      if (isNaN(v)) throw new Error(I18n.t('csvErrorNumber', { col, v: r[idx[col]] }));
      return v;
    };
    const b = {
      name: ((r[idx.name] || 'Custom BESS').trim() || 'Custom BESS'),
      capacityKwh: num('capacity_kwh'),
      powerKw: num('power_kw'),
      rte: num('rte_percent') / 100,
      dod: num('dod_percent') / 100
    };
    const range = (v, lo, hi, col) => { if (v < lo || v > hi) throw new Error(I18n.t('csvErrorRange', { col, v })); };
    range(b.capacityKwh, 1, 100000, 'capacity_kwh');
    range(b.powerKw, 1, 10000, 'power_kw');
    range(b.rte, 0.5, 0.99, 'rte_percent');
    range(b.dod, 0.1, 1.0, 'dod_percent');
    applyCustomBess(b);
    updateAll();
  } catch (err) {
    if (statusEl) statusEl.textContent = I18n.t('bessError', { msg: err.message });
  }
}

// True when a simulation result exists and the current inputs still match
// the payload it was computed from.
function pysamIsFresh() {
  if (!pysamResult) return false;
  return JSON.stringify(buildPysamPayload()) === pysamFingerprint;
}

// Dispatch chart: drawn only from a fresh simulation result. Before any
// simulation (or when inputs changed and the result is stale), the
// section shows an empty state instead of a made-up curve.
function renderDispatchChart(metrics) {
  const titleEl = document.getElementById('sec04-title');
  const descEl = document.getElementById('sec04-desc');
  const legendEl = document.getElementById('dispatch-legend');
  const gridLegend = document.getElementById('legend-grid-import');
  const battLegend = document.getElementById('legend-battery');
  const canvas = document.getElementById('dispatch-chart');
  const emptyEl = document.getElementById('dispatch-empty');
  const sim = pysamIsFresh() ? pysamResult : null;
  if (sim && sim.typical_day) {
    if (titleEl) titleEl.textContent = I18n.t('sec04Sim');
    if (descEl) descEl.textContent = I18n.t('sec04SimDesc');
    if (legendEl) legendEl.classList.remove('hidden');
    if (gridLegend) gridLegend.classList.remove('hidden');
    if (battLegend) battLegend.classList.remove('hidden');
    if (canvas) canvas.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    dispatchChart.simDay = sim.typical_day;
    dispatchChart.hoverHour = null;
    hideDispatchTooltip();
    dispatchChartRedraw();
  } else {
    if (titleEl) titleEl.textContent = I18n.t('sec04');
    if (descEl) descEl.textContent = I18n.t('sec04Desc');
    if (legendEl) legendEl.classList.add('hidden');
    if (canvas) canvas.classList.add('hidden');
    if (emptyEl) emptyEl.classList.remove('hidden');
    dispatchChart.simDay = null;
    dispatchChart.hoverHour = null;
    hideDispatchTooltip();
  }
}

function dispatchChartRedraw() {
  if (!dispatchChart.simDay) return;
  const canvas = document.getElementById('dispatch-chart');
  dispatchChart.geom = EnergyModel.drawDispatchChart(canvas, dispatchChart.simDay, {
    hidden: dispatchChart.hidden,
    hoverHour: dispatchChart.hoverHour
  });
}

function hideDispatchTooltip() {
  const tip = document.getElementById('dispatch-tooltip');
  if (tip) tip.classList.add('hidden');
}

// Tooltip for the hovered hour: one row per visible series, with the
// same colours as the legend. Positioned near the cursor, clamped
// inside the chart container.
function showDispatchTooltip(hour, clientX) {
  const tip = document.getElementById('dispatch-tooltip');
  const canvas = document.getElementById('dispatch-chart');
  const d = dispatchChart.simDay;
  if (!tip || !canvas || !d) return;
  const h = dispatchChart.hidden;
  const row = (color, label, value) => '<div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full inline-block" style="background:' + color + '"></span><span>' + label + ': <b>' + value + '</b></span></div>';
  const rows = [];
  if (!h.pv) rows.push(row('#D97706', I18n.t('legendPv'), d.pv_kw[hour].toFixed(1) + ' kW'));
  if (!h.load) rows.push(row('#64748b', I18n.t('legendLoad'), d.load_kw[hour].toFixed(1) + ' kW'));
  if (!h.soc) rows.push(row('#12579B', I18n.t('legendSoc'), d.soc_percent[hour].toFixed(0) + '%'));
  if (d.grid_import_kw && !h.grid) rows.push(row('#BB1326', I18n.t('legendGridImport'), d.grid_import_kw[hour].toFixed(1) + ' kW'));
  if (d.battery_kw && !h.batt) rows.push(row('#16A34A', I18n.t('legendBattery'), d.battery_kw[hour].toFixed(1) + ' kW'));
  tip.innerHTML = '<div class="font-semibold mb-1">' + String(hour).padStart(2, '0') + ':00</div>' + rows.join('');
  tip.classList.remove('hidden');
  const wrapRect = canvas.parentElement.getBoundingClientRect();
  let left = clientX - wrapRect.left + 12;
  if (left + tip.offsetWidth > wrapRect.width - 4) left = clientX - wrapRect.left - tip.offsetWidth - 12;
  tip.style.left = Math.max(4, left) + 'px';
  tip.style.top = '8px';
}

function initDispatchChart() {
  const canvas = document.getElementById('dispatch-chart');
  if (!canvas) return;
  canvas.addEventListener('mousemove', (e) => {
    if (!dispatchChart.simDay || !dispatchChart.geom) return;
    const rect = canvas.getBoundingClientRect();
    const g = dispatchChart.geom;
    const hour = Math.round(((e.clientX - rect.left - g.padL) / g.plotW) * 23);
    if (hour < 0 || hour > 23) {
      dispatchChart.hoverHour = null;
      dispatchChartRedraw();
      hideDispatchTooltip();
      return;
    }
    if (dispatchChart.hoverHour !== hour) {
      dispatchChart.hoverHour = hour;
      dispatchChartRedraw();
    }
    showDispatchTooltip(hour, e.clientX);
  });
  canvas.addEventListener('mouseleave', () => {
    dispatchChart.hoverHour = null;
    dispatchChartRedraw();
    hideDispatchTooltip();
  });

  // Legend click toggles a series on/off (dimmed legend = hidden).
  document.querySelectorAll('#dispatch-legend .legend-toggle').forEach((el) => {
    el.addEventListener('click', () => {
      const s = el.getAttribute('data-series');
      dispatchChart.hidden[s] = !dispatchChart.hidden[s];
      el.classList.toggle('opacity-40', !!dispatchChart.hidden[s]);
      dispatchChartRedraw();
      hideDispatchTooltip();
    });
  });

  // Empty-state button scrolls up to the simulation run button.
  const emptyRunBtn = document.getElementById('dispatch-empty-run');
  if (emptyRunBtn) emptyRunBtn.addEventListener('click', () => {
    const runBtn = document.getElementById('run-pysam');
    if (runBtn) { runBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); runBtn.focus(); }
  });
}

function renderPysamUI() {
  const statusEl = document.getElementById('pysam-status');
  const resultsEl = document.getElementById('pysam-results');
  const runBtn = document.getElementById('run-pysam');
  const shadeBtn = document.getElementById('run-pysam-shading');
  if (!statusEl || !resultsEl || !runBtn) return;

  runBtn.disabled = pysamRunning || shadingRunning;
  if (shadeBtn) shadeBtn.disabled = pysamRunning || shadingRunning;
  if (!pysamRunning) runBtn.textContent = I18n.t('pysamRun');

  if (pysamRunning) return; // status line is driven by the runner
  if (!pysamResult) {
    // No result yet: show whether shading is measured, so the order is
    // visible (change dimensions -> run shading -> run simulation).
    statusEl.textContent = shadingResult
      ? I18n.t('pysamReady', { v: shadingResult.annualLossPercent.toFixed(1) })
      : I18n.t('pysamNotRun');
    resultsEl.classList.add('hidden');
    return;
  }

  const stale = !pysamIsFresh();
  statusEl.textContent = stale ? I18n.t('pysamStale') : '';
  resultsEl.classList.remove('hidden');

  const r = pysamResult;
  const dispatchEl = document.getElementById('pysam-dispatch');
  if (dispatchEl) {
    const d = r.dispatch;
    if (d && d.mode === 'milp') {
      dispatchEl.textContent = I18n.t('pysamDispatchMilp', {
        curt: ((r.annual_kwh.curtailed_kwh || 0) / 1000).toFixed(2),
        t: d.solve_seconds != null ? d.solve_seconds.toFixed(1) : '-'
      });
    } else if (d && d.mode === 'pysam') {
      dispatchEl.textContent = I18n.t('pysamDispatchPysam');
    } else {
      dispatchEl.textContent = '';
    }
  }

  document.getElementById('pysam-pv').textContent = (r.annual_kwh.pv / 1000).toFixed(1);
  document.getElementById('pysam-sc').textContent = r.annual_kwh.self_consumption_percent.toFixed(1);
  document.getElementById('pysam-ss').textContent = r.annual_kwh.self_sufficiency_percent.toFixed(1);
  document.getElementById('pysam-import-export').textContent = I18n.t('pysamImportExport', {
    imp: (r.annual_kwh.import / 1000).toFixed(1),
    exp: (r.annual_kwh.export / 1000).toFixed(1)
  });
  // Load source comes from the result itself (not the current UI mode),
  // so a stale result still names the profile it was computed with.
  const loadIsCsv = (r.inputs.load_profile || '').indexOf('upload') >= 0;
  document.getElementById('pysam-load').textContent = I18n.t('pysamLoad', {
    src: loadIsCsv ? I18n.t('loadSrcCsv') : I18n.t('loadSrcSynthetic'),
    v: (r.inputs.annual_load_kwh / 1000).toFixed(0)
  });
  document.getElementById('pysam-weather').textContent = I18n.t('pysamWeather', {
    v: r.inputs.location_name + ' · ' + r.inputs.weather_source
  });
  document.getElementById('pysam-quick').textContent = pysamQuickMwh != null
    ? I18n.t('pysamQuickCompare', { v: pysamQuickMwh.toFixed(1) })
    : '';

  // Second KPI row: specific yield, self-consumed energy, curtailment.
  document.getElementById('pysam-yield').textContent = r.annual_kwh.specific_yield_kwh_per_kwp.toFixed(0);
  document.getElementById('pysam-yield-sub').textContent = I18n.t('pysamYieldSub', {
    kwp: r.inputs.pv_kwp.toFixed(1)
  });
  document.getElementById('pysam-used').textContent = (r.annual_kwh.self_consumption_kwh / 1000).toFixed(1);
  document.getElementById('pysam-used-sub').textContent = I18n.t('pysamSelfConsumedSub', {
    direct: (r.annual_kwh.pv_to_load / 1000).toFixed(1),
    via: (r.annual_kwh.battery_to_load / 1000).toFixed(1)
  });
  document.getElementById('pysam-curt').textContent = ((r.annual_kwh.curtailed_kwh || 0) / 1000).toFixed(2);
  document.getElementById('pysam-curt-sub').textContent = I18n.t('pysamCurtailedSub', {
    exp: (r.annual_kwh.export / 1000).toFixed(1)
  });

  const econ = r.economics && r.economics.summary;
  document.getElementById('pysam-capex-total').textContent = econ ? fmtIdrJuta(econ.capex_rp) : '-';
  document.getElementById('pysam-capex-sub').textContent = econ
    ? I18n.t('pysamCapexSub', { save: fmtIdrJuta(econ.savings_year1_rp), opex: fmtIdrJuta(econ.opex_year1_rp) })
    : '';

  // CAPEX breakdown + full economic metrics (every KPI from the response).
  const kvRow = (label, value, strong) => {
    const row = document.createElement('div');
    row.className = 'flex justify-between gap-3 py-0.5' + (strong ? ' border-t border-slate-200 mt-0.5 pt-1 font-semibold' : '');
    const l = document.createElement('span');
    l.className = 'text-slate-500';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'tabular-nums text-slate-700' + (strong ? ' text-slate-900' : '');
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  };
  const capexEl = document.getElementById('pysam-capex');
  if (capexEl) {
    capexEl.innerHTML = '';
    const comp = r.economics && r.economics.capex_components_rp;
    if (comp && econ) {
      capexEl.appendChild(kvRow(I18n.t('pysamCapexPv'), fmtIdrJuta(comp.pv_rp)));
      capexEl.appendChild(kvRow(I18n.t('pysamCapexBattery'), fmtIdrJuta(comp.battery_rp)));
      capexEl.appendChild(kvRow(I18n.t('pysamCapexPcs'), fmtIdrJuta(comp.pcs_rp)));
      if (comp.other_rp > 0) capexEl.appendChild(kvRow(I18n.t('pysamCapexOther'), fmtIdrJuta(comp.other_rp)));
      capexEl.appendChild(kvRow(I18n.t('pysamCapexContingency'), fmtIdrJuta(comp.contingency_rp)));
      capexEl.appendChild(kvRow(I18n.t('pysamCapexTotalRow'), fmtIdrJuta(econ.capex_rp), true));
    }
  }
  const econDetailEl = document.getElementById('pysam-econ-detail');
  if (econDetailEl) {
    econDetailEl.innerHTML = '';
    if (econ) {
      const yrs = (v) => (v != null ? v.toFixed(1) + ' ' + I18n.t('pysamYearsShort') : '-');
      econDetailEl.appendChild(kvRow(I18n.t('pysamEconBcr'), econ.benefit_cost_ratio != null ? econ.benefit_cost_ratio.toFixed(2) : '-'));
      econDetailEl.appendChild(kvRow(I18n.t('pysamEconRoi'), econ.roi_lifetime_percent.toFixed(1) + '%'));
      econDetailEl.appendChild(kvRow(I18n.t('pysamEconDiscPayback'), yrs(econ.discounted_payback_years)));
      econDetailEl.appendChild(kvRow(I18n.t('pysamEconNetCash'), fmtIdrJuta(econ.net_cashflow_year1_rp)));
      econDetailEl.appendChild(kvRow(I18n.t('pysamEconDelivered'), (econ.delivered_net_year1_kwh / 1000).toFixed(1) + ' MWh'));
      econDetailEl.appendChild(kvRow(I18n.t('pysamEconOpex'), fmtIdrJuta(econ.opex_year1_rp)));
    }
  }

  document.getElementById('pysam-econ').textContent = econ
    ? I18n.t('pysamEconLine', {
      npv: fmtIdrJuta(econ.npv_rp),
      irr: econ.irr_percent != null ? econ.irr_percent.toFixed(1) : '-',
      pb: econ.payback_years != null ? econ.payback_years.toFixed(1) : '-',
      lcoe: 'Rp ' + Math.round(econ.lcoe_nominal_rp_per_kwh).toLocaleString('id-ID') + '/kWh'
    })
    : '';

  document.getElementById('pysam-battery').textContent = I18n.t('pysamBattery', {
    rte: r.battery.roundtrip_efficiency_percent.toFixed(1),
    smin: r.battery.soc_min_percent.toFixed(0),
    smax: r.battery.soc_max_percent.toFixed(0),
    ch: (r.battery.throughput_charge_kwh / 1000).toFixed(1),
    thr: (r.battery.throughput_discharge_kwh / 1000).toFixed(1),
    cyc: r.battery.equivalent_full_cycles.toFixed(1),
    cap: r.battery.computed_bank_capacity_kwh.toFixed(0)
  });

  const tbody = document.getElementById('pysam-slopes');
  tbody.innerHTML = '';
  for (const s of r.slopes) {
    const row = document.createElement('tr');
    row.className = 'border-b border-slate-100 text-slate-700';
    const cells = [
      slopeLabel(s.name) + ' · ' + s.share_percent.toFixed(0) + '%',
      s.pv_kwp.toFixed(1),
      s.tilt_deg.toFixed(0) + '°',
      s.azimuth_deg.toFixed(0) + '°',
      s.shading_percent.toFixed(1) + '%',
      s.specific_yield_kwh_per_kwp.toFixed(0),
      (s.annual_kwh / 1000).toFixed(1) + ' MWh'
    ];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.className = 'py-1 pr-2 tabular-nums' + (i === 0 ? '' : ' text-right');
      td.textContent = text;
      row.appendChild(td);
    });
    tbody.appendChild(row);
  }

  const monthsEl = document.getElementById('pysam-months');
  const labelsEl = document.getElementById('pysam-month-labels');
  monthsEl.innerHTML = '';
  labelsEl.innerHTML = '';
  const names = MONTH_NAMES[I18n.lang] || MONTH_NAMES.en;
  const pvM = r.monthly_kwh.pv;
  const impM = r.monthly_kwh.import || pvM.map(() => 0);
  const expM = r.monthly_kwh.export || pvM.map(() => 0);
  const maxM = Math.max.apply(null, pvM.concat(impM, expM, [1]));
  const series = [
    { values: pvM, cls: 'bg-[#D97706]', label: I18n.t('pysamMonthPv') },
    { values: impM, cls: 'bg-[#BB1326]', label: I18n.t('pysamMonthImport') },
    { values: expM, cls: 'bg-slate-400', label: I18n.t('pysamMonthExport') }
  ];
  pvM.forEach((kwh, i) => {
    const group = document.createElement('div');
    group.className = 'flex-1 flex items-end gap-[2px] h-full';
    series.forEach((s) => {
      const bar = document.createElement('div');
      bar.className = 'flex-1 rounded-t min-h-[2px] ' + s.cls;
      bar.style.height = Math.max(2, (s.values[i] / maxM) * 100) + '%';
      bar.title = names[i] + ' · ' + s.label + ': ' + (s.values[i] / 1000).toFixed(2) + ' MWh';
      group.appendChild(bar);
    });
    monthsEl.appendChild(group);
    const lab = document.createElement('div');
    lab.className = 'flex-1 text-center text-[10px] font-sans text-slate-400';
    lab.textContent = names[i];
    labelsEl.appendChild(lab);
  });
}

function updateAll() {
  // Invalidate a shading result that belongs to different geometry.
  if (shadingResult && geometryFingerprint() !== shadingFingerprint) {
    shadingResult = null;
    shadingFingerprint = '';
  }

  // Update labels
  document.getElementById('val-orientation').textContent = formatCompass(AppState.orientation);
  // Icon rail tooltips follow the active language
  document.querySelectorAll('.rail-btn[data-section]').forEach((btn) => {
    const key = { 'section-01': 'railRoof', 'section-02': 'railPv', 'section-03': 'railBess', 'section-04': 'railLoad', 'section-05': 'railWeather' }[btn.dataset.section];
    if (key) {
      btn.title = I18n.t(key);
      btn.setAttribute('aria-label', I18n.t(key));
    }
  });
  const panelHidden = document.getElementById('layout-row').classList.contains('sidebar-collapsed');
  const collapseBtn = document.getElementById('rail-collapse-btn');
  collapseBtn.title = I18n.t(panelHidden ? 'railExpand' : 'railCollapse');
  collapseBtn.setAttribute('aria-label', collapseBtn.title);
  document.getElementById('val-roof-length').textContent = `${AppState.roofLength} m`;
  document.getElementById('val-roof-width').textContent = `${AppState.roofWidth} m`;
  document.getElementById('val-roof-tilt').textContent = `${AppState.roofTilt}°`;
  document.getElementById('val-wall-height').textContent = `${AppState.wallHeight.toFixed(1)} m`;
  document.getElementById('val-setback').textContent = `${AppState.roofSetback.toFixed(1)} m`;
  document.getElementById('val-row-gap').textContent = `${AppState.rowGap.toFixed(2)} m`;
  document.getElementById('val-rack-tilt').textContent = `${AppState.rackTilt}°`;
  document.getElementById('val-bess-kwh').textContent = `${AppState.bessKwh} kWh`;
  document.getElementById('val-bess-kw').textContent = `${AppState.bessKw} kW`;

  const hr = Math.floor(AppState.sunHour);
  const min = Math.round((AppState.sunHour - hr) * 60);
  document.getElementById('val-sun-hour').textContent = `${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

  // Rebuild 3D Scene
  const { activePanelsCount, rafterLength } = Scene3D.buildScene(AppState);
  const elevDeg = Scene3D.updateSunPosition(AppState.sunHour);

  document.getElementById('hud-slope-info').textContent = I18n.t('rafterSlope', { v: rafterLength.toFixed(2) });
  document.getElementById('hud-sun-elevation').textContent = I18n.t('sunElevation', { v: elevDeg });
  document.getElementById('obstacle-count').textContent = Scene3D.disabledSlots.size;

  // Calculate Energy & Financial KPIs (with roof-shape shading when measured)
  const shadingLoss = shadingResult ? shadingResult.annualLossPercent : 0;
  const metrics = EnergyModel.calculateMetrics(AppState, activePanelsCount, shadingLoss);
  lastMetrics = metrics;

  document.getElementById('kpi-kwp').textContent = metrics.kwp.toFixed(1);
  document.getElementById('kpi-panels').textContent = I18n.t('activeModules', { n: activePanelsCount, wp: AppState.panelWp });
  document.getElementById('kpi-yield').textContent = metrics.annualMwh.toFixed(1);
  document.getElementById('kpi-specific').textContent = shadingResult
    ? I18n.t('specificYieldShaded', { pr: (metrics.pr * 100).toFixed(0), kwh: metrics.dailyKwh.toFixed(0), sh: shadingLoss.toFixed(1) })
    : I18n.t('specificYield', { pr: (metrics.pr * 100).toFixed(0), kwh: metrics.dailyKwh.toFixed(0) });
  document.getElementById('kpi-bess').textContent = AppState.bessKwh;
  document.getElementById('kpi-autonomy').textContent = `${metrics.chem.label} · ${(metrics.chem.rte * 100).toFixed(0)}% RTE`;
  document.getElementById('kpi-savings').textContent = formatCurrency(metrics);
  document.getElementById('kpi-co2').textContent = I18n.t('co2Avoided', { v: metrics.co2Tonnes.toFixed(1) });

  // Draw 24h Dispatch Chart (simulation results when fresh, else quick estimate)
  renderDispatchChart(metrics);

  // Shading section (status + results, re-translated on language change)
  renderShadingUI();

  // Detailed PySAM section (results + stale check)
  renderPysamUI();

  // Data input panels (load source + weather source status)
  renderLoadUI();
  renderWeatherUI();
}

document.addEventListener('DOMContentLoaded', () => {
  I18n.init();

  Scene3D.init('three-canvas-container', () => {
    updateAll();
  });

  // Bind UI Controls
  const bindInput = (id, key, parser = parseFloat) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', (e) => {
      AppState[key] = parser(e.target.value);
      updateAll();
    });
  };

  bindInput('roof-type', 'roofType', String);
  bindInput('orientation', 'orientation', parseFloat);
  bindInput('roof-length', 'roofLength', parseFloat);
  bindInput('roof-width', 'roofWidth', parseFloat);
  bindInput('roof-tilt', 'roofTilt', parseFloat);
  bindInput('wall-height', 'wallHeight', parseFloat);
  bindInput('roof-setback', 'roofSetback', parseFloat);
  bindInput('panel-orientation', 'panelOrientation', String);
  bindInput('row-gap', 'rowGap', parseFloat);
  bindInput('rack-tilt', 'rackTilt', parseFloat);
  bindInput('bess-kwh', 'bessKwh', parseInt);
  bindInput('bess-kw', 'bessKw', parseInt);
  bindInput('sun-hour', 'sunHour', parseFloat);

  // Module Wp select: picking a standard module clears the custom upload.
  document.getElementById('panel-wp').addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
      if (AppState.customModule) AppState.panelWp = AppState.customModule.wp;
    } else {
      clearCustomModule(false);
      AppState.panelWp = parseInt(e.target.value, 10);
    }
    updateAll();
  });

  // BESS chemistry select: picking a standard chemistry clears the custom upload.
  document.getElementById('bess-chemistry').addEventListener('change', (e) => {
    if (e.target.value === 'CUSTOM') {
      if (customBess) AppState.bessChemistry = 'CUSTOM';
    } else {
      clearCustomBess(false);
      AppState.bessChemistry = e.target.value;
    }
    updateAll();
  });

  // Location select: picking a TMYx location drops an uploaded EPW.
  document.getElementById('site-location').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v !== 'CUSTOM_EPW' && weatherInput.mode === 'epw') {
      weatherInput = { mode: 'tmy', prevLocation: null, epw: null, error: null };
      delete EnergyModel.locations.CUSTOM_EPW;
      const opt = e.target.querySelector('option[value="CUSTOM_EPW"]');
      if (opt) opt.remove();
      document.getElementById('epw-clear').classList.add('hidden');
      const infoEl = document.getElementById('epw-info');
      if (infoEl) { infoEl.classList.add('hidden'); infoEl.textContent = ''; }
    }
    AppState.siteLocation = v;
    updateAll();
  });

  // Icon Rail: switch sidebar panels (desktop tabs) + panel collapse.
  // On mobile there is no rail and all sections stay stacked (the
  // panel-hidden class only hides at lg, see style.css).
  const layoutRow = document.getElementById('layout-row');
  const setActivePanel = (id) => {
    document.querySelectorAll('.rail-btn[data-section]').forEach((b) => b.classList.toggle('active', b.dataset.section === id));
    ['section-01', 'section-02', 'section-03', 'section-04', 'section-05'].forEach((s) => {
      const el = document.getElementById(s);
      if (el) el.classList.toggle('panel-hidden', s !== id);
    });
    layoutRow.classList.remove('sidebar-collapsed');
    window.dispatchEvent(new Event('resize'));
  };
  document.querySelectorAll('.rail-btn[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => setActivePanel(btn.dataset.section));
  });
  setActivePanel('section-01');
  document.getElementById('rail-collapse-btn').addEventListener('click', () => {
    layoutRow.classList.toggle('sidebar-collapsed');
    window.dispatchEvent(new Event('resize'));
  });

  // Load profile inputs (section 04).
  document.getElementById('load-mode').addEventListener('change', (e) => {
    loadInput.mode = e.target.value;
    loadInput.error = null;
    if (loadInput.mode === 'manual' && loadInput.annualKwh == null) {
      const derived = lastMetrics ? EnergyModel.annualLoadKwh(AppState, lastMetrics) : 0;
      loadInput.annualKwh = Math.round(derived);
      document.getElementById('load-annual').value = loadInput.annualKwh;
    }
    updateAll();
  });
  document.getElementById('load-annual').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    loadInput.annualKwh = isNaN(v) || v <= 0 ? null : v;
    updateAll();
  });
  document.getElementById('load-shape').addEventListener('change', (e) => {
    loadInput.shape = e.target.value;
    updateAll();
  });
  document.getElementById('load-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) onLoadFile(f);
    e.target.value = '';
  });
  document.getElementById('load-template').addEventListener('click', downloadLoadTemplate);
  document.getElementById('load-clear').addEventListener('click', () => {
    loadInput.csv = null;
    loadInput.error = null;
    updateAll();
  });

  // EPW upload (section 05).
  document.getElementById('epw-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) onEpwFile(f);
    e.target.value = '';
  });
  document.getElementById('epw-clear').addEventListener('click', clearEpw);

  // PV module + BESS uploads (sections 02 and 03).
  document.getElementById('module-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) onModuleFile(f);
    e.target.value = '';
  });
  document.getElementById('module-template').addEventListener('click', downloadModuleTemplate);
  document.getElementById('module-clear').addEventListener('click', () => {
    clearCustomModule(true);
    updateAll();
  });
  document.getElementById('bess-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) onBessFile(f);
    e.target.value = '';
  });
  document.getElementById('bess-template').addEventListener('click', downloadBessTemplate);
  document.getElementById('bess-clear').addEventListener('click', () => {
    clearCustomBess(true);
    updateAll();
  });

  // Clear Obstacles
  document.getElementById('clear-obstacles').addEventListener('click', () => {
    Scene3D.disabledSlots.clear();
    updateAll();
  });

  // Currency Toggle
  document.getElementById('currency-toggle').addEventListener('click', () => {
    AppState.currency = AppState.currency === 'IDR' ? 'EUR' : 'IDR';
    document.getElementById('currency-label').textContent = AppState.currency === 'IDR' ? 'IDR (Rp)' : 'EUR (€)';
    updateAll();
  });

  // Language Toggle (Indonesia / English)
  document.getElementById('language-toggle').addEventListener('click', () => {
    I18n.setLanguage(I18n.lang === 'id' ? 'en' : 'id');
    updateAll();
    updateAuthUI();
    // Status unduhan laporan ditulis sekali saat klik; kosongkan supaya
    // tidak tertinggal dalam bahasa lama setelah ganti bahasa.
    const rs = document.getElementById('report-status');
    if (rs) rs.textContent = '';
  });

  // Camera Presets
  document.querySelectorAll('.cam-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      Scene3D.setCameraPreset(btn.dataset.cam);
    });
  });

  // Detailed PySAM simulation (per-slope, via Cloud Run)
  document.getElementById('run-pysam').addEventListener('click', () => {
    runPysamSimulation();
  });

  // Shading first, from the PySAM section: the only shading button now.
  document.getElementById('run-pysam-shading').addEventListener('click', () => {
    const statusEl = document.getElementById('pysam-status');
    runShadingAnalysis((frac) => {
      if (statusEl) statusEl.textContent = I18n.t('pysamRunningShading', { v: Math.round(frac * 100) });
    });
  });

  // Interactive dispatch chart (hover tooltip + legend toggles + empty state)
  initDispatchChart();

  // Login (Firebase Auth) + report downloads
  initAuth();
  document.querySelectorAll('.report-btn').forEach((b) => {
    b.addEventListener('click', () => downloadReport(b.getAttribute('data-report')));
  });

  window.addEventListener('resize', () => updateAll());
  updateAll();
});
