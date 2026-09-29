/**
 * Core search module. Always enabled — this is the feature that must
 * work standalone with zero dependency on anything else in the app.
 * See docs/refrain-architecture.md Section 17.1.
 */
export default {
  id: "search",
  navLabel: "Search",
  icon: "search",
  // Where it sits in the menu ("service" screens are used during a
  // service; "prep" ones before it) and in what order within its group.
  nav: { group: "service", order: 0 },
  // The screen: public/search.js, whose initSearch() builds it.
  client: { file: "search.js", init: "initSearch" },
  route: "/search",
  component: null, // TODO: SearchScreen component
  enabledByDefault: true,
};
