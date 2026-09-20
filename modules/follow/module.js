/**
 * Follow module (experimental) — auto-advance groundwork. Phase 1
 * transcribes a live vocal feed on-device with Whisper (Apple Silicon /
 * MLX) so we can judge whether the text is good enough to drive
 * slide-following later; it advances no slides yet. See server/follow.js
 * for the capture/transcription engine and the /api/follow/* routes, and
 * modules/follow/README.md for setup.
 *
 * Gated, off by default: navEnabledFor() in server/index.js hides it
 * until it's enabled on the Health screen (getFollowModuleStatus), the
 * same way the arrangement and library-sync modules are gated.
 */
export default {
  id: "follow",
  navLabel: "Follow",
  icon: "radio",
  route: "/follow",
  component: null,
  enabledByDefault: false,
};
