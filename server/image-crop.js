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
import { mkdir, rename, access } from "node:fs/promises";
import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
const MAX_ACTIVITY = 25;

let watcher = null;
// Files are processed strictly one at a time through this queue, not
// concurrently: dropping a folder of 200 images fires 200 near-instant
// "add" events, and launching 200 concurrent sharp/smartcrop pipelines
// would spike memory hard enough to OOM on a modest booth machine.
// Sequential is plenty fast for the actual use case and keeps the
// footprint flat.
const queue = [];
let draining = false;
let activeFile = null;
const recentActivity = []; // most-recent-first, capped at MAX_ACTIVITY

function logActivity(entry, now) {
  recentActivity.unshift({ ...entry, timestamp: now });
  recentActivity.length = Math.min(recentActivity.length, MAX_ACTIVITY);
}

/**
 * Websafe, lowercase token for filenames. Ratio/decimal separators
 * (":", ".") become "-" so they stay legible (16:9 -> 16-9, 2.5 ->
 * 2-5); every other run of non-alphanumerics becomes "_" to separate
 * parts. Used both for a preset's short code and as the fallback when a
 * preset has no explicit abbreviation.
 */
export function websafeToken(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[:.]/g, "-")
    .replace(/[^a-z0-9-]+/g, "_")
    .replace(/-{2,}/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
}

/** A preset's filename suffix: its short abbreviation if it has one (e.g. "yt", "in_sq"), else a websafe form of its name. */
function presetSuffix(preset) {
  return (preset.abbr && websafeToken(preset.abbr)) || websafeToken(preset.name) || "preset";
}

/**
 * True if two folder paths are the same, or one is nested inside the
 * other. Writing cropped output into (or above) the watched input
 * folder would make each output re-trigger the watcher and crop itself
 * again — an ever-expanding loop. Callers must reject that before
 * starting the watcher.
 */
export function foldersOverlap(a, b) {
  if (!a || !b) return false;
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (ra === rb) return true;
  const inside = (from, to) => {
    const rel = path.relative(from, to);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  return inside(ra, rb) || inside(rb, ra);
}

async function processImage(filePath, config) {
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return; // ignore non-images (e.g. .DS_Store) silently

  const now = new Date().toISOString();
  const basename = path.basename(filePath, ext);
  try {
    const outputs = [];
    const usedNames = new Set();
    for (const preset of config.presets) {
      // Two presets whose suffixes collide (e.g. two customs, or a custom
      // that lands on a catalog code) would otherwise write to the same
      // file, silently clobbering one. Disambiguate with the dimensions,
      // then an index.
      let suffix = presetSuffix(preset);
      if (usedNames.has(suffix)) suffix = `${suffix}_${preset.width}x${preset.height}`;
      let candidate = suffix;
      let n = 2;
      while (usedNames.has(candidate)) candidate = `${suffix}_${n++}`;
      usedNames.add(candidate);

      const destPath = path.join(config.outputFolder, `${basename}_${candidate}${ext}`);
      const { topCrop } = await smartcrop.crop(filePath, { width: preset.width, height: preset.height });
      await sharp(filePath)
        .extract({ width: topCrop.width, height: topCrop.height, left: topCrop.x, top: topCrop.y })
        .resize(preset.width, preset.height)
        .toFile(destPath);
      outputs.push(preset.name);
    }

    const processedDir = path.join(config.inputFolder, "processed");
    await mkdir(processedDir, { recursive: true });
    // Don't clobber an earlier same-named original already in processed/.
    let dest = path.join(processedDir, path.basename(filePath));
    if (await pathExists(dest)) {
      dest = path.join(processedDir, `${basename}-${Date.now()}${ext}`);
    }
    await rename(filePath, dest);

    logActivity({ filename: path.basename(filePath), status: "ok", outputs }, now);
  } catch (err) {
    logActivity({ filename: path.basename(filePath), status: "error", error: err.message }, now);
  }
}

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const { filePath, config } = queue.shift();
      activeFile = filePath;
      await processImage(filePath, config);
      activeFile = null;
    }
  } finally {
    draining = false;
  }
}

export async function stopWatcher() {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  // Drop anything still queued for the old config — the caller is about
  // to (re)start with fresh config, and a queued path may no longer be
  // valid under it.
  queue.length = 0;
}

/**
 * (Re)starts the watcher against the given config — safe to call anytime
 * config changes; always stops any prior watcher first. Throws on an
 * unusable config (overlapping folders, unmakeable paths) so the caller
 * can surface a clear error rather than silently not watching.
 */
export async function startWatcher(config) {
  await stopWatcher();
  if (!config?.enabled || !config.inputFolder || !config.outputFolder || !config.presets?.length) return;

  if (foldersOverlap(config.inputFolder, config.outputFolder)) {
    throw new Error("Input and output folders must not be the same folder or nested inside one another — outputs would be re-cropped in a loop.");
  }

  await mkdir(config.inputFolder, { recursive: true });
  await mkdir(config.outputFolder, { recursive: true });

  watcher = watch(config.inputFolder, {
    ignoreInitial: false, // pick up files that were dropped in while the app was off
    depth: 0, // never descend into processed/ — direct children of inputFolder only
    ignored: (p) => path.basename(path.dirname(p)) === "processed",
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 }, // don't grab a file mid-copy
  });
  watcher.on("add", (filePath) => {
    queue.push({ filePath, config });
    drainQueue();
  });
  watcher.on("error", (err) => logActivity({ filename: null, status: "error", error: `Watcher error: ${err.message}` }, new Date().toISOString()));
}

export function getImageCropStatus() {
  return {
    watching: Boolean(watcher),
    processing: Boolean(activeFile) || queue.length > 0,
    queued: queue.length,
    recentActivity,
  };
}
