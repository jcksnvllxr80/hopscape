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

  // ---------- state ----------
  let state = 'menu'; // menu | play | dying | over
  let paused = false;
  let tGlobal = 0;
  let selected = store.get('hs_char', 0);
  let best = store.get('hs_best', 0);
  let totalCoins = store.get('hs_coins', 0);

  let cam = -4, menuCam = -4, graceT = 0, score = 0, runCoins = 0;
  let dieT = 0, deathCause = '', shake = 0;
  let particles = [];

  const chr = {};
  function resetChr() {
    Object.assign(chr, {
      row: 2, col: 5, fromR: 2, fromC: 5, toR: 2, toC: 5,
      rowF: 2, colF: 5, hopping: false, hopT: 0, squashT: 9,
      flip: false, lean: 0, queued: null, bump: null, dead: false,
    });
  }

  function resetRun() {
    World.reset();
    resetChr();
    cam = chr.row - 6;
    graceT = 0; score = 0; runCoins = 0; dieT = 0; shake = 0;
    particles = [];
    ui.score.textContent = '0';
    ui.coins.textContent = '0';
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
    if (dc !== 0) chr.flip = dc < 0;
    const tr = chr.row + dr, tc = chr.col + dc;
    const minRow = Math.max(0, Math.ceil(cam - 0.2));
    if (tc < 0 || tc >= COLS || tr < minRow) return bumped();
    const row = World.row(tr);
    if (row && row.trees && row.trees.has(tc)) return bumped();
    chr.fromR = chr.row; chr.fromC = chr.col;
    chr.toR = tr; chr.toC = tc;
    chr.hopping = true;
    chr.hopT = 0;
    chr.lean = dc;
    spawnP('poof', (chr.col + 0.5) * T, rowFeetY(chr.row, cam), { life: 0.3 });
    Sfx.hop();
    function bumped() { chr.bump = { dr, dc, t: 0 }; Sfx.bump(); }
  }

  function updateChar(dt) {
    if (chr.bump) {
      chr.bump.t += dt;
      if (chr.bump.t > 0.13) chr.bump = null;
    }
    chr.squashT += dt;
    if (chr.hopping) {
      chr.hopT += dt / 0.115;
      if (chr.hopT >= 1) {
        chr.row = chr.toR; chr.col = chr.toC;
        chr.hopping = false;
        chr.squashT = 0;
        if (chr.row - 2 > score) {
          score = chr.row - 2;
          ui.score.textContent = score;
        }
        const row = World.row(chr.row);
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
  function updatePlay(dt) {
    updateChar(dt);
    graceT += dt;
    if (graceT > 3) cam += Math.min(0.32 + score * 0.005, 0.95) * dt;
    const tgt = chr.rowF - 4.5;
    if (tgt > cam) cam += (tgt - cam) * Math.min(1, dt * 4);
    World.update(dt, cam);
    updateParticles(dt);

    // rain cloud collision (checked against the hop-interpolated position)
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
    if (chr.rowF - cam < -0.85) return die('swept');
  }

  function die(cause) {
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
    }
  }

  function updateDying(dt) {
    dieT += dt;
    if (shake > 0) shake = Math.max(0, shake - dt);
    World.update(dt, cam);
    updateParticles(dt);
    if (dieT > 0.95) finishGameOver();
  }

  function finishGameOver() {
    if (state !== 'dying') return;
    state = 'over';
    const isBest = score > best && score > 0;
    if (isBest) { best = score; store.set('hs_best', best); }
    totalCoins += runCoins;
    store.set('hs_coins', totalCoins);
    ui.goTitle.textContent = deathCause === 'cloud' ? 'Splash! \u{1F4A6}' : 'Oh no! \u{1F327}\u{FE0F}';
    ui.goReason.textContent = deathCause === 'cloud'
      ? 'A grumpy rain cloud soaked you!'
      : 'The storm caught up with you!';
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
    const z = chr.hopping ? Math.sin(Math.PI * Math.min(chr.hopT, 1)) * 22 : 0;
    let squash = 1;
    if (chr.hopping) squash = 1.06;
    else if (chr.squashT < 0.1) squash = 1 - 0.2 * Math.sin(Math.PI * chr.squashT / 0.1);
    Sprites.animal(ctx, Sprites.ANIMALS[selected].id, x + bx, y + by, {
      t: tGlobal, z, squash,
      flip: chr.flip,
      lean: chr.hopping ? chr.lean * 0.6 : 0,
      dead: chr.dead && deathCause === 'cloud',
      seed: 1.7,
    });
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
    ArrowUp: [1, 0], w: [1, 0], W: [1, 0], ' ': [1, 0],
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
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
