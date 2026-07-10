# Hopscape 🌈

A cute Crossy Road-style hopping game. Pick your animal, hop across rainbow roads,
dodge the grumpy rain clouds, weave around the trees, and grab coins on the grass —
all while the storm creeps up behind you!

## How to play

**Just open `index.html` in any browser.** No install, no build step, no internet needed.

(Or run a little server if you prefer: `python3 -m http.server 4173` in this folder,
then visit http://localhost:4173)

### Controls

| Input | Action |
|---|---|
| Arrow keys / WASD / Space | Hop (up, down, left, right) |
| Tap or swipe (mobile) | Hop / hop in swipe direction |
| Esc or P | Pause |
| Enter | Start / play again |

### Rules

- 🐱🐶🐰🦆 Choose Mittens, Biscuit, Clover, or Puddles on the title screen
- 🌈 Rainbow roads have **rain clouds** sliding across — touch one and you're soaked!
- 🌳 Trees block your way on the grass — hop around them
- 🪙 Coins appear on the grass — hop onto them to collect
- ⛈️ Don't dawdle: the screen slowly scrolls and the storm sweeps up anyone left behind
- 🏆 Your score is how far you hop; best score and total coins are saved in your browser

## Files

| File | What's in it |
|---|---|
| `index.html` | The page, HUD, and menu/game-over/pause screens |
| `css/style.css` | All the cute chunky UI styling |
| `js/sprites.js` | Every drawing: the four animals, trees, coins, clouds, rainbows |
| `js/world.js` | Level generation: grass/rainbow bands, tree & coin placement, cloud traffic |
| `js/main.js` | Game loop, hopping, camera, collisions, score, input |
| `js/sfx.js` | Little synthesized sound effects (mute button in the corner) |

## Tuning the difficulty

Open `js/world.js`:

- **Cloud speed** — the `speed` line in `genRainbow` (higher = faster clouds)
- **Cloud spacing** — `minGap` (bigger = easier gaps to hop through)
- **Tree count** — `density` in `genGrass`
- **Coin frequency** — the `0.38` chance in `genGrass`

And in `js/main.js`, the storm's creep speed is the `0.32 + score * 0.005` line in `updatePlay`.

---

Made with [Claude Code](https://claude.com/claude-code) 🎮
