# Hopscape for iOS 🌈

A native UIKit/CoreGraphics port of the web game in the repo root — same world
generation, same sprites, same physics, same synthesized sound effects. No web
view, no image assets, no audio files: everything is drawn and synthesized in
code, exactly like the original.

## Build & run

Requires Xcode (project generated with [xcodegen](https://github.com/yonaskolb/XcodeGen)):

```sh
cd ios
xcodegen generate          # regenerate Hopscape.xcodeproj after adding files
open Hopscape.xcodeproj    # build & run the Hopscape scheme
```

or headless:

```sh
xcodebuild -project Hopscape.xcodeproj -scheme Hopscape \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```

## How the port maps to the web code

| iOS file | Ports | Notes |
|---|---|---|
| `Hopscape/Game/Canvas2D.swift` | the `ctx` API | CanvasRenderingContext2D semantics over CGContext: retained paths, `arcTo`, `ellipse`, gradient fills/strokes, `globalAlpha`, alphabetic-baseline text via CoreText |
| `Hopscape/Game/Sprites.swift` | `js/sprites.js` | every drawing function, constant-for-constant |
| `Hopscape/Game/World.swift` | `js/world.js` | band generation, corridor, traffic wrap, tractors, events |
| `Hopscape/Game/Game.swift` | `js/main.js` | game loop, movement/specials, collisions, camera, particles, draw order |
| `Hopscape/Game/Sfx.swift` | `js/sfx.js` | WebAudio graphs rendered sample-accurately into PCM buffers (polyBLEP band-limited square/saw, RBJ lowpass with WebAudio dB-Q, exponential ramps), played through AVAudioEngine |
| `Hopscape/UI/*` | `index.html` + `css/style.css` | HUD, menu with live animal cards, game over, pause — fonts, colors, borders, shadows and press states replicated |

`localStorage` keys (`hs_best`, `hs_coins`, `hs_char`, `hs_muted`) map to
`UserDefaults` under the same names.

## iOS-specific behavior (by design)

- **Fit to screen**: portrait stretches the logical world height beyond the
  web's 960 so the stage fills the screen edge-to-edge (more rows visible;
  difficulty is unchanged since all hazards spawn relative to the player).
  Landscape and iPad clamp to the web geometry and letterbox over the animated
  sky, like the browser. Rotation re-fits live.
- HUD corners respect the notch / home indicator.
- Hardware keyboards work with the web bindings (arrows/WASD hop, Space/Shift
  special, Esc/P pause, Enter start).
- Losing foreground pauses a running game (like the web's `blur` handler).

## Tests

`HopscapeTests` renders every sprite and text path with fixed parameters into
`/tmp/hopscape_ios_sheet.png`; `scripts/web_sheet.js` draws the identical
scene through the original `js/sprites.js` in a browser for side-by-side
comparison:

```sh
xcodebuild -project Hopscape.xcodeproj -scheme HopscapeTests \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```
