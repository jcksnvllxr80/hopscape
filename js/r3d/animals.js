// Hopscape 3D — js/r3d/animals.js — the 4 playable characters (CONTRACT.md §6.5, §8).
//
// Owns: the cat/dog/bunny/duck rigs (chunky low-poly, faces on +Z toward the camera),
// the full pose system (hop z, volume-true squash/stretch, lean, flip, duck air wings,
// idle bob-parts + blink, dead pancake + blue halos, shrink-vanish, blob shadow),
// R3D.animals.updateCharacter(frame) (bump nudge + all frame-driven choreography), and
// R3D.animals.drawCards(...) — the character-select portrait pipeline (§8) via core's
// shared offscreen renderer.
//
// All shape numbers are the 2D sprites.js values VERBATIM in px, built in px space and
// baked to world units with a final geometry.scale(1/64). 2D canvas (x, -y) -> 3D (X, +Y).
// Canvas rotations map to 3D as rotation.z = -angle2d (y-axis flip inverts handedness).
//
// Perf: every geometry is merged + vertex-tinted and drawn with R3D.MAT.opaque, cached in
// R3D.assets and SHARED between the gameplay rig and the portrait rig of each animal.
// Rigs are persistent module globals — nothing here is ever disposed. castShadow stays
// false on all rig meshes (the blob shadow is the gameplay-readable shadow, §7.4).
(function () {
  'use strict';
  const THREE = window.THREE, R3D = window.R3D;
  if (!THREE || !R3D) {
    console.error('[R3D.animals] window.THREE / window.R3D missing — load order broken');
    return;
  }

  const PXS = R3D.PX;                     // 1/64 — px -> units
  const INK = '#26221f';

  // ---- palettes (module-private per spec; translucent 2D overlays pre-blended
  //      over their underlying fur color so everything stays on the one opaque Lambert) ----
  const CAT = {
    fur: '#f5993d', tail: '#e08a2e', tailTip: '#c96f1e', stripe: '#d3781f',
    innerEar: '#ff9fb2', nose: '#ff8fa3', tummy: '#fff4e6', iris: '#7ec850',
    mouth: '#7a4a1a',
    whisker: '#8a5626',                   // rgba(80,50,25,0.65) over #f5993d
  };
  const DOG = {
    fur: '#e2b271', ear: '#a9713a', tail: '#b9854b', patch: '#c9945a',
    muzzle: '#f8ecd7', ink: '#3a2d24', tongue: '#ff8fa3',
    blush: '#ec9e7e',                     // rgba(255,120,150,0.35) over #e2b271
  };
  const BUN = {
    fur: '#f4f1ec', innerEar: '#ffb7c9', tail: '#e9e4db', cheek: '#fdfbf7',
    nose: '#ff8fa3', feet: '#e6dfd4', tooth: '#ffffff',
    dot: '#cac9c6',                       // rgba(0,0,0,0.2) over #fdfbf7
    blush: '#f8c7ce',                     // rgba(255,120,150,0.35) over #f4f1ec
  };
  const DUK = {
    body: '#ffd93d', belly: '#ffe680', tailWing: '#f0c11f', foldWing: '#eec22f',
    bill: '#ff9d2e', billLow: '#f0871a',
    nostril: '#bf7623',                   // rgba(0,0,0,0.25) over #ff9d2e
    blush: '#ffb75c',                     // rgba(255,120,150,0.35) over #ffd93d
  };

  // ==================================================================
  // Geometry kit (build-time only — px space)
  // ==================================================================
  function clampAxis(v, h) { return v < -h ? -h : v > h ? h : v; }

  // Chunky rounded box: subdivided BoxGeometry snapped to the rounded-box surface
  // (clamp to inner box + push out radius r). Normals come out exact.
  function roundedBox(w, h, d, r, seg) {
    seg = seg || 3;
    r = Math.min(r, w / 2, h / 2, d / 2);
    const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const cx = clampAxis(x, hw), cy = clampAxis(y, hh), cz = clampAxis(z, hd);
      let nx = x - cx, ny = y - cy, nz = z - cz;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l > 1e-6) { nx /= l; ny /= l; nz /= l; }
      else { nx = nor.getX(i); ny = nor.getY(i); nz = nor.getZ(i); }
      pos.setXYZ(i, cx + nx * r, cy + ny * r, cz + nz * r);
      nor.setXYZ(i, nx, ny, nz);
    }
    return g;
  }

  // Ellipsoid (unit sphere scaled).
  function ell3(rx, ry, rz, ws, hs) {
    const g = new THREE.SphereGeometry(1, ws || 10, hs || 8);
    g.scale(rx, ry, rz);
    return g;
  }

  // Flat triangle prism in the XY plane (3D-y already up), extruded along Z, centered.
  function triGeo(x1, y1, x2, y2, x3, y3, depth) {
    const s = new THREE.Shape();
    s.moveTo(x1, y1); s.lineTo(x2, y2); s.lineTo(x3, y3); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return g;
  }

  // Thin round rod between two XY points (whiskers).
  function segGeo(x1, y1, x2, y2, r) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const g = new THREE.CylinderGeometry(r, r, len, 5, 1);
    g.rotateZ(Math.atan2(dy, dx) - Math.PI / 2);
    g.translate((x1 + x2) / 2, (y1 + y2) / 2, 0);
    return g;
  }

  // Bake a part into the accumulator: optional pre-offset (px/py/pz, for rotation about
  // a pivot), then rotation, then translation, then vertex tint. All in px space.
  function add(parts, g, hex, o) {
    o = o || {};
    if (o.px || o.py || o.pz) g.translate(o.px || 0, o.py || 0, o.pz || 0);
    if (o.rx) g.rotateX(o.rx);
    if (o.ry) g.rotateY(o.ry);
    if (o.rz) g.rotateZ(o.rz);
    g.translate(o.x || 0, o.y || 0, o.z || 0);
    R3D.util.tint(g, hex, o.mul);
    parts.push(g);
    return g;
  }

  // Merge a part list -> ONE unit-space geometry, cached in R3D.assets so the gameplay
  // rig and the portrait rig of an animal share every GPU buffer. Returns a fresh Mesh.
  function cachedMesh(key, makeParts) {
    const geo = R3D.assets.get(key, function () {
      const g = R3D.util.mergeGeoms(makeParts());
      g.scale(PXS, PXS, PXS);
      return g;
    });
    return new THREE.Mesh(geo, R3D.MAT.opaque);
  }

  // Standard face() eyes (dog/bunny/duck): ink circles r 3.4 at (±dx, ey), white
  // highlights r 1.2 at (±dx + 1.2, ey + 1.2) — BOTH offset the same +x way (verbatim).
  // Returned mesh's origin is the eye-line center so blink can squash about it.
  function faceEyes(key, ey, dx, zFace) {
    const m = cachedMesh(key, function () {
      const e = [];
      add(e, ell3(3.4, 3.4, 1.8, 10, 8), INK, { x: -dx, z: 1.0 });
      add(e, ell3(3.4, 3.4, 1.8, 10, 8), INK, { x: dx, z: 1.0 });
      add(e, new THREE.SphereGeometry(1.2, 7, 5), '#ffffff', { x: -dx + 1.2, y: 1.2, z: 2.6 });
      add(e, new THREE.SphereGeometry(1.2, 7, 5), '#ffffff', { x: dx + 1.2, y: 1.2, z: 2.6 });
      return e;
    });
    m.position.set(0, ey * PXS, zFace * PXS);
    return m;
  }

  // ==================================================================
  // The four rigs — geometry verbatim from spec-animals.md §2–5 (px / 64)
  // ==================================================================

  // ---------- Mittens the cat (orange tabby; ear tips at EXACTLY 1.0 unit) ----------
  function buildCat(rig) {
    rig.body.add(cachedMesh('animals:cat:static', function () {
      const p = [];
      // one-piece body blob: rrf(-20,-46,40,46,15)
      add(p, roundedBox(40, 46, 34, 15, 7), CAT.fur, { y: 23 });
      // tall pointy ears (tips at y=64px = 1.0 tile — tallest point in the game)
      add(p, triGeo(-19, 38, -14, 64, -1, 44, 7), CAT.fur, { z: -2 });
      add(p, triGeo(19, 38, 14, 64, 1, 44, 7), CAT.fur, { z: -2 });
      add(p, triGeo(-14, 42, -12.5, 56, -5.5, 44.5, 1.6), CAT.innerEar, { z: 2.4 });
      add(p, triGeo(14, 42, 12.5, 56, 5.5, 44.5, 1.6), CAT.innerEar, { z: 2.4 });
      // cheek fluff tufts
      add(p, triGeo(-20, 22, -27, 26, -20, 30, 6), CAT.fur, { z: 7 });
      add(p, triGeo(20, 22, 27, 26, 20, 30, 6), CAT.fur, { z: 7 });
      // tabby forehead "M" (three plates hugging the crown; middle taller + higher;
      // tucked low + laid flat so the tips never stand proud of the head in portraits)
      add(p, roundedBox(5, 10, 3, 1.5, 3), CAT.stripe, { x: -7.5, y: 40, z: 11.6, rx: -0.9 });
      add(p, roundedBox(5, 13, 3, 1.5, 3), CAT.stripe, { y: 40.3, z: 11.2, rx: -0.9 });
      add(p, roundedBox(5, 10, 3, 1.5, 3), CAT.stripe, { x: 7.5, y: 40, z: 11.6, rx: -0.9 });
      // side stripes on the body edges
      add(p, roundedBox(3, 8, 8, 1.2, 2), CAT.stripe, { x: -19, y: 32, z: 3 });
      add(p, roundedBox(3, 8, 8, 1.2, 2), CAT.stripe, { x: 19, y: 32, z: 3 });
      // white tummy patch, low — hugged flat against the lower body curve so the
      // pitched camera reads it as belly (upright it becomes a slab under the muzzle)
      add(p, roundedBox(20, 8, 3, 4, 3), CAT.tummy, { y: 6, z: 14.5, rx: 0.8 });
      // pink nose (point-down triangle)
      add(p, triGeo(-2.8, 24.5, 2.8, 24.5, 0, 20.8, 2), CAT.nose, { z: 17.4 });
      // ':3' mouth — two separate downward arcs (canvas arc 0.2..0.85π, y-down)
      add(p, new THREE.TorusGeometry(2.8, 0.8, 5, 10, 2.4704), CAT.mouth,
        { x: -2.8, y: 19.2, z: 17.2, rz: -Math.PI * 0.85 });
      add(p, new THREE.TorusGeometry(2.8, 0.8, 5, 10, 2.4704), CAT.mouth,
        { x: 2.8, y: 19.2, z: 17.2, rz: -Math.PI * 0.85 });
      // whiskers, 3 per side, fanned up/flat/down
      add(p, segGeo(10, 27, 24, 30, 1), CAT.whisker, { z: 17.2 });
      add(p, segGeo(10, 24, 25, 24, 1), CAT.whisker, { z: 17.2 });
      add(p, segGeo(10, 21, 24, 18, 1), CAT.whisker, { z: 17.2 });
      add(p, segGeo(-10, 27, -24, 30, 1), CAT.whisker, { z: 17.2 });
      add(p, segGeo(-10, 24, -25, 24, 1), CAT.whisker, { z: 17.2 });
      add(p, segGeo(-10, 21, -24, 18, 1), CAT.whisker, { z: 17.2 });
      // feet stubs (bottoms at ground)
      add(p, roundedBox(11, 7, 10, 3, 3), CAT.tail, { x: -9.5, y: 3.5, z: 13 });
      add(p, roundedBox(11, 7, 10, 3, 3), CAT.tail, { x: 9.5, y: 3.5, z: 13 });
      return p;
    }));

    // green almond eyes + vertical slit pupils + same-direction highlights (verbatim)
    rig.eyes = cachedMesh('animals:cat:eyes', function () {
      const e = [];
      add(e, ell3(4.4, 5.4, 2.0, 10, 8), CAT.iris, { x: -8, z: 0.6 });
      add(e, ell3(4.4, 5.4, 2.0, 10, 8), CAT.iris, { x: 8, z: 0.6 });
      add(e, ell3(1.8, 4.6, 1.6, 8, 6), INK, { x: -8, z: 1.8 });
      add(e, ell3(1.8, 4.6, 1.6, 8, 6), INK, { x: 8, z: 1.8 });
      add(e, new THREE.SphereGeometry(1.2, 7, 5), '#ffffff', { x: -9.3, y: 2.4, z: 3.0 });
      add(e, new THREE.SphereGeometry(1.2, 7, 5), '#ffffff', { x: 6.7, y: 2.4, z: 3.0 });
      return e;
    });
    rig.eyes.position.set(0, 31 * PXS, 17 * PXS);
    rig.body.add(rig.eyes);

    // curled tail, right side, behind — quadratic curve (16,-8)->(30,-14)->(26,-34)
    // + tip ball. Wag = vertical stretch about the base so the TIP bobs exactly
    // sin(t*4)*4 px (verbatim amplitude/rate).
    const tail = new THREE.Group();
    tail.position.set(16 * PXS, 8 * PXS, -12 * PXS);
    tail.add(cachedMesh('animals:cat:tail', function () {
      const tp = [];
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(14, 6, 0),
        new THREE.Vector3(10, 26, 0));
      add(tp, new THREE.TubeGeometry(curve, 10, 4, 7, false), CAT.tail, {});
      add(tp, new THREE.SphereGeometry(4.5, 9, 7), CAT.tailTip, { x: 10, y: 26 });
      return tp;
    }));
    rig.body.add(tail);

    rig.anim = function (t) {
      tail.scale.y = 1 - Math.sin(t * 4) * (4 / 26);   // tip at 34 - wag px
    };
  }

  // ---------- Biscuit the pup (tan; asymmetric snout patch) ----------
  function buildDog(rig) {
    rig.body.add(cachedMesh('animals:dog:static', function () {
      const p = [];
      // body: rrf(-20,-44,40,44,15)
      add(p, roundedBox(40, 44, 34, 15, 7), DOG.fur, { y: 22 });
      // floppy ears — 11×21 slabs pivoted at the head-top corners (±16,43), ±0.28 rad
      // (canvas -0.28 -> 3D +0.28); pre-offset centers them hanging below the pivot.
      add(p, roundedBox(11, 21, 5, 4, 3), DOG.ear,
        { px: -3.5, py: -10.5, rz: 0.28, x: -16, y: 43, z: 4 });
      add(p, roundedBox(11, 21, 5, 4, 3), DOG.ear,
        { px: 3.5, py: -10.5, rz: -0.28, x: 16, y: 43, z: 4 });
      // darker snout patch AROUND the right eye (asymmetric marking!)
      add(p, ell3(8, 8, 2, 12, 8), DOG.patch, { x: 9, y: 31, z: 16.8 });
      // muzzle + nose + philtrum
      add(p, ell3(12, 9, 4.5, 12, 9), DOG.muzzle, { y: 19, z: 16.5 });
      add(p, roundedBox(8, 6, 3, 2.5, 2), DOG.ink, { y: 24, z: 19.8 });
      add(p, new THREE.BoxGeometry(1.6, 4, 1.2), DOG.ink, { y: 19, z: 20.8 });
      // blush(15,-25) on the curved cheeks
      add(p, ell3(3.6, 3.6, 1.4, 9, 6), DOG.blush, { x: -14.5, y: 25, z: 12.9, ry: -0.7 });
      add(p, ell3(3.6, 3.6, 1.4, 9, 6), DOG.blush, { x: 14.5, y: 25, z: 12.9, ry: 0.7 });
      // feet
      add(p, roundedBox(11, 7, 10, 3, 3), DOG.patch, { x: -9.5, y: 3.5, z: 13 });
      add(p, roundedBox(11, 7, 10, 3, 3), DOG.patch, { x: 9.5, y: 3.5, z: 13 });
      return p;
    }));

    rig.eyes = faceEyes('animals:dog:eyes', 31, 8, 17);
    rig.body.add(rig.eyes);

    // tail nub — horizontal wag ±1.5px at 5 rad/s (verbatim)
    const tail = new THREE.Group();
    tail.position.set(19 * PXS, 15 * PXS, -10 * PXS);
    tail.add(cachedMesh('animals:dog:tail', function () {
      const tp = [];
      add(tp, new THREE.SphereGeometry(5.5, 10, 8), DOG.tail, {});
      return tp;
    }));
    rig.body.add(tail);

    // panting tongue — length 5.5..7.5px at 6 rad/s, hanging from the muzzle
    const tongue = new THREE.Group();
    tongue.position.set(0, 16 * PXS, 20 * PXS);
    tongue.add(cachedMesh('animals:dog:tongue', function () {
      const tp = [];
      add(tp, roundedBox(6, 6.5, 2, 2.4, 2), DOG.tongue, { y: -3.25 });
      return tp;
    }));
    rig.body.add(tongue);

    rig.anim = function (t) {
      tail.position.x = (19 + Math.sin(t * 5) * 1.5) * PXS;
      tongue.scale.y = (6.5 + Math.sin(t * 6)) / 6.5;
    };
  }

  // ---------- Clover the bunny (cream; long swaying ears, buck teeth) ----------
  function buildBunny(rig) {
    // ears — animated groups pivoted at (±9,38), splayed ±0.14, counter-swaying
    function makeEar(sx) {
      const g = new THREE.Group();
      g.position.set(sx * 9 * PXS, 38 * PXS, -3 * PXS);
      g.add(cachedMesh('animals:bunny:ear', function () {
        const p = [];
        add(p, roundedBox(10, 38, 6, 4, 3), BUN.fur, { y: 17 });          // rrf(-5,-36,10,38,5)
        add(p, roundedBox(5, 26, 1.8, 2, 2), BUN.innerEar, { y: 17, z: 2.6 });
        return p;
      }));
      return g;
    }
    const earL = makeEar(-1), earR = makeEar(1);
    rig.body.add(earL, earR);

    rig.body.add(cachedMesh('animals:bunny:static', function () {
      const p = [];
      // tail ball behind-right
      add(p, new THREE.SphereGeometry(6, 10, 8), BUN.tail, { x: 17, y: 12, z: -12 });
      // body: rrf(-19,-42,38,42,15)
      add(p, roundedBox(38, 42, 32, 15, 7), BUN.fur, { y: 21 });
      // cheek puffs
      add(p, ell3(7.5, 7.5, 2.5, 12, 8), BUN.cheek, { x: -9, y: 20, z: 14.6 });
      add(p, ell3(7.5, 7.5, 2.5, 12, 8), BUN.cheek, { x: 9, y: 20, z: 14.6 });
      // pink nose triangle
      add(p, triGeo(-2.5, 25, 2.5, 25, 0, 21.5, 1.6), BUN.nose, { z: 16.4 });
      // buck teeth — two 3.2×5.5 blocks with a 0.6px gap reading as the split
      add(p, roundedBox(3.2, 5.5, 1.6, 1, 2), BUN.tooth, { x: -1.9, y: 17.25, z: 16.2 });
      add(p, roundedBox(3.2, 5.5, 1.6, 1, 2), BUN.tooth, { x: 1.9, y: 17.25, z: 16.2 });
      // whisker dots, 3 per cheek (on the puff surfaces)
      add(p, new THREE.SphereGeometry(0.8, 6, 4), BUN.dot, { x: -11, y: 22, z: 16.7 });
      add(p, new THREE.SphereGeometry(0.8, 6, 4), BUN.dot, { x: -8, y: 19, z: 16.8 });
      add(p, new THREE.SphereGeometry(0.8, 6, 4), BUN.dot, { x: -12, y: 18, z: 16.4 });
      add(p, new THREE.SphereGeometry(0.8, 6, 4), BUN.dot, { x: 11, y: 22, z: 16.7 });
      add(p, new THREE.SphereGeometry(0.8, 6, 4), BUN.dot, { x: 8, y: 19, z: 16.8 });
      add(p, new THREE.SphereGeometry(0.8, 6, 4), BUN.dot, { x: 12, y: 18, z: 16.4 });
      // blush(14,-24) on the outer cheek slopes
      add(p, ell3(3.6, 3.6, 1.4, 9, 6), BUN.blush, { x: -13.8, y: 24, z: 15.6, ry: -0.55 });
      add(p, ell3(3.6, 3.6, 1.4, 9, 6), BUN.blush, { x: 13.8, y: 24, z: 15.6, ry: 0.55 });
      // WIDER feet (13px)
      add(p, roundedBox(13, 7, 10, 3, 3), BUN.feet, { x: -9.5, y: 3.5, z: 12 });
      add(p, roundedBox(13, 7, 10, 3, 3), BUN.feet, { x: 9.5, y: 3.5, z: 12 });
      return p;
    }));

    rig.eyes = faceEyes('animals:bunny:eyes', 29, 7, 16);
    rig.body.add(rig.eyes);

    rig.anim = function (t) {
      const sway = Math.sin(t * 2) * 0.04;             // verbatim
      earL.rotation.z = 0.14 - sway;                   // canvas -0.14+sway
      earR.rotation.z = -0.14 + sway;                  // canvas  0.14-sway
    };
  }

  // ---------- Puddles the duck (yellow; the only rig that reads `air`) ----------
  function buildDuck(rig) {
    rig.body.add(cachedMesh('animals:duck:static', function () {
      const p = [];
      // upturned tail wedge
      add(p, triGeo(15, 12, 24, 21, 14, 20, 5), DUK.tailWing, { z: -10 });
      // body: rrf(-19,-43,38,43,15)
      add(p, roundedBox(38, 43, 32, 15, 7), DUK.body, { y: 21.5 });
      // pale belly
      add(p, roundedBox(22, 15, 3, 7, 3), DUK.belly, { y: 10.5, z: 14.5, rx: 0.3 });
      // wide flat bill: upper + recessed lower + nostrils on the top slope
      add(p, ell3(11.5, 5.5, 6, 12, 9), DUK.bill, { y: 26, z: 15 });
      add(p, ell3(8.5, 3.6, 5, 10, 8), DUK.billLow, { y: 21.5, z: 14.5 });
      add(p, new THREE.SphereGeometry(0.9, 6, 4), DUK.nostril, { x: -3, y: 28.5, z: 19.6 });
      add(p, new THREE.SphereGeometry(0.9, 6, 4), DUK.nostril, { x: 3, y: 28.5, z: 19.6 });
      // blush(14,-29)
      add(p, ell3(3.6, 3.6, 1.4, 9, 6), DUK.blush, { x: -13.8, y: 29, z: 12.1, ry: -0.75 });
      add(p, ell3(3.6, 3.6, 1.4, 9, 6), DUK.blush, { x: 13.8, y: 29, z: 12.1, ry: 0.75 });
      // orange feet (shorter: 6px tall)
      add(p, roundedBox(10, 6, 9, 3, 3), DUK.bill, { x: -9, y: 3, z: 12 });
      add(p, roundedBox(10, 6, 9, 3, 3), DUK.bill, { x: 9, y: 3, z: 12 });
      return p;
    }));

    rig.eyes = faceEyes('animals:duck:eyes', 33, 7.5, 15.6);
    rig.body.add(rig.eyes);

    // folded wings flat against the sides (grounded)
    const wingFold = cachedMesh('animals:duck:wingFold', function () {
      const p = [];
      add(p, ell3(5, 10.5, 3.5, 10, 8), DUK.foldWing, { x: -16, y: 22, z: 5 });
      add(p, ell3(5, 10.5, 3.5, 10, 8), DUK.foldWing, { x: 16, y: 22, z: 5 });
      return p;
    });
    rig.body.add(wingFold);

    // spread flapping wings — 18×10 slabs pivoted at the shoulders (±18,-27)
    function makeWing(sx) {
      const g = new THREE.Group();
      g.position.set(sx * 18 * PXS, 27 * PXS, 0);
      g.add(cachedMesh(sx < 0 ? 'animals:duck:wingL' : 'animals:duck:wingR', function () {
        const p = [];
        add(p, roundedBox(18, 10, 3, 4, 3), DUK.tailWing, { x: sx * 8 });
        return p;
      }));
      g.visible = false;
      return g;
    }
    const wingL = makeWing(-1), wingR = makeWing(1);
    rig.body.add(wingL, wingR);

    rig.anim = function (t, o) {
      const fly = !!(o && o.air);
      wingFold.visible = !fly;
      wingL.visible = fly;
      wingR.visible = fly;
      if (fly) {
        const flap = Math.sin(t * 18) * 0.35 + 0.55;   // verbatim
        wingL.rotation.z = 0.5 + flap;                 // canvas rotate(-0.5 - flap)
        wingR.rotation.z = -(0.5 + flap);              // canvas rotate( 0.5 + flap)
      }
    };
  }

  const BUILDERS = { cat: buildCat, dog: buildDog, bunny: buildBunny, duck: buildDuck };

  // ==================================================================
  // Shared rig plumbing: blob shadow + dead halos + pose()
  // ==================================================================
  const SHADOW_SX = 34 * PXS;             // blob geo has diameter 1 -> scale = 2·rx
  const SHADOW_SZ = 22 * PXS;             // 2·ry (17 × 11 px; deepened from the 2D
                                          // 6.5 so a front rim peeks below the feet)

  function attachCommon(rig) {
    // gameplay-readable blob shadow (rgba(25,55,25,0.24), 17×11px at the feet,
    // nudged +8px toward +z so the 58°-pitch camera sees a front rim under grounded
    // rigs (feet fronts occlude the ground out to z ≈ 17px; rim = 19px reach)
    rig.shadow = R3D.util.blob(17 * PXS, 11 * PXS, 'rgba(25,55,25,0.24)');
    rig.shadow.position.z = 8 * PXS;
    rig.group.add(rig.shadow);

    // dead "dazed" halos — drawn UNSQUASHED in world space like the 2D wrapper:
    // ground puddle ellipse + camera-facing halo sprite; visible only while pancaked.
    rig.puddle = R3D.util.blob(25 * PXS, 6 * PXS, 'rgba(120,180,255,0.35)');
    rig.puddle.position.y = 0.028;        // layer just above the char blob (0.024)
    rig.puddle.visible = false;
    rig.group.add(rig.puddle);

    const haloMat = R3D.assets.get('animals:haloMat', function () {
      const tex = R3D.util.canvasTex(128, 128, function (ctx) {
        const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
        grd.addColorStop(0, 'rgba(110,150,200,1)');
        grd.addColorStop(0.78, 'rgba(110,150,200,1)');
        grd.addColorStop(1, 'rgba(110,150,200,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(64, 64, 62, 0, Math.PI * 2);
        ctx.fill();
      });
      return new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.3, depthWrite: false });
    });
    rig.halo = new THREE.Sprite(haloMat);
    rig.halo.scale.set(54 * PXS, 30 * PXS, 1);         // rx 27, ry 15 px
    rig.halo.position.y = 10 * PXS;
    rig.halo.renderOrder = 3;
    rig.halo.visible = false;
    rig.group.add(rig.halo);
  }

  // pose(opts) — byte-compatible with the 2D Sprites.animal opts (z stays IN PX).
  // Transform order mirrors the 2D wrapper: (dead·squash·flip scales) -> lean rotation
  // -> uniform shrink -> lift; THREE's T·R·S node composition matches it exactly.
  function poseRig(rig, o) {
    o = o || {};
    const t = o.t || 0;
    const z = o.z || 0;
    const squash = o.squash == null ? 1 : o.squash;
    const dead = !!o.dead;
    const blink = !dead && (((t + (o.seed || 0)) % 3.4) > 3.25);   // verbatim clock
    const shrink = o.shrink == null ? 1 : o.shrink;

    const body = rig.body;
    body.visible = shrink > 0.001;
    body.position.y = z * PXS;
    // canvas rotate(lean*0.1) tips the head INTO the hop direction; the y-flip to 3D
    // negates the angle (see header note).
    body.rotation.z = -(o.lean || 0) * 0.1;
    const invSq = 1 / Math.sqrt(squash);               // volume-true squash (§6.5)
    let sx = shrink * invSq, sy = shrink * squash, sz = shrink * invSq;
    if (dead) { sx *= 1.3; sy *= 0.5; sz *= 1.3; }     // pancake
    body.scale.set(o.flip ? -sx : sx, sy, sz);

    rig.eyes.scale.y = blink ? 0.1 : 1;                // slit-blink (never when dead)

    // shadow stays at the ground point: sh = max(0.5, 1 - z/70) * shrink (z in px)
    const sh = Math.max(0.5, 1 - z / 70) * shrink;
    rig.shadow.visible = shrink > 0.05;
    if (rig.shadow.visible) rig.shadow.scale.set(SHADOW_SX * sh, 1, SHADOW_SZ * sh);

    rig.puddle.visible = dead;
    rig.halo.visible = dead;

    if (rig.anim) rig.anim(t, o);
  }

  // buildRig(id) -> Rig { group, pose } — feet at the local origin, FACES +Z.
  // pose() transforms only the INNER body node, so callers own the outer group's
  // position (gameplay) and scale (card scaling) without fighting the pose.
  function buildRig(id) {
    const rig = {
      id: id,
      group: new THREE.Group(),
      body: new THREE.Group(),
      eyes: null,
      anim: null,
      shadow: null, puddle: null, halo: null,
    };
    rig.group.add(rig.body);
    (BUILDERS[id] || BUILDERS.cat)(rig);
    attachCommon(rig);
    rig.pose = function (o) { poseRig(rig, o); };
    return rig;
  }

  // ==================================================================
  // updateCharacter(frame) — §6.5 (all death choreography arrives pre-computed)
  // ==================================================================
  let ctx3 = null;
  let charRoot = null;
  const gameRigs = {};                    // id -> rig (lazy, kept forever)
  let activeRig = null;

  // reused every frame — zero allocation in the render path
  const POSE_OPTS = { t: 0, z: 0, squash: 1, shrink: 1, flip: false, lean: 0, air: false, dead: false, seed: 1.7 };

  function updateCharacter(frame) {
    if (!charRoot) return;
    if (frame.mode === 'menu') {                       // hidden entirely in menu
      if (activeRig) { activeRig.group.visible = false; activeRig = null; }
      return;
    }
    if (frame.camMode === 'fp') {                      // first-person: you ARE the character
      if (activeRig) { activeRig.group.visible = false; activeRig = null; }
      return;
    }
    const C = frame.chr;
    let rig = gameRigs[C.id];
    if (!rig) {
      rig = buildRig(C.id);
      rig.group.visible = false;
      charRoot.add(rig.group);
      gameRigs[C.id] = rig;
    }
    if (activeRig && activeRig !== rig) activeRig.group.visible = false;
    activeRig = rig;
    rig.group.visible = true;

    // bump nudge (blocked move): kb = sin(π·t/0.13)·7 px toward (dc, dr); forward = -Z
    let bx = 0, bz = 0;
    const bump = C.bump;
    if (bump) {
      const kb = Math.sin(Math.PI * bump.t / 0.13) * 7;
      bx = bump.dc * kb * PXS;
      bz = -bump.dr * kb * PXS;
    }
    rig.group.position.x = R3D.X(C.colF + 0.5) + bx;
    rig.group.position.z = R3D.Z(C.rowF) + bz;

    POSE_OPTS.t = frame.t;
    POSE_OPTS.z = C.z;
    POSE_OPTS.squash = C.squash;
    POSE_OPTS.shrink = C.shrink;
    POSE_OPTS.flip = C.flip;
    POSE_OPTS.lean = C.lean;
    POSE_OPTS.air = C.air;
    POSE_OPTS.dead = C.dead;
    rig.pose(POSE_OPTS);
  }

  // ==================================================================
  // drawCards(cardCanvases, tGlobal, selected) — §8 portrait pipeline.
  // Uses core's shared offscreen renderer; 4 DEDICATED portrait rigs (never the
  // gameplay rigs), shown one at a time, blitted into the existing card canvases.
  // ==================================================================
  let portraitRigs = null;

  const CARD_OPTS = { t: 0, z: 0, seed: 0 };

  function drawCards(cards, t, selected) {
    if (!cards || !cards.length) return;
    const P = R3D.util.portraitRenderer();
    if (!P) return;
    if (!portraitRigs) {
      portraitRigs = [];
      for (let i = 0; i < 4; i++) {
        const rg = buildRig(R3D.ANIMALS[i].id);
        rg.group.visible = false;
        P.scene.add(rg.group);
        portraitRigs.push(rg);
      }
    }
    for (let i = 0; i < 4; i++) {
      const g = portraitRigs[i];
      const sel = i === selected;
      const bounce = sel
        ? Math.abs(Math.sin(t * 3.2)) * 8                    // verbatim 2D card hop
        : Math.abs(Math.sin(t * 2 + i * 1.3)) * 2.5;
      g.group.visible = true;
      g.group.scale.setScalar(R3D.ANIMALS[i].id === 'bunny' ? 1.05 : 1.28);
      CARD_OPTS.t = t + i * 0.9;                             // verbatim desync phases
      CARD_OPTS.z = bounce;
      CARD_OPTS.seed = i * 1.3;
      g.pose(CARD_OPTS);
      P.renderer.render(P.scene, P.camera);
      g.group.visible = false;
      const c2 = cards[i].c2;
      c2.setTransform(1, 0, 0, 1, 0, 0);
      c2.clearRect(0, 0, 192, 208);
      c2.drawImage(P.canvas, 0, 0);                          // same-task GL->2D copy
    }
  }

  // ==================================================================
  // registration
  // ==================================================================
  R3D.register('animals', {
    init: function (c) {
      ctx3 = c;
      charRoot = new THREE.Group();
      charRoot.name = 'characterRoot';
      ctx3.worldGroup.add(charRoot);
    },
    buildRig: buildRig,
    updateCharacter: updateCharacter,
    drawCards: drawCards,
  });
})();
