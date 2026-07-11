import UIKit

// #hud — score top-left, coins + mute/pause top-right, special button bottom-right.
// pointer-events: none except the buttons (hitTest passthrough).
final class HUDView: UIView {
    let scoreLabel = ScoreLabel()
    private let coinsPill = UIView()
    private let coinDot = CoinDotView()
    let coinCount = UILabel()
    let muteButton = RoundButton(emoji: "🔊")
    let pauseButton = RoundButton(emoji: "⏸")
    let specialButton = SpecialButton()
    private let specialKey = UILabel()

    var compact = false { // @media (max-width: 560px) #score { font-size: 34px }
        didSet { scoreLabel.fontSize = compact ? 34 : 44 }
    }
    // keeps HUD corners clear of the notch / home indicator when full-bleed
    var safeInsets = UIEdgeInsets.zero {
        didSet { if safeInsets != oldValue { setNeedsLayout() } }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(scoreLabel)

        // #coins pill
        coinsPill.backgroundColor = UIColor(white: 1, alpha: 0.85)
        coinsPill.layer.borderColor = UIColor(hex: 0xe0a616).cgColor
        coinsPill.layer.borderWidth = 3
        addSubview(coinsPill)
        coinsPill.addSubview(coinDot)
        coinCount.font = hsFont(22)
        coinCount.textColor = UIColor(hex: 0x9c6f08)
        coinCount.text = "0"
        coinsPill.addSubview(coinCount)

        addSubview(muteButton)
        addSubview(pauseButton)
        addSubview(specialButton)

        // #special-key
        specialKey.text = "SPACE"
        specialKey.font = hsFont(11)
        specialKey.textColor = .white
        specialKey.attributedText = NSAttributedString(string: "SPACE", attributes: [
            .font: hsFont(11), .foregroundColor: UIColor.white, .kern: 1,
            .shadow: {
                let s = NSShadow()
                s.shadowColor = UIColor(white: 0, alpha: 0.35)
                s.shadowOffset = CGSize(width: 0, height: 2)
                return s
            }(),
        ])
        addSubview(specialKey)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let inTop = 12 + safeInsets.top
        let inLeft = 18 + safeInsets.left
        let inRight = safeInsets.right
        // #score { top: 12px; left: 18px }
        let ss = scoreLabel.intrinsicContentSize
        scoreLabel.frame = CGRect(x: inLeft - 2, y: inTop, width: ss.width, height: ss.height)

        // #hud-right { top: 12px; right: 14px; column; gap 8 } — pill then buttons row (gap 8)
        let countSize = coinCount.intrinsicContentSize
        // padding: 4px 14px 4px 8px; border 3; gap 7 between dot and count
        let pillW = 3 + 8 + 20 + 7 + countSize.width + 14 + 3
        let pillH = max(20, countSize.height) + 8 + 6
        coinsPill.frame = CGRect(x: bounds.width - 14 - inRight - pillW, y: inTop, width: pillW, height: pillH)
        coinsPill.layer.cornerRadius = pillH / 2
        coinDot.frame = CGRect(x: 3 + 8, y: (pillH - 20) / 2, width: 20, height: 20)
        coinCount.frame = CGRect(x: coinDot.frame.maxX + 7, y: (pillH - countSize.height) / 2,
                                 width: countSize.width, height: countSize.height)

        let btnY = coinsPill.frame.maxY + 8
        pauseButton.frame = CGRect(x: bounds.width - 14 - inRight - 44, y: btnY, width: 44, height: 44)
        muteButton.frame = CGRect(x: pauseButton.frame.minX - 8 - 44, y: btnY, width: 44, height: 44)

        // #special-wrap { bottom: 16px; right: 16px; column center; gap 4 }
        let keySize = specialKey.intrinsicContentSize
        let wrapH = 66 + 4 + keySize.height
        let cx = bounds.width - 16 - inRight - 33
        let wrapBottom = bounds.height - 16 - safeInsets.bottom
        specialButton.frame = CGRect(x: cx - 33, y: wrapBottom - wrapH, width: 66, height: 66)
        specialKey.frame = CGRect(x: cx - keySize.width / 2, y: specialButton.frame.maxY + 4,
                                  width: keySize.width, height: keySize.height)
    }

    // #hud { pointer-events: none } with pointer-events: auto on the buttons
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        for b in [muteButton, pauseButton, specialButton] where !b.isHidden {
            let p = convert(point, to: b)
            if b.point(inside: p, with: event) { return b }
        }
        return nil
    }
}
