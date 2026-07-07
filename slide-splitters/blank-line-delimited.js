import { SlideSplitter } from "./base.js";

/** Default splitter: each blank-line-separated block becomes one slide. */
export class BlankLineDelimitedSplitter extends SlideSplitter {
  static splitterId = "blank-line-delimited";

  split(pastedText) {
    return pastedText
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter((block) => block.length > 0);
  }
}

export default BlankLineDelimitedSplitter;
