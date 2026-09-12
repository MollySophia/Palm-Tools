// Native vector/text source for the Finder DMG background. Run on macOS:
// swift deploy/render-dmg-background.swift apps/gui/src-tauri/dmg/background.png
import AppKit

let size = NSSize(width: 660, height: 420)
let scale: CGFloat = 2
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSGraphicsContext.current!.cgContext.scaleBy(x: scale, y: scale)
func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> NSColor {
    NSColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: 1)
}
color(250, 250, 250).setFill()
NSRect(origin: .zero, size: size).fill()
func text(_ value: String, y: CGFloat, font: NSFont, color ink: NSColor) {
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: ink]
    let width = (value as NSString).size(withAttributes: attributes).width
    (value as NSString).draw(at: NSPoint(x: (size.width - width) / 2, y: y), withAttributes: attributes)
}
text("Drag kode to Applications", y: 307, font: .systemFont(ofSize: 20, weight: .medium), color: color(58, 58, 60))

// Finder places the real icons at (180, 205) and (480, 205), measured from top.
// Leave their entire icon and filename areas blank; the background is guidance.
let arrow = NSBezierPath()
arrow.move(to: NSPoint(x: 299, y: 215))
arrow.line(to: NSPoint(x: 361, y: 215))
arrow.move(to: NSPoint(x: 349, y: 227))
arrow.line(to: NSPoint(x: 361, y: 215))
arrow.line(to: NSPoint(x: 349, y: 203))
arrow.lineWidth = 3
arrow.lineCapStyle = .round
arrow.lineJoinStyle = .round
color(150, 150, 154).setStroke()
arrow.stroke()

NSGraphicsContext.restoreGraphicsState()
// Encode 144 DPI: Finder keeps the 660 × 420 point layout while using 2× pixels.
bitmap.size = size
let destination = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
try bitmap.representation(using: .png, properties: [:])!.write(to: destination)
