import UIKit
import CoreText

// A CanvasRenderingContext2D-compatible facade over CGContext, so the drawing
// code ports from JS line-for-line with identical semantics.
//
// Semantics notes (verified against every call site in the game):
//  - Paths accumulate segments until beginPath(); fill()/stroke() do not clear
//    the path (unlike CGContext.fillPath()). The game always fills/strokes under
//    the same CTM the path was built with, so keeping the path in user space
//    and adding it at draw time is exact.
//  - arc()/ellipse() with the default anticlockwise=false sweep in increasing
//    angle order, which CGMutablePath.addArc expresses as clockwise:false
//    (pure point math, no CTM involvement). Both connect from the current
//    point with a straight line, exactly like canvas.
//  - Linear gradients clamp beyond their stops (drawsBefore/AfterStartLocation)
//    and can be used as fill or stroke paint, like canvas.
//  - Text renders at an alphabetic baseline via CoreText using the same
//    Arial Rounded MT Bold that Safari resolves from the CSS font stack.

final class CanvasGradient {
    let p0: CGPoint
    let p1: CGPoint
    private var stops: [(CGFloat, CGColor)] = []

    init(_ x0: CGFloat, _ y0: CGFloat, _ x1: CGFloat, _ y1: CGFloat) {
        p0 = CGPoint(x: x0, y: y0)
        p1 = CGPoint(x: x1, y: y1)
    }

    func addColorStop(_ offset: CGFloat, _ css: String) {
        stops.append((offset, CSSColor.parse(css)))
    }

    var cgGradient: CGGradient? {
        guard !stops.isEmpty else { return nil }
        let colors = stops.map { $0.1 } as CFArray
        var locations = stops.map { $0.0 }
        return CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                          colors: colors, locations: &locations)
    }
}

enum CSSColor {
    private static var cache: [String: CGColor] = [:]
    private static let space = CGColorSpace(name: CGColorSpace.sRGB)!

    static func parse(_ css: String) -> CGColor {
        if let hit = cache[css] { return hit }
        let color = parseUncached(css)
        // Only cache constant-ish strings; interpolated rgba() alphas are unbounded.
        if css.hasPrefix("#") || cache.count < 512 { cache[css] = color }
        return color
    }

    private static func parseUncached(_ css: String) -> CGColor {
        let s = css.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") {
            let hex = String(s.dropFirst())
            if hex.count == 6, let v = UInt32(hex, radix: 16) {
                return CGColor(colorSpace: space, components: [
                    CGFloat((v >> 16) & 0xff) / 255,
                    CGFloat((v >> 8) & 0xff) / 255,
                    CGFloat(v & 0xff) / 255, 1])!
            }
            if hex.count == 3, let v = UInt32(hex, radix: 16) {
                let r = CGFloat((v >> 8) & 0xf), g = CGFloat((v >> 4) & 0xf), b = CGFloat(v & 0xf)
                return CGColor(colorSpace: space, components: [r / 15, g / 15, b / 15, 1])!
            }
        }
        if s.hasPrefix("rgba(") || s.hasPrefix("rgb(") {
            let inner = s.drop(while: { $0 != "(" }).dropFirst().dropLast(s.hasSuffix(")") ? 1 : 0)
            let parts = inner.split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) ?? 0 }
            if parts.count >= 3 {
                let a = parts.count >= 4 ? parts[3] : 1
                return CGColor(colorSpace: space, components: [
                    CGFloat(parts[0] / 255), CGFloat(parts[1] / 255), CGFloat(parts[2] / 255),
                    CGFloat(min(max(a, 0), 1))])!
            }
        }
        return CGColor(colorSpace: space, components: [0, 0, 0, 1])!
    }
}

final class Canvas2D {
    enum Paint {
        case color(String)
        case gradient(CanvasGradient)
    }
    enum TextAlign { case left, center }

    private let cg: CGContext

    private struct State {
        var fill: Paint = .color("#000000")
        var stroke: Paint = .color("#000000")
        var lineWidth: CGFloat = 1
        var lineCap: CGLineCap = .butt
        var globalAlpha: CGFloat = 1
        var fontWeight = 400
        var fontSize: CGFloat = 10
        var textAlign: TextAlign = .left
        var dash: [CGFloat] = []
    }
    private var st = State()
    private var stack: [State] = []
    private var path = CGMutablePath()

    init(_ cg: CGContext) {
        self.cg = cg
    }

    // ---------- state ----------
    var fillStyle: String {
        get { if case .color(let c) = st.fill { return c }; return "" }
        set { st.fill = .color(newValue) }
    }
    var strokeStyle: String {
        get { if case .color(let c) = st.stroke { return c }; return "" }
        set { st.stroke = .color(newValue) }
    }
    func setFill(_ g: CanvasGradient) { st.fill = .gradient(g) }
    func setStroke(_ g: CanvasGradient) { st.stroke = .gradient(g) }

    var lineWidth: CGFloat {
        get { st.lineWidth }
        set { st.lineWidth = newValue }
    }
    var lineCap: CGLineCap {
        get { st.lineCap }
        set { st.lineCap = newValue }
    }
    var globalAlpha: CGFloat {
        get { st.globalAlpha }
        set { st.globalAlpha = newValue; cg.setAlpha(newValue) }
    }
    func setLineDash(_ segments: [CGFloat]) {
        st.dash = segments
    }
    func setFont(weight: Int, size: CGFloat) {
        st.fontWeight = weight
        st.fontSize = size
    }
    var textAlign: TextAlign {
        get { st.textAlign }
        set { st.textAlign = newValue }
    }

    func save() {
        cg.saveGState()
        stack.append(st)
    }
    func restore() {
        cg.restoreGState()
        if let prev = stack.popLast() { st = prev }
    }

    func translate(_ x: CGFloat, _ y: CGFloat) { cg.translateBy(x: x, y: y) }
    func rotate(_ a: CGFloat) { cg.rotate(by: a) }
    func scale(_ x: CGFloat, _ y: CGFloat) { cg.scaleBy(x: x, y: y) }

    // ---------- paths ----------
    func beginPath() { path = CGMutablePath() }
    func moveTo(_ x: CGFloat, _ y: CGFloat) { path.move(to: CGPoint(x: x, y: y)) }
    func lineTo(_ x: CGFloat, _ y: CGFloat) { path.addLine(to: CGPoint(x: x, y: y)) }
    func closePath() { path.closeSubpath() }
    func quadraticCurveTo(_ cpx: CGFloat, _ cpy: CGFloat, _ x: CGFloat, _ y: CGFloat) {
        path.addQuadCurve(to: CGPoint(x: x, y: y), control: CGPoint(x: cpx, y: cpy))
    }
    func arcTo(_ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat, _ r: CGFloat) {
        path.addArc(tangent1End: CGPoint(x: x1, y: y1), tangent2End: CGPoint(x: x2, y: y2), radius: r)
    }
    func arc(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ a0: CGFloat, _ a1: CGFloat) {
        path.addArc(center: CGPoint(x: x, y: y), radius: r,
                    startAngle: a0, endAngle: a1, clockwise: false)
    }
    func ellipse(_ x: CGFloat, _ y: CGFloat, _ rx: CGFloat, _ ry: CGFloat,
                 _ rot: CGFloat, _ a0: CGFloat, _ a1: CGFloat) {
        let tf = CGAffineTransform(translationX: x, y: y).rotated(by: rot).scaledBy(x: rx, y: ry)
        path.addArc(center: .zero, radius: 1, startAngle: a0, endAngle: a1,
                    clockwise: false, transform: tf)
    }

    func fill() {
        switch st.fill {
        case .color(let c):
            cg.setFillColor(CSSColor.parse(c))
            cg.addPath(path)
            cg.fillPath(using: .winding)
        case .gradient(let g):
            cg.saveGState()
            cg.addPath(path)
            cg.clip(using: .winding)
            drawGradient(g)
            cg.restoreGState()
        }
    }

    func stroke() {
        cg.setLineWidth(st.lineWidth)
        cg.setLineCap(st.lineCap)
        cg.setLineDash(phase: 0, lengths: st.dash)
        switch st.stroke {
        case .color(let c):
            cg.setStrokeColor(CSSColor.parse(c))
            cg.addPath(path)
            cg.strokePath()
        case .gradient(let g):
            let stroked = path.copy(strokingWithWidth: st.lineWidth, lineCap: st.lineCap,
                                    lineJoin: .miter, miterLimit: 10)
            cg.saveGState()
            cg.addPath(stroked)
            cg.clip(using: .winding)
            drawGradient(g)
            cg.restoreGState()
        }
    }

    // ---------- rects ----------
    func fillRect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
        let rect = CGRect(x: x, y: y, width: w, height: h)
        switch st.fill {
        case .color(let c):
            cg.setFillColor(CSSColor.parse(c))
            cg.fill(rect)
        case .gradient(let g):
            cg.saveGState()
            cg.clip(to: rect)
            drawGradient(g)
            cg.restoreGState()
        }
    }

    func strokeRect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
        if case .color(let c) = st.stroke {
            cg.setStrokeColor(CSSColor.parse(c))
            cg.setLineCap(st.lineCap)
            cg.setLineDash(phase: 0, lengths: st.dash)
            cg.stroke(CGRect(x: x, y: y, width: w, height: h), width: st.lineWidth)
        }
    }

    func clearRect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) {
        cg.clear(CGRect(x: x, y: y, width: w, height: h))
    }

    func createLinearGradient(_ x0: CGFloat, _ y0: CGFloat,
                              _ x1: CGFloat, _ y1: CGFloat) -> CanvasGradient {
        CanvasGradient(x0, y0, x1, y1)
    }

    private func drawGradient(_ g: CanvasGradient) {
        guard let grad = g.cgGradient else { return }
        cg.drawLinearGradient(grad, start: g.p0, end: g.p1,
                              options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    }

    // ---------- text ----------
    // The CSS stack "Arial Rounded MT Bold", ... resolves to this built-in
    // iOS font in Safari, so canvas text matches glyph-for-glyph. Resolved
    // fonts are cached (and warmed at launch): the very first name lookup in
    // a fresh process has been seen to fall back spuriously.
    private static var fontCache: [CGFloat: UIFont] = [:]

    static func uiFont(weight: Int, size: CGFloat) -> UIFont {
        if let f = fontCache[size] { return f }
        let f = UIFont(name: "ArialRoundedMTBold", size: size)
            ?? UIFont.systemFont(ofSize: size, weight: weight >= 800 ? .heavy : .bold)
        if f.fontName == "ArialRoundedMTBold" { fontCache[size] = f }
        return f
    }

    static func warmUpFonts() {
        for size: CGFloat in [11, 13, 14, 15, 16, 17, 18, 20, 22, 24, 36, 44, 64] {
            _ = uiFont(weight: 800, size: size)
        }
    }

    private func makeLine(_ text: String) -> CTLine {
        let font = Canvas2D.uiFont(weight: st.fontWeight, size: st.fontSize)
        let attr = NSAttributedString(string: text, attributes: [
            .font: font,
            kCTForegroundColorFromContextAttributeName as NSAttributedString.Key: true,
        ])
        return CTLineCreateWithAttributedString(attr)
    }

    private func alignedX(_ line: CTLine, _ x: CGFloat) -> CGFloat {
        guard st.textAlign == .center else { return x }
        let w = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
        return x - w / 2
    }

    func fillText(_ text: String, _ x: CGFloat, _ y: CGFloat) {
        let line = makeLine(text)
        cg.saveGState()
        if case .color(let c) = st.fill { cg.setFillColor(CSSColor.parse(c)) }
        cg.setTextDrawingMode(.fill)
        cg.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        cg.textPosition = CGPoint(x: alignedX(line, x), y: y)
        CTLineDraw(line, cg)
        cg.restoreGState()
    }

    func strokeText(_ text: String, _ x: CGFloat, _ y: CGFloat) {
        let line = makeLine(text)
        cg.saveGState()
        if case .color(let c) = st.stroke { cg.setStrokeColor(CSSColor.parse(c)) }
        cg.setLineWidth(st.lineWidth)
        cg.setLineJoin(.round)
        cg.setTextDrawingMode(.stroke)
        cg.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        cg.textPosition = CGPoint(x: alignedX(line, x), y: y)
        CTLineDraw(line, cg)
        cg.restoreGState()
    }
}
