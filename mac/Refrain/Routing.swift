// Where a link goes, and where a download lands. Pure, so the rules are
// checked without a window (see .claude/mac-wrapper-plan.md, Phase B).
import Foundation

enum Route: Equatable {
  /// Refrain's own pages, and the data: and blob: URLs they make.
  case inApp
  /// Anything else on the web: the person's own browser, never this window.
  case browser
  /// Something with no business being opened at all.
  case refuse
}

enum Routing {
  /// Refrain's address, from (in order) `--url`, the `RefrainURL` default,
  /// the address the build found in the Start at login job, then the
  /// server's own default port.
  static func serverURL(arguments: [String], defaults: UserDefaults, built: String?) -> URL {
    if let i = arguments.firstIndex(of: "--url"), i + 1 < arguments.count, let u = URL(string: arguments[i + 1]) { return u }
    if let s = defaults.string(forKey: "RefrainURL"), let u = URL(string: s) { return u }
    if let s = built, !s.isEmpty, let u = URL(string: s) { return u }
    return URL(string: "http://127.0.0.1:9999/")!
  }

  /// The window only ever shows Refrain itself. A link to Bible Gateway or
  /// GitHub opens in the browser, so the app never becomes a web browser
  /// that someone mistakes for a safe one.
  static func route(_ url: URL, server: URL) -> Route {
    switch url.scheme?.lowercased() {
    case "data", "blob", "about":
      return .inApp
    case "http", "https":
      return sameServer(url, server) ? .inApp : .browser
    case "mailto":
      return .browser
    default:
      return .refuse
    }
  }

  /// localhost and 127.0.0.1 are the same machine; the port must match.
  static func sameServer(_ a: URL, _ b: URL) -> Bool {
    let local: Set<String> = ["localhost", "127.0.0.1", "::1", "[::1]"]
    let ha = a.host?.lowercased() ?? "", hb = b.host?.lowercased() ?? ""
    let sameHost = ha == hb || (local.contains(ha) && local.contains(hb))
    return sameHost && port(a) == port(b)
  }

  private static func port(_ u: URL) -> Int {
    u.port ?? (u.scheme?.lowercased() == "https" ? 443 : 80)
  }

  /// A file name in `folder` that doesn't overwrite anything already there:
  /// "qr-url.png", then "qr-url 2.png", "qr-url 3.png".
  static func uniqueDestination(folder: URL, suggested: String, exists: (URL) -> Bool) -> URL {
    let clean = suggested.replacingOccurrences(of: "/", with: "-").trimmingCharacters(in: .whitespaces)
    let name = clean.isEmpty ? "download" : clean
    let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
    var candidate = folder.appendingPathComponent(name)
    var n = 2
    while exists(candidate) {
      candidate = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
      n += 1
    }
    return candidate
  }
}
