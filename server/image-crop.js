/**
 * Image Crop module — watches an input folder, and for every image
 * dropped in, produces one resized+cropped output per configured
 * preset (e.g. "16:9 1080p", "1:1 900x900") using saliency-based smart
 * cropping (smartcrop-sharp) so the "important" part of the image
 * stays in frame instead of a naive center-crop.
 *
 * Deliberately no face-detection model in this first version —
 * smartcrop's entropy/saliency heuristic needs no model download and
 * handles the full mix of content a church actually has (portraits,
 * text-heavy graphics, worship backgrounds) reasonably well on its
 * own. Face detection is a legitimate later upgrade (smartcrop-sharp's
 * own docs point at smartcrop-cli's opencv integration as the
 * reference), not a requirement for this to be useful today.
 *
 * Processed originals are moved to a `processed/` subfolder of the
 * input folder, never deleted — reversible by design, same philosophy
 * as the arrangement module's local staging (Section 8.4).
 */
import { watch } from "chokidar";
import sharp from "sharp";
import smartcrop from "smartcrop-sharp";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
const MAX_ACTIVITY = 25;

let watcher = null;
let processingCount = 0;
const recentActivity = []; // most-recent-first, capped at MAX_ACTIVITY

function logActivity(entry, now) {
  recentActivity.unshift({ ...entry, timestamp: now });
  recentActivity.length = Math.min(recentActivity.length, MAX_ACTIVITY);
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function processImage(filePath, config) {
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return;

  const now = new Date().toISOString();
  const basename = path.basename(filePath, ext);
  processingCount += 1;
  try {
    const outputs = [];
    for (const preset of config.presets) {
      const destPath = path.join(config.outputFolder, `${basename}-${slugify(preset.name)}${ext}`);
      const { topCrop } = await smartcrop.crop(filePath, { width: preset.width, height: preset.height });
      await sharp(filePath)
        .extract({ width: topCrop.width, height: topCrop.height, left: topCrop.x, top: topCrop.y })
        .resize(preset.width, preset.height)
        .toFile(destPath);
      outputs.push(preset.name);
    }

    const processedDir = path.join(config.inputFolder, "processed");
    await mkdir(processedDir, { recursive: true });
    await rename(filePath, path.join(processedDir, path.basename(filePath)));

    logActivity({ filename: path.basename(filePath), status: "ok", outputs }, now);
  } catch (err) {
    logActivity({ filename: path.basename(filePath), status: "error", error: err.message }, now);
  } finally {
    processingCount -= 1;
  }
}

export async function stopWatcher() {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}

/** (Re)starts the watcher against the given config — safe to call anytime config changes; always stops any prior watcher first. */
export async function startWatcher(config) {
  await stopWatcher();
  if (!config?.enabled || !config.inputFolder || !config.outputFolder || !config.presets?.length) return;

  await mkdir(config.inputFolder, { recursive: true });
  await mkdir(config.outputFolder, { recursive: true });

  watcher = watch(config.inputFolder, {
    ignoreInitial: false, // pick up files that were dropped in while the app was off
    depth: 0, // never descend into processed/ — direct children of inputFolder only
    ignored: (p) => path.basename(path.dirname(p)) === "processed",
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 }, // don't grab a file mid-copy
  });
  watcher.on("add", (filePath) => processImage(filePath, config));
  watcher.on("error", (err) => logActivity({ filename: null, status: "error", error: `Watcher error: ${err.message}` }, new Date().toISOString()));
}

export function getImageCropStatus() {
  return {
    watching: Boolean(watcher),
    processing: processingCount > 0,
    recentActivity,
  };
}
