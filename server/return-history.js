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

/**
 * How many places back the operator can reach.
 *
 * Raised from ten when the history started recording from the first item rather
 * than from the first jump: a service runs fifteen to twenty-five items between
 * countdown and closer, and a list that drops the opening song halfway through
 * the morning is not a record of the service.
 */
export const MAX_RETURN_HISTORY = 30;

/** Two entries are the same place if they are the same slide of the same presentation. */
export function sameSlide(a, b) {
  return Boolean(a && b && a.presentationId === b.presentationId && a.slideIndex === b.slideIndex);
}

/**
 * Records a presentation that has been live, newest first.
 *
 * **Item granularity, not slide**, and that is the whole difference from
 * `pushReturnEntry`. The history now fills from the first item ProPresenter
 * loads rather than from the first time the operator uses Go Live, which means
 * it sees every slide change -- and a worship leader advancing thirty slides
 * through one song would otherwise bury the running order under thirty entries
 * of the same song. One entry per presentation makes the panel read like the
 * service.
 *
 * Revisiting a presentation moves it to the front and takes the newer slide
 * index, so "go back to that song" lands where the operator last was in it
 * rather than at the slide it opened on.
 */
export function pushLiveItem(history, entry, max = MAX_RETURN_HISTORY) {
  if (!entry || !entry.presentationId || !Number.isInteger(entry.slideIndex)) return history ?? [];
  const rest = (history ?? []).filter((e) => e.presentationId !== entry.presentationId);
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
  const list = history ?? [];
  // Exact match first, for a caller that has a current slide index.
  const exact = list.find(
    (e) => e.presentationId === presentationId && e.slideIndex === Number(slideIndex)
  );
  if (exact) return exact;
  // Otherwise fall back to the presentation. With item granularity the stored
  // slide index advances as the operator moves through a song, so a panel
  // rendered a few seconds ago can carry a stale index -- and returning to the
  // right song at a slightly different slide is obviously better than refusing
  // because a number moved. Focus is presentation-level anyway.
  return list.find((e) => e.presentationId === presentationId) ?? null;
}
