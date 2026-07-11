import XCTest
import UIKit

// Renders every sprite with fixed parameters into /tmp/hopscape_ios_sheet.png.
// The same scene is drawn by scripts/web_sheet.js through the original
// sprites.js — the two images must match shape-for-shape and color-for-color.
final class SpriteSheetTests: XCTestCase {
    func testRenderSheet() throws {
        let t: CGFloat = 1.234
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        fmt.opaque = true
        let img = UIGraphicsImageRenderer(size: CGSize(width: 704, height: 960), format: fmt).image { rc in
            let ctx = Canvas2D(rc.cgContext)
            ctx.fillStyle = "#ffffff"
            ctx.fillRect(0, 0, 704, 960)

            // ---- band rows ----
            let rainbow = Row(type: .rainbow); rainbow.bi = 0; rainbow.bn = 1
            Sprites.rainbowRow(ctx, 0, rainbow)
            let road0 = Row(type: .road); road0.bi = 0; road0.bn = 2
            let road1 = Row(type: .road); road1.bi = 1; road1.bn = 2
            // screen-y increases downward; row bi increases upward → bi1 sits above bi0
            Sprites.roadRow(ctx, 128, road0)
            Sprites.roadRow(ctx, 64, road1)
            let river = Row(type: .river); river.bi = 0; river.bn = 1
            Sprites.riverRow(ctx, 192, river)
            let deerRow = Row(type: .deer)
            Sprites.deerRow(ctx, 256, 3, deerRow)
            let grass = Row(type: .grass)
            grass.holes = [3]
            grass.flowers = [Flower(c: 0, kind: 0, jx: 5, jy: -3),
                             Flower(c: 6, kind: 3, jx: -8, jy: 4),
                             Flower(c: 8, kind: 1, jx: 0, jy: 0)]
            grass.dirt = (dir: 1, edge: 8.2)
            Sprites.grassRow(ctx, 320, 4, grass)

            // ---- scenery / traffic ----
            Sprites.tree(ctx, 100, 470, 5)
            Sprites.tree(ctx, 170, 470, 12)
            Sprites.tree(ctx, 240, 470, 77)
            Sprites.coin(ctx, 310, 450, t, 2)
            Sprites.cloudShadow(ctx, 430, 478, 1.5)
            Sprites.cloud(ctx, 430, 455, 1.5, t, 7, 1)
            Sprites.car(ctx, 560, 460, 1, 0, 1, t)
            Sprites.car(ctx, 650, 460, 1, 3, -1, t)

            Sprites.car(ctx, 90, 560, 1.7, 9, 1, t)
            Sprites.riverLog(ctx, 230, 555, 2)
            Sprites.lilypad(ctx, 330, 555, t, 3)
            Sprites.lilypad(ctx, 390, 555, t, 9)
            Sprites.deer(ctx, 470, 560, 1)
            Sprites.tractor(ctx, 570, 560, 1, t)
            Sprites.scorch(ctx, 660, 560)

            Sprites.rocket(ctx, 80, 700, Rocket(c: 0, phase: .idle, t: 0), t)
            Sprites.rocket(ctx, 170, 700, Rocket(c: 0, phase: .arm, t: 0.5), t)
            Sprites.rocket(ctx, 260, 700, Rocket(c: 0, phase: .fly, t: 0.35), t)
            Sprites.plane(ctx, 420, 650, 1, t)
            Sprites.eagle(ctx, 540, 650, t, false)
            Sprites.eagle(ctx, 640, 650, t, true)

            // ---- animals ----
            func opts(_ mutate: (inout Sprites.AnimalOpts) -> Void = { _ in }) -> Sprites.AnimalOpts {
                var o = Sprites.AnimalOpts(); o.t = t; mutate(&o); return o
            }
            Sprites.animal(ctx, "cat", 70, 840, opts())
            Sprites.animal(ctx, "dog", 150, 840, opts())
            Sprites.animal(ctx, "bunny", 230, 840, opts())
            Sprites.animal(ctx, "duck", 310, 840, opts())
            Sprites.animal(ctx, "duck", 390, 840, opts { $0.air = true })
            Sprites.animal(ctx, "cat", 470, 840, opts { $0.dead = true })
            Sprites.animal(ctx, "bunny", 550, 840, opts { $0.flip = true; $0.lean = 0.5 })
            Sprites.animal(ctx, "dog", 630, 840, opts { $0.squash = 0.9; $0.z = 10 })

            // ---- canvas text paths ----
            Sprites.bestLine(ctx, 930, 54)
            ctx.globalAlpha = 1
            ctx.setFont(weight: 800, size: 20)
            ctx.textAlign = .center
            ctx.lineWidth = 4
            ctx.strokeStyle = "#b57e0a"
            ctx.strokeText("+1", 500, 920)
            ctx.fillStyle = "#ffe9a8"
            ctx.fillText("+1", 500, 920)
            ctx.textAlign = .left
            ctx.fillStyle = "#ff5a5f"
            ctx.beginPath()
            ctx.arc(600, 915, 13, 0, .pi * 2)
            ctx.fill()
            ctx.fillStyle = "#fff"
            ctx.setFont(weight: 900, size: 18)
            ctx.textAlign = .center
            ctx.fillText("!", 600, 921)
            ctx.textAlign = .left
        }
        let data = try XCTUnwrap(img.pngData())
        try data.write(to: URL(fileURLWithPath: "/tmp/hopscape_ios_sheet.png"))
    }
}
