/**
 * The picture taken when a phone adds a flag (owner, 2026-10-09: "any flagged
 * slide needs image captured"), so a flag still shows the right slide after
 * the presentation is edited and the slide numbers move.
 *
 * One small file per flag in data/flag-pictures, named by the flag's id, written
 * to a temporary name and renamed so a half-written picture can never be shown.
 * The flag record itself holds only the file's name. Local to this machine:
 * the flags folder may be shared, the pictures are not.
 */

import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { isFlagId } from "./slide-flags.js";

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const TYPE = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
export const MAX_PICTURE_BYTES = 2_000_000;

/** Saves a picture for a flag. Returns the file name, or null when it isn't a usable picture. */
export async function saveFlagPicture(dir, flagId, img) {
  const ext = EXT[img?.type];
  if (!isFlagId(flagId) || !ext || !Buffer.isBuffer(img.bytes) || !img.bytes.length || img.bytes.length > MAX_PICTURE_BYTES) return null;
  await mkdir(dir, { recursive: true });
  const name = `${flagId}.${ext}`;
  const tmp = path.join(dir, `.${name}.${process.pid}.tmp`);
  try {
    await writeFile(tmp, img.bytes, { mode: 0o600 });
    await rename(tmp, path.join(dir, name));
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return name;
}

/** A flag's picture, or null. The id is checked and the name is built here, so a path can never be asked for. */
export async function readFlagPicture(dir, flagId) {
  if (!isFlagId(flagId)) return null;
  for (const ext of Object.keys(TYPE)) {
    try {
      return { type: TYPE[ext], bytes: await readFile(path.join(dir, `${flagId}.${ext}`)) };
    } catch { /* not saved with this type: try the next */ }
  }
  return null;
}
