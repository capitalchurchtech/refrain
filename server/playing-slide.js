/**
 * The slide that is really on the screens, in the arrangement that is really
 * playing (owner, 2026-10-13).
 *
 * ProPresenter's live slide index counts in the arrangement SELECTED in the app.
 * Refrain's index holds the arrangement it prefers (FS, say), which for a
 * presentation like "Graves Into Gardens - [ T ]" is a different one: at live
 * slide 21 the screens showed "You turn seas into highways" (T, 27 slides) while
 * the index's slide 21 said "You turn shame into glory" (FS, 29 slides). So the
 * words, the slide count and the arrangement name of a live slide come from the
 * live presentation itself (`GET /v1/presentation/active`, read once when a
 * presentation goes live and now and then after), never from the index, unless
 * the index was built from the selected arrangement.
 *
 * Numbers: ProPresenter's API counts slides from 0 and its screens from 1.
 * `slideIndex` is the API's; `slideNumber` is what a person sees (index + 1).
 *
 * Pure: the read lives in index.js.
 */

import { resolveArrangement, flattenGroups } from "./arrangements.js";

/** How long a read of the live presentation is trusted before asking again (an arrangement can be changed under it). */
export const PLAYING_TTL_MS = 60_000;
/** The soonest a slide past the end of what was read asks again. */
export const PLAYING_RETRY_MS = 5_000;

/** The number a person sees for an API slide index. */
export const slideNumber = (slideIndex) => (Number.isInteger(slideIndex) && slideIndex >= 0 ? slideIndex + 1 : null);

/**
 * What the live presentation says it is playing, from its document, or null
 * when the document is not one (nothing live, or not a presentation).
 */
export function playingFromDoc(doc) {
  const p = doc?.presentation;
  if (!p || !p.id?.uuid) return null;
  const resolved = resolveArrangement(doc, []); // the selected arrangement: no preference given
  const slides = flattenGroups(resolved.groups).map((s) => ({ index: s.index, text: s.text, groupName: s.groupName }));
  return { presentationId: p.id.uuid, arrangementId: resolved.arrangementId, arrangementName: resolved.arrangementName, slides, count: slides.length };
}

/**
 * Whether the live presentation should be read again: never read, the live
 * index is past what was read (slides were added), or the read is old. `quiet`
 * (performance mode) asks only for the first two: no periodic look during a service.
 */
export function playingStale(entry, slideIndex, now, { quiet = false, ttlMs = PLAYING_TTL_MS } = {}) {
  if (!entry) return true;
  // Past the end means slides were added, but not worth asking every beat: if the
  // read is fresh and the index is still past it, the numbers disagree for another reason.
  if (Number.isInteger(slideIndex) && slideIndex >= entry.count && now - entry.at > PLAYING_RETRY_MS) return true;
  return !quiet && now - entry.at > ttlMs;
}

/**
 * The live slide's words, count and arrangement name. From the live read when
 * there is one. Otherwise from the index only if the index was built from the
 * arrangement that is selected (then the two agree); else nothing, never a guess.
 */
export function liveSlideDetails({ playing, slideIndex, indexed }) {
  if (playing) {
    return {
      text: playing.slides[slideIndex]?.text ?? null,
      slideCount: playing.count,
      arrangementName: playing.arrangementName ?? null,
    };
  }
  const agrees = indexed && indexed.arrangementName != null && indexed.arrangementName === indexed.selectedArrangementName;
  return agrees
    ? { text: indexed.text ?? null, slideCount: indexed.slideCount ?? null, arrangementName: indexed.arrangementName }
    : { text: null, slideCount: null, arrangementName: null };
}
