/**
 * Base interface for lyrics-to-slides splitting logic.
 * See CONTRIBUTING.md for how to add a new one.
 */
export class SlideSplitter {
  /**
   * What the operator sees in the "Split by" field. Optional: a splitter that
   * does not set one falls back to a title-cased `splitterId`, so a
   * third-party splitter dropped into this folder still gets a usable label
   * and auto-discovery keeps working with no registry to edit.
   *
   * Written here rather than mapped in the UI for the same reason a provider's
   * name is: the name belongs to the thing, not to the screen showing it.
   * Phrase it for a volunteer, not a developer -- "Blank lines", not
   * "Blank Line Delimited".
   */
  static displayName = null;

  /**
   * @param {string} pastedText
   * @returns {string[]} one entry per resulting slide
   */
  split(pastedText) {
    throw new Error("Not implemented");
  }
}
