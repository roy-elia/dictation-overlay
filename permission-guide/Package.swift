// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "PermissionGuide",
    platforms: [.macOS(.v26)],
    dependencies: [
        // Permiso: System Settings drag-to-grant overlay (macOS 26+).
        .package(url: "https://github.com/zats/permiso.git", branch: "main"),
    ],
    targets: [
        .executableTarget(
            name: "PermissionGuide",
            dependencies: [.product(name: "Permiso", package: "permiso")]
        ),
    ]
)
