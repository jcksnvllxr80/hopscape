import XCTest
import UIKit
import CoreText

final class FontProbeTests: XCTestCase {
    func testFontResolution() {
        let f = UIFont(name: "ArialRoundedMTBold", size: 20)
        print("PROBE resolved:", f?.fontName ?? "NIL")
        for s in ["+1", "1", "+", "BEST 54", "!"] {
            let font = Canvas2D.uiFont(weight: 800, size: 20)
            let attr = NSAttributedString(string: s, attributes: [
                .font: font,
                kCTForegroundColorFromContextAttributeName as NSAttributedString.Key: true,
            ])
            let line = CTLineCreateWithAttributedString(attr)
            let runs = CTLineGetGlyphRuns(line) as! [CTRun]
            var names: [String] = []
            for run in runs {
                let attrs = CTRunGetAttributes(run) as! [NSAttributedString.Key: Any]
                let runFont = attrs[.font] as! CTFont
                names.append(CTFontCopyPostScriptName(runFont) as String)
            }
            print("PROBE '\(s)' -> runs:", names)
        }
    }
}
