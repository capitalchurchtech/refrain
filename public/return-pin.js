/**
 * One reader for /api/return-pin, shared by the Return bar (polls every 3 s,
 * always) and the History flyout (polls every 4 s while open). Both used to ask
 * on their own clocks, so an open flyout doubled the requests for the same answer.
 *
 * `maxAgeMs` is how old an answer the caller will accept: the bar passes 0 (it
 * is the one that keeps the answer fresh), the flyout accepts what the bar just
 * fetched. A request already in flight is joined, not repeated.
 */

let inFlight = null;
let last = null; // { at, data }

export function loadReturnPin({ maxAgeMs = 0, now = Date.now() } = {}) {
  if (maxAgeMs > 0 && last && now - last.at <= maxAgeMs) return Promise.resolve(last.data);
  if (inFlight) return inFlight;
  inFlight = fetch("/api/return-pin")
    .then((r) => r.json())
    .then((data) => {
      last = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
