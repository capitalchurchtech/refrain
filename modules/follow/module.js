/**
 * Follow module — experimental auto-advance for ProPresenter, driven by
 * on-device speech-to-text of the live vocal feed. Phase 1 (this ship)
 * is the transcription harness only: capture audio, run Whisper locally,
 * show the transcript. No song matching or slide triggering yet — that's
 * Phase 2, and lives downstream of the same transcript stream.
 *
 * This file is intentionally tiny and dependency-free: it's the only
 * part of the module the app loads at startup (via plugin-loader's
 * discoverModules), so it must never pull in ffmpeg, Python, or any of
 * the module's real machinery. All of that lives in backend.js, which
 * the generic module-host loads lazily and ONLY once the module is
 * enabled — so a disabled Follow costs nothing and touches nothing.
 *
 * OFF by default (enabledByDefault:false, and nothing seeds
 * config.followModule.enabled to true). A fresh install behaves exactly
 * as it does today: no nav entry, no routes exercised, no detection.
 */

// Cheap, side-effect-free platform gate — just interpreter facts, no
// module machinery. Whisper-on-MLX is Apple-Silicon-only, so anywhere
// else the module exists but stays inert with a clear explanation (it
// must never crash Refrain on Windows/Linux/Intel Macs).
function platformSupported() {
  return process.platform === "darwin" && process.arch === "arm64";
}

export default {
  id: "follow",
  navLabel: "Follow",
  icon: "radio", // Lucide
  route: "/follow",
  component: null,

  // Nav/visibility: hidden until deliberately enabled.
  enabledByDefault: false,

  // --- Generic hooks the module-host and Health screen read, so no
  // shared/core file needs to hardcode anything about "Follow" ---

  // Marks this as an opt-in, experimental module. The Health screen
  // renders a toggle for any module carrying `configToggle`, and labels
  // experimental ones as such — it never names Follow specifically.
  experimental: true,

  // Where this module's on/off flag lives in config.json. The generic
  // enable route writes `config[configKey].enabled`; nothing else in the
  // module's config is touched by core.
  configKey: "followModule",

  // Copy for the generic Health toggle.
  configToggle: {
    label: "Enable Follow (experimental)",
    help:
      "Listens to a live vocal feed and transcribes it on-device with Whisper. " +
      "macOS + Apple Silicon only, and needs Python with mlx-whisper plus ffmpeg " +
      "installed separately (the Follow screen walks you through it). Phase 1 only " +
      "transcribes — it does not advance slides yet.",
  },

  // Whether this install can actually run the module. When false, the
  // Health toggle still appears but enabling only surfaces the message.
  platformSupported,
  platformMessage:
    "Follow needs macOS on Apple Silicon (M-series) — it uses Apple's MLX to run " +
    "Whisper locally, which isn't available on this platform. The toggle is here " +
    "for reference, but the feature can't run on this machine.",

  // Single source of truth for "is this module on right now?", read by
  // the nav gate and the module-host. Pure function of config.
  isEnabled(config) {
    return Boolean(config?.[this.configKey]?.enabled) && platformSupported();
  },
};
