// Hopscape 3D — js/r3d/creatures.js — hazard creatures (CONTRACT.md §6.4).
//
//   cloudLane(r, row)  -> Part : grumpy storm clouds on rainbow rows — 3-puff
//                               blobby bodies over a rounded slab, baked angry
//                               face (pupils track row.dir), looping rain
//                               streaks, static cool blob shadow. Pooled (64 —
//                               measured worst-case window demand 56 + margin).
//   deerLane(r, row)   -> Part : bounding herds — merged tan body + cream rump,
//                               scissoring leg pairs, POSITIONAL gallop
//                               (bound = |sin(laneXpx * 0.09)|), grounded green
//                               blob while the body bounds. Pooled (18 —
//                               measured worst case 14 + margin), herd
//                               count diffed per frame.
//   updateEagle(frame)         : ONE persistent eagle — circles over the
//                               dawdling character with a pulsing menace blob,
//                               flees with the verbatim quadratic ease when
//                               dodged, and executes the death dive/grab/carry
//                               (character z arrives pre-computed in frame.chr).
//
// Classic-script IIFE. Shared geometries/materials are module-level or in
// R3D.assets (never disposed); per-row Parts only acquire/release pooled
// objects, so dispose() leaks nothing. All animation is a pure function of
// frame.t / world state — zero per-frame allocation in the update paths.
(function () {
  'use strict';

  const THREE = window.THREE, R3D = window.R3D;
  if (!THREE || !R3D) {
    console.error('[creatures] window.THREE / window.R3D missing — load order broken');
    return;
  }

  const PX = R3D.PX;
  const PAL = R3D.PAL;
  const U = R3D.util;

  let ctx3 = null;

  // ==================================================================
  // Geometry-baking helpers (build-time only — never called per frame)
  // ==================================================================
  const UP_Y = new THREE.Vector3(0, 1, 0);

  function sphereAt(r, x, y, z, hex, opt) {
    opt = opt || {};
    const g = new THREE.SphereGeometry(r, opt.ws || 12, opt.hs || 9);
    if (opt.s) g.scale(opt.s[0], opt.s[1], opt.s[2]);
    g.translate(x, y, z);
    return U.tint(g, hex, opt.mul);
  }

  function boxAt(w, h, d, x, y, z, hex, rz) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    return U.tint(g, hex);
  }

  // Thin cylinder from point A to point B (antlers etc.).
  function cylBetween(ax, ay, az, bx, by, bz, r, hex) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const g = new THREE.CylinderGeometry(r, r, len, 6);
    const q = new THREE.Quaternion().setFromUnitVectors(
      UP_Y, new THREE.Vector3(dx / len, dy / len, dz / len));
    g.applyQuaternion(q);
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    return U.tint(g, hex);
  }

  // Merge a list of tinted geometries into one and dispose the sources.
  function mergeInto(parts) {
    const out = U.mergeGeoms(parts);
    for (let i = 0; i < parts.length; i++) parts[i].dispose();
    return out;
  }

  // ==================================================================
  // §1 — GRUMPY STORM CLOUDS (rainbow rows)
  // ==================================================================
  // Body geometry is cached per quantized width bucket (1/16 tile) and per
  // travel dir (pupils are baked offset dir*1.8px). Everything opaque — the 2D
  // rgba(255,255,255,0.14) top highlight is baked as #5f6883 lightened 14%
  // toward white, as slightly-forward crest bumps.
  const CLOUD_HL = '#757d94';           // #5f6883 mixed 14% toward white
  const CLOUD_INK = '#2a2f40';          // brows + frown stroke
  const CLOUD_PUPIL = '#20242f';

  function cloudBucket(w) {
    let b = Math.round(w * 16);
    if (b < 16) b = 16; else if (b > 32) b = 32;
    return b;
  }

  // Rounded slab matching the 2D rrf(x - 0.75R, cy - 4, 1.5R, 20, r = 10):
  // rounded in PLAN (XZ), 20px tall, biased to the near (+z) side so the puffs
  // cover the far edge (the 2D rect spanned cy-4..cy+16 — mostly down-screen).
  // Build-time only; sources are disposed by mergeInto().
  function roundSlabGeo(R, dy, hex) {
    const w = 1.5 * R, dp = 0.72 * R, r = 10 * PX;
    const hw = w / 2, hh = dp / 2;
    const s = new THREE.Shape();
    s.moveTo(-hw + r, -hh);
    s.lineTo(hw - r, -hh);
    s.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
    s.lineTo(hw, hh - r);
    s.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
    s.lineTo(-hw + r, hh);
    s.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-hw, -hh + r);
    s.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.3125, bevelEnabled: false, curveSegments: 5 });
    g.rotateX(-Math.PI / 2);            // plan shape -> XZ, extrusion -> +Y (0..20px)
    g.translate(0, -16 * PX + dy, 0.15 * R);   // old box spanned y -16..+4px
    return U.tint(g, hex);
  }

  function cloudGeo(bucket, dir) {
    return R3D.assets.get('creatures:cloud:' + bucket + ':' + dir, function () {
      const w = bucket / 16;            // tiles
      const R = w / 2;
      const p = [];

      // --- under-shade layer: SAME footprint, 3.5px lower (2D dark dupe) ---
      const dn = -3.5 * PX;
      p.push(sphereAt(0.40 * R, -0.55 * R, -1 * PX + dn, 0, PAL.cloudShade));
      p.push(sphereAt(0.48 * R, -0.05 * R, 7 * PX + dn, 0, PAL.cloudShade));
      p.push(sphereAt(0.38 * R, 0.42 * R, 0 + dn, 0, PAL.cloudShade));
      p.push(roundSlabGeo(R, dn, PAL.cloudShade));

      // --- main body: 3 overlapping puffs over the rounded slab ---
      p.push(sphereAt(0.40 * R, -0.55 * R, -1 * PX, 0, PAL.cloudBody));
      p.push(sphereAt(0.48 * R, -0.05 * R, 7 * PX, 0, PAL.cloudBody));
      p.push(sphereAt(0.38 * R, 0.42 * R, 0, 0, PAL.cloudBody));
      p.push(roundSlabGeo(R, 0, PAL.cloudBody));

      // --- top highlights: lighter crest bumps poking up-and-forward ---
      p.push(sphereAt(0.28 * R, -0.15 * R, 13 * PX, 0.14 * R, CLOUD_HL));
      p.push(sphereAt(0.18 * R, -0.62 * R, 5 * PX, 0.20 * R, CLOUD_HL));

      // --- angry face on the camera side (+Z); FIXED px sizes, never scale
      // with w. Raised 6px off the 2D anchors so eyes/brows read on the grey
      // puffs, not the dark slab front (2D layered ink over flat fills; 3D
      // lighting renders the slab's front face near-black). ---
      const FY = 6 * PX;
      const FZ = 0.48 * R;              // face plane anchored to the big puff front
      const eyeZ = FZ - 1.5 * PX;
      p.push(sphereAt(5 * PX, -9 * PX, 2 * PX + FY, eyeZ, '#ffffff', { ws: 10, hs: 8 }));
      p.push(sphereAt(5 * PX, 9 * PX, 2 * PX + FY, eyeZ, '#ffffff', { ws: 10, hs: 8 }));
      const po = dir * 1.8 * PX;        // pupils look in the travel direction
      p.push(sphereAt(2.6 * PX, -9 * PX + po, 2 * PX + FY, eyeZ + 4 * PX, CLOUD_PUPIL, { ws: 8, hs: 6 }));
      p.push(sphereAt(2.6 * PX, 9 * PX + po, 2 * PX + FY, eyeZ + 4 * PX, CLOUD_PUPIL, { ws: 8, hs: 6 }));
      // V brows: 2D (-15,-11)->(-4,-6.5)  =>  length 11.9px, slope -0.388 rad
      p.push(boxAt(11.9 * PX, 3.5 * PX, 2.5 * PX, -9.5 * PX, 8.75 * PX + FY, FZ + 1 * PX, CLOUD_INK, -0.388));
      p.push(boxAt(11.9 * PX, 3.5 * PX, 2.5 * PX, 9.5 * PX, 8.75 * PX + FY, FZ + 1 * PX, CLOUD_INK, 0.388));
      // frown: upward arc (2D arc 1.15pi..1.85pi) -> torus slice 0.15pi..0.85pi,
      // proud of the biased slab front (0.15R + 0.36R)
      const frown = new THREE.TorusGeometry(4 * PX, 1.4 * PX, 5, 10, 0.7 * Math.PI);
      frown.rotateZ(0.15 * Math.PI);
      frown.translate(0, -9 * PX + FY, 0.51 * R + 1.5 * PX);
      p.push(U.tint(frown, CLOUD_INK));

      return mergeInto(p);
    });
  }

  // --- rain: 4 short streaks per cloud, ONE mesh via 4-component vertex color
  // (per-streak alpha), positions/alpha rewritten each frame (no allocation).
  // depthTest OFF: the cloud floats only ~23px over the ground slab, so most of
  // the 2D 26px fall dips below y=0 — the 2D drew the streaks over the row art
  // (painter's order); here they must not be depth-culled by the opaque slab.
  // updateRain fades them as they sink so the overdraw stays local. ---
  const RAIN_MAT = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, depthTest: false,
    side: THREE.DoubleSide,
  });
  const RAIN_RGB = new THREE.Color().setRGB(96 / 255, 170 / 255, 255 / 255, THREE.SRGBColorSpace);

  function makeRain() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(16 * 3);
    const col = new Float32Array(16 * 4);
    for (let v = 0; v < 16; v++) {
      col[v * 4] = RAIN_RGB.r; col[v * 4 + 1] = RAIN_RGB.g; col[v * 4 + 2] = RAIN_RGB.b;
      col[v * 4 + 3] = 0;
    }
    const idx = [];
    for (let s = 0; s < 4; s++) {
      const b = s * 4;                  // verts: TL, TR, BL, BR — front faces +Z
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    geo.setIndex(idx);
    const posAttr = new THREE.BufferAttribute(pos, 3);
    const colAttr = new THREE.BufferAttribute(col, 4);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('color', colAttr);
    // manual bounds — vertices move every frame, never recompute
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.4, 0.15), 1.8);
    const mesh = new THREE.Mesh(geo, RAIN_MAT);
    return { mesh: mesh, pos: posAttr, col: colAttr };
  }

  // verbatim 2D: fx jitter sin(seed*3+i*9)*4 px; ph = fract(t*1.5+i*0.23+seed*0.11);
  // fy = underside(18px) + ph*26px; streak 8px long leaning 2px left; alpha (1-ph)*0.8
  // (times the stroke's own 0.85). 3D-only addition: an extra fade over the last
  // 20px of sink below the ground plane (world y 0) — depthTest is off, so this
  // is what "lands" the drops instead of a hard clip at the slab.
  function updateRain(d, t) {
    const pos = d.rainPos.array, col = d.rainCol.array;
    const zf = d.rainZ;
    const baseY = d.bodyG.position.y;   // rain mesh is a child of bodyG (bobs with it)
    for (let i = 0; i < 4; i++) {
      let ph = (t * 1.5 + i * 0.23 + d.seed * 0.11) % 1;
      if (ph < 0) ph += 1;
      const x = d.rainX[i];
      const top = (-18 - ph * 26) * PX;
      const bot = top - 8 * PX;
      const xb = x - 2 * PX;
      const w2 = 1.5 * PX;
      const b = i * 12;
      pos[b] = x - w2; pos[b + 1] = top; pos[b + 2] = zf;
      pos[b + 3] = x + w2; pos[b + 4] = top; pos[b + 5] = zf;
      pos[b + 6] = xb - w2; pos[b + 7] = bot; pos[b + 8] = zf;
      pos[b + 9] = xb + w2; pos[b + 10] = bot; pos[b + 11] = zf;
      const sink = -(baseY + top);      // streak-top depth below the ground plane
      const grd = sink > 0 ? Math.max(0, 1 - sink / (20 * PX)) : 1;
      const a = (1 - ph) * 0.68 * grd;  // 0.8 * rgba-alpha 0.85, x ground fade
      const c = i * 16;
      col[c + 3] = a; col[c + 7] = a; col[c + 11] = a; col[c + 15] = a;
    }
    d.rainPos.needsUpdate = true;
    d.rainCol.needsUpdate = true;
  }

  // Pooled cloud: root Group (pool manages root.parent) carrying { bodyG (bobs),
  // bodyMesh (shared geo, swapped per w/dir), rain, blob (stays grounded) }.
  function makeCloud() {
    const root = new THREE.Group();
    const bodyG = new THREE.Group();
    const bodyMesh = new THREE.Mesh(cloudGeo(22, 1), R3D.MAT.opaque);
    const rain = makeRain();
    bodyG.add(bodyMesh);
    bodyG.add(rain.mesh);
    const blob = U.blob(0.4 * 1.4, 6 * PX, 'rgba(20,30,50,0.18)');   // rescaled per acquire
    root.add(bodyG);
    root.add(blob);
    root.r3d = {
      bodyG: bodyG, bodyMesh: bodyMesh, blob: blob,
      rainPos: rain.pos, rainCol: rain.col,
      rainX: new Float32Array(4), rainZ: 0.3, seed: 0,
    };
    return root;
  }
  // Cap 64: 40-run sim of the real world.js gen peaked at 56 simultaneous clouds
  // in the 23-row cache window (rainbow is the most common band at up to 5 rows
  // × 5 clouds, and several bands share the window).
  const cloudPool = new R3D.Pool(makeCloud, 64, 'clouds');

  function configCloud(root, c, dir) {
    const d = root.r3d;
    d.seed = c.seed || 0;
    d.bodyMesh.geometry = cloudGeo(cloudBucket(c.w || 1.4), dir);
    const wpx = (c.w || 1.4) * 64;
    for (let i = 0; i < 4; i++) {       // static per-cloud x layout (middle 64% + jitter)
      d.rainX[i] = (-wpx * 0.32 + (i + 0.5) * (wpx * 0.64 / 4) +
        Math.sin(d.seed * 3 + i * 9) * 4) * PX;
    }
    d.rainZ = 0.51 * ((c.w || 1.4) / 2) + 2 * PX;   // just proud of the biased slab front
    d.blob.scale.set(0.4 * (c.w || 1.4) * 2, 1, 6 * PX * 2);
  }

  function cloudLane(r, row) {
    const group = new THREE.Group();
    const items = [];
    const token = {};
    const dir = (row && row.dir < 0) ? -1 : 1;
    const clouds = (row && row.clouds) || [];
    for (let i = 0; i < clouds.length; i++) {
      const o = cloudPool.acquire(token);   // pool stamps ownership (steal-safe)
      configCloud(o, clouds[i], dir);
      group.add(o);
      items.push(o);
    }
    return {
      group: group,
      update: function (row2, frame) {
        const cl = (row2 && row2.clouds) || clouds;
        const n = Math.min(items.length, cl.length);
        for (let i = 0; i < n; i++) {
          const o = items[i];
          if (!cloudPool.owns(o, token)) continue;   // stolen — never write to it
          const c = cl[i], d = o.r3d;
          o.position.x = R3D.LX(c.x);
          d.bodyG.position.y = 0.36 + Math.sin(frame.t * 2 + c.seed) * 2.5 * PX;
          updateRain(d, frame.t);
        }
      },
      dispose: function () {
        for (let i = 0; i < items.length; i++) {
          cloudPool.release(items[i], token);        // no-op for stolen items
        }
        items.length = 0;
      },
    };
  }

  // ==================================================================
  // §2 — BOUNDING DEER (deer rows)
  // ==================================================================
  // Native model faces +X; mirrored via rotation.y = PI for dir < 0.
  // 2D y-map: torso center (2D -12) anchored at Y 0.19 (contract), so
  // y3d = 0.19 + (-y2d - 12)/64 for the upper-body features.
  const DEER_INK = '#26221f';

  function deerBodyGeo() {
    return R3D.assets.get('creatures:deerBody', function () {
      const p = [];
      // torso: capsule 0.44 long x 0.25 diameter, centered 0.19 up, axis along X
      const torso = new THREE.CapsuleGeometry(0.125, 0.19, 4, 10);
      torso.rotateZ(Math.PI / 2);
      torso.translate(0, 0.19, 0);
      p.push(U.tint(torso, PAL.deerBody));
      // cream rump patch + tail, poking out top-rear
      p.push(sphereAt(5.5 * PX, -11 * PX, 0.235, 0, PAL.deerRump, { ws: 10, hs: 8 }));
      p.push(sphereAt(2.8 * PX, -13.8 * PX, 0.245, 0, PAL.deerRump, { ws: 8, hs: 6 }));
      // neck: 7x17px box rising from the front of the torso
      p.push(boxAt(7 * PX, 17 * PX, 6 * PX, 11.5 * PX, 0.3072, 0, PAL.deerBody));
      // head: gently stretched sphere, snout forward
      p.push(sphereAt(5 * PX, 13 * PX, 0.44, 0, PAL.deerBody, { s: [1.3, 1, 0.95], ws: 12, hs: 9 }));
      // ear: small cone tipping back
      const ear = new THREE.ConeGeometry(2.5 * PX, 6 * PX, 6);
      ear.rotateZ(0.45);
      ear.translate(8 * PX, 0.515, 0);
      p.push(U.tint(ear, PAL.deerBody));
      // antlers: main beam + one tine each, splayed +-z on the head (2D strokes)
      const AR = 1.1 * PX;
      p.push(cylBetween(11 * PX, 0.5025, -2 * PX, 9 * PX, 0.6119, -3.2 * PX, AR, PAL.wood));
      p.push(cylBetween(9.7 * PX, 0.565, -2.5 * PX, 6 * PX, 0.596, -3.6 * PX, AR, PAL.wood));
      p.push(cylBetween(15 * PX, 0.5025, 2 * PX, 16 * PX, 0.6119, 3.2 * PX, AR, PAL.wood));
      p.push(cylBetween(15.6 * PX, 0.565, 2.5 * PX, 19 * PX, 0.596, 3.6 * PX, AR, PAL.wood));
      // eyes (both sides) + nose tip
      p.push(sphereAt(1.6 * PX, 14 * PX, 0.4634, 4 * PX, DEER_INK, { ws: 8, hs: 6 }));
      p.push(sphereAt(1.6 * PX, 14 * PX, 0.4634, -4 * PX, DEER_INK, { ws: 8, hs: 6 }));
      p.push(sphereAt(1.8 * PX, 18.5 * PX, 0.4244, 0, DEER_INK, { ws: 8, hs: 6 }));
      return mergeInto(p);
    });
  }

  // One scissor pair = near + far leg (z +-3.5px), hip pivot at the geometry
  // origin, feet reaching y = -0.115 (ground when the pivot sits at 0.11).
  function deerLegGeo() {
    return R3D.assets.get('creatures:deerLegPair', function () {
      const p = [];
      for (let s = -1; s <= 1; s += 2) {
        const g = new THREE.CylinderGeometry(1.7 * PX, 1.7 * PX, 0.115, 6);
        g.translate(0, -0.0575, s * 3.5 * PX);
        p.push(U.tint(g, PAL.deerLeg));
      }
      return mergeInto(p);
    });
  }

  function makeDeer() {
    const root = new THREE.Group();
    const bodyG = new THREE.Group();
    const body = new THREE.Mesh(deerBodyGeo(), R3D.MAT.opaque);
    const rear = new THREE.Mesh(deerLegGeo(), R3D.MAT.opaque);
    rear.position.set(-7 * PX, 0.11, 0);
    const front = new THREE.Mesh(deerLegGeo(), R3D.MAT.opaque);
    front.position.set(9 * PX, 0.11, 0);
    bodyG.add(body);
    bodyG.add(rear);
    bodyG.add(front);
    const blob = U.blob(14 * PX, 5 * PX, 'rgba(25,55,25,0.2)');      // stays grounded
    root.add(bodyG);
    root.add(blob);
    root.r3d = { bodyG: bodyG, rear: rear, front: front, blob: blob };
    return root;
  }
  // Cap 18: 40-run sim of the real world.js gen peaked at 14 simultaneous deer
  // in the 23-row cache window.
  const deerPool = new R3D.Pool(makeDeer, 18, 'deer');

  function deerLane(r, row) {
    const group = new THREE.Group();
    const items = [];
    const token = {};

    function acquireOne() {
      const o = deerPool.acquire(token);   // pool stamps ownership (steal-safe)
      group.add(o);
      items.push(o);
    }
    const initial = (row && row.deer) ? row.deer.length : 0;
    for (let i = 0; i < initial; i++) acquireOne();

    return {
      group: group,
      update: function (row2, frame) {
        const arr = (row2 && row2.deer) || [];
        while (items.length < arr.length) acquireOne();               // herd spawned
        while (items.length > arr.length) {                           // culled past edge
          deerPool.release(items.pop(), token);                       // no-op if stolen
        }
        const mirror = row2 && row2.dir < 0;
        for (let i = 0; i < items.length; i++) {
          const o = items[i];
          if (!deerPool.owns(o, token)) continue;                     // stolen — never write
          const dd = arr[i], d = o.r3d;
          o.position.x = R3D.LX(dd.x);
          o.rotation.y = mirror ? Math.PI : 0;
          // gallop phase driven by lane position, NOT time (verbatim 2D)
          const sx = (dd.x - 2.5) * 64;
          const bound = Math.abs(Math.sin(sx * 0.09));
          d.bodyG.position.y = bound * 10 * PX;                       // body lifts, blob stays
          const swing = bound - 0.5;                                  // ~ +-0.5 rad scissor
          d.rear.rotation.z = -swing;
          d.front.rotation.z = swing;
        }
      },
      dispose: function () {
        for (let i = 0; i < items.length; i++) {
          deerPool.release(items[i], token);                          // no-op for stolen items
        }
        items.length = 0;
      },
    };
  }

  // ==================================================================
  // §3 — THE EAGLE (global; circle / flee / death grab) + menace blob
  // ==================================================================
  const EAGLE_Y = 165 * PX;             // 2.578125 — hover height over the char's feet
  let eagleRoot = null, wingL = null, wingR = null, talonsG = null, menaceBlob = null;

  function eagleStaticGeo() {
    return R3D.assets.get('creatures:eagleStatic', function () {
      const p = [];
      // body: upright brown ellipsoid 24x30x18 px
      p.push(sphereAt(1, 0, 0, 0, PAL.eagle.body,
        { s: [12 * PX, 15 * PX, 9 * PX], ws: 14, hs: 10 }));
      // tail: flat wedge sweeping down-and-back from the body's base
      const ts = new THREE.Shape();
      ts.moveTo(-6 * PX, 0);
      ts.lineTo(6 * PX, 0);
      ts.lineTo(0, -14 * PX);
      const tail = new THREE.ExtrudeGeometry(ts, { depth: 4 * PX, bevelEnabled: false });
      tail.translate(0, 0, -2 * PX);
      tail.rotateX(0.55);
      tail.translate(0, -10 * PX, -1.5 * PX);
      p.push(U.tint(tail, PAL.eagle.tail));
      // bald-eagle white head
      p.push(sphereAt(8 * PX, 0, 13 * PX, 2 * PX, PAL.eagle.head, { ws: 14, hs: 10 }));
      // beak: yellow cone hooking forward-down-right
      const beak = new THREE.ConeGeometry(2.8 * PX, 7 * PX, 8);
      beak.rotateX(1.75);
      beak.rotateZ(-0.25);
      beak.translate(1.5 * PX, 11.5 * PX, 9.5 * PX);
      p.push(U.tint(beak, PAL.eagle.beak));
      // eyes + angry brows on the head front
      p.push(sphereAt(1.7 * PX, -3.5 * PX, 15 * PX, 8.2 * PX, DEER_INK, { ws: 8, hs: 6 }));
      p.push(sphereAt(1.7 * PX, 3.5 * PX, 15 * PX, 8.2 * PX, DEER_INK, { ws: 8, hs: 6 }));
      p.push(boxAt(5.9 * PX, 1.8 * PX, 1.5 * PX, -4.25 * PX, 18 * PX, 8 * PX, DEER_INK, -0.349));
      p.push(boxAt(5.9 * PX, 1.8 * PX, 1.5 * PX, 4.25 * PX, 18 * PX, 8 * PX, DEER_INK, 0.349));
      return mergeInto(p);
    });
  }

  // Flat wing slab with a swept feather tip, lying in the XZ plane, hinge at the
  // geometry origin (pivot group sits at the shoulder). side -1 = left (-X).
  function wingGeo(side) {
    return R3D.assets.get('creatures:eagleWing:' + side, function () {
      const pts = side < 0
        ? [[0, -6.5], [0, 6.5], [-36, 6.5], [-44, 2], [-38, -6.5]]
        : [[0, -6.5], [38, -6.5], [44, 2], [36, 6.5], [0, 6.5]];
      const sh = new THREE.Shape();
      sh.moveTo(pts[0][0] * PX, pts[0][1] * PX);
      for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0] * PX, pts[i][1] * PX);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 3 * PX, bevelEnabled: false });
      g.translate(0, 0, -1.5 * PX);
      g.rotateX(Math.PI / 2);           // shape chord -> world Z, thickness -> world Y
      return U.tint(g, PAL.eagle.wing);
    });
  }

  function talonGeo() {
    return R3D.assets.get('creatures:eagleTalons', function () {
      return mergeInto([
        boxAt(5 * PX, 9 * PX, 4 * PX, -4.5 * PX, -15.5 * PX, 3 * PX, PAL.eagle.talon),
        boxAt(5 * PX, 9 * PX, 4 * PX, 4.5 * PX, -15.5 * PX, 3 * PX, PAL.eagle.talon),
      ]);
    });
  }

  function buildEagle() {
    eagleRoot = new THREE.Group();
    eagleRoot.visible = false;
    eagleRoot.add(new THREE.Mesh(eagleStaticGeo(), R3D.MAT.opaque));
    wingL = new THREE.Group();
    wingL.position.set(-6 * PX, 0, 0);
    wingL.add(new THREE.Mesh(wingGeo(-1), R3D.MAT.opaque));
    wingR = new THREE.Group();
    wingR.position.set(6 * PX, 0, 0);
    wingR.add(new THREE.Mesh(wingGeo(1), R3D.MAT.opaque));
    talonsG = new THREE.Group();
    talonsG.add(new THREE.Mesh(talonGeo(), R3D.MAT.opaque));
    eagleRoot.add(wingL);
    eagleRoot.add(wingR);
    eagleRoot.add(talonsG);
    menaceBlob = U.blob(26 * PX, 9 * PX, 'rgba(0,0,0,0.1)');
    menaceBlob.visible = false;
    ctx3.worldGroup.add(eagleRoot);
    ctx3.worldGroup.add(menaceBlob);
  }

  // §6.4 verbatim state math. The eagle renders while circling ('active'),
  // fleeing, or executing the eagle death — the death grab persists through
  // 'over' (2D drawChar ran in every state but menu and kept drawing the eagle
  // holding the victim behind the game-over card); never in menu.
  function updateEagle(frame) {
    if (!eagleRoot) return;
    if (frame.mode === 'menu') {          // chr fields may be unset pre-first-run
      eagleRoot.visible = false;
      menaceBlob.visible = false;
      return;
    }
    const chr = frame.chr, eg = frame.eagle, t = frame.t;
    let show = false, grab = false, shadow = false;
    let ex = 0, ey = 0, ez = 0;

    const dying = (frame.mode === 'dying' || frame.mode === 'over') &&
      chr.deathCause === 'eagle';
    const playing = frame.mode === 'play';
    const charX = R3D.X(chr.colF + 0.5);
    const charZ = R3D.Z(chr.rowF);

    if (dying) {
      // dive from +480px above over 0.4s, then carry: chr.z (already rising at
      // 300px/s in the frame) + the locked 52px grab offset keeps them together
      const dive = Math.min(chr.dieT / 0.4, 1);
      show = true; grab = true;
      ex = charX;
      ez = charZ;
      ey = chr.z * PX + 52 * PX + (1 - dive) * 480 * PX;
    } else if (playing && eg.state === 'active') {
      show = true; shadow = true;
      ex = charX + Math.sin(t * 2.6) * 46 * PX;
      ey = EAGLE_Y + Math.sin(t * 5) * 9 * PX;    // ground-relative, ignores hop z
      ez = charZ;
    } else if (playing && eg.state === 'flee') {
      const k = Math.min(eg.t / 0.8, 1);
      show = true;
      ex = charX + Math.sin(t * 2.6) * 46 * PX * (1 - k) + eg.fleeDir * k * k * 520 * PX;
      ey = EAGLE_Y + Math.sin(t * 5) * 9 * PX * (1 - k) + k * k * 300 * PX;
      ez = charZ;
    }

    eagleRoot.visible = show;
    if (show) {
      eagleRoot.position.set(ex, ey, ez);
      const wr = 0.25 + Math.sin(t * 13) * 0.45;  // fast flap, 13 rad/s
      wingL.rotation.z = -wr;
      wingR.rotation.z = wr;
      talonsG.position.y = grab ? -3 * PX : 0;    // talons extend to snatch
    }

    menaceBlob.visible = shadow;
    if (shadow) {
      // pulsing menace shadow at the char's ground point ('active' only)
      const s8 = Math.sin(t * 8);
      menaceBlob.position.x = charX;
      menaceBlob.position.z = charZ;
      menaceBlob.scale.x = (26 + 4 * s8) * PX * 2;
      menaceBlob.material.opacity = 0.1 + 0.08 * s8;
    }
  }

  // ==================================================================
  // init + registration
  // ==================================================================
  function prewarm(pool) {
    const tmp = [];
    for (let i = 0; i < pool.cap; i++) tmp.push(pool.acquire());
    for (let i = 0; i < tmp.length; i++) pool.release(tmp[i]);
  }

  R3D.register('creatures', {
    init: function (c) {
      ctx3 = c;
      buildEagle();
      prewarm(cloudPool);               // builds all shared geometry up front —
      prewarm(deerPool);                // no mid-game hitches
    },
    cloudLane: cloudLane,
    deerLane: deerLane,
    updateEagle: updateEagle,
  });
})();
