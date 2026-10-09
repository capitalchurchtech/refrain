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
 * @param {Array} log  entries, newest first: { id, presentationId, name, startMs, endMs|null }
 * @param {{presentationId: string, name?: string|null}|null} item  what is on the screens now, or null when nothing is
 * @returns the same array when nothing changed, otherwise a new one
 */
export function noteItem(log, item, now = Date.now(), max = MAX_SPLITS) {
  const list = log ?? [];
  const open = list[0]?.endMs == null ? list[0] : null;
  const pid = item?.presentationId ?? null;
  if (open && open.presentationId === pid) return list; // still the same item
  if (!open && !pid) return list; // nothing was up and nothing is
  let next = list;
  if (open) next = [{ ...open, endMs: now }, ...list.slice(1)]; // moved away, or cleared
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
