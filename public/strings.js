/**
 * Strings used in more than one place.
 *
 * Each of these was written twice, independently, and the two copies had
 * drifted: one said "select the text manually" with a hyphen and the other
 * "select and copy the text manually" with an em dash; one said "type the host
 * and port above" and the other "enter the host and port below". Two authors
 * of the same sentence is a maintenance problem either way, and it is how a
 * product ends up with two voices.
 *
 * Cold zone, all of it: these all appear on or near the path to screen. What
 * happened, then the next action, one line, no apology.
 */

/** Clipboard write failed. Under pressure, a silent copy looks like a dead button. */
export const COPY_FAILED = "Couldn't copy. Select the text and copy it manually.";

/**
 * Nothing answering on this machine. `where` names the direction of the fields
 * the operator should fill in, since the same sentence serves Setup (fields
 * below) and Health (fields above).
 */
export function noProPresenterFound(where = "below") {
  return `No ProPresenter on this machine. Check its Network API is on, or enter the host and port ${where}.`;
}

/** The paste-cleanup button's tooltip, on both Scripture and Lyrics. */
export const CLEAN_PASTE_HINT =
  "Remove hidden characters copied from the web, tidy spacing and blank lines, and optionally straighten curly quotes and dashes.";

/**
 * ProPresenter's API cannot create slides, so Scripture and Lyrics both have to
 * ask the operator to paste. Said once, cold, rather than twice in two voices.
 */
export const NO_SLIDE_CREATION =
  "ProPresenter can't create slides over its API. Copy each slide below into a new presentation yourself.";
