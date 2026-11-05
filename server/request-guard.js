/**
 * Refuses a request that changes something when it comes from another
 * site's page. The main app only listens on 127.0.0.1, but any web page open
 * in the booth's browser can still send it a POST; without this, a page
 * could press Go Live, Clear, or "Forget all phones" behind the operator's
 * back. Browsers label such requests with an Origin; Refrain's own pages
 * send its own origin, and tools like curl send none, so both still work.
 */
export function crossSiteRefused(method, origin, host) {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (!origin) return false;
  let o;
  try {
    o = new URL(origin);
  } catch {
    return true;
  }
  const local = ["127.0.0.1", "localhost", "[::1]"];
  const [reqHost, reqPort] = String(host ?? "").split(/:(?=\d+$)/);
  return !(local.includes(o.hostname) && local.includes(reqHost) && (o.port || "80") === (reqPort || "80"));
}

/**
 * Refuses a request addressed to any name but this computer's own. The main
 * app listens on 127.0.0.1 only, but a website can point a name it controls at
 * 127.0.0.1 (DNS rebinding) and then read Refrain's answers as its own: the
 * index, the slides, the flags. Such a request carries that site's name in its
 * Host header; Refrain's own pages, the Mac app and curl send 127.0.0.1 or
 * localhost. A request with no Host at all (HTTP/1.0) is let through.
 */
export function hostRefused(host) {
  if (!host) return false;
  const name = String(host).toLowerCase().replace(/:\d+$/, "");
  return !(name === "127.0.0.1" || name === "localhost" || name === "[::1]" || name.endsWith(".localhost"));
}
