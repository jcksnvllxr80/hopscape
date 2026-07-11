import UIKit

// One character-select card (.card): a live animal canvas rendered at 2x and
// downscaled (web: 192x208 backing shown at 78x85), name + kind labels,
// selected ring/lift, tap to choose.
final class CardView: UIView {
    let index: Int
    private let animalId: String
    private let canvas = UIImageView()
    private let nameLabel = UILabel()
    private let kindLabel = UILabel()
    private let ringLayer = CALayer()
    private var selectedState = false
    var compact = false { // @media (max-width: 560px) .card canvas { 72x78 }
        didSet { if compact != oldValue { setNeedsLayout(); invalidateIntrinsicContentSize() } }
    }
    var onTap: (() -> Void)?

    init(index: Int, info: Sprites.AnimalInfo) {
        self.index = index
        self.animalId = info.id
        super.init(frame: .zero)
        backgroundColor = .white
        layer.borderWidth = 3
        layer.borderColor = UIColor(hex: 0xd8cdb9).cgColor
        layer.cornerRadius = 18
        // box-shadow ring when selected: 0 0 0 3px rgba(255,159,67,0.35)
        ringLayer.borderWidth = 3
        ringLayer.borderColor = UIColor(hex: 0xff9f43, alpha: 0.35).cgColor
        ringLayer.cornerRadius = 21
        ringLayer.isHidden = true
        layer.addSublayer(ringLayer)

        canvas.contentMode = .scaleToFill
        addSubview(canvas)
        nameLabel.font = hsFont(15)
        nameLabel.textColor = inkColor
        nameLabel.textAlignment = .center
        nameLabel.text = info.name
        addSubview(nameLabel)
        kindLabel.font = hsFont(12)
        kindLabel.textColor = inkColor.withAlphaComponent(0.6)
        kindLabel.textAlignment = .center
        kindLabel.text = info.kind
        addSubview(kindLabel)

        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
    }
    required init?(coder: NSCoder) { fatalError() }

    @objc private func tapped() { onTap?() }

    private var canvasSize: CGSize {
        compact ? CGSize(width: 72, height: 78) : CGSize(width: 78, height: 85)
    }

    override var intrinsicContentSize: CGSize {
        // padding: 6px 8px 8px + border 3px each side; name (margin-top 2) + kind stacked under canvas
        let cs = canvasSize
        let nh = nameLabel.intrinsicContentSize.height
        let kh = kindLabel.intrinsicContentSize.height
        return CGSize(width: cs.width + 16 + 6, height: 6 + cs.height + 2 + nh + kh + 8 + 6)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        ringLayer.frame = bounds.insetBy(dx: -3, dy: -3)
        CATransaction.commit()
        let cs = canvasSize
        canvas.frame = CGRect(x: (bounds.width - cs.width) / 2, y: 3 + 6, width: cs.width, height: cs.height)
        let nh = nameLabel.intrinsicContentSize.height
        nameLabel.frame = CGRect(x: 0, y: canvas.frame.maxY + 2, width: bounds.width, height: nh)
        kindLabel.frame = CGRect(x: 0, y: nameLabel.frame.maxY, width: bounds.width,
                                 height: kindLabel.intrinsicContentSize.height)
    }

    func setSelected(_ on: Bool) {
        guard on != selectedState else { return }
        selectedState = on
        // .card.selected { border #ff9f43; ring + glow; translateY(-5px) scale(1.04); bg #fffdf4 }
        layer.borderColor = (on ? UIColor(hex: 0xff9f43) : UIColor(hex: 0xd8cdb9)).cgColor
        backgroundColor = on ? UIColor(hex: 0xfffdf4) : .white
        ringLayer.isHidden = !on
        layer.shadowColor = UIColor(hex: 0xff9f43).cgColor
        layer.shadowOpacity = on ? 0.25 : 0
        layer.shadowOffset = CGSize(width: 0, height: 8)
        layer.shadowRadius = 8 // CSS blur 16
        UIView.animate(withDuration: 0.12) {
            self.transform = on
                ? CGAffineTransform(translationX: 0, y: -5).scaledBy(x: 1.04, y: 1.04)
                : .identity
        }
    }

    // drawCards(): 2x supersampled render, animal at (48,92), bunny 1.05 / others 1.28
    func render(t: CGFloat, selected: Bool) {
        let bounce = selected
            ? abs(sin(t * 3.2)) * 8
            : abs(sin(t * 2 + CGFloat(index) * 1.3)) * 2.5
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 2
        fmt.opaque = false
        let img = UIGraphicsImageRenderer(size: CGSize(width: 96, height: 104), format: fmt).image { rc in
            let ctx = Canvas2D(rc.cgContext)
            ctx.save()
            ctx.translate(48, 92)
            let s: CGFloat = animalId == "bunny" ? 1.05 : 1.28
            ctx.scale(s, s)
            var opts = Sprites.AnimalOpts()
            opts.t = t + CGFloat(index) * 0.9
            opts.z = bounce
            opts.seed = CGFloat(index) * 1.3
            Sprites.animal(ctx, animalId, 0, 0, opts)
            ctx.restore()
        }
        canvas.image = img
    }
}
