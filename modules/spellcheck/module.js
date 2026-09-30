/**
 * Spell Check module — finds candidate typos in the slides of a chosen
 * playlist, using an offline dictionary plus the church's own library
 * vocabulary to keep false positives down. See server/spellcheck.js for
 * the flagging logic. Always navigable; no setup beyond an optional
 * allowlist that fills in as you use it.
 */
export default {
  id: "spellcheck",
  navLabel: "Spell Check",
  icon: "spell-check",
  nav: { group: "prep", order: 4.5 },
  client: { file: "spellcheck.js", init: "initSpellcheck" },
  route: "/spellcheck",
  component: null,
  enabledByDefault: true,
};
