/**
 * i18n.js
 * Bahasa Indonesia / English strings for the Rooftop PV & BESS Engineering Suite.
 * Static UI text is translated through [data-i18n] attributes; dynamic strings
 * (KPIs, HUD) are translated through I18n.t() calls in main.js.
 * The choice is remembered in localStorage ('rooftop-lang').
 */

const I18n = {
  lang: 'id',

  strings: {
    id: {
      subtitle: 'Geometri Atap Surya 3D, Simulasi Bayangan & Studio Dispatch BESS',
      currency: 'Mata Uang',
      language: 'Bahasa',
      sec01: '01 · ARSITEKTUR ATAP',
      roofTypeLabel: 'Tipologi Struktur Atap 3D',
      roofOptGableDual: 'Pelana 2 Sisi (Gable Dual-Slope)',
      roofOptGableSingle: 'Pelana 1 Sisi Aktif (Gable Single-Side)',
      roofOptFlat: 'Dak Beton + Racking Miring (Flat C&I)',
      roofOptShed: 'Atap Miring 1 Sisi (Mono-Pitch / Shed)',
      roofOptHip: 'Atap Limas 3D (Hip Roof Polygon)',
      orientationLabel: 'Orientasi Bangunan',
      orientationHint: 'Arah hadap atap utama · 0° = Utara, 90° = Timur',
      roofLength: 'Panjang Atap (X)',
      roofWidth: 'Lebar Atap (Y)',
      roofTilt: 'Kemiringan Atap (Tilt)',
      wallHeight: 'Tinggi Gedung',
      setback: 'Perimeter Setback (Jarak Tepi Aman)',
      sec02: '02 · SPESIFIKASI ARRAY PV SURYA',
      panelOrientation: 'Orientasi Modul',
      panelWp: 'Kapasitas Modul (Wp)',
      rowGap: 'Jarak Antar-Baris',
      rackTilt: 'Sudut Racking (Flat)',
      obstacleLabel: 'Obstacle / Modul Nonaktif:',
      resetObstacles: 'Reset Obstacle',
      sec03: '03 · GEOMETRI BESS & SURYA',
      bessChemistry: 'Kimia BESS',
      siteLocation: 'Zona Iklim / Lokasi',
      siteRiau: 'Kepulauan Riau (PSH 4.9h)',
      bessKwh: 'Kapasitas BESS (Usable Energy)',
      sunHour: 'Jam Surya (3D Sun Raycasting)',
      windLabel: 'Arah Angin',
      windHint: 'Arah tiupan angin, ditunjukkan panah di viewport 3D',
      kpiKwp: 'Kapasitas PV Terpasang',
      kpiYield: 'Hasil Energi Tahunan',
      kpiYieldUnit: 'MWh/thn',
      kpiBess: 'Spesifikasi Penyimpanan BESS',
      kpiSavings: 'Penghematan Tahunan & CO₂',
      camTop: 'Denah Atas',
      camSide: 'Elevasi',
      hintText: 'Drag: Putar 3D · Scroll: Zoom · ',
      hintStrong: 'Klik Modul PV: Toggle Obstacle (Cerobong/Skylight)',
      sec04: '04 · PROFIL DISPATCH 24 JAM (ATURAN SEDERHANA)',
      sec04Desc: 'Profil pembangkitan PV, pengisian/pengosongan BESS, dan pemangkasan beban puncak (Peak Shaving)',
      sizingLabel: 'Sizing Sederhana (Rule-Based)',
      shadingTitle: 'ANALISIS SHADING BENTUK ATAP (RAYCAST 3D)',
      shadingDesc: 'Rugi shading dari geometri atap: lereng menaungi lereng, bayangan bubungan, dan obstacle. Dihitung dengan raycast dari tiap modul ke arah matahari pada 12 hari representatif (tanggal 15 tiap bulan, dari terbit hingga terbenam matahari).',
      shadingRun: 'Hitung Shading',
      shadingRunning: 'Menghitung... {v}%',
      shadingNotRun: 'Belum dihitung. Angka energi di atas belum termasuk rugi shading bentuk atap.',
      shadingStale: 'Geometri berubah saat perhitungan berjalan. Hitung ulang untuk memperbarui.',
      shadingAnnual: 'Rugi shading tahunan',
      shadingCorrected: 'Yield terkoreksi: {v} MWh/thn (tanpa shading: {u} MWh/thn)',
      shadingPerSlope: 'Per lereng',
      shadingMonthly: 'Per bulan',
      shadingModules: '{n} modul · {m} titik sampel',
      shadingSplit: 'Beam {b}% · Diffuse {d}% · fraksi diffuse asumsi {f}%',
      shadingBeamNote: 'Gabungan rugi beam (sinar langsung) dan diffuse (langit terhalang); fraksi diffuse adalah asumsi nilai tipikal, dan refleksi tanah belum dihitung.',
      shadingNoModules: 'Tidak ada modul aktif untuk dianalisis.',
      specificYieldShaded: 'PR {pr}% · {kwh} kWh/hari · Shading {sh}%',
      slopeFlat: 'Datar',
      legendLoad: 'Beban Site (kW)',
      northLegend: 'Utara',
      railRoof: 'Arsitektur Atap',
      railPv: 'Array PV Surya',
      railBess: 'BESS & Surya',
      railCollapse: 'Sembunyikan panel',
      railExpand: 'Tampilkan panel',
      windLegend: 'Angin {deg}°',
      compassVal: '{deg}° · {dir}',
      dirN: 'Utara',
      dirNE: 'Timur Laut',
      dirE: 'Timur',
      dirSE: 'Tenggara',
      dirS: 'Selatan',
      dirSW: 'Barat Daya',
      dirW: 'Barat',
      dirNW: 'Barat Laut',
      savingsIdr: 'Rp {v} Jt/thn',
      savingsEur: '€ {v}/thn',
      rafterSlope: 'Lebar Kemiringan Kasau: {v} m',
      sunElevation: 'Elevasi Matahari: {v}°',
      activeModules: '{n} modul aktif ({wp} Wp)',
      specificYield: 'PR {pr}% · {kwh} kWh/hari',
      co2Avoided: '{v} tCO₂/thn dihindari'
    },
    en: {
      subtitle: '3D Rooftop Solar PV Geometry, Shadow Raycasting & BESS Dispatch Studio',
      currency: 'Currency',
      language: 'Language',
      sec01: '01 · ROOFTOP ARCHITECTURE',
      roofTypeLabel: '3D Roof Structure Typology',
      roofOptGableDual: 'Dual-Slope Gable Roof',
      roofOptGableSingle: 'Single-Side Active Gable Roof',
      roofOptFlat: 'Flat Concrete Roof + Tilt Racking (Flat C&I)',
      roofOptShed: 'Mono-Pitch / Shed Roof',
      roofOptHip: 'Hip Roof Polygon (3D)',
      orientationLabel: 'Building Orientation',
      orientationHint: 'Main roof facing · 0° = North, 90° = East',
      roofLength: 'Roof Length (X)',
      roofWidth: 'Roof Width (Y)',
      roofTilt: 'Roof Tilt',
      wallHeight: 'Building Height',
      setback: 'Perimeter Setback (Edge Safety Distance)',
      sec02: '02 · SOLAR PV ARRAY SPEC',
      panelOrientation: 'Module Orientation',
      panelWp: 'Module Capacity (Wp)',
      rowGap: 'Row Spacing',
      rackTilt: 'Racking Angle (Flat)',
      obstacleLabel: 'Obstacle / Disabled Modules:',
      resetObstacles: 'Reset Obstacles',
      sec03: '03 · BESS & SOLAR GEOMETRY',
      bessChemistry: 'BESS Chemistry',
      siteLocation: 'Climate Zone / Location',
      siteRiau: 'Riau Archipelago (PSH 4.9h)',
      bessKwh: 'BESS Capacity (Usable Energy)',
      sunHour: 'Solar Time (3D Sun Raycasting)',
      windLabel: 'Wind Direction',
      windHint: 'Wind blowing direction, shown by the arrow in the 3D viewport',
      kpiKwp: 'Installed PV Capacity',
      kpiYield: 'Annual Energy Yield',
      kpiYieldUnit: 'MWh/yr',
      kpiBess: 'BESS Storage Spec',
      kpiSavings: 'Annual Savings & CO₂',
      camTop: 'Top Plan',
      camSide: 'Elevation',
      hintText: 'Drag: Rotate 3D · Scroll: Zoom · ',
      hintStrong: 'Click PV Module: Toggle Obstacle (Chimney/Skylight)',
      sec04: '04 · 24H DISPATCH PROFILE (SIMPLE RULE-BASED)',
      sec04Desc: 'PV generation profile, BESS charge/discharge, and peak shaving',
      sizingLabel: 'Simple Rule-Based Sizing',
      shadingTitle: 'ROOF-SHAPE SHADING ANALYSIS (3D RAYCAST)',
      shadingDesc: 'Shading loss from the roof geometry: slopes shading slopes, ridge shadows, and obstacles. Computed by raycasting from each module toward the sun on 12 representative days (the 15th of each month, from sunrise to sunset).',
      shadingRun: 'Run Shading Analysis',
      shadingRunning: 'Computing... {v}%',
      shadingNotRun: 'Not computed yet. The energy figures above exclude roof-shape shading loss.',
      shadingStale: 'Geometry changed while computing. Re-run to update.',
      shadingAnnual: 'Annual shading loss',
      shadingCorrected: 'Corrected yield: {v} MWh/yr (unshaded: {u} MWh/yr)',
      shadingPerSlope: 'Per slope',
      shadingMonthly: 'Monthly',
      shadingModules: '{n} modules · {m} sample points',
      shadingSplit: 'Beam {b}% · Diffuse {d}% · assumed diffuse fraction {f}%',
      shadingBeamNote: 'Combined direct-beam and diffuse (sky-view) loss; the diffuse fraction is a typical-value assumption, and ground reflection is not included.',
      shadingNoModules: 'No active modules to analyze.',
      specificYieldShaded: 'PR {pr}% · {kwh} kWh/day · Shading {sh}%',
      slopeFlat: 'Flat',
      legendLoad: 'Site Load (kW)',
      northLegend: 'North',
      railRoof: 'Roof Architecture',
      railPv: 'Solar PV Array',
      railBess: 'BESS & Solar',
      railCollapse: 'Hide panel',
      railExpand: 'Show panel',
      windLegend: 'Wind {deg}°',
      compassVal: '{deg}° · {dir}',
      dirN: 'North',
      dirNE: 'Northeast',
      dirE: 'East',
      dirSE: 'Southeast',
      dirS: 'South',
      dirSW: 'Southwest',
      dirW: 'West',
      dirNW: 'Northwest',
      savingsIdr: 'Rp {v} M/yr',
      savingsEur: '€ {v}/yr',
      rafterSlope: 'Rafter Slope Width: {v} m',
      sunElevation: 'Sun Elevation: {v}°',
      activeModules: '{n} active modules ({wp} Wp)',
      specificYield: 'PR {pr}% · {kwh} kWh/day',
      co2Avoided: '{v} tCO₂/yr avoided'
    }
  },

  t(key, vars) {
    let s = (this.strings[this.lang] && this.strings[this.lang][key]) || this.strings.en[key] || key;
    if (vars) {
      for (const k in vars) {
        s = s.split('{' + k + '}').join(String(vars[k]));
      }
    }
    return s;
  },

  apply() {
    document.documentElement.lang = this.lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = this.t(el.dataset.i18n);
    });
    const label = document.getElementById('language-label');
    if (label) label.textContent = this.lang === 'id' ? 'Indonesia' : 'English';
  },

  setLanguage(lang) {
    this.lang = lang === 'en' ? 'en' : 'id';
    try {
      localStorage.setItem('rooftop-lang', this.lang);
    } catch (e) {
      /* storage unavailable (private mode): keep the session choice only */
    }
    this.apply();
  },

  init() {
    let saved = null;
    try {
      saved = localStorage.getItem('rooftop-lang');
    } catch (e) {
      saved = null;
    }
    this.lang = saved === 'en' ? 'en' : 'id';
    this.apply();
  }
};
