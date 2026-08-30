/**
 * Where you were, the last several times you jumped.
 *
 * The Return bar used to pin exactly one slide: the one that was live when the
 * operator jumped. That works for a single tangent and silently fails for two.
 * Jump from the plan to a lyric, then from that lyric to another, and the pin
 * now points at the first tangent — the way back to the plan is gone, having
 * been overwritten by the thing you were trying to leave. That is the
 * "sometimes works, not reliably" case, and it is worst in exactly the
 * situation that produces two jumps: hunting for something mid-service.
 *
 * So it is a short history rather than a slot. Ten entries, newest first.
 *
 * Kept in memory like the single pin before it, and for the same reason: this
 * is ephemeral live-service state, not something a volunteer would be upset to
 * lose. A restart clears it, which is correct — a stale "return to" from before
 * a restart would point at a service that already ended.
 */

/** How many places back the operator can reach. */
export const MAX_RETURN_HISTORY = 10;

/** Two entries are the same place if they are the same slide of the same presentation. */
export function sameSlide(a, b) {
  return Boolean(a && b && a.presentationId === b.presentationId && a.slideIndex === b.slideIndex);
}

/**
 * Records a place worth coming back to, newest first.
 *
 * Revisiting somewhere already in the history moves it to the front rather than
 * adding a second copy: the list is "places you can go back to", and a place
 * does not become two places by being left twice. Without that, bouncing
 * between two slides would fill all ten entries with those two.
 */
export function pushReturnEntry(history, entry, max = MAX_RETURN_HISTORY) {
  if (!entry || !entry.presentationId || !Number.isInteger(entry.slideIndex)) return history ?? [];
  const rest = (history ?? []).filter((e) => !sameSlide(e, entry));
  return [entry, ...rest].slice(0, max);
}

/**
 * Finds an entry the client asked for by presentation and slide.
 *
 * Matched by value rather than by array position, because the history can
 * change between the client rendering it and the operator clicking: another
 * screen can trigger a Go Live, which unshifts a new entry and shifts every
 * index by one. Position would silently return them to the wrong place.
 */
export function findReturnEntry(history, presentationId, slideIndex) {
  return (
    (history ?? []).find(
      (e) => e.presentationId === presentationId && e.slideIndex === Number(slideIndex)
    ) ?? null
  );
}
