/**
 * Flags -- slides flagged during a service, worked through after it (issues
 * #1 and #2). Capture lives on Search and the Live screen; this is the review
 * screen. See server/slide-flags.js and public/slide-flags.js.
 *
 * On by default: it needs nothing configured -- flags are kept on this
 * machine unless a shared folder is set.
 */
export default {
  id: "slide-flags",
  navLabel: "Flags",
  icon: "flag",
  nav: { group: "service", order: 2, page: "service" },
  client: { file: "slide-flags.js", init: "initSlideFlags" },
  route: "/slide-flags",
  component: null,
  // Switchable on Settings > Features (server/features.js); off hides its
  // screen and its routes answer "switched off".
  feature: { default: true, label: "Flags", summary: "Mark slides to fix", description: "Flag a slide that needs fixing, from the booth or a phone, and see what was flagged today.", apiPrefixes: ["/api/slide-flags"] },
};
