/**
 * main.js
 * Application Controller connecting UI Inputs, Presets, 3D WebGL Scene, and KPI Dashboard
 */

const AppState = {
  roofType: 'gable-dual',
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
  currency: 'IDR'
};

function formatCurrency(metrics) {
  if (AppState.currency === 'IDR') {
    const juta = metrics.savingsIdr / 1e6;
    return `Rp ${juta.toFixed(1)} Jt/thn`;
  } else {
    return `€ ${Math.round(metrics.savingsEur).toLocaleString()}/yr`;
  }
}

function updateAll() {
  // Update labels
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

  document.getElementById('hud-slope-info').textContent = `Rafter Slope Width: ${rafterLength.toFixed(2)} m`;
  document.getElementById('hud-sun-elevation').textContent = `Sun Elevation: ${elevDeg}°`;
  document.getElementById('obstacle-count').textContent = Scene3D.disabledSlots.size;

  // Calculate Energy & Financial KPIs
  const metrics = EnergyModel.calculateMetrics(AppState, activePanelsCount);

  document.getElementById('kpi-kwp').textContent = metrics.kwp.toFixed(1);
  document.getElementById('kpi-panels').textContent = `${activePanelsCount} active modules (${AppState.panelWp} Wp)`;
  document.getElementById('kpi-yield').textContent = metrics.annualMwh.toFixed(1);
  document.getElementById('kpi-specific').textContent = `PR ${(metrics.pr * 100).toFixed(0)}% · ${(metrics.dailyKwh).toFixed(0)} kWh/day`;
  document.getElementById('kpi-bess').textContent = AppState.bessKwh;
  document.getElementById('kpi-autonomy').textContent = `${metrics.chem.label} · ${(metrics.chem.rte * 100).toFixed(0)}% RTE`;
  document.getElementById('kpi-savings').textContent = formatCurrency(metrics);
  document.getElementById('kpi-co2').textContent = `${metrics.co2Tonnes.toFixed(1)} tCO₂/yr avoided`;

  // Draw 24h Dispatch Chart
  EnergyModel.drawDispatchChart(document.getElementById('dispatch-chart'), AppState, metrics);
}

document.addEventListener('DOMContentLoaded', () => {
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

  // Camera Presets
  document.querySelectorAll('.cam-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      Scene3D.setCameraPreset(btn.dataset.cam);
    });
  });

  // Portfolio Project Presets
  const applyPreset = (cfg) => {
    Object.assign(AppState, cfg);
    document.getElementById('roof-type').value = AppState.roofType;
    document.getElementById('roof-length').value = AppState.roofLength;
    document.getElementById('roof-width').value = AppState.roofWidth;
    document.getElementById('roof-tilt').value = AppState.roofTilt;
    document.getElementById('wall-height').value = AppState.wallHeight;
    document.getElementById('roof-setback').value = AppState.roofSetback;
    document.getElementById('panel-orientation').value = AppState.panelOrientation;
    document.getElementById('panel-wp').value = AppState.panelWp;
    document.getElementById('row-gap').value = AppState.rowGap;
    document.getElementById('rack-tilt').value = AppState.rackTilt;
    document.getElementById('bess-chemistry').value = AppState.bessChemistry;
    document.getElementById('site-location').value = AppState.siteLocation;
    document.getElementById('bess-kwh').value = AppState.bessKwh;
    Scene3D.disabledSlots.clear();
    updateAll();
  };

  document.getElementById('preset-oskarshamn').addEventListener('click', () => {
    applyPreset({
      roofType: 'gable-dual',
      roofLength: 32,
      roofWidth: 16,
      roofTilt: 22,
      wallHeight: 7.5,
      panelOrientation: 'portrait',
      panelWp: 610,
      rowGap: 0.3,
      bessChemistry: 'LFP',
      siteLocation: 'oskarshamn',
      bessKwh: 240,
      currency: 'EUR'
    });
    document.getElementById('currency-label').textContent = 'EUR (€)';
  });

  document.getElementById('preset-pln').addEventListener('click', () => {
    applyPreset({
      roofType: 'flat-tilt',
      roofLength: 28,
      roofWidth: 18,
      roofTilt: 0,
      rackTilt: 12,
      wallHeight: 8.0,
      panelOrientation: 'landscape',
      panelWp: 670,
      rowGap: 0.75,
      bessChemistry: 'LFP',
      siteLocation: 'jakarta',
      bessKwh: 180,
      currency: 'IDR'
    });
    document.getElementById('currency-label').textContent = 'IDR (Rp)';
  });

  document.getElementById('preset-moro').addEventListener('click', () => {
    applyPreset({
      roofType: 'hip',
      roofLength: 22,
      roofWidth: 14,
      roofTilt: 16,
      wallHeight: 5.0,
      panelOrientation: 'portrait',
      panelWp: 550,
      rowGap: 0.3,
      bessChemistry: 'VRFB',
      siteLocation: 'riau',
      bessKwh: 150,
      currency: 'IDR'
    });
    document.getElementById('currency-label').textContent = 'IDR (Rp)';
  });

  window.addEventListener('resize', () => updateAll());
  updateAll();
});
