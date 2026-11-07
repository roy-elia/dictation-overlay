// Renders build/icon.icns: a macOS-style rounded square with a microphone and
// a small dictation pill. Run: swift scripts/make-icon.swift
import AppKit

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath)
let iconset = root.appendingPathComponent("build/icon.iconset")
try? FileManager.default.removeItem(at: iconset)
try! FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

func render(_ px: Int) -> Data {
    let s = CGFloat(px)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    // Apple grid: 824/1024 body, ~185/1024 corner radius.
    let inset = s * 100 / 1024
    let body = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
    let shape = NSBezierPath(roundedRect: body, xRadius: s * 185 / 1024, yRadius: s * 185 / 1024)

    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
    shadow.shadowBlurRadius = s * 0.025
    shadow.shadowOffset = NSSize(width: 0, height: -s * 0.012)
    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    NSColor.black.setFill(); shape.fill()
    NSGraphicsContext.restoreGraphicsState()

    NSGradient(colors: [NSColor(srgbRed: 0.10, green: 0.11, blue: 0.20, alpha: 1),
                        NSColor(srgbRed: 0.18, green: 0.20, blue: 0.38, alpha: 1)])!
        .draw(in: shape, angle: 90)

    // Microphone glyph.
    let cfg = NSImage.SymbolConfiguration(pointSize: s * 0.40, weight: .semibold)
        .applying(.init(paletteColors: [.white]))
    if let mic = NSImage(systemSymbolName: "mic.fill", accessibilityDescription: nil)?.withSymbolConfiguration(cfg) {
        let m = mic.size
        mic.draw(in: NSRect(x: (s - m.width) / 2, y: s * 0.40, width: m.width, height: m.height))
    }

    // Dictation pill with a red recording dot.
    let pw = s * 0.46, ph = s * 0.11
    let pill = NSRect(x: (s - pw) / 2, y: s * 0.20, width: pw, height: ph)
    NSColor.white.withAlphaComponent(0.16).setFill()
    NSBezierPath(roundedRect: pill, xRadius: ph / 2, yRadius: ph / 2).fill()
    let d = ph * 0.42
    NSColor(srgbRed: 1, green: 0.27, blue: 0.23, alpha: 1).setFill()
    NSBezierPath(ovalIn: NSRect(x: pill.minX + ph * 0.38, y: pill.midY - d / 2, width: d, height: d)).fill()
    NSColor.white.withAlphaComponent(0.85).setFill()
    let bars: [CGFloat] = [0.35, 0.7, 0.5, 0.9, 0.45, 0.65, 0.8, 0.4, 0.6, 0.3]
    let bw = ph * 0.13
    for (i, h) in bars.enumerated() {
        let x = pill.minX + ph * 1.15 + CGFloat(i) * bw * 2.1
        let bh = ph * 0.62 * h
        NSBezierPath(roundedRect: NSRect(x: x, y: pill.midY - bh / 2, width: bw, height: bh), xRadius: bw / 2, yRadius: bw / 2).fill()
    }

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for base in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
        try! render(base * scale).write(to: iconset.appendingPathComponent(name))
    }
}
try! render(1024).write(to: root.appendingPathComponent("build/icon.png"))

let p = Process()
p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
p.arguments = ["-c", "icns", iconset.path, "-o", root.appendingPathComponent("build/icon.icns").path]
try! p.run(); p.waitUntilExit()
try? FileManager.default.removeItem(at: iconset)
print(p.terminationStatus == 0 ? "wrote build/icon.icns" : "iconutil failed")
