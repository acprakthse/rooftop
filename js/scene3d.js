/**
 * scene3d.js
 * Three.js WebGL 3D Rooftop Architecture, Solar Panel Array Placement,
 * Obstacle Raycasting & Sun-Path Shadow Simulation
 */

const Scene3D = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  rootGroup: null,
  panelsGroup: null,
  sunLight: null,
  sunSphere: null,
  raycaster: new THREE.Raycaster(),
  mouse: new THREE.Vector2(),
  panelMeshes: [],
  disabledSlots: new Set(),
  onToggleObstacle: null,

  init(containerId, onToggleCallback) {
    const container = document.getElementById(containerId);
    this.onToggleObstacle = onToggleCallback;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070a12);
    this.scene.fog = new THREE.FogExp2(0x070a12, 0.0085);

    this.camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 400);
    this.camera.position.set(28, 22, 30);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.target.set(0, 4, 0);

    // Ambient & Directional Sun Light
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.65);
    this.scene.add(hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfffbeb, 1.25);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    const d = 35;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.scene.add(this.sunLight);

    // Glowing Sun Indicator Sphere
    const sunGeo = new THREE.SphereGeometry(1.1, 20, 20);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    this.sunSphere = new THREE.Mesh(sunGeo, sunMat);
    this.scene.add(this.sunSphere);

    // Ground Grid
    const groundGeo = new THREE.PlaneGeometry(160, 160);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x090d18, roughness: 0.95 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(100, 50, 0x1e293b, 0x111827);
    grid.position.y = 0.02;
    this.scene.add(grid);

    this.rootGroup = new THREE.Group();
    this.panelsGroup = new THREE.Group();
    this.scene.add(this.rootGroup);
    this.scene.add(this.panelsGroup);

    // Click Raycasting for Obstacles
    let pointerDownPos = { x: 0, y: 0 };
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    this.renderer.domElement.addEventListener('pointerup', (e) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 5) return; // Ignore drag movements

      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hits = this.raycaster.intersectObjects(this.panelMeshes, true);
      if (hits.length > 0) {
        let obj = hits[0].object;
        while (obj && obj.userData.slotKey === undefined && obj.parent) {
          obj = obj.parent;
        }
        if (obj && obj.userData.slotKey) {
          const key = obj.userData.slotKey;
          if (this.disabledSlots.has(key)) {
            this.disabledSlots.delete(key);
          } else {
            this.disabledSlots.add(key);
          }
          if (this.onToggleObstacle) this.onToggleObstacle();
        }
      }
    });

    window.addEventListener('resize', () => {
      if (!container) return;
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(container.clientWidth, container.clientHeight);
    });

    const animate = () => {
      requestAnimationFrame(animate);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  },

  setCameraPreset(preset) {
    if (preset === 'top') {
      this.camera.position.set(0, 42, 0.01);
    } else if (preset === 'side') {
      this.camera.position.set(0, 10, 38);
    } else {
      this.camera.position.set(28, 22, 30);
    }
    this.controls.target.set(0, 4, 0);
    this.controls.update();
  },

  updateSunPosition(sunHour) {
    // Map 6.5 .. 17.5 to angle
    const norm = (sunHour - 6) / 12; // 0 to 1
    const angle = norm * Math.PI;
    const radius = 38;
    const x = -Math.cos(angle) * radius;
    const y = Math.max(4, Math.sin(angle) * radius);
    const z = 12;

    this.sunLight.position.set(x, y, z);
    this.sunSphere.position.set(x, y, z);

    const elevDeg = Math.round((Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI);
    return elevDeg;
  },

  buildScene(state) {
    // Clear previous meshes
    while (this.rootGroup.children.length > 0) {
      this.rootGroup.remove(this.rootGroup.children[0]);
    }
    while (this.panelsGroup.children.length > 0) {
      this.panelsGroup.remove(this.panelsGroup.children[0]);
    }
    this.panelMeshes = [];

    const L = state.roofLength;
    const W = state.roofWidth;
    const H = state.wallHeight;
    const tiltRad = (state.roofTilt * Math.PI) / 180;

    // 1. Building Base Walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x162032, roughness: 0.85 });
    const wallGeo = new THREE.BoxGeometry(L, H, W);
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.position.y = H / 2;
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    this.rootGroup.add(wallMesh);

    // 2. BESS Container Unit next to building (Cyan accent)
    if (state.bessKwh > 0) {
      const bessLen = Math.min(8, Math.max(2.5, state.bessKwh / 50));
      const bessGeo = new THREE.BoxGeometry(bessLen, 2.5, 2.4);
      const bessMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.4, metalness: 0.3 });
      const bessMesh = new THREE.Mesh(bessGeo, bessMat);
      bessMesh.position.set(L / 2 + 3.2, 1.25, -W / 4);
      bessMesh.castShadow = true;
      this.rootGroup.add(bessMesh);
    }

    // 3. Roof Structure & Solar Panel Planes
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x26334d, roughness: 0.7, side: THREE.DoubleSide });
    const halfW = W / 2;
    let activePanelsCount = 0;
    let rafterLength = halfW;

    const pW = state.panelOrientation === 'portrait' ? 1.134 : 2.278;
    const pH = state.panelOrientation === 'portrait' ? 2.278 : 1.134;

    if (state.roofType === 'gable-dual' || state.roofType === 'gable-single' || state.roofType === 'hip') {
      const ridgeH = Math.tan(tiltRad) * halfW;
      rafterLength = halfW / Math.cos(tiltRad);

      // Create South & North Slope Planes
      [-1, 1].forEach((sideSign) => {
        const slopeGroup = new THREE.Group();
        slopeGroup.position.set(0, H + ridgeH / 2, (sideSign * halfW) / 2);
        slopeGroup.rotation.x = sideSign * tiltRad;

        const roofSlabGeo = new THREE.BoxGeometry(L + 0.4, 0.22, rafterLength + 0.2);
        const roofSlab = new THREE.Mesh(roofSlabGeo, roofMat);
        roofSlab.castShadow = true;
        roofSlab.receiveShadow = true;
        slopeGroup.add(roofSlab);
        this.rootGroup.add(slopeGroup);

        const populateThisSide = state.roofType !== 'gable-single' || sideSign === 1;
        if (populateThisSide) {
          activePanelsCount += this.populateSlopePanels(
            slopeGroup,
            L,
            rafterLength,
            pW,
            pH,
            state,
            sideSign === 1 ? 'S' : 'N',
            0
          );
        }
      });
    } else if (state.roofType === 'shed') {
      const riseH = Math.tan(tiltRad) * W;
      rafterLength = W / Math.cos(tiltRad);

      const slopeGroup = new THREE.Group();
      slopeGroup.position.set(0, H + riseH / 2, 0);
      slopeGroup.rotation.x = tiltRad;

      const roofSlabGeo = new THREE.BoxGeometry(L + 0.4, 0.24, rafterLength + 0.2);
      const roofSlab = new THREE.Mesh(roofSlabGeo, roofMat);
      roofSlab.castShadow = true;
      roofSlab.receiveShadow = true;
      slopeGroup.add(roofSlab);
      this.rootGroup.add(slopeGroup);

      activePanelsCount += this.populateSlopePanels(slopeGroup, L, rafterLength, pW, pH, state, 'SHED', 0);
    } else if (state.roofType === 'flat-tilt') {
      rafterLength = W;
      const flatGroup = new THREE.Group();
      flatGroup.position.set(0, H + 0.15, 0);

      const roofSlabGeo = new THREE.BoxGeometry(L + 0.4, 0.3, W + 0.4);
      const roofSlab = new THREE.Mesh(roofSlabGeo, roofMat);
      roofSlab.receiveShadow = true;
      flatGroup.add(roofSlab);
      this.rootGroup.add(flatGroup);

      activePanelsCount += this.populateSlopePanels(
        flatGroup,
        L,
        W,
        pW,
        pH,
        state,
        'FLAT',
        (state.rackTilt * Math.PI) / 180
      );
    }

    return { activePanelsCount, rafterLength };
  },

  populateSlopePanels(parentGroup, availLen, availSlopeWidth, pW, pH, state, sideId, localRackTiltRad) {
    const setback = state.roofSetback;
    const usableX = Math.max(0, availLen - 2 * setback);
    const usableZ = Math.max(0, availSlopeWidth - 2 * setback);

    const colStep = pW + 0.025;
    const rowStep = pH * Math.cos(localRackTiltRad) + state.rowGap;

    const cols = Math.floor((usableX + 0.025) / colStep);
    const rows = Math.floor((usableZ + state.rowGap) / rowStep);

    if (cols <= 0 || rows <= 0) return 0;

    const totalGridW = cols * colStep - 0.025;
    const totalGridZ = rows * rowStep - state.rowGap;

    const startX = -totalGridW / 2 + pW / 2;
    const startZ = -totalGridZ / 2 + pH / 2;

    const pvMat = new THREE.MeshStandardMaterial({
      color: 0x0f2942,
      roughness: 0.2,
      metalness: 0.65
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.5 });
    const obstacleMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 });

    let count = 0;

    for (let r = 0; r < rows; r++) {
      // Hip roof trapezoid clipping
      let hipMarginCols = 0;
      if (state.roofType === 'hip') {
        const normRow = r / Math.max(1, rows - 1);
        hipMarginCols = Math.floor((1 - normRow) * (cols * 0.28));
      }

      for (let c = hipMarginCols; c < cols - hipMarginCols; c++) {
        const slotKey = `${sideId}-${r}-${c}`;
        const posX = startX + c * colStep;
        const posZ = startZ + r * rowStep;

        if (this.disabledSlots.has(slotKey)) {
          // Render 3D Obstacle (HVAC / Chimney)
          const obsGeo = new THREE.CylinderGeometry(0.32, 0.36, 0.9, 16);
          const obsMesh = new THREE.Mesh(obsGeo, obstacleMat);
          obsMesh.position.set(posX, 0.55, posZ);
          obsMesh.castShadow = true;
          obsMesh.userData = { slotKey };
          parentGroup.add(obsMesh);
          this.panelMeshes.push(obsMesh);
        } else {
          const holder = new THREE.Group();
          holder.position.set(posX, 0.2 + Math.sin(localRackTiltRad) * (pH / 2), posZ);
          holder.rotation.x = localRackTiltRad;
          holder.userData = { slotKey };

          const frameGeo = new THREE.BoxGeometry(pW, 0.045, pH);
          const frameMesh = new THREE.Mesh(frameGeo, frameMat);

          const cellGeo = new THREE.BoxGeometry(pW - 0.05, 0.052, pH - 0.05);
          const cellMesh = new THREE.Mesh(cellGeo, pvMat);
          cellMesh.castShadow = true;
          cellMesh.receiveShadow = true;

          holder.add(frameMesh);
          holder.add(cellMesh);
          parentGroup.add(holder);
          this.panelMeshes.push(holder);
          count++;
        }
      }
    }

    return count;
  }
};
