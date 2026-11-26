/**
 * map-draw.js
 * Free Satellite Map Roof Polygon Drawer (Leaflet + Esri World Imagery + Nominatim).
 * Zero API keys, zero billing. Converts drawn (lat, lon) roof vertices into local ENU
 * meters, computes oriented bounding box (L x W), area, perimeter, and main-edge azimuth,
 * and hands the result to the 3D scene and Stage 1-3 backend pipeline.
 */

const MapRoofDrawer = {
  map: null,
  labelLayer: null,
  labelsVisible: true,
  vertices: [],        // [{ lat, lng }, ...]
  markers: [],         // Leaflet draggable vertex markers
  edgeLabels: [],      // Leaflet distance tooltips on each edge
  polygonLayer: null,
  polylineLayer: null,
  onApplyCallback: null,
  lastComputed: null,

  SITE_CENTERS: {
    jakarta: [-6.2088, 106.8456, 18],
    bali: [-8.6705, 115.2126, 18],
    riau: [1.1301, 104.0529, 18],
    oskarshamn: [57.2657, 16.4474, 18]
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

    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.close());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.close();
    });

    if (undoBtn) undoBtn.addEventListener('click', () => this.undoVertex());
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearAll());
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        if (!this.lastComputed) return;
        if (this.onApplyCallback) this.onApplyCallback(this.lastComputed);
        this.close();
      });
    }
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

    // Load existing polygon if present and canvas is currently empty
    if (this.vertices.length === 0 && existingLatLon && existingLatLon.length >= 3) {
      existingLatLon.forEach(([lat, lon]) => this.addVertex(lat, lon, true));
      this._redraw();
    }

    setTimeout(() => {
      if (this.map) this.map.invalidateSize();
    }, 120);
  },

  close() {
    const modal = document.getElementById('map-modal');
    if (modal) modal.classList.add('hidden');
  },

  addVertex(lat, lng, silent = false) {
    const idx = this.vertices.length;
    const pt = { lat, lng };
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

    if (!silent) this._redraw();
  },

  undoVertex() {
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
    this._redraw();
  },

  _clearDrawLayers() {
    if (!this.map) return;
    if (this.polygonLayer) { this.map.removeLayer(this.polygonLayer); this.polygonLayer = null; }
    if (this.polylineLayer) { this.map.removeLayer(this.polylineLayer); this.polylineLayer = null; }
    this.edgeLabels.forEach((l) => this.map.removeLayer(l));
    this.edgeLabels = [];
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
        fillOpacity: 0.32
      }).addTo(this.map);
    } else if (latlngs.length === 2) {
      this.polylineLayer = L.polyline(latlngs, {
        color: '#12579B',
        weight: 2.5,
        dashArray: '6 4'
      }).addTo(this.map);
    }

    // Distance label on each segment
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

    this._updateMetrics();
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

    const xy = this.vertices.map((v) => [
      (v.lng - centerLon) * mPerDegLon,
      (v.lat - centerLat) * mPerDegLat
    ]);

    // Shoelace area & perimeter
    let area2 = 0;
    let perimeter = 0;
    let longestLen = 0;
    let longestAngle = 0; // angle of longest edge in ENU (atan2(dy, dx))
    for (let i = 0; i < n; i++) {
      const [x0, y0] = xy[i];
      const [x1, y1] = xy[(i + 1) % n];
      area2 += x0 * y1 - x1 * y0;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const seg = Math.hypot(dx, dy);
      perimeter += seg;
      if (seg > longestLen) {
        longestLen = seg;
        longestAngle = Math.atan2(dy, dx);
      }
    }
    const areaM2 = Math.abs(area2) / 2;

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
    // Centered in local roof coordinates (x along eave, y perpendicular)
    const centeredAligned = alignedXY.map(([rx, ry]) => [
      Math.round((rx - cx) * 1000) / 1000,
      Math.round((ry - cy) * 1000) / 1000
    ]);

    const lengthM = maxX - minX;
    const widthM = maxY - minY;

    // Normal to longest edge in ENU -> Compass Azimuth (0=N, 90=E, 180=S, 270=W)
    // Pick the normal direction facing the equator (North for Southern Hemisphere, South for Northern)
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
      areaM2: Math.round(areaM2 * 10) / 10,
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
    const geom = this._computeGeometry();
    this.lastComputed = geom;

    if (!geom) {
      if (infoEl) {
        const left = 3 - this.vertices.length;
        infoEl.textContent = I18n.t('mapDrawPrompt', { n: left });
      }
      if (applyBtn) applyBtn.disabled = true;
      return;
    }

    if (infoEl) {
      infoEl.textContent = `${geom.areaM2} m² · ${geom.lengthM} × ${geom.widthM} m · Az ${geom.orientationDeg}° · (${geom.centerLat}, ${geom.centerLon})`;
    }
    if (applyBtn) applyBtn.disabled = false;
  },

  async searchAddress(query) {
    const st = document.getElementById('map-search-status');
    // Support direct "lat, lon" paste (e.g. from Google Maps)
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
