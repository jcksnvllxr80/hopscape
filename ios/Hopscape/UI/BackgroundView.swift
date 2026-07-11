import UIKit
import CoreImage

// The decorative page background behind the letterboxed game:
//   body { background: linear-gradient(180deg, #9fdcff 0%, #c9ecff 55%, #e6f7ff 100%) }
//   .sun — radial gradient ball with a warm glow, top 6% right 8%
//   .bgcloud c1/c2/c3 — blurred white puffs drifting across on 65/90/75s loops
final class BackgroundView: UIView {
    private let gradient = CAGradientLayer()
    private let sun = SunView()
    private var clouds: [CloudSpec] = []
    private let startTime = CACurrentMediaTime()

    private struct CloudSpec {
        let view: UIImageView
        let topFraction: CGFloat
        let scale: CGFloat
        let duration: CGFloat
        let delay: CGFloat
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        gradient.colors = [UIColor(hex: 0x9fdcff).cgColor,
                           UIColor(hex: 0xc9ecff).cgColor,
                           UIColor(hex: 0xe6f7ff).cgColor]
        gradient.locations = [0, 0.55, 1]
        layer.addSublayer(gradient)

        // .c1/.c2/.c3: top 12%/30%/70%; scale 1/0.65/0.8; 65s/90s/75s; delay 0/-30/-55; opacity .85/.7/.6
        let img = BackgroundView.cloudImage()
        for (top, s, dur, delay, opacity) in [
            (CGFloat(0.12), CGFloat(1.0), CGFloat(65), CGFloat(0), CGFloat(0.85)),
            (0.30, 0.65, 90, -30, 0.7),
            (0.70, 0.8, 75, -55, 0.6),
        ] {
            let v = UIImageView(image: img)
            v.alpha = opacity
            addSubview(v)
            clouds.append(CloudSpec(view: v, topFraction: top, scale: s, duration: dur, delay: delay))
        }
        addSubview(sun)
        isUserInteractionEnabled = false // .bg { pointer-events: none }
    }
    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        gradient.frame = bounds
        CATransaction.commit()
        // .sun { top: 6%; right: 8%; width/height 110 } — SunView is oversized for the glow
        let sunRect = CGRect(x: bounds.width - bounds.width * 0.08 - 110,
                             y: bounds.height * 0.06, width: 110, height: 110)
        sun.frame = sunRect.insetBy(dx: -110, dy: -110)
        for c in clouds {
            // .bgcloud { left: -240px; top: N% } — image is padded (10,40) around the 220x64 body
            c.view.frame = CGRect(x: -240 - 10, y: bounds.height * c.topFraction - 40,
                                  width: 240, height: 122)
        }
        tick() // keep positions fresh through rotation
    }

    // advance the CSS keyframe animation: translateX(0) -> translateX(100vw + 480px), linear infinite
    func tick() {
        let now = CACurrentMediaTime() - startTime
        for c in clouds {
            let t = (now - c.delay).truncatingRemainder(dividingBy: c.duration) / c.duration
            let tx = t * (bounds.width + 480)
            c.view.transform = CGAffineTransform(translationX: tx, y: 0)
                .scaledBy(x: c.scale, y: c.scale)
        }
    }

    // .bgcloud body 220x64 r60 + ::before 90px circle at (34,-38) + ::after 64px at (right 38,-24), blur(1px)
    private static func cloudImage() -> UIImage {
        let pad: CGFloat = 10
        let topPad: CGFloat = 40
        let size = CGSize(width: 220 + pad * 2, height: 64 + topPad + 18)
        let raw = UIGraphicsImageRenderer(size: size).image { rc in
            let cg = rc.cgContext
            cg.setFillColor(UIColor.white.cgColor)
            cg.addPath(UIBezierPath(roundedRect: CGRect(x: pad, y: topPad, width: 220, height: 64),
                                    cornerRadius: 32).cgPath)
            cg.fillPath()
            cg.fillEllipse(in: CGRect(x: pad + 34, y: topPad - 38, width: 90, height: 90))
            cg.fillEllipse(in: CGRect(x: pad + 220 - 38 - 64, y: topPad - 24, width: 64, height: 64))
        }
        // filter: blur(1px)
        if let ci = CIImage(image: raw) {
            let f = CIFilter(name: "CIGaussianBlur")!
            f.setValue(ci, forKey: kCIInputImageKey)
            f.setValue(1.0, forKey: kCIInputRadiusKey)
            if let out = f.outputImage {
                let ctx = CIContext()
                if let cg = ctx.createCGImage(out, from: ci.extent) {
                    return UIImage(cgImage: cg, scale: raw.scale, orientation: .up)
                }
            }
        }
        return raw
    }
}

// .sun: radial-gradient(circle, #ffe98a 0%, #ffd93d 55%, rgba(255,217,61,0) 72%)
//       box-shadow: 0 0 80px 30px rgba(255,226,120,0.55)
private final class SunView: UIView {
    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        contentMode = .redraw
    }
    required init?(coder: NSCoder) { fatalError() }

    override func draw(_ rect: CGRect) {
        guard let cg = UIGraphicsGetCurrentContext() else { return }
        let c = CGPoint(x: bounds.midX, y: bounds.midY)
        let glowColor = UIColor(red: 1, green: 226 / 255, blue: 120 / 255, alpha: 1)
        // glow: shadow of the 55r disc, spread 30 (-> r 85), blur 80 (sigma 40): flat top then gaussian-ish falloff
        var glowLocs: [CGFloat] = [0, 45.0 / 165, 85.0 / 165, 125.0 / 165, 1]
        let glow = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [
            glowColor.withAlphaComponent(0.55).cgColor,
            glowColor.withAlphaComponent(0.55).cgColor,
            glowColor.withAlphaComponent(0.28).cgColor,
            glowColor.withAlphaComponent(0.08).cgColor,
            glowColor.withAlphaComponent(0).cgColor,
        ] as CFArray, locations: &glowLocs)!
        cg.drawRadialGradient(glow, startCenter: c, startRadius: 0, endCenter: c, endRadius: 165, options: [])
        // core ball (element is 110x110; gradient to farthest side = r 55)
        var coreLocs: [CGFloat] = [0, 0.55, 0.72]
        let core = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [
            UIColor(hex: 0xffe98a).cgColor,
            UIColor(hex: 0xffd93d).cgColor,
            UIColor(hex: 0xffd93d, alpha: 0).cgColor,
        ] as CFArray, locations: &coreLocs)!
        cg.drawRadialGradient(core, startCenter: c, startRadius: 0, endCenter: c, endRadius: 55, options: [])
    }
}
