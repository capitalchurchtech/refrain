/**
 * Image Crop module — watched-folder smart cropping to one or more
 * output presets (e.g. "16:9 1080p", "1:1 square"). Optional, off by
 * default; see server/image-crop.js for the actual watch/crop logic
 * and docs/refrain-architecture.md Section 19 for the design notes.
 */
export default {
  id: "image-crop",
  navLabel: "Image Crop",
  icon: "crop",
  route: "/image-crop",
  component: null, // TODO: ImageCropScreen component
  enabledByDefault: false,
};
