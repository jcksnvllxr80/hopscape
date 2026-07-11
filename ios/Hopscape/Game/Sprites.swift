import CoreGraphics
import Foundation

// Hopscape — all art is drawn with canvas shapes (no image files)
// Direct port of js/sprites.js; every constant and call order preserved.

private let T = CFG.TILE

// proper ROYGBIV: red, orange, yellow, green, blue, indigo, violet
private let RAINBOW = ["#ff5a5f", "#ff9f43", "#ffd93d", "#6dd36d", "#4aa3ff", "#5a63d8", "#9b6ef3"]

// JS Math.abs(...) % 1 on doubles
@inline(__always) func jsmod(_ a: CGFloat, _ b: CGFloat) -> CGFloat {
    a.truncatingRemainder(dividingBy: b)
}

// ---------- little shape helpers ----------
private func circ(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ r: CGFloat) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, .pi * 2)
    ctx.fill()
}
private func ell(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ rx: CGFloat, _ ry: CGFloat) {
    ctx.beginPath()
    ctx.ellipse(x, y, rx, ry, 0, 0, .pi * 2)
    ctx.fill()
}
private func rrf(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r0: CGFloat) {
    let r = min(r0, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
    ctx.fill()
}
private func tri(_ ctx: Canvas2D, _ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat, _ x3: CGFloat, _ y3: CGFloat) {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.lineTo(x3, y3)
    ctx.closePath()
    ctx.fill()
}
private func shadow(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ rx: CGFloat, _ ry: CGFloat, _ a: CGFloat) {
    ctx.fillStyle = "rgba(25,55,25,\(a))"
    ell(ctx, x, y, rx, ry)
}

enum Sprites {
    struct AnimalInfo {
        let id: String
        let name: String
        let kind: String
    }
    static let ANIMALS = [
        AnimalInfo(id: "cat", name: "Mittens", kind: "the cat"),
        AnimalInfo(id: "dog", name: "Biscuit", kind: "the pup"),
        AnimalInfo(id: "bunny", name: "Clover", kind: "the bunny"),
        AnimalInfo(id: "duck", name: "Puddles", kind: "the duck"),
    ]

    // ---------- ground ----------
    static func dirtSpan(_ row: Row) -> (CGFloat, CGFloat)? {
        if row.dirtFull { return (0, CFG.W) }
        guard let d = row.dirt else { return nil }
        if d.dir > 0 {
            let x1 = (d.edge - 0.6) * T
            return x1 > 0 ? (0, min(x1, CFG.W)) : nil
        }
        let x0 = (d.edge + 0.6) * T
        return x0 < CFG.W ? (max(0, x0), CFG.W) : nil
    }

    static func grassRow(_ ctx: Canvas2D, _ y: CGFloat, _ r: Int, _ row: Row?) {
        for c in 0..<CFG.COLS {
            let p = ((r + c) % 2 + 2) % 2
            ctx.fillStyle = p != 0 ? "#98d96f" : "#8fd166"
            ctx.fillRect(CGFloat(c) * T, y, T, T + 0.5)
        }
        // dirt road left behind by a tractor
        let span = row.flatMap { dirtSpan($0) }
        if let span {
            ctx.fillStyle = "#c09a62"
            ctx.fillRect(span.0, y, span.1 - span.0, T + 0.5)
            ctx.fillStyle = "rgba(122,90,48,0.5)"
            ctx.fillRect(span.0, y + T * 0.26, span.1 - span.0, 5)
            ctx.fillRect(span.0, y + T * 0.6, span.1 - span.0, 5)
            // pebbles sit on a fixed grid so they're revealed in place as the dirt
            // grows, rather than sliding along with whichever edge is advancing
            ctx.fillStyle = "rgba(90,64,32,0.35)"
            var x = 10
            while CGFloat(x) < CFG.W - 6 {
                defer { x += 42 }
                if CGFloat(x) < span.0 || CGFloat(x) > span.1 - 6 { continue }
                circ(ctx, CGFloat(x + (r * 13 + x) % 12), y + T * 0.45, 2.5)
            }
        }
        if let row {
            for c in row.holes { hole(ctx, (CGFloat(c) + 0.5) * T, y + T * 0.55) }
            for f in row.flowers {
                let fx = (CGFloat(f.c) + 0.5) * T + f.jx
                if let span, fx > span.0, fx < span.1 { continue } // flattened by the tractor
                flower(ctx, fx, y + T * 0.5 + f.jy, f.kind)
            }
        }
    }

    static func roadRow(_ ctx: Canvas2D, _ y: CGFloat, _ row: Row) {
        ctx.fillStyle = "#555b66"
        ctx.fillRect(0, y, CFG.W, T + 0.5)
        if row.bi == 0 {
            ctx.fillStyle = "#9aa0ab"
            ctx.fillRect(0, y, CFG.W, 3.5)
        }
        if row.bi == row.bn - 1 {
            ctx.fillStyle = "#3c414b"
            ctx.fillRect(0, y + T - 3.5, CFG.W, 3.5)
        }
        if row.bi > 0 {
            ctx.fillStyle = "rgba(255,255,255,0.55)"
            var x: CGFloat = 8
            while x < CFG.W {
                ctx.fillRect(x, y - 2, 22, 4)
                x += 42
            }
        }
    }

    static func riverRow(_ ctx: Canvas2D, _ y: CGFloat, _ row: Row) {
        ctx.fillStyle = "#3f8fd6"
        ctx.fillRect(0, y, CFG.W, T + 0.5)
        ctx.fillStyle = "rgba(255,255,255,0.15)"
        var x = 16
        while CGFloat(x) < CFG.W {
            let jy = CGFloat((x * 37 + row.bi * 19) % 3)
            ell(ctx, CGFloat(x), y + T * 0.32 + jy * 6, 15, 3)
            ell(ctx, CGFloat(x + 24), y + T * 0.7 + jy * 5, 11, 2.4)
            x += 48
        }
        // foam line where the bank meets the water. Rows increase upward on
        // screen, so bi=0 (the first/entry row, reached from the grass below)
        // borders that grass along its BOTTOM edge; bi=bn-1 (the last/exit row,
        // leading to the grass above) borders that grass along its TOP edge.
        if row.bi == 0 {
            ctx.fillStyle = "rgba(255,255,255,0.6)"
            var fx: CGFloat = 0
            while fx < CFG.W {
                rrf(ctx, fx + 2, y + T - 4, 12, 6, 3)
                fx += 20
            }
        }
        if row.bi == row.bn - 1 {
            ctx.fillStyle = "rgba(255,255,255,0.6)"
            var fx: CGFloat = 0
            while fx < CFG.W {
                rrf(ctx, fx + 2, y - 2, 12, 6, 3)
                fx += 20
            }
        }
    }

    static func deerRow(_ ctx: Canvas2D, _ y: CGFloat, _ r: Int, _ row: Row) {
        for c in 0..<CFG.COLS {
            let p = ((r + c) % 2 + 2) % 2
            ctx.fillStyle = p != 0 ? "#98d96f" : "#8fd166"
            ctx.fillRect(CGFloat(c) * T, y, T, T + 0.5)
        }
        // trampled trail
        ctx.fillStyle = "rgba(193,154,94,0.5)"
        rrf(ctx, -4, y + T * 0.3, CFG.W + 8, T * 0.42, 12)
        ctx.fillStyle = "rgba(110,80,45,0.4)"
        var x = 26
        while CGFloat(x) < CFG.W {
            ell(ctx, CGFloat(x + (r * 17 + x) % 14), y + T * 0.44, 3, 2)
            ell(ctx, CGFloat(x + 9 + (r * 11 + x) % 10), y + T * 0.6, 3, 2)
            x += 52
        }
        deerSign(ctx, 26, y + T * 0.42)
        deerSign(ctx, CFG.W - 26, y + T * 0.42)
    }

    static func deerSign(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat) {
        ctx.fillStyle = "#7d838f"
        rrf(ctx, x - 2.5, y - 4, 5, 24, 2)
        ctx.save()
        ctx.translate(x, y - 14)
        ctx.rotate(.pi / 4)
        ctx.fillStyle = "#ffd23e"
        rrf(ctx, -11, -11, 22, 22, 4)
        ctx.strokeStyle = "#8a6508"
        ctx.lineWidth = 2
        ctx.strokeRect(-8.5, -8.5, 17, 17)
        ctx.restore()
        // little leaping deer silhouette
        ctx.fillStyle = "#3a2d24"
        ell(ctx, x, y - 13, 5.5, 3)
        circ(ctx, x + 5, y - 17, 2.2)
        ctx.strokeStyle = "#3a2d24"
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(x + 5, y - 19); ctx.lineTo(x + 3.5, y - 22)
        ctx.moveTo(x + 5, y - 19); ctx.lineTo(x + 7, y - 22)
        ctx.moveTo(x - 3, y - 11); ctx.lineTo(x - 5, y - 7)
        ctx.moveTo(x + 3, y - 11); ctx.lineTo(x + 5, y - 7)
        ctx.stroke()
    }

    static func hole(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat) {
        ctx.fillStyle = "#7d9a52" // worn grass rim
        ell(ctx, x, y, 23, 15)
        ctx.fillStyle = "#5b3d22"
        ell(ctx, x, y, 20, 12.5)
        ctx.fillStyle = "#2e1d10"
        ell(ctx, x, y + 0.5, 16.5, 10)
        ctx.fillStyle = "#170e07"
        ell(ctx, x, y + 2.5, 11, 6)
        ctx.strokeStyle = "rgba(255,255,255,0.25)"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.ellipse(x, y - 1, 17.5, 10.5, 0, .pi * 1.1, .pi * 1.9)
        ctx.stroke()
    }

    static func flower(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ kind: Int) {
        if kind == 3 { // grass tuft
            ctx.strokeStyle = "#6cbb4f"
            ctx.lineWidth = 2.5
            ctx.lineCap = .round
            ctx.beginPath()
            ctx.moveTo(x - 4, y + 3); ctx.quadraticCurveTo(x - 5, y - 4, x - 7, y - 7)
            ctx.moveTo(x, y + 3); ctx.quadraticCurveTo(x, y - 6, x - 1, y - 9)
            ctx.moveTo(x + 4, y + 3); ctx.quadraticCurveTo(x + 5, y - 4, x + 7, y - 7)
            ctx.stroke()
            return
        }
        let cols = ["#ffffff", "#ffd1e8", "#ffe9a8"]
        ctx.fillStyle = kind < cols.count ? cols[kind] : cols[0]
        for i in 0..<4 {
            let a = CGFloat(i) * .pi / 2 + 0.4
            circ(ctx, x + cos(a) * 3.4, y + sin(a) * 3.4, 2.6)
        }
        ctx.fillStyle = "#ffce3d"
        circ(ctx, x, y, 2.2)
    }

    static func rainbowRow(_ ctx: Canvas2D, _ y: CGFloat, _ row: Row) {
        // Consecutive rainbow rows form one band; each row draws its slice of the 7 stripes
        let bandH = CGFloat(row.bn) * T
        let y0 = y - CGFloat(row.bn - 1 - row.bi) * T
        let sh = bandH / 7
        for s in 0..<7 {
            let sy = y0 + CGFloat(s) * sh
            let top = max(sy, y)
            let bot = min(sy + sh, y + T)
            if bot <= top { continue }
            ctx.fillStyle = RAINBOW[s]
            ctx.fillRect(0, top, CFG.W, bot - top + 0.6)
        }
    }

    // ---------- scenery ----------
    static func tree(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ seed: CGFloat) {
        let s = jsmod(abs(sin(seed * 12.9898) * 43758.5453), 1)
        let v = 0.88 + s * 0.28
        shadow(ctx, x, y, 20, 7, 0.2)
        ctx.fillStyle = "#8a5a33"
        rrf(ctx, x - 5, y - 18, 10, 18, 3)
        ctx.fillStyle = "rgba(0,0,0,0.15)"
        rrf(ctx, x + 1, y - 18, 4, 18, 2)
        ctx.fillStyle = "#3f9e50"
        circ(ctx, x - 11 * v, y - 25, 14 * v)
        circ(ctx, x + 11 * v, y - 25, 14 * v)
        ctx.fillStyle = "#47ab59"
        circ(ctx, x, y - 33 * v, 16 * v)
        ctx.fillStyle = "#57bd68"
        circ(ctx, x - 5, y - 41 * v, 10 * v)
        ctx.fillStyle = "rgba(255,255,255,0.18)"
        circ(ctx, x - 9, y - 44 * v, 4.5)
        if s < 0.3 {
            ctx.fillStyle = "#ff6b6b"
            circ(ctx, x + 7, y - 36 * v, 2.6)
            circ(ctx, x - 9, y - 28 * v, 2.6)
            circ(ctx, x + 2, y - 24 * v, 2.6)
        }
    }

    static func coin(_ ctx: Canvas2D, _ x: CGFloat, _ yIn: CGFloat, _ t: CGFloat, _ c: CGFloat) {
        let y = yIn + sin(t * 2.6 + c * 1.7) * 3
        let sq = 0.35 + 0.65 * abs(cos(t * 2.2 + c))
        shadow(ctx, x, y + 15, 8 * sq + 2, 3.5, 0.16)
        ctx.fillStyle = "rgba(255,215,80,0.25)"
        circ(ctx, x, y, 17)
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(sq, 1)
        ctx.fillStyle = "#ffd23e"
        circ(ctx, 0, 0, 11)
        ctx.lineWidth = 3
        ctx.strokeStyle = "#dd9d12"
        ctx.beginPath()
        ctx.arc(0, 0, 11, 0, .pi * 2)
        ctx.stroke()
        ctx.lineWidth = 2.5
        ctx.strokeStyle = "rgba(255,243,191,0.9)"
        ctx.beginPath()
        ctx.arc(0, 0, 6, 0, .pi * 2)
        ctx.stroke()
        ctx.restore()
        if sq > 0.92 {
            ctx.fillStyle = "rgba(255,255,255,0.9)"
            let a = t * 3 + c
            ctx.save()
            ctx.translate(x + 7, y - 8)
            ctx.rotate(a)
            ctx.fillRect(-4, -1, 8, 2)
            ctx.fillRect(-1, -4, 2, 8)
            ctx.restore()
        }
    }

    static func cloudShadow(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ wTiles: CGFloat) {
        ctx.fillStyle = "rgba(20,30,50,0.18)"
        ell(ctx, x, y, wTiles * T * 0.4, 6)
    }

    // grumpy storm cloud — the enemy!
    static func cloud(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ wTiles: CGFloat,
                      _ t: CGFloat, _ seed: CGFloat, _ dir: CGFloat) {
        let w = wTiles * T
        let R = w / 2
        let cy = y + sin(t * 2 + seed) * 2.5 - 9

        // body under-shade, then main puffs, then highlights
        ctx.fillStyle = "#454c63"
        circ(ctx, x - R * 0.55, cy + 4, R * 0.4)
        circ(ctx, x - R * 0.05, cy - 4, R * 0.48)
        circ(ctx, x + R * 0.42, cy + 3, R * 0.38)
        rrf(ctx, x - R * 0.75, cy - 1, R * 1.5, 20, 10)
        ctx.fillStyle = "#5f6883"
        circ(ctx, x - R * 0.55, cy + 1, R * 0.4)
        circ(ctx, x - R * 0.05, cy - 7, R * 0.48)
        circ(ctx, x + R * 0.42, cy, R * 0.38)
        rrf(ctx, x - R * 0.75, cy - 4, R * 1.5, 20, 10)
        ctx.fillStyle = "rgba(255,255,255,0.14)"
        circ(ctx, x - R * 0.15, cy - 13, R * 0.28)
        circ(ctx, x - R * 0.62, cy - 5, R * 0.18)

        // angry little face
        ctx.fillStyle = "#ffffff"
        circ(ctx, x - 9, cy - 2, 5)
        circ(ctx, x + 9, cy - 2, 5)
        ctx.fillStyle = "#20242f"
        circ(ctx, x - 9 + dir * 1.8, cy - 2, 2.6)
        circ(ctx, x + 9 + dir * 1.8, cy - 2, 2.6)
        ctx.strokeStyle = "#2a2f40"
        ctx.lineWidth = 3.5
        ctx.lineCap = .round
        ctx.beginPath()
        ctx.moveTo(x - 15, cy - 11); ctx.lineTo(x - 4, cy - 6.5)
        ctx.moveTo(x + 15, cy - 11); ctx.lineTo(x + 4, cy - 6.5)
        ctx.stroke()
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(x, cy + 9, 4, .pi * 1.15, .pi * 1.85)
        ctx.stroke()

        // falling rain streaks
        ctx.strokeStyle = "rgba(96,170,255,0.85)"
        ctx.lineWidth = 3
        for i in 0..<4 {
            let fi = CGFloat(i)
            let fx = x - w * 0.32 + (fi + 0.5) * (w * 0.64 / 4) + sin(seed * 3 + fi * 9) * 4
            let ph = jsmod(jsmod(t * 1.5 + fi * 0.23 + seed * 0.11, 1) + 1, 1)
            let fy = cy + 18 + ph * 26
            ctx.globalAlpha = (1 - ph) * 0.8
            ctx.beginPath()
            ctx.moveTo(fx, fy)
            ctx.lineTo(fx - 2, fy + 8)
            ctx.stroke()
        }
        ctx.globalAlpha = 1
    }

    // cute little cars (kind 0-4 = colors, kind 9 = delivery truck)
    static let CAR_COLORS = ["#ff5a5f", "#4aa3ff", "#6dd36d", "#b57edc", "#ff9f43"]
    static func car(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ wTiles: CGFloat,
                    _ kind: Int, _ dir: CGFloat, _ t: CGFloat) {
        let w = wTiles * T * 0.88
        let bob = sin(t * 9 + x * 0.05) * 0.8
        shadow(ctx, x, y + 12, w * 0.48, 5, 0.25)
        ctx.save()
        ctx.translate(x, y + bob)
        if dir < 0 { ctx.scale(-1, 1) }
        if kind == 9 {
            ctx.fillStyle = "#e8e4da"
            rrf(ctx, -w / 2, -30, w * 0.62, 28, 4)
            ctx.fillStyle = "#4aa3ff"
            rrf(ctx, -w / 2 + w * 0.6, -24, w * 0.4, 22, 6)
            ctx.fillStyle = "#bfe6ff"
            rrf(ctx, -w / 2 + w * 0.68, -21, w * 0.2, 9, 3)
            ctx.fillStyle = "#d3cfc4"
            rrf(ctx, -w / 2 + 5, -24, w * 0.45, 3, 1.5)
            rrf(ctx, -w / 2 + 5, -16, w * 0.45, 3, 1.5)
        } else {
            ctx.fillStyle = CAR_COLORS[kind % 5]
            rrf(ctx, -w / 2, -24, w, 22, 9)
            ctx.fillStyle = "#d9f0ff"
            rrf(ctx, -w * 0.3, -21, w * 0.55, 10, 5)
            ctx.fillStyle = CAR_COLORS[kind % 5]
            ctx.fillRect(-w * 0.05, -21, 4, 10)
        }
        ctx.fillStyle = "#2a2d33"
        circ(ctx, -w * 0.28, 0, 6.5)
        circ(ctx, w * 0.28, 0, 6.5)
        ctx.fillStyle = "rgba(255,255,255,0.35)"
        circ(ctx, -w * 0.28, 0, 2.4)
        circ(ctx, w * 0.28, 0, 2.4)
        ctx.fillStyle = "#fff3ad"
        circ(ctx, w / 2 - 2, -11, 3)
        ctx.fillStyle = "#ff5a5f"
        circ(ctx, -w / 2 + 2, -11, 2.4)
        ctx.restore()
    }

    // floating log — a safe ride across the river, so long as you stay aboard
    static func riverLog(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ wTiles: CGFloat) {
        let w = wTiles * T * 0.9
        shadow(ctx, x, y + 13, w * 0.46, 5, 0.2)
        ctx.fillStyle = "#8a5a33"
        rrf(ctx, x - w / 2, y - 12, w, 20, 9)
        ctx.fillStyle = "rgba(0,0,0,0.12)"
        rrf(ctx, x - w / 2, y + 2, w, 5, 2.5)
        ctx.fillStyle = "#a97c4f"
        rrf(ctx, x - w / 2, y - 12, w, 6, 3)
        ctx.fillStyle = "#c9976a"
        ell(ctx, x - w / 2 + 7, y - 2, 6.5, 9)
        ell(ctx, x + w / 2 - 7, y - 2, 6.5, 9)
        ctx.strokeStyle = "rgba(90,58,30,0.55)"
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.ellipse(x - w / 2 + 7, y - 2, 3.6, 5.5, 0, 0, .pi * 2)
        ctx.ellipse(x + w / 2 - 7, y - 2, 3.6, 5.5, 0, 0, .pi * 2)
        ctx.stroke()
        ctx.strokeStyle = "rgba(90,58,30,0.3)"
        ctx.lineWidth = 1.3
        ctx.beginPath()
        var gx = -w / 2 + 20
        while gx < w / 2 - 14 {
            ctx.moveTo(x + gx, y - 6)
            ctx.lineTo(x + gx + 8, y - 6)
            gx += 14
        }
        ctx.stroke()
    }

    // static lily pad — a fixed safe resting spot that never drifts
    static func lilypad(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ t: CGFloat, _ seed: CGFloat) {
        let s = jsmod(abs(sin(seed * 12.9898) * 43758.5453), 1)
        let bob = sin(t * 1.6 + seed * 2) * 1.5
        let cy = y + bob
        shadow(ctx, x, y + 11, 19, 5, 0.18)
        let notch: CGFloat = 0.34
        let rot = s * .pi * 2
        ctx.fillStyle = "#3d9e4f"
        ctx.beginPath()
        ctx.moveTo(x, cy)
        ctx.arc(x, cy, 18, rot + notch, rot + .pi * 2 - notch)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = "#4db362"
        ctx.beginPath()
        ctx.moveTo(x, cy - 1)
        ctx.arc(x, cy - 1, 14.5, rot + notch, rot + .pi * 2 - notch)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = "rgba(30,80,40,0.4)"
        ctx.lineWidth = 1.3
        ctx.beginPath()
        ctx.moveTo(x, cy); ctx.lineTo(x + cos(rot) * 17, cy + sin(rot) * 17)
        ctx.moveTo(x, cy); ctx.lineTo(x + cos(rot + .pi) * 17, cy + sin(rot + .pi) * 17)
        ctx.moveTo(x, cy); ctx.lineTo(x + cos(rot + .pi / 2) * 14, cy + sin(rot + .pi / 2) * 14)
        ctx.stroke()
        if s < 0.4 {
            ctx.fillStyle = "#ffffff"
            for i in 0..<5 {
                let a = CGFloat(i) * (.pi * 2 / 5)
                ell(ctx, x + cos(a) * 3.4, cy - 6 + sin(a) * 3.4, 2.2, 1.5)
            }
            ctx.fillStyle = "#ffce3d"
            circ(ctx, x, cy - 6, 1.8)
        }
    }

    // bounding deer — gallop cycle tied to its x position
    static func deer(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ dir: CGFloat) {
        let bound = abs(sin(x * 0.09))
        let lift = bound * 10
        shadow(ctx, x, y, 14, 5, 0.2)
        ctx.save()
        ctx.translate(x, y - 5 - lift)
        if dir < 0 { ctx.scale(-1, 1) }
        ctx.strokeStyle = "#9c6b3f"
        ctx.lineWidth = 3
        ctx.lineCap = .round
        let legSwing = (bound - 0.5) * 10
        ctx.beginPath()
        ctx.moveTo(-9, -6); ctx.lineTo(-9 - legSwing, 4)
        ctx.moveTo(-5, -6); ctx.lineTo(-6 - legSwing, 4)
        ctx.moveTo(7, -6); ctx.lineTo(7 + legSwing, 4)
        ctx.moveTo(11, -6); ctx.lineTo(12 + legSwing, 4)
        ctx.stroke()
        ctx.fillStyle = "#c68e5a"
        ell(ctx, 0, -12, 14, 8)
        ctx.fillStyle = "#f4ead9"
        circ(ctx, -11, -13, 4)
        circ(ctx, -14.5, -15, 2.5)
        ctx.fillStyle = "#c68e5a"
        rrf(ctx, 8, -28, 7, 17, 3.5)
        ell(ctx, 13, -28, 6.5, 5)
        tri(ctx, 8, -31, 5, -37, 11, -32)
        ctx.strokeStyle = "#8a5a33"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(11, -32); ctx.lineTo(9, -39)
        ctx.moveTo(9.7, -36); ctx.lineTo(6, -38)
        ctx.moveTo(15, -32); ctx.lineTo(16, -39)
        ctx.moveTo(15.6, -36); ctx.lineTo(19, -38)
        ctx.stroke()
        ctx.fillStyle = "#26221f"
        circ(ctx, 14, -29.5, 1.6)
        circ(ctx, 18.5, -27, 1.8)
        ctx.restore()
    }

    // tree-flattening, dirt-road-making tractor
    static func tractor(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ dir: CGFloat, _ t: CGFloat) {
        shadow(ctx, x, y + 2, 27, 7, 0.25)
        ctx.save()
        ctx.translate(x, y)
        if dir < 0 { ctx.scale(-1, 1) }
        // pusher blade out front
        ctx.fillStyle = "#8a8f9c"
        rrf(ctx, 18, -18, 7, 22, 2)
        ctx.fillStyle = "#6d7280"
        rrf(ctx, 15, -10, 5, 4, 1)
        // body + hood
        ctx.fillStyle = "#4cae4c"
        rrf(ctx, -18, -22, 34, 17, 4)
        ctx.fillStyle = "#3d9142"
        rrf(ctx, 6, -19, 11, 14, 3)
        // cab
        ctx.fillStyle = "#2e7d32"
        rrf(ctx, -18, -36, 15, 16, 3)
        ctx.fillStyle = "#bfe6ff"
        rrf(ctx, -15, -33, 9, 9, 2)
        // exhaust pipe + puffing smoke
        ctx.fillStyle = "#555a66"
        rrf(ctx, 3, -32, 3.5, 12, 1.5)
        for i in 0..<3 {
            let fi = CGFloat(i)
            let ph = jsmod(t * 0.9 + fi * 0.33, 1)
            ctx.fillStyle = "rgba(160,160,168,\(0.5 * (1 - ph)))"
            circ(ctx, 5 + sin(t * 3 + fi * 2) * 3, -36 - ph * 20, 3 + ph * 5)
        }
        // wheels
        ctx.fillStyle = "#2a2d33"
        circ(ctx, -9, -2, 12)
        circ(ctx, 12, 2, 7)
        ctx.fillStyle = "#e0a616"
        circ(ctx, -9, -2, 5)
        circ(ctx, 12, 2, 3)
        ctx.restore()
    }

    // little spaceship on its pad; rk.phase: idle | arm (rumbling) | fly (launching)
    static func rocket(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ rk: Rocket, _ t: CGFloat) {
        var lift: CGFloat = 0
        var jx: CGFloat = 0
        if rk.phase == .arm { jx = sin(t * 42) * (1.5 + rk.t) }
        if rk.phase == .fly { lift = rk.t * rk.t * 780 }

        // launch pad stays behind
        ctx.fillStyle = "#8a8f9c"
        ell(ctx, x, y, 20, 7)
        ctx.fillStyle = "#6d7280"
        ell(ctx, x, y - 1.5, 15, 4.5)
        if rk.phase == .fly {
            ctx.fillStyle = "rgba(40,30,25,0.45)"
            ell(ctx, x, y, 17, 5.5)
            // smoke column chasing the rocket
            for i in 0..<6 {
                let fi = CGFloat(i)
                let sy = y - 8 - (lift * fi) / 6
                let k = 1 - fi / 6
                ctx.fillStyle = "rgba(200,200,205,\(0.5 * k * max(0, 1 - rk.t * 0.8)))"
                circ(ctx, x + sin(fi * 2.6 + t * 3) * 7, sy, 7 + (1 - k) * 9)
            }
        }

        ctx.save()
        ctx.translate(x + jx, y - lift)
        // fins
        ctx.fillStyle = "#e63946"
        tri(ctx, -8, -6, -17, 2, -8, -22)
        tri(ctx, 8, -6, 17, 2, 8, -22)
        // body
        ctx.fillStyle = "#f4f7fb"
        rrf(ctx, -9, -44, 18, 40, 8)
        ctx.fillStyle = "rgba(0,0,0,0.08)"
        rrf(ctx, 2, -44, 7, 40, 6)
        // nose cone
        ctx.fillStyle = "#e63946"
        tri(ctx, -9, -42, 9, -42, 0, -60)
        // porthole
        ctx.fillStyle = "#35506e"
        circ(ctx, 0, -28, 5.5)
        ctx.fillStyle = "#9fd4ff"
        circ(ctx, 0, -28, 3.8)
        ctx.fillStyle = "rgba(255,255,255,0.8)"
        circ(ctx, -1.4, -29.4, 1.3)
        // exhaust flame when armed/launching
        if rk.phase == .arm || rk.phase == .fly {
            let fl: CGFloat = rk.phase == .fly ? 1 : 0.35
            let flick = 0.8 + sin(t * 37) * 0.2
            ctx.fillStyle = "#ff9f43"
            tri(ctx, -6, -5, 6, -5, 0, -5 + 22 * fl * flick)
            ctx.fillStyle = "#ffd93d"
            tri(ctx, -3.5, -5, 3.5, -5, 0, -5 + 13 * fl * flick)
        }
        ctx.restore()

        // warning bubble while it rumbles
        if rk.phase == .arm && sin(t * 10) > -0.4 {
            ctx.fillStyle = "#ff5a5f"
            circ(ctx, x + 16, y - 66, 10)
            ctx.fillStyle = "#fff"
            ctx.setFont(weight: 900, size: 15)
            ctx.textAlign = .center
            ctx.fillText("!", x + 16, y - 61)
            ctx.textAlign = .left
        }
    }

    static func scorch(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat) {
        ctx.fillStyle = "#8a8f9c"
        ell(ctx, x, y, 20, 7)
        ctx.fillStyle = "rgba(50,38,30,0.55)"
        ell(ctx, x, y - 1, 15, 5)
        ctx.fillStyle = "rgba(25,18,14,0.5)"
        ell(ctx, x, y - 1, 8, 3)
    }

    // side-view cartoon jet (dir = 1 flying right, -1 flying left)
    static func plane(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ dir: CGFloat, _ t: CGFloat) {
        ctx.save()
        ctx.translate(x, y + sin(t * 7) * 2)
        if dir < 0 { ctx.scale(-1, 1) }
        // tail fin
        ctx.fillStyle = "#e63946"
        tri(ctx, -22, -4, -22, -24, -8, -4)
        // rear wing sticking down-back
        ctx.fillStyle = "#3d8fe0"
        tri(ctx, -8, 2, -22, 15, 4, 2)
        // fuselage
        ctx.fillStyle = "#f4f7fb"
        rrf(ctx, -25, -9, 50, 18, 9)
        // belly stripe
        ctx.fillStyle = "#e63946"
        rrf(ctx, -25, 2, 50, 5, 3)
        // near wing over the body
        ctx.fillStyle = "#4aa3ff"
        tri(ctx, 2, -1, -14, 12, 12, -1)
        // cockpit + windows
        ctx.fillStyle = "#35506e"
        rrf(ctx, 15, -7, 8, 6, 3)
        circ(ctx, -10, -3, 2.4)
        circ(ctx, -2, -3, 2.4)
        circ(ctx, 6, -3, 2.4)
        ctx.restore()
    }

    // eagle, wings flapping; grab=true tucks the talons out ready to snatch
    static func eagle(_ ctx: Canvas2D, _ x: CGFloat, _ y: CGFloat, _ t: CGFloat, _ grab: Bool) {
        let flap = sin(t * 13)
        ctx.save()
        ctx.translate(x, y)
        // wings
        ctx.fillStyle = "#6b4423"
        ctx.save()
        ctx.rotate(-0.25 - flap * 0.45)
        rrf(ctx, -42, -8, 36, 13, 6)
        tri(ctx, -42, -8, -50, -14, -38, 0)
        ctx.restore()
        ctx.save()
        ctx.rotate(0.25 + flap * 0.45)
        rrf(ctx, 6, -8, 36, 13, 6)
        tri(ctx, 42, -8, 50, -14, 38, 0)
        ctx.restore()
        // tail
        ctx.fillStyle = "#5a381d"
        tri(ctx, -6, 10, 6, 10, 0, 24)
        // body
        ctx.fillStyle = "#7c5230"
        ell(ctx, 0, 0, 12, 15)
        // white head
        ctx.fillStyle = "#f6f2ea"
        circ(ctx, 0, -13, 8)
        // beak
        ctx.fillStyle = "#f5b91a"
        tri(ctx, -2, -13, 2, -15, 6, -9)
        // eyes
        ctx.fillStyle = "#26221f"
        circ(ctx, -3.5, -15, 1.7)
        circ(ctx, 3.5, -15, 1.7)
        // angry brows
        ctx.strokeStyle = "#26221f"
        ctx.lineWidth = 2
        ctx.lineCap = .round
        ctx.beginPath()
        ctx.moveTo(-7, -19); ctx.lineTo(-1.5, -17)
        ctx.moveTo(7, -19); ctx.lineTo(1.5, -17)
        ctx.stroke()
        // talons
        ctx.fillStyle = "#e8a81c"
        let ty: CGFloat = grab ? 14 : 11
        rrf(ctx, -7, ty, 5, 9, 2.5)
        rrf(ctx, 2, ty, 5, 9, 2.5)
        ctx.restore()
    }

    static func bestLine(_ ctx: Canvas2D, _ y: CGFloat, _ best: Int) {
        ctx.strokeStyle = "rgba(255,255,255,0.7)"
        ctx.lineWidth = 3
        ctx.setLineDash([10, 9])
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(CFG.W, y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = "rgba(255,255,255,0.88)"
        rrf(ctx, 8, y - 26, 86, 24, 9)
        ctx.fillStyle = "#c2571f"
        ctx.setFont(weight: 700, size: 14)
        ctx.fillText("🏆 BEST \(best)", 16, y - 9)
    }

    // ---------- the animals ----------
    private static func face(_ ctx: Canvas2D, _ ey: CGFloat, _ blink: Bool, _ dx: CGFloat = 8) {
        if blink {
            ctx.strokeStyle = "#26221f"
            ctx.lineWidth = 2
            ctx.lineCap = .round
            ctx.beginPath()
            ctx.moveTo(-dx - 3, ey); ctx.lineTo(-dx + 3, ey)
            ctx.moveTo(dx - 3, ey); ctx.lineTo(dx + 3, ey)
            ctx.stroke()
        } else {
            ctx.fillStyle = "#26221f"
            circ(ctx, -dx, ey, 3.4)
            circ(ctx, dx, ey, 3.4)
            ctx.fillStyle = "#ffffff"
            circ(ctx, -dx + 1.2, ey - 1.2, 1.2)
            circ(ctx, dx + 1.2, ey - 1.2, 1.2)
        }
    }
    private static func blush(_ ctx: Canvas2D, _ dx: CGFloat, _ y: CGFloat) {
        ctx.fillStyle = "rgba(255,120,150,0.35)"
        circ(ctx, -dx, y, 3.6)
        circ(ctx, dx, y, 3.6)
    }

    private static func drawCat(_ ctx: Canvas2D, _ t: CGFloat, _ blink: Bool, _ o: AnimalOpts) {
        let wag = sin(t * 4) * 4
        // curled tail
        ctx.strokeStyle = "#e08a2e"
        ctx.lineWidth = 8
        ctx.lineCap = .round
        ctx.beginPath()
        ctx.moveTo(16, -8)
        ctx.quadraticCurveTo(30, -14 + wag, 26, -34 + wag)
        ctx.stroke()
        ctx.fillStyle = "#c96f1e"
        circ(ctx, 26, -34 + wag, 4.5)
        // tall pointy ears
        ctx.fillStyle = "#f5993d"
        tri(ctx, -19, -38, -14, -64, -1, -44)
        tri(ctx, 19, -38, 14, -64, 1, -44)
        ctx.fillStyle = "#ff9fb2"
        tri(ctx, -14, -42, -12.5, -56, -5.5, -44.5)
        tri(ctx, 14, -42, 12.5, -56, 5.5, -44.5)
        // body
        ctx.fillStyle = "#f5993d"
        rrf(ctx, -20, -46, 40, 46, 15)
        // cheek fluff tufts
        tri(ctx, -20, -22, -27, -26, -20, -30)
        tri(ctx, 20, -22, 27, -26, 20, -30)
        // bold tabby stripes: forehead "M" + sides
        ctx.fillStyle = "#d3781f"
        rrf(ctx, -10, -46, 5, 10, 2)
        rrf(ctx, -2.5, -47, 5, 13, 2)
        rrf(ctx, 5, -46, 5, 10, 2)
        rrf(ctx, -20, -36, 5, 8, 2)
        rrf(ctx, 15, -36, 5, 8, 2)
        // white tummy patch, low so the face stays clean
        ctx.fillStyle = "#fff4e6"
        rrf(ctx, -10, -14, 20, 11, 7)
        // green almond cat eyes with slit pupils
        if blink {
            ctx.strokeStyle = "#26221f"
            ctx.lineWidth = 2
            ctx.lineCap = .round
            ctx.beginPath()
            ctx.moveTo(-11, -31); ctx.lineTo(-5, -31)
            ctx.moveTo(5, -31); ctx.lineTo(11, -31)
            ctx.stroke()
        } else {
            ctx.fillStyle = "#7ec850"
            ell(ctx, -8, -31, 4.4, 5.4)
            ell(ctx, 8, -31, 4.4, 5.4)
            ctx.fillStyle = "#26221f"
            ell(ctx, -8, -31, 1.8, 4.6)
            ell(ctx, 8, -31, 1.8, 4.6)
            ctx.fillStyle = "#ffffff"
            circ(ctx, -9.3, -33.4, 1.2)
            circ(ctx, 6.7, -33.4, 1.2)
        }
        // pink nose + little :3 mouth (separate arcs, no connecting line)
        ctx.fillStyle = "#ff8fa3"
        tri(ctx, -2.8, -24.5, 2.8, -24.5, 0, -20.8)
        ctx.strokeStyle = "#7a4a1a"
        ctx.lineWidth = 1.8
        ctx.lineCap = .round
        ctx.beginPath()
        ctx.arc(-2.8, -19.2, 2.8, 0.2, .pi * 0.85)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(2.8, -19.2, 2.8, .pi * 0.15, .pi - 0.2)
        ctx.stroke()
        // long whiskers
        ctx.strokeStyle = "rgba(80,50,25,0.65)"
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(10, -27); ctx.lineTo(24, -30)
        ctx.moveTo(10, -24); ctx.lineTo(25, -24)
        ctx.moveTo(10, -21); ctx.lineTo(24, -18)
        ctx.moveTo(-10, -27); ctx.lineTo(-24, -30)
        ctx.moveTo(-10, -24); ctx.lineTo(-25, -24)
        ctx.moveTo(-10, -21); ctx.lineTo(-24, -18)
        ctx.stroke()
        // feet
        ctx.fillStyle = "#e08a2e"
        rrf(ctx, -15, -7, 11, 7, 3)
        rrf(ctx, 4, -7, 11, 7, 3)
    }

    private static func drawDog(_ ctx: Canvas2D, _ t: CGFloat, _ blink: Bool, _ o: AnimalOpts) {
        ctx.fillStyle = "#b9854b"
        circ(ctx, 19 + sin(t * 5) * 1.5, -15, 5.5)
        ctx.fillStyle = "#e2b271"
        rrf(ctx, -20, -44, 40, 44, 15)
        // floppy ears hang over the sides
        ctx.fillStyle = "#a9713a"
        ctx.save()
        ctx.translate(-16, -43)
        ctx.rotate(-0.28)
        rrf(ctx, -9, 0, 11, 21, 5)
        ctx.restore()
        ctx.save()
        ctx.translate(16, -43)
        ctx.rotate(0.28)
        rrf(ctx, -2, 0, 11, 21, 5)
        ctx.restore()
        ctx.fillStyle = "#c9945a"
        circ(ctx, 9, -31, 8)
        ctx.fillStyle = "#f8ecd7"
        ell(ctx, 0, -19, 12, 9)
        face(ctx, -31, blink)
        ctx.fillStyle = "#3a2d24"
        rrf(ctx, -4, -27, 8, 6, 3)
        ctx.strokeStyle = "#3a2d24"
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(0, -21); ctx.lineTo(0, -17)
        ctx.stroke()
        ctx.fillStyle = "#ff8fa3"
        rrf(ctx, -3, -16, 6, 6.5 + sin(t * 6) * 1, 3)
        blush(ctx, 15, -25)
        ctx.fillStyle = "#c9945a"
        rrf(ctx, -15, -7, 11, 7, 3)
        rrf(ctx, 4, -7, 11, 7, 3)
    }

    private static func drawBunny(_ ctx: Canvas2D, _ t: CGFloat, _ blink: Bool, _ o: AnimalOpts) {
        let sway = sin(t * 2) * 0.04
        ctx.save()
        ctx.translate(-9, -38)
        ctx.rotate(-0.14 + sway)
        ctx.fillStyle = "#f4f1ec"
        rrf(ctx, -5, -36, 10, 38, 5)
        ctx.fillStyle = "#ffb7c9"
        rrf(ctx, -2.5, -30, 5, 26, 3)
        ctx.restore()
        ctx.save()
        ctx.translate(9, -38)
        ctx.rotate(0.14 - sway)
        ctx.fillStyle = "#f4f1ec"
        rrf(ctx, -5, -36, 10, 38, 5)
        ctx.fillStyle = "#ffb7c9"
        rrf(ctx, -2.5, -30, 5, 26, 3)
        ctx.restore()
        ctx.fillStyle = "#e9e4db"
        circ(ctx, 17, -12, 6)
        ctx.fillStyle = "#f4f1ec"
        rrf(ctx, -19, -42, 38, 42, 15)
        ctx.fillStyle = "#fdfbf7"
        circ(ctx, -9, -20, 7.5)
        circ(ctx, 9, -20, 7.5)
        face(ctx, -29, blink, 7)
        ctx.fillStyle = "#ff8fa3"
        tri(ctx, -2.5, -25, 2.5, -25, 0, -21.5)
        ctx.fillStyle = "#ffffff"
        ctx.strokeStyle = "rgba(0,0,0,0.12)"
        ctx.lineWidth = 1
        rrf(ctx, -3.5, -20, 3.5, 5.5, 1)
        ctx.strokeRect(-3.5, -20, 3.5, 5.5)
        rrf(ctx, 0, -20, 3.5, 5.5, 1)
        ctx.strokeRect(0, -20, 3.5, 5.5)
        ctx.fillStyle = "rgba(0,0,0,0.2)"
        circ(ctx, -11, -22, 0.8); circ(ctx, -8, -19, 0.8); circ(ctx, -12, -18, 0.8)
        circ(ctx, 11, -22, 0.8); circ(ctx, 8, -19, 0.8); circ(ctx, 12, -18, 0.8)
        blush(ctx, 14, -24)
        ctx.fillStyle = "#e6dfd4"
        rrf(ctx, -16, -7, 13, 7, 3)
        rrf(ctx, 3, -7, 13, 7, 3)
    }

    private static func drawDuck(_ ctx: Canvas2D, _ t: CGFloat, _ blink: Bool, _ o: AnimalOpts) {
        let fly = o.air
        // little upturned tail
        ctx.fillStyle = "#f0c11f"
        tri(ctx, 15, -12, 24, -21, 14, -20)
        // body
        ctx.fillStyle = "#ffd93d"
        rrf(ctx, -19, -43, 38, 43, 15)
        ctx.fillStyle = "#ffe680"
        rrf(ctx, -11, -18, 22, 15, 8)
        if fly {
            // wings spread wide, flapping fast — only while flying
            let flap = sin(t * 18) * 0.35 + 0.55
            ctx.fillStyle = "#f0c11f"
            ctx.save()
            ctx.translate(-18, -27)
            ctx.rotate(-0.5 - flap)
            rrf(ctx, -17, -5, 18, 10, 5)
            ctx.restore()
            ctx.save()
            ctx.translate(18, -27)
            ctx.rotate(0.5 + flap)
            rrf(ctx, -1, -5, 18, 10, 5)
            ctx.restore()
        } else {
            // wings folded flat against the body
            ctx.fillStyle = "#eec22f"
            ell(ctx, -15, -22, 5, 10.5)
            ell(ctx, 15, -22, 5, 10.5)
        }
        face(ctx, -33, blink, 7.5)
        // wide duck bill
        ctx.fillStyle = "#ff9d2e"
        ell(ctx, 0, -26, 11.5, 5.5)
        ctx.fillStyle = "#f0871a"
        ell(ctx, 0, -21.5, 8.5, 3.6)
        ctx.fillStyle = "rgba(0,0,0,0.25)"
        circ(ctx, -3, -27.5, 0.9)
        circ(ctx, 3, -27.5, 0.9)
        blush(ctx, 14, -29)
        // feet
        ctx.fillStyle = "#ff9d2e"
        rrf(ctx, -14, -6, 10, 6, 3)
        rrf(ctx, 4, -6, 10, 6, 3)
    }

    struct AnimalOpts {
        var t: CGFloat = 0
        var z: CGFloat = 0
        var squash: CGFloat = 1
        var shrink: CGFloat? = nil
        var flip = false
        var lean: CGFloat = 0
        var air = false
        var dead = false
        var seed: CGFloat = 0
    }

    static func animal(_ ctx: Canvas2D, _ type: String, _ x: CGFloat, _ y: CGFloat, _ o: AnimalOpts) {
        let t = o.t
        let z = o.z
        let squash = o.squash
        let dead = o.dead
        let blink = !dead && jsmod(t + o.seed, 3.4) > 3.25
        let shrink = o.shrink ?? 1
        let sh = max(0.5, 1 - z / 70) * shrink
        if shrink > 0.05 { shadow(ctx, x, y, 17 * sh, 6.5 * sh, 0.24) }
        ctx.save()
        ctx.translate(x, y - z)
        if shrink != 1 { ctx.scale(shrink, shrink) }
        if o.lean != 0 { ctx.rotate(o.lean * 0.1) }
        if o.flip { ctx.scale(-1, 1) }
        ctx.scale(1, squash)
        if dead { ctx.scale(1.3, 0.5) }
        switch type {
        case "cat": drawCat(ctx, t, blink, o)
        case "dog": drawDog(ctx, t, blink, o)
        case "bunny": drawBunny(ctx, t, blink, o)
        default: drawDuck(ctx, t, blink, o)
        }
        ctx.restore()
        if dead {
            ctx.fillStyle = "rgba(120,180,255,0.35)"
            ell(ctx, x, y + 2, 25, 6)
            ctx.fillStyle = "rgba(110,150,200,0.3)"
            ell(ctx, x, y - 10, 27, 15)
        }
    }
}
