/**
 * QR Codes module — fully local QR generation (URL, WiFi, vCard, and
 * more), no third-party service in the loop. See server/qr-code.js for
 * the generator and docs/refrain-architecture.md Section 20 for the
 * design notes.
 *
 * On by default: it's a zero-config, zero-credential local tool.
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
  feature: { default: true, label: "QR Codes", description: "Make QR codes for slides: links, Wi-Fi, contact cards.", apiPrefixes: ["/api/qr"] },
};
