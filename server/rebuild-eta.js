/**
 * How long a library read has left.
 *
 * The first version divided what was left by the average speed since the run
 * began. On a real library that said "under 5 minutes" at the start of a run
 * that took 17 to 20: the early reads are quick and the later ones are not
 * (ProPresenter slows as it holds more, the big decks come late, and Refrain
 * breathes between reads). An average over the whole run reports the fast part
 * for the slow part.
 *
 * So the speed used is the slower of two: the whole-run average and the speed
 * over the last stretch of reads. When a run is slowing, the recent speed
 * wins and the estimate grows with it; when it is steady the two agree. A run
 * too young to measure (a handful of reads) gives no estimate at all, rather
 * than a confident wrong one.
 */

/** Reads kept for the recent speed. */
export const RECENT_READS = 40;
/** Reads before an estimate is offered. */
export const MIN_READS_FOR_ETA = 10;

/** Notes one finished read, keeping only the last RECENT_READS times. Returns the list. */
export function noteRead(recent, at) {
  const out = [...(Array.isArray(recent) ? recent : []), at];
  return out.length > RECENT_READS ? out.slice(out.length - RECENT_READS) : out;
}

/**
 * @param {{current: number, total: number, startedAt: number, recent?: number[]}} p
 * @param {number} now
 * @returns {{perSec: number|null, etaMs: number|null}}
 */
export function readEta(p, now = Date.now()) {
  const elapsedMs = now - p.startedAt;
  if (!(p.current >= MIN_READS_FOR_ETA) || !(elapsedMs > 0)) return { perSec: null, etaMs: null };
  const overall = p.current / (elapsedMs / 1000);
  const r = p.recent ?? [];
  const span = r.length > 1 ? (now - r[0]) / 1000 : 0;
  const recent = span > 0 ? r.length / span : null;
  const perSec = recent ? Math.min(overall, recent) : overall;
  return { perSec, etaMs: Math.round(((p.total - p.current) / perSec) * 1000) };
}

/** Names kept for the progress card: the one just read first, then the two before it. */
export const RECENT_NAMES = 3;

/** Puts a just-read presentation's name at the front. Returns the list. */
export function noteName(names, name) {
  if (typeof name !== "string" || !name) return Array.isArray(names) ? names : [];
  return [name, ...(Array.isArray(names) ? names : [])].slice(0, RECENT_NAMES);
}
