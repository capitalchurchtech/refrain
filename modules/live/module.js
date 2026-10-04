/**
 * Live page — a big-button control surface for the operator during a
 * service: Clear (get things off the screen fast), plus one button per
 * Look and Macro the church has configured in ProPresenter (so their own
 * "Logo", "Black", "Motion", etc. appear by name without being hardcoded
 * here). See the /api/live/* routes in server/index.js. Always navigable;
 * nothing to set up.
 */
export default {
  id: "live",
  navLabel: "Now",
  icon: "monitor",
  nav: { group: "service", order: 1, page: "service" },
  client: { file: "live.js", init: "initLive" },
  route: "/live",
  component: null,
  enabledByDefault: true,
};
