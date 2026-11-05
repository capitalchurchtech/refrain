// refrain-snapshot: photographs slides Refrain has drawn, for phones (server/phone-pictures.js).
//
// Reads lines of "<url>\t<output.jpg>" on stdin until it closes, then for each one loads the
// url in an off-screen WKWebView, waits for the page to set document.body.dataset.done (its
// fonts are in and the drawing is laid out), and saves a 960x540 JPEG through a temp file and
// a rename. Prints one JSON line per picture: {"out": path, "ok": true} or {"out", "ok": false,
// "error"}. The pages are Refrain's own, on 127.0.0.1, so the Mac's own fonts are used and
// ProPresenter is never asked for anything. Built by scripts/build-mac-app.command into
// Refrain.app/Contents/Helpers. macOS only.
import AppKit
import WebKit

let width: CGFloat = 960, height: CGFloat = 540
var jobs: [(URL, String)] = []
while let line = readLine() {
  let parts = line.split(separator: "\t", maxSplits: 1).map(String.init)
  if parts.count == 2, let url = URL(string: parts[0]) { jobs.append((url, parts[1])) }
}

func say(_ out: String, _ ok: Bool, _ error: String? = nil) {
  var line: [String: Any] = ["out": out, "ok": ok]
  if let error { line["error"] = error }
  if let data = try? JSONSerialization.data(withJSONObject: line), let text = String(data: data, encoding: .utf8) { print(text) }
  fflush(stdout)
}

final class Shooter: NSObject, WKNavigationDelegate {
  let web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height))
  var index = -1
  var deadline: DispatchWorkItem?

  func next() {
    index += 1
    guard index < jobs.count else { exit(0) }
    let (url, _) = jobs[index]
    // A page that never finishes is skipped, not waited on forever.
    let current = index
    let timer = DispatchWorkItem { [weak self] in
      guard let self, self.index == current else { return }
      say(jobs[current].1, false, "timed out")
      self.next()
    }
    deadline = timer
    DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timer)
    web.load(URLRequest(url: url))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    let current = index
    func poll(_ tries: Int) {
      webView.evaluateJavaScript("document.body && document.body.dataset.done || ''") { result, _ in
        guard current == self.index else { return }
        if (result as? String) == "1" || tries > 60 { self.shoot(current) }
        else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { poll(tries + 1) } }
      }
    }
    poll(0)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }

  func failed(_ error: Error) {
    deadline?.cancel()
    say(jobs[index].1, false, error.localizedDescription)
    next()
  }

  func shoot(_ current: Int) {
    let config = WKSnapshotConfiguration()
    config.rect = NSRect(x: 0, y: 0, width: width, height: height)
    config.snapshotWidth = NSNumber(value: Double(width))
    web.takeSnapshot(with: config) { image, error in
      guard current == self.index else { return }
      self.deadline?.cancel()
      let out = jobs[current].1
      // Drawn into a 960x540 bitmap: on a Retina screen the snapshot is twice that, four times the bytes a phone needs.
      guard let image, let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width), pixelsHigh: Int(height), bitsPerSample: 8,
                                                  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
            let context = NSGraphicsContext(bitmapImageRep: rep) else {
        say(out, false, error?.localizedDescription ?? "no picture")
        return self.next()
      }
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = context
      image.draw(in: NSRect(x: 0, y: 0, width: width, height: height))
      NSGraphicsContext.restoreGraphicsState()
      guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82]) else {
        say(out, false, error?.localizedDescription ?? "no picture")
        return self.next()
      }
      let temp = out + ".tmp"
      do {
        try jpeg.write(to: URL(fileURLWithPath: temp))
        // rename(2) replaces any older picture at once, so a phone never reads half of one.
        guard Darwin.rename(temp, out) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        say(out, true)
      } catch {
        try? FileManager.default.removeItem(atPath: temp)
        say(out, false, error.localizedDescription)
      }
      self.next()
    }
  }
}

if jobs.isEmpty { exit(0) }
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let window = NSWindow(contentRect: NSRect(x: -10000, y: -10000, width: width, height: height), styleMask: [.borderless], backing: .buffered, defer: false)
let shooter = Shooter()
window.contentView = shooter.web
shooter.web.navigationDelegate = shooter
shooter.next()
app.run()
