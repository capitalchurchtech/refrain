/**
 * Arrangement drift-tracking module. Optional — see
 * docs/refrain-architecture.md Section 4.1. Nav entry should be
 * hidden entirely when status is "off", shown-but-explanatory when
 * "misconfigured", fully functional when "active".
 */
export default {
  id: "arrangement",
  navLabel: "Arrangement",
  icon: "git-compare",
  route: "/arrangement",
  component: null, // TODO: ArrangementScreen component
  enabledByDefault: false,
};
