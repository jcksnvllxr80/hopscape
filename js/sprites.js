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
    if (row && row.flowers) {
      for (const f of row.flowers) flower(ctx, (f.c + 0.5) * T + f.jx, y + T * 0.5 + f.jy, f.kind);
    }
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
    if (row.bi === 0) fluff(ctx, y, row.seed);
    if (row.bi === row.bn - 1) fluff(ctx, y + T, row.seed + 40);
  }

  // soft white cloud-fluff along the edges of a rainbow band
  function fluff(ctx, edgeY, seed) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let x = 6; x < CFG.W; x += 30) {
      const r = 6 + ((x * 7 + seed * 13) % 5);
      circ(ctx, x + ((x + seed * 29) % 16), edgeY, r);
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
    const wag = Math.sin(t * 4) * 3;
    ctx.strokeStyle = '#e08a2e';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(15, -10);
    ctx.quadraticCurveTo(28, -16 + wag, 25, -32 + wag);
    ctx.stroke();
    ctx.fillStyle = '#f5993d';
    tri(ctx, -17, -39, -13, -59, -3, -42);
    tri(ctx, 17, -39, 13, -59, 3, -42);
    ctx.fillStyle = '#ff9fb2';
    tri(ctx, -13, -43, -12, -53, -6, -44);
    tri(ctx, 13, -43, 12, -53, 6, -44);
    ctx.fillStyle = '#f5993d';
    rrf(ctx, -20, -44, 40, 44, 15);
    ctx.fillStyle = '#ffe8cd';
    rrf(ctx, -12, -20, 24, 18, 9);
    ctx.fillStyle = '#d97f28';
    rrf(ctx, -9, -44, 4, 8, 2);
    rrf(ctx, -2, -45, 4, 10, 2);
    rrf(ctx, 5, -44, 4, 8, 2);
    rrf(ctx, -20, -31, 4, 7, 2);
    rrf(ctx, 16, -31, 4, 7, 2);
    face(ctx, -30, blink);
    ctx.fillStyle = '#ff8fa3';
    tri(ctx, -2.5, -25, 2.5, -25, 0, -21.5);
    ctx.strokeStyle = '#a86a28';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(-2.5, -20, 2.5, 0.15, Math.PI - 0.15);
    ctx.arc(2.5, -20, 2.5, 0.15, Math.PI - 0.15);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(90,60,30,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(12, -26); ctx.lineTo(23, -28);
    ctx.moveTo(12, -22); ctx.lineTo(23, -22);
    ctx.moveTo(-12, -26); ctx.lineTo(-23, -28);
    ctx.moveTo(-12, -22); ctx.lineTo(-23, -22);
    ctx.stroke();
    blush(ctx, 14, -23);
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
    const flap = (o && o.z > 0) ? Math.min(o.z / 22, 1) * 0.6 : 0;
    ctx.strokeStyle = '#e8a81c';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-1, -43); ctx.quadraticCurveTo(-3, -53, -8, -50);
    ctx.moveTo(1, -44);  ctx.quadraticCurveTo(3, -54, 8, -51);
    ctx.stroke();
    ctx.fillStyle = '#ffd93d';
    rrf(ctx, -19, -43, 38, 43, 15);
    ctx.fillStyle = '#ffe680';
    rrf(ctx, -11, -18, 22, 15, 8);
    ctx.fillStyle = '#efc02a';
    ctx.save();
    ctx.translate(-19, -24);
    ctx.rotate(-0.18 - flap);
    rrf(ctx, -8, -8, 9, 18, 4);
    ctx.restore();
    ctx.save();
    ctx.translate(19, -24);
    ctx.rotate(0.18 + flap);
    rrf(ctx, -1, -8, 9, 18, 4);
    ctx.restore();
    face(ctx, -32, blink, 7);
    ctx.fillStyle = '#ff9d2e';
    ell(ctx, 0, -25, 9.5, 5);
    ctx.fillStyle = '#f0871a';
    ell(ctx, 0, -21.5, 7, 3.4);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    circ(ctx, -2.5, -26.5, 0.9);
    circ(ctx, 2.5, -26.5, 0.9);
    blush(ctx, 13, -25);
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
    const sh = Math.max(0.5, 1 - z / 70);
    shadow(ctx, x, y, 17 * sh, 6.5 * sh, 0.24);
    ctx.save();
    ctx.translate(x, y - z);
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
    grassRow, rainbowRow, tree, coin, cloud, cloudShadow, bestLine, animal,
  };
})();
