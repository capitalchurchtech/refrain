// The WKWebView and the browser behaviour Chrome gave the page for free:
// confirm(), file pickers, downloads and links that leave Refrain. Without
// these WKWebView silently does nothing, and a silent confirm() returns false.
import AppKit
import WebKit

final class WebController: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
  let webView: WKWebView
  let server: URL
  private var retryTimer: Timer?
  private var showingNotRunning = false
  private var themeObservation: NSKeyValueObservation?

  init(server: URL, version: String) {
    self.server = server
    let config = WKWebViewConfiguration()
    // Lets the page tell it is in the app, if it ever needs to.
    config.applicationNameForUserAgent = "RefrainApp/\(version)"
    webView = WKWebView(frame: .zero, configuration: config)
    super.init()
    config.userContentController.add(WeakHandler(self), name: "refrainShell")
    // The title bar follows the page's theme-color, which applyTheme in
    // public/nav.js keeps current, as Chrome's app window does.
    themeObservation = webView.observe(\.themeColor, options: [.initial, .new]) { [weak self] web, _ in
      guard let color = web.themeColor else { return }
      DispatchQueue.main.async { self?.applyBackground(color) }
    }
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = false
    // The page's own dark background, so a load never flashes white.
    webView.underPageBackgroundColor = NSColor(red: 0x0C / 255, green: 0x0A / 255, blue: 0x11 / 255, alpha: 1)
    if #available(macOS 13.3, *) { webView.isInspectable = true }
  }

  func load() {
    showingNotRunning = false
    webView.load(URLRequest(url: server, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10))
  }

  /// Reload what's on screen, keeping the screen (#service/live, say), as
  /// Chrome's reload does. From the not-running page, try Refrain again.
  func reload() {
    if let current = webView.url, Routing.route(current, server: server) == .inApp, current.scheme?.hasPrefix("http") == true {
      webView.reloadFromOrigin()
    } else {
      load()
    }
  }

  // MARK: Navigation

  func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.cancel) }
    if action.shouldPerformDownload { return decisionHandler(.download) }
    let route = Routing.route(url, server: server)
    // Only a click in the page itself may open the browser; a frame inside
    // it loading another site is cancelled, never opened.
    if action.targetFrame?.isMainFrame == false {
      return decisionHandler(route == .inApp ? .allow : .cancel)
    }
    switch route {
    case .inApp:
      decisionHandler(.allow)
    case .browser:
      NSWorkspace.shared.open(url)
      decisionHandler(.cancel)
    case .refuse:
      decisionHandler(.cancel)
    }
  }

  func webView(_ w: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(response.canShowMIMEType ? .allow : .download)
  }

  func webView(_ w: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ w: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  /// target="_blank" and window.open: Refrain's own pages load here, the rest
  /// go to the browser. A second app window is never opened.
  func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    guard let url = action.request.url else { return nil }
    switch Routing.route(url, server: server) {
    case .inApp:
      // Only Refrain's own pages replace this one. A data:, blob: or
      // about:blank "window" would leave Refrain with no way back.
      if url.scheme?.hasPrefix("http") == true { w.load(action.request) }
    case .browser:
      NSWorkspace.shared.open(url)
    case .refuse:
      break
    }
    return nil
  }

  func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError error: Error) {
    let e = error as NSError
    // A link that became a download "fails" its navigation on purpose.
    if e.domain == "WebKitErrorDomain" && e.code == 102 { return }
    // Replaced by a newer navigation (a reload during a load): not an outage.
    if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
    showNotRunning(reason: e.localizedDescription)
  }

  func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
    if !showingNotRunning { retryTimer?.invalidate(); retryTimer = nil }
  }

  func webViewWebContentProcessDidTerminate(_ w: WKWebView) { reload() }

  // MARK: Refrain isn't answering

  /// Shown when the server doesn't answer. Retries by itself every three
  /// seconds, so starting Refrain any other way also brings the window back.
  private func showNotRunning(reason: String) {
    showingNotRunning = true
    let address = server.absoluteString.replacingOccurrences(of: "<", with: "&lt;")
    let html = """
    <!doctype html><meta charset="utf-8"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#0C0A11">
    <style>
      body { background:#0C0A11; color:#E9E4F0; font:15px/1.5 -apple-system, system-ui, sans-serif; margin:0; padding:32px 24px; }
      h1 { font-size:20px; margin:0 0 8px; } p { color:#B3ABBF; margin:0 0 16px; }
      code { font:13px ui-monospace, Menlo, monospace; color:#E9E4F0; }
      button { font:inherit; background:#7C3AED; color:#fff; border:0; border-radius:8px; padding:8px 14px; cursor:pointer; }
      #said { min-height:1.5em; }
    </style>
    <h1>Refrain isn't answering</h1>
    <p>This window shows Refrain from <code>\(address)</code>, and nothing is answering there yet. It tries again every few seconds by itself.</p>
    <p><button onclick="webkit.messageHandlers.refrainShell.postMessage('start')">Start Refrain</button></p>
    <p id="said"></p>
    <p>If it doesn't start, run <code>scripts/start.command</code> in the Refrain folder, or turn on Start at login on the Health screen once it's running.</p>
    """
    webView.loadHTMLString(html, baseURL: nil)
    if retryTimer == nil {
      retryTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.probe() }
    }
  }

  /// Asks the server for a page without disturbing the one on screen, and
  /// loads Refrain once it answers.
  private func probe() {
    var req = URLRequest(url: server, timeoutInterval: 2)
    req.httpMethod = "HEAD"
    URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
      guard resp != nil else { return }
      DispatchQueue.main.async { if self?.showingNotRunning == true { self?.load() } }
    }.resume()
  }

  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    // Only the not-running page may ask to start Refrain: its own pages have
    // their own Restart, and this handler is reachable from every page.
    guard showingNotRunning, message.body as? String == "start" else { return }
    // launchctl can be slow while launchd is busy; never hold up the window.
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      let started = Self.kickstartLoginItem()
      let said = started ? "Starting Refrain…" : "Refrain isn't set to start at login on this Mac, so it can't be started from here."
      DispatchQueue.main.async {
        guard let self, self.showingNotRunning else { return }
        self.webView.callAsyncJavaScript("document.getElementById('said').textContent = said", arguments: ["said": said], in: nil, in: .page)
      }
    }
  }

  /// The same job panic.js restarts through: com.refrain.server, the Start at
  /// login LaunchAgent. False when it isn't installed.
  static func kickstartLoginItem() -> Bool {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    p.arguments = ["kickstart", "gui/\(getuid())/com.refrain.server"]
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    do { try p.run(); p.waitUntilExit() } catch { return false }
    return p.terminationStatus == 0
  }

  private func applyBackground(_ color: NSColor) {
    guard let srgb = color.usingColorSpace(.sRGB), srgb.alphaComponent > 0, let win = webView.window else { return }
    win.titlebarAppearsTransparent = true
    win.backgroundColor = srgb
    webView.underPageBackgroundColor = srgb
    // Dark text on a dark bar is unreadable, so the bar's appearance follows too.
    win.appearance = NSAppearance(named: Self.isDark(srgb.redComponent, srgb.greenComponent, srgb.blueComponent) ? .darkAqua : .aqua)
  }

  static func isDark(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> Bool {
    0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5
  }

  // MARK: alert, confirm, prompt

  func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK")
    sheet(a) { _ in completionHandler() }
  }

  func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert(); a.messageText = message
    a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
    sheet(a) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
    let a = NSAlert(); a.messageText = prompt
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
    field.stringValue = defaultText ?? ""
    a.accessoryView = field
    a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
    sheet(a) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
  }

  private func sheet(_ alert: NSAlert, done: @escaping (NSApplication.ModalResponse) -> Void) {
    if let win = webView.window { alert.beginSheetModal(for: win, completionHandler: done) } else { done(alert.runModal()) }
  }

  // MARK: <input type="file">

  func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = p.allowsMultipleSelection
    panel.canChooseDirectories = p.allowsDirectories
    panel.canChooseFiles = true
    if let win = w.window {
      panel.beginSheetModal(for: win) { completionHandler($0 == .OK ? panel.urls : nil) }
    } else {
      completionHandler(panel.runModal() == .OK ? panel.urls : nil)
    }
  }

  // MARK: Downloads

  func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename name: String, completionHandler: @escaping (URL?) -> Void) {
    let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
    let dest = Routing.uniqueDestination(folder: folder, suggested: name) { FileManager.default.fileExists(atPath: $0.path) }
    downloads[ObjectIdentifier(d)] = dest
    completionHandler(dest)
  }

  private var downloads: [ObjectIdentifier: URL] = [:]

  func downloadDidFinish(_ d: WKDownload) {
    // Chrome shows a download bubble; with none, the file would just vanish
    // into Downloads. The person pressed Download, so show them where it went.
    if let url = downloads.removeValue(forKey: ObjectIdentifier(d)) { NSWorkspace.shared.activateFileViewerSelecting([url]) }
  }

  func download(_ d: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    downloads.removeValue(forKey: ObjectIdentifier(d))
    let a = NSAlert(); a.messageText = "The download didn't finish."; a.informativeText = error.localizedDescription
    sheet(a) { _ in }
  }
}

/// WKUserContentController holds its handler strongly, and the controller
/// holds the web view, so a direct handler would never be freed.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
  weak var target: WKScriptMessageHandler?
  init(_ target: WKScriptMessageHandler) { self.target = target }
  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(c, didReceive: message)
  }
}
