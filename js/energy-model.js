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
  // profiles (Gaussian PV bell, synthetic load, rule-based SoC). With
  // simDay (the API's typical_day: 24 hourly averages from the detailed
  // simulation) it draws the simulation results instead, including grid
  // import and battery power (+ discharge / - charge). The battery line
  // can go below zero, so the kW axis extends to the lowest battery value
  // and the PV area fills down to the zero line.
  drawDispatchChart(canvas, state, metrics, simDay) {
    if (!canvas) return;
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

    const hours = Array.from({ length: 24 }, (_, i) => i);
    let pvProfile, loadProfile, socProfile, gridProfile, battProfile;

    if (simDay && simDay.pv_kw && simDay.pv_kw.length === 24) {
      // Detailed simulation results (typical day, hourly averages).
      pvProfile = simDay.pv_kw;
      loadProfile = simDay.load_kw;
      socProfile = simDay.soc_percent;
      gridProfile = simDay.grid_import_kw || null;
      battProfile = simDay.battery_kw || null;
    } else {
      // Quick synthetic profiles (as before).
      const peakPv = metrics.kwp * metrics.pr * (1 - (metrics.shadingLossPercent || 0) / 100);
      const baseLoad = Math.max(15, metrics.kwp * 0.32);

      pvProfile = hours.map(hr => {
        if (hr < 6 || hr > 18) return 0;
        const x = (hr - 12) / 3.2;
        return Math.max(0, peakPv * Math.exp(-0.5 * x * x));
      });

      loadProfile = hours.map(hr => {
        const morningPeak = Math.exp(-0.5 * Math.pow((hr - 9) / 2.2, 2)) * 0.45;
        const eveningPeak = Math.exp(-0.5 * Math.pow((hr - 19) / 2.0, 2)) * 0.65;
        return baseLoad * (0.6 + morningPeak + eveningPeak);
      });

      // Simulate BESS SoC (%). Usable capacity and SoC limits come from the
      // selected chemistry's DoD; round-trip efficiency applies on both legs:
      // charging stores net * RTE, discharging must draw net / RTE from the
      // battery to deliver net to the load. (Replaces the old unexplained 0.65.)
      let soc = 35;
      const bessCap = Math.max(1, state.bessKwh);
      const usableCap = bessCap * metrics.chem.dod;
      const socMin = (1 - metrics.chem.dod) * 100;
      const socMax = 100;
      socProfile = hours.map((hr, i) => {
        const net = pvProfile[i] - loadProfile[i];
        if (state.bessKwh > 0) {
          const delta = net >= 0
            ? (net / usableCap) * 100 * metrics.chem.rte
            : (net / usableCap) * 100 / metrics.chem.rte;
          soc = Math.min(socMax, Math.max(socMin, soc + delta));
        } else {
          soc = 0;
        }
        return soc;
      });
      gridProfile = null;
      battProfile = null;
    }

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

    // 2. Draw Load Line (Slate Grey)
    ctx.beginPath();
    loadProfile.forEach((v, i) => (i === 0 ? ctx.moveTo(toX(i), toYKw(v)) : ctx.lineTo(toX(i), toYKw(v))));
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Draw BESS SoC Line (Brand Blue)
    ctx.beginPath();
    socProfile.forEach((v, i) => (i === 0 ? ctx.moveTo(toX(i), toYSoc(v)) : ctx.lineTo(toX(i), toYSoc(v))));
    ctx.strokeStyle = '#12579B';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 4. Draw Grid Import Line (Red), simulation only
    if (gridProfile) {
      ctx.beginPath();
      gridProfile.forEach((v, i) => (i === 0 ? ctx.moveTo(toX(i), toYKw(v)) : ctx.lineTo(toX(i), toYKw(v))));
      ctx.strokeStyle = '#BB1326';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // 5. Draw Battery Power Line (Green, + discharge / - charge), simulation only
    if (battProfile) {
      ctx.beginPath();
      battProfile.forEach((v, i) => (i === 0 ? ctx.moveTo(toX(i), toYKw(v)) : ctx.lineTo(toX(i), toYKw(v))));
      ctx.strokeStyle = '#16A34A';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // X-axis hour labels
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "Inter", system-ui, sans-serif';
    [0, 6, 12, 18, 23].forEach(hr => {
      const x = toX(hr);
      ctx.fillText(String(hr).padStart(2, '0') + ':00', x - 14, h - 6);
    });
  }
};
