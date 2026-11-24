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
 * Method (beam): 12 representative days (the 15th of each month),
 * sampled hourly from sunrise to sunset solar time
 * (Solar.daylightHours). The full sun-up period matters because
 * self-shading happens at low sun. Each active module is sampled at 5
 * points (center + 4 corners). From each point a ray is cast toward
 * the sun; a hit on any roof mesh (other slope, ridge, wall, obstacle,
 * BESS, neighbouring module) before the sun means that point is
 * shaded. Each timestep is weighted by clear-sky beam energy
 * (DNI x cos(incidence)); the annual beam loss is shaded beam energy
 * divided by total beam energy. Months are weighted by days.
 *
 * Method (diffuse): the sky-view factor per module, from a one-time
 * hemisphere raycast (Fibonacci lattice, 200 directions above the
 * module plane, module center only). Directions below the horizon see
 * the ground, not the sky, and are excluded. Diffuse loss =
 * 1 - (unblocked sky-weighted sum / unobstructed sum). This is the
 * part a beam-only model misses: for a symmetric gable roof the
 * opposite slope hides only sky the module cannot see anyway, so the
 * gable beam loss is genuinely ~0 and the residual diffuse loss comes
 * mainly from the end walls; for flat-tilt rows and hip ends the
 * diffuse loss is larger.
 *
 * Combined loss = beam x (1 - diffuseFraction) + diffuse x
 * diffuseFraction, with the location's assumed annual diffuse
 * fraction (EnergyModel.locations[].diffuseFraction: typical values,
 * not measured, replace with TMY-derived fractions when weather data
 * is available). Ground-reflected diffuse (albedo) is not modeled.
 */

const ShadingAnalyzer = {
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
    const loc = EnergyModel.locations[state.siteLocation] || EnergyModel.locations.jakarta;
    const lat = loc.lat;
    const fDiff = loc.diffuseFraction != null ? loc.diffuseFraction : 0.4;
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

      // Full sun-up period for this day (e.g. 06-18 Jakarta, 04-20
      // Oskarshamn in June, 09-15 Oskarshamn in December).
      for (const hour of Solar.daylightHours(doy, lat)) {
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

      if (onProgress) onProgress((month / 12) * 0.9, month);
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
    }

    // Diffuse (sky-view) pass: one-time hemisphere raycast, then combine
    // with the beam result using the location's assumed diffuse fraction.
    // Diffuse loss is time-independent, so monthly combined values reuse
    // the annual diffuse loss. The pass is chunked (progress 90-100%)
    // so the UI never freezes on slower devices.
    const diffuse = await this._diffuseLoss(modules, occluders, raycaster, onProgress);
    const beamAnnual = totalEnergy > 0 ? (totalShaded / totalEnergy) * 100 : 0;
    const combinedAnnual = beamAnnual * (1 - fDiff) + diffuse.annual * fDiff;
    const monthlyCombined = monthly.map((b) => b * (1 - fDiff) + diffuse.annual * fDiff);

    const perSlopeOut = {};
    for (const side of Object.keys(perSlope)) {
      const s = perSlope[side];
      const beam = s.energy > 0 ? (s.shaded / s.energy) * 100 : 0;
      const diff = diffuse.perSlope[side] != null ? diffuse.perSlope[side] : 0;
      perSlopeOut[side] = {
        lossPercent: beam * (1 - fDiff) + diff * fDiff,
        beamLossPercent: beam,
        diffuseLossPercent: diff,
        modules: modules.filter((m) => m.side === side).length
      };
    }

    return {
      annualLossPercent: combinedAnnual,
      beamLossPercent: beamAnnual,
      diffuseLossPercent: diffuse.annual,
      diffuseFraction: fDiff,
      monthlyLossPercent: monthlyCombined,
      monthlyBeamLossPercent: monthly,
      perSlope: perSlopeOut,
      moduleCount: modules.length,
      samplePoints: modules.length * 5,
      latitude: lat,
      computedAt: new Date().toISOString()
    };
  },

  // Diffuse shading: sky-view factor per module from a one-time
  // hemisphere raycast. Directions use a Fibonacci lattice (uniform
  // over the hemisphere above the module plane); each carries weight
  // cos(incidence). Directions below the horizon see ground, not sky,
  // and are excluded from both sums. Returns { annual, perSlope } in %.
  // Async + chunked so the UI stays responsive on slower devices.
  async _diffuseLoss(modules, occluders, raycaster, onProgress) {
    const dirs = this._fibonacciHemisphere(200);
    const perSlope = {};
    let totalFree = 0;
    let totalBlocked = 0;

    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      // Orthonormal basis around the module normal.
      const n = mod.normal;
      const ref = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const t1 = new THREE.Vector3().crossVectors(n, ref).normalize();
      const t2 = new THREE.Vector3().crossVectors(n, t1);
      const origin = mod.points[0]; // module center, already offset above the surface
      let sFree = 0;
      let sBlocked = 0;
      for (const d of dirs) {
        const worldDir = new THREE.Vector3()
          .addScaledVector(t1, d.x)
          .addScaledVector(t2, d.y)
          .addScaledVector(n, d.z);
        if (worldDir.y <= 0) continue; // below the horizon: ground, not sky
        sFree += d.z;
        raycaster.set(origin, worldDir);
        if (raycaster.intersectObjects(occluders, false).length === 0) sBlocked += d.z;
      }
      totalFree += sFree;
      totalBlocked += sBlocked;
      const s = perSlope[mod.side] || (perSlope[mod.side] = { free: 0, blocked: 0 });
      s.free += sFree;
      s.blocked += sBlocked;
      if (i % 16 === 15) {
        if (onProgress) onProgress(0.9 + 0.1 * ((i + 1) / modules.length));
        await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
      }
    }
    if (onProgress) onProgress(1);

    const perSlopeOut = {};
    for (const side of Object.keys(perSlope)) {
      const s = perSlope[side];
      perSlopeOut[side] = s.free > 0 ? (1 - s.blocked / s.free) * 100 : 0;
    }
    return {
      annual: totalFree > 0 ? (1 - totalBlocked / totalFree) * 100 : 0,
      perSlope: perSlopeOut
    };
  },

  // Uniform directions over the hemisphere z > 0 (z = module normal),
  // Fibonacci lattice, each sample carrying equal solid angle.
  _fibonacciHemisphere(count) {
    const dirs = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const z = 1 - (i + 0.5) / count; // 1 .. ~0
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const theta = goldenAngle * i;
      dirs.push({ x: r * Math.cos(theta), y: r * Math.sin(theta), z });
    }
    return dirs;
  },

  // Active modules only (holder groups). Obstacle cylinders are meshes,
  // not groups, so they are occluders but never sample targets.
  _collectModules(state, scene3d) {
    const portrait = state.panelOrientation === 'portrait';
    const modW = (state.customModule && state.customModule.width) ? state.customModule.width : 1.134;
    const modL = (state.customModule && state.customModule.length) ? state.customModule.length : 2.278;
    const pW = portrait ? modW : modL;
    const pH = portrait ? modL : modW;
    const hx = Math.max(0.05, pW / 2 - 0.12);
    const hz = Math.max(0.05, pH / 2 - 0.12);
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
