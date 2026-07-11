import UIKit

// The #menu, #gameover, and #paused overlays. Each is stage-sized (.overlay
// { inset: 0; padding: 12px; flex center }) with a PanelView centered in it;
// panels taller than the stage overflow visibly, exactly like the web page.

class OverlayBase: UIView {
    let panel = PanelView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        addSubview(panel)
    }
    required init?(coder: NSCoder) { fatalError() }

    var panelPaddingV: CGFloat { 26 }
    var panelPaddingH: CGFloat { 30 }

    // subclasses report content height for a given content width
    func contentHeight(width: CGFloat) -> CGFloat { 0 }
    func layoutContent(width: CGFloat) {}

    override func layoutSubviews() {
        super.layoutSubviews()
        let availW = bounds.width - 24 // .overlay { padding: 12px }
        let panelW = min(panel.maxWidth, availW * 0.94)
        let contentW = panelW - panelPaddingH * 2
        let panelH = contentHeight(width: contentW) + panelPaddingV * 2
        panel.frame = CGRect(x: (bounds.width - panelW) / 2, y: (bounds.height - panelH) / 2,
                             width: panelW, height: panelH)
        layoutContent(width: contentW)
    }
}

// ---------- #menu ----------
final class MenuOverlay: OverlayBase {
    private let logo = LogoLabel()
    private let tagline = UILabel()
    private(set) var cards: [CardView] = []
    private let abilityLine = UILabel()
    let playButton = BigButton(title: "▶\u{FE0E} Play") // FE0E: text-style triangle, as browsers render it
    private let help = UILabel()
    private let stats = UILabel()
    let muteButton = RoundButton(emoji: "🔊")

    var compact = false {
        didSet {
            guard compact != oldValue else { return }
            for c in cards { c.compact = compact }
            setNeedsLayout()
        }
    }
    var logoFontSize: CGFloat = 56 {
        didSet { logo.fontSize = logoFontSize }
    }

    override var panelPaddingV: CGFloat { 22 } // #menu .panel { padding: 22px 16px }
    override var panelPaddingH: CGFloat { 16 }

    init(game: Game) {
        super.init(frame: .zero)
        panel.maxWidth = 640

        tagline.text = "Hop the rainbows 🌈 Dodge the rain ⛈️ Grab the coins 🪙"
        tagline.font = hsFont(15)
        tagline.textColor = inkColor.withAlphaComponent(0.75)
        tagline.textAlignment = .center
        tagline.numberOfLines = 0

        abilityLine.font = hsFont(14)
        abilityLine.textColor = UIColor(hex: 0x8a5f22)
        abilityLine.textAlignment = .center
        abilityLine.numberOfLines = 0

        help.numberOfLines = 0
        help.textAlignment = .center
        help.font = hsFont(13)
        help.textColor = inkColor.withAlphaComponent(0.65)
        help.text = "Arrow keys / WASD / swipe to hop \u{00A0}•\u{00A0} SPACE for your special move\n"
            + "Mind the holes 🕳️ and airplanes ✈️ \u{00A0}•\u{00A0} keep moving, eagles are watching! 🦅"

        stats.font = hsFont(15)
        stats.textAlignment = .center
        stats.textColor = inkColor

        for (i, info) in Sprites.ANIMALS.enumerated() {
            let card = CardView(index: i, info: info)
            card.onTap = { [weak game] in game?.cardTapped(i) }
            cards.append(card)
            panel.content.addSubview(card)
        }
        for v in [logo, tagline, abilityLine, playButton, help, stats, muteButton] as [UIView] {
            panel.content.addSubview(v)
        }
        panel.content.addSubview(logo)
    }
    required init?(coder: NSCoder) { fatalError() }

    func setStats(best: Int, coins: Int) {
        stats.text = "🏆 Best \(best) \u{00A0}·\u{00A0} 🪙 \(coins)"
    }
    func setAbility(_ s: String) {
        abilityLine.text = s
        setNeedsLayout()
    }
    func setSelected(_ i: Int) {
        for c in cards { c.setSelected(c.index == i) }
    }
    func renderCards(t: CGFloat, selected: Int) {
        for c in cards { c.render(t: t, selected: c.index == selected) }
    }

    // #cards is flex-wrap centered with 8px gaps both ways
    private func cardRows(width: CGFloat) -> [[CardView]] {
        var rows: [[CardView]] = [[]]
        var x: CGFloat = 0
        for c in cards {
            let w = c.intrinsicContentSize.width
            let need = (rows[rows.count - 1].isEmpty ? w : w + 8)
            if x + need > width + 0.5 && !rows[rows.count - 1].isEmpty {
                rows.append([c])
                x = w
            } else {
                rows[rows.count - 1].append(c)
                x += need
            }
        }
        return rows
    }

    private struct Metrics {
        var logoH: CGFloat = 0
        var taglineH: CGFloat = 0
        var rowHeights: [CGFloat] = []
        var abilityH: CGFloat = 0
        var playS = CGSize.zero
        var helpH: CGFloat = 0
        var statsH: CGFloat = 0
        var total: CGFloat = 0
    }
    private func metrics(width: CGFloat) -> Metrics {
        var m = Metrics()
        m.logoH = logo.intrinsicContentSize.height
        m.taglineH = tagline.sizeThatFits(CGSize(width: width, height: 999)).height
        m.rowHeights = cardRows(width: width).map { row in
            row.map { $0.intrinsicContentSize.height }.max() ?? 0
        }
        m.abilityH = max(18, abilityLine.sizeThatFits(CGSize(width: width, height: 999)).height) // min-height: 18px
        m.playS = playButton.intrinsicContentSize
        m.helpH = help.sizeThatFits(CGSize(width: width, height: 999)).height
        m.statsH = stats.intrinsicContentSize.height
        // margins: tagline 6/16, cards rows gap 8, cards mb 18 + ability -8 => 10, ability mb 14,
        // help mt 14, stats mt 8
        m.total = m.logoH + 6 + m.taglineH + 16
            + m.rowHeights.reduce(0, +) + CGFloat(max(0, m.rowHeights.count - 1)) * 8
            + 10 + m.abilityH + 14 + m.playS.height + 14 + m.helpH + 8 + m.statsH
        return m
    }

    override func contentHeight(width: CGFloat) -> CGFloat {
        metrics(width: width).total
    }

    override func layoutContent(width: CGFloat) {
        let m = metrics(width: width)
        let x0 = panelPaddingH
        var y = panelPaddingV
        logo.frame = CGRect(x: x0, y: y, width: width, height: m.logoH)
        y += m.logoH + 6
        tagline.frame = CGRect(x: x0, y: y, width: width, height: m.taglineH)
        y += m.taglineH + 16
        for (ri, row) in cardRows(width: width).enumerated() {
            let rowW = row.reduce(0) { $0 + $1.intrinsicContentSize.width } + CGFloat(row.count - 1) * 8
            var cx = x0 + (width - rowW) / 2
            for c in row {
                let s = c.intrinsicContentSize
                // keep transform-based lift intact: set bounds+center, not frame
                c.bounds = CGRect(origin: .zero, size: s)
                c.center = CGPoint(x: cx + s.width / 2, y: y + m.rowHeights[ri] / 2)
                cx += s.width + 8
            }
            y += m.rowHeights[ri] + 8
        }
        y -= 8
        y += 10
        abilityLine.frame = CGRect(x: x0, y: y, width: width, height: m.abilityH)
        y += m.abilityH + 14
        playButton.bounds = CGRect(origin: .zero, size: m.playS)
        playButton.center = CGPoint(x: x0 + width / 2, y: y + m.playS.height / 2)
        y += m.playS.height + 14
        help.frame = CGRect(x: x0, y: y, width: width, height: m.helpH)
        y += m.helpH + 8
        stats.frame = CGRect(x: x0, y: y, width: width, height: m.statsH)
        // .menu-mute { top: 12px; right: 12px } (relative to panel)
        muteButton.frame = CGRect(x: panel.bounds.width - 12 - 44, y: 12, width: 44, height: 44)
    }
}

// ---------- #gameover ----------
final class GameOverOverlay: OverlayBase {
    private let title = UILabel()
    private let reason = UILabel()
    private let scoreLabel = UILabel()
    private let badge = BadgeView()
    private let goLine = UILabel()
    let retryButton = BigButton(title: "🔁 Hop Again")
    let menuButton = SmallButton(title: "Switch Animal")

    var compact = false {
        didSet { if compact != oldValue { setNeedsLayout() } }
    }
    override var panelPaddingV: CGFloat { compact ? 18 : 26 }
    override var panelPaddingH: CGFloat { compact ? 14 : 30 }

    override init(frame: CGRect) {
        super.init(frame: frame)
        // #gameover { background: rgba(20,30,50,0.3); border-radius: 14px }
        backgroundColor = UIColor(red: 20 / 255, green: 30 / 255, blue: 50 / 255, alpha: 0.3)
        layer.cornerRadius = 14

        title.font = hsFont(36)
        title.textColor = inkColor
        title.textAlignment = .center
        reason.font = hsFont(16)
        reason.textColor = inkColor.withAlphaComponent(0.75)
        reason.textAlignment = .center
        reason.numberOfLines = 0
        // #go-score { font-size 64; color #ff9f43; text-shadow 0 3px 0 rgba(53,40,30,0.2) }
        scoreLabel.font = hsFont(64)
        scoreLabel.textColor = UIColor(hex: 0xff9f43)
        let sh = NSShadow()
        sh.shadowColor = UIColor(hex: 0x35281e, alpha: 0.2)
        sh.shadowOffset = CGSize(width: 0, height: 3)
        scoreLabel.attributedText = NSAttributedString(string: "0", attributes: [
            .font: hsFont(64), .foregroundColor: UIColor(hex: 0xff9f43), .shadow: sh,
        ])
        goLine.font = hsFont(17)
        goLine.textColor = inkColor
        goLine.textAlignment = .center
        for v in [title, reason, scoreLabel, badge, goLine, retryButton, menuButton] as [UIView] {
            panel.content.addSubview(v)
        }
    }
    required init?(coder: NSCoder) { fatalError() }

    func populate(title t: String, reason r: String, score: Int, isBest: Bool, best: Int, coins: Int) {
        title.text = t
        reason.text = r
        let sh = NSShadow()
        sh.shadowColor = UIColor(hex: 0x35281e, alpha: 0.2)
        sh.shadowOffset = CGSize(width: 0, height: 3)
        scoreLabel.attributedText = NSAttributedString(string: String(score), attributes: [
            .font: hsFont(64), .foregroundColor: UIColor(hex: 0xff9f43), .shadow: sh,
        ])
        badge.isHidden = !isBest
        if isBest { badge.startPulse() }
        goLine.text = "🏆 Best \(best) \u{00A0}·\u{00A0} 🪙 +\(coins)"
        setNeedsLayout()
    }

    private func heights(width: CGFloat) -> (title: CGFloat, reason: CGFloat, scoreH: CGFloat, line: CGFloat,
                                             retry: CGSize, menu: CGSize) {
        (title.intrinsicContentSize.height,
         reason.sizeThatFits(CGSize(width: width, height: 999)).height,
         scoreLabel.intrinsicContentSize.height,
         goLine.intrinsicContentSize.height,
         retryButton.intrinsicContentSize,
         menuButton.intrinsicContentSize)
    }

    override func contentHeight(width: CGFloat) -> CGFloat {
        let h = heights(width: width)
        // margins: reason 6/10, score-wrap mb 6, go-line mb 16, menu-btn mt 12
        return h.title + 6 + h.reason + 10 + h.scoreH + 6 + h.line + 16
            + h.retry.height + 12 + h.menu.height
    }

    override func layoutContent(width: CGFloat) {
        let h = heights(width: width)
        let x0 = panelPaddingH
        var y = panelPaddingV
        title.frame = CGRect(x: x0, y: y, width: width, height: h.title)
        y += h.title + 6
        reason.frame = CGRect(x: x0, y: y, width: width, height: h.reason)
        y += h.reason + 10
        // .go-score-wrap: flex baseline center, gap 12
        let ss = scoreLabel.intrinsicContentSize
        let bs = badge.intrinsicContentSize
        let rowW = badge.isHidden ? ss.width : ss.width + 12 + bs.width
        var sx = x0 + (width - rowW) / 2
        scoreLabel.frame = CGRect(x: sx, y: y, width: ss.width, height: ss.height)
        if !badge.isHidden {
            sx += ss.width + 12
            // baseline align: score baseline = y + ascender(64); badge text baseline = top + border+pad + ascender(14)
            let scoreBaseline = y + hsFont(64).ascender
            let badgeTop = scoreBaseline - (3 + 4 + hsFont(14).ascender)
            badge.frame = CGRect(x: sx, y: badgeTop, width: bs.width, height: bs.height)
        }
        y += h.scoreH + 6
        goLine.frame = CGRect(x: x0, y: y, width: width, height: h.line)
        y += h.line + 16
        retryButton.bounds = CGRect(origin: .zero, size: h.retry)
        retryButton.center = CGPoint(x: x0 + width / 2, y: y + h.retry.height / 2)
        y += h.retry.height + 12
        menuButton.bounds = CGRect(origin: .zero, size: h.menu)
        menuButton.center = CGPoint(x: x0 + width / 2, y: y + h.menu.height / 2)
    }
}

// ---------- #paused ----------
final class PausedOverlay: OverlayBase {
    private let title = UILabel()
    let resumeButton = BigButton(title: "▶\u{FE0E} Resume")
    let quitButton = SmallButton(title: "Quit to Menu")

    var compact = false {
        didSet { if compact != oldValue { setNeedsLayout() } }
    }
    override var panelPaddingV: CGFloat { compact ? 18 : 26 }
    override var panelPaddingH: CGFloat { compact ? 14 : 30 }

    // the <br> between elements renders one empty 16px-font line box
    private var brGap: CGFloat { hsFont(16).lineHeight }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(red: 20 / 255, green: 30 / 255, blue: 50 / 255, alpha: 0.3)
        layer.cornerRadius = 14
        title.text = "Paused ☕"
        title.font = hsFont(24) // UA <h2>: 1.5em bold
        title.textAlignment = .center
        title.textColor = inkColor
        for v in [title, resumeButton, quitButton] as [UIView] {
            panel.content.addSubview(v)
        }
    }
    required init?(coder: NSCoder) { fatalError() }

    override func contentHeight(width: CGFloat) -> CGFloat {
        title.intrinsicContentSize.height + brGap + resumeButton.intrinsicContentSize.height
            + 12 + quitButton.intrinsicContentSize.height
    }

    override func layoutContent(width: CGFloat) {
        let x0 = panelPaddingH
        var y = panelPaddingV
        let th = title.intrinsicContentSize.height
        title.frame = CGRect(x: x0, y: y, width: width, height: th)
        y += th + brGap
        let rs = resumeButton.intrinsicContentSize
        resumeButton.bounds = CGRect(origin: .zero, size: rs)
        resumeButton.center = CGPoint(x: x0 + width / 2, y: y + rs.height / 2)
        y += rs.height + 12
        let qs = quitButton.intrinsicContentSize
        quitButton.bounds = CGRect(origin: .zero, size: qs)
        quitButton.center = CGPoint(x: x0 + width / 2, y: y + qs.height / 2)
    }
}
