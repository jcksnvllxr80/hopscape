// Hopscape — all art is drawn with canvas shapes (no image files)
(() => {
  window.CFG = { TILE: 64, COLS: 11, W: 704, H: 960 };
  const T = CFG.TILE;

  const RAINBOW = ['#ff5a5f', '#ff9f43', '#ffd93d', '#6dd36d', '#4aa3ff', '#9b6ef3'];

  // ---------- little shape helpers ----------
  function circ(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  function ell(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function rrf(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }
  function tri(ctx, x1, y1, x2, y2, x3, y3) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
  }
  function shadow(ctx, x, y, rx, ry, a) {
    ctx.fillStyle = 'rgba(25,55,25,' + a + ')';
    ell(ctx, x, y, rx, ry);
  }

  // ---------- ground ----------
  function grassRow(ctx, y, r, row) {
    for (let c = 0; c < CFG.COLS; c++) {
      const p = ((r + c) % 2 + 2) % 2;
      ctx.fillStyle = p ? '#98d96f' : '#8fd166';
      ctx.fillRect(c * T, y, T, T + 0.5);
    }
    if (row && row.holes) {
      for (const c of row.holes) hole(ctx, (c + 0.5) * T, y + T * 0.55);
    }
    if (row && row.flowers) {
      for (const f of row.flowers) flower(ctx, (f.c + 0.5) * T + f.jx, y + T * 0.5 + f.jy, f.kind);
    }
  }

  function hole(ctx, x, y) {
    ctx.fillStyle = '#7d9a52'; // worn grass rim
    ell(ctx, x, y, 23, 15);
    ctx.fillStyle = '#5b3d22';
    ell(ctx, x, y, 20, 12.5);
    ctx.fillStyle = '#2e1d10';
    ell(ctx, x, y + 0.5, 16.5, 10);
    ctx.fillStyle = '#170e07';
    ell(ctx, x, y + 2.5, 11, 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y - 1, 17.5, 10.5, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }

  function flower(ctx, x, y, kind) {
    if (kind === 3) { // grass tuft
      ctx.strokeStyle = '#6cbb4f';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 4, y + 3); ctx.quadraticCurveTo(x - 5, y - 4, x - 7, y - 7);
      ctx.moveTo(x, y + 3);     ctx.quadraticCurveTo(x, y - 6, x - 1, y - 9);
      ctx.moveTo(x + 4, y + 3); ctx.quadraticCurveTo(x + 5, y - 4, x + 7, y - 7);
      ctx.stroke();
      return;
    }
    const cols = ['#ffffff', '#ffd1e8', '#ffe9a8'];
    ctx.fillStyle = cols[kind] || cols[0];
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.4;
      circ(ctx, x + Math.cos(a) * 3.4, y + Math.sin(a) * 3.4, 2.6);
    }
    ctx.fillStyle = '#ffce3d';
    circ(ctx, x, y, 2.2);
  }

  function rainbowRow(ctx, y, row) {
    // Consecutive rainbow rows form one band; each row draws its slice of the 6 stripes
    const bandH = row.bn * T;
    const y0 = y - row.bi * T;
    const sh = bandH / 6;
    for (let s = 0; s < 6; s++) {
      const sy = y0 + s * sh;
      const top = Math.max(sy, y);
      const bot = Math.min(sy + sh, y + T);
      if (bot <= top) continue;
      ctx.fillStyle = RAINBOW[s];
      ctx.fillRect(0, top, CFG.W, bot - top + 0.6);
    }
  }

  // ---------- scenery ----------
  function tree(ctx, x, y, seed) {
    const s = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
    const v = 0.88 + s * 0.28;
    shadow(ctx, x, y, 20, 7, 0.2);
    ctx.fillStyle = '#8a5a33';
    rrf(ctx, x - 5, y - 18, 10, 18, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    rrf(ctx, x + 1, y - 18, 4, 18, 2);
    ctx.fillStyle = '#3f9e50';
    circ(ctx, x - 11 * v, y - 25, 14 * v);
    circ(ctx, x + 11 * v, y - 25, 14 * v);
    ctx.fillStyle = '#47ab59';
    circ(ctx, x, y - 33 * v, 16 * v);
    ctx.fillStyle = '#57bd68';
    circ(ctx, x - 5, y - 41 * v, 10 * v);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    circ(ctx, x - 9, y - 44 * v, 4.5);
    if (s < 0.3) {
      ctx.fillStyle = '#ff6b6b';
      circ(ctx, x + 7, y - 36 * v, 2.6);
      circ(ctx, x - 9, y - 28 * v, 2.6);
      circ(ctx, x + 2, y - 24 * v, 2.6);
    }
  }

  function coin(ctx, x, y, t, c) {
    y += Math.sin(t * 2.6 + c * 1.7) * 3;
    const sq = 0.35 + 0.65 * Math.abs(Math.cos(t * 2.2 + c));
    shadow(ctx, x, y + 15, 8 * sq + 2, 3.5, 0.16);
    ctx.fillStyle = 'rgba(255,215,80,0.25)';
    circ(ctx, x, y, 17);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sq, 1);
    ctx.fillStyle = '#ffd23e';
    circ(ctx, 0, 0, 11);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#dd9d12';
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255,243,191,0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (sq > 0.92) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const a = t * 3 + c;
      ctx.save();
      ctx.translate(x + 7, y - 8);
      ctx.rotate(a);
      ctx.fillRect(-4, -1, 8, 2);
      ctx.fillRect(-1, -4, 2, 8);
      ctx.restore();
    }
  }

  function cloudShadow(ctx, x, y, wTiles) {
    ctx.fillStyle = 'rgba(20,30,50,0.18)';
    ell(ctx, x, y, wTiles * T * 0.4, 6);
  }

  // grumpy storm cloud — the enemy!
  function cloud(ctx, x, y, wTiles, t, seed, dir) {
    const w = wTiles * T;
    const R = w / 2;
    const cy = y + Math.sin(t * 2 + seed) * 2.5 - 9;

    // body under-shade, then main puffs, then highlights
    ctx.fillStyle = '#454c63';
    circ(ctx, x - R * 0.55, cy + 4, R * 0.4);
    circ(ctx, x - R * 0.05, cy - 4, R * 0.48);
    circ(ctx, x + R * 0.42, cy + 3, R * 0.38);
    rrf(ctx, x - R * 0.75, cy - 1, R * 1.5, 20, 10);
    ctx.fillStyle = '#5f6883';
    circ(ctx, x - R * 0.55, cy + 1, R * 0.4);
    circ(ctx, x - R * 0.05, cy - 7, R * 0.48);
    circ(ctx, x + R * 0.42, cy, R * 0.38);
    rrf(ctx, x - R * 0.75, cy - 4, R * 1.5, 20, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    circ(ctx, x - R * 0.15, cy - 13, R * 0.28);
    circ(ctx, x - R * 0.62, cy - 5, R * 0.18);

    // angry little face
    ctx.fillStyle = '#ffffff';
    circ(ctx, x - 9, cy - 2, 5);
    circ(ctx, x + 9, cy - 2, 5);
    ctx.fillStyle = '#20242f';
    circ(ctx, x - 9 + dir * 1.8, cy - 2, 2.6);
    circ(ctx, x + 9 + dir * 1.8, cy - 2, 2.6);
    ctx.strokeStyle = '#2a2f40';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 15, cy - 11); ctx.lineTo(x - 4, cy - 6.5);
    ctx.moveTo(x + 15, cy - 11); ctx.lineTo(x + 4, cy - 6.5);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, cy + 9, 4, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();

    // falling rain streaks
    ctx.strokeStyle = 'rgba(96,170,255,0.85)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const fx = x - w * 0.32 + (i + 0.5) * (w * 0.64 / 4) + Math.sin(seed * 3 + i * 9) * 4;
      const ph = ((t * 1.5 + i * 0.23 + seed * 0.11) % 1 + 1) % 1;
      const fy = cy + 18 + ph * 26;
      ctx.globalAlpha = (1 - ph) * 0.8;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx - 2, fy + 8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // little spaceship on its pad; rk.phase: idle | arm (rumbling) | fly (launching)
  function rocket(ctx, x, y, rk, t) {
    let lift = 0;
    let jx = 0;
    if (rk.phase === 'arm') jx = Math.sin(t * 42) * (1.5 + rk.t);
    if (rk.phase === 'fly') lift = rk.t * rk.t * 780;

    // launch pad stays behind
    ctx.fillStyle = '#8a8f9c';
    ell(ctx, x, y, 20, 7);
    ctx.fillStyle = '#6d7280';
    ell(ctx, x, y - 1.5, 15, 4.5);
    if (rk.phase === 'fly') {
      ctx.fillStyle = 'rgba(40,30,25,0.45)';
      ell(ctx, x, y, 17, 5.5);
      // smoke column chasing the rocket
      for (let i = 0; i < 6; i++) {
        const sy = y - 8 - (lift * i) / 6;
        const k = 1 - i / 6;
        ctx.fillStyle = 'rgba(200,200,205,' + (0.5 * k * Math.max(0, 1 - rk.t * 0.8)) + ')';
        circ(ctx, x + Math.sin(i * 2.6 + t * 3) * 7, sy, 7 + (1 - k) * 9);
      }
    }

    ctx.save();
    ctx.translate(x + jx, y - lift);
    // fins
    ctx.fillStyle = '#e63946';
    tri(ctx, -8, -6, -17, 2, -8, -22);
    tri(ctx, 8, -6, 17, 2, 8, -22);
    // body
    ctx.fillStyle = '#f4f7fb';
    rrf(ctx, -9, -44, 18, 40, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    rrf(ctx, 2, -44, 7, 40, 6);
    // nose cone
    ctx.fillStyle = '#e63946';
    tri(ctx, -9, -42, 9, -42, 0, -60);
    // porthole
    ctx.fillStyle = '#35506e';
    circ(ctx, 0, -28, 5.5);
    ctx.fillStyle = '#9fd4ff';
    circ(ctx, 0, -28, 3.8);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    circ(ctx, -1.4, -29.4, 1.3);
    // exhaust flame when armed/launching
    if (rk.phase === 'arm' || rk.phase === 'fly') {
      const fl = rk.phase === 'fly' ? 1 : 0.35;
      const flick = 0.8 + Math.sin(t * 37) * 0.2;
      ctx.fillStyle = '#ff9f43';
      tri(ctx, -6, -5, 6, -5, 0, -5 + 22 * fl * flick);
      ctx.fillStyle = '#ffd93d';
      tri(ctx, -3.5, -5, 3.5, -5, 0, -5 + 13 * fl * flick);
    }
    ctx.restore();

    // warning bubble while it rumbles
    if (rk.phase === 'arm' && Math.sin(t * 10) > -0.4) {
      ctx.fillStyle = '#ff5a5f';
      circ(ctx, x + 16, y - 66, 10);
      ctx.fillStyle = '#fff';
      ctx.font = '900 15px "Arial Rounded MT Bold", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', x + 16, y - 61);
      ctx.textAlign = 'left';
    }
  }

  function scorch(ctx, x, y) {
    ctx.fillStyle = '#8a8f9c';
    ell(ctx, x, y, 20, 7);
    ctx.fillStyle = 'rgba(50,38,30,0.55)';
    ell(ctx, x, y - 1, 15, 5);
    ctx.fillStyle = 'rgba(25,18,14,0.5)';
    ell(ctx, x, y - 1, 8, 3);
  }

  // side-view cartoon jet (dir = 1 flying right, -1 flying left)
  function plane(ctx, x, y, dir, t) {
    ctx.save();
    ctx.translate(x, y + Math.sin(t * 7) * 2);
    if (dir < 0) ctx.scale(-1, 1);
    // tail fin
    ctx.fillStyle = '#e63946';
    tri(ctx, -22, -4, -22, -24, -8, -4);
    // rear wing sticking down-back
    ctx.fillStyle = '#3d8fe0';
    tri(ctx, -8, 2, -22, 15, 4, 2);
    // fuselage
    ctx.fillStyle = '#f4f7fb';
    rrf(ctx, -25, -9, 50, 18, 9);
    // belly stripe
    ctx.fillStyle = '#e63946';
    rrf(ctx, -25, 2, 50, 5, 3);
    // near wing over the body
    ctx.fillStyle = '#4aa3ff';
    tri(ctx, 2, -1, -14, 12, 12, -1);
    // cockpit + windows
    ctx.fillStyle = '#35506e';
    rrf(ctx, 15, -7, 8, 6, 3);
    circ(ctx, -10, -3, 2.4);
    circ(ctx, -2, -3, 2.4);
    circ(ctx, 6, -3, 2.4);
    ctx.restore();
  }

  // eagle, wings flapping; grab=true tucks the talons out ready to snatch
  function eagle(ctx, x, y, t, grab) {
    const flap = Math.sin(t * 13);
    ctx.save();
    ctx.translate(x, y);
    // wings
    ctx.fillStyle = '#6b4423';
    ctx.save();
    ctx.rotate(-0.25 - flap * 0.45);
    rrf(ctx, -42, -8, 36, 13, 6);
    tri(ctx, -42, -8, -50, -14, -38, 0);
    ctx.restore();
    ctx.save();
    ctx.rotate(0.25 + flap * 0.45);
    rrf(ctx, 6, -8, 36, 13, 6);
    tri(ctx, 42, -8, 50, -14, 38, 0);
    ctx.restore();
    // tail
    ctx.fillStyle = '#5a381d';
    tri(ctx, -6, 10, 6, 10, 0, 24);
    // body
    ctx.fillStyle = '#7c5230';
    ell(ctx, 0, 0, 12, 15);
    // white head
    ctx.fillStyle = '#f6f2ea';
    circ(ctx, 0, -13, 8);
    // beak
    ctx.fillStyle = '#f5b91a';
    tri(ctx, -2, -13, 2, -15, 6, -9);
    // eyes
    ctx.fillStyle = '#26221f';
    circ(ctx, -3.5, -15, 1.7);
    circ(ctx, 3.5, -15, 1.7);
    // angry brows
    ctx.strokeStyle = '#26221f';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-7, -19); ctx.lineTo(-1.5, -17);
    ctx.moveTo(7, -19);  ctx.lineTo(1.5, -17);
    ctx.stroke();
    // talons
    ctx.fillStyle = '#e8a81c';
    const ty = grab ? 14 : 11;
    rrf(ctx, -7, ty, 5, 9, 2.5);
    rrf(ctx, 2, ty, 5, 9, 2.5);
    ctx.restore();
  }

  function bestLine(ctx, y, best) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 9]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CFG.W, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    rrf(ctx, 8, y - 26, 86, 24, 9);
    ctx.fillStyle = '#c2571f';
    ctx.font = '700 14px "Arial Rounded MT Bold", system-ui, sans-serif';
    ctx.fillText('\u{1F3C6} BEST ' + best, 16, y - 9);
  }

  // ---------- the animals ----------
  function face(ctx, ey, blink, dx) {
    dx = dx || 8;
    if (blink) {
      ctx.strokeStyle = '#26221f';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-dx - 3, ey); ctx.lineTo(-dx + 3, ey);
      ctx.moveTo(dx - 3, ey);  ctx.lineTo(dx + 3, ey);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#26221f';
      circ(ctx, -dx, ey, 3.4);
      circ(ctx, dx, ey, 3.4);
      ctx.fillStyle = '#ffffff';
      circ(ctx, -dx + 1.2, ey - 1.2, 1.2);
      circ(ctx, dx + 1.2, ey - 1.2, 1.2);
    }
  }
  function blush(ctx, dx, y) {
    ctx.fillStyle = 'rgba(255,120,150,0.35)';
    circ(ctx, -dx, y, 3.6);
    circ(ctx, dx, y, 3.6);
  }

  function drawCat(ctx, t, blink) {
    const wag = Math.sin(t * 4) * 4;
    // curled tail
    ctx.strokeStyle = '#e08a2e';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(16, -8);
    ctx.quadraticCurveTo(30, -14 + wag, 26, -34 + wag);
    ctx.stroke();
    ctx.fillStyle = '#c96f1e';
    circ(ctx, 26, -34 + wag, 4.5);
    // tall pointy ears
    ctx.fillStyle = '#f5993d';
    tri(ctx, -19, -38, -14, -64, -1, -44);
    tri(ctx, 19, -38, 14, -64, 1, -44);
    ctx.fillStyle = '#ff9fb2';
    tri(ctx, -14, -42, -12.5, -56, -5.5, -44.5);
    tri(ctx, 14, -42, 12.5, -56, 5.5, -44.5);
    // body
    ctx.fillStyle = '#f5993d';
    rrf(ctx, -20, -46, 40, 46, 15);
    // cheek fluff tufts
    tri(ctx, -20, -22, -27, -26, -20, -30);
    tri(ctx, 20, -22, 27, -26, 20, -30);
    // bold tabby stripes: forehead "M" + sides
    ctx.fillStyle = '#d3781f';
    rrf(ctx, -10, -46, 5, 10, 2);
    rrf(ctx, -2.5, -47, 5, 13, 2);
    rrf(ctx, 5, -46, 5, 10, 2);
    rrf(ctx, -20, -36, 5, 8, 2);
    rrf(ctx, 15, -36, 5, 8, 2);
    // white tummy patch, low so the face stays clean
    ctx.fillStyle = '#fff4e6';
    rrf(ctx, -10, -14, 20, 11, 7);
    // green almond cat eyes with slit pupils
    if (blink) {
      ctx.strokeStyle = '#26221f';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-11, -31); ctx.lineTo(-5, -31);
      ctx.moveTo(5, -31);   ctx.lineTo(11, -31);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#7ec850';
      ell(ctx, -8, -31, 4.4, 5.4);
      ell(ctx, 8, -31, 4.4, 5.4);
      ctx.fillStyle = '#26221f';
      ell(ctx, -8, -31, 1.8, 4.6);
      ell(ctx, 8, -31, 1.8, 4.6);
      ctx.fillStyle = '#ffffff';
      circ(ctx, -9.3, -33.4, 1.2);
      circ(ctx, 6.7, -33.4, 1.2);
    }
    // pink nose + little :3 mouth (separate arcs, no connecting line)
    ctx.fillStyle = '#ff8fa3';
    tri(ctx, -2.8, -24.5, 2.8, -24.5, 0, -20.8);
    ctx.strokeStyle = '#7a4a1a';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(-2.8, -19.2, 2.8, 0.2, Math.PI * 0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(2.8, -19.2, 2.8, Math.PI * 0.15, Math.PI - 0.2);
    ctx.stroke();
    // long whiskers
    ctx.strokeStyle = 'rgba(80,50,25,0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, -27); ctx.lineTo(24, -30);
    ctx.moveTo(10, -24); ctx.lineTo(25, -24);
    ctx.moveTo(10, -21); ctx.lineTo(24, -18);
    ctx.moveTo(-10, -27); ctx.lineTo(-24, -30);
    ctx.moveTo(-10, -24); ctx.lineTo(-25, -24);
    ctx.moveTo(-10, -21); ctx.lineTo(-24, -18);
    ctx.stroke();
    // feet
    ctx.fillStyle = '#e08a2e';
    rrf(ctx, -15, -7, 11, 7, 3);
    rrf(ctx, 4, -7, 11, 7, 3);
  }

  function drawDog(ctx, t, blink) {
    ctx.fillStyle = '#b9854b';
    circ(ctx, 19 + Math.sin(t * 5) * 1.5, -15, 5.5);
    ctx.fillStyle = '#e2b271';
    rrf(ctx, -20, -44, 40, 44, 15);
    // floppy ears hang over the sides
    ctx.fillStyle = '#a9713a';
    ctx.save();
    ctx.translate(-16, -43);
    ctx.rotate(-0.28);
    rrf(ctx, -9, 0, 11, 21, 5);
    ctx.restore();
    ctx.save();
    ctx.translate(16, -43);
    ctx.rotate(0.28);
    rrf(ctx, -2, 0, 11, 21, 5);
    ctx.restore();
    ctx.fillStyle = '#c9945a';
    circ(ctx, 9, -31, 8);
    ctx.fillStyle = '#f8ecd7';
    ell(ctx, 0, -19, 12, 9);
    face(ctx, -31, blink);
    ctx.fillStyle = '#3a2d24';
    rrf(ctx, -4, -27, 8, 6, 3);
    ctx.strokeStyle = '#3a2d24';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -21); ctx.lineTo(0, -17);
    ctx.stroke();
    ctx.fillStyle = '#ff8fa3';
    rrf(ctx, -3, -16, 6, 6.5 + Math.sin(t * 6) * 1, 3);
    blush(ctx, 15, -25);
    ctx.fillStyle = '#c9945a';
    rrf(ctx, -15, -7, 11, 7, 3);
    rrf(ctx, 4, -7, 11, 7, 3);
  }

  function drawBunny(ctx, t, blink) {
    const sway = Math.sin(t * 2) * 0.04;
    ctx.save();
    ctx.translate(-9, -38);
    ctx.rotate(-0.14 + sway);
    ctx.fillStyle = '#f4f1ec';
    rrf(ctx, -5, -36, 10, 38, 5);
    ctx.fillStyle = '#ffb7c9';
    rrf(ctx, -2.5, -30, 5, 26, 3);
    ctx.restore();
    ctx.save();
    ctx.translate(9, -38);
    ctx.rotate(0.14 - sway);
    ctx.fillStyle = '#f4f1ec';
    rrf(ctx, -5, -36, 10, 38, 5);
    ctx.fillStyle = '#ffb7c9';
    rrf(ctx, -2.5, -30, 5, 26, 3);
    ctx.restore();
    ctx.fillStyle = '#e9e4db';
    circ(ctx, 17, -12, 6);
    ctx.fillStyle = '#f4f1ec';
    rrf(ctx, -19, -42, 38, 42, 15);
    ctx.fillStyle = '#fdfbf7';
    circ(ctx, -9, -20, 7.5);
    circ(ctx, 9, -20, 7.5);
    face(ctx, -29, blink, 7);
    ctx.fillStyle = '#ff8fa3';
    tri(ctx, -2.5, -25, 2.5, -25, 0, -21.5);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    rrf(ctx, -3.5, -20, 3.5, 5.5, 1);
    ctx.strokeRect(-3.5, -20, 3.5, 5.5);
    rrf(ctx, 0, -20, 3.5, 5.5, 1);
    ctx.strokeRect(0, -20, 3.5, 5.5);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    circ(ctx, -11, -22, 0.8); circ(ctx, -8, -19, 0.8); circ(ctx, -12, -18, 0.8);
    circ(ctx, 11, -22, 0.8);  circ(ctx, 8, -19, 0.8);  circ(ctx, 12, -18, 0.8);
    blush(ctx, 14, -24);
    ctx.fillStyle = '#e6dfd4';
    rrf(ctx, -16, -7, 13, 7, 3);
    rrf(ctx, 3, -7, 13, 7, 3);
  }

  function drawDuck(ctx, t, blink, o) {
    const fly = !!(o && o.air);
    // little upturned tail
    ctx.fillStyle = '#f0c11f';
    tri(ctx, 15, -12, 24, -21, 14, -20);
    // body
    ctx.fillStyle = '#ffd93d';
    rrf(ctx, -19, -43, 38, 43, 15);
    ctx.fillStyle = '#ffe680';
    rrf(ctx, -11, -18, 22, 15, 8);
    if (fly) {
      // wings spread wide, flapping fast — only while flying
      const flap = Math.sin(t * 18) * 0.35 + 0.55;
      ctx.fillStyle = '#f0c11f';
      ctx.save();
      ctx.translate(-18, -27);
      ctx.rotate(-0.5 - flap);
      rrf(ctx, -17, -5, 18, 10, 5);
      ctx.restore();
      ctx.save();
      ctx.translate(18, -27);
      ctx.rotate(0.5 + flap);
      rrf(ctx, -1, -5, 18, 10, 5);
      ctx.restore();
    } else {
      // wings folded flat against the body
      ctx.fillStyle = '#eec22f';
      ell(ctx, -15, -22, 5, 10.5);
      ell(ctx, 15, -22, 5, 10.5);
    }
    face(ctx, -33, blink, 7.5);
    // wide duck bill
    ctx.fillStyle = '#ff9d2e';
    ell(ctx, 0, -26, 11.5, 5.5);
    ctx.fillStyle = '#f0871a';
    ell(ctx, 0, -21.5, 8.5, 3.6);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    circ(ctx, -3, -27.5, 0.9);
    circ(ctx, 3, -27.5, 0.9);
    blush(ctx, 14, -29);
    // feet
    ctx.fillStyle = '#ff9d2e';
    rrf(ctx, -14, -6, 10, 6, 3);
    rrf(ctx, 4, -6, 10, 6, 3);
  }

  const drawers = { cat: drawCat, dog: drawDog, bunny: drawBunny, duck: drawDuck };

  function animal(ctx, type, x, y, o) {
    o = o || {};
    const t = o.t || 0;
    const z = o.z || 0;
    const squash = o.squash == null ? 1 : o.squash;
    const dead = !!o.dead;
    const blink = !dead && (((t + (o.seed || 0)) % 3.4) > 3.25);
    const shrink = o.shrink == null ? 1 : o.shrink;
    const sh = Math.max(0.5, 1 - z / 70) * shrink;
    if (shrink > 0.05) shadow(ctx, x, y, 17 * sh, 6.5 * sh, 0.24);
    ctx.save();
    ctx.translate(x, y - z);
    if (shrink !== 1) ctx.scale(shrink, shrink);
    if (o.lean) ctx.rotate(o.lean * 0.1);
    if (o.flip) ctx.scale(-1, 1);
    ctx.scale(1, squash);
    if (dead) ctx.scale(1.3, 0.5);
    drawers[type](ctx, t, blink, o);
    ctx.restore();
    if (dead) {
      ctx.fillStyle = 'rgba(120,180,255,0.35)';
      ell(ctx, x, y + 2, 25, 6);
      ctx.fillStyle = 'rgba(110,150,200,0.3)';
      ell(ctx, x, y - 10, 27, 15);
    }
  }

  window.Sprites = {
    ANIMALS: [
      { id: 'cat',   name: 'Mittens', kind: 'the cat' },
      { id: 'dog',   name: 'Biscuit', kind: 'the pup' },
      { id: 'bunny', name: 'Clover',  kind: 'the bunny' },
      { id: 'duck',  name: 'Puddles', kind: 'the duck' },
    ],
    grassRow, rainbowRow, tree, coin, cloud, cloudShadow, bestLine, animal, plane, eagle, rocket, scorch,
  };
})();
