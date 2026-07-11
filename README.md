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
| Arrow keys / WASD | Hop (up, down, left, right) |
| Space / Shift / ability button | Use your special move |
| Tap or swipe (mobile) | Hop / hop in swipe direction |
| Esc or P | Pause |
| Enter | Start / play again |

### Special abilities

Every animal has a special move (press **Space** or tap the round button in the corner —
then it needs a few seconds to recharge):

| Animal | Ability | What it does |
|---|---|---|
| 🐱 Mittens the cat | **Long Leap** | Pounces 2 rows forward in one bound, sailing over trees and clouds |
| 🐶 Biscuit the pup | **Dash** | Zooms 3 squares straight ahead, leaping right over holes (trees and rockets still stop it); always hops a little faster too |
| 🐰 Clover the bunny | **Double Jump** | Press SPACE to hop, then quickly press SPACE again while she's mid-air to jump a second time off thin air, sailing one more square in the same direction |
| 🦆 Puddles the duck | **Fly** | Flaps up and soars 3 rows forward over absolutely everything |

While you're in the air on a special move, rain clouds can't touch you — but time
your takeoff and landing carefully! The bunny's second jump counts: her first hop is
a normal one, but the mid-air jump itself is cloud-proof. It works after any first
hop (arrow keys too, and in any direction), and it fizzles harmlessly if the landing
square is blocked by a tree or rocket. Best of all: if her hop lands on a hole she
teeters on the rim for a heartbeat — a lightning-quick second press jumps her out
before she falls!

### Rules

- 🐱🐶🐰🦆 Choose Mittens, Biscuit, Clover, or Puddles on the title screen
- 🌈 Rainbow roads have **rain clouds** sliding across — touch one and you're soaked!
- 🌳 Trees block your way on the grass — hop around them
- 🕳️ **Holes** hide in the grass — hop into one and down you go! (Specials are smart
  enough to never land in one)
- ✈️ **Airplanes** zoom across with a roar. They leave a **contrail** that lingers —
  a contrail means that lane is safe for a bit; a clear sky means a plane could come
  any second. Watch for the flashing red `!` at the edge, and remember: planes fly at
  wing height, so even a flying duck isn't safe!
- 🦅 Stand still too long and you'll hear a screech — an **eagle** starts circling
  overhead, and a moment later it snatches you. Keep hopping!
- 🚀 **Spaceships** wait on launch pads in the grass. Get close and the countdown
  begins — it rumbles, shakes, and puffs smoke with a flashing `!`, then blasts
  straight up into the sky. Don't be next to the pad at liftoff or the exhaust
  will toast you! (Afterwards only a harmless scorch mark remains)
- 🚗 **Paved roads** (rare) carry car and truck traffic in both directions — you'll
  even hear a warning honk when one is bearing down on you
- 🦌 **Deer crossings** are marked with yellow diamond signs — every so often a
  small herd bounds across the trail (you'll hear the galloping), and getting
  bowled over by a deer ends your run
- 🚜 **Tractors** occasionally trundle across a grassy row, knocking every tree
  flat and carving a fresh dirt road behind them. Great news: a bulldozed row is
  wide open to hop through. Bad news: the tractor itself squishes anything in
  its path, and the trees you were hiding behind are gone for good
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
- **Hole frequency** — the `0.42` chance in `genGrass`
- **Rocket frequency** — the `0.13` chance in `genGrass`
- **Coin frequency** — the `0.38` chance in `genGrass`

And in `js/main.js`:

- **Storm creep speed** — the `0.32 + score * 0.005` line in `updatePlay`
- **Plane frequency** — the `planeTimer` formula in `updatePlay` (and `TRAIL_LIFE` for how long contrails linger)
- **Eagle patience** — the `4.5` (warning) and `7.5` (strike) second thresholds in `updatePlay`

---

Made with [Claude Code](https://claude.com/claude-code) 🎮
