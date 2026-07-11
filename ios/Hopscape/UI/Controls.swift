import UIKit

// Shared UI pieces replicating css/style.css exactly: the chunky panel, the
// green big button, the small blue button, round HUD buttons, the special
// button, the outlined score label, the rainbow logo, and the NEW BEST badge.

func hsFont(_ size: CGFloat) -> UIFont {
    // font-family: "Arial Rounded MT Bold", ... — built into iOS, same as Safari resolves
    UIFont(name: "ArialRoundedMTBold", size: size) ?? .systemFont(ofSize: size, weight: .bold)
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((hex >> 16) & 0xff) / 255,
                  green: CGFloat((hex >> 8) & 0xff) / 255,
                  blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
    }
    // CSS filter grayscale(k): channel-mix toward luminance
    func grayscaled(_ k: CGFloat) -> UIColor {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        let l = 0.2126 * r + 0.7152 * g + 0.0722 * b
        return UIColor(red: r + (l - r) * k, green: g + (l - g) * k, blue: b + (l - b) * k, alpha: a)
    }
}

let inkColor = UIColor(hex: 0x35281e)     // --ink
let creamColor = UIColor(hex: 0xfff8ec)   // --cream

// ---------- .panel ----------
final class PanelView: UIView {
    private let hardShadow = CALayer()
    private let softShadow = CALayer()
    private let bg = UIView()
    let content = UIView()
    var maxWidth: CGFloat = 560

    override init(frame: CGRect) {
        super.init(frame: frame)
        // box-shadow: 0 12px 0 rgba(53,40,30,0.25), 0 20px 40px rgba(30,60,90,0.3)
        hardShadow.shadowColor = UIColor(hex: 0x35281e).cgColor
        hardShadow.shadowOpacity = 0.25
        hardShadow.shadowOffset = CGSize(width: 0, height: 12)
        hardShadow.shadowRadius = 0
        softShadow.shadowColor = UIColor(red: 30 / 255, green: 60 / 255, blue: 90 / 255, alpha: 1).cgColor
        softShadow.shadowOpacity = 0.3
        softShadow.shadowOffset = CGSize(width: 0, height: 20)
        softShadow.shadowRadius = 20 // CSS blur 40
        layer.addSublayer(softShadow)
        layer.addSublayer(hardShadow)
        // background: var(--cream); border: 4px solid var(--ink); border-radius: 26px
        bg.backgroundColor = creamColor
        bg.layer.borderColor = inkColor.cgColor
        bg.layer.borderWidth = 4
        bg.layer.cornerRadius = 26
        addSubview(bg)
        addSubview(content)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        bg.frame = bounds
        content.frame = bounds
        let path = UIBezierPath(roundedRect: bounds, cornerRadius: 26).cgPath
        hardShadow.shadowPath = path
        softShadow.shadowPath = path
        hardShadow.frame = bounds
        softShadow.frame = bounds
    }
}

// ---------- .big-btn ----------
final class BigButton: UIButton {
    private let gradient = CAGradientLayer()
    private var normalTransform = CGAffineTransform.identity

    init(title: String) {
        super.init(frame: .zero)
        // background: linear-gradient(180deg, #6fd66f, #4cae4c)
        gradient.colors = [UIColor(hex: 0x6fd66f).cgColor, UIColor(hex: 0x4cae4c).cgColor]
        gradient.borderColor = UIColor(hex: 0x2e7d32).cgColor
        gradient.borderWidth = 4
        layer.insertSublayer(gradient, at: 0)
        layer.shadowColor = UIColor(hex: 0x2e7d32).cgColor
        layer.shadowOpacity = 1
        layer.shadowOffset = CGSize(width: 0, height: 6) // box-shadow: 0 6px 0
        layer.shadowRadius = 0
        // font-size 24, weight 900, white, text-shadow 0 2px 0 rgba(0,0,0,0.2)
        let shadow = NSShadow()
        shadow.shadowColor = UIColor(white: 0, alpha: 0.2)
        shadow.shadowOffset = CGSize(width: 0, height: 2)
        shadow.shadowBlurRadius = 0
        setAttributedTitle(NSAttributedString(string: title, attributes: [
            .font: hsFont(24), .foregroundColor: UIColor.white, .shadow: shadow,
        ]), for: .normal)
        addTarget(self, action: #selector(down), for: [.touchDown, .touchDragEnter])
        addTarget(self, action: #selector(up), for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
    }
    required init?(coder: NSCoder) { fatalError() }

    override var intrinsicContentSize: CGSize {
        let t = titleLabel?.intrinsicContentSize ?? .zero
        // padding: 12px 44px + border 4px
        return CGSize(width: t.width + 88 + 8, height: t.height + 24 + 8)
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        gradient.frame = bounds
        gradient.cornerRadius = bounds.height / 2 // border-radius: 999px
        layer.shadowPath = UIBezierPath(roundedRect: bounds, cornerRadius: bounds.height / 2).cgPath
        CATransaction.commit()
    }
    // .big-btn:active { transform: translateY(4px); box-shadow: 0 2px 0; }
    @objc private func down() {
        transform = CGAffineTransform(translationX: 0, y: 4)
        layer.shadowOffset = CGSize(width: 0, height: 2)
    }
    @objc private func up() {
        transform = .identity
        layer.shadowOffset = CGSize(width: 0, height: 6)
    }
}

// ---------- .small-btn ----------
final class SmallButton: UIButton {
    init(title: String) {
        super.init(frame: .zero)
        backgroundColor = UIColor(hex: 0xe3f1ff)
        layer.borderColor = UIColor(hex: 0x7db4e0).cgColor
        layer.borderWidth = 3
        setAttributedTitle(NSAttributedString(string: title, attributes: [
            .font: hsFont(16), .foregroundColor: UIColor(hex: 0x2b5f8f),
        ]), for: .normal)
        addTarget(self, action: #selector(down), for: [.touchDown, .touchDragEnter])
        addTarget(self, action: #selector(up), for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
    }
    required init?(coder: NSCoder) { fatalError() }

    override var intrinsicContentSize: CGSize {
        let t = titleLabel?.intrinsicContentSize ?? .zero
        // padding: 8px 22px + border 3px
        return CGSize(width: t.width + 44 + 6, height: t.height + 16 + 6)
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        layer.cornerRadius = bounds.height / 2
    }
    @objc private func down() { transform = CGAffineTransform(translationX: 0, y: 2) }
    @objc private func up() { transform = .identity }
}

// ---------- .round-btn ----------
final class RoundButton: UIButton {
    init(emoji: String) {
        super.init(frame: .zero)
        backgroundColor = UIColor(white: 1, alpha: 0.85)
        layer.borderColor = UIColor(red: 60 / 255, green: 45 / 255, blue: 30 / 255, alpha: 0.55).cgColor
        layer.borderWidth = 3
        layer.cornerRadius = 22
        titleLabel?.font = .systemFont(ofSize: 20)
        setTitle(emoji, for: .normal)
        addTarget(self, action: #selector(down), for: [.touchDown, .touchDragEnter])
        addTarget(self, action: #selector(up), for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
    }
    required init?(coder: NSCoder) { fatalError() }
    override var intrinsicContentSize: CGSize { CGSize(width: 44, height: 44) }
    @objc private func down() { transform = CGAffineTransform(scaleX: 0.92, y: 0.92) }
    @objc private func up() { transform = .identity }
}

// ---------- .special-btn ----------
final class SpecialButton: UIButton {
    private let gradient = CAGradientLayer()
    private let topColor = UIColor.white
    private let bottomColor = UIColor(hex: 0xffe9c2)
    private let borderColor = UIColor(hex: 0xe0a616)
    private let shadowColor2 = UIColor(hex: 0xb57e0a)

    private(set) var cooling = false
    private var text = ""

    init() {
        super.init(frame: .zero)
        layer.insertSublayer(gradient, at: 0)
        gradient.cornerRadius = 33
        gradient.borderWidth = 4
        layer.shadowOpacity = 1
        layer.shadowOffset = CGSize(width: 0, height: 5) // box-shadow: 0 5px 0 #b57e0a
        layer.shadowRadius = 0
        applyStyle()
        addTarget(self, action: #selector(down), for: [.touchDown, .touchDragEnter])
        addTarget(self, action: #selector(up), for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])
    }
    required init?(coder: NSCoder) { fatalError() }

    override var intrinsicContentSize: CGSize { CGSize(width: 66, height: 66) }
    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        gradient.frame = bounds
        layer.shadowPath = UIBezierPath(ovalIn: bounds).cgPath
        CATransaction.commit()
    }

    func setState(text: String, cooling: Bool) {
        if text == self.text && cooling == self.cooling { return }
        self.text = text
        self.cooling = cooling
        applyStyle()
    }

    private func applyStyle() {
        // .cooling { filter: grayscale(0.7); opacity: 0.75; font-size 26 900 #7a6a4a }
        let k: CGFloat = cooling ? 0.7 : 0
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        gradient.colors = [topColor.grayscaled(k).cgColor, bottomColor.grayscaled(k).cgColor]
        gradient.borderColor = borderColor.grayscaled(k).cgColor
        layer.shadowColor = shadowColor2.grayscaled(k).cgColor
        CATransaction.commit()
        alpha = cooling ? 0.75 : 1
        if cooling {
            setAttributedTitle(NSAttributedString(string: text, attributes: [
                .font: hsFont(26), .foregroundColor: UIColor(hex: 0x7a6a4a),
            ]), for: .normal)
        } else {
            setAttributedTitle(NSAttributedString(string: text, attributes: [
                .font: UIFont.systemFont(ofSize: 30),
            ]), for: .normal)
        }
    }

    @objc private func down() {
        transform = CGAffineTransform(translationX: 0, y: 3)
        layer.shadowOffset = CGSize(width: 0, height: 2)
    }
    @objc private func up() {
        transform = .identity
        layer.shadowOffset = CGSize(width: 0, height: 5)
    }
}

// ---------- #score: white 900 with a 4-way outline-ish text-shadow ----------
final class ScoreLabel: UIView {
    var text = "0" {
        didSet { if text != oldValue { setNeedsDisplay(); invalidateIntrinsicContentSize() } }
    }
    var fontSize: CGFloat = 44 {
        didSet { if fontSize != oldValue { setNeedsDisplay(); invalidateIntrinsicContentSize() } }
    }
    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
    }
    required init?(coder: NSCoder) { fatalError() }

    private var attrs: [NSAttributedString.Key: Any] { [.font: hsFont(fontSize)] }

    override var intrinsicContentSize: CGSize {
        let s = (text as NSString).size(withAttributes: attrs)
        return CGSize(width: ceil(s.width) + 4, height: ceil(s.height) + 5)
    }

    override func draw(_ rect: CGRect) {
        let ns = text as NSString
        let origin = CGPoint(x: 2, y: 0)
        // text-shadow: 0 3px 0 rgba(0,0,0,0.35), 2px 0 0 / -2px 0 0 / 0 -2px 0 rgba(0,0,0,0.18)
        let shadows: [(CGFloat, CGFloat, CGFloat)] = [(0, 3, 0.35), (2, 0, 0.18), (-2, 0, 0.18), (0, -2, 0.18)]
        for (dx, dy, a) in shadows {
            var at = attrs
            at[.foregroundColor] = UIColor(white: 0, alpha: a)
            ns.draw(at: CGPoint(x: origin.x + dx, y: origin.y + dy), withAttributes: at)
        }
        var at = attrs
        at[.foregroundColor] = UIColor.white
        ns.draw(at: origin, withAttributes: at)
    }
}

// ---------- .logo: gradient-filled HOPSCAPE with a hard drop shadow ----------
final class LogoLabel: UIView {
    var fontSize: CGFloat = 56 {
        didSet { if fontSize != oldValue { setNeedsDisplay(); invalidateIntrinsicContentSize() } }
    }
    private let text = "HOPSCAPE"
    private let colors: [UIColor] = [
        UIColor(hex: 0xff5a5f), UIColor(hex: 0xff9f43), UIColor(hex: 0xf5c518),
        UIColor(hex: 0x4cae4c), UIColor(hex: 0x4aa3ff), UIColor(hex: 0x9b6ef3),
    ]

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        contentMode = .redraw
    }
    required init?(coder: NSCoder) { fatalError() }

    private var attrs: [NSAttributedString.Key: Any] {
        [.font: hsFont(fontSize), .kern: 3] // letter-spacing: 3px
    }

    override var intrinsicContentSize: CGSize {
        let s = (text as NSString).size(withAttributes: attrs)
        return CGSize(width: ceil(s.width), height: ceil(s.height) + 3)
    }

    override func draw(_ rect: CGRect) {
        guard let cg = UIGraphicsGetCurrentContext() else { return }
        let font = hsFont(fontSize)
        let line = CTLineCreateWithAttributedString(NSAttributedString(
            string: text, attributes: [.font: font, .kern: 3]))
        let w = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
        let x = (bounds.width - w) / 2
        let baseline = font.ascender
        let glyphs = LogoLabel.glyphPath(line) // text-space outline, y-up, baseline at 0

        func placed(_ dy: CGFloat) -> CGPath {
            var tf = CGAffineTransform(translationX: x, y: baseline + dy).scaledBy(x: 1, y: -1)
            return glyphs.copy(using: &tf) ?? glyphs
        }
        // filter: drop-shadow(0 3px 0 rgba(53,40,30,0.3)) — hard shadow pass first
        cg.setFillColor(UIColor(hex: 0x35281e, alpha: 0.3).cgColor)
        cg.addPath(placed(3))
        cg.fillPath()
        // background: linear-gradient(90deg, ...) clipped to the glyphs, spanning the element box
        cg.saveGState()
        cg.addPath(placed(0))
        cg.clip()
        var locs: [CGFloat] = [0, 0.2, 0.4, 0.6, 0.8, 1]
        let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                              colors: colors.map { $0.cgColor } as CFArray, locations: &locs)!
        cg.drawLinearGradient(grad, start: CGPoint(x: 0, y: 0),
                              end: CGPoint(x: bounds.width, y: 0), options: [])
        cg.restoreGState()
    }

    private static func glyphPath(_ line: CTLine) -> CGPath {
        let path = CGMutablePath()
        let runs = CTLineGetGlyphRuns(line) as! [CTRun]
        for run in runs {
            let count = CTRunGetGlyphCount(run)
            guard count > 0 else { continue }
            let attrs = CTRunGetAttributes(run) as! [NSAttributedString.Key: Any]
            let runFont = attrs[.font] as! CTFont
            var glyphs = [CGGlyph](repeating: 0, count: count)
            var positions = [CGPoint](repeating: .zero, count: count)
            CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
            CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)
            for i in 0..<count {
                if let g = CTFontCreatePathForGlyph(runFont, glyphs[i], nil) {
                    var tf = CGAffineTransform(translationX: positions[i].x, y: positions[i].y)
                    path.addPath(g, transform: tf)
                }
            }
        }
        return path
    }
}

// ---------- .badge: pulsing NEW BEST! pill ----------
final class BadgeView: UIView {
    private let label = UILabel()
    private let gradient = CAGradientLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        gradient.colors = [UIColor(hex: 0xffd93d).cgColor, UIColor(hex: 0xf5b91a).cgColor]
        gradient.borderColor = UIColor(hex: 0xb57e0a).cgColor
        gradient.borderWidth = 3
        layer.addSublayer(gradient)
        label.font = hsFont(14)
        label.textColor = UIColor(hex: 0x6d4a02)
        label.text = "NEW BEST!"
        addSubview(label)
    }
    required init?(coder: NSCoder) { fatalError() }

    override var intrinsicContentSize: CGSize {
        let s = label.intrinsicContentSize
        // padding: 4px 12px + border 3px
        return CGSize(width: s.width + 24 + 6, height: s.height + 8 + 6)
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        gradient.frame = bounds
        gradient.cornerRadius = bounds.height / 2
        CATransaction.commit()
        label.sizeToFit()
        label.center = CGPoint(x: bounds.midX, y: bounds.midY)
    }

    // @keyframes pulse { from scale(1) to scale(1.12) } 0.7s ease-in-out infinite alternate
    func startPulse() {
        layer.removeAnimation(forKey: "pulse")
        let a = CABasicAnimation(keyPath: "transform.scale")
        a.fromValue = 1
        a.toValue = 1.12
        a.duration = 0.7
        a.autoreverses = true
        a.repeatCount = .infinity
        a.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(a, forKey: "pulse")
    }
}

// ---------- #coins .coin-dot ----------
final class CoinDotView: UIView {
    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        layer.cornerRadius = 10
        layer.borderWidth = 2
        layer.borderColor = UIColor(hex: 0xdd9d12).cgColor
        layer.masksToBounds = true
    }
    required init?(coder: NSCoder) { fatalError() }
    override var intrinsicContentSize: CGSize { CGSize(width: 20, height: 20) }

    override func draw(_ rect: CGRect) {
        guard let cg = UIGraphicsGetCurrentContext() else { return }
        // radial-gradient(circle at 35% 35%, #ffe98a, #ffd23e 60%, #dd9d12)
        let c = CGPoint(x: bounds.width * 0.35, y: bounds.height * 0.35)
        let far = hypot(bounds.width - c.x, bounds.height - c.y)
        var locs: [CGFloat] = [0, 0.6, 1]
        let grad = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [
            UIColor(hex: 0xffe98a).cgColor, UIColor(hex: 0xffd23e).cgColor, UIColor(hex: 0xdd9d12).cgColor,
        ] as CFArray, locations: &locs)!
        cg.drawRadialGradient(grad, startCenter: c, startRadius: 0, endCenter: c, endRadius: far,
                              options: [.drawsAfterEndLocation])
    }
}
