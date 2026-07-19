// Hopscape 3D — js/r3d/props.js — static props for grass rows (CONTRACT.md §6.2).
//
// Owns: TREES (seeded variation, merged per row, removable when the tractor
// flattens them), FLOWERS (stored jitter, hidden inside the tractor dirt span),
// HOLES (layered dark decal), COINS (pooled, bob + real Y-spin + halo + sparkle
// + blob shadow), the ROCKET assembly (pad / ship / flame / instanced smoke
// column / blinking "!" across idle|arm|fly|gone) with its fly-phase LAUNCH
// SHADOW and gone-phase SCORCH mark, and the deer-crossing sign builder
// `makeDeerSign()` that terrain places on deer rows.
//
// Classic-script IIFE. Reads window.THREE / window.R3D. Registers 'props'.
// All 2D formulas are verbatim from spec-props.md (px ÷ 64).
(function () {
  'use strict';

  const THREE = window.THREE;
  const R3D = window.R3D;
  if (!THREE || !R3D) {
    console.error('[R3D:props] window.THREE / window.R3D missing — props not registered');
    return;
  }

  const PAL = R3D.PAL;
  const A = R3D.assets;
  const U = R3D.util;

  let ctx3 = null; // kept from init; props has no global scene objects

  // ==================================================================
  // Small helpers
  // ==================================================================
  function srgb(r, g, b) {
    return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  }

  // push a tinted, translated geometry onto a merge list
  function put(list, geom, hex, mul, x, y, z) {
    if (x || y || z) geom.translate(x || 0, y || 0, z || 0);
    list.push(U.tint(geom, hex, mul || 1));
  }

  // flat disc lying on the ground, facing +Y
  function flatCircle(r, seg) {
    const g = new THREE.CircleGeometry(r, seg);
    g.rotateX(-Math.PI / 2);
    return g;
  }

  function noop() {}

  // Module-private colors (blends of palette colors — not palette overrides)
  const GLINT = '#75c983';       // canopy top '#57bd68' lightened 18% toward white (2D glint)
  const COIN_INNER = '#fff3bf';  // 2D rgba(255,243,191,0.9) baked opaque
  const GLASS_GLINT = '#eaf7ff'; // porthole glint

  // ==================================================================
  // Shared materials (module-level constants — NEVER disposed)
  // ==================================================================
  const FLAME_MAT = new THREE.MeshBasicMaterial({ vertexColors: true }); // unlit = glowing
  const ARC_MAT = new THREE.MeshBasicMaterial({          // hole back-rim highlight arc
    color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false,
  });
  const SCORCH_BURN_MAT = new THREE.MeshBasicMaterial({  // rgba(50,38,30,0.55)
    color: srgb(50, 38, 30), transparent: true, opacity: 0.55, depthWrite: false,
  });
  const SCORCH_CHAR_MAT = new THREE.MeshBasicMaterial({  // rgba(25,18,14,0.5)
    color: srgb(25, 18, 14), transparent: true, opacity: 0.5, depthWrite: false,
  });
  const LAUNCH_SHADOW_MAT = new THREE.MeshBasicMaterial({ // rgba(40,30,25,0.45) — fly-phase pad mark
    color: srgb(40, 30, 25), transparent: true, opacity: 0.45, depthWrite: false,
  });

  // ==================================================================
  // TREE — seed r*31 + c*7, s = R3D.hash(seed), v = 0.88 + s*0.28,
  // berries iff s < 0.3. Canopy scale quantized to 8 buckets so single-tree
  // geometries cache in R3D.assets; a given seed always maps to the same
  // bucket, so the same tree always looks the same.
  // ==================================================================
  const V_BUCKETS = 8;

  function treeGeo(bucket, berries) {
    return A.get('props:tree:' + bucket + ':' + (berries ? 1 : 0), function () {
      const v = 0.88 + (bucket / (V_BUCKETS - 1)) * 0.28;
      const g = [];
      // trunk 0.156 × 0.281 + right-side shade strip (2D rgba(0,0,0,0.15) → wood × 0.85)
      put(g, new THREE.BoxGeometry(0.156, 0.281, 0.156), PAL.wood, 1, 0, 0.1405, 0);
      put(g, new THREE.BoxGeometry(0.06, 0.281, 0.16), PAL.wood, 0.85, 0.053, 0.1405, 0);
      // three canopy tiers, lighter going up
      put(g, new THREE.SphereGeometry(0.219 * v, 7, 6), PAL.canopy[0], 1, -0.172 * v, 0.391, 0);
      put(g, new THREE.SphereGeometry(0.219 * v, 7, 6), PAL.canopy[0], 1, 0.172 * v, 0.391, 0);
      put(g, new THREE.SphereGeometry(0.25 * v, 8, 6), PAL.canopy[1], 1, 0, 0.516 * v, 0);
      put(g, new THREE.SphereGeometry(0.156 * v, 7, 5), PAL.canopy[2], 1, -0.078, 0.641 * v, 0);
      // white glint, top-left, half-embedded in the top tier
      put(g, new THREE.SphereGeometry(0.07, 6, 4), GLINT, 1, -0.141, 0.688 * v, 0.12 * v);
      if (berries) { // 3 red berries poking out the camera side
        put(g, new THREE.SphereGeometry(0.041, 6, 4), PAL.berry, 1, 0.109, 0.563 * v, 0.2 * v);
        put(g, new THREE.SphereGeometry(0.041, 6, 4), PAL.berry, 1, -0.141, 0.438 * v, 0.19 * v);
        put(g, new THREE.SphereGeometry(0.041, 6, 4), PAL.berry, 1, 0.031, 0.375 * v, 0.21 * v);
      }
      return U.mergeGeoms(g);
    });
  }

  // ==================================================================
  // FLOWER — kinds 0/1/2 four-petal (white/pink/pale), kind 3 grass tuft
  // ==================================================================
  function blade(list, baseX, len, lean) {
    const b = new THREE.BoxGeometry(0.039, len, 0.026);   // 2.5px-wide blade
    b.translate(0, len / 2, 0);                           // pivot at base
    b.rotateZ(lean);                                      // + leans left (top → -X)
    b.translate(baseX, 0, 0.047);                         // 2D blades root at y+3
    list.push(U.tint(b, PAL.tuft));
  }

  function flowerGeo(kind) {
    return A.get('props:flower:' + kind, function () {
      const g = [];
      if (kind === 3) {
        blade(g, -0.0625, 0.16, 0.29);
        blade(g, 0, 0.19, 0.083);
        blade(g, 0.0625, 0.16, -0.29);
      } else {
        const col = PAL.petal[kind] || PAL.petal[0];
        for (let i = 0; i < 4; i++) {                     // 4 petals, ring rotated 0.4 rad
          const a = i * Math.PI / 2 + 0.4;
          const p = new THREE.SphereGeometry(0.041, 6, 4);
          p.scale(1, 0.55, 1);
          p.translate(Math.cos(a) * 0.053, 0.032, Math.sin(a) * 0.053);
          g.push(U.tint(p, col));
        }
        const c = new THREE.SphereGeometry(0.034, 6, 4);  // #ffce3d center disc
        c.scale(1, 0.6, 1);
        c.translate(0, 0.045, 0);
        g.push(U.tint(c, PAL.flowerCenter));
      }
      return U.mergeGeoms(g);
    });
  }

  // ==================================================================
  // HOLE — flat layered decal (contract: decal, not carved), y 0.018+.
  // Inner layers nudged toward the camera (+z) — the 2D far-wall trick.
  // ==================================================================
  function holeGeo() {
    return A.get('props:hole', function () {
      const g = [];
      put(g, flatCircle(0.36, 22), PAL.hole[0], 1, 0, 0.018, 0);      // worn grass rim
      put(g, flatCircle(0.3125, 20), PAL.hole[1], 1, 0, 0.0184, 0);   // dirt lip
      put(g, flatCircle(0.258, 18), PAL.hole[2], 1, 0, 0.0188, 0.008);// shaft (+0.5px)
      put(g, flatCircle(0.172, 16), PAL.hole[3], 1, 0, 0.0192, 0.039);// pit  (+2.5px)
      return U.mergeGeoms(g);
    });
  }

  // faint white back-rim arc — 2D canvas angles 1.1π..1.9π map to 0.1π..0.9π here
  function holeArcGeo() {
    return A.get('props:holeArc', function () {
      const g = new THREE.RingGeometry(0.258, 0.289, 14, 1, Math.PI * 0.1, Math.PI * 0.8);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.0196, -0.0156);                    // 2D (x, y-1): 1px toward far edge
      return g;
    });
  }

  // ==================================================================
  // COIN — pooled mini-groups (cap 16, contract). Real Y-spin θ = t·2.2 + c,
  // bob y = 0.35 + sin(t·2.6 + c·1.7)·3/64, additive halo, blob shadow whose
  // width tracks the spin, face-on sparkle.
  // ==================================================================
  function coinGeo() {
    return A.get('props:coin', function () {
      const g = [];
      const disc = new THREE.CylinderGeometry(0.172, 0.172, 0.045, 18);
      disc.rotateX(Math.PI / 2);                          // flat faces face ±Z
      g.push(U.tint(disc, PAL.coin));
      g.push(U.tint(new THREE.TorusGeometry(0.172, 0.023, 8, 20), PAL.coinRim));  // rim
      g.push(U.tint(new THREE.TorusGeometry(0.094, 0.02, 6, 14), COIN_INNER));    // inner ring
      return U.mergeGeoms(g);
    });
  }

  function haloMat() {
    return A.get('props:haloMat', function () {
      const tex = U.canvasTex(64, 64, function (c) {
        const grd = c.createRadialGradient(32, 32, 4, 32, 32, 30);
        grd.addColorStop(0, 'rgba(255,215,80,0.5)');
        grd.addColorStop(0.55, 'rgba(255,215,80,0.28)');
        grd.addColorStop(1, 'rgba(255,215,80,0)');
        c.fillStyle = grd;
        c.fillRect(0, 0, 64, 64);
      });
      return new THREE.SpriteMaterial({
        map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
    });
  }

  function sparkTex() {
    return A.get('props:sparkTex', function () {
      return U.canvasTex(64, 64, function (c) {          // plus-sign: two crossed bars
        c.fillStyle = 'rgba(255,255,255,0.95)';
        c.fillRect(4, 25, 56, 14);
        c.fillRect(25, 4, 14, 56);
      });
    });
  }

  const coinPool = new R3D.Pool(function () {
    const root = new THREE.Group();
    const shadow = U.blob(10 / 64, 3.5 / 64, PAL.shadowGreen + '0.16)'); // stays grounded
    root.add(shadow);
    const spin = new THREE.Group();
    spin.position.y = 0.35;
    spin.add(new THREE.Mesh(coinGeo(), R3D.MAT.opaque)); // castShadow = false (blob owns it)
    root.add(spin);
    const halo = new THREE.Sprite(haloMat());            // r 17px → Ø 0.53, NOT squashed
    halo.scale.set(0.53, 0.53, 1);
    halo.position.set(0, 0.35, -0.05);
    halo.renderOrder = 3;
    root.add(halo);
    const sparkle = new THREE.Sprite(new THREE.SpriteMaterial({ // per-coin mat: rotation animates
      map: sparkTex(), transparent: true, depthWrite: false,
    }));
    sparkle.scale.set(0.14, 0.14, 1);
    sparkle.renderOrder = 3;
    sparkle.visible = false;
    root.add(sparkle);
    root.userData.spin = spin;
    root.userData.shadow = shadow;
    root.userData.halo = halo;
    root.userData.sparkle = sparkle;
    return root;
  }, 16);

  // ==================================================================
  // ROCKET — pad (grounded forever), ship (idle|arm|fly), flame, smoke
  // column, blinking "!", scorch (fly|gone). All anims verbatim.
  // ==================================================================
  const PAD_TOP = 0.09;

  function padGeo() {
    return A.get('props:rocketPad', function () {
      const g = [];
      put(g, new THREE.CylinderGeometry(0.3125, 0.3125, 0.06, 18), PAL.steel, 1, 0, 0.03, 0);
      put(g, new THREE.CylinderGeometry(0.234, 0.234, 0.03, 16), PAL.steelDark, 1, 0, 0.075, 0);
      return U.mergeGeoms(g);
    });
  }

  function shipGeo() { // ship-local origin at pad top; body 0.0625..0.6875, nose to 0.94
    return A.get('props:rocketShip', function () {
      const g = [];
      put(g, new THREE.CylinderGeometry(0.14, 0.14, 0.625, 12), PAL.rocketBody, 1, 0, 0.375, 0);
      put(g, new THREE.ConeGeometry(0.145, 0.2525, 12), PAL.rocketRed, 1, 0, 0.8138, 0);
      // 3 fins — 2D triangle (−8,−6)(−17,2)(−8,−22) as a radial profile, extruded
      const shp = new THREE.Shape();
      shp.moveTo(0.125, 0.094);
      shp.lineTo(0.266, -0.031);
      shp.lineTo(0.125, 0.344);
      shp.closePath();
      const fin0 = new THREE.ExtrudeGeometry(shp, { depth: 0.045, bevelEnabled: false });
      fin0.translate(0, 0, -0.0225);
      const finAngles = [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6]; // one toward camera
      for (let i = 0; i < 3; i++) {
        const f = fin0.clone();
        f.rotateY(finAngles[i]);
        g.push(U.tint(f, PAL.rocketRed));
      }
      fin0.dispose();
      // porthole ring + glass + glint on the camera face
      put(g, new THREE.TorusGeometry(0.086, 0.018, 6, 12), PAL.porthole, 1, 0, 0.36, 0.132);
      const glass = new THREE.CircleGeometry(0.059, 12);
      glass.translate(0, 0.36, 0.142);
      g.push(U.tint(glass, PAL.portGlass));
      const glint = new THREE.CircleGeometry(0.02, 8);
      glint.translate(-0.022, 0.382, 0.143);
      g.push(U.tint(glint, GLASS_GLINT));
      return U.mergeGeoms(g);
    });
  }

  function flameGeo() { // two down-pointing cones, base at local y 0 — scale.y animates
    return A.get('props:rocketFlame', function () {
      const g = [];
      const outer = new THREE.ConeGeometry(0.094, 0.344, 10);   // 22px long
      outer.rotateX(Math.PI);
      outer.translate(0, -0.172, 0);
      g.push(U.tint(outer, PAL.flame[0]));
      const inner = new THREE.ConeGeometry(0.055, 0.203, 8);    // 13px long
      inner.rotateX(Math.PI);
      inner.translate(0, -0.1055, 0.05);                        // nudged toward camera
      g.push(U.tint(inner, PAL.flame[1]));
      return U.mergeGeoms(g);
    });
  }

  // Smoke column: ONE InstancedMesh of 6 puffs instead of 6 meshes (§5.6 draw-call
  // budget). Per-puff alpha in 2D is 0.5·k·max(0,1−rk.t·0.8) with the FIXED factor
  // k = 1 − i/6: the animated part is shared (material.opacity) and k is baked as a
  // static instanced attribute multiplied into alpha by a tiny Lambert shader patch.
  const SMOKE_M4 = new THREE.Matrix4();                       // scratch — no per-frame alloc

  function smokeGeo() {
    return A.get('props:smokePuffs', function () {
      const g = new THREE.SphereGeometry(1, 8, 6);
      const k = new Float32Array(6);
      for (let i = 0; i < 6; i++) k[i] = 1 - i / 6;
      g.setAttribute('aPuffK', new THREE.InstancedBufferAttribute(k, 1));
      return g;
    });
  }

  function smokeAlphaPatch(sh) { // same fn on every smoke material → one shared program
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPuffK;\nvarying float vPuffK;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvPuffK = aPuffK;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPuffK;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.a *= vPuffK;');
  }

  function buildRocket(parent, c, owned) {
    const root = new THREE.Group();
    root.position.x = R3D.X(c + 0.5);

    const pad = new THREE.Mesh(padGeo(), R3D.MAT.opaque);       // grounded forever
    root.add(pad);

    const shipG = new THREE.Group();
    shipG.position.y = PAD_TOP;
    const ship = new THREE.Mesh(shipGeo(), R3D.MAT.opaque);
    ship.castShadow = true;                                     // contract caster
    shipG.add(ship);
    const flame = new THREE.Mesh(flameGeo(), FLAME_MAT);
    flame.position.y = 0.0625;                                  // at the body base
    flame.visible = false;
    shipG.add(flame);
    root.add(shipG);

    const scorch = new THREE.Group();                           // burn marks on the pad top
    scorch.position.y = PAD_TOP;
    scorch.visible = false;
    const burn = new THREE.Mesh(
      A.get('props:scorchBurn', function () {
        const g = flatCircle(0.234, 16);
        g.translate(0, 0.003, -0.0156);
        return g;
      }), SCORCH_BURN_MAT);
    burn.renderOrder = 1;
    scorch.add(burn);
    const charC = new THREE.Mesh(
      A.get('props:scorchChar', function () {
        const g = flatCircle(0.125, 14);
        g.translate(0, 0.0045, -0.0156);
        return g;
      }), SCORCH_CHAR_MAT);
    charC.renderOrder = 1;
    scorch.add(charC);
    root.add(scorch);

    const launch = new THREE.Mesh(                              // fly-phase launch shadow —
      A.get('props:launchShadow', function () {                 // 2D rgba(40,30,25,0.45) 17×5.5
        const g = flatCircle(0.266, 16);                        // ellipse at (x, y): r 17px/64,
        g.translate(0, 0.003, 0);                               // no far-edge nudge
        return g;
      }), LAUNCH_SHADOW_MAT);
    launch.position.y = PAD_TOP;
    launch.renderOrder = 1;
    launch.visible = false;
    root.add(launch);

    const smokeMat = new THREE.MeshLambertMaterial({            // opacity animates → owned
      color: srgb(200, 200, 205), transparent: true, opacity: 0, depthWrite: false,
    });
    smokeMat.onBeforeCompile = smokeAlphaPatch;
    owned.push(smokeMat);
    const smoke = new THREE.InstancedMesh(smokeGeo(), smokeMat, 6); // 6 puffs, one draw call
    smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    smoke.frustumCulled = false;                                // puffs climb ~12 units in 'fly'
    smoke.visible = false;
    owned.push(smoke);                                          // .dispose() frees instance buffer
    root.add(smoke);

    const warn = U.warnSprite();
    warn.scale.set(0.31, 0.31, 1);
    warn.position.set(0.25, 1.03, 0);
    warn.visible = false;
    root.add(warn);

    parent.add(root);
    return { shipG: shipG, flame: flame, scorch: scorch, launch: launch, smoke: smoke, warn: warn };
  }

  function updateRocket(rc, rk, t) {
    const ph = rk.phase;
    const flying = ph === 'fly';
    rc.shipG.visible = ph !== 'gone';
    rc.scorch.visible = ph === 'gone';                          // 2D scorch() is gone-only
    rc.launch.visible = flying;                                 // 2D fly-phase launch shadow
    rc.warn.visible = ph === 'arm' && Math.sin(t * 10) > -0.4;  // ~70% blink duty
    rc.flame.visible = ph === 'arm' || flying;
    let sx = 0;
    let sy = PAD_TOP;
    let lift = 0;
    if (ph === 'arm') sx = Math.sin(t * 42) * (1.5 + rk.t) / 64;   // rumble shake
    if (flying) { lift = rk.t * rk.t * 12.1875; sy += lift; }      // quadratic ascent
    rc.shipG.position.x = sx;
    rc.shipG.position.y = sy;
    if (rc.flame.visible) {
      rc.flame.scale.y = (flying ? 1 : 0.35) * (0.8 + 0.2 * Math.sin(t * 37));
      // The 2D art drew the flame over the pad ellipse; in 3D everything below
      // the pad-top plane hides inside the pad cylinder AND the 58° camera sees
      // the under-body gap only past the body's front surface (z 0.14). Swing
      // the plume toward the camera (+Z) so the outer-cone tip stays 0.01
      // above the pad, and shift it forward past the body so it reads like the
      // 2D "flame over the pad". Both ease to 0 as lift clears the pad.
      const len = 0.344 * rc.flame.scale.y;                     // outer-cone reach below origin
      const drop = 0.0525 + lift;                               // origin → pad top + 0.01 margin
      const s = drop < len ? Math.sqrt(1 - (drop / len) * (drop / len)) : 0; // sin(tilt)
      rc.flame.rotation.x = -Math.asin(s);
      rc.flame.position.z = 0.14 * s;                           // past body front at full tilt
    }
    const smoke = rc.smoke;
    const base = flying ? 0.5 * Math.max(0, 1 - rk.t * 0.8) : 0;  // shared alpha (per-puff ×k)
    if (base <= 0.01) {                                           // max puff alpha is base·1
      smoke.visible = false;
    } else {
      smoke.visible = true;
      smoke.material.opacity = base;
      for (let i = 0; i < 6; i++) {
        const s = base * (1 - i / 6) <= 0.01 ? 0                  // old per-puff cutoff → scale 0
          : (7 + (i / 6) * 9) / 64;                               // 7px at pad → 16px up top
        SMOKE_M4.makeScale(s, s, s);
        SMOKE_M4.setPosition(Math.sin(i * 2.6 + t * 3) * 7 / 64, 0.125 + lift * i / 6, 0);
        smoke.setMatrixAt(i, SMOKE_M4);
      }
      smoke.instanceMatrix.needsUpdate = true;
    }
  }

  // ==================================================================
  // grassContents(r, row) → Part  (row may be undefined → empty Part)
  //
  // Statics are merged into 3 meshes: trees (opaque, castShadow — contract
  // caster), flowers+holes (opaque, non-casting per §7.3), hole arcs
  // (transparent decal). Rebuilt only on the §5.5 signals.
  // ==================================================================
  function grassContents(r, row) {
    const group = new THREE.Group();
    if (!row) return { group: group, update: noop, dispose: noop };

    const owned = [];                                     // rocket smoke materials
    let treeMesh = null, treeGeom = null, treeCount = -1;
    let decorMesh = null, decorGeom = null;
    let transMesh = null, transGeom = null;
    let holeCount = -1, hiddenFlowers = -1;

    function rebuildTrees() {
      treeCount = row.trees.size;
      if (treeGeom) { treeGeom.dispose(); treeGeom = null; }
      if (treeCount === 0) {
        if (treeMesh) treeMesh.visible = false;
        return;
      }
      const list = [];
      for (const c of row.trees) {
        const s = R3D.hash(r * 31 + c * 7);               // THE per-(row,col) seed hash
        const bucket = Math.min(V_BUCKETS - 1, (s * V_BUCKETS) | 0);
        const g = treeGeo(bucket, s < 0.3).clone();
        g.translate(R3D.X(c + 0.5), 0, 0);
        list.push(g);
      }
      treeGeom = U.mergeGeoms(list);
      for (let i = 0; i < list.length; i++) list[i].dispose();
      if (!treeMesh) {
        treeMesh = new THREE.Mesh(treeGeom, R3D.MAT.opaque);
        treeMesh.castShadow = true;
        group.add(treeMesh);
      } else {
        treeMesh.geometry = treeGeom;
        treeMesh.visible = true;
      }
    }

    // flowers whose x-px falls inside the tractor dirt span are not drawn
    function countHidden() {
      const span = R3D.dirtSpan(row);
      if (!span) return 0;
      let n = 0;
      const fl = row.flowers;
      for (let i = 0; i < fl.length; i++) {
        const fx = (fl[i].c + 0.5) * 64 + fl[i].jx;
        if (fx > span[0] && fx < span[1]) n++;
      }
      return n;
    }

    function rebuildDecor(hidden) {
      holeCount = row.holes.size;
      hiddenFlowers = hidden;
      if (decorGeom) { decorGeom.dispose(); decorGeom = null; }
      if (transGeom) { transGeom.dispose(); transGeom = null; }
      const list = [];
      const tlist = [];
      const span = R3D.dirtSpan(row);
      const fl = row.flowers;
      for (let i = 0; i < fl.length; i++) {
        const f = fl[i];
        const fxpx = (f.c + 0.5) * 64 + f.jx;             // stored jitter, px
        if (span && fxpx > span[0] && fxpx < span[1]) continue;
        const g = flowerGeo(f.kind).clone();
        g.translate(fxpx / 64 - 5.5, 0, f.jy / 64);       // jy displaces along Z
        list.push(g);
      }
      for (const c of row.holes) {
        const hx = R3D.X(c + 0.5);
        const hg = holeGeo().clone();
        hg.translate(hx, 0, 0);
        list.push(hg);
        const ag = holeArcGeo().clone();
        ag.translate(hx, 0, 0);
        tlist.push(ag);
      }
      if (list.length) {
        decorGeom = U.mergeGeoms(list);
        for (let i = 0; i < list.length; i++) list[i].dispose();
        if (!decorMesh) {
          decorMesh = new THREE.Mesh(decorGeom, R3D.MAT.opaque); // castShadow false (§7.3)
          group.add(decorMesh);
        } else {
          decorMesh.geometry = decorGeom;
          decorMesh.visible = true;
        }
      } else if (decorMesh) decorMesh.visible = false;
      if (tlist.length) {
        transGeom = U.mergeGeoms(tlist);
        for (let i = 0; i < tlist.length; i++) tlist[i].dispose();
        if (!transMesh) {
          transMesh = new THREE.Mesh(transGeom, ARC_MAT);
          transMesh.renderOrder = 1;                      // ground-decal tier
          group.add(transMesh);
        } else {
          transMesh.geometry = transGeom;
          transMesh.visible = true;
        }
      } else if (transMesh) transMesh.visible = false;
    }

    rebuildTrees();
    rebuildDecor((row.dirt || row.dirtFull) ? countHidden() : 0);

    // coins — acquire pooled groups; picked-up coins are hidden, released on dispose
    const coins = [];
    if (row.coins) {
      for (const c of row.coins) {
        const g = coinPool.acquire();
        g.userData.owner = group;
        g.visible = true;
        g.userData.sparkle.visible = false;
        g.position.set(R3D.X(c + 0.5), 0, 0);
        group.add(g);
        coins.push({ c: c, g: g });
      }
    }

    const rc = row.rocket ? buildRocket(group, row.rocket.c, owned) : null;

    return {
      group: group,

      update: function (row, frame) {
        // rare signals → static rebuilds (tractor mowing / paving, dirt spreading)
        if (row.trees.size !== treeCount) rebuildTrees();
        const hidden = (row.dirt || row.dirtFull) ? countHidden() : 0;
        if (row.holes.size !== holeCount || hidden !== hiddenFlowers) rebuildDecor(hidden);

        const t = frame.t;

        for (let i = 0; i < coins.length; i++) {
          const e = coins[i];
          const ud = e.g.userData;
          if (ud.owner !== group) continue;               // stolen by pool overflow — hands off
          if (!row.coins.has(e.c)) { e.g.visible = false; continue; }
          const th = t * 2.2 + e.c;                       // real Y-spin
          const ac = Math.abs(Math.cos(th));
          const bobY = 0.35 + Math.sin(t * 2.6 + e.c * 1.7) * 3 / 64;
          ud.spin.position.y = bobY;
          ud.spin.rotation.y = th;
          ud.halo.position.y = bobY;
          const sq = 0.35 + 0.65 * ac;                    // 2D squash → shadow width
          ud.shadow.scale.x = (8 * sq + 2) / 32;          // blob disc Ø1 → scale = 2·rx
          const face = ac > 0.92;                         // face-on sparkle
          ud.sparkle.visible = face;
          if (face) {
            ud.sparkle.position.set(0.109, bobY + 0.125, 0.08);
            ud.sparkle.material.rotation = t * 3 + e.c;
          }
        }

        if (rc) updateRocket(rc, row.rocket, t);
      },

      dispose: function () {
        for (let i = 0; i < coins.length; i++) {
          const g = coins[i].g;
          if (g.userData.owner === group) {
            g.userData.owner = null;
            coinPool.release(g);
          }
        }
        if (treeGeom) treeGeom.dispose();
        if (decorGeom) decorGeom.dispose();
        if (transGeom) transGeom.dispose();
        U.disposeList(owned);
      },
    };
  }

  // ==================================================================
  // makeDeerSign() → fresh Group — terrain places it (±5.094, row-local z -0.15).
  // Grey post + 45°-rotated yellow diamond box; inset border + leaping-deer
  // silhouette painted on a shared CanvasTexture face decal (faces +Z).
  // ==================================================================
  function signGeo() {
    return A.get('props:signGeo', function () {
      const g = [];
      put(g, new THREE.BoxGeometry(0.078, 0.375, 0.05), PAL.signPost, 1, 0, 0.1875, 0);
      const d = new THREE.BoxGeometry(0.34, 0.34, 0.045);
      d.rotateZ(Math.PI / 4);
      d.translate(0, 0.219, 0.035);                       // center 14/64 above post base
      g.push(U.tint(d, PAL.signFace));
      return U.mergeGeoms(g);
    });
  }

  function signFaceMat() {
    return A.get('props:signFaceMat', function () {
      const k = 128 / 30.72;                              // canvas px per 2D art px
      const tex = U.canvasTex(128, 128, function (c) {
        c.translate(64, 64);
        c.lineCap = 'round';
        c.save();                                         // border in the rotated frame
        c.rotate(Math.PI / 4);
        c.strokeStyle = PAL.signBorder;
        c.lineWidth = 2 * k;
        c.strokeRect(-8.5 * k, -8.5 * k, 17 * k, 17 * k);
        c.restore();
        c.fillStyle = PAL.signInk;                        // leaping deer, upright
        c.strokeStyle = PAL.signInk;
        c.beginPath();
        c.ellipse(0, 1 * k, 5.5 * k, 3 * k, 0, 0, Math.PI * 2);   // body
        c.fill();
        c.beginPath();
        c.arc(5 * k, -3 * k, 2.2 * k, 0, Math.PI * 2);            // head
        c.fill();
        c.lineWidth = 1.5 * k;
        c.beginPath();                                            // antlers + legs
        c.moveTo(5 * k, -5 * k); c.lineTo(3.5 * k, -8 * k);
        c.moveTo(5 * k, -5 * k); c.lineTo(7 * k, -8 * k);
        c.moveTo(-3 * k, 3 * k); c.lineTo(-5 * k, 7 * k);
        c.moveTo(3 * k, 3 * k); c.lineTo(5 * k, 7 * k);
        c.stroke();
      });
      return new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    });
  }

  function makeDeerSign() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(signGeo(), R3D.MAT.opaque));     // castShadow false (§7.3)
    const face = new THREE.Mesh(
      A.get('props:signFaceGeo', function () { return new THREE.PlaneGeometry(0.48, 0.48); }),
      signFaceMat()
    );
    face.position.set(0, 0.219, 0.059);                   // just proud of the diamond face
    g.add(face);
    return g;
  }

  // ==================================================================
  // Registration
  // ==================================================================
  R3D.register('props', {
    init: function (c) { ctx3 = c; },                     // no global objects to add
    grassContents: grassContents,
    makeDeerSign: makeDeerSign,
  });
})();
