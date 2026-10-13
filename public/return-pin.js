/**
 * One reader for /api/return-pin, shared by the Return bar (polls every 3 s,
 * always) and the History flyout (polls every 4 s while open). Both used to ask
 * on their own clocks, so an open flyout doubled the requests for the same answer.
 *
 * `maxAgeMs` is how old an answer the caller will accept: the bar passes 0 (it
 * is the one that keeps the answer fresh), the flyout accepts what the bar just
 * fetched. A request already in flight is joined, not repeated, unless the
 * caller needs an answer from after something it just did (`fresh`: the bar
 * right after a jump, which must not be handed a request sent before it).
 */

let inFlight = null;
let last = null; // { at, data }
let seq = 0; // requests started
let storedSeq = 0; // the newest request whose answer is kept, so a slow old one cannot overwrite a newer one

export function loadReturnPin({ maxAgeMs = 0, fresh = false, now = Date.now() } = {}) {
  if (!fresh && maxAgeMs > 0 && last && now - last.at <= maxAgeMs) return Promise.resolve(last.data);
  if (!fresh && inFlight) return inFlight;
  const mine = ++seq;
  const request = fetch("/api/return-pin")
    .then((r) => r.json())
    .then((data) => {
      if (mine > storedSeq) {
        storedSeq = mine;
        last = { at: Date.now(), data };
      }
      return data;
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  return request;
}
