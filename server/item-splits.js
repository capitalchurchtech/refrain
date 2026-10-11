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
    next = [{ ...forgiven(open), endMs: endedAt }, ...list.slice(1)];
  }
  if (pid) next = [{ id: `${now.toString(36)}-${next.length}`, presentationId: pid, name: item.name ?? null, startMs: now, endMs: null }, ...next];
  return next.slice(0, max);
}

/** What the phone shows: a name, when it came up, when it left, and how long it was up (still counting for the open one). */
export function splitsView(log, now = Date.now()) {
  return (log ?? []).map((e) => ({
    name: e.name ?? "Untitled",
    startedAt: new Date(e.startMs).toISOString(),
    endedAt: e.endMs == null ? null : new Date(e.endMs).toISOString(),
    elapsedMs: Math.max(0, (e.endMs ?? now) - e.startMs),
    current: e.endMs == null,
  }));
}
