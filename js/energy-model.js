/**
 * energy-model.js
 * Techno-economic PV Yield, Solar Geometry, and 24-Hour BESS Dispatch Engine
 * Inspired by Ardian Candra's MSc Thesis (KTH Royal Institute of Technology)
 * NOTE: illustrative model only, not PySAM/PVlib, no MILP optimizer.
 * Yield uses fixed PSH per site; orientation uses a simple latitude-scaled
 * derate (see orientationFactor below), not a full solar-geometry model.
 */

const EnergyModel = {
  locations: {
    // diffuseFraction: annual diffuse share of global irradiation, derived
    // from the TMYx weather file per location (DHI/GHI), replacing the
    // earlier typical-value assumptions. Used only to combine the raycast
    // beam and diffuse shading losses into one number.
    jakarta: { name: "Jakarta, ID", psh: 4.6, lat: -6.2, gridEf: 0.78, tariffIdr: 1444.7, tariffEur: 0.088, diffuseFraction: 0.31 },
    riau: { name: "Riau Islands", psh: 4.9, lat: 1.0, gridEf: 0.82, tariffIdr: 1650.0, tariffEur: 0.101, diffuseFraction: 0.37 },
    oskarshamn: { name: "Oskarshamn, SE", psh: 3.3, lat: 57.26, gridEf: 0.045, tariffIdr: 2950.0, tariffEur: 0.180, diffuseFraction: 0.42 },
    bali: { name: "Denpasar, Bali", psh: 5.0, lat: -8.75, gridEf: 0.78, tariffIdr: 1444.7, tariffEur: 0.088, diffuseFraction: 0.28 }
  },

  chemistries: {
    LFP: { label: "LFP (LiFePO₄)", rte: 0.92, dod: 0.90 },
    NAION: { label: "Na-Ion", rte: 0.89, dod: 0.85 },
    VRFB: { label: "VRFB Flow", rte: 0.78, dod: 0.98 }
  },

  calculateMetrics(state, activePanelsCount, shadingLossPercent = 0) {
    const loc = this.locations[state.siteLocation] || this.locations.jakarta;
    const chem = this.chemistries[state.bessChemistry] || this.chemistries.LFP;

    // 1. Installed Capacity (kWp)
    const kwp = (activePanelsCount * state.panelWp) / 1000;

    // 2. Tilt Efficiency Factor
    const effectiveTilt = state.roofType === 'flat-tilt' ? state.rackTilt : state.roofTilt;
    const optimalTilt = Math.abs(loc.lat);
    const tiltDeviation = Math.abs(effectiveTilt - optimalTilt);
    const tiltFactor = Math.max(0.82, 1 - tiltDeviation * 0.0035);

    // 2b. Orientation Factor (illustrative, latitude-scaled).
    // Optimal azimuth faces the equator: 0 deg (North) south of the equator,
    // 180 deg (South) north of it. Loss grows with latitude: near the equator
    // (Jakarta, lat -6.2) azimuth barely matters; at high latitude
    // (Oskarshamn, lat 57.3) facing away costs up to 30%.
    const optimalAzimuth = loc.lat < 0 ? 0 : 180;
    let azDeviation = Math.abs(state.orientation - optimalAzimuth) % 360;
    if (azDeviation > 180) azDeviation = 360 - azDeviation;
    const latWeight = Math.min(1, Math.abs(loc.lat) / 30);
    const orientationFactor = 1 - 0.30 * latWeight * (1 - Math.cos(azDeviation * Math.PI / 180)) / 2;

    // 3. Performance Ratio (PR) including temperature & inverter losses
    const pr = 0.82 * tiltFactor * orientationFactor;

    // 3b. Roof-shape shading (from ShadingAnalyzer raycasts, 0 = not measured yet)
    const shadingFactor = 1 - Math.min(100, Math.max(0, shadingLossPercent)) / 100;

    // 4. Daily & Annual Yield
    const dailyKwh = kwp * loc.psh * pr * shadingFactor;
    const annualMwh = (dailyKwh * 365) / 1000;

    // 5. Financial Savings & CO2
    const annualKwh = annualMwh * 1000;
    const savingsIdr = annualKwh * loc.tariffIdr;
    const savingsEur = annualKwh * loc.tariffEur;
    const co2Tonnes = (annualKwh * loc.gridEf) / 1000;

    return {
      kwp,
      dailyKwh,
      annualMwh,
      pr,
      orientationFactor,
      tiltFactor,
      shadingLossPercent,
      savingsIdr,
      savingsEur,
      co2Tonnes,
      chem
    };
  },

  // Annual load (kWh/yr) implied by the same synthetic 24h load shape
  // the dispatch chart draws: base load scales with installed kWp, with
  // morning and evening peaks. Sent to the PySAM API as annual_load_kwh;
  // the API builds its own synthetic 8760h commercial profile from this
  // annual total. Clearly synthetic, not a measured load.
  annualLoadKwh(state, metrics) {
    const baseLoad = Math.max(15, metrics.kwp * 0.32);
    let dailyKwh = 0;
    for (let hr = 0; hr < 24; hr++) {
      const morningPeak = Math.exp(-0.5 * Math.pow((hr - 9) / 2.2, 2)) * 0.45;
      const eveningPeak = Math.exp(-0.5 * Math.pow((hr - 19) / 2.0, 2)) * 0.65;
      dailyKwh += baseLoad * (0.6 + morningPeak + eveningPeak);
    }
    return dailyKwh * 365;
  },

  // 24h dispatch chart. Without simDay it draws the quick synthetic
  // Draws the 24-hour dispatch chart from a detailed simulation's
  // typical_day (24 hourly averages): PV, load, grid import, battery
  // power (+ discharge / - charge), and BESS SoC. The battery line can
  // go below zero, so the kW axis extends to the lowest battery value
  // and the PV area fills down to the zero line. There is no synthetic
  // fallback here: before a simulation the section shows an empty state
  // instead of a made-up curve.
  // opts: { hidden: {pv, load, soc, grid, batt}, hoverHour: 0-23 | null }
  // Returns the plot geometry so the caller can map mouse position to an hour.
  drawDispatchChart(canvas, simDay, opts) {
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const padL = 36, padR = 16, padT = 12, padB = 22;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const geom = { padL, padR, padT, padB, plotW, plotH, width: w, height: h };

    const o = opts || {};
    const hidden = o.hidden || {};
    const hoverHour = (typeof o.hoverHour === 'number') ? o.hoverHour : null;

    const pvProfile = simDay.pv_kw;
    const loadProfile = simDay.load_kw;
    const socProfile = simDay.soc_percent;
    const gridProfile = simDay.grid_import_kw || null;
    const battProfile = simDay.battery_kw || null;

    const yMin = battProfile ? Math.min(0, Math.min.apply(null, battProfile)) : 0;
    const yMax = Math.max(
      10,
      Math.max.apply(null, pvProfile) * 1.15,
      Math.max.apply(null, loadProfile),
      gridProfile ? Math.max.apply(null, gridProfile) : 0,
      battProfile ? Math.max.apply(null, battProfile) : 0
    );

    // Grid lines
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padT + (plotH * i) / 3;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
    }

    const toX = (hr) => padL + (hr / 23) * plotW;
    const toYKw = (val) => padT + plotH - ((val - yMin) / (yMax - yMin)) * plotH;
    const toYSoc = (val) => padT + plotH - (val / 100) * plotH;
    const yZero = toYKw(0);

    // Zero line, visible when the battery line goes below zero.
    if (yMin < 0) {
      ctx.beginPath();
      ctx.moveTo(padL, yZero);
      ctx.lineTo(w - padR, yZero);
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 1. Draw PV Area (Yellow fill, amber line for contrast on white)
    if (!hidden.pv) {
      ctx.beginPath();
      ctx.moveTo(toX(0), yZero);
      pvProfile.forEach((v, i) => ctx.lineTo(toX(i), toYKw(v)));
      ctx.lineTo(toX(23), yZero);
      ctx.closePath();
      const gradPv = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      gradPv.addColorStop(0, 'rgba(245, 226, 20, 0.42)');
      gradPv.addColorStop(1, 'rgba(245, 226, 20, 0.02)');
      ctx.fillStyle = gradPv;
      ctx.fill();

      ctx.beginPath();
      pvProfile.forEach((v, i) => (i === 0 ? ctx.moveTo(toX(i), toYKw(v)) : ctx.lineTo(toX(i), toYKw(v))));
      ctx.strokeStyle = '#D97706';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 2. Draw Load Line (Slate Grey)
    if (!hidden.load) {
      ctx.beginPath();
      loadProfile.forEach((v, i) => (i === 0 ? ctx.moveTo(toX(i), toYKw(v)) : ctx.lineTo(toX(i), toYKw(v))));
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 3. Draw BESS SoC Line (Brand Blue)
    if (!hidden.soc) {
      ctx.beginPath();
      socProfile.forEach((v, i) => (i === 0 ? ctx.moveTo(toX(i), toYSoc(v)) : ctx.lineTo(toX(i), toYSoc(v))));
      ctx.strokeStyle = '#12579B';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 4. Draw Grid Import Line (Red)
    if (gridProfile && !hidden.grid) {
      ctx.beginPath();
      gridProfile.forEach((v, i) => (i === 0 ? ctx.moveTo(toX(i), toYKw(v)) : ctx.lineTo(toX(i), toYKw(v))));
      ctx.strokeStyle = '#BB1326';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // 5. Draw Battery Power Line (Green, + discharge / - charge)
    if (battProfile && !hidden.batt) {
      ctx.beginPath();
      battProfile.forEach((v, i) => (i === 0 ? ctx.moveTo(toX(i), toYKw(v)) : ctx.lineTo(toX(i), toYKw(v))));
      ctx.strokeStyle = '#16A34A';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // Hover crosshair: vertical guide line + a dot on each visible series.
    if (hoverHour !== null) {
      const x = toX(hoverHour);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.strokeStyle = 'rgba(18, 87, 155, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      const dots = [];
      if (!hidden.pv) dots.push([toYKw(pvProfile[hoverHour]), '#D97706']);
      if (!hidden.load) dots.push([toYKw(loadProfile[hoverHour]), '#64748b']);
      if (!hidden.soc) dots.push([toYSoc(socProfile[hoverHour]), '#12579B']);
      if (gridProfile && !hidden.grid) dots.push([toYKw(gridProfile[hoverHour]), '#BB1326']);
      if (battProfile && !hidden.batt) dots.push([toYKw(battProfile[hoverHour]), '#16A34A']);
      dots.forEach(([y, color]) => {
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }

    // X-axis hour labels
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "Inter", system-ui, sans-serif';
    [0, 6, 12, 18, 23].forEach(hr => {
      const x = toX(hr);
      ctx.fillText(String(hr).padStart(2, '0') + ':00', x - 14, h - 6);
    });

    return geom;
  }
};
