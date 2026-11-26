/**
 * map-draw.js
 * Free Satellite Map Roof & Keepout/Obstacle Polygon Drawer
 * (Leaflet + Esri World Imagery + Nominatim).
 * Zero API keys, zero billing. Supports drawing 1 main roof polygon plus
 * multiple interior keepout / 3D obstacle exclusion zones (skylights, HVAC,
 * shafts, no-PV zones) with custom obstacle height (m).
 */

const MapRoofDrawer = {
  map: null,
  labelLayer: null,
  labelsVisible: true,

  // Active draw mode: 'roof' | 'keepout'
  drawMode: 'roof',
  vertices: [],            // main roof vertices: [{ lat, lng }, ...]
  markers: [],             // Leaflet draggable markers for active roof
  edgeLabels: [],          // Leaflet distance labels for active polygon
  polygonLayer: null,
  polylineLayer: null,

  // Interior keepout / obstacle exclusion zones
  keepouts: [],            // completed: [{ vertices: [{lat,lng},...], heightM: number }, ...]
  activeKeepout: [],       // currently being drawn keepout vertices
  activeKeepoutMarkers: [],
  keepoutLayers: [],       // rendered Leaflet polygons for completed + active keepout

  onApplyCallback: null,
  lastComputed: null,

  // Performance & realism guardrails (browser Three.js + 3D raycast + 1GiB Cloud Run):
  // 10,000 m2 (1 ha, ~1.4x FIFA pitch, ~2,500-3,000 panels / ~1.5-1.8 MWp), max side 200 m.
  MAX_ROOF_AREA_M2: 10000,
  MAX_ROOF_DIM_M: 200,
  MIN_ROOF_AREA_M2: 10,

  SITE_CENTERS: {
    jakarta: [-6.2088, 106.8456, 18],
    bali: [-8.6705, 115.2126, 18],
    riau: [1.1301, 104.0529, 18],
    oskarshamn: [57.2657, 16.4474, 18]
  },

  _validateGeometry(geom) {
    if (!geom) return { ok: false, reason: 'incomplete' };
    if (geom.grossAreaM2 > this.MAX_ROOF_AREA_M2 || geom.lengthM > this.MAX_ROOF_DIM_M || geom.widthM > this.MAX_ROOF_DIM_M) {
      return { ok: false, reason: 'too_large' };
    }
    if (geom.grossAreaM2 < this.MIN_ROOF_AREA_M2) {
      return { ok: false, reason: 'too_small' };
    }
    return { ok: true, reason: null };
  },

  init(onApply) {
    this.onApplyCallback = onApply;
    const modal = document.getElementById('map-modal');
    if (!modal) return;

    const closeBtn = document.getElementById('map-close');
    const cancelBtn = document.getElementById('map-cancel');
    const undoBtn = document.getElementById('map-undo');
    const clearBtn = document.getElementById('map-clear');
    const applyBtn = document.getElementById('map-apply');
    const labelsToggle = document.getElementById('map-toggle-labels');
    const searchForm = document.getElementById('map-search-form');
    const locateBtn = document.getElementById('map-locate');
    const finishKeepoutBtn = document.getElementById('map-finish-keepout');

    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.close());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.close();
    });

    if (undoBtn) undoBtn.addEventListener('click', () => this.undoVertex());
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearAll());
    if (finishKeepoutBtn) {
      finishKeepoutBtn.addEventListener('click', () => this.finishActiveKeepout());
    }
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        if (this.activeKeepout.length >= 3) this.finishActiveKeepout();
        if (!this.lastComputed || !this._validateGeometry(this.lastComputed).ok) return;
        if (this.onApplyCallback) this.onApplyCallback(this.lastComputed);
        this.close();
      });
    }

    document.querySelectorAll('.map-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-map-mode') === 'keepout' ? 'keepout' : 'roof';
        this.setDrawMode(mode);
      });
    });

    if (labelsToggle) {
      labelsToggle.addEventListener('click', () => {
        if (!this.map || !this.labelLayer) return;
        this.labelsVisible = !this.labelsVisible;
        if (this.labelsVisible) {
          this.labelLayer.addTo(this.map);
        } else {
          this.map.removeLayer(this.labelLayer);
        }
        labelsToggle.classList.toggle('bg-brand', this.labelsVisible);
        labelsToggle.classList.toggle('text-white', this.labelsVisible);
      });
    }
    if (searchForm) {
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('map-search-input');
        if (input && input.value.trim()) this.searchAddress(input.value.trim());
      });
    }
    if (locateBtn) {
      locateBtn.addEventListener('click', () => this.locateUser());
    }

    document.querySelectorAll('.map-jump-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-site');
        const c = this.SITE_CENTERS[key];
        if (c && this.map) this.map.setView([c[0], c[1]], c[2]);
      });
    });
  },

  setDrawMode(mode) {
    if (this.drawMode === 'keepout' && this.activeKeepout.length >= 3) {
      this.finishActiveKeepout();
    }
    this.drawMode = mode;
    document.querySelectorAll('.map-mode-btn').forEach((b) => {
      const active = b.getAttribute('data-map-mode') === mode;
      b.classList.toggle('cam-active', active);
    });
    const koControls = document.getElementById('map-keepout-controls');
    if (koControls) koControls.classList.toggle('hidden', mode !== 'keepout');
    this._updateMetrics();
  },

  _currentKeepoutHeight() {
    const el = document.getElementById('map-keepout-height');
    const v = el ? parseFloat(el.value) : 1.0;
    return isFinite(v) && v >= 0 ? Math.min(20, v) : 1.0;
  },

  finishActiveKeepout() {
    if (this.activeKeepout.length < 3) return;
    this.keepouts.push({
      vertices: this.activeKeepout.map((p) => ({ lat: p.lat, lng: p.lng })),
      heightM: this._currentKeepoutHeight()
    });
    this.activeKeepout = [];
    this.activeKeepoutMarkers.forEach((m) => this.map && this.map.removeLayer(m));
    this.activeKeepoutMarkers = [];
    this._redraw();
  },

  open(siteKey, existingLatLon) {
    const modal = document.getElementById('map-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    if (typeof L === 'undefined') {
      const st = document.getElementById('map-search-status');
      if (st) st.textContent = 'Leaflet belum termuat. Periksa koneksi internet.';
      return;
    }

    const center = this.SITE_CENTERS[siteKey] || this.SITE_CENTERS.jakarta;
    if (!this.map) {
      this.map = L.map('map-canvas', {
        center: [center[0], center[1]],
        zoom: center[2],
        maxZoom: 21,
        zoomControl: true
      });

      // Esri World Imagery (high-res satellite tiles, free, no API key)
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics',
          maxNativeZoom: 19,
          maxZoom: 21
        }
      ).addTo(this.map);

      // Optional Esri place/road reference overlay
      this.labelLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxNativeZoom: 19, maxZoom: 21, opacity: 0.85 }
      ).addTo(this.map);

      this.map.on('click', (e) => {
        this.addVertex(e.latlng.lat, e.latlng.lng);
      });
    } else if (existingLatLon && existingLatLon.length >= 3) {
      const avgLat = existingLatLon.reduce((a, p) => a + p[0], 0) / existingLatLon.length;
      const avgLon = existingLatLon.reduce((a, p) => a + p[1], 0) / existingLatLon.length;
      this.map.setView([avgLat, avgLon], 19);
    } else {
      this.map.setView([center[0], center[1]], center[2]);
    }

    if (this.vertices.length === 0 && existingLatLon && existingLatLon.length >= 3) {
      const prevMode = this.drawMode;
      this.drawMode = 'roof';
      existingLatLon.forEach(([lat, lon]) => this.addVertex(lat, lon, true));
      this.drawMode = prevMode;
      this._redraw();
    }

    this._updateMetrics();
    setTimeout(() => {
      if (this.map) this.map.invalidateSize();
    }, 150);
  },

  close() {
    const modal = document.getElementById('map-modal');
    if (modal) modal.classList.add('hidden');
  },

  addVertex(lat, lng, silent = false) {
    const pt = { lat, lng };
    if (this.drawMode === 'keepout') {
      const idx = this.activeKeepout.length;
      this.activeKeepout.push(pt);
      const icon = L.divIcon({
        className: 'map-keepout-handle',
        html: `<span>${idx + 1}</span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });
      const marker = L.marker([lat, lng], { draggable: true, icon }).addTo(this.map);
      marker.on('drag', (ev) => {
        const pos = ev.target.getLatLng();
        pt.lat = pos.lat;
        pt.lng = pos.lng;
        this._redraw();
      });
      this.activeKeepoutMarkers.push(marker);
    } else {
      const idx = this.vertices.length;
      this.vertices.push(pt);
      const icon = L.divIcon({
        className: 'map-vertex-handle',
        html: `<span>${idx + 1}</span>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      const marker = L.marker([lat, lng], { draggable: true, icon }).addTo(this.map);
      marker.on('drag', (ev) => {
        const pos = ev.target.getLatLng();
        pt.lat = pos.lat;
        pt.lng = pos.lng;
        this._redraw();
      });
      this.markers.push(marker);
    }

    if (!silent) this._redraw();
  },

  undoVertex() {
    if (this.drawMode === 'keepout') {
      if (this.activeKeepout.length > 0) {
        this.activeKeepout.pop();
        const m = this.activeKeepoutMarkers.pop();
        if (m && this.map) this.map.removeLayer(m);
        this._redraw();
        return;
      }
      if (this.keepouts.length > 0) {
        this.keepouts.pop();
        this._redraw();
        return;
      }
    }
    if (this.vertices.length === 0) return;
    this.vertices.pop();
    const m = this.markers.pop();
    if (m && this.map) this.map.removeLayer(m);
    this._redraw();
  },

  clearAll() {
    this.vertices = [];
    this.markers.forEach((m) => this.map && this.map.removeLayer(m));
    this.markers = [];
    this.keepouts = [];
    this.activeKeepout = [];
    this.activeKeepoutMarkers.forEach((m) => this.map && this.map.removeLayer(m));
    this.activeKeepoutMarkers = [];
    this.setDrawMode('roof');
    this._redraw();
  },

  _clearDrawLayers() {
    if (!this.map) return;
    if (this.polygonLayer) { this.map.removeLayer(this.polygonLayer); this.polygonLayer = null; }
    if (this.polylineLayer) { this.map.removeLayer(this.polylineLayer); this.polylineLayer = null; }
    this.edgeLabels.forEach((l) => this.map.removeLayer(l));
    this.edgeLabels = [];
    this.keepoutLayers.forEach((l) => this.map.removeLayer(l));
    this.keepoutLayers = [];
  },

  _haversineMeters(a, b) {
    const R = 6371000;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  },

  _redraw() {
    this._clearDrawLayers();
    const latlngs = this.vertices.map((v) => [v.lat, v.lng]);

    if (latlngs.length >= 3) {
      this.polygonLayer = L.polygon(latlngs, {
        color: '#12579B',
        weight: 2.5,
        fillColor: '#F5E214',
        fillOpacity: 0.30
      }).addTo(this.map);
    } else if (latlngs.length === 2) {
      this.polylineLayer = L.polyline(latlngs, {
        color: '#12579B',
        weight: 2.5,
        dashArray: '6 4'
      }).addTo(this.map);
    }

    // Distance label on each roof segment
    const n = this.vertices.length;
    const segCount = n >= 3 ? n : Math.max(0, n - 1);
    for (let i = 0; i < segCount; i++) {
      const a = this.vertices[i];
      const b = this.vertices[(i + 1) % n];
      const dist = this._haversineMeters(a, b);
      if (dist < 0.3) continue;
      const midLat = (a.lat + b.lat) / 2;
      const midLng = (a.lng + b.lng) / 2;
      const lbl = L.marker([midLat, midLng], {
        interactive: false,
        icon: L.divIcon({
          className: 'map-edge-label',
          html: `<span>${dist.toFixed(1)} m</span>`,
          iconSize: [52, 18],
          iconAnchor: [26, 9]
        })
      }).addTo(this.map);
      this.edgeLabels.push(lbl);
    }

    // Render completed keepout / obstacle zones (red fill + numbered label)
    this.keepouts.forEach((ko, idx) => {
      const pts = ko.vertices.map((v) => [v.lat, v.lng]);
      if (pts.length < 3) return;
      const poly = L.polygon(pts, {
        color: '#BB1326',
        weight: 2,
        dashArray: '4 3',
        fillColor: '#BB1326',
        fillOpacity: 0.42
      }).addTo(this.map);
      this.keepoutLayers.push(poly);

      const cLat = ko.vertices.reduce((s, v) => s + v.lat, 0) / ko.vertices.length;
      const cLng = ko.vertices.reduce((s, v) => s + v.lng, 0) / ko.vertices.length;
      const tag = L.marker([cLat, cLng], {
        interactive: false,
        icon: L.divIcon({
          className: 'map-keepout-tag',
          html: `<span>Obs ${idx + 1} (${ko.heightM}m)</span>`,
          iconSize: [74, 18],
          iconAnchor: [37, 9]
        })
      }).addTo(this.map);
      this.keepoutLayers.push(tag);
    });

    // Render currently-being-drawn keepout zone
    if (this.activeKeepout.length >= 2) {
      const pts = this.activeKeepout.map((v) => [v.lat, v.lng]);
      const layer = this.activeKeepout.length >= 3
        ? L.polygon(pts, { color: '#BB1326', weight: 2, dashArray: '4 3', fillColor: '#BB1326', fillOpacity: 0.35 })
        : L.polyline(pts, { color: '#BB1326', weight: 2, dashArray: '4 3' });
      layer.addTo(this.map);
      this.keepoutLayers.push(layer);
    }

    this._renderKeepoutChips();
    this._updateMetrics();
  },

  removeKeepout(index) {
    if (index < 0 || index >= this.keepouts.length) return;
    this.keepouts.splice(index, 1);
    this._redraw();
  },

  _renderKeepoutChips() {
    const listEl = document.getElementById('map-keepout-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (this.keepouts.length === 0) {
      listEl.classList.add('hidden');
      return;
    }
    listEl.classList.remove('hidden');
    this.keepouts.forEach((ko, idx) => {
      const chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-[11px] font-medium text-[#BB1326]';
      const txt = document.createElement('span');
      txt.textContent = `Obs ${idx + 1} · ${ko.heightM}m`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'hover:text-red-900 font-bold leading-none px-0.5';
      del.setAttribute('aria-label', `Hapus Obs ${idx + 1}`);
      del.textContent = '×';
      del.addEventListener('click', () => this.removeKeepout(idx));
      chip.appendChild(txt);
      chip.appendChild(del);
      listEl.appendChild(chip);
    });
  },

  _polyArea(pts) {
    let a2 = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      a2 += x0 * y1 - x1 * y0;
    }
    return Math.abs(a2) / 2;
  },

  _computeGeometry() {
    const n = this.vertices.length;
    if (n < 3) return null;

    const centerLat = this.vertices.reduce((s, v) => s + v.lat, 0) / n;
    const centerLon = this.vertices.reduce((s, v) => s + v.lng, 0) / n;

    // Local ENU projection (x = East m, y = North m) using WGS84 radii
    const latRad = (centerLat * Math.PI) / 180;
    const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
    const mPerDegLon = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);

    const toENU = (v) => [(v.lng - centerLon) * mPerDegLon, (v.lat - centerLat) * mPerDegLat];
    const xy = this.vertices.map(toENU);

    let perimeter = 0;
    let longestLen = 0;
    let longestAngle = 0;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = xy[i];
      const [x1, y1] = xy[(i + 1) % n];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const seg = Math.hypot(dx, dy);
      perimeter += seg;
      if (seg > longestLen) {
        longestLen = seg;
        longestAngle = Math.atan2(dy, dx);
      }
    }
    const grossAreaM2 = this._polyArea(xy);

    // Rotate polygon to align longest edge with X axis -> Oriented Bounding Box
    const cosA = Math.cos(-longestAngle);
    const sinA = Math.sin(-longestAngle);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const alignedXY = xy.map(([x, y]) => {
      const rx = x * cosA - y * sinA;
      const ry = x * sinA + y * cosA;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
      return [rx, ry];
    });
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const transformPt = ([x, y]) => {
      const rx = x * cosA - y * sinA - cx;
      const ry = x * sinA + y * cosA - cy;
      return [Math.round(rx * 1000) / 1000, Math.round(ry * 1000) / 1000];
    };
    const centeredAligned = alignedXY.map(([rx, ry]) => [
      Math.round((rx - cx) * 1000) / 1000,
      Math.round((ry - cy) * 1000) / 1000
    ]);

    // Project all completed + active (>=3 pts) keepout zones into the exact same local frame
    const allKeepouts = [...this.keepouts];
    if (this.activeKeepout.length >= 3) {
      allKeepouts.push({ vertices: this.activeKeepout, heightM: this._currentKeepoutHeight() });
    }
    let keepoutAreaM2 = 0;
    const keepoutsXY = allKeepouts.map((ko) => {
      const pts = ko.vertices.map((v) => transformPt(toENU(v)));
      const a = this._polyArea(pts);
      keepoutAreaM2 += a;
      return {
        xy: pts,
        heightM: ko.heightM,
        areaM2: Math.round(a * 10) / 10
      };
    });

    const lengthM = maxX - minX;
    const widthM = maxY - minY;

    // Normal to longest edge in ENU -> Compass Azimuth (0=N, 90=E, 180=S, 270=W)
    const nx1 = -Math.sin(longestAngle);
    const ny1 = Math.cos(longestAngle);
    const az1 = ((Math.atan2(nx1, ny1) * 180) / Math.PI + 360) % 360;
    const az2 = (az1 + 180) % 360;
    const targetEq = centerLat < 0 ? 0 : 180;
    const diff = (a, b) => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };
    const bestAz = diff(az1, targetEq) <= diff(az2, targetEq) ? az1 : az2;
    const orientationDeg = (Math.round(bestAz / 5) * 5) % 360;

    return {
      polygonLatLon: this.vertices.map((v) => [
        Math.round(v.lat * 1e6) / 1e6,
        Math.round(v.lng * 1e6) / 1e6
      ]),
      polygonXY: centeredAligned,
      keepouts: keepoutsXY,
      areaM2: Math.round(Math.max(0, grossAreaM2 - keepoutAreaM2) * 10) / 10,
      grossAreaM2: Math.round(grossAreaM2 * 10) / 10,
      keepoutCount: keepoutsXY.length,
      perimeterM: Math.round(perimeter * 10) / 10,
      lengthM: Math.round(lengthM * 10) / 10,
      widthM: Math.round(widthM * 10) / 10,
      orientationDeg,
      centerLat: Math.round(centerLat * 1e5) / 1e5,
      centerLon: Math.round(centerLon * 1e5) / 1e5
    };
  },

  _updateMetrics() {
    const infoEl = document.getElementById('map-metrics');
    const applyBtn = document.getElementById('map-apply');
    const finishBtn = document.getElementById('map-finish-keepout');
    const geom = this._computeGeometry();
    this.lastComputed = geom;

    if (finishBtn) {
      finishBtn.disabled = this.activeKeepout.length < 3;
    }

    if (!geom) {
      if (infoEl) {
        infoEl.classList.remove('text-red-600');
        infoEl.classList.add('text-brand');
        const left = Math.max(1, 3 - this.vertices.length);
        infoEl.textContent = I18n.t('mapDrawPrompt', { n: left });
      }
      if (applyBtn) applyBtn.disabled = true;
      return;
    }

    const check = this._validateGeometry(geom);
    if (this.polygonLayer && typeof this.polygonLayer.setStyle === 'function') {
      this.polygonLayer.setStyle(check.ok
        ? { color: '#12579B', fillColor: '#F5E214', fillOpacity: 0.30 }
        : { color: '#DC2626', fillColor: '#DC2626', fillOpacity: 0.28 }
      );
    }

    if (!check.ok) {
      if (infoEl) {
        infoEl.classList.remove('text-brand');
        infoEl.classList.add('text-red-600');
        infoEl.textContent = check.reason === 'too_large'
          ? I18n.t('mapTooLarge', {
            area: Math.round(geom.grossAreaM2).toLocaleString('id-ID'),
            l: geom.lengthM,
            w: geom.widthM,
            maxArea: this.MAX_ROOF_AREA_M2.toLocaleString('id-ID'),
            maxDim: this.MAX_ROOF_DIM_M
          })
          : I18n.t('mapTooSmall', { area: geom.grossAreaM2, minArea: this.MIN_ROOF_AREA_M2 });
      }
      if (applyBtn) applyBtn.disabled = true;
      return;
    }

    if (infoEl) {
      infoEl.classList.remove('text-red-600');
      infoEl.classList.add('text-brand');
      const koTxt = geom.keepoutCount > 0 ? ` · ${geom.keepoutCount} ${I18n.t('mapKeepoutCountUnit')}` : '';
      infoEl.textContent = `${geom.areaM2} m² · ${geom.lengthM} × ${geom.widthM} m · Az ${geom.orientationDeg}°${koTxt}`;
    }
    if (applyBtn) applyBtn.disabled = false;
  },

  async searchAddress(query) {
    const st = document.getElementById('map-search-status');
    const coordMatch = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        if (this.map) this.map.setView([lat, lon], 19);
        if (st) st.textContent = `Koordinat: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        return;
      }
    }

    if (st) st.textContent = I18n.t('mapSearching');
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const list = await res.json();
      if (!list || list.length === 0) {
        if (st) st.textContent = I18n.t('mapNotFound');
        return;
      }
      const item = list[0];
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      if (this.map) this.map.setView([lat, lon], 19);
      if (st) st.textContent = item.display_name.split(',').slice(0, 3).join(', ');
    } catch (err) {
      if (st) st.textContent = I18n.t('mapSearchError');
    }
  },

  locateUser() {
    const st = document.getElementById('map-search-status');
    if (!navigator.geolocation) {
      if (st) st.textContent = 'Geolocation tidak didukung browser.';
      return;
    }
    if (st) st.textContent = I18n.t('mapSearching');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (this.map) this.map.setView([pos.coords.latitude, pos.coords.longitude], 19);
        if (st) st.textContent = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      },
      () => {
        if (st) st.textContent = I18n.t('mapSearchError');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }
};
