// Renders the app icon: the web game's 🌈 favicon on a white tile, 1024x1024.
import AppKit

let size = CGFloat(1024)
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()
let str = NSAttributedString(string: "🌈", attributes: [.font: NSFont.systemFont(ofSize: 720)])
let bounds = str.boundingRect(with: NSSize(width: size, height: size), options: [.usesLineFragmentOrigin])
str.draw(at: NSPoint(x: (size - bounds.width) / 2 - bounds.origin.x,
                     y: (size - bounds.height) / 2 - bounds.origin.y))
image.unlockFocus()
guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    fatalError("could not encode png")
}
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
print("wrote \(CommandLine.arguments[1])")
