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
 *
 * `arrangementUuid`: the arrangement a playlist item chose, which ProPresenter
 * plays without selecting (`current_arrangement` stays empty). `pending`: which
 * arrangement is playing isn't known yet, so no words or count at all; wrong
 * words are worse than none (owner, 2026-11-05).
 */
export function playingFromDoc(doc, { arrangementUuid = null, pending = false } = {}) {
  const p = doc?.presentation;
  if (!p || !p.id?.uuid) return null;
  if (pending) return { presentationId: p.id.uuid, arrangementId: null, arrangementName: null, slides: null, count: null, pending: true, outline: outlineOf(p) };
  const chosen = arrangementUuid ? { ...doc, presentation: { ...p, current_arrangement: arrangementUuid } } : doc;
  const resolved = resolveArrangement(chosen, []); // the selected (or chosen) arrangement: no preference given
  const slides = flattenGroups(resolved.groups).map((s) => ({ index: s.index, text: s.text, groupName: s.groupName }));
  return { presentationId: p.id.uuid, arrangementId: resolved.arrangementId, arrangementName: resolved.arrangementName, slides, count: slides.length, outline: outlineOf(p) };
}

/**
 * Which arrangement is playing, when ProPresenter's own answer may not say
 * (measured on 21.3, 2026-11-04: an item played from a playlist that chose an
 * arrangement leaves `current_arrangement` empty, while the live index counts
 * in that arrangement). `playlistItem` is the playlist item ProPresenter says is
 * active, if it is this presentation (`{ arrangementUuid }`), else null.
 * @returns {{ uuid?: string, raw?: true, pending?: true }} the arrangement, the
 *   file's own order, or not known yet (the playlist answer lags the trigger by
 *   about half a second; after a few asks with no answer it was the library)
 */
export function playingArrangement(doc, playlistItem, { lastTry = false } = {}) {
  const p = doc?.presentation ?? {};
  if (p.current_arrangement) return { uuid: p.current_arrangement };
  if (!(p.arrangements ?? []).length) return { raw: true };
  if (playlistItem) return playlistItem.arrangementUuid ? { uuid: playlistItem.arrangementUuid } : { raw: true };
  return lastTry ? { raw: true } : { pending: true };
}

/**
 * Every arrangement's slides by label and group, no words: what the service
 * log's per-slide timing names a slide by (docs/service-feed.md). Groups by
 * uuid with their slides' labels; arrangements by uuid and name with their
 * groups in play order; and the arrangement ProPresenter says is selected
 * (empty for an item played from a playlist that chose one).
 */
export function outlineOf(p) {
  return {
    current: p?.current_arrangement || null,
    groups: Object.fromEntries((p?.groups ?? []).map((g) => [g.uuid, { name: g.name ?? null, labels: (g.slides ?? []).map((s) => s.label ?? "") }])),
    arrangements: (p?.arrangements ?? []).map((a) => ({ uuid: a.id?.uuid ?? null, name: a.id?.name ?? null, groups: a.groups ?? [] })),
  };
}

/**
 * The label and group of slide `index` in the arrangement that is playing:
 * the one a playlist item chose (`arrangementUuid`), else the one selected,
 * else the document's own order when it has no arrangements. With several
 * arrangements and none known, null: a guess would name the wrong slide.
 */
export function slideInOutline(outline, arrangementUuid, index) {
  if (!outline || !Number.isInteger(index) || index < 0) return null;
  const arrangements = outline.arrangements ?? [];
  const chosen = arrangements.find((a) => a.uuid && a.uuid === (arrangementUuid || outline.current));
  if (!chosen && arrangements.length) return null;
  const order = chosen ? chosen.groups : Object.keys(outline.groups ?? {});
  let at = index;
  for (const uuid of order) {
    const g = outline.groups?.[uuid];
    if (!g) continue;
    if (at < g.labels.length) return { label: g.labels[at] || null, group: g.name };
    at -= g.labels.length;
  }
  return null;
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
  if (Number.isInteger(slideIndex) && Number.isInteger(entry.count) && slideIndex >= entry.count && now - entry.at > PLAYING_RETRY_MS) return true;
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
      text: playing.slides?.[slideIndex]?.text ?? null,
      slideCount: playing.count,
      arrangementName: playing.arrangementName ?? null,
    };
  }
  const agrees = indexed && indexed.arrangementName != null && indexed.arrangementName === indexed.selectedArrangementName;
  return agrees
    ? { text: indexed.text ?? null, slideCount: indexed.slideCount ?? null, arrangementName: indexed.arrangementName }
    : { text: null, slideCount: null, arrangementName: null };
}
