/**
 * QR Codes module — fully local QR generation (URL, WiFi, vCard, and
 * more), no third-party service in the loop. See server/qr-code.js for
 * the generator and docs/refrain-architecture.md Section 20 for the
 * design notes.
 *
 * Off by default, so the Prep key stays out of the rail until a church turns on
 * a prep tool (owner, 2026-10-08). It is a zero-config, zero-credential local
 * tool, so switching it on in Settings > Features needs nothing else.
 */
export default {
  id: "qr-code",
  navLabel: "QR Codes",
  icon: "qr-code",
  nav: { group: "prep", order: 5 },
  client: { file: "qr-code.js", init: "initQrCode" },
  route: "/qr-code",
  component: null, // TODO: QrCodeScreen component
  // Switchable on Settings > Features (server/features.js); off hides its
  // screen and its routes answer "switched off".
  feature: { default: false, label: "QR Codes", summary: "Make codes for slides", description: "Make QR codes for slides: links, Wi-Fi, contact cards.", apiPrefixes: ["/api/qr"] },
};
