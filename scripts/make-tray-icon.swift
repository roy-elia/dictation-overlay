// Renders the menu-bar template icon (black glyph on transparent; macOS tints it).
// Run: swift scripts/make-tray-icon.swift "$PWD"
import AppKit

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath)
let out = root.appendingPathComponent("src/assets")
try! FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func render(points: CGFloat, scale: Int, name: String) {
    let px = Int(points) * scale
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: points, height: points) // keeps 72-dpi @1x / 144-dpi @2x metadata
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let cfg = NSImage.SymbolConfiguration(pointSize: points * 0.78, weight: .semibold)
    let mic = NSImage(systemSymbolName: "mic.fill", accessibilityDescription: nil)!.withSymbolConfiguration(cfg)!
    let s = mic.size
    mic.draw(in: NSRect(x: (points - s.width) / 2, y: (points - s.height) / 2, width: s.width, height: s.height))
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent(name))
}

render(points: 18, scale: 1, name: "trayTemplate.png")
render(points: 18, scale: 2, name: "trayTemplate@2x.png")
print("wrote src/assets/trayTemplate{,@2x}.png")
