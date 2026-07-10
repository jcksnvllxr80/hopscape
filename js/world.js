// Hopscape — world generation: bands of grass (trees, coins, flowers) and rainbow roads (rain clouds)
(() => {
  const COLS = CFG.COLS;
  const PAD = 2.5; // clouds travel PAD tiles past each edge before wrapping

  let rows, nextRow, corridor, nextType;

  const irand = n => Math.floor(Math.random() * n);
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = irand(i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function reset() {
    rows = new Map();
    nextRow = 0;
    corridor = 5;
    nextType = 'rainbow';
    genGrass(5, true);
  }

  function genGrass(n, isStart) {
    for (let i = 0; i < n; i++) {
      const r = nextRow++;
      // A wandering always-clear corridor guarantees the player can never get walled in.
      const prev = corridor;
      corridor = Math.max(1, Math.min(COLS - 2, corridor + irand(3) - 1));
      const trees = new Set();
      const holes = new Set();
      const coins = new Set();
      const flowers = [];
      let rocket = null;
      if (!(isStart && r < 3)) {
        const density = Math.min(2 + irand(3) + Math.floor(r / 70), 5);
        const cells = [];
        for (let c = 0; c < COLS; c++) if (c !== corridor && c !== prev) cells.push(c);
        shuffle(cells);
        let k = 0;
        for (; k < density && k < cells.length; k++) trees.add(cells[k]);
        if (r > 4 && Math.random() < 0.42) {
          const n = Math.random() < 0.3 ? 2 : 1;
          for (let j = 0; j < n && k < cells.length; j++, k++) holes.add(cells[k]);
        }
        if (r > 6 && Math.random() < 0.13 && k < cells.length) {
          rocket = { c: cells[k++], phase: 'idle', t: 0 };
        }
      }
      if (r > 2 && Math.random() < 0.38) {
        const free = [];
        for (let c = 0; c < COLS; c++) if (!trees.has(c) && !holes.has(c) && !(rocket && rocket.c === c)) free.push(c);
        shuffle(free);
        const k = Math.random() < 0.25 ? 2 : 1;
        for (let j = 0; j < k && j < free.length; j++) coins.add(free[j]);
      }
      for (let c = 0; c < COLS; c++) {
        if (!trees.has(c) && !holes.has(c) && !(rocket && rocket.c === c) && Math.random() < 0.16) {
          flowers.push({ c, kind: irand(4), jx: (Math.random() - 0.5) * 30, jy: (Math.random() - 0.5) * 22 });
        }
      }
      rows.set(r, { type: 'grass', trees, holes, coins, flowers, rocket });
    }
  }

  function genRainbow(n) {
    for (let i = 0; i < n; i++) {
      const r = nextRow++;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const speed = Math.min((1.05 + Math.random() * 1.05) * (1 + Math.min(r / 170, 0.8)), 3.2);
      const L = COLS + PAD * 2;
      const minGap = Math.max(1.6, 3.1 - r * 0.018);
      const clouds = [];
      let x = Math.random() * 1.5;
      while (x + 1.8 < L - 0.5) {
        const w = 1.25 + Math.random() * 0.5;
        clouds.push({ x: x + w / 2, w, seed: Math.random() * 100 });
        x += w + minGap + Math.random() * 2.1;
      }
      if (clouds.length === 0) clouds.push({ x: L / 2, w: 1.4, seed: Math.random() * 100 });
      rows.set(r, { type: 'rainbow', clouds, dir, speed, L, bi: i, bn: n, seed: Math.random() * 100 });
    }
  }

  function genBand() {
    if (nextType === 'rainbow') {
      const maxLen = 1 + Math.min(3, Math.floor(nextRow / 28));
      genRainbow(1 + irand(maxLen));
      nextType = 'grass';
    } else {
      genGrass(1 + irand(3), false);
      nextType = 'rainbow';
    }
  }

  function update(dt, cam) {
    while (nextRow < cam + 20) genBand();
    for (const r of rows.keys()) if (r < cam - 3) rows.delete(r);
    const top = cam + 18;
    for (let r = Math.max(0, Math.floor(cam) - 1); r <= top; r++) {
      const row = rows.get(r);
      if (row && row.type === 'rainbow') {
        for (const c of row.clouds) {
          c.x += row.dir * row.speed * dt;
          if (c.x < 0) c.x += row.L;
          else if (c.x >= row.L) c.x -= row.L;
        }
      }
    }
  }

  window.World = { PAD, reset, update, row: r => rows.get(r) };
})();
