// Hopscape — world generation: grass (trees, holes, coins, rockets), rainbow roads
// (rain clouds), paved roads (cars), deer crossings, and roaming tractors that
// flatten trees and carve dirt roads.
(() => {
  const COLS = CFG.COLS;
  const PAD = 2.5; // moving hazards travel PAD tiles past each edge before wrapping

  let rows, nextRow, corridor, nextType;
  let tractors, tractorTimer;
  let events; // world → game notifications (falling trees, tractor spawns, deer herds)

  const irand = n => Math.floor(Math.random() * n);

  // Band width 1-5: the positive half of a bell curve centered on 1 —
  // mostly single rows, sometimes 2-3, rarely a whopping 4-5.
  function bandWidth() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    const g = Math.abs(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
    return Math.max(1, Math.min(5, 1 + Math.floor(g * 1.45)));
  }

  // Rivers stay short — only ever one or two rows of water to cross.
  function riverWidth() {
    return Math.random() < 0.55 ? 1 : 2;
  }

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
    nextType = 'hazard';
    tractors = [];
    tractorTimer = 11 + Math.random() * 8;
    events = [];
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
          const n2 = Math.random() < 0.3 ? 2 : 1;
          for (let j = 0; j < n2 && k < cells.length; j++, k++) holes.add(cells[k]);
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

  function genRoad(n) {
    for (let i = 0; i < n; i++) {
      const r = nextRow++;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const speed = Math.min((1.5 + Math.random() * 1.2) * (1 + Math.min(r / 170, 0.7)), 3.8);
      const L = COLS + PAD * 2;
      const minGap = Math.max(2, 3.2 - r * 0.015);
      const cars = [];
      let x = Math.random() * 2;
      while (x + 2.2 < L - 0.5) {
        const truck = Math.random() < 0.18;
        const w = truck ? 1.7 : 1 + Math.random() * 0.15;
        cars.push({ x: x + w / 2, w, kind: truck ? 9 : irand(5), seed: Math.random() * 100 });
        x += w + minGap + Math.random() * 2.4;
      }
      if (cars.length === 0) cars.push({ x: L / 2, w: 1, kind: irand(5), seed: 0 });
      rows.set(r, { type: 'road', cars, dir, speed, L, bi: i, bn: n });
    }
  }

  function genDeer(n) {
    for (let i = 0; i < n; i++) {
      const r = nextRow++;
      rows.set(r, {
        type: 'deer', deer: [], dir: Math.random() < 0.5 ? -1 : 1,
        speed: 3 + Math.random() * 1.5, timer: 1.5 + Math.random() * 4,
        L: COLS + PAD * 2,
        trees: new Set(), holes: new Set(), coins: new Set(), flowers: [],
      });
    }
  }

  // Rivers: each row is EITHER a lane of moving logs to time OR a scatter of
  // static lily pads to hop across — never both on the same row.
  function genRiver(n) {
    for (let i = 0; i < n; i++) {
      const r = nextRow++;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const logs = [];
      const pads = new Set();
      if (Math.random() < 0.55) {
        const speed = Math.min((0.85 + Math.random() * 0.9) * (1 + Math.min(r / 170, 0.6)), 2.6);
        const L = COLS + PAD * 2;
        const minGap = Math.max(1.1, 2.3 - r * 0.012);
        let x = Math.random() * 2;
        while (x + 1.6 < L - 0.5) {
          const w = 1.6 + Math.random() * 1.3;
          logs.push({ x: x + w / 2, w, seed: Math.random() * 100 });
          x += w + minGap + Math.random() * 1.5;
        }
        if (logs.length === 0) logs.push({ x: L / 2, w: 2.2, seed: 0 });
        rows.set(r, { type: 'river', logs, pads, dir, speed, L, bi: i, bn: n });
      } else {
        const cells = [];
        for (let c = 0; c < COLS; c++) cells.push(c);
        shuffle(cells);
        const count = 4 + irand(3); // 4-6 static stepping stones
        for (let k = 0; k < count; k++) pads.add(cells[k]);
        rows.set(r, { type: 'river', logs, pads, dir, speed: 0, L: COLS + PAD * 2, bi: i, bn: n });
      }
    }
  }

  function genBand() {
    if (nextType === 'hazard') {
      const roll = Math.random();
      if (roll < 0.48) genRainbow(bandWidth());
      else if (roll < 0.60) genRoad(bandWidth()); // paved roads stay rare
      else if (roll < 0.80) genRiver(riverWidth());
      else genDeer(bandWidth());
      nextType = 'grass';
    } else {
      genGrass(1 + irand(3), false);
      nextType = 'hazard';
    }
  }

  function updateTractors(dt, cam) {
    tractorTimer -= dt;
    if (tractorTimer <= 0) {
      tractorTimer = 15 + Math.random() * 14;
      if (tractors.length === 0) {
        for (let tries = 0; tries < 8; tries++) {
          const r = Math.ceil(cam) + 4 + irand(9);
          const row = rows.get(r);
          if (!row || row.type !== 'grass' || row.dirt || row.dirtFull || row.trees.size < 2) continue;
          const dir = Math.random() < 0.5 ? 1 : -1;
          tractors.push({ row: r, dir, x: dir > 0 ? -2 : COLS + 2, speed: 1.35 });
          events.push({ type: 'tractor', r });
          break;
        }
      }
    }
    for (let i = tractors.length - 1; i >= 0; i--) {
      const t = tractors[i];
      const row = rows.get(t.row);
      if (!row) { tractors.splice(i, 1); continue; }
      t.x += t.dir * t.speed * dt;
      // the blade flattens everything just ahead of and under the tractor
      for (const c of [Math.floor(t.x), Math.floor(t.x + t.dir * 0.8)]) {
        if (c < 0 || c >= COLS) continue;
        if (row.trees.has(c)) {
          row.trees.delete(c);
          events.push({ type: 'treefall', r: t.row, c });
        }
        row.holes.delete(c); // filled in and paved over
      }
      row.dirt = { dir: t.dir, edge: t.x };
      if ((t.dir > 0 && t.x > COLS + 2) || (t.dir < 0 && t.x < -2)) {
        row.dirtFull = true;
        delete row.dirt;
        tractors.splice(i, 1);
      }
    }
  }

  function update(dt, cam) {
    while (nextRow < cam + 20) genBand();
    for (const r of rows.keys()) if (r < cam - 3) rows.delete(r);
    const top = cam + 18;
    for (let r = Math.max(0, Math.floor(cam) - 1); r <= top; r++) {
      const row = rows.get(r);
      if (!row) continue;
      const traffic = row.type === 'rainbow' ? row.clouds : row.type === 'road' ? row.cars
                    : row.type === 'river' ? row.logs : null;
      if (traffic) {
        for (const c of traffic) {
          c.x += row.dir * row.speed * dt;
          if (c.x < 0) c.x += row.L;
          else if (c.x >= row.L) c.x -= row.L;
        }
      } else if (row.type === 'deer') {
        if (row.deer.length === 0) {
          row.timer -= dt;
          if (row.timer <= 0) {
            const n = 1 + irand(3);
            for (let j = 0; j < n; j++) {
              row.deer.push({ x: row.dir > 0 ? -0.5 - j * 1.4 : row.L + 0.5 + j * 1.4, w: 0.75 });
            }
            events.push({ type: 'gallop', r });
          }
        } else {
          for (const d of row.deer) d.x += row.dir * row.speed * dt;
          row.deer = row.deer.filter(d => d.x > -2 && d.x < row.L + 2);
          if (row.deer.length === 0) row.timer = 3.5 + Math.random() * 5.5;
        }
      }
    }
    updateTractors(dt, cam);
  }

  function drainEvents() {
    const e = events;
    events = [];
    return e;
  }

  window.World = { PAD, reset, update, row: r => rows.get(r), tractors: () => tractors, drainEvents };
})();
