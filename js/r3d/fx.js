// Hopscape 3D — js/r3d/fx.js — the particle / FX system (CONTRACT.md §6.6, §9).
//
// Owns: poof dust puffs (hop takeoff, bunny double-jump, dog dash dust, rocket
// arm sputter, hole death), coin sparks + the floating '+1' text, rain/splash
// drops (cloud/water/rocket deaths), and the tree-fall animation (tipping,
// fading felled tree during tractor mowing — play AND menu attract mode).
//
// All physics/alpha/size formulas are the 2D main.js:107–178 formulas verbatim
// (px ÷ 64); k = 1 - t/life; hard kill at t >= life, exactly like the 2D filter.
//
// World-unit API (camera-independent by design — the 2D menuCam footgun is
// designed out):  col = fractional column CENTER (call sites pass c + 0.5),
// row = fractional row INDEX (fx applies R3D.Z itself), h = height in units.
//   R3D.fx.poof(col, row, h, life)
//   R3D.fx.coinBurst(col, row)          // 7 sparks at h 0.3125 + '+1' at h 0.53125
//   R3D.fx.rainBurst(col, row)          // 16 drops at h 0.234375
//   R3D.fx.treefall(col, row, spin)     // spin = ±1
//   R3D.fx.txt(col, row, h, str)        // life fixed 0.8
//   R3D.fx.step(dt)  — the ONLY dt integrator in the renderer. Called solely
//                      from main.js updateParticles (play/dying/menu, NOT
//                      paused/over) — that is what freezes particles mid-air on
//                      pause while coins keep spinning (frame.t still advances).
//   R3D.fx.clear()   — deactivates every live particle (resetRun).
//
// NOTE: the storm danger glow + edge vignette are DOM overlays OWNED BY CORE
// (§7.5): core.js injects #r3d-vignette / #r3d-danger and writes the danger
// opacity every frame from the frame object. fx deliberately does NOT duplicate
// them. Likewise the rocket fly-phase smoke column is props' (§6.2); fx only
// renders the arm-phase sputter poofs via the :466 call site.
//
// Pools (pre-warmed at init, never grow, never disposed — module-level per the
// perf doctrine): 64 dot sprites (spark/drop/poof share one pool, per the
// committed "fx sprites 64" cap), 6 txt sprites, 6 treefall groups. Overflow
// steals the oldest via a round-robin cursor (FIFO) — never throws. Zero heap
// allocation in step(); spawns only write into preallocated records.
(function () {
  'use strict';
  const THREE = window.THREE, R3D = window.R3D;
  if (!THREE || !R3D) {
    console.error('[R3D:fx] window.THREE / window.R3D missing — load js/vendor/three.js and js/r3d/core.js first');
    return;
  }

  const PX = R3D.PX;

  // ---- verbatim 2D physics constants (main.js:107–139, px ÷ 64) ----
  const GRAV      = 500 * PX;   // 7.8125 u/s² — spark/drop gravity   (:129)
  const POOF_RISE = 12  * PX;   // 0.1875 u/s                          (:135)
  const TXT_RISE  = 46  * PX;   // 0.71875 u/s                         (:133)
  const SPARK_H   = 20  * PX;   // coin burst center 20 px above feet  (:374 site)
  const TXT_H     = 34  * PX;   // '+1' pops 14 px above the burst     (:117)
  const DROP_H    = 15  * PX;   // splash spawns 15 px above feet      (:122)

  // ---- verbatim 2D render sizes ----
  const SPARK_D = 6.4 * PX;     // gold dot: 2D radius 3.2 px  → r 0.05 u
  const DROP_D  = 6   * PX;     // blue dot: 2D radius 3 px    → r 0.047 u
  // poof diameter = (10 + (1-k)·18) px → 0.15625 → 0.4375 u (computed in step)

  // Presentational (contract-silent): tiny lift so a ground poof's heart sits
  // above the depth-tested ground plane instead of being half-swallowed by it.
  const POOF_LIFT = 4 * PX;

  const DOT_CAP = 64, TXT_CAP = 6, TREE_CAP = 6;      // §5.6 committed caps
  const KIND_SPARK = 0, KIND_DROP = 1, KIND_POOF = 2;

  let ready = false;
  let texGold = null, texBlue = null, texPuff = null;

  const dots  = new Array(DOT_CAP);  let dotCur  = 0;
  const txts  = new Array(TXT_CAP);  let txtCur  = 0;
  const trees = new Array(TREE_CAP); let treeCur = 0;

  // ==================================================================
  // Shared textures — 3 radial CanvasTextures (gold, blue, soft white),
  // built once at init, NEVER disposed.
  // ==================================================================

  // Chunky candy dot: solid body with a small offset highlight (sun is
  // upper-left in the art) and a short feathered rim.
  function discTex(coreCss, rgb) {
    return R3D.util.canvasTex(64, 64, function (ctx) {
      const g = ctx.createRadialGradient(27, 25, 2, 32, 32, 30);
      g.addColorStop(0, coreCss);
      g.addColorStop(0.38, 'rgb(' + rgb + ')');
      g.addColorStop(0.86, 'rgb(' + rgb + ')');
      g.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    });
  }

  // Soft white puff: a 3-lobe cartoon cloudlet (solid hearts, soft skirts) —
  // reads as toy dust instead of a flat disc; all alpha/size math stays verbatim.
  function makePuffTex() {
    return R3D.util.canvasTex(128, 128, function (ctx) {
      function lobe(x, y, r) {
        const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.92)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      lobe(64, 54, 38);       // crown
      lobe(40, 74, 27);       // left lobe
      lobe(88, 74, 27);       // right lobe
    });
  }

  // '+1' (and any future string) — baked ×4, memoized forever in R3D.assets.
  // Verbatim 2D text style (main.js:165–175): font '800 20px Arial Rounded MT
  // Bold', stroke #b57e0a width 4 under fill #ffe9a8. Canvas is 64×32 logical
  // (wider if the string needs it) so the contracted 0.9×0.45 sprite scale
  // keeps the glyph aspect true.
  function txtTex(str) {
    return R3D.assets.get('fx:txt:' + str, function () {
      const font = '800 20px "Arial Rounded MT Bold", system-ui, sans-serif';
      const mctx = document.createElement('canvas').getContext('2d');
      mctx.font = font;
      const w = Math.max(64, Math.ceil(mctx.measureText(str).width + 16));
      const h = 32, res = 4;
      return R3D.util.canvasTex(w * res, h * res, function (ctx) {
        ctx.scale(res, res);
        ctx.font = font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = R3D.PAL.txtStroke;      // '#b57e0a'
        ctx.strokeText(str, w / 2, h / 2 + 1);
        ctx.fillStyle = R3D.PAL.txtFill;          // '#ffe9a8'
        ctx.fillText(str, w / 2, h / 2 + 1);
      });
    });
  }

  // Mini felled tree (§6.6 committed): trunk box 0.125×0.25 wood + canopy
  // sphere r 0.219 '#47ab59' at h 0.406 — the 2D 8×16 px trunk + r 14 canopy
  // at y −26, verbatim ÷64. ONE shared merged geometry for all pooled trees.
  function treeGeo() {
    return R3D.assets.get('fx:treefallGeo', function () {
      const parts = [];
      const trunk = new THREE.BoxGeometry(0.125, 0.25, 0.125);
      trunk.translate(0, 0.125, 0);                       // base at y = 0 (the pivot)
      parts.push(R3D.util.tint(trunk, R3D.PAL.wood));
      const canopy = new THREE.SphereGeometry(0.219, 12, 10);
      canopy.translate(0, 0.406, 0);
      parts.push(R3D.util.tint(canopy, R3D.PAL.canopy[1])); // '#47ab59'
      return R3D.util.mergeGeoms(parts);
    });
  }

  // ==================================================================
  // init(ctx3) — build every pool up front (§5.1: fx adds directly to scene).
  // Per-sprite SpriteMaterials are created ONCE here (opacity animates per
  // particle); their .map swaps between the 3 shared textures at spawn time
  // (texture→texture swap: no shader recompile, no needsUpdate required).
  // ==================================================================
  function init(ctx3) {
    if (ready) return;
    const scene = ctx3.scene;
    texGold = discTex('#fff3b0', '255,210,62');           // spark — rgba(255,210,62)
    texBlue = discTex('#d9efff', '96,170,255');           // drop  — rgba(96,170,255)
    texPuff = makePuffTex();
    txtTex('+1');                                         // pre-bake the one string the game uses

    for (let i = 0; i < DOT_CAP; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texPuff, transparent: true, depthWrite: false, depthTest: true, opacity: 0,
      });
      const s = new THREE.Sprite(mat);
      s.renderOrder = 3;                                  // §5.6 fx sprite tier
      s.visible = false;
      scene.add(s);
      dots[i] = { sprite: s, kind: 0, x: 0, y: 0, z: 0, vx: 0, vz: 0, vyUp: 0, t: 0, life: 1, active: false };
    }

    for (let i = 0; i < TXT_CAP; i++) {
      const mat = new THREE.SpriteMaterial({
        map: txtTex('+1'), transparent: true, depthWrite: false, depthTest: false, opacity: 0,
      });
      const s = new THREE.Sprite(mat);
      s.renderOrder = 999;                                // §5.6 fx '+1' text tier
      s.visible = false;
      scene.add(s);
      txts[i] = { sprite: s, y: 0, t: 0, life: 0.8, active: false };
    }

    const geo = treeGeo();
    for (let i = 0; i < TREE_CAP; i++) {
      const mat = R3D.MAT.transparentBase.clone();        // template — clone, never mutate the base
      mat.depthWrite = false;                             // fade-friendly; avoids depth artifacts mid-tip
      mat.opacity = 0;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 3;
      const g = new THREE.Group();                        // pivot = trunk base = ground contact.
      g.add(mesh);                                        // Faces +Z; local Z-rotation = the committed
      g.visible = false;                                  // screen-plane tip-over (§6.6).
      scene.add(g);
      trees[i] = { group: g, mat: mat, spin: 1, t: 0, life: 0.7, active: false };
    }
    ready = true;
  }

  // ==================================================================
  // Spawns — write into preallocated records; round-robin FIFO steal on overflow.
  // ==================================================================
  function spawnDot(kind, x, y, z, vx, vz, vyUp, life) {
    if (!ready) return;
    const p = dots[dotCur];
    dotCur = (dotCur + 1) % DOT_CAP;
    p.kind = kind; p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vz = vz; p.vyUp = vyUp;
    p.t = 0; p.life = life; p.active = true;
    const s = p.sprite, m = s.material;
    if (kind === KIND_SPARK)      { m.map = texGold; m.opacity = 0.9; s.scale.set(SPARK_D, SPARK_D, 1); }
    else if (kind === KIND_DROP)  { m.map = texBlue; m.opacity = 0.9; s.scale.set(DROP_D, DROP_D, 1); }
    else                          { m.map = texPuff; m.opacity = 0.4; s.scale.set(10 * PX, 10 * PX, 1); }
    m.rotation = Math.random() * Math.PI * 2;             // spawn-time variety (highlight/lobes)
    s.position.set(x, y, z);
    s.visible = true;
  }

  // poof(col, row, h, life) — hop takeoff (:226/:281), bunny double-jump mid-air
  // (:330, h = z0/64), rocket arm sputter (:466), dog dash dust (:492), hole
  // death (:603). Rises 0.1875 u/s; grows 0.156 → 0.4375 u; alpha 0.4k.
  function poof(col, row, h, life) {
    spawnDot(KIND_POOF, R3D.X(col), h + POOF_LIFT, R3D.Z(row), 0, 0, 0, life);
  }

  // coinBurst(col, row) — main.js:112–118 verbatim ÷64: 7 gold sparks
  // (vx = cos(a)·90/64, vyUp = (60 + rnd·90)/64, gravity 500/64, life 0.5)
  // + one '+1' at burst height + 14 px. The 2D random angle a is projected onto
  // the ground plane: cos→X (verbatim speed), sin→Z (gives the burst real 3D
  // volume; contract silent on vz).
  function coinBurst(col, row) {
    const x = R3D.X(col), z = R3D.Z(row);
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      spawnDot(KIND_SPARK, x, SPARK_H, z,
        Math.cos(a) * 90 * PX, Math.sin(a) * 90 * PX,
        (60 + Math.random() * 90) * PX, 0.5);
    }
    txt(col, row, TXT_H, '+1');
  }

  // rainBurst(col, row) — main.js:119–124 verbatim ÷64: 16 blue drops,
  // vx = cos(a)·(60 + rnd·120)/64, vyUp = (80 + rnd·140)/64, life 0.7.
  function rainBurst(col, row) {
    const x = R3D.X(col), z = R3D.Z(row);
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 120) * PX;
      spawnDot(KIND_DROP, x, DROP_H, z,
        Math.cos(a) * sp, Math.sin(a) * sp,
        (80 + Math.random() * 140) * PX, 0.7);
    }
  }

  // txt(col, row, h, str) — floating score text, life 0.8, rises 46/64 u/s,
  // alpha min(1, 2k), depthTest false, renderOrder 999. '+1' → exactly the
  // contracted 0.9 × 0.45 sprite; longer strings widen proportionally.
  function txt(col, row, h, str) {
    if (!ready) return;
    const p = txts[txtCur];
    txtCur = (txtCur + 1) % TXT_CAP;
    const tex = txtTex(str == null ? '+1' : String(str));
    const s = p.sprite;
    s.material.map = tex;
    s.material.opacity = 1;
    s.scale.set(0.45 * (tex.image.width / tex.image.height), 0.45, 1);
    p.y = h; p.t = 0; p.life = 0.8; p.active = true;
    s.position.set(R3D.X(col), h, R3D.Z(row));
    s.visible = true;
  }

  // treefall(col, row, spin) — main.js:153–164 verbatim: tips (1-k)·1.5·spin
  // about the trunk base, alpha min(1, k·1.6), life 0.7, no motion.
  function treefall(col, row, spin) {
    if (!ready) return;
    const p = trees[treeCur];
    treeCur = (treeCur + 1) % TREE_CAP;
    p.spin = spin < 0 ? -1 : 1;
    p.t = 0; p.life = 0.7; p.active = true;
    p.group.position.set(R3D.X(col), 0, R3D.Z(row));
    p.group.rotation.z = 0;
    p.mat.opacity = 1;
    p.group.visible = true;
  }

  // ==================================================================
  // step(dt) — verbatim 2D integration (main.js:125–139) + render-state writes.
  // Zero heap allocation; hard kill at t >= life (the 2D filter semantics).
  // ==================================================================
  function step(dt) {
    if (!ready) return;

    for (let i = 0; i < DOT_CAP; i++) {
      const p = dots[i];
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) { p.active = false; p.sprite.visible = false; continue; }
      const k = 1 - p.t / p.life;
      const s = p.sprite;
      if (p.kind === KIND_POOF) {
        p.y += POOF_RISE * dt;                            // drifts up 12/64 u/s
        s.position.y = p.y;
        const d = (10 + (1 - k) * 18) * PX;               // 2D radius 5 + (1-k)·9 px
        s.scale.set(d, d, 1);
        s.material.opacity = 0.4 * k;
      } else {                                            // spark / drop: ballistic
        p.vyUp -= GRAV * dt;                              // 2D: p.vy += 500·dt (vy down)
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.y += p.vyUp * dt;                               // 2D: p.wy -= p.vy·dt
        s.position.set(p.x, p.y, p.z);
        s.material.opacity = 0.9 * k;
      }
    }

    for (let i = 0; i < TXT_CAP; i++) {
      const p = txts[i];
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) { p.active = false; p.sprite.visible = false; continue; }
      const k = 1 - p.t / p.life;
      p.y += TXT_RISE * dt;                               // floats up 46/64 u/s
      p.sprite.position.y = p.y;
      p.sprite.material.opacity = Math.min(1, k * 2);     // fades over the last half of life
    }

    for (let i = 0; i < TREE_CAP; i++) {
      const p = trees[i];
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) { p.active = false; p.group.visible = false; continue; }
      const k = 1 - p.t / p.life;
      p.group.rotation.z = (1 - k) * 1.5 * p.spin;        // up to 1.5 rad tip-over
      p.mat.opacity = Math.min(1, k * 1.6);
    }
  }

  // clear() — resetRun (§10 edit 5): every live particle vanishes instantly.
  function clear() {
    for (let i = 0; i < DOT_CAP; i++)  { const p = dots[i];  if (p) { p.active = false; p.sprite.visible = false; } }
    for (let i = 0; i < TXT_CAP; i++)  { const p = txts[i];  if (p) { p.active = false; p.sprite.visible = false; } }
    for (let i = 0; i < TREE_CAP; i++) { const p = trees[i]; if (p) { p.active = false; p.group.visible = false; } }
  }

  R3D.register('fx', {
    init: init,
    step: step,
    clear: clear,
    poof: poof,
    coinBurst: coinBurst,
    rainBurst: rainBurst,
    treefall: treefall,
    txt: txt,
  });
})();
