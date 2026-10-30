/**
 * How long each item was up, for the phone's History page (owner, 2026-10-09:
 * a stopwatch's splits, not a "last seen" list).
 *
 * One entry per stay: a presentation comes up, stays until a different one
 * comes up or the screens are cleared, and that is a split. Coming back to a
 * song later is a new entry, because the question is "how long was it up that
 * time", which a one-row-per-song list (server/return-history.js) cannot answer.
 *
 * In memory, like the return history: it describes a service in progress, and
 * a restart starting it again is correct. Pure; the heartbeat calls it.
 */

export const MAX_SPLITS = 60;

/**
 * How long the screens can read as empty before a stay is over. A long item (a
 * sermon) goes blank for a while (a prayer, a pause with the slide cleared), and
 * a heartbeat that can't read the current slide looks the same for a moment. Cut
 * at the first blank, one sermon became rows of a minute, a minute and a half,
 * three and a half minutes (owner, 2026-10-10). A blank shorter than this belongs
 * to the item that was up before it.
 */
export const BLANK_GRACE_MS = 5 * 60_000;

/** An entry without its "went blank" mark. */
const forgiven = (entry) => {
  const copy = { ...entry };
  delete copy.blankSince;
  return copy;
};

/**
 * @param {Array} log  entries, newest first: { id, presentationId, name, startMs, endMs|null, blankSince? }
 *   (`blankSince` is when the open entry's screens last went empty, while that is still being forgiven)
 * @param {{presentationId: string, name?: string|null}|null} item  what is on the screens now, or null when nothing is
 * @returns the same array when nothing changed, otherwise a new one
 */
export function noteItem(log, item, now = Date.now(), max = MAX_SPLITS, graceMs = BLANK_GRACE_MS) {
  const list = log ?? [];
  const open = list[0]?.endMs == null ? list[0] : null;
  const pid = item?.presentationId ?? null;
  if (!open && !pid) return list; // nothing was up and nothing is

  // Where the open stay really ended if it is over: when it went blank, else now.
  const endedAt = open ? (open.blankSince ?? now) : now;
  const gone = open?.blankSince != null && now - open.blankSince > graceMs; // blank for too long

  if (open && !gone) {
    if (!pid) {
      // Empty now: remember since when, and carry on.
      return open.blankSince != null ? list : [{ ...open, blankSince: now }, ...list.slice(1)];
    }
    if (open.presentationId === pid) {
      // The same item, back from a short blank (or never left).
      if (open.blankSince == null) return list;
      return [forgiven(open), ...list.slice(1)];
    }
  }

  // The stay is over: a different item came up, or it has been blank too long.
  let next = list;
  if (open) {
    // Why it ended, for the service log: another item came up, or the screens
    // stayed blank past the grace (then it ended when they went blank).
    next = [{ ...forgiven(open), endMs: endedAt, reason: gone ? "blank-timeout" : "moved" }, ...list.slice(1)];
  }
  if (pid) next = [{ id: `${now.toString(36)}-${next.length}`, presentationId: pid, name: item.name ?? null, startMs: now, endMs: null }, ...next];
  return next.slice(0, max);
}

/** What the phone shows: a name, when it came up, when it left, and how long it was up (still counting for the open one). */
export function splitsView(log, now = Date.now()) {
  return (log ?? []).map((e) => ({
    id: e.id,
    presentationId: e.presentationId,
    name: e.name ?? "Untitled",
    startedAt: new Date(e.startMs).toISOString(),
    endedAt: e.endMs == null ? null : new Date(e.endMs).toISOString(),
    elapsedMs: Math.max(0, (e.endMs ?? now) - e.startMs),
    current: e.endMs == null,
    // Open, but the screens are empty right now (a blank being forgiven).
    blank: e.endMs == null && e.blankSince != null,
  }));
}

// --- What leaves this Mac: the status feed's snapshot and the service log ------
// (docs/service-feed.md). Presentation names only: no slide text, no
// presentation ids, nothing about who did anything.

export const FEED_ITEMS_MAX = 30;
export const FEED_NAME_MAX = 200;
const nameOf = (e) => String(e.name ?? "Untitled").slice(0, FEED_NAME_MAX);

/** The `history` snapshot for POST /status: newest first, capped. Times are UTC. */
export function feedItems(log, max = FEED_ITEMS_MAX) {
  return (log ?? []).slice(0, max).map((e) => ({
    id: e.id,
    name: nameOf(e),
    startedAt: new Date(e.startMs).toISOString(),
    endedAt: e.endMs == null ? null : new Date(e.endMs).toISOString(),
    current: e.endMs == null,
    blank: e.endMs == null && e.blankSince != null,
  }));
}

/**
 * The `item` lines to write when the log went from `prev` to `next`: one when an
 * item opens (endedAt null) and one, with the same id, when it closes. The
 * later line wins per id, so an item still on screen when the log is sent is
 * there as an open line. Oldest first.
 */
export function itemLines(prev, next, tz) {
  const was = new Map((prev ?? []).map((e) => [e.id, e]));
  const lines = [];
  for (const e of [...(next ?? [])].reverse()) {
    const p = was.get(e.id);
    if (p && !(p.endMs == null && e.endMs != null)) continue; // unchanged
    lines.push({
      id: e.id,
      name: nameOf(e),
      startedAt: new Date(e.startMs).toISOString(),
      endedAt: e.endMs == null ? null : new Date(e.endMs).toISOString(),
      reason: e.endMs == null ? null : (e.reason ?? "moved"),
      tz,
    });
  }
  return lines;
}

/**
 * Items a previous run left open (Refrain was restarted, or crashed, mid-
 * service): one close line each, ended at the last moment that run wrote
 * anything, reason "restart". `text` is the day file(s), JSON Lines; only lines
 * written before `before` (this run's start) count, so this run's own items are
 * never closed. The run that comes back opens its items afresh, with new ids.
 */
export function leftOpenLines(text, before, tz) {
  const latest = new Map();
  let lastT = null;
  for (const raw of String(text ?? "").split("\n")) {
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof line?.t !== "string" || line.t >= before) continue;
    lastT = lastT == null || line.t > lastT ? line.t : lastT;
    if (line.event === "item" && typeof line.id === "string") latest.set(line.id, line);
  }
  return [...latest.values()]
    .filter((l) => l.endedAt == null)
    .map((l) => ({ id: l.id, name: l.name, startedAt: l.startedAt, endedAt: lastT, reason: "restart", tz: l.tz ?? tz }));
}
