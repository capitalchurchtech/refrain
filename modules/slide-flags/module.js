/**
 * Flags -- slides flagged during a service, worked through after it (issues
 * #1 and #2). Capture lives on Search and the Live screen; this is the review
 * screen. See server/slide-flags.js and public/slide-flags.js.
 *
 * enabledByDefault: it needs nothing configured -- flags are kept on this
 * machine unless a shared folder is set -- so there is nothing to turn on.
 */
export default {
  id: "slide-flags",
  navLabel: "Flags",
  icon: "flag",
  route: "/slide-flags",
  component: null,
  enabledByDefault: true,
};
