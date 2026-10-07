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
  // Now itself is core (safe slides, quick slides, Clear, performance mode).
  // These parts of it can be switched off on Settings > Features
  // (server/features.js): off hides the section, its routes answer
  // "switched off", and ProPresenter isn't asked for what they'd show.
  features: [
    { id: "messages", label: "Messages", default: true, description: "The pager and other ProPresenter messages, and stage messages, on Now and on phones.", apiPrefixes: ["/api/live/message", "/api/live/stage-message"] },
    { id: "macros", label: "Macros", default: false, description: "ProPresenter's macros as keys on Now.", apiPrefixes: ["/api/live/macro"] },
    { id: "looks", label: "Looks", default: false, description: "ProPresenter's Looks as keys on Now.", apiPrefixes: ["/api/live/look", "/api/live/current-look"] },
  ],
};
