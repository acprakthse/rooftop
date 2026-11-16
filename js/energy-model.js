/**
 * energy-model.js
 * Techno-economic PV Yield, Solar Geometry, and 24-Hour BESS Dispatch Engine
 * Inspired by Ardian Candra's MSc Thesis (KTH Royal Institute of Technology)
 */

const EnergyModel = {
  locations: {
    jakarta: { name: "Jakarta, ID", psh: 4.6, lat: -6.2, gridEf: 0.78, tariffIdr: 1444.7, tariffEur: 0.088 },
    riau: { name: "Riau Islands", psh: 4.9, lat: 1.0, gridEf: 0.82, tariffIdr: 1650.0, tariffEur: 0.101 },
    oskarshamn: { name: "Oskarshamn, SE", psh: 3.3, lat: 57.26, gridEf: 0.045, tariffIdr: 2950.0, tariffEur: 0.180 }
  },

  chemistries: {
    LFP: { label: "LFP (LiFePO₄)", rte: 0.92, dod: 0.90 },
    NAION: { label: "Na-Ion", rte: 0.89, dod: 0.85 },
    VRFB: { label: "VRFB Flow", rte: 0.78, dod: 0.98 }
  },

  calculateMetrics(state, activePanelsCount) {
    const loc = this.locations[state.siteLocation] || this.locations.jakarta;
    const chem = this.chemistries[state.bessChemistry] || this.chemistries.LFP;

    // 1. Installed Capacity (kWp)
    const kwp = (activePanelsCount * state.panelWp) / 1000;

    // 2. Tilt Efficiency Factor
    const effectiveTilt = state.roofType === 'flat-tilt' ? state.rackTilt : state.roofTilt;
    const optimalTilt = Math.abs(loc.lat);
    const tiltDeviation = Math.abs(effectiveTilt - optimalTilt);
    const tiltFactor = Math.max(0.82, 1 - tiltDeviation * 0.0035);

    // 3. Performance Ratio (PR) including temperature & inverter losses
    const pr = 0.82 * tiltFactor;

    // 4. Daily & Annual Yield
    const dailyKwh = kwp * loc.psh * pr;
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
      savingsIdr,
      savingsEur,
      co2Tonnes,
      chem
    };
  },

  drawDispatchChart(canvas, state, metrics) {
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

    // Generate 24h profiles
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const peakPv = metrics.kwp * 0.82;
    const baseLoad = Math.max(15, metrics.kwp * 0.32);

    const pvProfile = hours.map(hr => {
      if (hr < 6 || hr > 18) return 0;
      const x = (hr - 12) / 3.2;
      return Math.max(0, peakPv * Math.exp(-0.5 * x * x));
    });

    const loadProfile = hours.map(hr => {
      const morningPeak = Math.exp(-0.5 * Math.pow((hr - 9) / 2.2, 2)) * 0.45;
      const eveningPeak = Math.exp(-0.5 * Math.pow((hr - 19) / 2.0, 2)) * 0.65;
      return baseLoad * (0.6 + morningPeak + eveningPeak);
    });

    // Simulate BESS SoC (%)
    let soc = 35;
    const bessCap = Math.max(1, state.bessKwh);
    const socProfile = hours.map((hr, i) => {
      const net = pvProfile[i] - loadProfile[i];
      if (state.bessKwh > 0) {
        soc = Math.min(95, Math.max(15, soc + (net / bessCap) * 100 * 0.65));
      } else {
        soc = 0;
      }
      return soc;
    });

    const maxKw = Math.max(10, peakPv * 1.15, ...loadProfile);

    // Grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padT + (plotH * i) / 3;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
    }

    const toX = (hr) => padL + (hr / 23) * plotW;
    const toYKw = (val) => padT + plotH - (val / maxKw) * plotH;
    const toYSoc = (val) => padT + plotH - (val / 100) * plotH;

    // 1. Draw PV Area (Brand Yellow)
    ctx.beginPath();
    ctx.moveTo(toX(0), padT + plotH);
    pvProfile.forEach((v, i) => ctx.lineTo(toX(i), toYKw(v)));
    ctx.lineTo(toX(23), padT + plotH);
    ctx.closePath();
    const gradPv = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    gradPv.addColorStop(0, 'rgba(245, 226, 20, 0.42)');
    gradPv.addColorStop(1, 'rgba(245, 226, 20, 0.02)');
    ctx.fillStyle = gradPv;
    ctx.fill();

    ctx.beginPath();
    pvProfile.forEach((v, i) => (i === 0 ? ctx.moveTo(toX(i), toYKw(v)) : ctx.lineTo(toX(i), toYKw(v))));
    ctx.strokeStyle = '#F5E214';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 2. Draw Load Line (Light Grey)
    ctx.beginPath();
    loadProfile.forEach((v, i) => (i === 0 ? ctx.moveTo(toX(i), toYKw(v)) : ctx.lineTo(toX(i), toYKw(v))));
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Draw BESS SoC Line (Brand Blue)
    ctx.beginPath();
    socProfile.forEach((v, i) => (i === 0 ? ctx.moveTo(toX(i), toYSoc(v)) : ctx.lineTo(toX(i), toYSoc(v))));
    ctx.strokeStyle = '#4A90D9';
    ctx.lineWidth = 2;
    ctx.stroke();

    // X-axis hour labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px "JetBrains Mono", monospace';
    [0, 6, 12, 18, 23].forEach(hr => {
      const x = toX(hr);
      ctx.fillText(String(hr).padStart(2, '0') + ':00', x - 14, h - 6);
    });
  }
};
