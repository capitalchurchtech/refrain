import { SlideSplitter } from "./base.js";

const SECTION_LABEL = /^(verse|chorus|bridge|tag|intro|outro|pre-chorus)\s*\d*:?$/i;

/**
 * Splits on detected Verse/Chorus/Bridge-style labels rather than
 * purely on blank lines. Falls back to blank-line grouping within a
 * section if no further labels are found.
 */
export class SectionLabelAwareSplitter extends SlideSplitter {
  static splitterId = "section-label-aware";

  split(pastedText) {
    const lines = pastedText.split("\n");
    const slides = [];
    let current = [];

    for (const line of lines) {
      if (SECTION_LABEL.test(line.trim())) {
        if (current.length) slides.push(current.join("\n").trim());
        current = [];
        continue; // don't include the label line itself as slide content
      }
      current.push(line);
    }
    if (current.length) slides.push(current.join("\n").trim());

    return slides.filter((s) => s.length > 0);
  }
}

export default SectionLabelAwareSplitter;
