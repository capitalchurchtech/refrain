/**
 * Image Crop module — watched-folder smart cropping to one or more
 * output presets (e.g. "16:9 1080p", "1:1 square"). See
 * server/image-crop.js for the actual watch/crop logic and
 * docs/refrain-architecture.md Section 19 for the design notes.
 *
 * enabledByDefault is true in the *nav* sense — the screen is always
 * reachable, because that's where you turn the watcher on/off. The
 * watcher itself is off until the user enables it there
 * (config.imageCropModule.enabled), so an always-visible nav entry
 * doesn't mean any background work is happening.
 */
export default {
  id: "image-crop",
  navLabel: "Image Crop",
  icon: "crop",
  route: "/image-crop",
  component: null, // TODO: ImageCropScreen component
  enabledByDefault: true,
};
