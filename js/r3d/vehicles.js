// Hopscape 3D — js/r3d/vehicles.js — cars, trucks, tractor, planes, contrails,
// lingering trails, plane ground shadows, plane edge warnings (CONTRACT.md §6.3).
//
// Classic-script IIFE. Registers R3D.vehicles = { init, carLane, updateGlobals }.
//
//  - carLane(r, row) -> Part          pooled car/truck meshes for a road row
//  - updateGlobals(frame)             tractor slots (World.tractors() diff),
//                                     plane slots (frame.planes), lingering
//                                     trail slots (frame.trails)
//
// Conventions honored (§2.1): cars use PADDED lane x (R3D.LX); tractor + plane
// use RAW column x (R3D.X, no PAD, no +0.5). Models face +X, rotation.y = PI
// mirrors for dir < 0 (the 2D scale(-1,1) convention). All animation is a pure
// function of frame.t / world state — zero per-frame allocation.
//
// Shared geometry doctrine (§5.6): every model is ONE merged vertex-colored
// BufferGeometry cached in R3D.assets (car keys quantize drawn width to 1/16
// tile), drawn with R3D.MAT.opaque. Pools: cars 40, trucks 12 (measured
// worst-case window demand + margin); planes 4, trails 6, tractors 2 slots.
(function () {
  'use strict';

  const THREE = window.THREE, R3D = window.R3D;
  if (!THREE || !R3D || !R3D.util) {
    console.error('[R3D vehicles] window.THREE / window.R3D missing — load order broken');
    return;
  }

  const PX = R3D.PX;
  const PAL = R3D.PAL;
  const tint = R3D.util.tint;
  const merge = R3D.util.mergeGeoms;

  // ---------------- committed numbers ----------------
  const ROAD_TOP = -0.05;              // road slab top (§2.2)
  const AXLE = 6.5 * PX;               // car/truck axle height = tire radius 0.102
  const BOB_AMP = 0.8 * PX;            // car bob ±0.8 px (verbatim)
  const PLANE_Y = 1.5;                 // plane / contrail / trail / warning height (§2.2)
  const EDGE = 6.44;                   // plane on-screen bound (±) and contrail edge x
  const WARN_X = 5.156;                // "!" 22 px in from the entry edge
  const TRAIL_LIFE = 8;                // seconds (main.js :66)
  const HUB_TINT = '#75777a';          // white 0.35 over tire #2a2d33, pre-blended
  const PIPE_GREY = '#555a66';         // tractor exhaust pipe (spec-local color)
  const SMOKE_GREY = '#a0a0a8';        // rgb(160,160,168) smoke puffs
  const EMPTY = [];

  let worldG = null;                   // ctx3.worldGroup (set in init)

  // Reusable temps for matrix composition (module-level — never per frame)
  const TMP_M = new THREE.Matrix4();
  const TMP_P = new THREE.Vector3();
  const TMP_Q = new THREE.Quaternion();
  const TMP_S = new THREE.Vector3();

  // Shared unit sphere, grey-tinted. Lambert (vertexColors) reads the grey for
  // tractor smoke; MeshBasic ignores the color attribute and renders white for
  // trail puffs — one geometry serves both. NEVER disposed.
  const UNIT_SPHERE = tint(new THREE.SphereGeometry(1, 10, 8), SMOKE_GREY);

  // ================================================================
  // Geometry helpers
  // ================================================================

  // Rounded-rect side profile (the 2D rrf silhouette) extruded across depth,
  // centered on all three axes. r clamps like the 2D helper.
  function rrGeo(w, h, r, depth) {
    r = Math.min(r, w / 2, h / 2);
    const x = -w / 2, y = -h / 2;
    const s = new THREE.Shape();
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, -depth / 2);
    return g;
  }

  function cylZ(r, len, seg) {           // cylinder, axis along Z (wheels, window discs)
    const g = new THREE.CylinderGeometry(r, r, len, seg || 12);
    g.rotateX(Math.PI / 2);
    return g;
  }

  function cylX(r, len, seg) {           // cylinder, axis along X (head/tail lights)
    const g = new THREE.CylinderGeometry(r, r, len, seg || 10);
    g.rotateZ(Math.PI / 2);
    return g;
  }

  // 4 tires + hub dots + headlights (front, +X) + taillights (rear) — shared by
  // car and truck (verbatim 2D placement: wheels r 6.5 px at ±0.28w on the axle
  // line, lights at 11 px above the axle).
  function addRunningGear(parts, w, D) {
    const zt = D / 2 - 0.015;            // tire centers tuck under the body, poke out 0.03
    for (let sz = -1; sz <= 1; sz += 2) {
      for (let sx = -1; sx <= 1; sx += 2) {
        let g = cylZ(6.5 * PX, 0.09, 12);
        g.translate(sx * 0.28 * w, AXLE, sz * zt);
        parts.push(tint(g, PAL.tire));
        g = cylZ(2.4 * PX, 0.016, 8);
        g.translate(sx * 0.28 * w, AXLE, sz * (zt + 0.051));
        parts.push(tint(g, HUB_TINT));
      }
      let g = cylX(3 * PX, 0.03, 10);                       // headlight #fff3ad
      g.translate(w / 2 + 0.006, AXLE + 11 * PX, sz * 0.135);
      parts.push(tint(g, PAL.headlight));
      g = cylX(2.4 * PX, 0.026, 8);                         // taillight #ff5a5f
      g.translate(-w / 2 - 0.005, AXLE + 11 * PX, sz * 0.135);
      parts.push(tint(g, PAL.warnRed));
    }
  }

  // Car (kind 0-4). w = drawn length in units (c.w * 0.88), quantized to 1/16.
  function carGeo(kind, w) {
    const wq = Math.round(w * 16);
    const key = 'veh:car:' + (kind % 5) + ':' + wq;
    return R3D.assets.get(key, function () {
      const wl = wq / 16;
      const body = PAL.CAR_COLORS[kind % 5];
      const D = 0.52;
      const parts = [];
      // body: full length × 22 px tall, r9 — spans axle+2 .. axle+24 px
      let g = rrGeo(wl, 22 * PX, 9 * PX, D);
      g.translate(0, AXLE + 13 * PX, 0);
      parts.push(tint(g, body));
      // glass canopy band (proud of the body sides so the windows read in 3D)
      g = rrGeo(wl * 0.55, 10 * PX, 5 * PX, D + 0.012);
      g.translate(-wl * 0.025, AXLE + 16 * PX, 0);
      parts.push(tint(g, PAL.glass));
      // body-color pillar splitting the canopy into two windows
      g = new THREE.BoxGeometry(4 * PX, 10 * PX, D + 0.02);
      g.translate(-wl * 0.05 + 2 * PX, AXLE + 16 * PX, 0);
      parts.push(tint(g, body));
      addRunningGear(parts, wl, D);
      return merge(parts);
    });
  }

  // Delivery truck (kind 9): tall cargo box rear 62%, shorter blue cab front 40%.
  function truckGeo(w) {
    const wq = Math.round(w * 16);
    const key = 'veh:truck:' + wq;
    return R3D.assets.get(key, function () {
      const wl = wq / 16;
      const D = 0.56;
      const parts = [];
      // cargo box: rear 62% × 28 px tall (top at axle+30 px = 0.47)
      let g = rrGeo(wl * 0.62, 28 * PX, 4 * PX, D);
      g.translate(-0.19 * wl, AXLE + 16 * PX, 0);
      parts.push(tint(g, PAL.truckBox));
      // blue cab: front 40% × 22 px tall
      g = rrGeo(wl * 0.4, 22 * PX, 6 * PX, D - 0.06);
      g.translate(0.3 * wl, AXLE + 13 * PX, 0);
      parts.push(tint(g, PAL.CAR_COLORS[1]));
      // cab window band (proud of both cab sides)
      g = rrGeo(wl * 0.2, 9 * PX, 3 * PX, D - 0.05);
      g.translate(0.28 * wl, AXLE + 16.5 * PX, 0);
      parts.push(tint(g, PAL.cabWindow));
      // two horizontal box stripes (proud of both box sides)
      for (let k = 0; k < 2; k++) {
        g = rrGeo(wl * 0.45, 3 * PX, 1.5 * PX, D + 0.012);
        g.translate(-wl / 2 + 5 * PX + 0.225 * wl, AXLE + (k === 0 ? 22.5 : 14.5) * PX, 0);
        parts.push(tint(g, PAL.truckStripe));
      }
      addRunningGear(parts, wl, D);
      return merge(parts);
    });
  }

  // Tractor. 2D local y maps to height via (10 - y2d)/64 (2D ground line y=+10:
  // rear wheel center -2 r12 and front center +2 r7 both bottom out at 0).
  function tractorGeo() {
    return R3D.assets.get('veh:tractor', function () {
      const Y = function (px) { return (10 - px) * PX; };
      const parts = [];
      // pusher blade out front: thin in X, 0.34 tall, sweeps most of the row in Z
      let g = new THREE.BoxGeometry(7 * PX, 22 * PX, 0.82);
      g.translate(21.5 * PX, (Y(-18) + Y(4)) / 2, 0);
      parts.push(tint(g, PAL.steel));
      g = new THREE.BoxGeometry(5 * PX, 4 * PX, 0.12);      // connecting arm
      g.translate(17.5 * PX, (Y(-10) + Y(-6)) / 2, 0);
      parts.push(tint(g, PAL.steelDark));
      // main body
      g = rrGeo(34 * PX, 17 * PX, 4 * PX, 0.44);
      g.translate(-1 * PX, (Y(-22) + Y(-5)) / 2, 0);
      parts.push(tint(g, PAL.tractor[0]));
      // darker hood panel at the front (proud in Z + front face)
      g = rrGeo(11.5 * PX, 14 * PX, 3 * PX, 0.47);
      g.translate(11.75 * PX, (Y(-19) + Y(-5)) / 2, 0);
      parts.push(tint(g, PAL.tractor[1]));
      // rear cab + window band
      g = rrGeo(15 * PX, 16 * PX, 3 * PX, 0.46);
      g.translate(-10.5 * PX, (Y(-36) + Y(-20)) / 2, 0);
      parts.push(tint(g, PAL.tractor[2]));
      g = rrGeo(9 * PX, 9 * PX, 2 * PX, 0.48);
      g.translate(-10.5 * PX, (Y(-33) + Y(-24)) / 2, 0);
      parts.push(tint(g, PAL.cabWindow));
      // exhaust pipe
      g = new THREE.BoxGeometry(3.5 * PX, 12 * PX, 3.5 * PX);
      g.translate(4.75 * PX, (Y(-32) + Y(-20)) / 2, 0);
      parts.push(tint(g, PIPE_GREY));
      // wheels: BIG rear r 12 px + small front r 7 px, mustard hubs
      for (let sz = -1; sz <= 1; sz += 2) {
        g = cylZ(12 * PX, 0.11, 14);
        g.translate(-9 * PX, 12 * PX, sz * 0.19);
        parts.push(tint(g, PAL.tire));
        g = cylZ(5 * PX, 0.02, 10);
        g.translate(-9 * PX, 12 * PX, sz * 0.252);
        parts.push(tint(g, PAL.hub));
        g = cylZ(7 * PX, 0.09, 12);
        g.translate(12 * PX, 7 * PX, sz * 0.19);
        parts.push(tint(g, PAL.tire));
        g = cylZ(3 * PX, 0.018, 8);
        g.translate(12 * PX, 7 * PX, sz * 0.244);
        parts.push(tint(g, PAL.hub));
      }
      return merge(parts);
    });
  }

  // One swept wing plate. Shape in (chord x, span) plane, extruded to `thick`,
  // rotated flat so span runs along ±Z. topY = final top surface height.
  function wingGeo(x0, x1, xt, span, thick, side, topY, color) {
    const s = new THREE.Shape();
    s.moveTo(x0, 0);
    s.lineTo(xt, span);
    s.lineTo(x1, 0);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
    if (side > 0) { g.rotateX(Math.PI / 2); g.translate(0, topY, 0); }        // span -> +Z
    else { g.rotateX(-Math.PI / 2); g.translate(0, topY - thick, 0); }        // span -> -Z
    return tint(g, color);
  }

  // Plane: white capsule fuselage, red belly stripe + tail fin, symmetric swept
  // wings (+Z near #4aa3ff / -Z far #3d8fe0), cockpit + 3 round windows.
  function planeGeo() {
    return R3D.assets.get('veh:plane', function () {
      const parts = [];
      // fuselage capsule: Ø 0.28, total length 0.78, axis X
      let g = new THREE.CapsuleGeometry(0.14, 0.50, 5, 14);
      g.rotateZ(Math.PI / 2);
      parts.push(tint(g, PAL.rocketBody));
      // red belly stripe (2D: 5 px band just under the centerline)
      g = new THREE.BoxGeometry(0.70, 5 * PX, 0.26);
      g.translate(0, -4.5 * PX, 0);
      parts.push(tint(g, PAL.rocketRed));
      // vertical tail fin rising to 0.375 (2D tri -22,-4 / -22,-24 / -8,-4)
      const s = new THREE.Shape();
      s.moveTo(-0.344, 0.0625);
      s.lineTo(-0.344, 0.375);
      s.lineTo(-0.125, 0.0625);
      s.closePath();
      g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false });
      g.translate(0, 0, -0.0175);
      parts.push(tint(g, PAL.rocketRed));
      // main swept wings, low-mounted
      parts.push(wingGeo(0.12, -0.14, -0.22, 0.45, 0.035, 1, -0.03, '#4aa3ff'));
      parts.push(wingGeo(0.12, -0.14, -0.22, 0.45, 0.035, -1, -0.03, '#3d8fe0'));
      // small tail stabilizers (3D silhouette of the 2D rear-down wing)
      parts.push(wingGeo(-0.24, -0.36, -0.40, 0.17, 0.03, 1, 0.075, '#4aa3ff'));
      parts.push(wingGeo(-0.24, -0.36, -0.40, 0.17, 0.03, -1, 0.075, '#3d8fe0'));
      // cockpit canopy near the nose
      g = new THREE.BoxGeometry(0.125, 6 * PX, 0.25);
      g.translate(0.297, 0.0625, 0);
      parts.push(tint(g, PAL.porthole));
      // 3 round cabin windows, both sides (2D x -10 / -2 / +6, 3 px above center)
      const wx = [-0.156, -0.031, 0.094];
      for (let i = 0; i < 3; i++) {
        for (let sz = -1; sz <= 1; sz += 2) {
          g = cylZ(2.4 * PX, 0.012, 8);
          g.translate(wx[i], 3 * PX, sz * 0.134);
          parts.push(tint(g, PAL.porthole));
        }
      }
      return merge(parts);
    });
  }

  // Shared flat unit ribbon (lies in XZ, faces +Y, u along X) — active contrail
  // gradient ribbon AND lingering trail ribbon both scale this.
  function ribbonGeo() {
    return R3D.assets.get('veh:ribbon', function () {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      return g;
    });
  }

  // 64×2 white alpha gradient: 0.1 (u=0, entry edge) -> 0.75 (u=1, plane tail).
  function gradTex() {
    return R3D.assets.get('veh:contrailGrad', function () {
      return R3D.util.canvasTex(64, 2, function (ctx) {
        const g = ctx.createLinearGradient(0, 0, 64, 0);
        g.addColorStop(0, 'rgba(255,255,255,0.1)');
        g.addColorStop(1, 'rgba(255,255,255,0.75)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 2);
      });
    });
  }

  // ================================================================
  // Pools — cars 40, trucks 12 (a 40-run sim of the real world.js gen over the
  // 23-row cache window peaked at 33 cars / 9 trucks; + margin). Geometry is
  // swapped per acquire (all geometries shared via R3D.assets — never disposed).
  // ================================================================
  const carPool = new R3D.Pool(function () {
    const m = new THREE.Mesh(carGeo(0, 0.88), R3D.MAT.opaque);
    m.castShadow = true;
    return m;
  }, 40, 'cars');

  const truckPool = new R3D.Pool(function () {
    const m = new THREE.Mesh(truckGeo(1.7 * 0.88), R3D.MAT.opaque);
    m.castShadow = true;
    return m;
  }, 12, 'trucks');

  // ================================================================
  // carLane(r, row) -> Part — one pooled mesh per row.cars entry (the count is
  // fixed for the row's life; only c.x moves).
  // ================================================================
  function carLane(r, row) {
    const group = new THREE.Group();
    const token = {};                                        // per-Part pool ownership
    const meshes = [];
    const isTruck = [];
    const cars = (row && row.cars) ? row.cars : EMPTY;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const truck = c.kind === 9;
      const m = truck ? truckPool.acquire(token) : carPool.acquire(token);
      m.geometry = truck ? truckGeo(c.w * 0.88) : carGeo(c.kind, c.w * 0.88);
      m.visible = true;
      m.rotation.y = row.dir < 0 ? Math.PI : 0;
      group.add(m);
      meshes.push(m);
      isTruck.push(truck);
    }
    return {
      group: group,
      update: function (row, frame) {
        const cars = row.cars;
        const t = frame.t;
        const rotY = row.dir < 0 ? Math.PI : 0;
        for (let i = 0; i < meshes.length; i++) {
          const m = meshes[i];
          if (!(isTruck[i] ? truckPool : carPool).owns(m, token)) continue;  // stolen
          const c = cars[i];
          const sx = (c.x - 2.5) * 64;                       // 2D screen-px phase term
          m.position.x = R3D.LX(c.x);                        // PADDED lane coords
          m.position.y = ROAD_TOP + Math.sin((t + c.seed) * 9 + sx * 0.05) * BOB_AMP;
          m.rotation.y = rotY;
        }
      },
      dispose: function () {
        for (let i = 0; i < meshes.length; i++) {
          const m = meshes[i];
          (isTruck[i] ? truckPool : carPool).release(m, token);   // no-op if stolen
        }
        meshes.length = 0;
      },
    };
  }

  // ================================================================
  // Global slot machinery — persistent groups in worldGroup, diffed by object
  // identity against a live list every frame. Zero allocation, bounded counts.
  // ================================================================
  function makeSlots(n) {
    const s = [];
    for (let i = 0; i < n; i++) s.push({ ref: null, root: null });
    return s;
  }

  function diffSlots(slots, list, ensure, onAcquire) {
    for (let i = 0; i < slots.length; i++) {              // release stale slots
      const s = slots[i];
      if (s.ref !== null && list.indexOf(s.ref) === -1) {
        s.ref = null;
        if (s.root) s.root.visible = false;
      }
    }
    for (let j = 0; j < list.length; j++) {               // bind new items
      const item = list[j];
      let have = false, free = null;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s.ref === item) { have = true; break; }
        if (free === null && s.ref === null) free = s;
      }
      if (!have && free !== null) {
        ensure(free);
        if (free.root) {
          free.ref = item;
          free.root.visible = true;
          if (onAcquire) onAcquire(free, item);
        }
      }
    }
  }

  // ---------------- 1. TRACTOR (2 slots) ----------------
  const tractorSlots = makeSlots(2);

  function ensureTractor(s) {
    if (s.root) return;
    const root = new THREE.Group();
    const m = new THREE.Mesh(tractorGeo(), R3D.MAT.opaque);
    m.castShadow = true;
    root.add(m);
    s.smoke = [];
    for (let i = 0; i < 3; i++) {
      const mat = R3D.MAT.transparentBase.clone();        // same shader program
      mat.depthWrite = false;
      const p = new THREE.Mesh(UNIT_SPHERE, mat);
      p.renderOrder = 3;
      root.add(p);
      s.smoke.push(p);
    }
    root.visible = false;
    s.root = root;
    worldG.add(root);
  }

  function updateTractors(frame) {
    const list = (typeof World !== 'undefined' && World.tractors) ? World.tractors() : EMPTY;
    diffSlots(tractorSlots, list, ensureTractor);
    const t = frame.t;
    for (let i = 0; i < tractorSlots.length; i++) {
      const s = tractorSlots[i];
      if (s.ref === null) continue;
      const tt = s.ref;
      s.root.position.set(R3D.X(tt.x), 0, R3D.Z(tt.row)); // RAW column x — no PAD, no +0.5
      s.root.rotation.y = tt.dir < 0 ? Math.PI : 0;
      for (let k = 0; k < 3; k++) {                        // verbatim puff formulas
        const ph = (t * 0.9 + k * 0.33) % 1;
        const p = s.smoke[k];
        p.position.set((5 + Math.sin(t * 3 + k * 2) * 3) * PX, 0.71875 + ph * 0.3125, 0);
        p.scale.setScalar((3 + ph * 5) * PX);
        p.material.opacity = 0.5 * (1 - ph);
      }
    }
  }

  // ---------------- 2. PLANES (4 slots) ----------------
  const planeSlots = makeSlots(4);

  function ensurePlane(s) {
    if (s.root) return;
    const root = new THREE.Group();                        // z = row Z; children x = worldX
    s.body = new THREE.Group();                            // bob + mirror live here
    const m = new THREE.Mesh(planeGeo(), R3D.MAT.opaque);  // castShadow = false: blob owns it
    s.body.add(m);
    root.add(s.body);
    s.blob = R3D.util.blob(30 * PX, 6 * PX, 'rgba(20,30,50,0.15)');  // cool ground shadow
    root.add(s.blob);
    const mat = new THREE.MeshBasicMaterial({
      map: gradTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    s.rib = new THREE.Mesh(ribbonGeo(), mat);              // active contrail
    s.rib.renderOrder = 5;
    s.rib.position.y = PLANE_Y;
    root.add(s.rib);
    s.warn = R3D.util.warnSprite();                        // blinking edge "!"
    s.warn.scale.set(0.41, 0.41, 1);
    root.add(s.warn);
    root.visible = false;
    s.root = root;
    worldG.add(root);
  }

  function updatePlanes(frame) {
    const list = frame.planes || EMPTY;
    diffSlots(planeSlots, list, ensurePlane);
    const t = frame.t;
    for (let i = 0; i < planeSlots.length; i++) {
      const s = planeSlots[i];
      if (s.ref === null) continue;
      const p = s.ref;
      const wx = p.x - 5.5;                                // RAW column units
      const on = wx > -EDGE && wx < EDGE;
      s.root.position.z = R3D.Z(p.row);
      s.body.position.set(wx, PLANE_Y + Math.sin(t * 7) * 2 * PX, 0);
      s.body.rotation.y = p.dir < 0 ? Math.PI : 0;
      s.blob.position.x = wx;                              // y stays 0.024 (blob-owned)
      s.blob.visible = on;
      // contrail: edge (entry side) -> 42 px behind the nose; exists while the
      // plane is still off-screen approaching (hidden only until it has length)
      const edge = p.dir > 0 ? -EDGE : EDGE;
      const tail = wx - p.dir * 42 * PX;
      if ((tail - edge) * p.dir > 0.01) {
        s.rib.visible = true;
        s.rib.position.x = (edge + tail) / 2;
        s.rib.scale.set(tail - edge, 1, 7 * PX);           // signed X flips the gradient
      } else {
        s.rib.visible = false;
      }
      s.warn.position.set(p.dir > 0 ? -WARN_X : WARN_X, PLANE_Y, 0);
      s.warn.visible = !on && Math.sin(t * 12) > -0.3;     // verbatim blink duty cycle
    }
  }

  // ---------------- 3. LINGERING TRAILS (6 slots) ----------------
  const trailSlots = makeSlots(6);

  function ensureTrail(s) {
    if (s.root) return;
    const root = new THREE.Group();
    s.ribMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
    });
    s.rib = new THREE.Mesh(ribbonGeo(), s.ribMat);
    s.rib.renderOrder = 5;
    s.rib.position.y = PLANE_Y;
    s.rib.scale.set(12.2, 1, 7 * PX);                      // x -6.1 .. +6.1, thickness 7 px
    root.add(s.rib);
    s.puffMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false,
    });
    s.puffs = new THREE.InstancedMesh(UNIT_SPHERE, s.puffMat, 13);
    s.puffs.renderOrder = 3;
    s.puffs.frustumCulled = false;                         // instances span the row width
    root.add(s.puffs);
    root.visible = false;
    s.root = root;
    worldG.add(root);
  }

  // Deterministic per row — positioned ONCE on acquire (verbatim 2D hashes:
  // 13 puffs every 56 px from x=20, x jitter row*37%30, radius 6 + (px*13+row*7)%4).
  function acquireTrail(s, l) {
    const row = l.row;
    s.root.position.z = R3D.Z(row);
    for (let i = 0; i < 13; i++) {
      const px = 20 + i * 56;
      TMP_P.set((px + (row * 37 % 30)) / 64 - 5.5, PLANE_Y, 0);
      const rad = (6 + (px * 13 + row * 7) % 4) / 64;
      TMP_S.set(rad, rad, rad);
      TMP_M.compose(TMP_P, TMP_Q, TMP_S);
      s.puffs.setMatrixAt(i, TMP_M);
    }
    s.puffs.instanceMatrix.needsUpdate = true;
  }

  function updateTrails(frame) {
    const list = frame.trails || EMPTY;
    diffSlots(trailSlots, list, ensureTrail, acquireTrail);
    for (let i = 0; i < trailSlots.length; i++) {
      const s = trailSlots[i];
      if (s.ref === null) continue;
      const a = Math.max(0, 1 - s.ref.age / TRAIL_LIFE) * 0.5;   // alpha 0.5 -> 0 over 8 s
      s.ribMat.opacity = a;
      s.puffMat.opacity = a * 0.7;
    }
  }

  // ================================================================
  // Hook + registration
  // ================================================================
  function updateGlobals(frame) {
    if (!worldG) return;
    updateTractors(frame);
    updatePlanes(frame);
    updateTrails(frame);
  }

  R3D.register('vehicles', {
    init: function (c) { worldG = c.worldGroup; },
    carLane: carLane,
    updateGlobals: updateGlobals,
  });
})();
