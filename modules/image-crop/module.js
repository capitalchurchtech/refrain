/**
 * Image Crop module — watched-folder smart cropping to one or more
 * output presets (e.g. "16:9 1080p", "1:1 square"). See
 * server/image-crop.js for the actual watch/crop logic and
 * docs/refrain-architecture.md Section 19 for the design notes.
 *
 * Off by default. Switching it on (Settings > Features) shows the screen
 * and starts the folder watcher; switching it off stops both.
 */
export default {
  id: "image-crop",
  navLabel: "Image Crop",
  icon: "crop",
  nav: { group: "prep", order: 6 },
  client: { file: "image-crop.js", init: "initImageCrop" },
  route: "/image-crop",
  component: null, // TODO: ImageCropScreen component
  // Switchable on Settings > Features (server/features.js); off hides its
  // screen and its routes answer "switched off".
  feature: { default: false, label: "Image Crop", description: "Crops images dropped in a folder to slide sizes.", apiPrefixes: ["/api/image-crop"] },
};
