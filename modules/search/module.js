/**
 * Core search module. Always enabled — this is the feature that must
 * work standalone with zero dependency on anything else in the app.
 * See docs/refrain-architecture.md Section 17.1.
 */
export default {
  id: "search",
  navLabel: "Search",
  icon: "search",
  route: "/search",
  component: null, // TODO: SearchScreen component
  enabledByDefault: true,
};
