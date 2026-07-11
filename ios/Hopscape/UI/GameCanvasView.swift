import UIKit

// The <canvas id="game"> — logical space 704x960 scaled into the stage,
// backing store capped at 2x like the JS (dpr = min(devicePixelRatio, 2)),
// with the tap/swipe input handlers from main.js.
final class GameCanvasView: UIView {
    weak var game: Game?
    private var touchStart: CGPoint?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        layer.cornerRadius = 14 // #game { border-radius: 14px }
        layer.masksToBounds = true
        isMultipleTouchEnabled = false
        contentMode = .redraw
    }
    required init?(coder: NSCoder) { fatalError() }

    override func draw(_ rect: CGRect) {
        guard let cg = UIGraphicsGetCurrentContext(), let game, bounds.width > 0 else { return }
        cg.saveGState()
        // ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0)
        cg.scaleBy(x: bounds.width / CFG.W, y: bounds.height / CFG.H)
        game.render(Canvas2D(cg))
        cg.restoreGState()
    }

    // canvas.addEventListener('touchstart' ...)
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        Sfx.unlock()
        guard let game, game.state == .play, let t = touches.first else { return }
        touchStart = t.location(in: self)
    }

    // canvas.addEventListener('touchend' ...): tap < 22px = hop forward, else swipe by dominant axis
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let game, game.state == .play, let start = touchStart, let t = touches.first else {
            touchStart = nil
            return
        }
        let p = t.location(in: self)
        touchStart = nil
        game.canvasTapped((dx: p.x - start.x, dy: p.y - start.y))
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        touchStart = nil
    }
}
