// Hopscape 3D — js/r3d/terrain.js — ground surfaces for every row type,
// dirt carving, river logs + lily pads, and the best-score line (CONTRACT §6.1).
//
// Classic-script IIFE. Reads window.THREE / window.R3D. Registers:
//   ground(r, row) -> Part          (grass/undefined, road, river, rainbow, deer)
//   riverContents(r, row) -> Part   (pooled logs + lily pads)
//   updateBestLine(frame)           (global dashed line + 🏆 badge)
//   init(ctx3)
//
// All 2D px numbers are ported verbatim via /64 (R3D.PX). Row-local coords:
// x = worldX, y = absolute height, z = offset within the row (near edge +0.5,
// far edge -0.5). Core sets each row group's world Z = -(r + 0.5).
//
// Perf doctrine: every static geometry variant is cached in R3D.assets keyed by
// the exact inputs that shape it (checker parity, road edge flags, ripple bi%3,
// rainbow bi:bn, log width bucket, pad rotation bucket) — so steady-state row
// churn allocates almost nothing. Truly per-row geometry (hoofprints, pebble
// InstancedMesh) goes into the Part's `owned` list and is disposed with the row.
(function () {
  'use strict';

  const THREE = window.THREE, R3D = window.R3D;
  if (!THREE || !R3D || !R3D.MAT || !R3D.MAT.opaque) {
    console.error('[terrain] THREE / R3D core missing — terrain not registered');
    return;
  }

  const PX = R3D.PX;
  const PAL = R3D.PAL;
  const A = R3D.assets;
  const U = R3D.util;

  const GROUND_W = 16.4;            // slabs span x ∈ ±8.2 (contract §6.1 overhang)
  const SLAB_H = 0.22;              // grass/deer/rainbow slab thickness, top Y = 0
  const SIDE_MUL = 0.82;            // side + bottom face tint (contract §2.2)

  // ==================================================================
  // Color / tint helpers
  // ==================================================================

  // sRGB-space multiply, matching core tint()'s "×0.82 side shade" behavior.
  function shadedColor(hex, mul) {
    const c = new THREE.Color(hex);
    if (mul !== 1) { c.convertLinearToSRGB(); c.multiplyScalar(mul); c.convertSRGBToLinear(); }
    return c;
  }

  // Vertex colors: top faces (normal.y > 0.5) full color, sides + bottom ×mul.
  function tintShaded(geom, hex, mul) {
    const top = shadedColor(hex, 1), side = shadedColor(hex, mul);
    const pos = geom.getAttribute('position'), nor = geom.getAttribute('normal');
    const n = pos.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = nor.getY(i) > 0.5 ? top : side;
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geom;
  }

  // Darken already-tinted vertices below a local Y (log damp band at waterline).
  function dampenBelow(geom, yBelow, mul) {
    const pos = geom.getAttribute('position'), col = geom.getAttribute('color');
    if (!col) return geom;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < yBelow) {
        col.setXYZ(i, col.getX(i) * mul, col.getY(i) * mul, col.getZ(i) * mul);
      }
    }
    return geom;
  }

  function srgb(r, g, b) {
    return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  }

  // ==================================================================
  // Shared materials (module-level constants — created once, never disposed).
  // Doctrine: MeshBasic for flat decals (depthWrite:false, renderOrder 1);
  // the one exception is the dirt base, a Lambert so it can RECEIVE shadows
  // (contract §7.3 lists dirt among shadow receivers).
  // ==================================================================
  function decalMat(r, g, b, a) {
    return new THREE.MeshBasicMaterial({
      color: srgb(r, g, b), transparent: true, opacity: a, depthWrite: false,
    });
  }

  const MAT_DIRT     = new THREE.MeshLambertMaterial({ color: new THREE.Color(PAL.dirt), depthWrite: false });
  const MAT_RUT      = decalMat(122, 90, 48, 0.5);     // 2D rgba(122,90,48,0.5)
  const MAT_PEBBLE   = decalMat(90, 64, 32, 0.35);     // 2D rgba(90,64,32,0.35)
  const MAT_DASH     = decalMat(255, 255, 255, 0.55);  // lane dashes
  const MAT_RIPPLE   = decalMat(255, 255, 255, 0.15);  // static water ripples
  const MAT_FOAM     = decalMat(255, 255, 255, 0.6);   // bank foam pills
  const MAT_TRAIL    = decalMat(193, 154, 94, 0.5);    // trampled deer trail
  const MAT_HOOF     = decalMat(110, 80, 45, 0.4);     // hoofprints
  const MAT_BESTDASH = decalMat(255, 255, 255, 0.7);   // best-line dashes

  const _mtx = new THREE.Matrix4();                    // reusable — zero per-frame alloc

  const NOOP = function () {};
  function staticPart(group) { return { group: group, update: NOOP, dispose: NOOP }; }

  // ==================================================================
  // Shared base geometries
  // ==================================================================
  function planeXZ() {
    return A.get('terrain:planeXZ', function () {
      return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);   // faces +Y
    });
  }
  function circleXZ() {
    return A.get('terrain:circleXZ', function () {
      return new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2); // unit radius, faces +Y
    });
  }

  function roundRectShape(w, h, r) {
    const s = new THREE.Shape();
    const hw = w / 2, hh = h / 2;
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
    return s;
  }

  // Clone-scale-translate a base geometry into a merge list (build-time only).
  function put(list, base, sx, sz, x, z) {
    const g = base.clone();
    g.scale(sx, 1, sz);
    g.translate(x, 0, z);
    list.push(g);
  }

  // ==================================================================
  // GRASS (and deer-row) checker slab — cached per row parity (2 variants total).
  // 2D: '#98d96f' when (r+c) odd, '#8fd166' when even; tiles extended to ±8.2
  // with the same parity (overhang), outermost tiles clipped.
  // ==================================================================
  function grassSlabGeo(p) {
    return A.get('terrain:grass:' + p, function () {
      const parts = [];
      for (let c = -3; c <= 13; c++) {
        let x0 = c - 5.5, x1 = c - 4.5;
        if (x0 < -8.2) x0 = -8.2;
        if (x1 > 8.2) x1 = 8.2;
        if (x1 - x0 < 0.01) continue;
        const par = (((p + c) % 2) + 2) % 2;
        const g = new THREE.BoxGeometry(x1 - x0, SLAB_H, 1);
        g.translate((x0 + x1) / 2, -SLAB_H / 2, 0);
        parts.push(tintShaded(g, par ? PAL.grassA : PAL.grassB, SIDE_MUL));
      }
      return U.mergeGeoms(parts);
    });
  }

  function checkerMesh(r) {
    const p = ((r % 2) + 2) % 2;
    const m = new THREE.Mesh(grassSlabGeo(p), R3D.MAT.opaque);
    m.receiveShadow = true;
    return m;
  }

  // Two rut planes (unit width, 5 px deep) at 0.26 / 0.60 of row depth;
  // scaled in X to the live dirt span each frame.
  function rutsGeo() {
    return A.get('terrain:rutsGeo', function () {
      const parts = [], base = planeXZ();
      put(parts, base, 1, 5 * PX, 0, -0.5 + 0.26 + 2.5 * PX);
      put(parts, base, 1, 5 * PX, 0, -0.5 + 0.60 + 2.5 * PX);
      return U.mergeGeoms(parts);
    });
  }

  // ---- grass ground Part (row may be undefined -> plain checker) ----
  function grassGround(r, row) {
    const group = new THREE.Group();
    group.add(checkerMesh(r));

    const owned = [];
    let dirt = null;                 // lazily built when R3D.dirtSpan(row) != null

    function buildDirt() {
      const g = new THREE.Group();
      const base = new THREE.Mesh(planeXZ(), MAT_DIRT);
      base.position.y = 0.010;
      base.renderOrder = 1;
      base.receiveShadow = true;
      const ruts = new THREE.Mesh(rutsGeo(), MAT_RUT);
      ruts.position.y = 0.014;
      ruts.renderOrder = 1;
      // Pebbles: FIXED world grid x = 10 + i*42 px (i = 0..16), jitter
      // (r*13 + x) % 12 px — revealed in place as the span grows, never sliding.
      const peb = new THREE.InstancedMesh(circleXZ(), MAT_PEBBLE, 17);
      peb.position.set(0, 0.016, -0.5 + 0.45);       // 0.45 of row depth
      peb.renderOrder = 1;
      peb.frustumCulled = false;
      peb.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      owned.push(peb);                               // dispose() frees instance buffers
      g.add(base); g.add(ruts); g.add(peb);
      group.add(g);
      dirt = { g: g, base: base, ruts: ruts, peb: peb, s0: -1, s1: -1 };
    }

    function syncDirt(row) {
      const span = R3D.dirtSpan(row);
      if (!span) { if (dirt) dirt.g.visible = false; return; }
      if (!dirt) buildDirt();
      dirt.g.visible = true;
      const x0 = span[0] * PX - 5.5, x1 = span[1] * PX - 5.5;
      const w = Math.max(x1 - x0, 0.001), cx = (x0 + x1) / 2;
      dirt.base.scale.x = w; dirt.base.position.x = cx;
      dirt.ruts.scale.x = w; dirt.ruts.position.x = cx;
      if (span[0] !== dirt.s0 || span[1] !== dirt.s1) {
        dirt.s0 = span[0]; dirt.s1 = span[1];
        for (let i = 0; i < 17; i++) {
          const gx = 10 + i * 42;                    // 2D grid; last at 682 (< 698)
          const vis = gx >= span[0] && gx <= span[1] - 6;
          const s = vis ? 2.5 * PX : 0;              // r 2.5 px; zero-scale hidden
          _mtx.makeScale(s, 1, s);
          _mtx.setPosition((gx + (r * 13 + gx) % 12) * PX - 5.5, 0, 0);
          dirt.peb.setMatrixAt(i, _mtx);
        }
        dirt.peb.instanceMatrix.needsUpdate = true;
      }
    }

    return {
      group: group,
      update: function (row) { syncDirt(row); },
      dispose: function () { U.disposeList(owned); },
    };
  }

  // ==================================================================
  // ROAD — asphalt slab (top -0.05) with real curb bevels rising to grass
  // height; cached per (bi===0, bi===bn-1). Lane dashes at the far boundary
  // for bi > 0 (shared decal geometry — no per-row variation).
  // ==================================================================
  function roadSlabGeo(first, last) {
    return A.get('terrain:road:' + (first ? 1 : 0) + (last ? 1 : 0), function () {
      const parts = [];
      const slab = new THREE.BoxGeometry(GROUND_W, 0.17, 1);   // -0.22 .. -0.05
      slab.translate(0, -0.135, 0);
      parts.push(tintShaded(slab, PAL.asphalt, SIDE_MUL));
      const CURB_D = 3.5 * PX;                                 // 3.5 px strip
      if (first) {                                             // light strip, FAR edge
        const c = new THREE.BoxGeometry(GROUND_W, 0.05, CURB_D);
        c.translate(0, -0.025, -0.5 + CURB_D / 2);
        parts.push(tintShaded(c, PAL.curbLight, SIDE_MUL));
      }
      if (last) {                                              // dark strip, NEAR edge
        const c = new THREE.BoxGeometry(GROUND_W, 0.05, CURB_D);
        c.translate(0, -0.025, 0.5 - CURB_D / 2);
        parts.push(tintShaded(c, PAL.curbDark, SIDE_MUL));
      }
      return U.mergeGeoms(parts);
    });
  }

  function roadDashGeo() {
    return A.get('terrain:roadDashGeo', function () {
      const parts = [], base = planeXZ();
      for (let x = 8; x < 704; x += 42) {                      // 22×4 px every 42 px
        put(parts, base, 22 * PX, 4 * PX, (x + 11) * PX - 5.5, -0.5);
      }
      return U.mergeGeoms(parts);
    });
  }

  function roadGround(r, row) {
    const group = new THREE.Group();
    const slab = new THREE.Mesh(roadSlabGeo(row.bi === 0, row.bi === row.bn - 1), R3D.MAT.opaque);
    slab.receiveShadow = true;
    group.add(slab);
    if (row.bi > 0) {
      const dashes = new THREE.Mesh(roadDashGeo(), MAT_DASH);
      dashes.position.y = -0.05 + 0.014;                       // lying on the asphalt
      dashes.renderOrder = 1;
      group.add(dashes);
    }
    return staticPart(group);
  }

  // ==================================================================
  // RIVER ground — water slab (top -0.14, receives log shadows), static
  // ripple decals (jitter (x*37 + bi*19) % 3 — cached per bi%3), foam pills
  // hugging the banks (near edge when bi===0, far when bi===bn-1).
  // Water is deliberately NOT animated (2D parity): motion comes from the
  // drifting logs and bobbing pads.
  // ==================================================================
  function waterGeo() {
    return A.get('terrain:water', function () {
      const g = new THREE.BoxGeometry(GROUND_W, 0.08, 1);      // -0.22 .. -0.14
      g.translate(0, -0.18, 0);
      return tintShaded(g, PAL.water, SIDE_MUL);
    });
  }

  function rippleGeo(bi) {
    const b3 = ((bi % 3) + 3) % 3;
    return A.get('terrain:ripples:' + b3, function () {
      const parts = [], base = circleXZ();
      for (let x = 16; x < 704; x += 48) {
        const jy = (x * 37 + b3 * 19) % 3;
        put(parts, base, 15 * PX, 3 * PX, x * PX - 5.5, -0.5 + 0.32 + jy * 6 * PX);
        put(parts, base, 11 * PX, 2.4 * PX, (x + 24) * PX - 5.5, -0.5 + 0.70 + jy * 5 * PX);
      }
      return U.mergeGeoms(parts);
    });
  }

  function pillGeo() {
    return A.get('terrain:pillGeo', function () {             // 12×6 px stadium, r 3
      const g = new THREE.ShapeGeometry(roundRectShape(12 * PX, 6 * PX, 3 * PX), 5);
      g.rotateX(-Math.PI / 2);
      return g;
    });
  }

  // Far-edge foam sliver (2D parity): the 2D exit pills (rrf at y-2,
  // sprites.js riverRow) are overdrawn by the grass row painted above them,
  // leaving only their lower ~3.5 px visible (spec-terrain.md §6). The 3D bank
  // is real geometry, so bake that clip in: keep the stadium's water-side
  // portion, cut flush where the pill crosses the far bank plane (z = -0.5
  // once the pill is centered 1 px inside the row). Shape-space: full pill is
  // y ∈ [-3, +3] px around the center; keep y <= +1 px (shape +y maps to -z).
  function pillSliverGeo() {
    return A.get('terrain:pillSliverGeo', function () {
      const r = 3 * PX, cx = 3 * PX, t = 1 * PX;   // cap radius, cap centers ±cx, cut height
      const a = Math.asin(t / r), dx = Math.sqrt(r * r - t * t);
      const s = new THREE.Shape();                 // CCW, matching roundRectShape
      s.moveTo(-cx, -r);
      s.lineTo(cx, -r);                            // bottom edge (water side)
      s.absarc(cx, 0, r, -Math.PI / 2, a, false);  // right cap up to the cut
      s.lineTo(-cx - dx, t);                       // straight cut edge (bank side)
      s.absarc(-cx, 0, r, Math.PI - a, Math.PI * 1.5, false); // left cap back down
      s.closePath();
      const g = new THREE.ShapeGeometry(s, 5);
      g.rotateX(-Math.PI / 2);                     // shape +y -> world -z
      return g;
    });
  }

  // Under the committed 58° ortho camera (core §7.1) the NEAR bank's grass lip
  // (top y=0) overhangs the foam plane (y=-0.120) by 0.120/tan(58°) ≈ 4.8 px of
  // row depth — water closer than z = 0.5 - OCC to the near boundary is hidden
  // under the apparent grass edge. (The FAR bank wall is behind its foam from
  // the camera, so the exit edge needs no such compensation.)
  const OCC = 0.120 / Math.tan(58 * Math.PI / 180);  // 0.0750 = 4.8 px

  function foamGeo(near) {
    return A.get('terrain:foam:' + (near ? 'near' : 'far'), function () {
      // 2D parity (sprites.js riverRow): pill centers sit 1 px inside the
      // water's edge. Entry edge (bi===0): rrf(x+2, y+T-4) — a full pill whose
      // center is 1 px inside the VISIBLE water edge (0.5 - OCC); its far 2 px
      // tuck under the bank lip, the 3D read of the 2D straddle onto the grass,
      // leaving the 2D's exact 4 px water-side foam band hugging the bank.
      // Exit edge (bi===bn-1): rrf(x+2, y-2) — overdrawn by the grass row above
      // to a lower sliver in 2D, so the far base is the pre-clipped
      // pillSliverGeo, cut flush at the bank plane z = -0.5.
      const parts = [], base = near ? pillGeo() : pillSliverGeo();
      const z = near ? 0.5 - OCC - 1 * PX : -0.5 + 1 * PX;
      for (let x = 0; x < 704; x += 20) {
        put(parts, base, 1, 1, (x + 8) * PX - 5.5, z);
      }
      return U.mergeGeoms(parts);
    });
  }

  function riverGround(r, row) {
    const group = new THREE.Group();
    const water = new THREE.Mesh(waterGeo(), R3D.MAT.opaque);
    water.receiveShadow = true;
    group.add(water);
    const ripples = new THREE.Mesh(rippleGeo(row.bi), MAT_RIPPLE);
    ripples.position.y = -0.130;                               // committed height
    ripples.renderOrder = 1;
    group.add(ripples);
    if (row.bi === 0) {                                        // both when bn === 1
      const f = new THREE.Mesh(foamGeo(true), MAT_FOAM);
      f.position.y = -0.120; f.renderOrder = 1;
      group.add(f);
    }
    if (row.bi === row.bn - 1) {
      const f = new THREE.Mesh(foamGeo(false), MAT_FOAM);
      f.position.y = -0.120; f.renderOrder = 1;
      group.add(f);
    }
    return staticPart(group);
  }

  // ==================================================================
  // RAINBOW — 7 stripes span the WHOLE band; this row renders its clip.
  // Band-fraction math (verbatim from the 2D banding): stripe s occupies
  // row-depth [bn - bi - (s+1)*bn/7, bn - bi - s*bn/7] relative to this row's
  // near edge; clip to [0,1]. Red (s=0) is FARTHEST, violet nearest. Interior
  // row seams get a 0.01 depth bleed (same color both sides — seam-proof).
  // Cached per (bi, bn) — at most 15 variants.
  // ==================================================================
  function rainbowGeo(bi, bn) {
    return A.get('terrain:rainbow:' + bi + ':' + bn, function () {
      const parts = [];
      for (let s = 0; s < 7; s++) {
        const a0 = bn - bi - (s + 1) * bn / 7;
        const a1 = bn - bi - s * bn / 7;
        const c0 = Math.max(a0, 0), c1 = Math.min(a1, 1);
        if (c1 - c0 < 1e-6) continue;
        let z0 = 0.5 - c1, z1 = 0.5 - c0;                     // depth -> row-local z
        if (c0 <= 1e-6 && bi > 0) z1 += 0.01;                 // bleed over interior seams
        if (c1 >= 1 - 1e-6 && bi < bn - 1) z0 -= 0.01;
        const g = new THREE.BoxGeometry(GROUND_W, SLAB_H, z1 - z0);
        g.translate(0, -SLAB_H / 2, (z0 + z1) / 2);
        parts.push(tintShaded(g, PAL.RAINBOW[s], SIDE_MUL));
      }
      return U.mergeGeoms(parts);
    });
  }

  function rainbowGround(r, row) {
    const group = new THREE.Group();
    const slab = new THREE.Mesh(rainbowGeo(row.bi, row.bn), R3D.MAT.opaque);
    slab.receiveShadow = true;
    group.add(slab);
    return staticPart(group);
  }

  // ==================================================================
  // DEER row — grass checker + trampled trail + hoofprints + two signs.
  // Trail: tan 50% rounded band, full width +4 px bleed, depth 0.42 centered
  // ~0.51 (2D: from 0.3 to 0.72 of the tile). Hoofprint pairs every 52 px with
  // the (r*17+x)%14 / (r*11+x)%10 jitters (r-dependent -> per-row, owned).
  // Signs come from R3D.props.makeDeerSign() at worldX ±5.094, z -0.15.
  // ==================================================================
  function trailGeo() {
    return A.get('terrain:trailGeo', function () {
      const g = new THREE.ShapeGeometry(roundRectShape(11 + 8 * PX, 0.42, 12 * PX), 6);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0, 0.01);                                 // centered at 0.51 depth
      return g;
    });
  }

  function hoofGeo(r) {
    const parts = [], base = circleXZ();
    for (let x = 26; x < 704; x += 52) {                       // 13 pairs
      put(parts, base, 3 * PX, 2 * PX, (x + (r * 17 + x) % 14) * PX - 5.5, -0.5 + 0.44);
      put(parts, base, 3 * PX, 2 * PX, (x + 9 + (r * 11 + x) % 10) * PX - 5.5, -0.5 + 0.60);
    }
    return U.mergeGeoms(parts);
  }

  function deerGround(r, row) {
    const group = new THREE.Group();
    const owned = [];
    group.add(checkerMesh(r));

    const trail = new THREE.Mesh(trailGeo(), MAT_TRAIL);
    trail.position.y = 0.010;
    trail.renderOrder = 1;
    group.add(trail);

    const hoofG = hoofGeo(r);                                  // per-row (jitter uses r)
    owned.push(hoofG);
    const hooves = new THREE.Mesh(hoofG, MAT_HOOF);
    hooves.position.y = 0.014;
    hooves.renderOrder = 1;
    group.add(hooves);

    if (R3D.props && typeof R3D.props.makeDeerSign === 'function') {
      try {
        const s1 = R3D.props.makeDeerSign();                   // 26 px in from each edge
        s1.position.set(26 * PX - 5.5, 0, -0.15);
        const s2 = R3D.props.makeDeerSign();
        s2.position.set(5.5 - 26 * PX, 0, -0.15);
        group.add(s1); group.add(s2);
      } catch (e) { console.error('[terrain] makeDeerSign threw', e); }
    }

    return {
      group: group,
      update: NOOP,
      dispose: function () { U.disposeList(owned); },
    };
  }

  // ==================================================================
  // ground(r, row) dispatch — row may be undefined (plain grass, negative r ok)
  // ==================================================================
  function ground(r, row) {
    const t = row && row.type;
    if (t === 'road') return roadGround(r, row);
    if (t === 'river') return riverGround(r, row);
    if (t === 'rainbow') return rainbowGround(r, row);
    if (t === 'deer') return deerGround(r, row);
    return grassGround(r, row);                                // grass + undefined
  }

  // ==================================================================
  // RIVER CONTENTS — pooled logs (move + wrap via world data every frame)
  // and lily pads (bob; 40% carry a tiny white flower).
  // ==================================================================

  // Log geometry, cached per 1/16-tile length bucket. Axis along X, radius
  // 0.16, center baked at y -0.16 so the walking surface is exactly Y = 0.
  // Bark #8a5a33 with a damp band near the waterline, lighter #a97c4f top
  // lath, chamfered #c9976a end caps + growth-ring detail.
  function logGeo(wTiles) {
    const len = wTiles * 0.9;                                  // drawn = 90% of collision
    const q = Math.max(6, Math.round(len * 16));
    return A.get('terrain:log:' + q, function () {
      const L = q / 16;
      const RING = '#5a3a1e';                                  // 2D rgba(90,58,30,…)
      const parts = [];

      const body = new THREE.CylinderGeometry(0.16, 0.16, L, 12, 1);
      body.rotateZ(Math.PI / 2);                               // axis -> X
      U.tint(body, PAL.wood);
      dampenBelow(body, 0.05, 0.86);                           // damp band above waterline
      parts.push(body);

      // lighter lath along the top (open shell, slightly proud)
      const strip = new THREE.CylinderGeometry(0.168, 0.168, L * 0.94, 12, 1, true,
        Math.PI / 2 - 0.5, 1.0);                               // ends on top after rotate
      strip.rotateZ(Math.PI / 2);
      parts.push(U.tint(strip, PAL.woodLight));

      // chamfered cut ends (taper outward -> the pale cap reads from above)
      const capR = new THREE.CylinderGeometry(0.166, 0.145, 0.08, 12, 1);
      capR.rotateZ(Math.PI / 2);
      capR.translate(L / 2 - 0.04, 0, 0);
      parts.push(U.tint(capR, PAL.woodCap));
      const capL = new THREE.CylinderGeometry(0.145, 0.166, 0.08, 12, 1);
      capL.rotateZ(Math.PI / 2);
      capL.translate(-L / 2 + 0.04, 0, 0);
      parts.push(U.tint(capL, PAL.woodCap));

      // bark ring grooves just inside each cap (visible from above)
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const gr = new THREE.CylinderGeometry(0.167, 0.167, 0.016, 12, 1, true);
        gr.rotateZ(Math.PI / 2);
        gr.translate(sgn * (L / 2 - 0.12), 0, 0);
        parts.push(U.tint(gr, RING));
      }
      // growth rings on the cut faces
      const ringR = new THREE.RingGeometry(0.05, 0.068, 10);
      ringR.rotateY(Math.PI / 2);
      ringR.translate(L / 2 + 0.001, 0, 0);
      parts.push(U.tint(ringR, RING));
      const ringL = new THREE.RingGeometry(0.05, 0.068, 10);
      ringL.rotateY(-Math.PI / 2);
      ringL.translate(-L / 2 - 0.001, 0, 0);
      parts.push(U.tint(ringL, RING));

      const out = U.mergeGeoms(parts);
      out.translate(0, -0.16, 0);                              // log top exactly Y = 0
      return out;
    });
  }

  // Lily pad geometry, cached per (rotation bucket, hasFlower). Disc r 0.281,
  // thickness 0.03, top -0.01, wedge notch half-angle 0.34 rotated by the
  // per-column hash; #3d9e4f under / #4db362 top + veins; 40% carry a flower.
  function padGeo(c) {
    const h = R3D.hash(c);
    const bucket = Math.floor(h * 16) % 16;
    const flower = h < 0.4;
    return A.get('terrain:pad:' + bucket + ':' + (flower ? 1 : 0), function () {
      const rot = (bucket + 0.5) / 16 * Math.PI * 2;
      const NOTCH = 0.34;
      const parts = [];

      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.absarc(0, 0, 0.281, rot + NOTCH, rot + Math.PI * 2 - NOTCH, false);
      shape.closePath();
      const base = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false, curveSegments: 20 });
      base.rotateX(-Math.PI / 2);                              // flat; height -> +Y
      base.translate(0, -0.04, 0);                             // top -0.01, bottom -0.04
      parts.push(U.tint(base, '#3d9e4f'));

      const top = new THREE.CircleGeometry(14.5 * PX, 20, rot + NOTCH, Math.PI * 2 - 2 * NOTCH);
      top.rotateX(-Math.PI / 2);
      top.translate(0, -0.0095, 0);                            // lighter inner leaf
      parts.push(U.tint(top, '#4db362'));

      // three veins: along rot (17 px), opposite (17 px), perpendicular (14 px)
      const veins = [[rot, 17 * PX], [rot + Math.PI, 17 * PX], [rot + Math.PI / 2, 14 * PX]];
      for (let i = 0; i < veins.length; i++) {
        const v = new THREE.BoxGeometry(veins[i][1], 0.004, 0.014);
        v.translate(veins[i][1] / 2 + 0.01, 0, 0);
        v.rotateY(veins[i][0]);
        v.translate(0, -0.0075, 0);
        parts.push(U.tint(v, '#3a8b4b'));                      // vein green over leaf
      }

      if (flower) {                                            // tiny 5-petal white flower
        for (let i = 0; i < 5; i++) {
          const a = i * Math.PI * 2 / 5;
          const p = new THREE.SphereGeometry(0.030, 6, 5);
          p.scale(1, 0.55, 1);
          p.translate(Math.cos(a) * 0.053, 0.006, -Math.sin(a) * 0.053);
          parts.push(U.tint(p, '#ffffff'));
        }
        const mid = new THREE.SphereGeometry(0.024, 6, 5);
        mid.translate(0, 0.012, 0);
        parts.push(U.tint(mid, PAL.flowerCenter));
      }
      return U.mergeGeoms(parts);
    });
  }

  // ---- pools (caps from a 40-run sim of the real world.js gen over the
  // 23-row cache window: logs peaked at 27, pads at 29; + margin) ----
  const logPool = new R3D.Pool(function () {
    const m = new THREE.Mesh(logGeo(2), R3D.MAT.opaque);
    m.castShadow = true;                                       // contract §7.3 caster
    return m;
  }, 32, 'logs');

  const padPool = new R3D.Pool(function () {
    const m = new THREE.Mesh(padGeo(0), R3D.MAT.opaque);
    m.castShadow = false;
    return m;
  }, 36, 'pads');

  function riverContents(r, row) {
    const group = new THREE.Group();
    const token = {};                                          // per-Part pool ownership
    const logs = [];
    const rowLogs = row.logs || [];
    for (let i = 0; i < rowLogs.length; i++) {
      const m = logPool.acquire(token);                        // pool stamps ownership
      m.geometry = logGeo(rowLogs[i].w);
      m.position.set(R3D.LX(rowLogs[i].x), 0, 0);
      group.add(m);
      logs.push(m);
    }
    const pads = [], padCols = [];
    if (row.pads) {
      row.pads.forEach(function (c) {
        const m = padPool.acquire(token);
        m.geometry = padGeo(c);
        m.position.set(R3D.X(c + 0.5), 0, 0);
        group.add(m);
        pads.push(m); padCols.push(c);
      });
    }
    return {
      group: group,
      update: function (row, frame) {
        const rl = row.logs;
        for (let i = 0; i < logs.length; i++) {
          if (!logPool.owns(logs[i], token)) continue;         // stolen — never write
          logs[i].position.x = R3D.LX(rl[i].x);                // move + wrap (world data)
        }
        for (let i = 0; i < pads.length; i++) {                // bob ±1.5 px (flower rides)
          if (!padPool.owns(pads[i], token)) continue;
          pads[i].position.y = Math.sin(frame.t * 1.6 + padCols[i] * 2) * 1.5 * PX;
        }
      },
      dispose: function () {
        for (let i = 0; i < logs.length; i++) logPool.release(logs[i], token);
        for (let i = 0; i < pads.length; i++) padPool.release(pads[i], token);
      },
    };
  }

  // ==================================================================
  // BEST LINE — global dashed white line (dash 10 px / gap 9 px, 3 px wide,
  // 70% alpha) lying at worldZ = -(best + 3), y 0.030, plus the 🏆 badge
  // billboard at worldX -4.7, y 0.5. Hidden until best >= 3; badge texture
  // rebuilt only when best changes.
  // ==================================================================
  let bestGroup = null, bestBadge = null, badgeBest = -1;

  function bestDashGeo() {
    return A.get('terrain:bestDashGeo', function () {
      const parts = [], base = planeXZ();
      for (let x = 0; x < 704; x += 19) {                      // dash 10 / gap 9
        const w = Math.min(10, 704 - x);
        put(parts, base, w * PX, 3 * PX, (x + w / 2) * PX - 5.5, 0);
      }
      return U.mergeGeoms(parts);
    });
  }

  function updateBestLine(frame) {
    if (!bestGroup) return;
    const b = frame.best | 0;
    if (b < 3) { bestGroup.visible = false; return; }
    bestGroup.visible = true;
    bestGroup.position.z = -(b + 3);                           // far boundary of row best+2
    if (b !== badgeBest) {
      badgeBest = b;
      if (bestBadge) {
        bestGroup.remove(bestBadge);
        if (bestBadge.material.map) bestBadge.material.map.dispose();
        bestBadge.material.dispose();
      }
      bestBadge = U.textSprite('🏆 BEST ' + b, {     // 🏆 BEST n
        font: '700 14px "Arial Rounded MT Bold", system-ui, sans-serif',
        fill: PAL.bestBadgeInk,
        w: 86, h: 24,
        pill: 'rgba(255,255,255,0.88)', pillR: 9,
      });
      bestBadge.position.set(-4.7, 0.5, 0);
      bestGroup.add(bestBadge);
    }
  }

  // ==================================================================
  // init + registration
  // ==================================================================
  function init(c) {
    bestGroup = new THREE.Group();
    bestGroup.name = 'bestLine';
    const dashes = new THREE.Mesh(bestDashGeo(), MAT_BESTDASH);
    dashes.position.y = 0.030;                                 // committed height
    dashes.renderOrder = 1;
    bestGroup.add(dashes);
    bestGroup.visible = false;
    c.worldGroup.add(bestGroup);
  }

  R3D.register('terrain', {
    init: init,
    ground: ground,
    riverContents: riverContents,
    updateBestLine: updateBestLine,
  });
})();
