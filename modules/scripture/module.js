/**
 * Scripture lookup — the lyrics-helper pattern applied to Bible passages:
 * type a reference, open it in Bible Gateway (any translation) or Blue
 * Letter Bible (for Hebrew/Greek interlinear and Strong's word studies).
 * Refrain never fetches or stores scripture text; it only builds the link
 * and opens it in a normal browser tab, so there's no bundled bible, no
 * version-licensing problem, and nothing to keep offline. See the
 * /api/scripture/config route in server/index.js.
 */
export default {
  id: "scripture",
  navLabel: "Scripture",
  icon: "book-open",
  route: "/scripture",
  component: null,
  enabledByDefault: true,
};
