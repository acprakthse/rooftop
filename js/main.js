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

function updateAll() {
  // Update labels
  document.getElementById('val-orientation').textContent = formatCompass(AppState.orientation);
  document.getElementById('val-wind').textContent = formatCompass(AppState.windDirection);
  document.getElementById('legend-wind').textContent = I18n.t('windLegend', { deg: AppState.windDirection });
  const sidebarHidden = document.getElementById('sidebar').classList.contains('hidden');
  document.getElementById('sidebar-toggle-label').textContent = I18n.t(sidebarHidden ? 'showMenu' : 'hideMenu');
  document.getElementById('val-roof-length').textContent = `${AppState.roofLength} m`;
  document.getElementById('val-roof-width').textContent = `${AppState.roofWidth} m`;
  document.getElementById('val-roof-tilt').textContent = `${AppState.roofTilt}°`;
  document.getElementById('val-wall-height').textContent = `${AppState.wallHeight.toFixed(1)} m`;
  document.getElementById('val-setback').textContent = `${AppState.roofSetback.toFixed(1)} m`;
  document.getElementById('val-row-gap').textContent = `${AppState.rowGap.toFixed(2)} m`;
  document.getElementById('val-rack-tilt').textContent = `${AppState.rackTilt}°`;
  document.getElementById('val-bess-kwh').textContent = `${AppState.bessKwh} kWh`;

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

  // Calculate Energy & Financial KPIs
  const metrics = EnergyModel.calculateMetrics(AppState, activePanelsCount);

  document.getElementById('kpi-kwp').textContent = metrics.kwp.toFixed(1);
  document.getElementById('kpi-panels').textContent = I18n.t('activeModules', { n: activePanelsCount, wp: AppState.panelWp });
  document.getElementById('kpi-yield').textContent = metrics.annualMwh.toFixed(1);
  document.getElementById('kpi-specific').textContent = I18n.t('specificYield', { pr: (metrics.pr * 100).toFixed(0), kwh: metrics.dailyKwh.toFixed(0) });
  document.getElementById('kpi-bess').textContent = AppState.bessKwh;
  document.getElementById('kpi-autonomy').textContent = `${metrics.chem.label} · ${(metrics.chem.rte * 100).toFixed(0)}% RTE`;
  document.getElementById('kpi-savings').textContent = formatCurrency(metrics);
  document.getElementById('kpi-co2').textContent = I18n.t('co2Avoided', { v: metrics.co2Tonnes.toFixed(1) });

  // Draw 24h Dispatch Chart
  EnergyModel.drawDispatchChart(document.getElementById('dispatch-chart'), AppState, metrics);
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
  bindInput('sun-hour', 'sunHour', parseFloat);
  bindInput('wind-direction', 'windDirection', parseFloat);

  // Sidebar Collapse Toggle (workspace expands to full width)
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('hidden');
    document.getElementById('workspace-main').classList.toggle('menu-hidden');
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

  window.addEventListener('resize', () => updateAll());
  updateAll();
});
