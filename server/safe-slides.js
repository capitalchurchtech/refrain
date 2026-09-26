/**
 * Safe slides (owner request, handoff §39a): the church's own known-good
 * pictures to cut to in a hurry, such as the logo, a blank or a standing
 * announcement. Unlike Clear, which empties a layer, a safe slide puts
 * something deliberate on the screens.
 *
 * Kept in config.json as `liveModule.safeSlides`, per machine. Each one is
 * stored by the slide's anchor (group id and position in the group), the
 * same way Search's Go Live fires, so re-arranging the deck can't turn
 * "Logo" into a lyric. Pure: index.js does the config write.
 */

import { randomBytes } from "node:crypto";

export const MAX_SAFE_SLIDES = 8;
const LABEL_MAX = 40;

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** A label from the slide itself: its first line of text, else the deck's name. */
export function defaultLabel({ slideText, presentationName, slideIndex }) {
  const first = clean(String(slideText ?? "").split("\n")[0]);
  if (first) return first.slice(0, LABEL_MAX);
  const deck = clean(presentationName);
  return (deck ? `${deck}, slide ${(slideIndex ?? 0) + 1}` : "Safe slide").slice(0, LABEL_MAX);
}

function valid(s) {
  return (
    s &&
    typeof s.id === "string" &&
    typeof s.presentationId === "string" &&
    s.presentationId.length > 0 &&
    Number.isInteger(s.slideIndex) &&
    s.slideIndex >= 0 &&
    typeof s.label === "string"
  );
}

/** The stored list, well-formed entries only. */
export function safeSlides(list) {
  return (Array.isArray(list) ? list : []).filter(valid).slice(0, MAX_SAFE_SLIDES);
}

/**
 * Adds a slide. The same slide added twice is one safe slide. Returns
 * `{ list, added, error }`; a full list is an error, never a silent drop.
 */
export function addSafeSlide(list, input, { id = randomBytes(4).toString("hex") } = {}) {
  const current = safeSlides(list);
  const entry = {
    id,
    presentationId: String(input?.presentationId ?? ""),
    presentationName: clean(input?.presentationName).slice(0, 120) || null,
    slideIndex: Number.isInteger(input?.slideIndex) ? input.slideIndex : -1,
    groupId: typeof input?.groupId === "string" && input.groupId ? input.groupId : null,
    groupOffset: Number.isInteger(input?.groupOffset) ? input.groupOffset : null,
    slideText: clean(input?.slideText).slice(0, 400) || null,
    label: clean(input?.label).slice(0, LABEL_MAX) || defaultLabel(input ?? {}),
  };
  if (!valid(entry)) return { list: current, added: null, error: "That isn't a slide Refrain can go back to." };
  const same = current.find(
    (s) => s.presentationId === entry.presentationId && (entry.groupId ? s.groupId === entry.groupId && s.groupOffset === entry.groupOffset : s.slideIndex === entry.slideIndex)
  );
  if (same) return { list: current, added: same, error: null };
  if (current.length >= MAX_SAFE_SLIDES) return { list: current, added: null, error: `There are already ${MAX_SAFE_SLIDES} safe slides. Remove one on Live first.` };
  return { list: [...current, entry], added: entry, error: null };
}

export function removeSafeSlide(list, id) {
  return safeSlides(list).filter((s) => s.id !== id);
}

export function renameSafeSlide(list, id, label) {
  const name = clean(label).slice(0, LABEL_MAX);
  return safeSlides(list).map((s) => (s.id === id && name ? { ...s, label: name } : s));
}

/** Moves one earlier (-1) or later (+1). Order is the order of the keys on Live. */
export function moveSafeSlide(list, id, dir) {
  const out = [...safeSlides(list)];
  const i = out.findIndex((s) => s.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
