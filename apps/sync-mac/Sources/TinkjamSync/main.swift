import AppKit

// A menu bar app: no Dock icon and no main window (LSUIElement in Info.plist says the same).
let app = NSApplication.shared
Fonts.register()
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
