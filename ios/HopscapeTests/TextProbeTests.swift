import XCTest
import UIKit

// Renders "+1" through each sub-path of Canvas2D text drawing at 40px so the
// glyph shapes are unmistakable in /tmp/hopscape_text_probe.png.
final class TextProbeTests: XCTestCase {
    func testRenderTextProbe() throws {
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        fmt.opaque = true
        let img = UIGraphicsImageRenderer(size: CGSize(width: 600, height: 120), format: fmt).image { rc in
            let ctx = Canvas2D(rc.cgContext)
            ctx.fillStyle = "#ffffff"
            ctx.fillRect(0, 0, 600, 120)
            ctx.setFont(weight: 800, size: 40)

            // 1: fill only, left aligned
            ctx.fillStyle = "#000000"
            ctx.fillText("+1", 20, 70)
            // 2: stroke only, left aligned
            ctx.strokeStyle = "#b57e0a"
            ctx.lineWidth = 4
            ctx.strokeText("+1", 120, 70)
            // 3: stroke then fill, centered (the game's exact sequence)
            ctx.textAlign = .center
            ctx.strokeText("+1", 250, 70)
            ctx.fillStyle = "#ffe9a8"
            ctx.fillText("+1", 250, 70)
            ctx.textAlign = .left
            // 4: UIKit reference — NSString.draw with the same UIFont
            let uif = Canvas2D.uiFont(weight: 800, size: 40)
            ("+1" as NSString).draw(at: CGPoint(x: 340, y: 30),
                                    withAttributes: [.font: uif, .foregroundColor: UIColor.red])
            // 5: digits and plus separately through fillText
            ctx.fillStyle = "#000000"
            ctx.fillText("1", 450, 70)
            ctx.fillText("+", 500, 70)
        }
        try XCTUnwrap(img.pngData()).write(to: URL(fileURLWithPath: "/tmp/hopscape_text_probe.png"))
    }

    // The sheet's "+1" only misrenders after bestLine ran — reproduce that
    // exact sequence to pin down which prior call corrupts the next text draw.
    func testRenderSequenceProbe() throws {
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        fmt.opaque = true
        let img = UIGraphicsImageRenderer(size: CGSize(width: 600, height: 120), format: fmt).image { rc in
            let ctx = Canvas2D(rc.cgContext)
            ctx.fillStyle = "#ffffff"
            ctx.fillRect(0, 0, 600, 120)

            // 1: pristine 20px "+1"
            drawPlusOne(ctx, 60)
            // 2: after an emoji fillText (bestLine's "🏆 BEST 54")
            ctx.setFont(weight: 700, size: 14)
            ctx.fillStyle = "#c2571f"
            ctx.fillText("🏆 BEST 54", 120, 100)
            drawPlusOne(ctx, 280)
            // 3: after a plain-text fillText
            ctx.setFont(weight: 700, size: 14)
            ctx.fillStyle = "#c2571f"
            ctx.fillText("BEST 54", 340, 100)
            drawPlusOne(ctx, 480)
        }
        try XCTUnwrap(img.pngData()).write(to: URL(fileURLWithPath: "/tmp/hopscape_seq_probe.png"))
    }

    private func drawPlusOne(_ ctx: Canvas2D, _ x: CGFloat) {
        ctx.setFont(weight: 800, size: 20)
        ctx.textAlign = .center
        ctx.lineWidth = 4
        ctx.strokeStyle = "#b57e0a"
        ctx.strokeText("+1", x, 60)
        ctx.fillStyle = "#3b2a10"
        ctx.fillText("+1", x, 60)
        ctx.textAlign = .left
    }
}
