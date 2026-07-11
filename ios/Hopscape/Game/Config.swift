import CoreGraphics

// window.CFG = { TILE: 64, COLS: 11, W: 704, H: 960 };
// On iOS the logical height stretches beyond the web's 960 so the stage fills
// the phone screen edge-to-edge in portrait (H tracks the screen aspect while
// W stays 11 columns). Wider-than-960/704 screens (landscape, iPad) keep
// H = 960 and letterbox, exactly like the web resize().
enum CFG {
    static let TILE: CGFloat = 64
    static let COLS: Int = 11
    static let W: CGFloat = 704
    static let HMIN: CGFloat = 960
    static var H: CGFloat = 960

    static func fitHeight(viewport: CGSize) {
        guard viewport.width > 0, viewport.height > 0 else { return }
        H = max(HMIN, W * viewport.height / viewport.width)
    }

    // visible rows for the current H — world gen/update horizons follow it
    static var visRows: Int { Int(ceil(H / TILE)) }
}
