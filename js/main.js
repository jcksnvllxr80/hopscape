// Hopscape — game loop, input, camera, collisions, and UI screens
(() => {
  'use strict';
  const T = CFG.TILE, COLS = CFG.COLS, W = CFG.W, H = CFG.H;

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v === null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    },
  };

  const $ = id => document.getElementById(id);
  const canvas = $('game');
  R3D.init(canvas);
  const ui = {
    stage: $('stage'), hud: $('hud'), score: $('score'), coins: $('coin-count'),
    menu: $('menu'), over: $('gameover'), paused: $('paused'),
    menuBest: $('menu-best'), menuCoins: $('menu-coins'),
    goTitle: $('go-title'), goReason: $('go-reason'), goScore: $('go-score'),
    goBadge: $('go-best-badge'), goBest: $('go-best'), goCoins: $('go-coins'),
    cards: $('cards'),
  };
  function show(el, on) { el.classList.toggle('hidden', !on); }

  // ---------- sizing ----------
  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const pad = Math.min(vw, vh) > 760 ? 28 : 0;
    const scale = Math.min((vw - pad) / W, (vh - pad) / H);
    const cw = Math.round(W * scale), ch = Math.round(H * scale);
    ui.stage.style.width = cw + 'px';
    ui.stage.style.height = ch + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    R3D.resize(cw, ch, dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- special abilities ----------
  const ABILITY = {
    cat:   { cd: 4, emoji: '\u{1F43E}', desc: '\u{1F43E} Long Leap — pounce 2 rows in one big bound!' },
    dog:   { cd: 5, emoji: '\u{1F4A8}', desc: '\u{1F4A8} Dash — zoom 3 squares ahead in a flash!' },
    bunny: { cd: 5, emoji: '\u{1F31F}', desc: '\u{1F31F} Double Jump — SPACE to hop, quick SPACE again mid-air!' },
    duck:  { cd: 7, emoji: '\u{1FAB6}', desc: '\u{1FAB6} Fly — flap up and soar 3 rows over everything!' },
  };

  // ---------- state ----------
  let state = 'menu'; // menu | play | dying | over
  let paused = false;
  let tGlobal = 0;
  let selected = store.get('hs_char', 0);
  // camera mode: 'classic' | 'tp' (third-person chase) | 'fp' (first-person);
  // hs_fp was the old boolean setting — migrate it forward once
  let camMode = store.get('hs_cam', store.get('hs_fp', false) ? 'fp' : 'classic');
  let peekL = false, peekR = false; // Q/E held: glance 45° left/right (fp/tp only)
  let best = store.get('hs_best', 0);
  let totalCoins = store.get('hs_coins', 0);
  let specialCd = 0;
  // obstacles: airplanes (+ lingering contrails) and the idle-punishing eagle
  const TRAIL_LIFE = 8;
  let planes = [], trails = [], planeTimer = 6, idleT = 0, honkCd = 0;
  // eagleState: none (not around) -> active (circling, about to dive and grab)
  // -> flee (missed its grab because you moved — wings off instead of vanishing)
  let eagleState = 'none', eagleT = 0, eagleFleeDir = 1;
  const irand = n => Math.floor(Math.random() * n);

  let cam = -4, menuCam = -4, graceT = 0, score = 0, runCoins = 0;
  let dieT = 0, deathCause = '', shake = 0;

  const chr = {};
  function resetChr() {
    Object.assign(chr, {
      row: 2, col: 5, fromR: 2, fromC: 5, toR: 2, toC: 5,
      rowF: 2, colF: 5, hopping: false, hopT: 0, squashT: 9,
      hopDur: 0.115, hopH: 22, air: false, z0: 0, lastDr: 1, lastDc: 0, teeter: null,
      flip: false, lean: 0, queued: null, bump: null, dead: false, drift: 0,
    });
  }

  function resetRun() {
    World.reset();
    resetChr();
    cam = chr.row - 6;
    graceT = 0; score = 0; runCoins = 0; dieT = 0; shake = 0;
    specialCd = 0;
    planes = []; trails = []; planeTimer = 5 + Math.random() * 4;
    idleT = 0; eagleState = 'none'; eagleT = 0; honkCd = 0;
    R3D.fx.clear();
    ui.score.textContent = '0';
    ui.coins.textContent = '0';
  }

  function baseHopDur() {
    const id = Sprites.ANIMALS[selected].id;
    if (id === 'dog') return 0.092;   // speedy paws
    if (id === 'bunny') return 0.15;  // floaty hops = a bigger double-jump window
    return 0.115;
  }

  // ---------- particles (simulated + rendered by R3D.fx; stepped ONLY from the
  // existing updateParticles call sites so pause/menu freeze semantics survive) ----------
  function updateParticles(dt) { R3D.fx.step(dt); }

  // ---------- movement ----------
  // is world-column-center cx currently over a log in this river row?
  function logUnder(row, cx) {
    for (const l of row.logs) {
      const wx = l.x - World.PAD;
      if (Math.abs(wx - cx) < l.w / 2 + 0.15) return true;
    }
    return false;
  }
  // any successful move/special resets the idle clock; if the eagle was
  // circling or diving in, this is the dodge — it flies off instead of
  // just vanishing
  function notifyMoved() {
    idleT = 0;
    if (eagleState === 'active') {
      eagleState = 'flee';
      eagleT = 0;
      eagleFleeDir = Math.random() < 0.5 ? -1 : 1;
    }
  }
  function tryMove(dr, dc) {
    if (state !== 'play' || paused) return;
    if (chr.hopping) { chr.queued = [dr, dc]; return; }
    doMove(dr, dc);
  }
  function doMove(dr, dc) {
    if (chr.teeter != null) return; // teetering over a hole — only a double jump saves you
    if (dc !== 0) chr.flip = dc < 0;
    const baseC = Math.round(chr.col + chr.drift); // a log ride may have carried us off-grid
    const tr = chr.row + dr, tc = baseC + dc;
    const minRow = Math.max(0, Math.ceil(cam - 0.2));
    if (tc < 0 || tc >= COLS || tr < minRow) return bumped();
    const row = World.row(tr);
    if (row && row.trees && row.trees.has(tc)) return bumped();
    if (row && row.rocket && row.rocket.c === tc && (row.rocket.phase === 'idle' || row.rocket.phase === 'arm')) return bumped();
    chr.fromR = chr.row; chr.fromC = chr.col + chr.drift;
    chr.toR = tr; chr.toC = tc;
    chr.drift = 0;
    chr.hopping = true;
    chr.hopT = 0;
    chr.hopDur = baseHopDur();
    chr.hopH = Sprites.ANIMALS[selected].id === 'bunny' ? 27 : 22;
    chr.air = false;
    chr.z0 = 0;
    chr.lean = dc;
    notifyMoved();
    R3D.fx.poof(chr.fromC + 0.5, chr.row, 0, 0.3);
    Sfx.hop();
    function bumped() { chr.bump = { dr, dc, t: 0 }; Sfx.bump(); }
  }

  function useSpecial() {
    if (state !== 'play' || paused || chr.dead || specialCd > 0) return;
    const id = Sprites.ANIMALS[selected].id;
    if (id === 'bunny') return doubleJump();
    if (chr.hopping) return; // everyone else launches from the ground
    notifyMoved();
    const baseC = Math.round(chr.col + chr.drift); // a log ride may have carried us off-grid
    if (id === 'dog') {
      // ground dash: sprint up to 3 rows ahead — leaps clean over holes,
      // but skids to a stop before solid obstacles (trees, rockets)
      let tr = chr.row;
      for (let i = 1; i <= 3; i++) {
        const row = World.row(chr.row + i);
        if (row && ((row.trees && row.trees.has(baseC)) ||
            (row.rocket && row.rocket.c === baseC && row.rocket.phase !== 'gone'))) break;
        if (!(row && row.holes && row.holes.has(baseC))) tr = chr.row + i; // never stop IN a hole
      }
      if (tr === chr.row) { chr.bump = { dr: 1, dc: 0, t: 0 }; Sfx.bump(); return; }
      launchSpecial(tr - chr.row, 0.09 * (tr - chr.row) + 0.06, 9);
      Sfx.boost();
    } else {
      // cat leaps 2, duck flies 3 — land short if the target is blocked
      const dist = { cat: 2, duck: 3 }[id];
      let tr = chr.row + dist;
      while (tr > chr.row) {
        const row = World.row(tr);
        if (row && ((row.trees && row.trees.has(baseC)) || (row.holes && row.holes.has(baseC)) ||
            (row.rocket && row.rocket.c === baseC && row.rocket.phase !== 'gone'))) tr--;
        else break;
      }
      if (tr === chr.row) { chr.bump = { dr: 1, dc: 0, t: 0 }; Sfx.bump(); return; }
      const arcs = { cat: [0.3, 36], duck: [0.7, 48] };
      launchSpecial(tr - chr.row, arcs[id][0], arcs[id][1]);
      Sfx.whoosh();
    }
    specialCd = ABILITY[id].cd;
  }

  function launchSpecial(dr, dur, h) {
    const baseC = Math.round(chr.col + chr.drift); // a log ride may have carried us off-grid
    chr.fromR = chr.row; chr.fromC = chr.col + chr.drift;
    chr.toR = chr.row + dr; chr.toC = baseC;
    chr.drift = 0;
    chr.hopping = true;
    chr.hopT = 0;
    chr.air = true;
    chr.hopDur = dur;
    chr.hopH = h;
    chr.z0 = 0;
    chr.lean = 0;
    R3D.fx.poof(chr.fromC + 0.5, chr.row, 0, 0.3);
  }

  // bunny only: jump AGAIN off thin air, extending the current hop one more
  // square in the same direction. A small grace window right after landing
  // keeps the timing friendly.
  function doubleJump() {
    let dr, dc, z0, midair;
    if (chr.hopping && !chr.air) {
      midair = true;
      dr = Math.sign(chr.toR - chr.fromR);
      dc = Math.sign(chr.toC - chr.fromC);
      z0 = Math.sin(Math.PI * Math.min(chr.hopT, 1)) * chr.hopH;
    } else if (!chr.hopping && (chr.squashT < 0.15 || chr.teeter != null)) {
      midair = false; // just landed (maybe teetering over a hole) — forgive it
      dr = chr.lastDr;
      dc = chr.lastDc;
      z0 = 0;
    } else if (!chr.hopping) {
      // grounded: SPACE is just a regular forward hop for the bunny —
      // the special is the QUICK second press while she's in the air
      doMove(1, 0);
      return;
    } else {
      return; // already on a special jump
    }
    const baseR = midair ? chr.toR : chr.row;
    const baseC = midair ? chr.toC : Math.round(chr.col + chr.drift); // a log ride may have carried us off-grid
    const tr = baseR + dr, tc = baseC + dc;
    const minRow = Math.max(0, Math.ceil(cam - 0.2));
    if (tc < 0 || tc >= COLS || tr < minRow) return;
    const row = World.row(tr);
    if (row && ((row.trees && row.trees.has(tc)) ||
        (row.rocket && row.rocket.c === tc && row.rocket.phase !== 'gone'))) {
      return; // nothing to land on there — the double jump fizzles, cooldown kept
    }
    chr.fromR = chr.rowF; chr.fromC = chr.colF; // take off from right here, mid-air
    chr.toR = tr; chr.toC = tc;
    chr.drift = 0;
    chr.hopping = true;
    chr.hopT = 0;
    chr.hopDur = 0.17;
    chr.hopH = 30;
    chr.z0 = z0;
    chr.air = true; // the second jump is special — clouds can't touch it
    chr.teeter = null; // saved from the hole!
    if (dc !== 0) chr.flip = dc < 0;
    notifyMoved();
    specialCd = ABILITY.bunny.cd;
    R3D.fx.poof(chr.colF + 0.5, chr.rowF, z0 / 64, 0.3);
    Sfx.whoosh();
  }

  function updateChar(dt) {
    if (chr.bump) {
      chr.bump.t += dt;
      if (chr.bump.t > 0.13) chr.bump = null;
    }
    chr.squashT += dt;
    if (chr.hopping) {
      chr.hopT += dt / chr.hopDur;
      if (chr.hopT >= 1) {
        chr.lastDr = Math.sign(chr.toR - chr.fromR);
        chr.lastDc = Math.sign(chr.toC - chr.fromC);
        chr.row = chr.toR; chr.col = chr.toC;
        chr.hopping = false;
        chr.air = false;
        chr.z0 = 0;
        chr.squashT = 0;
        if (chr.row - 2 > score) {
          score = chr.row - 2;
          ui.score.textContent = score;
        }
        const row = World.row(chr.row);
        if (row && row.holes && row.holes.has(chr.col)) {
          if (Sprites.ANIMALS[selected].id === 'bunny' && specialCd <= 0) {
            // teeter on the rim — a QUICK double jump can still save her!
            chr.teeter = 0.15;
            chr.queued = null;
            Sfx.bump();
          } else {
            die('hole');
          }
          return;
        }
        if (row && row.type === 'river' && !row.pads.has(chr.col) && !logUnder(row, chr.col + 0.5)) {
          die('water'); // no log or lily pad here — straight into the drink
          return;
        }
        if (row && row.coins && row.coins.has(chr.col)) {
          row.coins.delete(chr.col);
          runCoins++;
          ui.coins.textContent = runCoins;
          R3D.fx.coinBurst(chr.col + 0.5, chr.row);
          Sfx.coin();
        }
        if (chr.queued) {
          const q = chr.queued;
          chr.queued = null;
          doMove(q[0], q[1]);
        }
      }
    }
    if (chr.hopping) {
      const k = Math.min(chr.hopT, 1);
      chr.rowF = chr.fromR + (chr.toR - chr.fromR) * k;
      chr.colF = chr.fromC + (chr.toC - chr.fromC) * k;
    } else {
      chr.rowF = chr.row;
      chr.colF = chr.col + chr.drift;
      chr.lean *= Math.max(0, 1 - dt * 10);
    }
  }

  // while grounded on a river row, ride whatever log is underfoot (or drown
  // if it drifted out from under you); lily pads are fixed, so they're a no-op
  function updateRiver(dt) {
    if (chr.hopping || chr.dead) return;
    const row = World.row(chr.row);
    if (!row || row.type !== 'river') { chr.drift = 0; return; }
    if (row.pads.has(chr.col)) { chr.drift = 0; return; }
    const pos = chr.col + chr.drift;
    if (!logUnder(row, pos + 0.5)) { die('water'); return; }
    chr.drift += row.dir * row.speed * dt;
    const np = chr.col + chr.drift;
    if (np < -0.5 || np > COLS - 0.5) die('water'); // carried off the edge of the river
  }

  // ---------- game flow ----------
  function drainWorldEvents() {
    for (const ev of World.drainEvents()) {
      if (ev.type === 'treefall') {
        R3D.fx.treefall(ev.c + 0.5, ev.r, Math.random() < 0.5 ? 1 : -1);
        Sfx.crunch();
      } else if (ev.type === 'tractor') {
        Sfx.tractor();
      } else if (ev.type === 'gallop') {
        if (state === 'play' && Math.abs(ev.r - chr.rowF) < 9) Sfx.gallop();
      }
    }
  }

  function updatePlanes(dt) {
    for (const p of planes) p.x += p.dir * p.speed * dt;
    for (let i = planes.length - 1; i >= 0; i--) {
      const p = planes[i];
      if ((p.dir > 0 && p.x > COLS + 4) || (p.dir < 0 && p.x < -4)) {
        planes.splice(i, 1);
        trails.push({ row: p.row, age: 0 });
      }
    }
    for (const l of trails) l.age += dt;
    trails = trails.filter(l => l.age < TRAIL_LIFE);
  }

  function spawnPlane() {
    // prefer rows whose sky is clear — a lingering contrail means "just passed"
    for (let tries = 0; tries < 6; tries++) {
      const r = Math.ceil(cam) + 3 + irand(9);
      if (!World.row(r)) continue;
      if (planes.some(p => p.row === r) || trails.some(l => l.row === r)) continue;
      const dir = Math.random() < 0.5 ? 1 : -1;
      planes.push({ row: r, dir, x: dir > 0 ? -3.5 : COLS + 3.5, speed: 6.5 + Math.random() * 2.5 });
      Sfx.plane();
      return;
    }
  }

  function updateRockets(dt) {
    const top = Math.floor(cam) + 16;
    for (let r = Math.max(0, Math.floor(cam) - 1); r <= top; r++) {
      const row = World.row(r);
      if (!row || !row.rocket) continue;
      const rk = row.rocket;
      if (rk.phase === 'idle') {
        // fuse lights when the player gets close
        const d = r - chr.rowF;
        if (state === 'play' && graceT > 2 && d > -1 && d < 5.5) {
          rk.phase = 'arm';
          rk.t = 0;
          Sfx.rumble();
        }
      } else if (rk.phase === 'arm') {
        rk.t += dt;
        if (Math.random() < dt * 14) {
          R3D.fx.poof(rk.c + 0.5 + (Math.random() - 0.5) * 0.41, r, 0, 0.4);
        }
        if (rk.t > 1.6) { rk.phase = 'fly'; rk.t = 0; Sfx.launch(); }
      } else if (rk.phase === 'fly') {
        rk.t += dt;
        if (rk.t > 1.6) rk.phase = 'gone';
      }
    }
  }

  function updatePlay(dt) {
    updateChar(dt);
    if (state !== 'play') return; // a hole death can end the run mid-hop
    updateRiver(dt);
    if (state !== 'play') return; // ...and so can a river current
    if (chr.teeter != null && !chr.hopping) {
      chr.teeter -= dt;
      if (chr.teeter <= 0) {
        chr.teeter = null;
        die('hole');
        return;
      }
    }
    if (specialCd > 0) specialCd = Math.max(0, specialCd - dt);
    // dashing dog kicks up a dust trail
    if (chr.air && chr.hopping && Sprites.ANIMALS[selected].id === 'dog' && Math.random() < dt * 40) {
      R3D.fx.poof(chr.colF + 0.5 + (Math.random() - 0.5) * 0.31, chr.rowF, 0, 0.35);
    }
    graceT += dt;
    if (graceT > 3) cam += Math.min(0.32 + score * 0.005, 0.95) * dt;
    const tgt = chr.rowF - 4.5;
    if (tgt > cam) cam += (tgt - cam) * Math.min(1, dt * 4);
    World.update(dt, cam);
    updateParticles(dt);

    // rockets: the exhaust blast fries anything close by at liftoff
    updateRockets(dt);
    for (const r of [Math.floor(chr.rowF), Math.floor(chr.rowF) + 1]) {
      const row = World.row(r);
      if (!row || !row.rocket) continue;
      const rk = row.rocket;
      if (rk.phase === 'fly' && rk.t < 0.45 &&
          Math.abs(chr.rowF - r) < 0.6 && Math.abs(chr.colF - rk.c) < 1.55) {
        return die('rocket');
      }
    }

    // airplanes
    updatePlanes(dt);
    if (graceT > 4) {
      planeTimer -= dt;
      if (planeTimer <= 0) {
        spawnPlane();
        planeTimer = Math.max(3.5, 6 + Math.random() * 6 - score * 0.03);
      }
    }
    for (const p of planes) {
      if (Math.abs(chr.rowF - p.row) < 0.45 && Math.abs(p.x - (chr.colF + 0.5)) < 1.05) return die('plane');
    }

    // the eagle circles when you dawdle, then dives in fast to grab you —
    // move before it lands the grab and it flies off empty-taloned instead
    idleT += dt;
    if (eagleState === 'none') {
      if (idleT > 3.2) { eagleState = 'active'; eagleT = 0; Sfx.screech(); }
    } else if (eagleState === 'active') {
      eagleT += dt;
      if (idleT > 5) return die('eagle');
    } else if (eagleState === 'flee') {
      eagleT += dt;
      if (eagleT > 0.8) { eagleState = 'none'; eagleT = 0; }
    }

    drainWorldEvents();

    // moving hazard collision (checked against the hop-interpolated position);
    // special moves are airborne mid-flight and pass safely over ground hazards
    const airSafe = chr.air && chr.hopping && chr.hopT > 0.06 && chr.hopT < 0.94;
    if (!airSafe) {
      const cx = chr.colF + 0.5;
      for (const r of [Math.floor(chr.rowF), Math.floor(chr.rowF) + 1]) {
        if (Math.abs(chr.rowF - r) > 0.45) continue;
        const row = World.row(r);
        if (!row) continue;
        const traffic = row.type === 'rainbow' ? [row.clouds, 'cloud']
                      : row.type === 'road' ? [row.cars, 'car']
                      : row.type === 'deer' ? [row.deer, 'deer'] : null;
        if (!traffic) continue;
        for (const c of traffic[0]) {
          const wx = c.x - World.PAD;
          if (Math.abs(wx - cx) < ((c.w || 0.8) / 2 + 0.3) * 0.9) return die(traffic[1]);
        }
      }
      for (const tt of World.tractors()) {
        if (Math.abs(chr.rowF - tt.row) < 0.5 && Math.abs(tt.x - cx) < 1.05) return die('tractor');
      }
    }

    // a polite warning honk when a car is bearing down on you
    if (honkCd > 0) honkCd -= dt;
    else {
      const rr = World.row(Math.round(chr.rowF));
      if (rr && rr.type === 'road') {
        for (const c of rr.cars) {
          const gap = (c.x - World.PAD - (chr.colF + 0.5)) * (rr.dir > 0 ? -1 : 1);
          if (gap > 0.8 && gap < 3) { Sfx.honk(); honkCd = 2.5; break; }
        }
      }
    }

    if (chr.rowF - cam < -0.85) return die('swept');
  }

  function die(cause) {
    if (state !== 'play') return;
    state = 'dying';
    deathCause = cause;
    chr.dead = true;
    chr.hopping = false;
    chr.queued = null;
    dieT = 0;
    if (cause === 'cloud') {
      shake = 0.3;
      R3D.fx.rainBurst(chr.colF + 0.5, chr.rowF);
      Sfx.splash();
    } else if (cause === 'plane' || cause === 'tractor') {
      shake = 0.3;
      Sfx.crash();
    } else if (cause === 'car') {
      shake = 0.3;
      Sfx.honk();
      Sfx.crash();
    } else if (cause === 'deer') {
      shake = 0.25;
      Sfx.gallop();
      Sfx.bump();
    } else if (cause === 'hole') {
      R3D.fx.poof(chr.colF + 0.5, chr.rowF, 0, 0.35);
      Sfx.fall();
    } else if (cause === 'water') {
      shake = 0.2;
      R3D.fx.rainBurst(chr.colF + 0.5, chr.rowF);
      Sfx.splash();
    } else if (cause === 'eagle') {
      Sfx.screech();
    } else if (cause === 'rocket') {
      shake = 0.35;
      R3D.fx.rainBurst(chr.colF + 0.5, chr.rowF);
      Sfx.crash();
    }
  }

  function updateDying(dt) {
    dieT += dt;
    if (shake > 0) shake = Math.max(0, shake - dt);
    World.update(dt, cam);
    updatePlanes(dt);
    updateRockets(dt);
    updateParticles(dt);
    drainWorldEvents();
    if (dieT > (deathCause === 'eagle' ? 1.4 : 0.95)) finishGameOver();
  }

  function finishGameOver() {
    if (state !== 'dying') return;
    state = 'over';
    const isBest = score > best && score > 0;
    if (isBest) { best = score; store.set('hs_best', best); }
    totalCoins += runCoins;
    store.set('hs_coins', totalCoins);
    const OVER = {
      cloud: ['Splash! \u{1F4A6}', 'A grumpy rain cloud soaked you!'],
      swept: ['Oh no! \u{1F327}\u{FE0F}', 'The storm caught up with you!'],
      hole:  ['Whoops! \u{1F573}\u{FE0F}', 'You fell down a hole!'],
      water: ['Sunk! \u{1F30A}', 'You slipped into the river with no log to ride!'],
      plane: ['Bonk! \u{2708}\u{FE0F}', 'An airplane zoomed right into you!'],
      eagle: ['Snatched! \u{1F985}', 'An eagle grabbed you for standing still too long!'],
      rocket: ['Blast off! \u{1F680}', 'You got caught in a spaceship launch!'],
      car: ['Honk! \u{1F697}', 'A speedy car bumped right into you!'],
      deer: ['Oof! \u{1F98C}', 'A bounding deer bowled you over!'],
      tractor: ['Squish! \u{1F69C}', 'A tractor rolled right over you!'],
    };
    const info = OVER[deathCause] || OVER.swept;
    ui.goTitle.textContent = info[0];
    ui.goReason.textContent = info[1];
    ui.goScore.textContent = score;
    show(ui.goBadge, isBest);
    ui.goBest.textContent = best;
    ui.goCoins.textContent = runCoins;
    show(ui.over, true);
    Sfx.over();
    if (isBest) Sfx.best();
  }

  function startGame() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    resetRun();
    state = 'play';
    paused = false;
    show(ui.menu, false);
    show(ui.over, false);
    show(ui.paused, false);
    show(ui.hud, true);
    Sfx.start();
  }

  function toMenu() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    state = 'menu';
    paused = false;
    World.reset();
    planes = []; trails = [];
    menuCam = -4;
    ui.menuBest.textContent = best;
    ui.menuCoins.textContent = totalCoins;
    show(ui.menu, true);
    show(ui.over, false);
    show(ui.paused, false);
    show(ui.hud, false);
  }

  function togglePause(v) {
    if (state !== 'play') return;
    paused = v == null ? !paused : v;
    show(ui.paused, paused);
  }

  // ---------- rendering ----------
  // ONE module-level frame object, mutated every tick — CONTRACT.md §4. The
  // renderer reads world data itself (World.row / World.tractors); this frame
  // carries game state + the FINISHED character pose (verbatim drawChar math).
  const FRAME = { chr: {}, eagle: {} };

  function drawWorld(camY) {
    FRAME.mode = state;
    FRAME.paused = paused;
    FRAME.t = tGlobal;
    FRAME.camY = camY;
    FRAME.shake = shake;
    FRAME.best = best;
    FRAME.score = score;
    FRAME.selected = selected;
    FRAME.camMode = camMode;
    FRAME.peek = (peekR ? 1 : 0) - (peekL ? 1 : 0);
    FRAME.graceT = graceT;
    FRAME.planes = planes;
    FRAME.trails = trails;
    FRAME.eagle.state = eagleState;
    FRAME.eagle.t = eagleT;
    FRAME.eagle.fleeDir = eagleFleeDir;
    const C = FRAME.chr;
    C.id = Sprites.ANIMALS[selected].id;
    C.colF = chr.colF;
    C.rowF = chr.rowF;
    // pose math verbatim from the retired drawChar (px; renderer divides by 64)
    const k = Math.min(chr.hopT, 1);
    let z = chr.hopping ? chr.z0 * (1 - k) + Math.sin(Math.PI * k) * chr.hopH : 0;
    if (chr.teeter != null && !chr.hopping) z = -6; // sinking into the hole rim!
    if (chr.dead && deathCause === 'eagle') z += Math.max(0, dieT - 0.4) * 300; // carried away
    C.z = z;
    let squash = 1;
    if (chr.hopping) squash = 1.06;
    else if (chr.squashT < 0.1) squash = 1 - 0.2 * Math.sin(Math.PI * chr.squashT / 0.1);
    C.squash = squash;
    C.shrink = chr.dead && (deathCause === 'hole' || deathCause === 'water') ? Math.max(0, 1 - dieT * 1.5) : 1;
    C.flip = chr.flip;
    C.lean = chr.hopping ? chr.lean * 0.6 : 0;
    C.air = chr.air && chr.hopping;
    C.dead = chr.dead && ['cloud', 'plane', 'car', 'deer', 'tractor'].includes(deathCause);
    C.teeter = chr.teeter;
    C.bump = chr.bump;
    C.deathCause = chr.dead ? deathCause : '';
    C.dieT = dieT;
    R3D.render(FRAME);
  }

  // ---------- character select cards ----------
  const cardCanvases = [];
  function buildCards() {
    Sprites.ANIMALS.forEach((a, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      const cv = document.createElement('canvas');
      cv.width = 192;
      cv.height = 208;
      card.appendChild(cv);
      const nm = document.createElement('div');
      nm.className = 'cname';
      nm.textContent = a.name;
      const kd = document.createElement('div');
      kd.className = 'ckind';
      kd.textContent = a.kind;
      card.appendChild(nm);
      card.appendChild(kd);
      card.addEventListener('click', () => {
        Sfx.unlock();
        selectChar(i);
        Sfx.select();
      });
      ui.cards.appendChild(card);
      cardCanvases.push({ cv, c2: cv.getContext('2d'), card });
    });
    selectChar(selected);
  }
  function selectChar(i) {
    selected = ((i % 4) + 4) % 4;
    store.set('hs_char', selected);
    cardCanvases.forEach((c, j) => c.card.classList.toggle('selected', j === selected));
    $('ability-line').textContent = ABILITY[Sprites.ANIMALS[selected].id].desc;
  }
  function drawCards() { R3D.animals.drawCards(cardCanvases, tGlobal, selected); }

  // ---------- input ----------
  const KEYS = {
    ArrowUp: [1, 0], w: [1, 0], W: [1, 0],
    ArrowDown: [-1, 0], s: [-1, 0], S: [-1, 0],
    ArrowLeft: [0, -1], a: [0, -1], A: [0, -1],
    ArrowRight: [0, 1], d: [0, 1], D: [0, 1],
  };
  window.addEventListener('keydown', e => {
    if (KEYS[e.key] || e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
    if (e.repeat) return;
    Sfx.unlock();
    if (state === 'menu') {
      if (e.key === 'ArrowLeft' || e.key === 'a') { selectChar(selected - 1); Sfx.select(); }
      else if (e.key === 'ArrowRight' || e.key === 'd') { selectChar(selected + 1); Sfx.select(); }
      else if (e.key === 'Enter' || e.key === ' ') startGame();
    } else if (state === 'play') {
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') togglePause();
      else if (!paused && (e.key === ' ' || e.key === 'Shift')) useSpecial();
      else if (!paused && (e.key === 'q' || e.key === 'Q')) peekL = true;
      else if (!paused && (e.key === 'e' || e.key === 'E')) peekR = true;
      else if (!paused && KEYS[e.key]) tryMove(KEYS[e.key][0], KEYS[e.key][1]);
    } else if (state === 'over') {
      if (e.key === 'Enter' || e.key === ' ') startGame();
      else if (e.key === 'Escape') toMenu();
    }
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'q' || e.key === 'Q') peekL = false;
    else if (e.key === 'e' || e.key === 'E') peekR = false;
  });

  let touchStart = null;
  canvas.addEventListener('touchstart', e => {
    Sfx.unlock();
    if (state !== 'play') return;
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', e => {
    if (state !== 'play' || !touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.hypot(dx, dy) < 22) tryMove(1, 0);
    else if (Math.abs(dx) > Math.abs(dy)) tryMove(0, dx > 0 ? 1 : -1);
    else tryMove(dy < 0 ? 1 : -1, 0);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('click', () => {
    Sfx.unlock();
    if (state === 'play' && !paused) tryMove(1, 0);
  });

  // special ability button (shows the ability emoji, or seconds left while recharging)
  const btnSpecial = $('btn-special');
  btnSpecial.addEventListener('click', () => { Sfx.unlock(); useSpecial(); btnSpecial.blur(); });
  function refreshSpecialBtn() {
    if (specialCd > 0) {
      const s = String(Math.ceil(specialCd));
      if (btnSpecial.textContent !== s) btnSpecial.textContent = s;
      btnSpecial.classList.add('cooling');
    } else {
      const em = ABILITY[Sprites.ANIMALS[selected].id].emoji;
      if (btnSpecial.textContent !== em) btnSpecial.textContent = em;
      btnSpecial.classList.remove('cooling');
    }
  }

  // buttons
  const btnCamera = $('btn-camera');
  const CAM_CYCLE = ['classic', 'tp', 'fp'];
  const CAM_LABEL = { classic: '🎥 Camera: Classic', tp: '🎬 Camera: Third-Person', fp: '👁 Camera: First-Person' };
  function refreshCameraBtn() {
    btnCamera.textContent = CAM_LABEL[camMode] || CAM_LABEL.classic;
  }
  btnCamera.addEventListener('click', () => {
    Sfx.unlock();
    camMode = CAM_CYCLE[(CAM_CYCLE.indexOf(camMode) + 1) % CAM_CYCLE.length];
    store.set('hs_cam', camMode);
    refreshCameraBtn();
    Sfx.select();
    btnCamera.blur();
  });
  refreshCameraBtn();

  $('btn-play').addEventListener('click', () => { Sfx.unlock(); startGame(); });
  $('btn-retry').addEventListener('click', () => { Sfx.unlock(); startGame(); });
  $('btn-menu').addEventListener('click', toMenu);
  $('btn-resume').addEventListener('click', () => togglePause(false));
  $('btn-quit').addEventListener('click', toMenu);
  $('btn-pause').addEventListener('click', () => togglePause());
  function refreshMuteBtns() {
    const g = Sfx.isMuted() ? '\u{1F507}' : '\u{1F50A}';
    $('btn-mute').textContent = g;
    $('btn-mute-menu').textContent = g;
  }
  ['btn-mute', 'btn-mute-menu'].forEach(id => {
    $(id).addEventListener('click', () => { Sfx.unlock(); Sfx.toggleMute(); refreshMuteBtns(); });
  });
  refreshMuteBtns();
  window.addEventListener('blur', () => {
    peekL = peekR = false; // a missed keyup while unfocused must not stick the peek
    if (state === 'play') togglePause(true);
  });

  // ---------- main loop ----------
  buildCards();
  toMenu();
  let last = performance.now();
  function frame(now) {
    let dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (document.hidden) dt = 0;
    FRAME.dt = dt;
    tGlobal += dt;
    if (state === 'play' && !paused) updatePlay(dt);
    else if (state === 'dying') updateDying(dt);
    else if (state === 'menu') {
      menuCam += dt * 0.45;
      World.update(dt, menuCam);
      updateParticles(dt);
      drainWorldEvents();
    }
    drawWorld(state === 'menu' ? menuCam : cam);
    if (state === 'menu') drawCards();
    else refreshSpecialBtn();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
