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
  rowGap: 0.35,
  rackTilt: 12,
  bessChemistry: 'LFP',
  siteLocation: 'jakarta',
  bessKwh: 120,
  bessKw: 60,
  sunHour: 10.5,
  windDirection: 90,
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
  const runBtn = document.getElementById('run-shading');
  if (!statusEl || !resultsEl || !runBtn) return;

  runBtn.disabled = shadingRunning || pysamRunning;
  if (!shadingRunning) runBtn.textContent = I18n.t('shadingRun');

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
  const runBtn = document.getElementById('run-shading');
  shadingRunning = true;
  renderShadingUI();
  updateAll(); // make sure the scene matches the current inputs
  const fingerprintAtStart = geometryFingerprint();

  try {
    const result = await ShadingAnalyzer.analyze(AppState, Scene3D, (frac) => {
      if (statusEl) statusEl.textContent = I18n.t('shadingRunning', { v: Math.round(frac * 100) });
      if (runBtn) runBtn.textContent = I18n.t('shadingRunning', { v: Math.round(frac * 100) });
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
  const annualLoadKwh = lastMetrics
    ? EnergyModel.annualLoadKwh(AppState, lastMetrics)
    : 0;
  return {
    location: AppState.siteLocation,
    slopes,
    bess_power_kw: AppState.bessKw,
    bess_capacity_kwh: AppState.bessKwh,
    annual_load_kwh: Math.round(annualLoadKwh),
    include_economics: true
  };
}

async function runPysamSimulation() {
  if (pysamRunning) return;
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

    const payload = buildPysamPayload();
    if (statusEl) statusEl.textContent = I18n.t('pysamRunningApi');
    if (runBtn) runBtn.textContent = I18n.t('pysamRunningApi');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    let response;
    try {
      response = await fetch(PYSAM_API_URL + '/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error('HTTP ' + response.status + ' ' + text.slice(0, 120));
    }
    pysamResult = await response.json();
    pysamFingerprint = JSON.stringify(payload);
    pysamQuickMwh = lastMetrics ? lastMetrics.annualMwh : null;
  } catch (err) {
    if (statusEl) statusEl.textContent = I18n.t('pysamError', { msg: err.message || String(err) });
  } finally {
    pysamRunning = false;
    updateAll(); // refresh everything, including the PySAM results
  }
}

function fmtIdrJuta(rp) {
  const juta = rp / 1e6;
  const v = Math.abs(juta) >= 100 ? juta.toFixed(0) : juta.toFixed(1);
  return 'Rp ' + v.replace('.', ',') + ' jt';
}

function renderPysamUI() {
  const statusEl = document.getElementById('pysam-status');
  const resultsEl = document.getElementById('pysam-results');
  const runBtn = document.getElementById('run-pysam');
  if (!statusEl || !resultsEl || !runBtn) return;

  runBtn.disabled = pysamRunning || shadingRunning;
  if (!pysamRunning) runBtn.textContent = I18n.t('pysamRun');

  if (pysamRunning) return; // status line is driven by the runner
  if (!pysamResult) {
    statusEl.textContent = I18n.t('pysamNotRun');
    resultsEl.classList.add('hidden');
    return;
  }

  const stale = JSON.stringify(buildPysamPayload()) !== pysamFingerprint;
  statusEl.textContent = stale ? I18n.t('pysamStale') : '';
  resultsEl.classList.remove('hidden');

  const r = pysamResult;
  document.getElementById('pysam-pv').textContent = (r.annual_kwh.pv / 1000).toFixed(1);
  document.getElementById('pysam-sc').textContent = r.annual_kwh.self_consumption_percent.toFixed(1);
  document.getElementById('pysam-ss').textContent = r.annual_kwh.self_sufficiency_percent.toFixed(1);
  document.getElementById('pysam-import-export').textContent = I18n.t('pysamImportExport', {
    imp: (r.annual_kwh.import / 1000).toFixed(1),
    exp: (r.annual_kwh.export / 1000).toFixed(1)
  });
  document.getElementById('pysam-load').textContent = I18n.t('pysamLoad', {
    v: (r.inputs.annual_load_kwh / 1000).toFixed(0)
  });
  document.getElementById('pysam-weather').textContent = I18n.t('pysamWeather', {
    v: r.inputs.location_name + ' · ' + r.inputs.weather_source
  });
  document.getElementById('pysam-quick').textContent = pysamQuickMwh != null
    ? I18n.t('pysamQuickCompare', { v: pysamQuickMwh.toFixed(1) })
    : '';

  const econ = r.economics && r.economics.summary;
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
    thr: (r.battery.throughput_discharge_kwh / 1000).toFixed(1),
    cyc: r.battery.equivalent_full_cycles.toFixed(1)
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
  const maxM = Math.max.apply(null, r.monthly_kwh.pv.concat([1]));
  r.monthly_kwh.pv.forEach((kwh, i) => {
    const bar = document.createElement('div');
    bar.className = 'flex-1 rounded-t bg-[#D97706] min-h-[2px]';
    bar.style.height = Math.max(2, (kwh / maxM) * 100) + '%';
    bar.title = names[i] + ': ' + (kwh / 1000).toFixed(2) + ' MWh';
    monthsEl.appendChild(bar);
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
  document.getElementById('val-wind').textContent = formatCompass(AppState.windDirection);
  document.getElementById('legend-wind').textContent = I18n.t('windLegend', { deg: AppState.windDirection });
  // Icon rail tooltips follow the active language
  document.querySelectorAll('.rail-btn[data-section]').forEach((btn) => {
    const key = { 'section-01': 'railRoof', 'section-02': 'railPv', 'section-03': 'railBess' }[btn.dataset.section];
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
  Scene3D.setWindDirection(AppState.windDirection);

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

  // Draw 24h Dispatch Chart
  EnergyModel.drawDispatchChart(document.getElementById('dispatch-chart'), AppState, metrics);

  // Shading section (status + results, re-translated on language change)
  renderShadingUI();

  // Detailed PySAM section (results + stale check)
  renderPysamUI();
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
  bindInput('panel-wp', 'panelWp', parseInt);
  bindInput('row-gap', 'rowGap', parseFloat);
  bindInput('rack-tilt', 'rackTilt', parseFloat);
  bindInput('bess-chemistry', 'bessChemistry', String);
  bindInput('site-location', 'siteLocation', String);
  bindInput('bess-kwh', 'bessKwh', parseInt);
  bindInput('bess-kw', 'bessKw', parseInt);
  bindInput('sun-hour', 'sunHour', parseFloat);
  bindInput('wind-direction', 'windDirection', parseFloat);

  // Icon Rail: section shortcuts + panel collapse (Aurora-style sidebar)
  const layoutRow = document.getElementById('layout-row');
  document.querySelectorAll('.rail-btn[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rail-btn[data-section]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      layoutRow.classList.remove('sidebar-collapsed');
      const section = document.getElementById(btn.dataset.section);
      if (section) requestAnimationFrame(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      window.dispatchEvent(new Event('resize'));
    });
  });
  document.getElementById('rail-collapse-btn').addEventListener('click', () => {
    layoutRow.classList.toggle('sidebar-collapsed');
    window.dispatchEvent(new Event('resize'));
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
  });

  // Camera Presets
  document.querySelectorAll('.cam-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      Scene3D.setCameraPreset(btn.dataset.cam);
    });
  });

  // Roof-shape shading analysis (3D raycast)
  document.getElementById('run-shading').addEventListener('click', () => {
    runShadingAnalysis();
  });

  // Detailed PySAM simulation (per-slope, via Cloud Run)
  document.getElementById('run-pysam').addEventListener('click', () => {
    runPysamSimulation();
  });

  window.addEventListener('resize', () => updateAll());
  updateAll();
});
