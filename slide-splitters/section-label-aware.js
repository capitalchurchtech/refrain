import { SlideSplitter } from "./base.js";

// A bare section label on its own line: "Verse 1", "Chorus", "Pre-Chorus 2",
// optionally with a trailing colon. Kept strict (the whole line must be the
// label) so a lyric line that merely starts with "Bridge" isn't mistaken for one.
const BARE_LABEL = /^(intro|verse|pre[-\s]?chorus|post[-\s]?chorus|chorus|refrain|bridge|tag|vamp|interlude|instrumental|hook|ending|outro|coda)(\s*\d+)?\s*:?$/i;

// Genius and many lyric sites wrap labels in brackets: "[Verse 1]", "[Chorus]",
// "[Bridge: Guest]". Any line that is entirely one bracketed token is a label.
const BRACKET_LABEL = /^\[.+\]$/;

// Genius injects a recommendations block into copied lyrics that starts with
// "You might also like" followed by a few song/artist lines. It isn't part of
// the song, so drop it (up to the next blank line or label).
const GENIUS_JUNK_START = /^you might also like/i;

function isSectionLabel(line) {
  const t = line.trim();
  if (!t) return false;
  return BRACKET_LABEL.test(t) || BARE_LABEL.test(t);
}

/**
 * Splits on detected section labels (bracketed like "[Chorus]" or bare like
 * "Chorus"/"Verse 2") so each labelled section becomes one slide. The label
 * line itself is dropped from the slide text.
 */
export class SectionLabelAwareSplitter extends SlideSplitter {
  static splitterId = "section-label-aware";

  split(pastedText) {
    const lines = pastedText.split("\n");
    const slides = [];
    let current = [];
    let skippingJunk = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // While inside a Genius "You might also like" block, discard lines
      // until a blank line or the next section label ends it.
      if (skippingJunk) {
        if (trimmed === "" || isSectionLabel(line)) skippingJunk = false;
        else continue;
      }
      if (GENIUS_JUNK_START.test(trimmed)) {
        skippingJunk = true;
        continue;
      }

      if (isSectionLabel(line)) {
        if (current.length) slides.push(current.join("\n").trim());
        current = [];
        continue; // the label isn't slide content
      }
      current.push(line);
    }
    if (current.length) slides.push(current.join("\n").trim());

    return slides.filter((s) => s.length > 0);
  }
}

export default SectionLabelAwareSplitter;
