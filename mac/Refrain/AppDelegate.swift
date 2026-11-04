// The window and the menus. The window has no minimum width to fight, so it
// docks at about 455px beside ProPresenter, and it can stay on top of it.
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
  private var window: NSWindow!
  private var web: WebController!
  private let keepOnTopKey = "KeepOnTop"

  func applicationDidFinishLaunching(_ n: Notification) {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
    let built = Bundle.main.object(forInfoDictionaryKey: "RefrainURL") as? String
    web = WebController(server: Routing.serverURL(arguments: CommandLine.arguments, defaults: .standard, built: built), version: version)

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 455, height: 900),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable],
                      backing: .buffered, defer: false)
    window.title = "Refrain"
    window.minSize = NSSize(width: 320, height: 360)
    // Dark until the page says otherwise, matching its first paint.
    window.titlebarAppearsTransparent = true
    window.backgroundColor = web.webView.underPageBackgroundColor
    window.appearance = NSAppearance(named: .darkAqua)
    window.contentView = web.webView
    window.isReleasedWhenClosed = false
    // Remembers where it was docked, across quits and rebuilds.
    if !window.setFrameUsingName("RefrainMain") { window.center() }
    window.setFrameAutosaveName("RefrainMain")
    applyKeepOnTop()

    NSApp.mainMenu = buildMenu()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    web.load()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

  // MARK: Menus

  /// Without an Edit menu, Copy and Paste don't reach the page at all.
  private func buildMenu() -> NSMenu {
    let main = NSMenu()

    let app = NSMenu()
    app.addItem(withTitle: "About Refrain", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    app.addItem(.separator())
    app.addItem(withTitle: "Hide Refrain", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    let others = app.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
    others.keyEquivalentModifierMask = [.command, .option]
    app.addItem(.separator())
    app.addItem(withTitle: "Quit Refrain", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    add(app, titled: "Refrain", to: main)

    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
    redo.keyEquivalentModifierMask = [.command, .shift]
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    add(edit, titled: "Edit", to: main)

    let view = NSMenu(title: "View")
    view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r").target = self
    view.addItem(.separator())
    view.addItem(withTitle: "Actual Size", action: #selector(zoomReset), keyEquivalent: "0").target = self
    view.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "=").target = self
    view.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-").target = self
    add(view, titled: "View", to: main)

    let win = NSMenu(title: "Window")
    win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    win.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    win.addItem(.separator())
    let top = win.addItem(withTitle: "Keep on Top", action: #selector(toggleKeepOnTop(_:)), keyEquivalent: "t")
    top.keyEquivalentModifierMask = [.command, .option]
    top.target = self
    top.state = UserDefaults.standard.bool(forKey: keepOnTopKey) ? .on : .off
    add(win, titled: "Window", to: main)
    NSApp.windowsMenu = win

    return main
  }

  private func add(_ menu: NSMenu, titled title: String, to main: NSMenu) {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.submenu = menu
    main.addItem(item)
  }

  @objc private func reload() { web.reload() }
  @objc private func zoomReset() { web.webView.pageZoom = 1 }
  @objc private func zoomIn() { web.webView.pageZoom = min(web.webView.pageZoom + 0.1, 2) }
  @objc private func zoomOut() { web.webView.pageZoom = max(web.webView.pageZoom - 0.1, 0.5) }

  /// Above ProPresenter's window while docked, which a Chrome app window can't
  /// do. Off unless chosen, and remembered.
  @objc private func toggleKeepOnTop(_ item: NSMenuItem) {
    let on = !UserDefaults.standard.bool(forKey: keepOnTopKey)
    UserDefaults.standard.set(on, forKey: keepOnTopKey)
    item.state = on ? .on : .off
    applyKeepOnTop()
  }

  private func applyKeepOnTop() {
    window.level = UserDefaults.standard.bool(forKey: keepOnTopKey) ? .floating : .normal
  }
}
