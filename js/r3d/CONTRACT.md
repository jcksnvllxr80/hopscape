# HOPSCAPE 3D — AUTHORITATIVE BUILD CONTRACT (v1, final)

This document is the single source of truth for the 3D port. Six module authors (terrain,
props, vehicles, creatures, animals, fx) each see ONLY: this contract, their own
`spec-<module>.md`, and `js/r3d/core.js`. Where this contract and a spec's "hints" section
disagree, THIS CONTRACT WINS. Where a spec quotes verbatim 2D formulas/colors, those are law.

Global invariants (repeat of the project constraints — violations are build failures):
- Classic scripts only. Every file is an IIFE reading `window.THREE` / `window.R3D`.
  No import/export, no build step, must work from `file://`.
- world.js is READ-ONLY. main.js logic is byte-identical except the edits in §10.
- 1 tile = 1 world unit = 64 px. Convert every 2D px number via `/64` (`R3D.PX`).
- Shared geometries/materials = module-level constants, created once, NEVER disposed.
- Per-row resources are disposed when their row leaves the window (§5).
- Shadow map ≤ 2048. Steady 60 fps. Zero per-frame heap allocation in the render path.
- No external assets. Small procedural `THREE.CanvasTexture` is allowed.

---

## 1. File manifest and load order

New directory `js/r3d/`. Final `index.html` script block (replaces the current one;
`js/sprites.js` is REMOVED from the HTML — the file stays on disk untouched):

```html
<script src="js/vendor/three.js?v=13"></script>
<script src="js/sfx.js?v=13"></script>
<script src="js/r3d/core.js?v=13"></script>
<script src="js/r3d/terrain.js?v=13"></script>
<script src="js/r3d/props.js?v=13"></script>
<script src="js/r3d/vehicles.js?v=13"></script>
<script src="js/r3d/creatures.js?v=13"></script>
<script src="js/r3d/animals.js?v=13"></script>
<script src="js/r3d/fx.js?v=13"></script>
<script src="js/world.js?v=13"></script>
<script src="js/main.js?v=13"></script>
```

Also bump the stylesheet to `css/style.css?v=13`. No other index.html changes: the existing
`<canvas id="game" width="704" height="960">`, `#stage`, HUD and overlay DOM all stay.
core.js injects two overlay divs into `#stage` at init (§7.5) — no HTML edit needed.

Why this order: core.js defines `window.R3D`, `window.CFG` and `window.Sprites`
(shims, §3.1) which world.js and main.js read at IIFE time. Module files self-register
into R3D at IIFE time; script order alone guarantees availability. `R3D.init(canvas)`
(called from main.js line 20's replacement) then initializes every registered module in
load order.

File ownership:

| File | Author | Contents |
|---|---|---|
| `js/r3d/core.js` | core (already written; its public surface is §3) | R3D namespace, shims, helpers, palette, renderer/scene/camera/lights/fog/shadows, row-lifecycle engine, DOM vignette+danger, `render(frame)` |
| `js/r3d/terrain.js` | terrain | ground surfaces for all 5 row types + undefined rows, dirt carving, river logs + lily pads, best-line marker |
| `js/r3d/props.js` | props | trees, holes, flowers, coins, rocket (all phases), scorch, deer-sign builder |
| `js/r3d/vehicles.js` | vehicles | cars, trucks, tractor, planes, contrails, lingering trails, plane ground shadow, plane edge warnings |
| `js/r3d/creatures.js` | creatures | storm clouds (+rain, +shadow), deer animals, eagle (circle / flee / death grab / menace shadow) |
| `js/r3d/animals.js` | animals | 4 playable rigs + `pose()`, in-game character (all death choreography except the grab-eagle itself), character blob shadow, card portrait pipeline |
| `js/r3d/fx.js` | fx | particle system: spark, drop, poof, txt, treefall |
| `js/main.js` | integrator | edits in §10 only |

---

## 2. Coordinate system, helpers, palette

### 2.1 Axes and units

- +X = columns increasing rightward. Grid column `c`'s CENTER: `worldX = (c + 0.5) - 5.5`.
- +Y = up. Ground surface (grass top) at Y = 0.
- Rows extend away from the camera: row `r`'s center is `worldZ = -(r + 0.5)`; the boundary
  between rows r and r+1 is `worldZ = -(r + 1)`. Camera looks toward -Z.
- Moving-hazard x conventions (get these right — 3 different ones!):
  - `row.clouds / row.cars / row.deer / row.logs`: PADDED lane coords, `worldX = (obj.x - World.PAD) - 5.5` (`World.PAD = 2.5`).
  - `World.tractors()[i].x` and `planes[i].x`: RAW column units, `worldX = x - 5.5`. NO PAD, NO +0.5.
- The 2D per-object tile-depth anchors (0.42/0.52/0.62/0.66/0.72/0.74/0.78/0.82) were
  fake-perspective. In 3D every object sits at its row's Z center (row-local z = 0),
  with these committed exceptions: deer signs at row-local z = -0.15; everything else 0.

### 2.2 Committed Y heights (do not improvise — modules must inter-fit)

| Surface / object | Y |
|---|---|
| grass / deer-row slab top | 0.00 (box thickness 0.22, side+bottom faces tinted ×0.82) |
| road slab top | -0.05 |
| rainbow slab top | 0.00 |
| water plane | -0.14 |
| log (cylinder r 0.16, axis along X) | center -0.16 → top exactly 0.00 |
| lily pad top | -0.01 (disc thickness 0.03) |
| flat ground decals: dirt strip, trampled trail | +0.010 |
| ruts, hoofprints, lane dashes, ripples (ripples on water: -0.130) | +0.014 |
| hole decal, scorch decal | +0.018 |
| foam pills (on water) | -0.120 |
| blob shadows (all, §7.4) | +0.024 |
| best-line dashes | +0.030 |
| coin center (hover) | 0.35 + bob |
| cloud body center | 0.36 + bob |
| plane / contrails / trails / plane edge-warning | 1.50 (+ plane bob) |
| rocket "!" warning | 1.03 (66/64) above pad |

Flat decals: `depthWrite: false`, renderOrder per §5.6. Character/creature ground contact
is always Y = 0 (no special log/pad lift — log tops and pad tops are tuned to make this look right).

### 2.3 Core helper surface (defined in core.js — use these, do not re-derive)

```js
R3D.PX   = 1 / 64;              // px → units
R3D.COLS = 11;
R3D.X    = colCenter => colCenter - 5.5;          // e.g. R3D.X(c + 0.5), R3D.X(tt.x), R3D.X(p.x)
R3D.LX   = laneX => laneX - 2.5 - 5.5;            // padded traffic x (clouds/cars/deer/logs)
R3D.Z    = rowF => -(rowF + 0.5);                 // fractional rows OK (chr.rowF)
R3D.hash = seed => Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;  // THE sprites.js hash
R3D.dirtSpan = row => [x0px, x1px] | null;        // verbatim port of sprites.js dirtSpan():
     // dirtFull → [0, 704]; dir>0 → [0, min((edge-0.6)*64, 704)] if >0 else null;
     // dir<0 → [max(0,(edge+0.6)*64), 704] if <704 else null.  Used by terrain AND props.
```

### 2.4 Palette anchors (`R3D.PAL`) — the shared hexes, verbatim from the specs

core.js exposes `R3D.PAL` with exactly these keys. Modules use `R3D.PAL.*` for any color
listed here; module-private colors (character fur etc.) stay module-local per their spec.

```js
R3D.PAL = {
  grassA:'#98d96f', grassB:'#8fd166',                    // checker: A when (r+c) odd, B when even
  water:'#3f8fd6', dirt:'#c09a62',
  asphalt:'#555b66', curbLight:'#9aa0ab', curbDark:'#3c414b',
  RAINBOW:['#ff5a5f','#ff9f43','#ffd93d','#6dd36d','#4aa3ff','#5a63d8','#9b6ef3'], // red far → violet near
  wood:'#8a5a33', woodLight:'#a97c4f', woodCap:'#c9976a',
  canopy:['#3f9e50','#47ab59','#57bd68'],                // bottom → top tier
  berry:'#ff6b6b', tuft:'#6cbb4f',
  petal:['#ffffff','#ffd1e8','#ffe9a8'], flowerCenter:'#ffce3d',
  hole:['#7d9a52','#5b3d22','#2e1d10','#170e07'],        // rim → pit
  coin:'#ffd23e', coinRim:'#dd9d12',
  signFace:'#ffd23e', signBorder:'#8a6508', signPost:'#7d838f', signInk:'#3a2d24',
  warnRed:'#ff5a5f',
  CAR_COLORS:['#ff5a5f','#4aa3ff','#6dd36d','#b57edc','#ff9f43'],
  glass:'#d9f0ff', cabWindow:'#bfe6ff', tire:'#2a2d33', headlight:'#fff3ad',
  truckBox:'#e8e4da', truckStripe:'#d3cfc4',
  tractor:['#4cae4c','#3d9142','#2e7d32'], hub:'#e0a616', steel:'#8a8f9c', steelDark:'#6d7280',
  rocketBody:'#f4f7fb', rocketRed:'#e63946', porthole:'#35506e', portGlass:'#9fd4ff',
  flame:['#ff9f43','#ffd93d'],
  cloudBody:'#5f6883', cloudShade:'#454c63',
  deerBody:'#c68e5a', deerLeg:'#9c6b3f', deerRump:'#f4ead9',
  eagle:{wing:'#6b4423', tail:'#5a381d', body:'#7c5230', head:'#f6f2ea', beak:'#f5b91a', talon:'#e8a81c'},
  sky:0xcfe8f8,                                          // clear color AND fog color
  shadowGreen:'rgba(25,55,25,',                          // append alpha + ')'
  shadowCool:'rgba(20,30,50,',
  txtFill:'#ffe9a8', txtStroke:'#b57e0a', bestBadgeInk:'#c2571f',
};
```

### 2.5 Shared utilities (core.js)

```js
R3D.assets.get(key, make)         // memoized Map<string, geometry|material|texture>. NEVER disposed.
R3D.util.mergeGeoms(list)         // merges BufferGeometries (position/normal/color[/index]) into one.
                                  // Bake transforms first with geom.applyMatrix4(m); bake color with tint().
R3D.util.tint(geom, cssHex, mul)  // writes a 'color' attribute = hex × (mul||1) on every vertex; returns geom.
R3D.util.canvasTex(w, h, draw)    // creates a CanvasTexture; draw(ctx2d) paints it; sRGB, no mips config needed.
R3D.util.blob(rxU, ryU, cssRgba)  // flat ellipse Mesh from shared CircleGeometry(0.5, 20), MeshBasic
                                  // transparent, depthWrite:false, y = 0.024, renderOrder 2. Caller scales/moves.
R3D.util.warnSprite()             // new THREE.Sprite sharing the "!" texture (red #ff5a5f disc, white 900-weight '!'),
                                  // depthTest:false, renderOrder 998. Caller sets scale + position + .visible.
R3D.util.textSprite(text, opts)   // CanvasTexture text sprite (used by terrain best-badge; fx builds its own '+1').
R3D.Pool                          // class { constructor(makeFn, cap), acquire()→obj, release(obj) }.
                                  // acquire past cap steals the oldest live object (never throws).
R3D.MAT.opaque                    // THE shared MeshLambertMaterial({ vertexColors: true }) — use for all merged/tinted opaque geometry
R3D.MAT.transparentBase           // MeshLambertMaterial({ vertexColors:true, transparent:true }) template
```

Material doctrine: `MeshLambertMaterial` for everything lit; `MeshBasicMaterial` /
`SpriteMaterial` only for decals, blobs, halos, warnings, fx, text. NO Standard/Physical
materials, NO tone mapping (§7.2). Vertex-color + one shared Lambert = one shader program.

---

## 3. `window.R3D` public surface and registration

### 3.1 Shims (in core.js, BEFORE world.js/main.js run)

```js
window.CFG = { TILE: 64, COLS: 11, W: 704, H: 960 };     // was sprites.js:3; main.js:4 + world.js:5 read it
window.Sprites = { ANIMALS: R3D.ANIMALS };               // main.js reads Sprites.ANIMALS in 10 places
```

### 3.2 R3D.ANIMALS — EXACT metadata (order matters; `selected` indexes it; persisted in localStorage `hs_char`)

```js
R3D.ANIMALS = [
  { id: 'cat',   name: 'Mittens', kind: 'the cat'   },
  { id: 'dog',   name: 'Biscuit', kind: 'the pup'   },
  { id: 'bunny', name: 'Clover',  kind: 'the bunny' },
  { id: 'duck',  name: 'Puddles', kind: 'the duck'  },
];
```

### 3.3 Registration mechanism

Each module file ends with exactly one call:

```js
R3D.register('terrain', api);   // name ∈ 'terrain'|'props'|'vehicles'|'creatures'|'animals'|'fx'
```

`R3D.register(name, api)` sets `R3D[name] = api` and appends to an ordered list.
`R3D.init(canvas)` (called from main.js) creates the WebGLRenderer on the EXISTING canvas,
scene, camera, lights, fog, DOM overlays — then calls `api.init(ctx3)` on every registered
module in registration (= script load) order, with:

```js
ctx3 = { scene, worldGroup, camera, renderer };   // worldGroup: identity Group holding all rows + world objects
```

Modules add global (non-row) objects to `worldGroup` (or `scene` for fx) during `init`.
Modules may build shared geometries/materials at IIFE time or in `init` — either way as
module-level constants, exactly once.

### 3.4 Full symbol table — who defines, who calls

| Symbol | Defined by | Called by |
|---|---|---|
| `R3D.init(canvas)` | core | main.js (§10 edit 2) |
| `R3D.resize(cw, ch, dpr)` | core | main.js resize() (§10 edit 3) |
| `R3D.render(frame)` | core | main.js drawWorld() body (§10 edit 10) |
| `R3D.register(name, api)` | core | every module file, once, at IIFE end |
| `R3D.PX/COLS/X/LX/Z/hash/dirtSpan/PAL/ANIMALS/assets/util/Pool/MAT` | core | all modules |
| `R3D.terrain.init(ctx3)` | terrain | core (from R3D.init) |
| `R3D.terrain.ground(r, row) → Part` | terrain | core row engine (§5) |
| `R3D.terrain.riverContents(r, row) → Part` | terrain | core row engine |
| `R3D.terrain.updateBestLine(frame)` | terrain | core, every frame |
| `R3D.props.init(ctx3)` | props | core |
| `R3D.props.grassContents(r, row) → Part` | props | core row engine |
| `R3D.props.makeDeerSign() → THREE.Group` | props | terrain (deer-row ground builder) |
| `R3D.vehicles.init(ctx3)` | vehicles | core |
| `R3D.vehicles.carLane(r, row) → Part` | vehicles | core row engine |
| `R3D.vehicles.updateGlobals(frame)` | vehicles | core, every frame (tractor, planes, contrails, trails, warnings) |
| `R3D.creatures.init(ctx3)` | creatures | core |
| `R3D.creatures.cloudLane(r, row) → Part` | creatures | core row engine |
| `R3D.creatures.deerLane(r, row) → Part` | creatures | core row engine |
| `R3D.creatures.updateEagle(frame)` | creatures | core, every frame (circle/flee/menace shadow AND death grab) |
| `R3D.animals.init(ctx3)` | animals | core |
| `R3D.animals.buildRig(id) → Rig` | animals | animals itself (gameplay + portraits) |
| `R3D.animals.updateCharacter(frame)` | animals | core, every frame |
| `R3D.animals.drawCards(cardCanvases, tGlobal, selected)` | animals | main.js drawCards() body (§10 edit 12) |
| `R3D.fx.init(ctx3)` | fx | core |
| `R3D.fx.step(dt)` | fx | main.js updateParticles() body ONLY (§10 edit 6) |
| `R3D.fx.clear()` | fx | main.js resetRun() (§10 edit 5) |
| `R3D.fx.poof/coinBurst/rainBurst/treefall/txt` | fx | main.js rewritten spawn sites (§9) |

`R3D.render(frame)` internal pass order (core, fixed):
1. `syncRows(frame)` (§5) then `view.update(frame)` for every cached row
2. `R3D.terrain.updateBestLine(frame)`
3. `R3D.vehicles.updateGlobals(frame)`
4. `R3D.creatures.updateEagle(frame)`
5. `R3D.animals.updateCharacter(frame)`
6. camera rig + shake (§7.1), sun follow (§7.3)
7. danger-glow DOM opacity write (§7.5)
8. `renderer.render(scene, camera)`

fx has NO core hook: its sim advances only via `R3D.fx.step(dt)` called from main.js's
`updateParticles(dt)` call sites (play/dying/menu, NOT paused/over) — this is what makes
particles freeze while paused and keep running in menu, byte-identical to 2D.

---

## 4. The frame object — `R3D.render(frame)` schema

main.js keeps `function drawWorld(camY)` (same name, same single call site at :1055). Its
body becomes frame assembly + one `R3D.render(FRAME)` call. ONE module-level object,
mutated every frame — zero allocation. The character's pose values are COMPUTED IN MAIN.JS
with the verbatim drawChar formulas (they move from the deleted drawChar into the frame
assembly), so the renderer receives finished pose numbers.

```js
// main.js — module level, in the rendering section:
const FRAME = { chr: {}, eagle: {} };

// The complete schema. "←" = which main.js variable feeds it.
FRAME = {
  mode: 'menu',      // string  ← state (:58). 'menu'|'play'|'dying'|'over'.
                     //   menu: character hidden, cards drawn. play: eagle+danger active.
  paused: false,     // bool    ← paused (:59). Renderer ignores it (renders every frame; overlay is DOM).
  dt: 0,             // number  ← dt in frame() (:1043; 0 when document.hidden). INFORMATIONAL ONLY:
                     //   no renderer animation may integrate frame.dt — everything is a pure
                     //   function of frame.t / world state. (fx integrates dt, but only via
                     //   R3D.fx.step called from main.js — never from render.)
  t: 0,              // number  ← tGlobal (:60), seconds, advances while paused. Every idle-anim phase.
  camY: 0,           // number  ← the drawWorld(camY) argument = state==='menu' ? menuCam : cam (:1055).
  shake: 0,          // number  ← shake (:74), 0..0.35 s remaining. Camera jitter amplitude (§7.1).
  best: 0,           // int     ← best (:62). Best-line at worldZ = -(best + 3), shown when best >= 3.
  score: 0,          // int     ← score (:73). Not drawn (HUD is DOM); carried for completeness.
  selected: 0,       // int 0..3 ← selected (:61). Which rig is live.
  graceT: 0,         // number  ← graceT (:73). Not drawn; parity/debug.
  planes: planes,    // array   ← planes (:67), LIVE ref assigned every frame.
                     //   [{ row, dir:±1, x (RAW cols, no PAD), speed }]
  trails: trails,    // array   ← trails (:67), LIVE ref assigned every frame. [{ row, age }], TRAIL_LIFE = 8 (:66).
  eagle: {           // (sub-object, mutated in place)
    state: 'none',   // ← eagleState (:70): 'none'|'active'|'flee'
    t: 0,            // ← eagleT (:70), seconds in state
    fleeDir: 1,      // ← eagleFleeDir (:70), ±1
  },
  chr: {             // (sub-object, mutated in place — finished POSE, not raw chr)
    id: 'cat',       // ← Sprites.ANIMALS[selected].id
    colF: 5,         // ← chr.colF (interpolated render column)
    rowF: 2,         // ← chr.rowF (interpolated render row)
    z: 0,            // PX. ← computed verbatim (drawChar :884–886, :892):
                     //   k = min(chr.hopT, 1);
                     //   z = chr.hopping ? chr.z0*(1-k) + sin(π·k)*chr.hopH : 0;
                     //   if (chr.teeter != null && !chr.hopping) z = -6;
                     //   if (chr.dead && deathCause === 'eagle') z += max(0, dieT - 0.4) * 300;
    squash: 1,       // ← computed verbatim (:887–889): hopping → 1.06;
                     //   else squashT < 0.1 → 1 - 0.2·sin(π·squashT/0.1); else 1.
    shrink: 1,       // ← computed verbatim (:890–891): dead && (hole|water) → max(0, 1 - dieT*1.5); else 1.
    flip: false,     // ← chr.flip (sticky facing-left)
    lean: 0,         // ← chr.hopping ? chr.lean * 0.6 : 0   (final value; renderer applies rotation lean*0.1)
    air: false,      // ← chr.air && chr.hopping (duck spread-wings flag)
    dead: false,     // ← chr.dead && ['cloud','plane','car','deer','tractor'].includes(deathCause)
                     //   (the PANCAKE flag; eagle/rocket/swept/hole/water keep the normal pose)
    teeter: null,    // ← chr.teeter (null | seconds remaining). z already includes the -6 sink.
    bump: null,      // ← chr.bump (LIVE ref: { dr, dc, t } | null). Renderer computes the nudge:
                     //   kb = sin(π·bump.t/0.13) * 7 px; x += dc·kb/64; worldZ -= dr·kb/64.
    deathCause: '',  // ← chr.dead ? deathCause : ''  ('cloud','swept','hole','water','plane',
                     //   'eagle','rocket','car','deer','tractor')
    dieT: 0,         // ← dieT (:74), seconds since death. Drives shrink already; creatures uses it
                     //   for the eagle dive/carry; fx does not need it.
  },
};
```

The renderer additionally reads world data directly each frame via `World.row(r)` and
`World.tractors()` — sanctioned read-only access; the frame does NOT copy rows.

---

## 5. Row lifecycle engine (core.js — normative for all Part authors)

### 5.1 Scene graph

```
scene
├─ sun (DirectionalLight + target), hemi, ambient
├─ worldGroup                       // identity; absolute world coords
│   ├─ RowView.group  (one per cached row; group.position.z = -(r + 0.5), set by CORE)
│   ├─ bestLine       (terrain global)
│   ├─ tractor pool   (vehicles global)
│   ├─ planes/trails/warnings pools (vehicles global)
│   ├─ eagle group + menace blob    (creatures global)
│   └─ character rig + blob shadow  (animals global)
└─ fx pools (fx adds directly to scene)
```

The CAMERA moves; rows are built at absolute Z once and never re-positioned.

### 5.2 The cache + identity diff

```js
const rowCache = new Map();          // r → RowView
function syncRows(frame) {
  const lo = Math.floor(frame.camY) - 1, hi = Math.floor(frame.camY) + 19;
  for (let r = lo; r <= hi; r++) {
    const row = World.row(r);        // undefined for r < 0 or culled rows → plain grass
    let v = rowCache.get(r);
    if (v && v.rowRef !== row) { v.dispose(); rowCache.delete(r); v = null; }   // identity check!
    if (!v) { v = buildRowView(r, row); rowCache.set(r, v); }
    v.update(frame);
  }
  for (const [r, v] of rowCache)
    if (r < lo - 1 || r > hi + 1) { v.dispose(); rowCache.delete(r); }
}
```

The `rowRef !== row` IDENTITY check is the whole reset/teleport story: `World.reset()`
(startGame / toMenu) recreates row objects, so every cached row rebuilds lazily next frame
— zero integration hooks. Rows never change type in place. Window [camY-1, camY+19] covers
the 17.7 visible rows (§7.1) plus margin; world generates to camY+20 and culls below cam-3,
so `World.row` is always fresh inside the window. Steady-state cost: ~1 build + 1 dispose
per second (camera ≤ 0.95 rows/s).

### 5.3 Composition table (hardcoded in core's `buildRowView`)

```js
type 'grass' or row === undefined :  [ terrain.ground(r,row), props.grassContents(r,row) ]
type 'deer'                       :  [ terrain.ground(r,row), creatures.deerLane(r,row) ]
type 'road'                       :  [ terrain.ground(r,row), vehicles.carLane(r,row) ]
type 'river'                      :  [ terrain.ground(r,row), terrain.riverContents(r,row) ]
type 'rainbow'                    :  [ terrain.ground(r,row), creatures.cloudLane(r,row) ]
```

Core creates the row Group, sets `group.position.z = -(r + 0.5)`, adds every Part's group
to it, and adds it to worldGroup. (Deer rows carry empty trees/holes/coins/flowers Sets and
never gain content — no props Part needed.)

### 5.4 The Part contract (EVERY builder returns exactly this)

```js
{
  group: THREE.Group,      // children in ROW-LOCAL coords: x = worldX (R3D.X / R3D.LX),
                           //   y = absolute height, z = offset within the row (usually 0, |z| ≤ 0.5)
  update(row, frame),      // called EVERY frame while cached (also while paused/over — anims
                           //   continue because they derive from frame.t). row is World.row(r),
                           //   re-fetched by core each frame (may be the same object).
  dispose(),               // MUST: release Pool objects, dispose ONLY resources this Part
                           //   uniquely created (push them into an internal `owned` array at
                           //   build time), and assume core removes group from the scene.
}
```

Disposal rules (zero-leak contract):
1. Shared assets (module constants, `R3D.assets`) are NEVER disposed.
2. A Part may create per-row geometry/texture ONLY by tracking it in its `owned` list;
   `dispose()` iterates `owned` calling `.dispose()`. Nothing else calls `.dispose()`.
3. Pools never shrink; capacities bound total GPU memory.
4. Acceptance test: `renderer.info.memory.geometries` is FLAT over a 5-minute menu-attract
   soak (world scrolls forever). If it grows, the module leaks.

### 5.5 Dynamic sync inside `update(row, frame)` — dirty signals vs per-frame writes

Per-frame writes, no diffing (pure functions of row data + frame.t): traffic positions
(`c.x`), car/plane bob, coin spin/bob, lily-pad bob, cloud bob + rain streaks + pupils,
deer gallop, rocket shake/lift/flame/smoke, dirt strip scale (cheap).

Rare mutations — detect by cheap comparisons and rebuild only the affected piece:

| Signal | Reaction (owner) |
|---|---|
| `row.trees.size` shrank | rebuild the merged static mesh minus that tree (props). fx independently shows the falling tree via the rewritten `treefall` call site. |
| `row.holes.size` shrank | remove that hole decal (props) — tractor paved it |
| `row.coins.size` shrank | hide that coin mesh (props) — picked up |
| `row.deer.length` changed | acquire/release deer meshes from pool (creatures) |
| `row.rocket.phase` changed | swap rocket ↔ scorch visibility, reset phase anims (props) |
| `row.dirt` appeared / `row.dirtFull` set | lazily create / finalize dirt overlay (terrain); flowers inside `R3D.dirtSpan(row)` become invisible (props checks per rebuild or per frame) |

### 5.6 Batching, pooling, renderOrder

- Model convention: every prop/vehicle/creature model is built ONCE as a single merged,
  vertex-colored BufferGeometry (`R3D.util.mergeGeoms` + `tint`) drawn with `R3D.MAT.opaque`
  → one draw call per entity. Cache in `R3D.assets` under the keys you choose
  (quantize continuous widths, e.g. `car:3:w17` with w in 1/16 tile).
- Per-row STATIC decor is merged into at most 2 meshes per Part (one opaque, one
  transparent): terrain.ground = checker slab + edge strips + decals; props.grassContents
  statics = all trees + flowers + holes + scorch merged (rebuilt only on the rare signals).
- Movers are POOLED meshes (module-level `R3D.Pool`): cars (per kind), trucks, logs, pads,
  clouds, deer, planes, trail assemblies, tractor. A lane Part acquires on build, writes
  positions per frame, releases on dispose.
- Committed pool caps: logs 24, pads 24, clouds 12, cars 24, trucks 6, deer 12, planes 4,
  trails 6, tractors 2, coins 16, treefall 6, txt 6, fx sprites 64.
- renderOrder tiers: 0 opaque world · 1 ground decals (depthWrite false) · 2 blob shadows ·
  3 fx sprites/contrail puffs (depthTest true) · 5 contrail ribbons · 998 "!" warnings
  (depthTest false) · 999 fx '+1' text (depthTest false).
- Budget: ≤ 150 draw calls in `renderer.info.render.calls`, one shadow map pass with
  ~30 casters. Zero per-frame allocation (frame reused, pools pre-warmed, no `new` in update paths).

---

## 6. Per-module contracts

Every 2D formula/color cited below is verbatim in your spec file — implement it exactly
(px ÷ 64). "DoD" = definition of done. The complete-entity checklists are exhaustive: if it
is on your list and not on screen, your module is incomplete; nothing is owned by two modules.

### 6.1 terrain (spec-terrain.md)

Registers: `ground(r, row) → Part`, `riverContents(r, row) → Part`, `updateBestLine(frame)`, `init(ctx3)`.

`ground(r, row)` — row may be UNDEFINED (⇒ plain grass checker, parity from `(r + c)`,
negative r legal). By `row.type`:
- grass/undefined: 11-tile checker slab (§2.2 heights; grassA when (r+c) odd) extended to
  x ∈ ±8.2 with the same parity colors (overhang; NO trees/props out there), plus dirt
  overlay when `R3D.dirtSpan(row)` ≠ null: base `#c09a62` plane scaled to the px span,
  two rut stripes `rgba(122,90,48,0.5)` (5 px tall bands at 0.26 and 0.60 of row depth →
  row-local z = -0.5+0.26+…, thin planes running the span), pebbles `rgba(90,64,32,0.35)`
  r 2.5 px on the FIXED grid x = 10 + i·42 px with jitter `(r·13 + x) % 12` px — a per-row
  InstancedMesh (cap 17, in `owned`), each pebble visible IFF inside the span (zero-scale
  hidden). Pebbles are world-anchored: REVEALED in place, never sliding (the 2D bug-fix).
- road: asphalt slab top -0.05; `bi === 0` → light strip `#9aa0ab` 3.5 px on the FAR edge;
  `bi === bn-1` → dark strip `#3c414b` 3.5 px on the NEAR edge; `bi > 0` → subtle white
  dashes rgba(255,255,255,0.55), 22×4 px every 42 px from x = 8, lying at the far boundary.
- river: water plane `#3f8fd6` at -0.14; static ripple decals (white 0.15; pairs every
  48 px from x=16, 15×3 px + 11×2.4 px at x+24, jitter `(x·37 + bi·19) % 3` × 6/5 px —
  merged into the ground mesh, NOT animated); foam pills white 0.6, 12×6 px r 3 every
  20 px: on the NEAR edge when `bi === 0`, FAR edge when `bi === bn-1` (both when bn === 1).
- rainbow: 7 full-width stripes spanning the WHOLE BAND, sliced per row. Band first row
  `rFirst = r - row.bi`; stripe s (0 = red `#ff5a5f`) occupies row-coordinate depth
  `[rFirst + bn - (s+1)·bn/7, rFirst + bn - s·bn/7]`; this row renders only the clip to
  `[r, r+1]`, +0.01 depth bleed to hide seams. Per-row geometry → `owned`. Red is FARTHEST,
  violet `#9b6ef3` nearest the player.
- deer: grass checker + trampled trail decal (tan rgba(193,154,94,0.5) rounded band, full
  width +4 px bleed, depth 0.42 of the row centered ~0.51) + hoofprint pairs
  rgba(110,80,45,0.4) 3×2 px every 52 px with the `(r·17+x)%14` / `(r·11+x)%10` jitters +
  TWO deer signs from `R3D.props.makeDeerSign()` at worldX = ±5.094 (26 px in from each
  edge), row-local z = -0.15.

`riverContents(r, row)` — logs and lily pads (they are contents, not ground):
- logs: pooled cylinders (r 0.16, center y -0.16, length `l.w · 0.9`, along X): bark
  `#8a5a33`, lighter top strip `#a97c4f`, end caps `#c9976a` with growth-ring detail
  (cap texture or inset ring geometry). Per-frame `x = R3D.LX(l.x)`. castShadow = true.
- pads: one disc per pad column (r 0.281, thickness 0.03, top -0.01) with a wedge notch
  (CircleGeometry thetaLength 2π-0.68, rotated `R3D.hash(c) · 2π`), two greens `#3d9e4f`
  under / `#4db362` top; bob `sin(t·1.6 + c·2) · 1.5/64`; 40% (hash(c) < 0.4) carry the
  tiny 5-petal white flower + `#ffce3d` center. Cache geometry per rotation bucket.

`updateBestLine(frame)` — global: dashed white line (70% alpha, 3 px wide, dash 10 px /
gap 9 px) lying at worldZ = -(frame.best + 3), y 0.03, full 11 width (instanced dashes or
one merged geometry, rebuilt only when best changes); plus the badge: a billboard
`textSprite` white pill (88% alpha, 86×24 px, r 9) reading `🏆 BEST <n>` in `#c2571f`,
at worldX -4.7, y 0.5, same Z. Hidden until `frame.best >= 3`. Texture rebuilt only when
`best` changes.

DoD: all five row types + undefined rows render; single-row roads show both curb strips;
1-row rivers show foam on both edges; a 3-row rainbow shows 7 continuous stripes crossing
row seams; dirt strip grows behind a live tractor with pebbles appearing in place, flowers
vanishing (props side), and persists as dirtFull; best line + badge appear at row best+3
boundary after a best ≥ 3 run; geometry count flat over a 5-min soak.

### 6.2 props (spec-props.md)

Registers: `grassContents(r, row) → Part`, `makeDeerSign() → THREE.Group`, `init(ctx3)`.

`grassContents(r, row)` owns, per grass row (row may be undefined → empty Part):
- TREES: per (r,c) seed `r·31 + c·7`; `s = R3D.hash(seed)`, canopy scale `v = 0.88 + s·0.28`,
  berries iff `s < 0.3`. Trunk box 0.156×0.281 `#8a5a33` + right-side shade strip; 3 canopy
  tiers (two side spheres r 0.219v at h 0.391, mid r 0.25v at 0.516v, top r 0.156v at
  0.641v) colored `#3f9e50/#47ab59/#57bd68`; white glint; 3 berry spheres `#ff6b6b` r 0.041.
  All trees + flowers + hole decals + scorch of the row merged into ONE static mesh
  (+ 1 transparent sibling if needed), rebuilt only on the §5.5 signals. castShadow = true.
- FLOWERS: stored jitter `f.jx/64`, `f.jy/64` (jy displaces along Z) from column center;
  kinds 0/1/2 = 4-petal (petals r 0.041 at radius 0.053, ring rotated 0.4 rad; colors
  white/pink `#ffd1e8`/pale `#ffe9a8`; center `#ffce3d` r 0.034); kind 3 = 3 bent blades
  `#6cbb4f`. A flower whose x-px falls inside `R3D.dirtSpan(row)` is NOT drawn.
- HOLES: flat layered-disc decal at column center, y 0.018 — concentric ellipses→circles:
  rim `#7d9a52` r 0.36, lip `#5b3d22` 0.3125, shaft `#2e1d10` 0.258, pit `#170e07` 0.172,
  faint white back-rim arc. (Decal, not carved geometry.)
- COINS: pooled mini-groups (cap 16): gold disc cylinder r 0.172 `#ffd23e` + rim torus
  `#dd9d12` + inner ring + additive halo sprite rgba(255,215,80,0.25) r 0.266; center
  y = 0.35 + `sin(t·2.6 + c·1.7)·3/64`; SPIN = real Y rotation `θ = t·2.2 + c`; blob shadow
  `rgba(25,55,25,0.16)` whose x-scale tracks `|cos θ|` (8·sq+2 px); optional face-on sparkle
  when `|cos θ| > 0.92`. castShadow = false.
- ROCKET (`row.rocket`): one assembly per rocket row — grey pad (squashed cylinders
  `#8a8f9c`/`#6d7280`, stays grounded forever), ship (white body cylinder Ø0.28 h 0.625
  `#f4f7fb`, red cone nose to 0.94 total, 3 red fins `#e63946`, porthole `#35506e`/`#9fd4ff`),
  flame cones `#ff9f43`/`#ffd93d` scale `(phase==='fly' ? 1 : 0.35) · (0.8 + 0.2·sin(t·37))`
  (arm+fly only), smoke column during fly: 6 pooled grey spheres at y = 0.125 + lift·i/6,
  x wiggle `sin(i·2.6 + t·3)·7/64`, radius (7 + (1-i/6)·9)/64… inverted per spec: k=1-i/6,
  radius (7 + (1-k)·9)/64, opacity `0.5·k·max(0, 1 - rk.t·0.8)`; ship transforms:
  arm shake `x += sin(t·42)·(1.5 + rk.t)/64`, fly lift `y += rk.t² · 12.1875`;
  blinking "!" `R3D.util.warnSprite()` scale 0.31 at (+0.25, 1.03) over the pad, visible
  `sin(t·10) > -0.4`, arm phase only. Phases mirror `rk.phase/rk.t` verbatim: idle|arm →
  ship visible; fly → ship + scorch; gone → scorch only.
- SCORCH: dark decal (pad grey + burn rgba(50,38,30,0.55) + char center rgba(25,18,14,0.5))
  in the merged static mesh once phase ∈ {fly, gone}.

`makeDeerSign()` → fresh Group (terrain places it): grey post `#7d838f` (0.078 wide,
0.375 tall), yellow diamond `#ffd23e` (0.34×0.34 box rotated 45° about Z) centered 14/64
above post base, inset border `#8a6508`, leaping-deer silhouette `#3a2d24` as a small
CanvasTexture decal on the diamond face (facing +Z / camera). Total height ~0.5.

DoD: deterministic forests (same seed → same tree every frame/session); tractor mowing a
row visibly removes trees (fx plays the fall), paves holes, hides flowers progressively;
coins spin/bob/collect; full rocket lifecycle incl. warning, flame flicker, smoke, scorch;
≤ ~3 draw calls per grass row + coins.

### 6.3 vehicles (spec-vehicles.md)

Registers: `carLane(r, row) → Part`, `updateGlobals(frame)`, `init(ctx3)`.

`carLane` — pooled car/truck meshes, one per `row.cars` entry (count fixed for row life):
- Car (kind 0–4): body `CAR_COLORS[kind % 5]` rounded box `w = c.w·0.88` long × 0.344 tall
  (depth ~0.55), glass canopy `#d9f0ff` split by a body-color pillar, 4 tire cylinders
  `#2a2d33` r 0.102 at ±0.28w with pale hub dots, headlight `#fff3ad` front / taillight
  `#ff5a5f` rear. Truck (kind 9): tall cargo box `#e8e4da` (rear 62%, top 0.47) + shorter
  blue cab `#4aa3ff` + window `#bfe6ff` + two `#d3cfc4` stripes.
- Per frame: `x = R3D.LX(c.x)`; bob `y += sin((t + c.seed)·9 + sx·0.05)·0.8/64` where
  `sx = (c.x - 2.5)·64`; model faces +X, `rotation.y = π` when `row.dir < 0`.
  castShadow = true (no blob).

`updateGlobals(frame)` owns FOUR global systems:
1. TRACTOR — diff `World.tractors()` against a 2-slot pool. Model: green body `#4cae4c`,
   darker hood `#3d9142`, rear cab `#2e7d32` + window `#bfe6ff`, front steel blade
   `#8a8f9c` (0.11 deep × 0.34 tall) + arm `#6d7280`, exhaust pipe `#555a66` with 3 smoke
   puff spheres: phase `ph = (t·0.9 + i·0.33) % 1`, rise 20/64, radius (3 + ph·5)/64,
   opacity 0.5(1-ph), grey rgb(160,160,168); big rear wheel r 0.1875 + small front r 0.109,
   mustard hubs `#e0a616`. Position `x = R3D.X(tt.x)` (RAW cols — no PAD, no +0.5),
   `z = R3D.Z(tt.row)`. Faces +X, mirror via rotation.y for dir < 0. castShadow = true.
2. PLANES — pool of 4 groups reading `frame.planes`. Model: white capsule fuselage
   `#f4f7fb` 0.78 long Ø0.28, red belly stripe + tail fin `#e63946` (0.375 tall),
   symmetric swept wings near `#4aa3ff` / far `#3d8fe0`, cockpit `#35506e`, 3 round
   windows. `x = R3D.X(p.x)` (RAW cols), y = 1.5 + `sin(t·7)·2/64`, z = R3D.Z(p.row);
   faces +X, mirrored for dir < 0. On screen iff worldX ∈ (-6.44, 6.44).
   - Ground shadow blob: `R3D.util.blob` cool `rgba(20,30,50,0.15)`, rx 30/64 × ry 6/64,
     on the ground under the plane (y 0.024), visible only while the plane is on screen.
   - ACTIVE CONTRAIL: ribbon at y 1.5, thickness 7/64, from edge x = ∓6.44 (entry side)
     to `tail = planeX - dir·42/64`; alpha gradient 0.1 (edge) → 0.75 (tail) via a shared
     1×64 white-gradient CanvasTexture on a scaled unit plane. Exists even while the plane
     is off-screen approaching.
   - EDGE WARNING: `R3D.util.warnSprite()` scale 0.41 at x = ±5.156 (the side it will
     enter), y 1.5, z = R3D.Z(p.row); `.visible = sin(t·12) > -0.3 && plane off-screen`.
3. LINGERING TRAILS — pool of 6 assemblies reading `frame.trails`: full-width ribbon
   (x -6.1..+6.1, y 1.5, thickness 7/64) alpha `(1 - age/8)·0.5`, plus 13 puff spheres at
   x = (20 + i·56 + (row·37 % 30))/64 - 5.5, radius `(6 + ((20+i·56)·13 + row·7) % 4)/64`,
   alpha ×0.7 — deterministic per row, positioned once on acquire.
4. (Nothing else — the rocket "!" is props', the eagle is creatures'.)

DoD: traffic flows with PAD wraparound entering/exiting beyond the vignette; trucks read as
box-trucks; tractor crosses carving (terrain shows dirt) with puffing smoke; plane strafes
with contrail, blob shadow, blinking edge "!", and leaves an 8 s fading trail; nothing pops
at the ±8 overhang edges; pools release on row dispose (soak-flat).

### 6.4 creatures (spec-creatures.md)

Registers: `cloudLane(r, row) → Part`, `deerLane(r, row) → Part`, `updateEagle(frame)`, `init(ctx3)`.

`cloudLane` — pooled clouds per `row.clouds` entry:
- Body: 3 overlapping puff spheres (radii 0.40/0.48/0.38 × R, offsets -0.55/-0.05/+0.42 × R,
  R = c.w/2) over a rounded slab 1.5R × 0.31, main `#5f6883` with `#454c63` under-shade
  (duplicate meshes offset -3/64 or vertex-color underside), white 0.14 top highlights.
- Angry face on the CAMERA side (+Z): white eye spheres r 5/64 at ±9/64, pupils `#20242f`
  offset `dir·1.8/64` in X, V-brows `#2a2f40`, small frown arc. Face parts are fixed px
  sizes — do NOT scale with c.w.
- Float: group y = 0.36 + `sin(t·2 + c.seed)·2.5/64`; x = `R3D.LX(c.x)`; z row-local 0.
- Rain: 4 short emissive-blue streaks rgba(96,170,255,0.85), spread over the middle 64% of
  the width with `sin(seed·3 + i·9)·4/64` jitter; loop phase `ph = fract(t·1.5 + i·0.23 + seed·0.11)`,
  falling from cloud underside 26/64 over the loop, alpha `(1-ph)·0.8`.
- Blob shadow: cool `rgba(20,30,50,0.18)` rx `0.4·c.w`, ry 6/64, static (no pulse), moves with x.
- castShadow = false (blob owns it).

`deerLane` — pooled deer per `row.deer` entry (herd count changes → diff per frame):
- Model faces +X (mirror for dir < 0): tan capsule torso `#c68e5a` 0.44×0.25 centered
  0.19 up, cream rump+tail `#f4ead9`, box neck + head + cone ear, thin antlers `#8a5a33`,
  4 leg cylinders `#9c6b3f`.
- Gallop is POSITIONAL: `bound = |sin(sx · 0.09)|` with `sx = (d.x - 2.5)·64`;
  body lifts `bound·10/64`; legs scissor rotation ≈ ±0.5 rad from `(bound - 0.5)`.
- Blob shadow green rgba(25,55,25,0.2) rx 14/64 ry 5/64 stays grounded while the body bounds.

`updateEagle(frame)` — ONE persistent eagle group + menace blob; owns ALL eagle rendering:
- Model (faces +Z, ~1.56 wingspan): body ellipsoid `#7c5230`, white head sphere `#f6f2ea`,
  yellow beak cone `#f5b91a`, angry brows, flat wing slabs `#6b4423` hinged at shoulders,
  tail prism `#5a381d`, two gold talon tabs `#e8a81c`. Expose flap pose:
  wing rotation `∓(0.25 + sin(t·13)·0.45)`; `grab` drops talons 3/64.
- 'active' (frame.mode === 'play'): charX = R3D.X(chr.colF + 0.5), charZ = R3D.Z(chr.rowF);
  eagle at x = charX + `sin(t·2.6)·46/64`, y = 2.578 + `sin(t·5)·9/64` (ground-relative,
  ignores hop z), z = charZ. MENACE SHADOW at the char's ground point: black blob,
  alpha `0.1 + 0.08·sin(t·8)`, rx `(26 + 4·sin(t·8))/64`, ry 9/64.
- 'flee': k = min(eagle.t/0.8, 1); x = charX + `sin(t·2.6)·(46/64)(1-k)` + `fleeDir·k²·520/64`;
  y = 2.578 + `sin(t·5)·(9/64)(1-k)` + `k²·300/64`; no shadow. Hidden when state 'none'.
- DEATH GRAB (frame.mode === 'dying' && frame.chr.deathCause === 'eagle'):
  dive = min(chr.dieT/0.4, 1); eagle at charX/charZ,
  y = `chr.z/64 + 52/64 + (1 - dive)·480/64`, grab pose (talons extended). The char itself
  (rising at 300 px/s after 0.4 s — already inside frame.chr.z) is animals' job; the two
  stay locked 52/64 apart automatically. Eagle visible ONLY in the two cases above.

DoD: clouds bob/glower/rain with per-seed desync, pupils track direction; herds gallop
through with grounded shadows and despawn; eagle screams in (audio is main.js), circles
with pulsing menace shadow, flees on dodge with the quadratic ease, and executes the full
dive-lock-carry on eagle death; nothing eagle-related renders in menu.

### 6.5 animals (spec-animals.md)

Registers: `buildRig(id) → Rig`, `updateCharacter(frame)`, `drawCards(cardCanvases, tGlobal, selected)`, `init(ctx3)`.

`Rig = { group: THREE.Group, pose(opts) }` — feet at local origin, FACES +Z (toward the
camera; the game's charm is the front-on faces — never show the back of a head).
`pose(opts)` is byte-compatible with 2D `Sprites.animal` opts:

```js
rig.pose({ t, z /*PX*/, squash = 1, shrink = 1, flip, lean, air, dead, seed = 0 });
// Mapping (transform order matters — mirror the 2D wrapper):
//  group.position.y = z / 64
//  uniform scale = shrink;  rotation.z = lean * 0.1;  flip → scale.x *= -1
//  squash: scale.y *= squash, scale.x & scale.z *= 1/sqrt(squash)   (volume-true)
//  dead:  extra scale(1.3, 0.5, 1.3) pancake + TWO translucent blue halos
//         (ground puddle ellipse rgba(120,180,255,0.35) rx 25/64 ry 6/64 at feet;
//          camera-facing halo sprite rgba(110,150,200,0.3) rx 27/64 ry 15/64 at y 10/64)
//         + blink disabled + X-eyes optional per spec
//  blink: eyes scale.y → 0.1 while ((t + seed) % 3.4) > 3.25 (never when dead)
//  air:   duck only — spread flapping wings rot ±(0.5 + sin(t·18)·0.35 + 0.55); else folded
//  BLOB SHADOW (owned by the rig): green rgba(25,55,25,0.24) rx 17/64 ry 6.5/64 at feet
//         ground point, scale max(0.5, 1 - z/70) * shrink, HIDDEN when shrink ≤ 0.05.
```

`z` stays IN PX deliberately: every producer (hopH 22/27/30/36/48/9, teeter -6, carry
300·dt, card bounce 8/2.5) is px, so no conversions at any seam.

Four rigs per spec-animals §2–5 (all idle animations verbatim: cat tail `sin(t·4)·4` px,
dog tail `sin(t·5)·1.5` px + tongue `sin(t·6)` px, bunny ear sway `±0.04·sin(t·2)` rad,
duck flap). One-piece rounded-box bodies; cat ear tips at exactly 1.0 unit.

`updateCharacter(frame)`: hidden entirely when `frame.mode === 'menu'`. Else, with C = frame.chr:
- Build/keep 4 gameplay rigs lazily; show rig C.id.
- Bump nudge: `kb = C.bump ? sin(π·C.bump.t/0.13)·7 : 0` px;
  `group.position.x = R3D.X(C.colF + 0.5) + C.bump.dc·kb/64`;
  `group.position.z = R3D.Z(C.rowF) - C.bump.dr·kb/64` (forward = -Z).
- `rig.pose({ t: frame.t, z: C.z, squash: C.squash, shrink: C.shrink, flip: C.flip,
  lean: C.lean, air: C.air, dead: C.dead, seed: 1.7 })`.
- All death choreography arrives pre-computed in C (z incl. teeter sink & eagle carry,
  shrink for hole/water, dead pancake flag) — do NOT re-derive it. The grab-eagle is creatures'.
- castShadow = false on all rig meshes (the blob is the gameplay-readable shadow).

`drawCards` — see §8.

DoD: all four characters read instantly as their 2D selves; hop stretch/land squash/lean/
flip/teeter/pancake+halos/shrink-vanish/eagle-dangle all fire from frame data; blink
desyncs by seed; duck wings spread only on special flight; cards animate per §8.

### 6.6 fx (spec-mainrender.md §1.2 + §9 here)

Registers: `init(ctx3)`, `step(dt)`, `clear()`, `poof(col, row, h, life)`,
`coinBurst(col, row)`, `rainBurst(col, row)`, `treefall(col, row, spin)`, `txt(col, row, h, str)`.

World-unit API (no screen px, no camY — the 2D menuCam footgun is designed out):
`col` = fractional column CENTER (call sites pass `c + 0.5`), `row` = fractional row INDEX
(fx applies `R3D.Z(row)` itself), `h` = height above ground in units.

Kinds — physics verbatim ÷64, `k = 1 - t/life`, hard kill at `t ≥ life`:

| kind | spawn | physics (u, u/s, u/s²) | render |
|---|---|---|---|
| spark | coinBurst ×7, base h 0.31 | vx = cos(a)·1.40625; vyUp₀ = 0.9375 + rnd·1.40625; gravity vyUp -= 7.8125·dt; life 0.5 | gold dot sprite r 0.05, rgba(255,210,62), alpha 0.9k |
| drop | rainBurst ×16, base h 0.23 | vx = cos(a)·(0.9375 + rnd·1.875); vyUp₀ = 1.25 + rnd·2.1875; same gravity; life 0.7 | blue dot r 0.047, rgba(96,170,255), alpha 0.9k |
| poof | poof(...) | rises 0.1875 u/s; life = arg | soft white sprite, diameter 0.156 → 0.4375 over life, alpha 0.4k |
| txt | coinBurst / txt(...) | rises 0.71875 u/s; life 0.8 | pooled '+1' sprite: fill `#ffe9a8`, stroke `#b57e0a` w4, font '800 20px Arial Rounded MT Bold' baked ×4; scale ~0.9×0.45; alpha min(1, 2k); depthTest false, renderOrder 999 |
| treefall | treefall(...) | no motion; tips `rotation ≈ (1-k)·1.5·spin` about its base (rotate about the world-X axis mapped to screen-tilt: use Z-axis rotation of a camera-facing group OR X-position-preserving Z rotation — commit: rotate about the row-parallel axis (world X→ no; use local z-rot of a +Z-facing group)); alpha min(1, 1.6k); life 0.7 | pooled mini-tree: trunk box 0.125×0.25 `#8a5a33` + canopy sphere r 0.219 `#47ab59` at h 0.406 |

Committed for treefall: the mini-tree group faces +Z and rotates about its LOCAL Z axis at
the ground contact (screen-plane tip-over, matching the 2D read).

`coinBurst(col,row)`: 7 sparks at h 0.31 + one txt '+1' at h 0.53 (the 2D sy-14 offset).
`rainBurst(col,row)`: 16 drops at h 0.23.

Implementation: 64 pooled `THREE.Sprite`s with 3 shared radial CanvasTextures (gold, blue,
soft-white) and per-sprite SpriteMaterials created once at init; 6 txt sprites; 6 treefall
groups. `clear()` deactivates all live particles. `step(dt)` integrates + writes
position/scale/opacity — it is the ONLY dt integrator in the renderer.

DoD: every §9 call site produces its effect at the right world spot in play AND menu
(treefall during attract mode); particles freeze when paused mid-burst; pools never grow.

---

## 7. Camera rig, lighting, sky, fog, shadows, overlays (core.js — exact numbers)

### 7.1 Camera: ORTHOGRAPHIC, pitched 58°, yaw 0 (committed)

Rationale (final): the 2D game is a locked 11×15-tile strip with every column visible at
every row; a portrait perspective camera cannot show 11 tiles of width at the near rows AND
~15 rows of depth. Ortho + tilt keeps all 11 columns visible everywhere, keeps the
world→screen map linear (danger glow, warnings, best-line line up), and IS the Crossy Road
look. Depth comes from the 58° tilt, real geometry, and shadows.

```js
const PITCH = 58 * Math.PI / 180;   // SIN_P = 0.848048, COS_P = 0.529919
const BOOM = 20;                     // distance along the view ray (arbitrary for ortho)
const NEAR_OVERSHOOT = 0.6;         // bottom screen edge cuts ground 0.6u below row camY's near edge
const camera = new THREE.OrthographicCamera(-5.5, 5.5, 7.5, -7.5, 0.1, 60);  // 11 × 15 units = 704:960

function rigCamera(frame) {
  const zC = -(frame.camY - 0.6 + 7.5 / 0.848048);          // = -(frame.camY + 8.2437)
  camera.position.set(0, 20 * 0.848048, zC + 20 * 0.529919); // (0, 16.9610, -camY + 2.3547)
  camera.lookAt(0, 0, zC);
  if (frame.shake > 0) {                                     // 2D: ±4.5px both axes × shake/0.3
    const a = 0.140625 * (frame.shake / 0.3);                // 9/64
    camera.translateX((Math.random() - 0.5) * a);
    camera.translateY((Math.random() - 0.5) * a);
  }
  camera.updateMatrixWorld();
}
```

Derived facts (use them to sanity-check layout — do not re-derive differently):
- Visible ground: z ∈ [-(camY - 0.6), -(camY + 17.088)] → 17.69 rows; 54.3 logical px/row.
- The character (rowF ≈ camY + 4.5, feet at z = -(rowF+0.5)) sits 31.6% up the screen
  (2D: 31.8% — near-pixel parity).
- Camera-to-ground distance for a point k rows ahead of the bottom edge: `d = 15.31 + 0.530·k`
  (bottom 15.31, top 24.69). Fog math below depends on this.
- Row build window camY+19 is BEYOND the visible top (camY+17.1): world-gen pop-in is
  physically off-screen; the traffic-update ceiling (cam+18) is also never visible frozen.

Menu mode: identical rig with `camY = menuCam` (main.js already passes it). No special
menu camera; the world drifting under the DOM menu panel IS the attract mode.

Resize: the frustum NEVER changes (stage aspect is locked). `R3D.resize(cw, ch, dpr)`:
`renderer.setPixelRatio(dpr); renderer.setSize(cw, ch, false); canvas.style.width/height = cw/ch + 'px'`.

### 7.2 Renderer + color doctrine

```js
renderer = new THREE.WebGLRenderer({ canvas, antialias: true });  // the EXISTING #game canvas
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;    // tone mapping would shift the art palette — forbidden
renderer.setClearColor(0xcfe8f8);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

Calibration rule: a horizontal face vertex-colored `#98d96f` must screenshot within ~5% of
`#98d96f`. Tune LIGHT INTENSITIES to hit this; never tune the palette hexes.

### 7.3 Lights, fog, shadows

```js
scene.fog = new THREE.Fog(0xcfe8f8, 21, 34);
// Ground spans camera-distance 15.3..24.7 → character row ~18.0 (0% fog), top visible row
// ~24.7 (~28% haze melting into the clear color). Subtle by design: planes/rockets spawn
// ≤ 12 rows ahead and must stay readable. The fog band never breathes (camera height fixed).

const hemi = new THREE.HemisphereLight(0xdfefff, 0x86b45f, 0.85);
const amb  = new THREE.AmbientLight(0xffffff, 0.35);              // keeps shade candy-bright
const sun  = new THREE.DirectionalLight(0xfff2d8, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);                               // contract max
sun.shadow.camera.left = -8; sun.shadow.camera.right = 8;
sun.shadow.camera.top = 12;  sun.shadow.camera.bottom = -12;
sun.shadow.camera.near = 1;  sun.shadow.camera.far = 45;
sun.shadow.bias = -0.0005;   sun.shadow.normalBias = 0.02;

// per frame, INTEGER-quantized so shadow texels never swim during the scroll:
const az = -(Math.round(frame.camY) + 8);
sun.target.position.set(0, 0, az);  sun.target.updateMatrixWorld();
sun.position.set(-4, 13, az + 6);
// Sun from upper-LEFT-behind: matches the 2D art (tree glints top-left, shade strips on the
// right) — shadows fall right-and-toward-camera.
```

Casters (castShadow = true): trees, rocket ship, cars, trucks, tractor, logs.
Non-casters: character, clouds, deer, eagle, coins, flowers, all decals, fx, ground.
Receivers: ground slabs, dirt, water.

### 7.4 Blob-shadow doctrine (art-critical — a blob's position IS gameplay information)

Real shadow-mapped shadows for grounded scenery; hand-authored blob discs
(`R3D.util.blob`, y 0.024, renderOrder 2) for everything airborne or gameplay-signaling:

| Blob | Owner | Spec |
|---|---|---|
| character | animals | rgba(25,55,25,0.24), 17×6.5 px, scale max(0.5, 1-z/70)·shrink, hidden shrink ≤ 0.05 |
| cloud | creatures | rgba(20,30,50,0.18), rx 0.4·w, ry 6 px, static |
| plane | vehicles | rgba(20,30,50,0.15), 30×6 px, under the plane, on-screen only |
| eagle menace | creatures | black, alpha 0.1+0.08·sin(8t), rx (26+4·sin(8t)) px, ry 9 px, 'active' only |
| coin | props | rgba(25,55,25,0.16), rx (8·|cosθ|+2) px, ry 3.5 px |
| deer | creatures | rgba(25,55,25,0.2), 14×5 px, grounded while body bounds |

### 7.5 Vignette + danger glow — DOM, injected by core.js into `#stage` (pixel-identical to 2D, zero GL cost)

```css
#r3d-vignette { position:absolute; inset:0; pointer-events:none; z-index:2;
  background: linear-gradient(90deg, rgba(20,45,20,.18), rgba(20,45,20,0) 8.52%,
              rgba(20,45,20,0) 91.48%, rgba(20,45,20,.18)); }      /* 60/704 */
#r3d-danger { position:absolute; left:0; right:0; bottom:0; height:15.63%;  /* 150/960 */
  pointer-events:none; z-index:2; opacity:0;
  background: linear-gradient(to top, rgb(255,60,60), rgba(255,60,60,0)); }
```

Per frame in `R3D.render` (verbatim 2D formula, 'play' only):

```js
const dz = frame.chr.rowF - frame.camY;
const a = (frame.mode === 'play' && dz < 2.2)
  ? Math.min(1, (2.2 - dz) / 2.2) * (0.28 + 0.12 * Math.sin(frame.t * 7)) : 0;
dangerEl.style.opacity = a.toFixed(3);
```

The plane/rocket "!" warnings stay IN GL (world-row-anchored billboards, §6.2/§6.3) —
DOM would need a row→screen mapping; sprites get depth-correct placement free.

---

## 8. Character-select portrait pipeline (animals.js)

ONE shared offscreen WebGLRenderer blitted into the four EXISTING 192×208 card canvases.
`buildCards()` / `selectChar()` DOM and click handling: untouched. main.js `drawCards()`
body becomes `R3D.animals.drawCards(cardCanvases, tGlobal, selected);` (§10 edit 12) —
note it passes main.js's existing `cardCanvases` array of `{ cv, c2, card }`.

```js
// animals.js — lazy-created on first drawCards call (menu only):
const off = document.createElement('canvas'); off.width = 192; off.height = 208;
const pr = new THREE.WebGLRenderer({ canvas: off, alpha: true, antialias: true });
pr.setPixelRatio(1); pr.outputColorSpace = THREE.SRGBColorSpace; pr.toneMapping = THREE.NoToneMapping;
const pscene = new THREE.Scene();                       // transparent bg — card CSS shows through
pscene.add(new THREE.HemisphereLight(0xffffff, 0x9ab27e, 0.9));
const pkey = new THREE.DirectionalLight(0xfff2d8, 1.6); pkey.position.set(2, 4, 3); pscene.add(pkey);
const pcam = new THREE.PerspectiveCamera(28, 192 / 208, 0.1, 20);
pcam.position.set(0, 0.95, 3.4); pcam.lookAt(0, 0.55, 0);   // gentle hero view; feet at origin
// 4 DEDICATED portrait rigs (fresh buildRig(id) — never the gameplay rigs), all added, visible one at a time.

R3D.animals.drawCards = function (cards, t, selected) {
  for (let i = 0; i < 4; i++) {
    const sel = i === selected;
    const bounce = sel ? Math.abs(Math.sin(t * 3.2)) * 8            // px — verbatim 2D
                       : Math.abs(Math.sin(t * 2 + i * 1.3)) * 2.5;
    const g = rigs[i]; g.group.visible = true;
    g.group.scale.setScalar(R3D.ANIMALS[i].id === 'bunny' ? 1.05 : 1.28);  // verbatim card scales
    g.pose({ t: t + i * 0.9, z: bounce, seed: i * 1.3 });                  // verbatim phases
    pr.render(pscene, pcam);
    g.group.visible = false;
    const c2 = cards[i].c2;
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.clearRect(0, 0, 192, 208);
    c2.drawImage(off, 0, 0);                       // same-task GL→2D copy — safe
  }
};
```

Cost: 4 tiny renders + 4 blits per MENU frame only. Perspective on purpose — the cards are
where a little lens depth makes the toys pop; nothing gameplay-aligned depends on it.

---

## 9. fx call-site map — the 11 rewritten spawn lines in main.js

main.js line numbers = current file (see §10). `T`, `rowFeetY`, `camBase`, `spawnP`,
`coinBurst`, `rainBurst`, `drawParticles` disappear; every spawn becomes a world-unit call:

| Line | Old (abbreviated) | New (exact) |
|---|---|---|
| :226 doMove | `spawnP('poof', (chr.fromC+0.5)*T, rowFeetY(chr.row,cam), {life:0.3})` | `R3D.fx.poof(chr.fromC + 0.5, chr.row, 0, 0.3);` |
| :281 launchSpecial | same shape | `R3D.fx.poof(chr.fromC + 0.5, chr.row, 0, 0.3);` |
| :330 doubleJump | `spawnP('poof', (chr.colF+0.5)*T, rowFeetY(chr.rowF,cam) - z0, {life:0.3})` | `R3D.fx.poof(chr.colF + 0.5, chr.rowF, z0 / 64, 0.3);` |
| :374 updateChar | `coinBurst((chr.col+0.5)*T, rowFeetY(chr.row,cam) - 20)` | `R3D.fx.coinBurst(chr.col + 0.5, chr.row);` |
| :413 drainWorldEvents | `spawnP('treefall', (ev.c+0.5)*T, rowFeetY(ev.r, state==='menu'?menuCam:cam), {life:0.7, spin:…})` | `R3D.fx.treefall(ev.c + 0.5, ev.r, Math.random() < 0.5 ? 1 : -1);` |
| :466 updateRockets | `spawnP('poof', (rk.c+0.5)*T + (rand-0.5)*26, rowFeetY(r,cam)+4, {life:0.4})` | `R3D.fx.poof(rk.c + 0.5 + (Math.random() - 0.5) * 0.41, r, 0, 0.4);` |
| :492 dog dust | `spawnP('poof', (chr.colF+0.5)*T + (rand-0.5)*20, rowFeetY(chr.rowF,cam)+2, {life:0.35})` | `R3D.fx.poof(chr.colF + 0.5 + (Math.random() - 0.5) * 0.31, chr.rowF, 0, 0.35);` |
| :589 die cloud | `rainBurst((chr.colF+0.5)*T, rowFeetY(chr.rowF,cam))` | `R3D.fx.rainBurst(chr.colF + 0.5, chr.rowF);` |
| :603 die hole | `spawnP('poof', …, {life:0.35})` | `R3D.fx.poof(chr.colF + 0.5, chr.rowF, 0, 0.35);` |
| :607 die water | `rainBurst(…)` | `R3D.fx.rainBurst(chr.colF + 0.5, chr.rowF);` |
| :613 die rocket | `rainBurst(…)` | `R3D.fx.rainBurst(chr.colF + 0.5, chr.rowF);` |

Plus: `updateParticles(dt)` body → `R3D.fx.step(dt);` (its three call sites :499, :624,
:1052 stay byte-identical — this preserves 2D pause/menu/dying freeze semantics exactly),
and resetRun's `particles = [];` → `R3D.fx.clear();`. The :413 rewrite deliberately kills
the 2D menuCam ambiguity: fx is camera-independent.

---

## 10. main.js integration checklist (complete; everything not listed is byte-identical)

Line numbers refer to the current `js/main.js` (1061 lines) and match spec-mainrender.md §1.

1. **index.html**: replace the script block per §1 (drop `js/sprites.js`, add vendor three
   + the 7 r3d files, everything `?v=13`); bump css to `?v=13`. No other HTML edits.
2. **:20** `const ctx = canvas.getContext('2d');` → `R3D.init(canvas);`
   (Removing the 2d context is MANDATORY — a canvas that ever had a '2d' context can never
   yield a WebGL context.)
3. **:39–44** (inside `resize()`): keep :32–38 (stage sizing, 28 px pad rule) and the dpr
   line; replace lines :40–44 (`canvas.width/height`, `canvas.style.*`, `ctx.setTransform`)
   with `R3D.resize(cw, ch, dpr);`
4. **:75** delete `let particles = [];`
5. **:95** (in `resetRun`) `particles = [];` → `R3D.fx.clear();`
6. **:107–139** delete `camBase`, `spawnP`, `coinBurst`, `rainBurst`; keep ONLY
   `function updateParticles(dt) { R3D.fx.step(dt); }`
7. **:140–178** delete `drawParticles`.
8. **11 spawn-site rewrites** per §9: :226, :281, :330, :374, :413, :466, :492, :589,
   :603, :607, :613.
9. **:694–696** delete `rowFeetY` (no callers remain after edits 7–8).
10. **:698–873** replace the `drawWorld(camY)` BODY with the §4 frame assembly + one
    `R3D.render(FRAME);` call. Keep the function name, signature, and its :1055 call site
    (`drawWorld(state === 'menu' ? menuCam : cam)`) untouched. Declare
    `const FRAME = { chr: {}, eagle: {} };` at module level beside it.
11. **:875–906** delete `drawChar` — its verbatim pose math (:879–892) now lives inside
    the frame assembly (§4 chr.z/squash/shrink comments), and its `Sprites.animal` /
    `Sprites.eagle` calls are replaced by animals/creatures modules.
12. **:942–956** replace the `drawCards()` body so the whole function reads exactly:
    `function drawCards() { R3D.animals.drawCards(cardCanvases, tGlobal, selected); }`
13. **frame loop, one added line**: after `if (document.hidden) dt = 0;` (:1045) insert
    `FRAME.dt = dt;`. The three dispatch call sites :1055–1057 keep their exact shapes.

DO-NOT-TOUCH list (the parity guarantee — byte-identical): `store` + localStorage keys
(`hs_char`, `hs_best`, `hs_coins`), `$`/`ui`/`show`, `ABILITY`, all state vars, `resetChr`,
`resetRun` (minus edit 5), `baseHopDur`, `logUnder`, `notifyMoved`, `tryMove`, `doMove`
(minus 1 spawn line), `useSpecial`, `launchSpecial` (minus 1), `doubleJump` (minus 1),
`updateChar` (minus 1), `updateRiver`, `drainWorldEvents` (minus 1), `updatePlanes`,
`spawnPlane`, `updateRockets` (minus 1), `updatePlay` (minus 1), `die` (minus 4),
`updateDying`, `finishGameOver`, `startGame`, `toMenu`, `togglePause`, `buildCards`,
`selectChar`, `refreshSpecialBtn` (works via the `Sprites.ANIMALS` shim), all input
handlers (keyboard/touch/click bind to the same canvas), all buttons, blur auto-pause,
every `Sfx.*` call, every `World.*` call, and the frame-loop dispatch :1042–1054 (minus
edit 13). Rendering continues every frame while paused/over with `tGlobal` advancing.

Integration verification (the integrator's DoD):
1. Boot to menu from `file://` AND a static server: attract scroll behind the panel,
   4 live portraits bouncing (selected bounces 8 px-equivalent), zero console errors,
   `Sprites`/`CFG` resolved with sprites.js absent.
2. Pause during a coin burst: sparks freeze mid-air; coins keep spinning (tGlobal runs).
   The 2D-semantics litmus test.
3. Die each of the 10 ways; verify shake amplitude, particles, pancake vs shrink vs
   eagle-carry vs swept-slide, and game-over copy (all driven by unchanged logic).
4. Screen parity: character ~32% up mid-run; danger glow pulses when `rowF - cam < 2.2`;
   best line on the far boundary of row best+2.
5. Perf: `renderer.info.render.calls < 150`; 60 fps with 20+ cached rows;
   `renderer.info.memory.geometries` flat over a 5-minute soak; no allocation in render.

---

## 11. Worked skeleton — the module file pattern (normative example)

```js
// js/r3d/example.js — classic-script IIFE; shows registration, shared assets, Part, pooling, disposal.
(function () {
  'use strict';
  const THREE = window.THREE, R3D = window.R3D;

  // ---- shared assets: module-level, built once, NEVER disposed ----
  let ctx3 = null;
  const PEBBLE_GEO = new THREE.SphereGeometry(0.039, 6, 5);         // fine at IIFE time
  function crateGeo() {                                             // or lazily via R3D.assets
    return R3D.assets.get('example:crate', () => {
      const parts = [];
      const g = new THREE.BoxGeometry(0.5, 0.4, 0.5);
      g.translate(0, 0.2, 0);                                       // bake transform: base at y=0
      parts.push(R3D.util.tint(g, R3D.PAL.wood));
      const lid = new THREE.BoxGeometry(0.54, 0.06, 0.54);
      lid.translate(0, 0.43, 0);
      parts.push(R3D.util.tint(lid, R3D.PAL.woodLight));
      return R3D.util.mergeGeoms(parts);                            // ONE geometry → one draw call
    });
  }
  const pool = new R3D.Pool(() => {
    const m = new THREE.Mesh(crateGeo(), R3D.MAT.opaque);           // THE shared Lambert
    m.castShadow = true;
    return m;
  }, 16);

  // ---- a row-part builder: (r, row) → Part ----
  function crateLane(r, row) {
    const group = new THREE.Group();                                // core sets group.position.z
    const owned = [];                                               // per-row resources ONLY
    const meshes = row.crates.map(() => { const m = pool.acquire(); group.add(m); return m; });
    return {
      group,
      update(row, frame) {                                          // EVERY frame while cached
        for (let i = 0; i < meshes.length; i++) {
          const c = row.crates[i];
          meshes[i].position.x = R3D.LX(c.x);                       // padded mover convention
          meshes[i].position.y = Math.sin(frame.t * 2 + c.seed) * 2 * R3D.PX;  // anim = f(frame.t)
          meshes[i].rotation.y = row.dir < 0 ? Math.PI : 0;         // faces +X, mirrored
        }
      },
      dispose() {                                                   // core removes group from scene
        for (const m of meshes) { group.remove(m); pool.release(m); }
        for (const o of owned) o.dispose();                         // per-row geoms/textures only
      },
    };
  }

  R3D.register('example', {
    init(c) { ctx3 = c; /* add global objects to ctx3.worldGroup here */ },
    crateLane,
  });
})();
```

Rules the example demonstrates: no import/export; `R3D.register` last; shared geometry via
`R3D.assets` + `mergeGeoms` + `tint` + `R3D.MAT.opaque`; transforms BAKED into geometry
(base at y = 0); Pool acquire/release; `owned` for per-row resources; all animation a pure
function of `frame.t`; padded vs raw x conventions; mirror via rotation.y.

---

## 12. Decision log (why, for reviewers — module authors may skip)

- ORTHO camera over perspective: 2 of 3 proposals + the width-vs-depth impossibility of a
  0.733-aspect perspective frustum; linear screen map preserves every 2D tuning.
  NEAR_OVERSHOOT 0.6 calibrates the character to 31.6% up vs 2D's 31.8%.
- World-unit fx API over px-inversion: kills the menu/play camY ambiguity at :413 and lets
  `rowFeetY`/`camBase` die; costs 11 one-line rewrites, sanctioned in §10.
- Row identity diff (`rowRef !== row`) over event plumbing: World.reset teleports are
  handled with zero main.js hooks; world.js stays read-only.
- Pose z in px: every main.js producer is px; converting at the rig keeps all seams
  numeric-conversion-free.
- Frame carries FINISHED pose (z/squash/shrink computed in main.js): drawChar's math stays
  verbatim in one place; animals author cannot mis-derive it.
- Vignette/danger in DOM: pixel-identical gradients, zero GL cost, always above the canvas.
- Blob shadows where position = information; shadow map for scenery only.
- Eagle death grab lives in creatures (not animals): one eagle model/pose owner.
- Deer sign model in props (its spec owns the geometry), placed by terrain (its spec owns
  the row layout) — the only cross-module builder call, via `R3D.props.makeDeerSign()`.




