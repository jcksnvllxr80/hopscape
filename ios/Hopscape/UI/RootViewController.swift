import UIKit

// The page: sky background, letterboxed #stage with the canvas, HUD and
// overlays, the rAF loop, resize(), and keyboard input.
final class RootViewController: UIViewController, GameUIDelegate {
    private let game = Game()
    private let background = BackgroundView()
    private let stage = UIView()
    private let canvas = GameCanvasView()
    private let hud = HUDView()
    private var menu: MenuOverlay!
    private let gameOver = GameOverOverlay()
    private let pausedOverlay = PausedOverlay()
    private var displayLink: CADisplayLink?

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(hex: 0x9fdcff)
        Canvas2D.warmUpFonts()
        view.addSubview(background)

        // #stage { border-radius: 14px; box-shadow: 0 18px 50px rgba(30,60,90,0.35) }
        stage.layer.shadowColor = UIColor(red: 30 / 255, green: 60 / 255, blue: 90 / 255, alpha: 1).cgColor
        stage.layer.shadowOpacity = 0.35
        stage.layer.shadowOffset = CGSize(width: 0, height: 18)
        stage.layer.shadowRadius = 25 // CSS blur 50
        view.addSubview(stage)

        canvas.game = game
        stage.addSubview(canvas)
        stage.addSubview(hud)

        menu = MenuOverlay(game: game)
        stage.addSubview(menu)
        stage.addSubview(gameOver)
        stage.addSubview(pausedOverlay)

        game.ui = self

        // buttons
        menu.playButton.addTarget(self, action: #selector(playTapped), for: .touchUpInside)
        gameOver.retryButton.addTarget(self, action: #selector(playTapped), for: .touchUpInside)
        gameOver.menuButton.addTarget(self, action: #selector(menuTapped), for: .touchUpInside)
        pausedOverlay.resumeButton.addTarget(self, action: #selector(resumeTapped), for: .touchUpInside)
        pausedOverlay.quitButton.addTarget(self, action: #selector(menuTapped), for: .touchUpInside)
        hud.pauseButton.addTarget(self, action: #selector(pauseTapped), for: .touchUpInside)
        hud.specialButton.addTarget(self, action: #selector(specialTapped), for: .touchUpInside)
        hud.muteButton.addTarget(self, action: #selector(muteTapped), for: .touchUpInside)
        menu.muteButton.addTarget(self, action: #selector(muteTapped), for: .touchUpInside)
        refreshMuteBtns()

        game.boot()

        let link = CADisplayLink(target: self, selector: #selector(frame(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    // ---------- sizing (resize() from main.js, plus iOS fit-to-screen) ----------
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        background.frame = view.bounds
        let vw = view.bounds.width, vh = view.bounds.height
        guard vw > 0, vh > 0 else { return }
        // stretch the logical height to the screen aspect (portrait fills
        // edge-to-edge; landscape/iPad clamp to 960 and letterbox like the web)
        CFG.fitHeight(viewport: CGSize(width: vw, height: vh))
        let pad: CGFloat = min(vw, vh) > 760 ? 28 : 0
        let scale = min((vw - pad) / CFG.W, (vh - pad) / CFG.H)
        let cw = (CFG.W * scale).rounded(), ch = (CFG.H * scale).rounded()
        stage.frame = CGRect(x: ((vw - cw) / 2).rounded(), y: ((vh - ch) / 2).rounded(),
                             width: cw, height: ch)
        let fullBleed = abs(cw - vw) < 2 && abs(ch - vh) < 2
        let radius: CGFloat = fullBleed ? 0 : 14
        canvas.layer.cornerRadius = radius
        gameOver.layer.cornerRadius = radius // #gameover/#paused { border-radius: 14px }
        pausedOverlay.layer.cornerRadius = radius
        stage.layer.shadowOpacity = fullBleed ? 0 : 0.35
        stage.layer.shadowPath = UIBezierPath(roundedRect: stage.bounds, cornerRadius: radius).cgPath
        canvas.frame = stage.bounds
        // dpr = Math.min(window.devicePixelRatio || 1, 2)
        let dpr = min(view.window?.screen.scale ?? UIScreen.main.scale, 2)
        if canvas.contentScaleFactor != dpr {
            canvas.contentScaleFactor = dpr
            canvas.layer.contentsScale = dpr
        }
        hud.frame = stage.bounds
        menu.frame = stage.bounds
        gameOver.frame = stage.bounds
        pausedOverlay.frame = stage.bounds

        // keep HUD corners tappable/visible around the notch and home indicator
        let safe = view.safeAreaInsets
        hud.safeInsets = UIEdgeInsets(
            top: max(0, safe.top - stage.frame.minY),
            left: max(0, safe.left - stage.frame.minX),
            bottom: max(0, stage.frame.maxY - (vh - safe.bottom)),
            right: max(0, stage.frame.maxX - (vw - safe.right)))

        // @media (max-width: 560px) — viewport-based, like CSS
        let compact = vw <= 560
        hud.compact = compact
        menu.compact = compact
        gameOver.compact = compact
        pausedOverlay.compact = compact
        // .logo { font-size: clamp(38px, 9vw, 56px) }
        menu.logoFontSize = min(max(38, vw * 0.09), 56)
    }

    // ---------- the rAF loop ----------
    @objc private func frame(_ link: CADisplayLink) {
        game.step(now: link.timestamp)
        canvas.setNeedsDisplay()
        background.tick() // CSS animation clock, runs regardless of game state
    }

    // ---------- buttons ----------
    @objc private func playTapped() { Sfx.unlock(); game.startGame() }
    @objc private func menuTapped() { game.toMenu() }
    @objc private func resumeTapped() { game.togglePause(false) }
    @objc private func pauseTapped() { game.togglePause() }
    @objc private func specialTapped() { game.specialButtonTapped() }
    @objc private func muteTapped() {
        Sfx.unlock()
        Sfx.toggleMute()
        refreshMuteBtns()
    }
    private func refreshMuteBtns() {
        let g = Sfx.muted ? "🔇" : "🔊"
        hud.muteButton.setTitle(g, for: .normal)
        menu.muteButton.setTitle(g, for: .normal)
    }

    func handleWindowBlur() {
        game.handleWindowBlur()
    }

    // ---------- keyboard ----------
    override var canBecomeFirstResponder: Bool { true }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var handled = false
        for press in presses {
            if let k = keyString(press) {
                game.keyDown(k)
                handled = true
            }
        }
        if !handled { super.pressesBegan(presses, with: event) }
    }

    private func keyString(_ press: UIPress) -> String? {
        guard let key = press.key else { return nil }
        switch key.keyCode {
        case .keyboardUpArrow: return "ArrowUp"
        case .keyboardDownArrow: return "ArrowDown"
        case .keyboardLeftArrow: return "ArrowLeft"
        case .keyboardRightArrow: return "ArrowRight"
        case .keyboardEscape: return "Escape"
        case .keyboardReturnOrEnter, .keypadEnter: return "Enter"
        case .keyboardSpacebar: return " "
        case .keyboardLeftShift, .keyboardRightShift: return "Shift"
        default:
            let ch = key.charactersIgnoringModifiers.lowercased()
            if ["w", "a", "s", "d", "p"].contains(ch) { return ch }
            if ch == " " { return " " }
            if ch == "\r" { return "Enter" }
            return nil
        }
    }

    // ---------- GameUIDelegate (the ui.* writes from main.js) ----------
    func setScoreText(_ s: String) {
        hud.scoreLabel.text = s
        hud.setNeedsLayout()
    }
    func setCoinsText(_ s: String) {
        hud.coinCount.text = s
        hud.setNeedsLayout()
    }
    func showHud(_ on: Bool) { hud.isHidden = !on }
    func showMenu(_ on: Bool) { menu.isHidden = !on }
    func showOver(_ on: Bool) { gameOver.isHidden = !on }
    func showPaused(_ on: Bool) { pausedOverlay.isHidden = !on }
    func setMenuStats(best: Int, coins: Int) {
        menu.setStats(best: best, coins: coins)
        menu.setNeedsLayout()
    }
    func setGameOver(title: String, reason: String, score: Int, isBest: Bool, best: Int, coins: Int) {
        gameOver.populate(title: title, reason: reason, score: score, isBest: isBest, best: best, coins: coins)
    }
    func setAbilityLine(_ s: String) { menu.setAbility(s) }
    func setSelectedCard(_ i: Int) { menu.setSelected(i) }
    func refreshSpecialButton(text: String, cooling: Bool) {
        hud.specialButton.setState(text: text, cooling: cooling)
    }
    func renderMenuCards(t: CGFloat, selected: Int) {
        menu.renderCards(t: t, selected: selected)
    }
}
