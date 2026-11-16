/**
 * shading.js
 * Roof-shape shading analysis by 3D raycasting.
 *
 * Why this exists: PVWatts (the PySAM model behind the API) assumes a
 * single flat array plane, so it cannot see shading caused by the roof
 * shape itself: one slope shading another, the ridge shadow at low sun,
 * hip geometry, chimneys, or the BESS container. This analyzer measures
 * that shading from the actual 3D scene the user designed.
 *
 * Method:
 * - 12 representative days (the 15th of each month), hours 07:00-17:00
 *   solar time, true sun positions from Solar.sunPosition.
 * - Each active module is sampled at 5 points (center + 4 corners).
 *   From each point a ray is cast toward the sun; a hit on any roof
 *   mesh (other slope, ridge, wall, obstacle, BESS, neighbouring
 *   module) before the sun means that point is shaded.
 * - Each timestep is weighted by clear-sky beam energy
 *   (DNI x cos(incidence)); the annual loss is shaded beam energy
 *   divided by total beam energy. Months are weighted by days.
 *
 * Scope (honest): this is DIRECT-BEAM shading only. Diffuse shading
 * (sky-view reduction) is not included, so the true total shading loss
 * is slightly higher than the reported number. Modules facing away from
 * the sun at a given hour receive no beam, so they contribute no weight
 * for that hour (they are not counted as shaded).
 */

const ShadingAnalyzer = {
  REPRESENTATIVE_HOURS: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  RAY_FAR: 80,
  SAMPLE_OFFSET: 0.06, // metres above the module surface along its normal

  /**
   * Run the analysis on the current scene.
   * onProgress(fraction, label) is called after each month so the UI can
   * show progress. Returns a result object, or null when no active
   * modules exist. The call is chunked with awaited timeouts so the
   * browser stays responsive.
   */
  async analyze(state, scene3d, onProgress) {
    const lat = (EnergyModel.locations[state.siteLocation] || EnergyModel.locations.jakarta).lat;
    scene3d.scene.updateMatrixWorld(true);

    const modules = this._collectModules(state, scene3d);
    if (modules.length === 0) return null;
    const occluders = this._collectOccluders(scene3d);

    const raycaster = new THREE.Raycaster();
    raycaster.far = this.RAY_FAR;

    const monthly = [];
    const perSlope = {};
    let totalEnergy = 0;
    let totalShaded = 0;
    const monthDays = [];

    for (let month = 1; month <= 12; month++) {
      const doy = Solar.midMonthDay(month);
      const days = Solar.daysInMonth(month);
      monthDays.push(days);
      let mEnergy = 0;
      let mShaded = 0;

      for (const hour of this.REPRESENTATIVE_HOURS) {
        const sun = Solar.sunPosition(doy, hour, lat);
        if (sun.elevationDeg <= 1) continue; // sun effectively down
        const dir = Solar.sunDirection(sun.elevationDeg, sun.azimuthDeg);
        const dni = Solar.clearSkyDni(sun.elevationDeg);
        const sunVec = new THREE.Vector3(dir.x, dir.y, dir.z);

        for (const mod of modules) {
          const cosInc = sunVec.dot(mod.normal);
          if (cosInc <= 0) continue; // sun behind the module plane: no beam
          const weight = dni * cosInc;
          let shadedPoints = 0;
          for (const pt of mod.points) {
            raycaster.set(pt, sunVec);
            if (raycaster.intersectObjects(occluders, false).length > 0) shadedPoints++;
          }
          const frac = shadedPoints / mod.points.length;
          mEnergy += weight;
          mShaded += frac * weight;
          const slope = perSlope[mod.side] || (perSlope[mod.side] = { energy: 0, shaded: 0, modules: 0 });
          slope.energy += weight * days;
          slope.shaded += frac * weight * days;
        }
      }

      monthly.push(mEnergy > 0 ? (mShaded / mEnergy) * 100 : 0);
      totalEnergy += mEnergy * days;
      totalShaded += mShaded * days;

      if (onProgress) onProgress(month / 12, month);
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
    }

    const perSlopeOut = {};
    for (const side of Object.keys(perSlope)) {
      const s = perSlope[side];
      perSlopeOut[side] = {
        lossPercent: s.energy > 0 ? (s.shaded / s.energy) * 100 : 0,
        modules: modules.filter((m) => m.side === side).length
      };
    }

    return {
      annualLossPercent: totalEnergy > 0 ? (totalShaded / totalEnergy) * 100 : 0,
      monthlyLossPercent: monthly,
      perSlope: perSlopeOut,
      moduleCount: modules.length,
      samplePoints: modules.length * 5,
      latitude: lat,
      computedAt: new Date().toISOString()
    };
  },

  // Active modules only (holder groups). Obstacle cylinders are meshes,
  // not groups, so they are occluders but never sample targets.
  _collectModules(state, scene3d) {
    const portrait = state.panelOrientation === 'portrait';
    const pW = portrait ? 1.134 : 2.278;
    const pH = portrait ? 2.278 : 1.134;
    const hx = pW / 2 - 0.12;
    const hz = pH / 2 - 0.12;
    const localPts = [
      [0, 0],
      [-hx, -hz],
      [hx, -hz],
      [-hx, hz],
      [hx, hz]
    ];

    const modules = [];
    for (const holder of scene3d.panelMeshes) {
      if (!holder.isGroup) continue;
      const slotKey = (holder.userData && holder.userData.slotKey) || '';
      const side = slotKey.split('-')[0] || '?';
      const normal = new THREE.Vector3(0, 1, 0);
      normal.applyQuaternion(holder.getWorldQuaternion(new THREE.Quaternion()));
      const points = localPts.map(([lx, lz]) => {
        const p = new THREE.Vector3(lx, 0.03, lz);
        holder.localToWorld(p);
        p.addScaledVector(normal, this.SAMPLE_OFFSET);
        return p;
      });
      modules.push({ side, normal, points });
    }
    return modules;
  },

  // Every mesh under rootGroup can cast a shadow: roof slabs, walls,
  // BESS container, obstacles, and the modules themselves.
  _collectOccluders(scene3d) {
    const meshes = [];
    scene3d.rootGroup.traverse((obj) => {
      if (obj.isMesh) meshes.push(obj);
    });
    return meshes;
  }
};
