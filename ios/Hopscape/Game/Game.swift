import CoreGraphics
import Foundation

// Hopscape — game loop, input, camera, collisions, and UI screens
// Direct port of js/main.js. The DOM writes (score text, overlay visibility,
// special-button state, character cards) go through GameUIDelegate so the
// logic here stays line-comparable with the JS.

private let T = CFG.TILE
private let COLS = CFG.COLS
private let W = CFG.W
private var H: CGFloat { CFG.H } // tracks the screen aspect; see Config.swift

// JS Math.round: half-up (Math.round(-0.5) === 0)
@inline(__always) private func jsRound(_ x: CGFloat) -> Int { Int(floor(x + 0.5)) }
@inline(__always) private func sign(_ x: CGFloat) -> Int { x > 0 ? 1 : (x < 0 ? -1 : 0) }

protocol GameUIDelegate: AnyObject {
    func setScoreText(_ s: String)
    func setCoinsText(_ s: String)
    func showHud(_ on: Bool)
    func showMenu(_ on: Bool)
    func showOver(_ on: Bool)
    func showPaused(_ on: Bool)
    func setMenuStats(best: Int, coins: Int)
    func setGameOver(title: String, reason: String, score: Int, isBest: Bool, best: Int, coins: Int)
    func setAbilityLine(_ s: String)
    func setSelectedCard(_ i: Int)
    func refreshSpecialButton(text: String, cooling: Bool)
    func renderMenuCards(t: CGFloat, selected: Int)
}

enum GameState { case menu, play, dying, over }

struct PlaneObj {
    let row: Int
    let dir: CGFloat
    var x: CGFloat
    let speed: CGFloat
}
struct TrailObj {
    let row: Int
    var age: CGFloat
}
struct Particle {
    var kind: String
    var x: CGFloat
    var wy: CGFloat
    var t: CGFloat = 0
    var vx: CGFloat = 0
    var vy: CGFloat = 0
    var life: CGFloat = 1
    var text = ""
    var spin: CGFloat = 1
}

// world-row → screen-y of a character's feet
func rowFeetY(_ rf: CGFloat, _ camY: CGFloat) -> CGFloat {
    return H - (rf - camY + 1) * T + T * 0.74
}

final class Game {
    weak var ui: GameUIDelegate?

    struct Ability {
        let cd: CGFloat
        let emoji: String
        let desc: String
    }
    static let ABILITY: [String: Ability] = [
        "cat": Ability(cd: 4, emoji: "🐾", desc: "🐾 Long Leap — pounce 2 rows in one big bound!"),
        "dog": Ability(cd: 5, emoji: "💨", desc: "💨 Dash — zoom 3 squares ahead in a flash!"),
        "bunny": Ability(cd: 5, emoji: "🌟", desc: "🌟 Double Jump — SPACE to hop, quick SPACE again mid-air!"),
        "duck": Ability(cd: 7, emoji: "🪶", desc: "🪶 Fly — flap up and soar 3 rows over everything!"),
    ]

    // ---------- state ----------
    private(set) var state: GameState = .menu // menu | play | dying | over
    private(set) var paused = false
    private var tGlobal: CGFloat = 0
    private(set) var selected: Int
    private var best: Int
    private var totalCoins: Int
    private var specialCd: CGFloat = 0
    // obstacles: airplanes (+ lingering contrails) and the idle-punishing eagle
    private let TRAIL_LIFE: CGFloat = 8
    private var planes: [PlaneObj] = []
    private var trails: [TrailObj] = []
    private var planeTimer: CGFloat = 6
    private var idleT: CGFloat = 0
    private var honkCd: CGFloat = 0
    // eagleState: none (not around) -> active (circling, about to dive and grab)
    // -> flee (missed its grab because you moved — wings off instead of vanishing)
    private var eagleState = "none"
    private var eagleT: CGFloat = 0
    private var eagleFleeDir: CGFloat = 1

    private var cam: CGFloat = -4
    private var menuCam: CGFloat = -4
    private var graceT: CGFloat = 0
    private var score = 0
    private var runCoins = 0
    private var dieT: CGFloat = 0
    private var deathCause = ""
    private var shake: CGFloat = 0
    private var particles: [Particle] = []

    final class Chr {
        var row = 2
        var col = 5
        var fromR: CGFloat = 2
        var fromC: CGFloat = 5
        var toR = 2
        var toC = 5
        var rowF: CGFloat = 2
        var colF: CGFloat = 5
        var hopping = false
        var hopT: CGFloat = 0
        var squashT: CGFloat = 9
        var hopDur: CGFloat = 0.115
        var hopH: CGFloat = 22
        var air = false
        var z0: CGFloat = 0
        var lastDr = 1
        var lastDc = 0
        var teeter: CGFloat?
        var flip = false
        var lean: CGFloat = 0
        var queued: (Int, Int)?
        var bump: (dr: Int, dc: Int, t: CGFloat)?
        var dead = false
        var drift: CGFloat = 0
    }
    private let chr = Chr()

    init() {
        selected = UserDefaults.standard.object(forKey: "hs_char") as? Int ?? 0
        best = UserDefaults.standard.object(forKey: "hs_best") as? Int ?? 0
        totalCoins = UserDefaults.standard.object(forKey: "hs_coins") as? Int ?? 0
        selected = ((selected % 4) + 4) % 4
    }

    private func resetChr() {
        chr.row = 2; chr.col = 5; chr.fromR = 2; chr.fromC = 5; chr.toR = 2; chr.toC = 5
        chr.rowF = 2; chr.colF = 5; chr.hopping = false; chr.hopT = 0; chr.squashT = 9
        chr.hopDur = 0.115; chr.hopH = 22; chr.air = false; chr.z0 = 0
        chr.lastDr = 1; chr.lastDc = 0; chr.teeter = nil
        chr.flip = false; chr.lean = 0; chr.queued = nil; chr.bump = nil; chr.dead = false; chr.drift = 0
    }

    private func resetRun() {
        World.reset()
        resetChr()
        cam = CGFloat(chr.row) - 6
        graceT = 0; score = 0; runCoins = 0; dieT = 0; shake = 0
        specialCd = 0
        planes = []; trails = []; planeTimer = 5 + rnd() * 4
        idleT = 0; eagleState = "none"; eagleT = 0; honkCd = 0
        particles = []
        ui?.setScoreText("0")
        ui?.setCoinsText("0")
    }

    private func baseHopDur() -> CGFloat {
        let id = Sprites.ANIMALS[selected].id
        if id == "dog" { return 0.092 }   // speedy paws
        if id == "bunny" { return 0.15 }  // floaty hops = a bigger double-jump window
        return 0.115
    }

    // ---------- particles (world-anchored so they scroll with the camera) ----------
    private func camBase(_ c: CGFloat) -> CGFloat { H + c * T }
    // NOTE: like the JS, wy is always anchored against the PLAY cam even for
    // menu-time events — a quirk kept intentionally (menu treefall particles
    // end up off-screen there too).
    private func spawnP(_ kind: String, _ sx: CGFloat, _ sy: CGFloat, life: CGFloat,
                        vx: CGFloat = 0, vy: CGFloat = 0, text: String = "", spin: CGFloat = 1) {
        particles.append(Particle(kind: kind, x: sx, wy: camBase(cam) - sy, t: 0,
                                  vx: vx, vy: vy, life: life, text: text, spin: spin))
    }
    private func coinBurst(_ sx: CGFloat, _ sy: CGFloat) {
        for _ in 0..<7 {
            let a = rnd() * .pi * 2
            spawnP("spark", sx, sy, life: 0.5, vx: cos(a) * 90, vy: -60 - rnd() * 90)
        }
        spawnP("txt", sx, sy - 14, life: 0.8, text: "+1")
    }
    private func rainBurst(_ sx: CGFloat, _ sy: CGFloat) {
        for _ in 0..<16 {
            let a = rnd() * .pi * 2
            spawnP("drop", sx, sy - 15, life: 0.7, vx: cos(a) * (60 + rnd() * 120), vy: -80 - rnd() * 140)
        }
    }
    private func updateParticles(_ dt: CGFloat) {
        for i in particles.indices {
            particles[i].t += dt
            if particles[i].kind == "spark" || particles[i].kind == "drop" {
                particles[i].vy += 500 * dt
                particles[i].x += particles[i].vx * dt
                particles[i].wy -= particles[i].vy * dt
            } else if particles[i].kind == "txt" {
                particles[i].wy += 46 * dt
            } else if particles[i].kind == "poof" {
                particles[i].wy += 12 * dt
            }
        }
        particles = particles.filter { $0.t < $0.life }
    }
    private func drawParticles(_ ctx: Canvas2D, _ camY: CGFloat) {
        for p in particles {
            let sy = camBase(camY) - p.wy
            let k = 1 - p.t / p.life
            if p.kind == "spark" {
                ctx.fillStyle = "rgba(255,210,62,\(0.9 * k))"
                ctx.beginPath(); ctx.arc(p.x, sy, 3.2, 0, .pi * 2); ctx.fill()
            } else if p.kind == "drop" {
                ctx.fillStyle = "rgba(96,170,255,\(0.9 * k))"
                ctx.beginPath(); ctx.arc(p.x, sy, 3, 0, .pi * 2); ctx.fill()
            } else if p.kind == "poof" {
                ctx.fillStyle = "rgba(255,255,255,\(0.4 * k))"
                ctx.beginPath(); ctx.arc(p.x, sy, 5 + (1 - k) * 9, 0, .pi * 2); ctx.fill()
            } else if p.kind == "treefall" {
                // a little tree tipping over and fading out
                ctx.save()
                ctx.translate(p.x, sy)
                ctx.rotate((1 - k) * 1.5 * p.spin)
                ctx.globalAlpha = min(1, k * 1.6)
                ctx.fillStyle = "#8a5a33"
                ctx.fillRect(-4, -16, 8, 16)
                ctx.fillStyle = "#47ab59"
                ctx.beginPath(); ctx.arc(0, -26, 14, 0, .pi * 2); ctx.fill()
                ctx.globalAlpha = 1
                ctx.restore()
            } else if p.kind == "txt" {
                ctx.globalAlpha = min(1, k * 2)
                ctx.setFont(weight: 800, size: 20)
                ctx.textAlign = .center
                ctx.lineWidth = 4
                ctx.strokeStyle = "#b57e0a"
                ctx.strokeText(p.text, p.x, sy)
                ctx.fillStyle = "#ffe9a8"
                ctx.fillText(p.text, p.x, sy)
                ctx.textAlign = .left
                ctx.globalAlpha = 1
            }
        }
    }

    // ---------- movement ----------
    // is world-column-center cx currently over a log in this river row?
    private func logUnder(_ row: Row, _ cx: CGFloat) -> Bool {
        for l in row.logs {
            let wx = l.x - World.PAD
            if abs(wx - cx) < l.w / 2 + 0.15 { return true }
        }
        return false
    }
    // any successful move/special resets the idle clock; if the eagle was
    // circling or diving in, this is the dodge — it flies off instead of
    // just vanishing
    private func notifyMoved() {
        idleT = 0
        if eagleState == "active" {
            eagleState = "flee"
            eagleT = 0
            eagleFleeDir = rnd() < 0.5 ? -1 : 1
        }
    }
    func tryMove(_ dr: Int, _ dc: Int) {
        if state != .play || paused { return }
        if chr.hopping { chr.queued = (dr, dc); return }
        doMove(dr, dc)
    }
    private func doMove(_ dr: Int, _ dc: Int) {
        if chr.teeter != nil { return } // teetering over a hole — only a double jump saves you
        func bumped() { chr.bump = (dr: dr, dc: dc, t: 0); Sfx.bump() }
        if dc != 0 { chr.flip = dc < 0 }
        let baseC = jsRound(CGFloat(chr.col) + chr.drift) // a log ride may have carried us off-grid
        let tr = chr.row + dr, tc = baseC + dc
        let minRow = max(0, Int(ceil(cam - 0.2)))
        if tc < 0 || tc >= COLS || tr < minRow { return bumped() }
        let row = World.row(tr)
        if let row, row.trees.contains(tc) { return bumped() }
        if let row, let rk = row.rocket, rk.c == tc, rk.phase == .idle || rk.phase == .arm { return bumped() }
        chr.fromR = CGFloat(chr.row); chr.fromC = CGFloat(chr.col) + chr.drift
        chr.toR = tr; chr.toC = tc
        chr.drift = 0
        chr.hopping = true
        chr.hopT = 0
        chr.hopDur = baseHopDur()
        chr.hopH = Sprites.ANIMALS[selected].id == "bunny" ? 27 : 22
        chr.air = false
        chr.z0 = 0
        chr.lean = CGFloat(dc)
        notifyMoved()
        spawnP("poof", (chr.fromC + 0.5) * T, rowFeetY(CGFloat(chr.row), cam), life: 0.3)
        Sfx.hop()
    }

    func useSpecial() {
        if state != .play || paused || chr.dead || specialCd > 0 { return }
        let id = Sprites.ANIMALS[selected].id
        if id == "bunny" { return doubleJump() }
        if chr.hopping { return } // everyone else launches from the ground
        notifyMoved()
        let baseC = jsRound(CGFloat(chr.col) + chr.drift) // a log ride may have carried us off-grid
        if id == "dog" {
            // ground dash: sprint up to 3 rows ahead — leaps clean over holes,
            // but skids to a stop before solid obstacles (trees, rockets)
            var tr = chr.row
            for i in 1...3 {
                let row = World.row(chr.row + i)
                if let row, row.trees.contains(baseC) ||
                    (row.rocket != nil && row.rocket!.c == baseC && row.rocket!.phase != .gone) { break }
                if !(row != nil && row!.holes.contains(baseC)) { tr = chr.row + i } // never stop IN a hole
            }
            if tr == chr.row { chr.bump = (dr: 1, dc: 0, t: 0); Sfx.bump(); return }
            launchSpecial(tr - chr.row, 0.09 * CGFloat(tr - chr.row) + 0.06, 9)
            Sfx.boost()
        } else {
            // cat leaps 2, duck flies 3 — land short if the target is blocked
            let dist = id == "cat" ? 2 : 3
            var tr = chr.row + dist
            while tr > chr.row {
                let row = World.row(tr)
                if let row, row.trees.contains(baseC) || row.holes.contains(baseC) ||
                    (row.rocket != nil && row.rocket!.c == baseC && row.rocket!.phase != .gone) {
                    tr -= 1
                } else { break }
            }
            if tr == chr.row { chr.bump = (dr: 1, dc: 0, t: 0); Sfx.bump(); return }
            let arcs: (CGFloat, CGFloat) = id == "cat" ? (0.3, 36) : (0.7, 48)
            launchSpecial(tr - chr.row, arcs.0, arcs.1)
            Sfx.whoosh()
        }
        specialCd = Game.ABILITY[id]!.cd
    }

    private func launchSpecial(_ dr: Int, _ dur: CGFloat, _ h: CGFloat) {
        let baseC = jsRound(CGFloat(chr.col) + chr.drift) // a log ride may have carried us off-grid
        chr.fromR = CGFloat(chr.row); chr.fromC = CGFloat(chr.col) + chr.drift
        chr.toR = chr.row + dr; chr.toC = baseC
        chr.drift = 0
        chr.hopping = true
        chr.hopT = 0
        chr.air = true
        chr.hopDur = dur
        chr.hopH = h
        chr.z0 = 0
        chr.lean = 0
        spawnP("poof", (chr.fromC + 0.5) * T, rowFeetY(CGFloat(chr.row), cam), life: 0.3)
    }

    // bunny only: jump AGAIN off thin air, extending the current hop one more
    // square in the same direction. A small grace window right after landing
    // keeps the timing friendly.
    private func doubleJump() {
        var dr = 0, dc = 0
        var z0: CGFloat = 0
        var midair = false
        if chr.hopping && !chr.air {
            midair = true
            dr = sign(CGFloat(chr.toR) - chr.fromR)
            dc = sign(CGFloat(chr.toC) - chr.fromC)
            z0 = sin(.pi * min(chr.hopT, 1)) * chr.hopH
        } else if !chr.hopping && (chr.squashT < 0.15 || chr.teeter != nil) {
            midair = false // just landed (maybe teetering over a hole) — forgive it
            dr = chr.lastDr
            dc = chr.lastDc
            z0 = 0
        } else if !chr.hopping {
            // grounded: SPACE is just a regular forward hop for the bunny —
            // the special is the QUICK second press while she's in the air
            doMove(1, 0)
            return
        } else {
            return // already on a special jump
        }
        let baseR = midair ? chr.toR : chr.row
        let baseC = midair ? chr.toC : jsRound(CGFloat(chr.col) + chr.drift) // a log ride may have carried us off-grid
        let tr = baseR + dr, tc = baseC + dc
        let minRow = max(0, Int(ceil(cam - 0.2)))
        if tc < 0 || tc >= COLS || tr < minRow { return }
        let row = World.row(tr)
        if let row, row.trees.contains(tc) ||
            (row.rocket != nil && row.rocket!.c == tc && row.rocket!.phase != .gone) {
            return // nothing to land on there — the double jump fizzles, cooldown kept
        }
        chr.fromR = chr.rowF; chr.fromC = chr.colF // take off from right here, mid-air
        chr.toR = tr; chr.toC = tc
        chr.drift = 0
        chr.hopping = true
        chr.hopT = 0
        chr.hopDur = 0.17
        chr.hopH = 30
        chr.z0 = z0
        chr.air = true // the second jump is special — clouds can't touch it
        chr.teeter = nil // saved from the hole!
        if dc != 0 { chr.flip = dc < 0 }
        notifyMoved()
        specialCd = Game.ABILITY["bunny"]!.cd
        spawnP("poof", (chr.colF + 0.5) * T, rowFeetY(chr.rowF, cam) - z0, life: 0.3)
        Sfx.whoosh()
    }

    private func updateChar(_ dt: CGFloat) {
        if chr.bump != nil {
            chr.bump!.t += dt
            if chr.bump!.t > 0.13 { chr.bump = nil }
        }
        chr.squashT += dt
        if chr.hopping {
            chr.hopT += dt / chr.hopDur
            if chr.hopT >= 1 {
                chr.lastDr = sign(CGFloat(chr.toR) - chr.fromR)
                chr.lastDc = sign(CGFloat(chr.toC) - chr.fromC)
                chr.row = chr.toR; chr.col = chr.toC
                chr.hopping = false
                chr.air = false
                chr.z0 = 0
                chr.squashT = 0
                if chr.row - 2 > score {
                    score = chr.row - 2
                    ui?.setScoreText(String(score))
                }
                let row = World.row(chr.row)
                if let row, row.holes.contains(chr.col) {
                    if Sprites.ANIMALS[selected].id == "bunny" && specialCd <= 0 {
                        // teeter on the rim — a QUICK double jump can still save her!
                        chr.teeter = 0.15
                        chr.queued = nil
                        Sfx.bump()
                    } else {
                        die("hole")
                    }
                    return
                }
                if let row, row.type == .river, !row.pads.contains(chr.col),
                   !logUnder(row, CGFloat(chr.col) + 0.5) {
                    die("water") // no log or lily pad here — straight into the drink
                    return
                }
                if let row, row.coins.contains(chr.col) {
                    row.coins.remove(chr.col)
                    runCoins += 1
                    ui?.setCoinsText(String(runCoins))
                    coinBurst((CGFloat(chr.col) + 0.5) * T, rowFeetY(CGFloat(chr.row), cam) - 20)
                    Sfx.coin()
                }
                if let q = chr.queued {
                    chr.queued = nil
                    doMove(q.0, q.1)
                }
            }
        }
        if chr.hopping {
            let k = min(chr.hopT, 1)
            chr.rowF = chr.fromR + (CGFloat(chr.toR) - chr.fromR) * k
            chr.colF = chr.fromC + (CGFloat(chr.toC) - chr.fromC) * k
        } else {
            chr.rowF = CGFloat(chr.row)
            chr.colF = CGFloat(chr.col) + chr.drift
            chr.lean *= max(0, 1 - dt * 10)
        }
    }

    // while grounded on a river row, ride whatever log is underfoot (or drown
    // if it drifted out from under you); lily pads are fixed, so they're a no-op
    private func updateRiver(_ dt: CGFloat) {
        if chr.hopping || chr.dead { return }
        guard let row = World.row(chr.row), row.type == .river else { chr.drift = 0; return }
        if row.pads.contains(chr.col) { chr.drift = 0; return }
        let pos = CGFloat(chr.col) + chr.drift
        if !logUnder(row, pos + 0.5) { die("water"); return }
        chr.drift += row.dir * row.speed * dt
        let np = CGFloat(chr.col) + chr.drift
        if np < -0.5 || np > CGFloat(COLS) - 0.5 { die("water") } // carried off the edge of the river
    }

    // ---------- game flow ----------
    private func drainWorldEvents() {
        for ev in World.drainEvents() {
            switch ev {
            case .treefall(let r, let c):
                spawnP("treefall", (CGFloat(c) + 0.5) * T,
                       rowFeetY(CGFloat(r), state == .menu ? menuCam : cam),
                       life: 0.7, spin: rnd() < 0.5 ? 1 : -1)
                Sfx.crunch()
            case .tractor:
                Sfx.tractor()
            case .gallop(let r):
                if state == .play && abs(CGFloat(r) - chr.rowF) < 9 { Sfx.gallop() }
            }
        }
    }

    private func updatePlanes(_ dt: CGFloat) {
        for i in planes.indices { planes[i].x += planes[i].dir * planes[i].speed * dt }
        var i = planes.count - 1
        while i >= 0 {
            let p = planes[i]
            if (p.dir > 0 && p.x > CGFloat(COLS) + 4) || (p.dir < 0 && p.x < -4) {
                planes.remove(at: i)
                trails.append(TrailObj(row: p.row, age: 0))
            }
            i -= 1
        }
        for i in trails.indices { trails[i].age += dt }
        trails = trails.filter { $0.age < TRAIL_LIFE }
    }

    private func spawnPlane() {
        // prefer rows whose sky is clear — a lingering contrail means "just passed"
        for _ in 0..<6 {
            let r = Int(ceil(cam)) + 3 + irand(9)
            if World.row(r) == nil { continue }
            if planes.contains(where: { $0.row == r }) || trails.contains(where: { $0.row == r }) { continue }
            let dir: CGFloat = rnd() < 0.5 ? 1 : -1
            planes.append(PlaneObj(row: r, dir: dir, x: dir > 0 ? -3.5 : CGFloat(COLS) + 3.5,
                                   speed: 6.5 + rnd() * 2.5))
            Sfx.plane()
            return
        }
    }

    private func updateRockets(_ dt: CGFloat) {
        let top = Int(floor(cam)) + max(16, CFG.visRows + 1)
        var r = max(0, Int(floor(cam)) - 1)
        while r <= top {
            defer { r += 1 }
            guard let row = World.row(r), let rk = row.rocket else { continue }
            if rk.phase == .idle {
                // fuse lights when the player gets close
                let d = CGFloat(r) - chr.rowF
                if state == .play && graceT > 2 && d > -1 && d < 5.5 {
                    rk.phase = .arm
                    rk.t = 0
                    Sfx.rumble()
                }
            } else if rk.phase == .arm {
                rk.t += dt
                if rnd() < dt * 14 {
                    spawnP("poof", (CGFloat(rk.c) + 0.5) * T + (rnd() - 0.5) * 26,
                           rowFeetY(CGFloat(r), cam) + 4, life: 0.4)
                }
                if rk.t > 1.6 { rk.phase = .fly; rk.t = 0; Sfx.launch() }
            } else if rk.phase == .fly {
                rk.t += dt
                if rk.t > 1.6 { rk.phase = .gone }
            }
        }
    }

    private func updatePlay(_ dt: CGFloat) {
        updateChar(dt)
        if state != .play { return } // a hole death can end the run mid-hop
        updateRiver(dt)
        if state != .play { return } // ...and so can a river current
        if chr.teeter != nil && !chr.hopping {
            chr.teeter! -= dt
            if chr.teeter! <= 0 {
                chr.teeter = nil
                die("hole")
                return
            }
        }
        if specialCd > 0 { specialCd = max(0, specialCd - dt) }
        // dashing dog kicks up a dust trail
        if chr.air && chr.hopping && Sprites.ANIMALS[selected].id == "dog" && rnd() < dt * 40 {
            spawnP("poof", (chr.colF + 0.5) * T + (rnd() - 0.5) * 20,
                   rowFeetY(chr.rowF, cam) + 2, life: 0.35)
        }
        graceT += dt
        if graceT > 3 { cam += min(0.32 + CGFloat(score) * 0.005, 0.95) * dt }
        let tgt = chr.rowF - 4.5
        if tgt > cam { cam += (tgt - cam) * min(1, dt * 4) }
        World.update(dt, cam)
        updateParticles(dt)

        // rockets: the exhaust blast fries anything close by at liftoff
        updateRockets(dt)
        for r in [Int(floor(chr.rowF)), Int(floor(chr.rowF)) + 1] {
            guard let row = World.row(r), let rk = row.rocket else { continue }
            if rk.phase == .fly && rk.t < 0.45 &&
                abs(chr.rowF - CGFloat(r)) < 0.6 && abs(chr.colF - CGFloat(rk.c)) < 1.55 {
                return die("rocket")
            }
        }

        // airplanes
        updatePlanes(dt)
        if graceT > 4 {
            planeTimer -= dt
            if planeTimer <= 0 {
                spawnPlane()
                planeTimer = max(3.5, 6 + rnd() * 6 - CGFloat(score) * 0.03)
            }
        }
        for p in planes {
            if abs(chr.rowF - CGFloat(p.row)) < 0.45 && abs(p.x - (chr.colF + 0.5)) < 1.05 {
                return die("plane")
            }
        }

        // the eagle circles when you dawdle, then dives in fast to grab you —
        // move before it lands the grab and it flies off empty-taloned instead
        idleT += dt
        if eagleState == "none" {
            if idleT > 3.2 { eagleState = "active"; eagleT = 0; Sfx.screech() }
        } else if eagleState == "active" {
            eagleT += dt
            if idleT > 5 { return die("eagle") }
        } else if eagleState == "flee" {
            eagleT += dt
            if eagleT > 0.8 { eagleState = "none"; eagleT = 0 }
        }

        drainWorldEvents()

        // moving hazard collision (checked against the hop-interpolated position);
        // special moves are airborne mid-flight and pass safely over ground hazards
        let airSafe = chr.air && chr.hopping && chr.hopT > 0.06 && chr.hopT < 0.94
        if !airSafe {
            let cx = chr.colF + 0.5
            for r in [Int(floor(chr.rowF)), Int(floor(chr.rowF)) + 1] {
                if abs(chr.rowF - CGFloat(r)) > 0.45 { continue }
                guard let row = World.row(r) else { continue }
                let traffic: ([Mover], String)? = row.type == .rainbow ? (row.clouds, "cloud")
                    : row.type == .road ? (row.cars, "car")
                    : row.type == .deer ? (row.deer, "deer") : nil
                guard let traffic else { continue }
                for c in traffic.0 {
                    let wx = c.x - World.PAD
                    let cw = c.w != 0 ? c.w : 0.8
                    if abs(wx - cx) < (cw / 2 + 0.3) * 0.9 { return die(traffic.1) }
                }
            }
            for tt in World.tractors() {
                if abs(chr.rowF - CGFloat(tt.row)) < 0.5 && abs(tt.x - cx) < 1.05 {
                    return die("tractor")
                }
            }
        }

        // a polite warning honk when a car is bearing down on you
        if honkCd > 0 { honkCd -= dt }
        else {
            if let rr = World.row(jsRound(chr.rowF)), rr.type == .road {
                for c in rr.cars {
                    let gap = (c.x - World.PAD - (chr.colF + 0.5)) * (rr.dir > 0 ? -1 : 1)
                    if gap > 0.8 && gap < 3 { Sfx.honk(); honkCd = 2.5; break }
                }
            }
        }

        if chr.rowF - cam < -0.85 { return die("swept") }
    }

    private func die(_ cause: String) {
        if state != .play { return }
        state = .dying
        deathCause = cause
        chr.dead = true
        chr.hopping = false
        chr.queued = nil
        dieT = 0
        if cause == "cloud" {
            shake = 0.3
            rainBurst((chr.colF + 0.5) * T, rowFeetY(chr.rowF, cam))
            Sfx.splash()
        } else if cause == "plane" || cause == "tractor" {
            shake = 0.3
            Sfx.crash()
        } else if cause == "car" {
            shake = 0.3
            Sfx.honk()
            Sfx.crash()
        } else if cause == "deer" {
            shake = 0.25
            Sfx.gallop()
            Sfx.bump()
        } else if cause == "hole" {
            spawnP("poof", (chr.colF + 0.5) * T, rowFeetY(chr.rowF, cam), life: 0.35)
            Sfx.fall()
        } else if cause == "water" {
            shake = 0.2
            rainBurst((chr.colF + 0.5) * T, rowFeetY(chr.rowF, cam))
            Sfx.splash()
        } else if cause == "eagle" {
            Sfx.screech()
        } else if cause == "rocket" {
            shake = 0.35
            rainBurst((chr.colF + 0.5) * T, rowFeetY(chr.rowF, cam))
            Sfx.crash()
        }
    }

    private func updateDying(_ dt: CGFloat) {
        dieT += dt
        if shake > 0 { shake = max(0, shake - dt) }
        World.update(dt, cam)
        updatePlanes(dt)
        updateRockets(dt)
        updateParticles(dt)
        drainWorldEvents()
        if dieT > (deathCause == "eagle" ? 1.4 : 0.95) { finishGameOver() }
    }

    private func finishGameOver() {
        if state != .dying { return }
        state = .over
        let isBest = score > best && score > 0
        if isBest {
            best = score
            UserDefaults.standard.set(best, forKey: "hs_best")
        }
        totalCoins += runCoins
        UserDefaults.standard.set(totalCoins, forKey: "hs_coins")
        let OVER: [String: (String, String)] = [
            "cloud": ("Splash! 💦", "A grumpy rain cloud soaked you!"),
            "swept": ("Oh no! 🌧️", "The storm caught up with you!"),
            "hole": ("Whoops! 🕳️", "You fell down a hole!"),
            "water": ("Sunk! 🌊", "You slipped into the river with no log to ride!"),
            "plane": ("Bonk! ✈️", "An airplane zoomed right into you!"),
            "eagle": ("Snatched! 🦅", "An eagle grabbed you for standing still too long!"),
            "rocket": ("Blast off! 🚀", "You got caught in a spaceship launch!"),
            "car": ("Honk! 🚗", "A speedy car bumped right into you!"),
            "deer": ("Oof! 🦌", "A bounding deer bowled you over!"),
            "tractor": ("Squish! 🚜", "A tractor rolled right over you!"),
        ]
        let info = OVER[deathCause] ?? OVER["swept"]!
        ui?.setGameOver(title: info.0, reason: info.1, score: score,
                        isBest: isBest, best: best, coins: runCoins)
        ui?.showOver(true)
        Sfx.over()
        if isBest { Sfx.best() }
    }

    func startGame() {
        resetRun()
        state = .play
        paused = false
        ui?.showMenu(false)
        ui?.showOver(false)
        ui?.showPaused(false)
        ui?.showHud(true)
        Sfx.start()
    }

    func toMenu() {
        state = .menu
        paused = false
        World.reset()
        planes = []; trails = []
        menuCam = -4
        ui?.setMenuStats(best: best, coins: totalCoins)
        ui?.showMenu(true)
        ui?.showOver(false)
        ui?.showPaused(false)
        ui?.showHud(false)
    }

    func togglePause(_ v: Bool? = nil) {
        if state != .play { return }
        paused = v ?? !paused
        ui?.showPaused(paused)
    }

    // ---------- rendering ----------
    private func drawWorld(_ ctx: Canvas2D, _ camY: CGFloat) {
        ctx.save()
        if shake > 0 {
            ctx.translate((rnd() - 0.5) * 9 * (shake / 0.3), (rnd() - 0.5) * 9 * (shake / 0.3))
        }
        let rBot = Int(floor(camY))
        let rTop = Int(floor(camY + H / T)) + 1

        // ground
        for r in rBot...rTop {
            let y = H - (CGFloat(r) - camY + 1) * T
            let row = World.row(r)
            if let row, row.type == .rainbow { Sprites.rainbowRow(ctx, y, row) }
            else if let row, row.type == .road { Sprites.roadRow(ctx, y, row) }
            else if let row, row.type == .deer { Sprites.deerRow(ctx, y, r, row) }
            else if let row, row.type == .river { Sprites.riverRow(ctx, y, row) }
            else { Sprites.grassRow(ctx, y, r, row) }
        }

        // best-score marker line
        if best >= 3 {
            let by = H - (CGFloat(best + 2) - camY + 1) * T
            if by > -40 && by < H + 40 { Sprites.bestLine(ctx, by, best) }
        }

        // objects, far rows first so near things overlap them
        let charRow = Int(floor(chr.rowF))
        var r = rTop
        while r >= rBot {
            defer { r -= 1 }
            let row = World.row(r)
            let y = H - (CGFloat(r) - camY + 1) * T
            if let row {
                if row.type == .grass {
                    for c in row.coins {
                        Sprites.coin(ctx, (CGFloat(c) + 0.5) * T, y + T * 0.52, tGlobal, CGFloat(c))
                    }
                    if let rk = row.rocket {
                        let rx = (CGFloat(rk.c) + 0.5) * T, ry = y + T * 0.82
                        if rk.phase == .idle || rk.phase == .arm { Sprites.rocket(ctx, rx, ry, rk, tGlobal) }
                        else { Sprites.scorch(ctx, rx, ry) }
                    }
                    for c in row.trees {
                        Sprites.tree(ctx, (CGFloat(c) + 0.5) * T, y + T * 0.82, CGFloat(r * 31 + c * 7))
                    }
                } else if row.type == .rainbow {
                    for c in row.clouds {
                        let cx = (c.x - World.PAD) * T
                        Sprites.cloudShadow(ctx, cx, y + T * 0.78, c.w)
                        Sprites.cloud(ctx, cx, y + T * 0.42, c.w, tGlobal, c.seed, row.dir)
                    }
                } else if row.type == .road {
                    for c in row.cars {
                        Sprites.car(ctx, (c.x - World.PAD) * T, y + T * 0.66, c.w, c.kind, row.dir, tGlobal + c.seed)
                    }
                } else if row.type == .deer {
                    for d in row.deer {
                        Sprites.deer(ctx, (d.x - World.PAD) * T, y + T * 0.72, row.dir)
                    }
                } else if row.type == .river {
                    for l in row.logs { Sprites.riverLog(ctx, (l.x - World.PAD) * T, y + T * 0.62, l.w) }
                    for c in row.pads {
                        Sprites.lilypad(ctx, (CGFloat(c) + 0.5) * T, y + T * 0.58, tGlobal, CGFloat(c))
                    }
                }
                for tt in World.tractors() {
                    if tt.row == r { Sprites.tractor(ctx, tt.x * T, y + T * 0.72, tt.dir, tGlobal) }
                }
            }
            if r == charRow && state != .menu { drawChar(ctx, camY) }
        }

        drawParticles(ctx, camY)

        // ---- sky layer: launching rockets, contrails, airplanes, warnings, circling eagle ----
        for r in rBot...rTop {
            if let row = World.row(r), let rk = row.rocket, rk.phase == .fly {
                let y = H - (CGFloat(r) - camY + 1) * T
                Sprites.rocket(ctx, (CGFloat(rk.c) + 0.5) * T, y + T * 0.82, rk, tGlobal)
            }
        }
        func skyY(_ r: Int) -> CGFloat { H - (CGFloat(r) - camY + 1) * T + T * 0.38 }
        for l in trails {
            let y = skyY(l.row)
            if y < -30 || y > H + 30 { continue }
            let a = (1 - l.age / TRAIL_LIFE) * 0.5
            ctx.strokeStyle = "rgba(255,255,255,\(a))"
            ctx.lineWidth = 7
            ctx.lineCap = .round
            ctx.beginPath()
            ctx.moveTo(-10, y)
            ctx.lineTo(W + 10, y)
            ctx.stroke()
            ctx.fillStyle = "rgba(255,255,255,\(a * 0.7))"
            var px = 20
            while CGFloat(px) < W {
                ctx.beginPath()
                ctx.arc(CGFloat(px + l.row * 37 % 30), y, CGFloat(6 + (px * 13 + l.row * 7) % 4), 0, .pi * 2)
                ctx.fill()
                px += 56
            }
        }
        for p in planes {
            let y = skyY(p.row)
            if y < -40 || y > H + 40 { continue }
            let px = p.x * T
            // contrail streaming back to the edge it came from
            let tail = px - p.dir * 42
            let edge: CGFloat = p.dir > 0 ? -20 : W + 20
            let g = ctx.createLinearGradient(edge, 0, tail, 0)
            g.addColorStop(0, "rgba(255,255,255,0.1)")
            g.addColorStop(1, "rgba(255,255,255,0.75)")
            ctx.setStroke(g)
            ctx.lineWidth = 7
            ctx.lineCap = .round
            ctx.beginPath()
            ctx.moveTo(edge, y)
            ctx.lineTo(tail, y)
            ctx.stroke()
            if px > -60 && px < W + 60 {
                ctx.fillStyle = "rgba(20,30,50,0.15)"
                ctx.beginPath()
                ctx.ellipse(px, y + T * 0.5, 30, 6, 0, 0, .pi * 2)
                ctx.fill()
                Sprites.plane(ctx, px, y, p.dir, tGlobal)
            } else {
                // incoming! flashing warning at the edge it will enter from
                if sin(tGlobal * 12) > -0.3 {
                    let wx: CGFloat = p.dir > 0 ? 22 : W - 22
                    ctx.fillStyle = "#ff5a5f"
                    ctx.beginPath()
                    ctx.arc(wx, y, 13, 0, .pi * 2)
                    ctx.fill()
                    ctx.fillStyle = "#fff"
                    ctx.setFont(weight: 900, size: 18)
                    ctx.textAlign = .center
                    ctx.fillText("!", wx, y + 6)
                    ctx.textAlign = .left
                }
            }
        }
        if state == .play && eagleState != "none" {
            let px = (chr.colF + 0.5) * T
            let py = rowFeetY(chr.rowF, cam)
            if eagleState == "active" {
                // circling overhead — move or else!
                ctx.fillStyle = "rgba(0,0,0,\(0.1 + 0.08 * sin(tGlobal * 8)))"
                ctx.beginPath()
                ctx.ellipse(px, py, 26 + sin(tGlobal * 8) * 4, 9, 0, 0, .pi * 2)
                ctx.fill()
                Sprites.eagle(ctx, px + sin(tGlobal * 2.6) * 46, py - 165 - sin(tGlobal * 5) * 9, tGlobal, false)
            } else {
                // flee: you dodged — it wings off to one side instead of vanishing
                let k = min(eagleT / 0.8, 1)
                let ex = px + sin(tGlobal * 2.6) * 46 * (1 - k) + eagleFleeDir * k * k * 520
                let ey = py - 165 - sin(tGlobal * 5) * 9 * (1 - k) - k * k * 300
                Sprites.eagle(ctx, ex, ey, tGlobal, false)
            }
        }

        // soft edge vignette
        var g = ctx.createLinearGradient(0, 0, 60, 0)
        g.addColorStop(0, "rgba(20,45,20,0.18)")
        g.addColorStop(1, "rgba(20,45,20,0)")
        ctx.setFill(g)
        ctx.fillRect(0, 0, 60, H)
        g = ctx.createLinearGradient(W, 0, W - 60, 0)
        g.addColorStop(0, "rgba(20,45,20,0.18)")
        g.addColorStop(1, "rgba(20,45,20,0)")
        ctx.setFill(g)
        ctx.fillRect(W - 60, 0, 60, H)

        // danger glow when the storm is close behind
        if state == .play {
            let dz = chr.rowF - camY
            if dz < 2.2 {
                let a = min(1, (2.2 - dz) / 2.2) * (0.28 + 0.12 * sin(tGlobal * 7))
                let dg = ctx.createLinearGradient(0, H, 0, H - 150)
                dg.addColorStop(0, "rgba(255,60,60,\(a))")
                dg.addColorStop(1, "rgba(255,60,60,0)")
                ctx.setFill(dg)
                ctx.fillRect(0, H - 150, W, 150)
            }
        }
        ctx.restore()
    }

    private func drawChar(_ ctx: Canvas2D, _ camY: CGFloat) {
        let x = (chr.colF + 0.5) * T
        let y = rowFeetY(chr.rowF, camY)
        var bx: CGFloat = 0, by: CGFloat = 0
        if let bump = chr.bump {
            let k = sin(.pi * bump.t / 0.13) * 7
            bx = CGFloat(bump.dc) * k
            by = -CGFloat(bump.dr) * k
        }
        let k = min(chr.hopT, 1)
        var z: CGFloat = chr.hopping ? chr.z0 * (1 - k) + sin(.pi * k) * chr.hopH : 0
        if chr.teeter != nil && !chr.hopping { z = -6 } // sinking into the hole rim!
        var squash: CGFloat = 1
        if chr.hopping { squash = 1.06 }
        else if chr.squashT < 0.1 { squash = 1 - 0.2 * sin(.pi * chr.squashT / 0.1) }
        var shrink: CGFloat? = nil
        if chr.dead && (deathCause == "hole" || deathCause == "water") { shrink = max(0, 1 - dieT * 1.5) }
        if chr.dead && deathCause == "eagle" { z += max(0, dieT - 0.4) * 300 } // carried away
        var opts = Sprites.AnimalOpts()
        opts.t = tGlobal
        opts.z = z
        opts.squash = squash
        opts.shrink = shrink
        opts.flip = chr.flip
        opts.lean = chr.hopping ? chr.lean * 0.6 : 0
        opts.air = chr.air && chr.hopping
        opts.dead = chr.dead && ["cloud", "plane", "car", "deer", "tractor"].contains(deathCause)
        opts.seed = 1.7
        Sprites.animal(ctx, Sprites.ANIMALS[selected].id, x + bx, y + by, opts)
        if chr.dead && deathCause == "eagle" {
            let dive = min(dieT / 0.4, 1)
            let ey = y - z - 52 - (1 - dive) * 480
            Sprites.eagle(ctx, x, ey, tGlobal, true)
        }
    }

    // ---------- character select ----------
    func selectChar(_ i: Int) {
        selected = ((i % 4) + 4) % 4
        UserDefaults.standard.set(selected, forKey: "hs_char")
        ui?.setSelectedCard(selected)
        ui?.setAbilityLine(Game.ABILITY[Sprites.ANIMALS[selected].id]!.desc)
    }

    func cardTapped(_ i: Int) {
        Sfx.unlock()
        selectChar(i)
        Sfx.select()
    }

    // ---------- input (ported from the keydown handler) ----------
    // dir maps: ArrowUp/w -> (1,0), ArrowDown/s -> (-1,0), ArrowLeft/a -> (0,-1), ArrowRight/d -> (0,1)
    func keyDown(_ key: String) {
        Sfx.unlock()
        let KEYS: [String: (Int, Int)] = [
            "ArrowUp": (1, 0), "w": (1, 0),
            "ArrowDown": (-1, 0), "s": (-1, 0),
            "ArrowLeft": (0, -1), "a": (0, -1),
            "ArrowRight": (0, 1), "d": (0, 1),
        ]
        if state == .menu {
            if key == "ArrowLeft" || key == "a" { selectChar(selected - 1); Sfx.select() }
            else if key == "ArrowRight" || key == "d" { selectChar(selected + 1); Sfx.select() }
            else if key == "Enter" || key == " " { startGame() }
        } else if state == .play {
            if key == "Escape" || key == "p" { togglePause() }
            else if !paused && (key == " " || key == "Shift") { useSpecial() }
            else if !paused, let d = KEYS[key] { tryMove(d.0, d.1) }
        } else if state == .over {
            if key == "Enter" || key == " " { startGame() }
            else if key == "Escape" { toMenu() }
        }
    }

    func canvasTapped(_ swipe: (dx: CGFloat, dy: CGFloat)?) {
        guard state == .play else { return }
        guard let s = swipe else { return tryMove(1, 0) }
        if hypot(s.dx, s.dy) < 22 { tryMove(1, 0) }
        else if abs(s.dx) > abs(s.dy) { tryMove(0, s.dx > 0 ? 1 : -1) }
        else { tryMove(s.dy < 0 ? 1 : -1, 0) }
    }

    func specialButtonTapped() {
        Sfx.unlock()
        useSpecial()
    }

    func handleWindowBlur() {
        if state == .play { togglePause(true) }
    }

    private func refreshSpecialBtn() {
        if specialCd > 0 {
            ui?.refreshSpecialButton(text: String(Int(ceil(specialCd))), cooling: true)
        } else {
            ui?.refreshSpecialButton(text: Game.ABILITY[Sprites.ANIMALS[selected].id]!.emoji, cooling: false)
        }
    }

    // ---------- main loop ----------
    func boot() {
        // buildCards() happens UI-side; mirror its selectChar(selected) call + toMenu()
        selectChar(selected)
        toMenu()
    }

    private var last: TimeInterval?

    // per-frame update; rendering happens in render(into:) right after
    func step(now: TimeInterval) {
        let dt = CGFloat(min(now - (last ?? now), 0.05))
        last = now
        tGlobal += dt
        if state == .play && !paused { updatePlay(dt) }
        else if state == .dying { updateDying(dt) }
        else if state == .menu {
            menuCam += dt * 0.45
            World.update(dt, menuCam)
            updateParticles(dt)
            drainWorldEvents()
        }
        if state == .menu { ui?.renderMenuCards(t: tGlobal, selected: selected) }
        else { refreshSpecialBtn() }
    }

    func render(_ ctx: Canvas2D) {
        drawWorld(ctx, state == .menu ? menuCam : cam)
    }

    // for the menu cards (drawCards ports to CardView, which needs tGlobal offsets)
    var timeGlobal: CGFloat { tGlobal }
    var bestScore: Int { best }
    var coinTotal: Int { totalCoins }
}
