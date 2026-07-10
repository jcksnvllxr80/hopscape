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
  const ctx = canvas.getContext('2d');
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
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
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
  let best = store.get('hs_best', 0);
  let totalCoins = store.get('hs_coins', 0);
  let specialCd = 0;
  // obstacles: airplanes (+ lingering contrails) and the idle-punishing eagle
  const TRAIL_LIFE = 8;
  let planes = [], trails = [], planeTimer = 6, idleT = 0, eagleWarned = false;
  const irand = n => Math.floor(Math.random() * n);

  let cam = -4, menuCam = -4, graceT = 0, score = 0, runCoins = 0;
  let dieT = 0, deathCause = '', shake = 0;
  let particles = [];

  const chr = {};
  function resetChr() {
    Object.assign(chr, {
      row: 2, col: 5, fromR: 2, fromC: 5, toR: 2, toC: 5,
      rowF: 2, colF: 5, hopping: false, hopT: 0, squashT: 9,
      hopDur: 0.115, hopH: 22, air: false, z0: 0, lastDr: 1, lastDc: 0, teeter: null,
      flip: false, lean: 0, queued: null, bump: null, dead: false,
    });
  }

  function resetRun() {
    World.reset();
    resetChr();
    cam = chr.row - 6;
    graceT = 0; score = 0; runCoins = 0; dieT = 0; shake = 0;
    specialCd = 0;
    planes = []; trails = []; planeTimer = 5 + Math.random() * 4;
    idleT = 0; eagleWarned = false;
    particles = [];
    ui.score.textContent = '0';
    ui.coins.textContent = '0';
  }

  function baseHopDur() {
    const id = Sprites.ANIMALS[selected].id;
    if (id === 'dog') return 0.092;   // speedy paws
    if (id === 'bunny') return 0.15;  // floaty hops = a bigger double-jump window
    return 0.115;
  }

  // ---------- particles (world-anchored so they scroll with the camera) ----------
  function camBase(c) { return H + c * T; }
  function spawnP(kind, sx, sy, o) {
    particles.push(Object.assign({ kind, x: sx, wy: camBase(cam) - sy, t: 0, vx: 0, vy: 0 }, o));
  }
  function coinBurst(sx, sy) {
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      spawnP('spark', sx, sy, { vx: Math.cos(a) * 90, vy: -60 - Math.random() * 90, life: 0.5 });
    }
    spawnP('txt', sx, sy - 14, { life: 0.8, text: '+1' });
  }
  function rainBurst(sx, sy) {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      spawnP('drop', sx, sy - 15, { vx: Math.cos(a) * (60 + Math.random() * 120), vy: -80 - Math.random() * 140, life: 0.7 });
    }
  }
  function updateParticles(dt) {
    for (const p of particles) {
      p.t += dt;
      if (p.kind === 'spark' || p.kind === 'drop') {
        p.vy += 500 * dt;
        p.x += p.vx * dt;
        p.wy -= p.vy * dt;
      } else if (p.kind === 'txt') {
        p.wy += 46 * dt;
      } else if (p.kind === 'poof') {
        p.wy += 12 * dt;
      }
    }
    particles = particles.filter(p => p.t < p.life);
  }
  function drawParticles(camY) {
    for (const p of particles) {
      const sy = camBase(camY) - p.wy;
      const k = 1 - p.t / p.life;
      if (p.kind === 'spark') {
        ctx.fillStyle = 'rgba(255,210,62,' + (0.9 * k) + ')';
        ctx.beginPath(); ctx.arc(p.x, sy, 3.2, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'drop') {
        ctx.fillStyle = 'rgba(96,170,255,' + (0.9 * k) + ')';
        ctx.beginPath(); ctx.arc(p.x, sy, 3, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'poof') {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.4 * k) + ')';
        ctx.beginPath(); ctx.arc(p.x, sy, 5 + (1 - k) * 9, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'txt') {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.font = '800 20px "Arial Rounded MT Bold", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#b57e0a';
        ctx.strokeText(p.text, p.x, sy);
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText(p.text, p.x, sy);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }
    }
  }

  // ---------- movement ----------
  function tryMove(dr, dc) {
    if (state !== 'play' || paused) return;
    if (chr.hopping) { chr.queued = [dr, dc]; return; }
    doMove(dr, dc);
  }
  function doMove(dr, dc) {
    if (chr.teeter != null) return; // teetering over a hole — only a double jump saves you
    if (dc !== 0) chr.flip = dc < 0;
    const tr = chr.row + dr, tc = chr.col + dc;
    const minRow = Math.max(0, Math.ceil(cam - 0.2));
    if (tc < 0 || tc >= COLS || tr < minRow) return bumped();
    const row = World.row(tr);
    if (row && row.trees && row.trees.has(tc)) return bumped();
    if (row && row.rocket && row.rocket.c === tc && (row.rocket.phase === 'idle' || row.rocket.phase === 'arm')) return bumped();
    chr.fromR = chr.row; chr.fromC = chr.col;
    chr.toR = tr; chr.toC = tc;
    chr.hopping = true;
    chr.hopT = 0;
    chr.hopDur = baseHopDur();
    chr.hopH = Sprites.ANIMALS[selected].id === 'bunny' ? 27 : 22;
    chr.air = false;
    chr.z0 = 0;
    chr.lean = dc;
    idleT = 0; eagleWarned = false;
    spawnP('poof', (chr.col + 0.5) * T, rowFeetY(chr.row, cam), { life: 0.3 });
    Sfx.hop();
    function bumped() { chr.bump = { dr, dc, t: 0 }; Sfx.bump(); }
  }

  function useSpecial() {
    if (state !== 'play' || paused || chr.dead || specialCd > 0) return;
    const id = Sprites.ANIMALS[selected].id;
    if (id === 'bunny') return doubleJump();
    if (chr.hopping) return; // everyone else launches from the ground
    idleT = 0; eagleWarned = false;
    if (id === 'dog') {
      // ground dash: sprint up to 3 rows ahead — leaps clean over holes,
      // but skids to a stop before solid obstacles (trees, rockets)
      let tr = chr.row;
      for (let i = 1; i <= 3; i++) {
        const row = World.row(chr.row + i);
        if (row && ((row.trees && row.trees.has(chr.col)) ||
            (row.rocket && row.rocket.c === chr.col && row.rocket.phase !== 'gone'))) break;
        if (!(row && row.holes && row.holes.has(chr.col))) tr = chr.row + i; // never stop IN a hole
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
        if (row && ((row.trees && row.trees.has(chr.col)) || (row.holes && row.holes.has(chr.col)) ||
            (row.rocket && row.rocket.c === chr.col && row.rocket.phase !== 'gone'))) tr--;
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
    chr.fromR = chr.row; chr.fromC = chr.col;
    chr.toR = chr.row + dr; chr.toC = chr.col;
    chr.hopping = true;
    chr.hopT = 0;
    chr.air = true;
    chr.hopDur = dur;
    chr.hopH = h;
    chr.z0 = 0;
    chr.lean = 0;
    spawnP('poof', (chr.col + 0.5) * T, rowFeetY(chr.row, cam), { life: 0.3 });
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
    const baseC = midair ? chr.toC : chr.col;
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
    chr.hopping = true;
    chr.hopT = 0;
    chr.hopDur = 0.17;
    chr.hopH = 30;
    chr.z0 = z0;
    chr.air = true; // the second jump is special — clouds can't touch it
    chr.teeter = null; // saved from the hole!
    if (dc !== 0) chr.flip = dc < 0;
    idleT = 0; eagleWarned = false;
    specialCd = ABILITY.bunny.cd;
    spawnP('poof', (chr.colF + 0.5) * T, rowFeetY(chr.rowF, cam) - z0, { life: 0.3 });
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
        if (row && row.coins && row.coins.has(chr.col)) {
          row.coins.delete(chr.col);
          runCoins++;
          ui.coins.textContent = runCoins;
          coinBurst((chr.col + 0.5) * T, rowFeetY(chr.row, cam) - 20);
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
      chr.colF = chr.col;
      chr.lean *= Math.max(0, 1 - dt * 10);
    }
  }

  // ---------- game flow ----------
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
          spawnP('poof', (rk.c + 0.5) * T + (Math.random() - 0.5) * 26, rowFeetY(r, cam) + 4, { life: 0.4 });
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
      spawnP('poof', (chr.colF + 0.5) * T + (Math.random() - 0.5) * 20, rowFeetY(chr.rowF, cam) + 2, { life: 0.35 });
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

    // the eagle circles when you dawdle, then strikes
    idleT += dt;
    if (idleT > 4.5 && !eagleWarned) { eagleWarned = true; Sfx.screech(); }
    if (idleT > 7.5) return die('eagle');

    // rain cloud collision (checked against the hop-interpolated position);
    // special moves are airborne mid-flight and pass safely over clouds
    const airSafe = chr.air && chr.hopping && chr.hopT > 0.06 && chr.hopT < 0.94;
    if (!airSafe) {
      const cx = chr.colF + 0.5;
      for (const r of [Math.floor(chr.rowF), Math.floor(chr.rowF) + 1]) {
        if (Math.abs(chr.rowF - r) > 0.45) continue;
        const row = World.row(r);
        if (!row || row.type !== 'rainbow') continue;
        for (const c of row.clouds) {
          const wx = c.x - World.PAD;
          if (Math.abs(wx - cx) < (c.w / 2 + 0.3) * 0.9) return die('cloud');
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
      rainBurst((chr.colF + 0.5) * T, rowFeetY(chr.rowF, cam));
      Sfx.splash();
    } else if (cause === 'plane') {
      shake = 0.3;
      Sfx.crash();
    } else if (cause === 'hole') {
      spawnP('poof', (chr.colF + 0.5) * T, rowFeetY(chr.rowF, cam), { life: 0.35 });
      Sfx.fall();
    } else if (cause === 'eagle') {
      Sfx.screech();
    } else if (cause === 'rocket') {
      shake = 0.35;
      rainBurst((chr.colF + 0.5) * T, rowFeetY(chr.rowF, cam));
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
      plane: ['Bonk! \u{2708}\u{FE0F}', 'An airplane zoomed right into you!'],
      eagle: ['Snatched! \u{1F985}', 'An eagle grabbed you for standing still too long!'],
      rocket: ['Blast off! \u{1F680}', 'You got caught in a spaceship launch!'],
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
  function rowFeetY(rf, camY) {
    return H - (rf - camY + 1) * T + T * 0.74;
  }

  function drawWorld(camY) {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 9 * (shake / 0.3), (Math.random() - 0.5) * 9 * (shake / 0.3));
    const rBot = Math.floor(camY);
    const rTop = Math.floor(camY + H / T) + 1;

    // ground
    for (let r = rBot; r <= rTop; r++) {
      const y = H - (r - camY + 1) * T;
      const row = World.row(r);
      if (row && row.type === 'rainbow') Sprites.rainbowRow(ctx, y, row);
      else Sprites.grassRow(ctx, y, r, row);
    }

    // best-score marker line
    if (best >= 3) {
      const by = H - (best + 2 - camY + 1) * T;
      if (by > -40 && by < H + 40) Sprites.bestLine(ctx, by, best);
    }

    // objects, far rows first so near things overlap them
    const charRow = Math.floor(chr.rowF);
    for (let r = rTop; r >= rBot; r--) {
      const row = World.row(r);
      const y = H - (r - camY + 1) * T;
      if (row) {
        if (row.type === 'grass') {
          if (row.coins) for (const c of row.coins) Sprites.coin(ctx, (c + 0.5) * T, y + T * 0.52, tGlobal, c);
          if (row.rocket) {
            const rk = row.rocket;
            const rx = (rk.c + 0.5) * T, ry = y + T * 0.82;
            if (rk.phase === 'idle' || rk.phase === 'arm') Sprites.rocket(ctx, rx, ry, rk, tGlobal);
            else Sprites.scorch(ctx, rx, ry);
          }
          if (row.trees) for (const c of row.trees) Sprites.tree(ctx, (c + 0.5) * T, y + T * 0.82, r * 31 + c * 7);
        } else {
          for (const c of row.clouds) {
            const cx = (c.x - World.PAD) * T;
            Sprites.cloudShadow(ctx, cx, y + T * 0.78, c.w);
            Sprites.cloud(ctx, cx, y + T * 0.42, c.w, tGlobal, c.seed, row.dir);
          }
        }
      }
      if (r === charRow && state !== 'menu') drawChar(camY);
    }

    drawParticles(camY);

    // ---- sky layer: launching rockets, contrails, airplanes, warnings, circling eagle ----
    for (let r = rBot; r <= rTop; r++) {
      const row = World.row(r);
      if (row && row.rocket && row.rocket.phase === 'fly') {
        const y = H - (r - camY + 1) * T;
        Sprites.rocket(ctx, (row.rocket.c + 0.5) * T, y + T * 0.82, row.rocket, tGlobal);
      }
    }
    const skyY = r => H - (r - camY + 1) * T + T * 0.38;
    for (const l of trails) {
      const y = skyY(l.row);
      if (y < -30 || y > H + 30) continue;
      const a = (1 - l.age / TRAIL_LIFE) * 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,' + a + ')';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-10, y);
      ctx.lineTo(W + 10, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,' + a * 0.7 + ')';
      for (let px = 20; px < W; px += 56) {
        ctx.beginPath();
        ctx.arc(px + (l.row * 37 % 30), y, 6 + (px * 13 + l.row * 7) % 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const p of planes) {
      const y = skyY(p.row);
      if (y < -40 || y > H + 40) continue;
      const px = p.x * T;
      // contrail streaming back to the edge it came from
      const tail = px - p.dir * 42;
      const edge = p.dir > 0 ? -20 : W + 20;
      const g = ctx.createLinearGradient(edge, 0, tail, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.1)');
      g.addColorStop(1, 'rgba(255,255,255,0.75)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(edge, y);
      ctx.lineTo(tail, y);
      ctx.stroke();
      if (px > -60 && px < W + 60) {
        ctx.fillStyle = 'rgba(20,30,50,0.15)';
        ctx.beginPath();
        ctx.ellipse(px, y + T * 0.5, 30, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        Sprites.plane(ctx, px, y, p.dir, tGlobal);
      } else {
        // incoming! flashing warning at the edge it will enter from
        if (Math.sin(tGlobal * 12) > -0.3) {
          const wx = p.dir > 0 ? 22 : W - 22;
          ctx.fillStyle = '#ff5a5f';
          ctx.beginPath();
          ctx.arc(wx, y, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = '900 18px "Arial Rounded MT Bold", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('!', wx, y + 6);
          ctx.textAlign = 'left';
        }
      }
    }
    if (state === 'play' && idleT > 4.5) {
      // eagle circling overhead — move or else!
      const px = (chr.colF + 0.5) * T;
      const py = rowFeetY(chr.rowF, cam);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.1 + 0.08 * Math.sin(tGlobal * 8)) + ')';
      ctx.beginPath();
      ctx.ellipse(px, py, 26 + Math.sin(tGlobal * 8) * 4, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      Sprites.eagle(ctx, px + Math.sin(tGlobal * 2.6) * 46, py - 165 - Math.sin(tGlobal * 5) * 9, tGlobal, false);
    }

    // soft edge vignette
    let g = ctx.createLinearGradient(0, 0, 60, 0);
    g.addColorStop(0, 'rgba(20,45,20,0.18)');
    g.addColorStop(1, 'rgba(20,45,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 60, H);
    g = ctx.createLinearGradient(W, 0, W - 60, 0);
    g.addColorStop(0, 'rgba(20,45,20,0.18)');
    g.addColorStop(1, 'rgba(20,45,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(W - 60, 0, 60, H);

    // danger glow when the storm is close behind
    if (state === 'play') {
      const dz = chr.rowF - camY;
      if (dz < 2.2) {
        const a = Math.min(1, (2.2 - dz) / 2.2) * (0.28 + 0.12 * Math.sin(tGlobal * 7));
        const dg = ctx.createLinearGradient(0, H, 0, H - 150);
        dg.addColorStop(0, 'rgba(255,60,60,' + a + ')');
        dg.addColorStop(1, 'rgba(255,60,60,0)');
        ctx.fillStyle = dg;
        ctx.fillRect(0, H - 150, W, 150);
      }
    }
    ctx.restore();
  }

  function drawChar(camY) {
    const x = (chr.colF + 0.5) * T;
    const y = rowFeetY(chr.rowF, camY);
    let bx = 0, by = 0;
    if (chr.bump) {
      const k = Math.sin(Math.PI * chr.bump.t / 0.13) * 7;
      bx = chr.bump.dc * k;
      by = -chr.bump.dr * k;
    }
    const k = Math.min(chr.hopT, 1);
    let z = chr.hopping ? chr.z0 * (1 - k) + Math.sin(Math.PI * k) * chr.hopH : 0;
    if (chr.teeter != null && !chr.hopping) z = -6; // sinking into the hole rim!
    let squash = 1;
    if (chr.hopping) squash = 1.06;
    else if (chr.squashT < 0.1) squash = 1 - 0.2 * Math.sin(Math.PI * chr.squashT / 0.1);
    let shrink = null;
    if (chr.dead && deathCause === 'hole') shrink = Math.max(0, 1 - dieT * 1.5);
    if (chr.dead && deathCause === 'eagle') z += Math.max(0, dieT - 0.4) * 300; // carried away
    Sprites.animal(ctx, Sprites.ANIMALS[selected].id, x + bx, y + by, {
      t: tGlobal, z, squash, shrink,
      flip: chr.flip,
      lean: chr.hopping ? chr.lean * 0.6 : 0,
      air: chr.air && chr.hopping,
      dead: chr.dead && (deathCause === 'cloud' || deathCause === 'plane'),
      seed: 1.7,
    });
    if (chr.dead && deathCause === 'eagle') {
      const dive = Math.min(dieT / 0.4, 1);
      const ey = y - z - 52 - (1 - dive) * 480;
      Sprites.eagle(ctx, x, ey, tGlobal, true);
    }
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
  function drawCards() {
    Sprites.ANIMALS.forEach((a, i) => {
      const { c2 } = cardCanvases[i];
      c2.setTransform(2, 0, 0, 2, 0, 0);
      c2.clearRect(0, 0, 96, 104);
      const sel = i === selected;
      const bounce = sel ? Math.abs(Math.sin(tGlobal * 3.2)) * 8 : Math.abs(Math.sin(tGlobal * 2 + i * 1.3)) * 2.5;
      c2.save();
      c2.translate(48, 92);
      const s = a.id === 'bunny' ? 1.05 : 1.28;
      c2.scale(s, s);
      Sprites.animal(c2, a.id, 0, 0, { t: tGlobal + i * 0.9, z: bounce, seed: i * 1.3 });
      c2.restore();
    });
  }

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
      else if (!paused && KEYS[e.key]) tryMove(KEYS[e.key][0], KEYS[e.key][1]);
    } else if (state === 'over') {
      if (e.key === 'Enter' || e.key === ' ') startGame();
      else if (e.key === 'Escape') toMenu();
    }
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
  window.addEventListener('blur', () => { if (state === 'play') togglePause(true); });

  // ---------- main loop ----------
  buildCards();
  toMenu();
  let last = performance.now();
  function frame(now) {
    let dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (document.hidden) dt = 0;
    tGlobal += dt;
    if (state === 'play' && !paused) updatePlay(dt);
    else if (state === 'dying') updateDying(dt);
    else if (state === 'menu') {
      menuCam += dt * 0.45;
      World.update(dt, menuCam);
    }
    drawWorld(state === 'menu' ? menuCam : cam);
    if (state === 'menu') drawCards();
    else refreshSpecialBtn();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
