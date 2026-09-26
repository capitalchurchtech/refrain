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
