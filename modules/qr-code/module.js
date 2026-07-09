/**
 * QR Codes module — fully local QR generation (URL, WiFi, vCard, and
 * more), no third-party service in the loop. See server/qr-code.js for
 * the generator and docs/refrain-architecture.md Section 20 for the
 * design notes.
 *
 * enabledByDefault is true in the nav sense: it's a zero-config,
 * zero-credential local tool, so it's always reachable — there's
 * nothing to "turn on."
 */
export default {
  id: "qr-code",
  navLabel: "QR Codes",
  icon: "qr-code",
  route: "/qr-code",
  component: null, // TODO: QrCodeScreen component
  enabledByDefault: true,
};
