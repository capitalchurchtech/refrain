/**
 * Base interface for lyrics-to-slides splitting logic.
 * See CONTRIBUTING.md for how to add a new one.
 */
export class SlideSplitter {
  /**
   * @param {string} pastedText
   * @returns {string[]} one entry per resulting slide
   */
  split(pastedText) {
    throw new Error("Not implemented");
  }
}
