/**
 * The themes Refrain has, in the order the theme key cycles through them.
 * One list, read by the menu (nav.js) and by the server, which saves only
 * these and serves only these (code review, 2026-10-04: two copies of the
 * list would let a new theme apply on screen and be refused on save).
 * Pure: no DOM, so the server can import it.
 */
export const THEMES = ["system", "light", "dark", "blackroom"];
export const DEFAULT_THEME = "blackroom";
