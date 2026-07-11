import CoreGraphics
import Foundation

// Hopscape — world generation: grass (trees, holes, coins, rockets), rainbow roads
// (rain clouds), paved roads (cars), deer crossings, and roaming tractors that
// flatten trees and carve dirt roads.
// Direct port of js/world.js.

@inline(__always) func rnd() -> CGFloat { CGFloat.random(in: 0..<1) }
@inline(__always) func irand(_ n: Int) -> Int { Int(rnd() * CGFloat(n)) }

struct Flower {
    let c: Int
    let kind: Int
    let jx: CGFloat
    let jy: CGFloat
}

final class Rocket {
    enum Phase { case idle, arm, fly, gone }
    let c: Int
    var phase: Phase
    var t: CGFloat
    init(c: Int, phase: Phase, t: CGFloat) {
        self.c = c
        self.phase = phase
        self.t = t
    }
}

// A moving hazard/platform in a lane: cloud, car, log, or deer.
final class Mover {
    var x: CGFloat
    var w: CGFloat
    var seed: CGFloat
    var kind: Int
    init(x: CGFloat, w: CGFloat, seed: CGFloat = 0, kind: Int = 0) {
        self.x = x
        self.w = w
        self.seed = seed
        self.kind = kind
    }
}

final class Row {
    enum Kind { case grass, rainbow, road, deer, river }
    let type: Kind
    var trees = Set<Int>()
    var holes = Set<Int>()
    var coins = Set<Int>()
    var flowers: [Flower] = []
    var rocket: Rocket?
    var clouds: [Mover] = []
    var cars: [Mover] = []
    var logs: [Mover] = []
    var pads = Set<Int>()
    var deer: [Mover] = []
    var dir: CGFloat = 1
    var speed: CGFloat = 0
    var timer: CGFloat = 0
    var L: CGFloat = 0
    var bi = 0
    var bn = 0
    var seed: CGFloat = 0
    var dirt: (dir: CGFloat, edge: CGFloat)?
    var dirtFull = false
    init(type: Kind) {
        self.type = type
    }
}

final class TractorObj {
    let row: Int
    let dir: CGFloat
    var x: CGFloat
    let speed: CGFloat
    init(row: Int, dir: CGFloat, x: CGFloat, speed: CGFloat) {
        self.row = row
        self.dir = dir
        self.x = x
        self.speed = speed
    }
}

enum WorldEvent {
    case treefall(r: Int, c: Int)
    case tractor(r: Int)
    case gallop(r: Int)
}

enum World {
    static let PAD: CGFloat = 2.5 // moving hazards travel PAD tiles past each edge before wrapping
    private static let COLS = CFG.COLS

    private static var rows: [Int: Row] = [:]
    private static var nextRow = 0
    private static var corridor = 5
    private static var nextType = "hazard"
    private static var tractorList: [TractorObj] = []
    private static var tractorTimer: CGFloat = 0
    private static var events: [WorldEvent] = []

    // Band width 1-5: the positive half of a bell curve centered on 1 —
    // mostly single rows, sometimes 2-3, rarely a whopping 4-5.
    private static func bandWidth() -> Int {
        var u: CGFloat = 0, v: CGFloat = 0
        while u == 0 { u = rnd() }
        while v == 0 { v = rnd() }
        let g = abs(sqrt(-2 * log(u)) * cos(2 * .pi * v))
        return max(1, min(5, 1 + Int(floor(g * 1.45))))
    }

    // Rivers stay short — only ever one or two rows of water to cross.
    private static func riverWidth() -> Int {
        return rnd() < 0.55 ? 1 : 2
    }

    private static func shuffle(_ a: inout [Int]) {
        var i = a.count - 1
        while i > 0 {
            let j = irand(i + 1)
            a.swapAt(i, j)
            i -= 1
        }
    }

    static func reset() {
        rows = [:]
        nextRow = 0
        corridor = 5
        nextType = "hazard"
        tractorList = []
        tractorTimer = 11 + rnd() * 8
        events = []
        genGrass(5, true)
    }

    private static func genGrass(_ n: Int, _ isStart: Bool) {
        for _ in 0..<n {
            let r = nextRow
            nextRow += 1
            // A wandering always-clear corridor guarantees the player can never get walled in.
            let prev = corridor
            corridor = max(1, min(COLS - 2, corridor + irand(3) - 1))
            let row = Row(type: .grass)
            if !(isStart && r < 3) {
                let density = min(2 + irand(3) + r / 70, 5)
                var cells: [Int] = []
                for c in 0..<COLS where c != corridor && c != prev { cells.append(c) }
                shuffle(&cells)
                var k = 0
                while k < density && k < cells.count {
                    row.trees.insert(cells[k])
                    k += 1
                }
                if r > 4 && rnd() < 0.42 {
                    let n2 = rnd() < 0.3 ? 2 : 1
                    var j = 0
                    while j < n2 && k < cells.count {
                        row.holes.insert(cells[k])
                        j += 1
                        k += 1
                    }
                }
                if r > 6 && rnd() < 0.13 && k < cells.count {
                    row.rocket = Rocket(c: cells[k], phase: .idle, t: 0)
                    k += 1
                }
            }
            if r > 2 && rnd() < 0.38 {
                var free: [Int] = []
                for c in 0..<COLS where !row.trees.contains(c) && !row.holes.contains(c)
                    && !(row.rocket != nil && row.rocket!.c == c) { free.append(c) }
                shuffle(&free)
                let k = rnd() < 0.25 ? 2 : 1
                var j = 0
                while j < k && j < free.count {
                    row.coins.insert(free[j])
                    j += 1
                }
            }
            for c in 0..<COLS {
                if !row.trees.contains(c) && !row.holes.contains(c)
                    && !(row.rocket != nil && row.rocket!.c == c) && rnd() < 0.16 {
                    row.flowers.append(Flower(c: c, kind: irand(4),
                                              jx: (rnd() - 0.5) * 30, jy: (rnd() - 0.5) * 22))
                }
            }
            rows[r] = row
        }
    }

    private static func genRainbow(_ n: Int) {
        for i in 0..<n {
            let r = nextRow
            nextRow += 1
            let row = Row(type: .rainbow)
            row.dir = rnd() < 0.5 ? -1 : 1
            row.speed = min((1.05 + rnd() * 1.05) * (1 + min(CGFloat(r) / 170, 0.8)), 3.2)
            let L = CGFloat(COLS) + PAD * 2
            let minGap = max(1.6, 3.1 - CGFloat(r) * 0.018)
            var x = rnd() * 1.5
            while x + 1.8 < L - 0.5 {
                let w = 1.25 + rnd() * 0.5
                row.clouds.append(Mover(x: x + w / 2, w: w, seed: rnd() * 100))
                x += w + minGap + rnd() * 2.1
            }
            if row.clouds.isEmpty { row.clouds.append(Mover(x: L / 2, w: 1.4, seed: rnd() * 100)) }
            row.L = L
            row.bi = i
            row.bn = n
            row.seed = rnd() * 100
            rows[r] = row
        }
    }

    private static func genRoad(_ n: Int) {
        for i in 0..<n {
            let r = nextRow
            nextRow += 1
            let row = Row(type: .road)
            row.dir = rnd() < 0.5 ? -1 : 1
            row.speed = min((1.5 + rnd() * 1.2) * (1 + min(CGFloat(r) / 170, 0.7)), 3.8)
            let L = CGFloat(COLS) + PAD * 2
            let minGap = max(2, 3.2 - CGFloat(r) * 0.015)
            var x = rnd() * 2
            while x + 2.2 < L - 0.5 {
                let truck = rnd() < 0.18
                let w = truck ? 1.7 : 1 + rnd() * 0.15
                row.cars.append(Mover(x: x + w / 2, w: w, seed: rnd() * 100, kind: truck ? 9 : irand(5)))
                x += w + minGap + rnd() * 2.4
            }
            if row.cars.isEmpty { row.cars.append(Mover(x: L / 2, w: 1, seed: 0, kind: irand(5))) }
            row.L = L
            row.bi = i
            row.bn = n
            rows[r] = row
        }
    }

    private static func genDeer(_ n: Int) {
        for _ in 0..<n {
            let r = nextRow
            nextRow += 1
            let row = Row(type: .deer)
            row.dir = rnd() < 0.5 ? -1 : 1
            row.speed = 3 + rnd() * 1.5
            row.timer = 1.5 + rnd() * 4
            row.L = CGFloat(COLS) + PAD * 2
            rows[r] = row
        }
    }

    // Rivers: each row is EITHER a lane of moving logs to time OR a scatter of
    // static lily pads to hop across — never both on the same row.
    private static func genRiver(_ n: Int) {
        for i in 0..<n {
            let r = nextRow
            nextRow += 1
            let row = Row(type: .river)
            row.dir = rnd() < 0.5 ? -1 : 1
            if rnd() < 0.55 {
                row.speed = min((0.85 + rnd() * 0.9) * (1 + min(CGFloat(r) / 170, 0.6)), 2.6)
                let L = CGFloat(COLS) + PAD * 2
                let minGap = max(1.1, 2.3 - CGFloat(r) * 0.012)
                var x = rnd() * 2
                while x + 1.6 < L - 0.5 {
                    let w = 1.6 + rnd() * 1.3
                    row.logs.append(Mover(x: x + w / 2, w: w, seed: rnd() * 100))
                    x += w + minGap + rnd() * 1.5
                }
                if row.logs.isEmpty { row.logs.append(Mover(x: L / 2, w: 2.2, seed: 0)) }
                row.L = L
            } else {
                var cells: [Int] = []
                for c in 0..<COLS { cells.append(c) }
                shuffle(&cells)
                let count = 4 + irand(3) // 4-6 static stepping stones
                for k in 0..<count { row.pads.insert(cells[k]) }
                row.speed = 0
                row.L = CGFloat(COLS) + PAD * 2
            }
            row.bi = i
            row.bn = n
            rows[r] = row
        }
    }

    private static func genBand() {
        if nextType == "hazard" {
            let roll = rnd()
            if roll < 0.48 { genRainbow(bandWidth()) }
            else if roll < 0.60 { genRoad(bandWidth()) } // paved roads stay rare
            else if roll < 0.80 { genRiver(riverWidth()) }
            else { genDeer(bandWidth()) }
            nextType = "grass"
        } else {
            genGrass(1 + irand(3), false)
            nextType = "hazard"
        }
    }

    private static func updateTractors(_ dt: CGFloat, _ cam: CGFloat) {
        tractorTimer -= dt
        if tractorTimer <= 0 {
            tractorTimer = 15 + rnd() * 14
            if tractorList.isEmpty {
                for _ in 0..<8 {
                    let r = Int(ceil(cam)) + 4 + irand(9)
                    guard let row = rows[r], row.type == .grass, row.dirt == nil,
                          !row.dirtFull, row.trees.count >= 2 else { continue }
                    let dir: CGFloat = rnd() < 0.5 ? 1 : -1
                    tractorList.append(TractorObj(row: r, dir: dir,
                                                  x: dir > 0 ? -2 : CGFloat(COLS) + 2, speed: 1.35))
                    events.append(.tractor(r: r))
                    break
                }
            }
        }
        var i = tractorList.count - 1
        while i >= 0 {
            let t = tractorList[i]
            guard let row = rows[t.row] else {
                tractorList.remove(at: i)
                i -= 1
                continue
            }
            t.x += t.dir * t.speed * dt
            // the blade flattens everything just ahead of and under the tractor
            for c in [Int(floor(t.x)), Int(floor(t.x + t.dir * 0.8))] {
                if c < 0 || c >= COLS { continue }
                if row.trees.contains(c) {
                    row.trees.remove(c)
                    events.append(.treefall(r: t.row, c: c))
                }
                row.holes.remove(c) // filled in and paved over
            }
            row.dirt = (dir: t.dir, edge: t.x)
            if (t.dir > 0 && t.x > CGFloat(COLS) + 2) || (t.dir < 0 && t.x < -2) {
                row.dirtFull = true
                row.dirt = nil
                tractorList.remove(at: i)
            }
            i -= 1
        }
    }

    static func update(_ dt: CGFloat, _ cam: CGFloat) {
        // horizons scale with the taller iOS viewport (web: fixed 20/18)
        let gen = CGFloat(max(20, CFG.visRows + 3))
        while CGFloat(nextRow) < cam + gen { genBand() }
        for r in rows.keys where CGFloat(r) < cam - 3 { rows.removeValue(forKey: r) }
        let top = cam + CGFloat(max(18, CFG.visRows + 1))
        var r = max(0, Int(floor(cam)) - 1)
        while CGFloat(r) <= top {
            defer { r += 1 }
            guard let row = rows[r] else { continue }
            let traffic: [Mover]? = row.type == .rainbow ? row.clouds : row.type == .road ? row.cars
                : row.type == .river ? row.logs : nil
            if let traffic {
                for c in traffic {
                    c.x += row.dir * row.speed * dt
                    if c.x < 0 { c.x += row.L }
                    else if c.x >= row.L { c.x -= row.L }
                }
            } else if row.type == .deer {
                if row.deer.isEmpty {
                    row.timer -= dt
                    if row.timer <= 0 {
                        let n = 1 + irand(3)
                        for j in 0..<n {
                            row.deer.append(Mover(
                                x: row.dir > 0 ? -0.5 - CGFloat(j) * 1.4 : row.L + 0.5 + CGFloat(j) * 1.4,
                                w: 0.75))
                        }
                        events.append(.gallop(r: r))
                    }
                } else {
                    for d in row.deer { d.x += row.dir * row.speed * dt }
                    row.deer = row.deer.filter { $0.x > -2 && $0.x < row.L + 2 }
                    if row.deer.isEmpty { row.timer = 3.5 + rnd() * 5.5 }
                }
            }
        }
        updateTractors(dt, cam)
    }

    static func row(_ r: Int) -> Row? {
        rows[r]
    }

    static func tractors() -> [TractorObj] {
        tractorList
    }

    static func drainEvents() -> [WorldEvent] {
        let e = events
        events = []
        return e
    }
}
