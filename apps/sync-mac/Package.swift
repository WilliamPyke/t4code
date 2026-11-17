// swift-tools-version:5.9
// Tinkjam Sync for Mac: a menu bar app that sets up, runs and updates Tinkjam Sync.
// `scripts/build.sh` turns the binary into the .app, .dmg and .zip; there is no Xcode project.
import PackageDescription

let package = Package(
    name: "TinkjamSync",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "TinkjamSync",
            path: "Sources/TinkjamSync",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ServiceManagement"),
                .linkedFramework("UserNotifications"),
                .linkedFramework("SystemConfiguration"),
            ]
        ),
    ]
)
