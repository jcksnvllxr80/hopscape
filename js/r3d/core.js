// Hopscape 3D — js/r3d/core.js — the engine core (CONTRACT.md §2, §3, §5, §7).
//
// Classic-script IIFE. Reads window.THREE (vendored r185), defines window.R3D,
// window.CFG and window.Sprites (shims) BEFORE world.js / main.js run.
//
// What lives here:
//   - R3D namespace + module registry (R3D.register / R3D.init)
//   - shared helpers: R3D.PX/COLS/X/LX/Z/hash/dirtSpan, R3D.PAL, R3D.assets,
//     R3D.util.{mergeGeoms,tint,canvasTex,blob,warnSprite,textSprite,disposeList,
//     portraitRenderer}, R3D.Pool, R3D.MAT
//   - WebGL renderer on the EXISTING #game canvas, R3D.resize(cw, ch, dpr)
//   - orthographic camera rig (58° pitch) + shake, sun/hemi/ambient, sky, fog, shadows
//   - the row cache/diff engine (syncRows) walking World.row(r) over
//     [floor(camY)-1, floor(camY)+19], building Parts via registered modules and
//     disposing stale rows (identity diff: rowRef !== row => rebuild)
//   - frame orchestration: R3D.render(frame) — fixed pass order per §3.4
//   - DOM overlays: #r3d-vignette + #r3d-danger injected into #stage (§7.5)
//
// The Part contract every row builder returns (§5.4):
//   { group: THREE.Group,        // row-LOCAL coords; core sets group.position.z = -(r+0.5)
//     update(row, frame),        // called EVERY frame while cached (also paused/over)
//     dispose() }                // release pooled objects + dispose ONLY per-row resources
//
// Defensive doctrine: a module that failed to load/register is logged ONCE and
// skipped — core never throws on a missing/broken module.
(function () {
  'use strict';

  const THREE = window.THREE;

  const R3D = {};
  window.R3D = R3D;

  // ==================================================================
  // §3.1 — shims (must exist before world.js / main.js IIFEs execute)
  // ==================================================================
  window.CFG = { TILE: 64, COLS: 11, W: 704, H: 960 };

  // §3.2 — EXACT metadata; order matters (`selected` indexes it; localStorage hs_char)
  R3D.ANIMALS = [
    { id: 'cat',   name: 'Mittens', kind: 'the cat'   },
    { id: 'dog',   name: 'Biscuit', kind: 'the pup'   },
    { id: 'bunny', name: 'Clover',  kind: 'the bunny' },
    { id: 'duck',  name: 'Puddles', kind: 'the duck'  },
  ];
  window.Sprites = { ANIMALS: R3D.ANIMALS };

  // ==================================================================
  // §2.3 — coordinate helpers (use these; never re-derive)
  // ==================================================================
  R3D.PX   = 1 / 64;                                   // px -> units
  R3D.COLS = 11;
  R3D.X    = function (colCenter) { return colCenter - 5.5; };       // grid/raw x
  R3D.LX   = function (laneX) { return laneX - 2.5 - 5.5; };         // padded traffic x
  R3D.Z    = function (rowF) { return -(rowF + 0.5); };              // fractional rows OK
  R3D.hash = function (seed) {                                       // THE sprites.js hash
    return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
  };

  // Verbatim port of sprites.js dirtSpan() MATH — returns [x0px, x1px] | null.
  // PER-FRAME PATH (§5.6 zero-alloc): the returned array is a module-level
  // scratch reused by every call — read span[0]/span[1] immediately and never
  // retain the array across another dirtSpan call or a frame boundary.
  const dirtSpanOut = [0, 0];
  R3D.dirtSpan = function (row) {
    if (!row) return null;
    if (row.dirtFull) { dirtSpanOut[0] = 0; dirtSpanOut[1] = 704; return dirtSpanOut; }
    const d = row.dirt;
    if (!d) return null;
    if (d.dir > 0) {
      const x1 = (d.edge - 0.6) * 64;
      if (x1 <= 0) return null;
      dirtSpanOut[0] = 0; dirtSpanOut[1] = Math.min(x1, 704);
      return dirtSpanOut;
    }
    const x0 = (d.edge + 0.6) * 64;
    if (x0 >= 704) return null;
    dirtSpanOut[0] = Math.max(0, x0); dirtSpanOut[1] = 704;
    return dirtSpanOut;
  };

  // ==================================================================
  // §2.4 — palette anchors (verbatim; module-private colors stay module-local)
  // ==================================================================
  R3D.PAL = {
    grassA: '#98d96f', grassB: '#8fd166',                  // checker: A when (r+c) odd, B when even
    water: '#3f8fd6', dirt: '#c09a62',
    asphalt: '#555b66', curbLight: '#9aa0ab', curbDark: '#3c414b',
    RAINBOW: ['#ff5a5f', '#ff9f43', '#ffd93d', '#6dd36d', '#4aa3ff', '#5a63d8', '#9b6ef3'], // red far -> violet near
    wood: '#8a5a33', woodLight: '#a97c4f', woodCap: '#c9976a',
    canopy: ['#3f9e50', '#47ab59', '#57bd68'],             // bottom -> top tier
    berry: '#ff6b6b', tuft: '#6cbb4f',
    petal: ['#ffffff', '#ffd1e8', '#ffe9a8'], flowerCenter: '#ffce3d',
    hole: ['#7d9a52', '#5b3d22', '#2e1d10', '#170e07'],    // rim -> pit
    coin: '#ffd23e', coinRim: '#dd9d12',
    signFace: '#ffd23e', signBorder: '#8a6508', signPost: '#7d838f', signInk: '#3a2d24',
    warnRed: '#ff5a5f',
    CAR_COLORS: ['#ff5a5f', '#4aa3ff', '#6dd36d', '#b57edc', '#ff9f43'],
    glass: '#d9f0ff', cabWindow: '#bfe6ff', tire: '#2a2d33', headlight: '#fff3ad',
    truckBox: '#e8e4da', truckStripe: '#d3cfc4',
    tractor: ['#4cae4c', '#3d9142', '#2e7d32'], hub: '#e0a616', steel: '#8a8f9c', steelDark: '#6d7280',
    rocketBody: '#f4f7fb', rocketRed: '#e63946', porthole: '#35506e', portGlass: '#9fd4ff',
    flame: ['#ff9f43', '#ffd93d'],
    cloudBody: '#5f6883', cloudShade: '#454c63',
    deerBody: '#c68e5a', deerLeg: '#9c6b3f', deerRump: '#f4ead9',
    eagle: { wing: '#6b4423', tail: '#5a381d', body: '#7c5230', head: '#f6f2ea', beak: '#f5b91a', talon: '#e8a81c' },
    sky: 0xcfe8f8,                                         // clear color AND fog color
    shadowGreen: 'rgba(25,55,25,',                         // append alpha + ')'
    shadowCool: 'rgba(20,30,50,',
    txtFill: '#ffe9a8', txtStroke: '#b57e0a', bestBadgeInk: '#c2571f',
  };

  // ==================================================================
  // §2.5 — R3D.assets: memoized shared geometry/material/texture store.
  // Entries are NEVER disposed.
  // ==================================================================
  const assetMap = new Map();
  R3D.assets = {
    get: function (key, make) {
      let v = assetMap.get(key);
      if (v === undefined) { v = make(); assetMap.set(key, v); }
      return v;
    },
    size: function () { return assetMap.size; },
  };

  // ==================================================================
  // §2.5 — R3D.MAT: THE shared vertex-colored Lambert materials.
  // opaque:        use for ALL merged/tinted opaque geometry (one shader program).
  // transparentBase: a TEMPLATE — .clone() it, never mutate it.
  // ==================================================================
  R3D.MAT = { opaque: null, transparentBase: null };
  if (THREE) {
    R3D.MAT.opaque = new THREE.MeshLambertMaterial({ vertexColors: true });
    R3D.MAT.transparentBase = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true });
  } else {
    console.error('[R3D] window.THREE is missing — load js/vendor/three.js before js/r3d/core.js');
  }

  // ==================================================================
  // §2.5 — R3D.Pool — fixed-cap object pool. acquire(owner) past cap STEALS the
  // oldest live object (never throws; caps are sized so this is an emergency
  // path — the first steal per pool is warned once). Every acquire stamps
  // `o.__r3dOwner = owner` (null when omitted), so a steal atomically transfers
  // ownership: the robbed Part's release(o, owner)/owns(o, owner) calls see the
  // mismatch and become no-ops. release() is idempotent, ignores objects the
  // caller no longer owns, and detaches the object from its parent.
  // ==================================================================
  R3D.Pool = class {
    constructor(makeFn, cap, name) {
      this._make = makeFn;
      this.cap = Math.max(1, cap | 0);
      this.name = name || 'pool';
      this._free = [];
      this._live = [];
    }
    acquire(owner) {
      let o;
      if (this._free.length > 0) o = this._free.pop();
      else if (this._live.length < this.cap) o = this._make();
      else {
        o = this._live.shift();                    // steal oldest live — never throw
        warnOnce('Pool "' + this.name + '" overflow (cap ' + this.cap +
          ') — stealing oldest live object; visuals may drop until demand falls');
        if (o && o.parent) o.parent.remove(o);
      }
      this._live.push(o);
      if (o) o.__r3dOwner = (owner === undefined) ? null : owner;
      return o;
    }
    // True while `owner` still owns o (i.e. it has not been stolen/released).
    // Update loops MUST check this before writing to a pooled object.
    owns(o, owner) {
      return !!o && o.__r3dOwner === owner;
    }
    release(o, owner) {
      if (owner !== undefined && (!o || o.__r3dOwner !== owner)) return;   // stolen — not ours
      const i = this._live.indexOf(o);
      if (i === -1) return;                        // already released — ignore
      this._live.splice(i, 1);
      if (o) {
        o.__r3dOwner = null;
        if (o.parent) o.parent.remove(o);
      }
      this._free.push(o);
    }
  };

  // ==================================================================
  // Internal small helpers
  // ==================================================================
  const warnedOnce = new Set();
  function warnOnce(key, err) {
    if (warnedOnce.has(key)) return;
    warnedOnce.add(key);
    if (err !== undefined) console.error('[R3D] ' + key, err);
    else console.warn('[R3D] ' + key);
  }

  const RGBA_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/;
  // Parses 'rgba(r,g,b,a)' / 'rgb(...)' / hex / named color -> { color (linear), alpha }.
  function parseCssColor(css) {
    const out = { color: new THREE.Color(1, 1, 1), alpha: 1 };
    const m = RGBA_RE.exec(css);
    if (m) {
      out.color.setRGB(+m[1] / 255, +m[2] / 255, +m[3] / 255, THREE.SRGBColorSpace);
      out.alpha = m[4] === undefined ? 1 : +m[4];
    } else {
      out.color.set(css);
    }
    return out;
  }

  let measureCtx = null;
  function measureText(text, font) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ==================================================================
  // §2.5 — R3D.util
  // ==================================================================

  // tint(geom, cssHex, mul) — writes a 'color' attribute = hex × (mul||1) on every
  // vertex; returns geom. `mul` multiplies in sRGB space (matches the 2D art's
  // "×0.82 side shade" intuition), then converts to the linear working space.
  function tint(geom, cssHex, mul) {
    const m = (mul == null) ? 1 : mul;
    const c = new THREE.Color(cssHex);               // sRGB hex -> linear working space
    if (m !== 1) { c.convertLinearToSRGB(); c.multiplyScalar(m); c.convertSRGBToLinear(); }
    const pos = geom.getAttribute('position');
    if (!pos) { warnOnce('util.tint: geometry has no position attribute'); return geom; }
    const n = pos.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geom;
  }

  // mergeGeoms(list) — merges BufferGeometries (position/normal/color[/index]) into
  // ONE non-indexed vertex-colored BufferGeometry. Bake transforms first with
  // geom.applyMatrix4(m); bake color with tint(). Vertices without a color
  // attribute get white. (uv is NOT merged — the shared Lambert has no maps.)
  function mergeGeoms(list) {
    const geoms = [];
    for (let i = 0; i < list.length; i++) {
      const src = list[i];
      const g = src.index ? src.toNonIndexed() : src;
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      geoms.push(g);
    }
    let total = 0;
    for (let i = 0; i < geoms.length; i++) total += geoms[i].getAttribute('position').count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    let off = 0;
    for (let gi = 0; gi < geoms.length; gi++) {
      const g = geoms[gi];
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      const c = g.getAttribute('color');
      const cnt = p.count;
      for (let i = 0; i < cnt; i++) {
        const j = (off + i) * 3;
        pos[j] = p.getX(i); pos[j + 1] = p.getY(i); pos[j + 2] = p.getZ(i);
        nor[j] = n.getX(i); nor[j + 1] = n.getY(i); nor[j + 2] = n.getZ(i);
        if (c) { col[j] = c.getX(i); col[j + 1] = c.getY(i); col[j + 2] = c.getZ(i); }
        else { col[j] = 1; col[j + 1] = 1; col[j + 2] = 1; }
      }
      off += cnt;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  }

  // canvasTex(w, h, draw) — CanvasTexture; draw(ctx2d) paints it. sRGB, mips off —
  // callers need no further configuration (NPOT-safe).
  function canvasTex(w, h, draw) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  // blob(rxU, ryU, cssRgba) — flat ground ellipse from the shared
  // CircleGeometry(0.5, 20): MeshBasic, transparent, depthWrite:false,
  // y = 0.024, renderOrder 2 (§7.4). Caller scales/moves it further (pulses etc.).
  // The MATERIAL is unique to this blob (so alpha can animate independently):
  // if the blob is per-row, push blob.material into your Part's `owned` list.
  function blob(rxU, ryU, cssRgba) {
    const geo = R3D.assets.get('core:blobGeo', function () {
      const g = new THREE.CircleGeometry(0.5, 20);
      g.rotateX(-Math.PI / 2);                       // lie flat, face +Y
      return g;
    });
    const p = parseCssColor(cssRgba);
    const mat = new THREE.MeshBasicMaterial({
      color: p.color, transparent: true, opacity: p.alpha, depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0.024;
    m.renderOrder = 2;
    m.scale.set(rxU * 2, 1, ryU * 2);                // shared disc has diameter 1
    return m;
  }

  // warnSprite() — a new THREE.Sprite sharing THE "!" texture/material
  // (red #ff5a5f disc, white 900-weight '!'), depthTest:false, renderOrder 998.
  // Caller sets scale + position + .visible. Never dispose its material.
  function warnSprite() {
    const mat = R3D.assets.get('core:warnMat', function () {
      const tex = canvasTex(128, 128, function (ctx) {
        ctx.fillStyle = R3D.PAL.warnRed;
        ctx.beginPath();
        ctx.arc(64, 64, 60, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 84px "Arial Rounded MT Bold", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', 64, 68);
      });
      return new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    });
    const s = new THREE.Sprite(mat);
    s.renderOrder = 998;
    return s;
  }

  // textSprite(text, opts) — CanvasTexture text billboard (terrain best-badge etc.;
  // fx builds its own '+1'). Texture is baked at opts.res× (default 4×) and the
  // sprite is pre-scaled so LOGICAL px map to world units via /64.
  // opts: { font, fill, stroke, strokeW, w, h (logical px; measured if absent),
  //         pad, pill (css fill -> rounded pill behind text), pillR,
  //         depthTest (default true), renderOrder, res }
  // The texture AND material are unique to the sprite: when you rebuild it,
  // dispose the old sprite.material.map and sprite.material.
  function textSprite(text, opts) {
    opts = opts || {};
    const font = opts.font || '800 20px "Arial Rounded MT Bold", system-ui, sans-serif';
    const res = opts.res || 4;
    const pad = (opts.pad != null) ? opts.pad : 6;
    const sizeM = /([\d.]+)px/.exec(font);
    const fontPx = sizeM ? parseFloat(sizeM[1]) : 20;
    const w = opts.w || Math.ceil(measureText(text, font) + pad * 2);
    const h = opts.h || Math.ceil(fontPx * 1.4 + pad);
    const tex = canvasTex(Math.ceil(w * res), Math.ceil(h * res), function (ctx) {
      ctx.scale(res, res);
      if (opts.pill) {
        roundRectPath(ctx, 0, 0, w, h, Math.min((opts.pillR != null) ? opts.pillR : 9, h / 2));
        ctx.fillStyle = opts.pill;
        ctx.fill();
      }
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      if (opts.stroke) {
        ctx.strokeStyle = opts.stroke;
        ctx.lineWidth = (opts.strokeW != null) ? opts.strokeW : 4;
        ctx.strokeText(text, w / 2, h / 2 + 1);
      }
      ctx.fillStyle = opts.fill || '#ffffff';
      ctx.fillText(text, w / 2, h / 2 + 1);
    });
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: opts.depthTest !== false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(w / 64, h / 64, 1);
    if (opts.renderOrder != null) spr.renderOrder = opts.renderOrder;
    return spr;
  }

  // disposeList(list) — calls .dispose() on every entry and empties the list.
  // Convenience for Part `owned` arrays.
  function disposeList(list) {
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o && typeof o.dispose === 'function') {
        try { o.dispose(); } catch (e) { warnOnce('disposeList: dispose threw', e); }
      }
    }
    list.length = 0;
    return list;
  }

  // portraitRenderer() — the shared offscreen card-portrait pipeline (§8),
  // lazily created on first call: 192×208 alpha WebGL renderer + lit scene +
  // hero perspective camera. animals.js adds its 4 dedicated portrait rigs to
  // .scene and blits .canvas into the card canvases. Returns
  // { canvas, renderer, scene, camera } or null if creation failed.
  let portrait = null;
  function portraitRenderer() {
    if (portrait) return portrait;
    try {
      const off = document.createElement('canvas');
      off.width = 192; off.height = 208;
      const pr = new THREE.WebGLRenderer({ canvas: off, alpha: true, antialias: true });
      pr.setPixelRatio(1);
      pr.outputColorSpace = THREE.SRGBColorSpace;
      pr.toneMapping = THREE.NoToneMapping;
      const pscene = new THREE.Scene();               // transparent bg — card CSS shows through
      pscene.add(new THREE.HemisphereLight(0xffffff, 0x9ab27e, 0.9));
      const pkey = new THREE.DirectionalLight(0xfff2d8, 1.6);
      pkey.position.set(2, 4, 3);
      pscene.add(pkey);
      const pcam = new THREE.PerspectiveCamera(28, 192 / 208, 0.1, 20);
      pcam.position.set(0, 0.95, 3.4);
      pcam.lookAt(0, 0.55, 0);                        // gentle hero view; feet at origin
      portrait = { canvas: off, renderer: pr, scene: pscene, camera: pcam };
    } catch (e) {
      warnOnce('portraitRenderer creation failed', e);
      portrait = null;
    }
    return portrait;
  }

  R3D.util = {
    mergeGeoms: mergeGeoms,
    tint: tint,
    canvasTex: canvasTex,
    blob: blob,
    warnSprite: warnSprite,
    textSprite: textSprite,
    disposeList: disposeList,
    portraitRenderer: portraitRenderer,
  };

  // ==================================================================
  // §3.3 — registration
  // ==================================================================
  const MODULE_NAMES = ['terrain', 'props', 'vehicles', 'creatures', 'animals', 'fx'];
  const RESERVED = ['PX', 'COLS', 'X', 'LX', 'Z', 'hash', 'dirtSpan', 'PAL', 'ANIMALS',
    'assets', 'util', 'Pool', 'MAT', 'register', 'init', 'resize', 'render', 'stats'];
  const moduleOrder = [];

  R3D.register = function (name, api) {
    if (RESERVED.indexOf(name) !== -1) {
      console.error('[R3D] register: "' + name + '" is a reserved core name — refused');
      return;
    }
    if (MODULE_NAMES.indexOf(name) === -1) {
      console.warn('[R3D] register: unexpected module name "' + name + '"');
    }
    if (moduleOrder.indexOf(name) === -1) moduleOrder.push(name);
    else console.warn('[R3D] register: module "' + name + '" re-registered — replaced');
    R3D[name] = api;
  };

  // ==================================================================
  // §7 — renderer / scene / camera / lights / fog / shadows / overlays
  // ==================================================================
  let renderer = null, scene = null, worldGroup = null, camera = null;
  let fpCam = null, tpCam = null, activeCamera = null;
  let sun = null, hemi = null, amb = null;
  let canvasRef = null, vignetteEl = null, dangerEl = null;
  let pendingSize = null;
  let ctx3 = null;

  // §7.1 — ORTHOGRAPHIC, pitched 58°, yaw 0 (committed; do not re-derive)
  const PITCH = 58 * Math.PI / 180;
  const SIN_P = Math.sin(PITCH);                     // 0.848048
  const COS_P = Math.cos(PITCH);                     // 0.529919
  const BOOM = 20;                                   // distance along the view ray
  const NEAR_OVERSHOOT = 0.6;                        // bottom edge cuts ground 0.6u below camY's near edge
  const CAM_HALF_H = 7.5;                            // 11 × 15 units = 704:960

  // §7.1b — FIRST-/THIRD-PERSON perspective rigs (menu-selectable via
  // frame.camMode: 'fp' | 'tp' | 'classic'). fp: eye at the character's head,
  // facing up-world (-Z), bobbing with the hop arc (frame.chr.z already carries
  // hop/teeter/eagle-carry in px); the character rig is hidden by animals.js.
  // tp: chase camera behind and above, character visible, softened bob.
  // frame.peek (-1/0/+1, Q/E held in main.js) glances the view ±45° with a
  // smooth swing out and an automatic swing back on release. Fog bands tighten
  // per mode so the edge of the cached row window can never be seen.
  const FP_EYE = 0.55;                               // eye height above ground (u)
  const FP_LOOK_AHEAD = 3.2, FP_LOOK_Y = 0.10;       // ~8° downward gaze
  const TP_HEIGHT = 2.3, TP_BACK = 3.2;              // chase boom (u)
  const TP_LOOK_AHEAD = 2.8, TP_LOOK_Y = 0.2;        // ~19° downward gaze
  const FOG_CLASSIC_NEAR = 21, FOG_CLASSIC_FAR = 34; // §7.3 committed values
  const FOG_FP_NEAR = 8, FOG_FP_FAR = 15;
  const FOG_TP_NEAR = 11, FOG_TP_FAR = 18;
  const PEEK_MAX = Math.PI / 4;                      // 45°
  let peekCur = 0;                                   // smoothed peek [-1..1]

  function rigCamera(frame) {
    const sel = (frame.mode !== 'menu' && frame.chr) ? frame.camMode : 'classic';
    const cam = sel === 'fp' ? fpCam : sel === 'tp' ? tpCam : null;
    activeCamera = cam || camera;
    scene.fog.near = cam ? (sel === 'fp' ? FOG_FP_NEAR : FOG_TP_NEAR) : FOG_CLASSIC_NEAR;
    scene.fog.far = cam ? (sel === 'fp' ? FOG_FP_FAR : FOG_TP_FAR) : FOG_CLASSIC_FAR;
    // peek eases toward the held direction and back to 0 on release (~0.2s)
    const peekTgt = cam ? (frame.peek || 0) : 0;
    peekCur += (peekTgt - peekCur) * Math.min(1, (frame.dt || 0.016) * 10);
    if (Math.abs(peekCur) < 0.001) peekCur = 0;
    if (cam) {
      const C = frame.chr;
      const x = R3D.X(C.colF + 0.5);
      const z = R3D.Z(C.rowF);
      if (sel === 'fp') {
        cam.position.set(x, FP_EYE + Math.max(-0.2, C.z * R3D.PX), z);
        cam.lookAt(x, FP_LOOK_Y, z - FP_LOOK_AHEAD);
        if (C.lean) cam.rotateZ(-C.lean * 0.08);     // subtle roll on sideways hops
      } else {
        const bob = Math.max(-0.1, C.z * R3D.PX) * 0.35;
        cam.position.set(x, TP_HEIGHT + bob, z + TP_BACK);
        cam.lookAt(x, TP_LOOK_Y, z - TP_LOOK_AHEAD);
        if (C.lean) cam.rotateZ(-C.lean * 0.04);
      }
      if (peekCur) cam.rotateY(-peekCur * PEEK_MAX); // glance left (Q) / right (E)
      if (frame.shake > 0) {
        const a = 0.140625 * (frame.shake / 0.3);
        cam.translateX((Math.random() - 0.5) * a);
        cam.translateY((Math.random() - 0.5) * a);
      }
      cam.updateMatrixWorld();
      return;
    }
    const zC = -(frame.camY - NEAR_OVERSHOOT + CAM_HALF_H / SIN_P);   // = -(camY + 8.2437)
    camera.position.set(0, BOOM * SIN_P, zC + BOOM * COS_P);          // (0, 16.9610, -camY + 2.3547)
    camera.lookAt(0, 0, zC);
    if (frame.shake > 0) {                           // 2D: ±4.5px both axes × shake/0.3
      const a = 0.140625 * (frame.shake / 0.3);      // 9/64
      camera.translateX((Math.random() - 0.5) * a);
      camera.translateY((Math.random() - 0.5) * a);
    }
    camera.updateMatrixWorld();
  }

  // §7.3 — sun follow, INTEGER-quantized so shadow texels never swim
  function rigSun(frame) {
    const az = -(Math.round(frame.camY) + 8);
    sun.target.position.set(0, 0, az);
    sun.target.updateMatrixWorld();
    sun.position.set(-4, 13, az + 6);                // upper-LEFT-behind, matches the 2D art
  }

  // §7.5 — vignette + danger glow: DOM overlays injected into #stage
  function injectOverlays() {
    const stage = document.getElementById('stage');
    if (!stage) { warnOnce('#stage not found — vignette/danger overlays skipped'); return; }
    const style = document.createElement('style');
    style.textContent =
      '#r3d-vignette { position:absolute; inset:0; pointer-events:none; z-index:2;' +
      ' background: linear-gradient(90deg, rgba(20,45,20,.18), rgba(20,45,20,0) 8.52%,' +
      ' rgba(20,45,20,0) 91.48%, rgba(20,45,20,.18)); }' +                   /* 60/704 */
      '#r3d-danger { position:absolute; left:0; right:0; bottom:0; height:15.63%;' + /* 150/960 */
      ' pointer-events:none; z-index:2; opacity:0;' +
      ' background: linear-gradient(to top, rgb(255,60,60), rgba(255,60,60,0)); }';
    document.head.appendChild(style);
    vignetteEl = document.createElement('div');
    vignetteEl.id = 'r3d-vignette';
    dangerEl = document.createElement('div');
    dangerEl.id = 'r3d-danger';
    stage.appendChild(vignetteEl);
    stage.appendChild(dangerEl);
  }

  let lastDanger = -1;                               // quantized opacity (a × 100), numeric memo
  function updateDanger(frame) {
    if (!dangerEl) return;
    let a = 0;
    if (frame.mode === 'play' && frame.chr) {
      const dz = frame.chr.rowF - frame.camY;
      if (dz < 2.2) a = Math.min(1, (2.2 - dz) / 2.2) * (0.28 + 0.12 * Math.sin(frame.t * 7));
    }
    // Quantize to 0.01 steps and memoize NUMERICALLY: the pulsing sine only
    // touches the DOM (string alloc + style recalc) when the visible opacity
    // actually changes — visually identical, ~every 3rd frame while in danger.
    const q = Math.round(a * 100);
    if (q !== lastDanger) { lastDanger = q; dangerEl.style.opacity = q === 0 ? '0' : (q / 100).toFixed(2); }
  }

  // ==================================================================
  // §5 — row lifecycle engine
  // ==================================================================
  const rowCache = new Map();                        // r -> RowView

  function addPart(view, modName, fnName, r, row) {
    const api = R3D[modName];
    const fn = api && api[fnName];
    if (typeof fn !== 'function') {
      warnOnce(modName + '.' + fnName + ' unavailable — its row content is skipped');
      return;
    }
    let part = null;
    try { part = fn.call(api, r, row); }
    catch (e) { warnOnce(modName + '.' + fnName + ' threw during build — skipped', e); return; }
    if (!part || !part.group) {
      warnOnce(modName + '.' + fnName + ' returned no Part — skipped');
      return;
    }
    view.group.add(part.group);
    view.parts.push(part);
  }

  // §5.3 — composition table
  function buildRowView(r, row) {
    const view = { rowRef: row, group: new THREE.Group(), parts: [] };
    view.group.position.z = -(r + 0.5);              // Parts are row-local; core owns row Z
    addPart(view, 'terrain', 'ground', r, row);
    const type = row && row.type;
    if (!row || type === 'grass') addPart(view, 'props', 'grassContents', r, row);
    else if (type === 'deer') addPart(view, 'creatures', 'deerLane', r, row);
    else if (type === 'road') addPart(view, 'vehicles', 'carLane', r, row);
    else if (type === 'river') addPart(view, 'terrain', 'riverContents', r, row);
    else if (type === 'rainbow') addPart(view, 'creatures', 'cloudLane', r, row);
    else warnOnce('unknown row type "' + type + '" — ground only');
    worldGroup.add(view.group);
    return view;
  }

  function updateRowView(view, row, frame) {
    const parts = view.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      try { p.update(row, frame); }
      catch (e) {
        if (!p.__r3dWarned) { p.__r3dWarned = true; console.error('[R3D] a Part.update threw (logged once)', e); }
      }
    }
  }

  function disposeRowView(view) {
    const parts = view.parts;
    for (let i = 0; i < parts.length; i++) {
      try { parts[i].dispose(); }
      catch (e) { warnOnce('a Part.dispose threw', e); }
    }
    worldGroup.remove(view.group);
  }

  // §5.2 — cache + IDENTITY diff. `World.reset()` recreates row objects, so
  // `view.rowRef !== row` rebuilds every cached row lazily next frame — that is
  // the whole reset/teleport story. Rows never change type in place.
  let sweepLo = 0, sweepHi = 0;
  function sweepRow(view, r) {                       // Map.forEach cb — no per-entry alloc
    if (r < sweepLo - 1 || r > sweepHi + 1) {
      disposeRowView(view);
      rowCache.delete(r);
    }
  }

  function syncRows(frame) {
    if (typeof World === 'undefined' || !World.row) {
      warnOnce('window.World missing — no rows to render');
      return;
    }
    const lo = Math.floor(frame.camY) - 1, hi = Math.floor(frame.camY) + 19;
    for (let r = lo; r <= hi; r++) {
      const row = World.row(r);                      // undefined for r<0 / culled -> plain grass
      let v = rowCache.get(r);
      if (v && v.rowRef !== row) { disposeRowView(v); rowCache.delete(r); v = null; }
      if (!v) { v = buildRowView(r, row); rowCache.set(r, v); }
      updateRowView(v, row, frame);
    }
    sweepLo = lo; sweepHi = hi;
    rowCache.forEach(sweepRow);
  }

  // ==================================================================
  // §3.4 — per-frame module hooks (fixed order), defensive + alloc-free
  // ==================================================================
  const HOOKS = [
    { mod: 'terrain',   fn: 'updateBestLine',  warned: false },
    { mod: 'vehicles',  fn: 'updateGlobals',   warned: false },
    { mod: 'creatures', fn: 'updateEagle',     warned: false },
    { mod: 'animals',   fn: 'updateCharacter', warned: false },
  ];

  function runHooks(frame) {
    for (let i = 0; i < HOOKS.length; i++) {
      const h = HOOKS[i];
      const api = R3D[h.mod];
      const fn = api && api[h.fn];
      if (typeof fn !== 'function') {
        if (!h.warned) { h.warned = true; console.warn('[R3D] ' + h.mod + '.' + h.fn + ' unavailable — skipped'); }
        continue;
      }
      try { fn.call(api, frame); }
      catch (e) {
        if (!h.warned) { h.warned = true; console.error('[R3D] ' + h.mod + '.' + h.fn + ' threw (logged once)', e); }
      }
    }
  }

  // ==================================================================
  // Public lifecycle: init / resize / render
  // ==================================================================

  // R3D.init(canvas) — called from main.js (replaces getContext('2d')).
  // Creates the WebGL renderer on the EXISTING #game canvas, scene, camera,
  // lights, fog, DOM overlays — then api.init(ctx3) on every registered module
  // in script-load order with ctx3 = { scene, worldGroup, camera, renderer }.
  R3D.init = function (canvas) {
    if (renderer) { console.warn('[R3D] init called twice — ignored'); return; }
    if (!THREE) { console.error('[R3D] cannot init — window.THREE missing'); return; }
    canvasRef = canvas;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });   // §7.2
    } catch (e) {
      console.error('[R3D] WebGLRenderer creation failed', e);
      renderer = null;
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;      // tone mapping would shift the palette — forbidden
    renderer.setClearColor(R3D.PAL.sky);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;   // r185: PCFSoftShadowMap is deprecated and aliases to this

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(R3D.PAL.sky, 21, 34);  // §7.3 — subtle far haze, never breathes

    worldGroup = new THREE.Group();                  // identity; absolute world coords
    worldGroup.name = 'worldGroup';
    scene.add(worldGroup);

    camera = new THREE.OrthographicCamera(-5.5, 5.5, CAM_HALF_H, -CAM_HALF_H, 0.1, 60);
    activeCamera = camera;
    fpCam = new THREE.PerspectiveCamera(78, 704 / 960, 0.05, 60);   // stage aspect is locked
    tpCam = new THREE.PerspectiveCamera(58, 704 / 960, 0.05, 60);

    hemi = new THREE.HemisphereLight(0xdfefff, 0x86b45f, 0.85);
    amb = new THREE.AmbientLight(0xffffff, 0.35);    // keeps shade candy-bright
    sun = new THREE.DirectionalLight(0xfff2d8, 1.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);              // contract max
    sun.shadow.camera.left = -8; sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 45;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    scene.add(hemi, amb, sun, sun.target);

    injectOverlays();

    if (pendingSize) R3D.resize(pendingSize.cw, pendingSize.ch, pendingSize.dpr);

    ctx3 = { scene: scene, worldGroup: worldGroup, camera: camera, renderer: renderer };
    for (let i = 0; i < MODULE_NAMES.length; i++) {
      if (!R3D[MODULE_NAMES[i]]) {
        console.warn('[R3D] module "' + MODULE_NAMES[i] + '" never registered — its content will be skipped');
      }
    }
    for (let i = 0; i < moduleOrder.length; i++) {
      const name = moduleOrder[i];
      const api = R3D[name];
      if (!api || typeof api.init !== 'function') {
        console.warn('[R3D] module "' + name + '" has no init(ctx3) — skipped');
        continue;
      }
      try { api.init(ctx3); }
      catch (e) { console.error('[R3D] ' + name + '.init(ctx3) threw — module may be broken', e); }
    }
    console.info('[R3D] core initialized — modules: ' + (moduleOrder.join(', ') || '(none)'));
  };

  // R3D.resize(cw, ch, dpr) — called from main.js resize(). The ortho frustum
  // NEVER changes (the stage aspect is locked at 704:960); only backing store +
  // CSS size follow the stage.
  R3D.resize = function (cw, ch, dpr) {
    if (!renderer) { pendingSize = { cw: cw, ch: ch, dpr: dpr }; return; }
    renderer.setPixelRatio(dpr);
    renderer.setSize(cw, ch, false);
    canvasRef.style.width = cw + 'px';
    canvasRef.style.height = ch + 'px';
  };

  // R3D.render(frame) — called from main.js drawWorld() every frame (also while
  // paused/over: anims derive from frame.t, which keeps advancing). Fixed pass
  // order per §3.4. fx has NO hook here: its sim advances only via R3D.fx.step(dt)
  // called from main.js updateParticles — that is what freezes particles on pause.
  R3D.render = function (frame) {
    if (!renderer || !frame) return;
    syncRows(frame);                                 // 1. row diff + every RowView.update
    runHooks(frame);                                 // 2-5. terrain/vehicles/creatures/animals
    rigCamera(frame);                                // 6. camera rig + shake
    rigSun(frame);                                   //    sun follow (quantized)
    updateDanger(frame);                             // 7. danger-glow DOM opacity
    renderer.render(scene, activeCamera || camera);  // 8.
  };

  // Debug helper (NOT part of the render path — allocates).
  R3D.stats = function () {
    if (!renderer) return null;
    return {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      cachedRows: rowCache.size,
      sharedAssets: assetMap.size,
    };
  };
})();
