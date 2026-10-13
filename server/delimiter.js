/**
 * The church's delimiter item (owner, 2026-10-13): a library item that, while it
 * is on the screens, means pre-service, post-service or intermission. Here it is
 * "Scrolling Slides". Named in `liveModule.delimiterItems` (names or the start of
 * a name, any case); nothing is a delimiter until a church lists one.
 *
 * Two uses. It is marked in the item history and the feed (`kind: "delimiter"`)
 * so the other side does not have to guess by name. And once it has been up for
 * DELIMITER_QUIET_MS, the items of the running playlist are refreshed lightly
 * (search-index.js refreshIndexEntries) so the arrangements Refrain knows match
 * what ProPresenter has, without the full reindex performance mode forbids. It
 * stops, between reads, the moment the delimiter is not what is on the screens.
 *
 * Pure: the clock and the item are arguments.
 */

/** How long the delimiter must have been up before anything is read: long enough that it is not a flick through. */
export const DELIMITER_QUIET_MS = 5 * 60_000;

/** The names a church listed, tidied: strings only, trimmed, no empties. */
export function delimiterNames(list) {
  return (Array.isArray(list) ? list : []).filter((n) => typeof n === "string").map((n) => n.trim()).filter(Boolean);
}

/** Whether a presentation's name is the delimiter: it is, or starts with, a listed name. */
export function isDelimiterName(name, list) {
  const n = String(name ?? "").trim().toLowerCase();
  return Boolean(n) && delimiterNames(list).some((d) => n.startsWith(d.toLowerCase()));
}

/** Whether this open item is the delimiter, on the screens right now (not cleared for a moment). */
export function delimiterOnScreen(open) {
  return Boolean(open && open.endMs == null && open.delimiter && open.blankSince == null);
}

/**
 * Whether to start the light refresh: the delimiter has been on the screens for
 * the quiet time, and this stay has not been refreshed already.
 */
export function rescanDue(open, now, doneFor = null) {
  return delimiterOnScreen(open) && now - open.startMs >= DELIMITER_QUIET_MS && open.id !== doneFor;
}
