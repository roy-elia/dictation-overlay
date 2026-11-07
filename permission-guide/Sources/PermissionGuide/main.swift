// PermissionGuide.app — standalone overlay that walks the user through the
// System Settings pane for one permission, built on Permiso.
//
// Launch (by the Electron helper, stdio piped):
//   PermissionGuide <panel> <hostAppPath>
//     panel       accessibility | screenRecording | appManagement
//     hostAppPath the .app the user should grant (the Electron app), so the
//                 overlay shows *its* icon/name and drag tile, not ours.
//
// stdout: READY | SHOWN <panel> | DISMISSED <panel> | EXIT <reason>
// stdin : SHOW <panel> | GRANTED <panel> | CLOSE
//
// Lifetime: exits after 10 minutes, on CLOSE, when stdin hits EOF, or when the
// parent process dies — whichever comes first.
//
// Grant detection lives in the helper, not here: TCC answers "is *this
// process* trusted", so only the app being granted can check itself. The
// helper tells us GRANTED and we either advance or quit.

import AppKit
import Permiso

setvbuf(stdout, nil, _IOLBF, 0)

let maxLifetime: TimeInterval = 10 * 60

func emit(_ line: String) {
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

// Protocol names (stable, ours) <-> Permiso panels (raw values are Settings anchors).
let panelNames: [String: PermisoPanel] = [
    "accessibility": .accessibility,
    "screenRecording": .screenRecording,
    "appManagement": .appManagement,
]
func name(of panel: PermisoPanel) -> String {
    panelNames.first { $0.value == panel }?.key ?? panel.rawValue
}

func makeHostApp(path: String?) -> PermisoHostApp {
    guard let path, FileManager.default.fileExists(atPath: path) else { return .current() }
    let url = URL(fileURLWithPath: path)
    let info = Bundle(url: url)?.infoDictionary
    let name = (info?["CFBundleDisplayName"] as? String)
        ?? (info?["CFBundleName"] as? String)
        ?? url.deletingPathExtension().lastPathComponent
    return PermisoHostApp(displayName: name, bundleURL: url, icon: NSWorkspace.shared.icon(forFile: path))
}

@MainActor
final class GuideController: NSObject, NSApplicationDelegate {
    private let host: PermisoHostApp
    private var current: PermisoPanel
    private var parentWatch: DispatchSourceProcess?
    private var finished = false

    init(panel: PermisoPanel, host: PermisoHostApp) {
        self.current = panel
        self.host = host
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        startStdin()
        watchParent()
        DispatchQueue.main.asyncAfter(deadline: .now() + maxLifetime) { [weak self] in
            self?.quit("timeout")
        }
        show(current)
        emit("READY")
    }

    private func show(_ panel: PermisoPanel) {
        current = panel
        PermisoAssistant.shared.present(panel: panel, hostApp: host)
        emit("SHOWN \(name(of: panel))")
    }

    func handle(_ line: String) {
        let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
        switch parts.first {
        case "SHOW":
            if parts.count == 2, let p = panelNames[parts[1]] { show(p) }
        case "GRANTED":
            // Granted the one we're showing: take the overlay down and wait for
            // the helper to SHOW the next pane or CLOSE us.
            if parts.count == 2, parts[1] == name(of: current) {
                PermisoAssistant.shared.dismiss()
                emit("DISMISSED \(name(of: current))")
            }
        case "CLOSE":
            quit("closed")
        default:
            break
        }
    }

    private func startStdin() {
        // readabilityHandler runs serially on a private queue; the box is only
        // touched from there.
        final class LineBuffer: @unchecked Sendable { var data = Data() }
        let buffer = LineBuffer()
        FileHandle.standardInput.readabilityHandler = { h in
            let chunk = h.availableData
            if chunk.isEmpty { // EOF: helper went away
                h.readabilityHandler = nil
                Task { @MainActor in self.quit("stdin-eof") }
                return
            }
            buffer.data.append(chunk)
            while let nl = buffer.data.firstIndex(of: 0x0A) {
                let lineData = buffer.data.subdata(in: buffer.data.startIndex..<nl)
                buffer.data.removeSubrange(buffer.data.startIndex...nl)
                if let line = String(data: lineData, encoding: .utf8)?
                    .trimmingCharacters(in: .whitespaces), !line.isEmpty {
                    Task { @MainActor in self.handle(line) }
                }
            }
        }
    }

    private func watchParent() {
        let src = DispatchSource.makeProcessSource(identifier: getppid(), eventMask: .exit, queue: .main)
        src.setEventHandler { [weak self] in
            MainActor.assumeIsolated { self?.quit("parent-exit") }
        }
        src.resume()
        parentWatch = src
    }

    func quit(_ reason: String) {
        guard !finished else { return }
        finished = true
        PermisoAssistant.shared.dismiss()
        emit("EXIT \(reason)")
        NSApp.terminate(nil)
    }
}

let args = CommandLine.arguments
let panel = args.count > 1 ? panelNames[args[1]] : nil
guard let panel else {
    FileHandle.standardError.write("usage: PermissionGuide <accessibility|screenRecording|appManagement> <hostAppPath>\n".data(using: .utf8)!)
    exit(64)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // no Dock icon, overlay only
let controller = GuideController(panel: panel, host: makeHostApp(path: args.count > 2 ? args[2] : nil))
app.delegate = controller
app.run()
