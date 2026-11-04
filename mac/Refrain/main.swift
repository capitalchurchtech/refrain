// Refrain.app: Refrain's own screens in a native window, instead of a Chrome
// app window. The Node server is unchanged and still runs on its own (Start at
// login, or scripts/start.command); this app only shows it.
import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
