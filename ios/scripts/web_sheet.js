// Draws the identical contact sheet through the ORIGINAL js/sprites.js.
// Kept in lockstep with HopscapeTests/SpriteSheetTests.swift.
(() => {
  const old = document.getElementById('sheet');
  if (old) old.remove();
  const cv = document.createElement('canvas');
  cv.id = 'sheet';
  cv.width = 704;
  cv.height = 960;
  cv.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;width:704px;height:960px;background:#fff';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const t = 1.234;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 704, 960);

  // ---- band rows ----
  Sprites.rainbowRow(ctx, 0, { bi: 0, bn: 1 });
  Sprites.roadRow(ctx, 128, { bi: 0, bn: 2 });
  Sprites.roadRow(ctx, 64, { bi: 1, bn: 2 });
  Sprites.riverRow(ctx, 192, { bi: 0, bn: 1 });
  Sprites.deerRow(ctx, 256, 3, {});
  Sprites.grassRow(ctx, 320, 4, {
    holes: new Set([3]),
    flowers: [{ c: 0, kind: 0, jx: 5, jy: -3 }, { c: 6, kind: 3, jx: -8, jy: 4 }, { c: 8, kind: 1, jx: 0, jy: 0 }],
    dirt: { dir: 1, edge: 8.2 },
  });

  // ---- scenery / traffic ----
  Sprites.tree(ctx, 100, 470, 5);
  Sprites.tree(ctx, 170, 470, 12);
  Sprites.tree(ctx, 240, 470, 77);
  Sprites.coin(ctx, 310, 450, t, 2);
  Sprites.cloudShadow(ctx, 430, 478, 1.5);
  Sprites.cloud(ctx, 430, 455, 1.5, t, 7, 1);
  Sprites.car(ctx, 560, 460, 1, 0, 1, t);
  Sprites.car(ctx, 650, 460, 1, 3, -1, t);

  Sprites.car(ctx, 90, 560, 1.7, 9, 1, t);
  Sprites.riverLog(ctx, 230, 555, 2);
  Sprites.lilypad(ctx, 330, 555, t, 3);
  Sprites.lilypad(ctx, 390, 555, t, 9);
  Sprites.deer(ctx, 470, 560, 1);
  Sprites.tractor(ctx, 570, 560, 1, t);
  Sprites.scorch(ctx, 660, 560);

  Sprites.rocket(ctx, 80, 700, { c: 0, phase: 'idle', t: 0 }, t);
  Sprites.rocket(ctx, 170, 700, { c: 0, phase: 'arm', t: 0.5 }, t);
  Sprites.rocket(ctx, 260, 700, { c: 0, phase: 'fly', t: 0.35 }, t);
  Sprites.plane(ctx, 420, 650, 1, t);
  Sprites.eagle(ctx, 540, 650, t, false);
  Sprites.eagle(ctx, 640, 650, t, true);

  // ---- animals ----
  Sprites.animal(ctx, 'cat', 70, 840, { t });
  Sprites.animal(ctx, 'dog', 150, 840, { t });
  Sprites.animal(ctx, 'bunny', 230, 840, { t });
  Sprites.animal(ctx, 'duck', 310, 840, { t });
  Sprites.animal(ctx, 'duck', 390, 840, { t, air: true });
  Sprites.animal(ctx, 'cat', 470, 840, { t, dead: true });
  Sprites.animal(ctx, 'bunny', 550, 840, { t, flip: true, lean: 0.5 });
  Sprites.animal(ctx, 'dog', 630, 840, { t, squash: 0.9, z: 10 });

  // ---- canvas text paths ----
  Sprites.bestLine(ctx, 930, 54);
  ctx.globalAlpha = 1;
  ctx.font = '800 20px "Arial Rounded MT Bold", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#b57e0a';
  ctx.strokeText('+1', 500, 920);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText('+1', 500, 920);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ff5a5f';
  ctx.beginPath();
  ctx.arc(600, 915, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '900 18px "Arial Rounded MT Bold", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('!', 600, 921);
  ctx.textAlign = 'left';
  return 'sheet drawn';
})();
