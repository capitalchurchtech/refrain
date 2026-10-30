/**
 * Bundles: open, inspect, compare and check ProPresenter files (.pro and
 * .probundle), read only for now. File work only, never ProPresenter's API.
 * See server/probundle.js for the rules and the propresenter-bundle package
 * for the format.
 *
 * Off by default, a prep tool. Misconfigured (a message, never a crash) until
 * a packs folder is set, because that is where a church's own templates go.
 */
export default {
  id: "probundle",
  navLabel: "Bundles",
  icon: "file-stack",
  nav: { group: "prep", order: 9 },
  client: { file: "probundle.js", init: "initProbundle" },
  route: "/probundle",
  component: null,
  feature: {
    default: false,
    label: "Bundles",
    summary: "Open and check ProPresenter files",
    description: "Open, compare and check .pro and .probundle files: what is on each slide, what changed by hand, and what will go wrong on import. Never writes a file.",
    apiPrefixes: ["/api/probundle"],
  },
};
