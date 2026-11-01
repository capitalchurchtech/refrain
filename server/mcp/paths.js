/**
 * Which files the MCP may open. Every path an assistant gives goes through here before anything reads it.
 *
 * NEVER PROPRESENTER'S DATABASE (owner, 2026-11-01: "never under any circumstance"). ProPresenter keeps its
 * state in a RocksDB store at Workspaces/<name>-<id>/Database, under an exclusive lock, and a damaged one is
 * what stops ProPresenter starting at all (server/propresenter-doctor.js). Three guards, any one enough:
 *   - only ProPresenter's own document types open (.pro, .probundle, .protheme, .proplaylist); a RocksDB store is none;
 *   - nothing under ProPresenter's Workspaces folder (the state folders: the Database and its thumbnails),
 *     and nothing in any folder named Database, wherever it is;
 *   - both checked on the path as given and on where it really leads, so a link can't reach around them.
 * The library itself (UserWorkspaces/<name>/Libraries) is ordinary .pro files, and opening one only reads it.
 *
 * Writing is not decided here: the tools write only into Refrain's staging folder, under names they make.
 */
import { realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const OPENABLE = [".pro", ".probundle", ".protheme", ".proplaylist"];
const MAX_BYTES = 1.5 * 1024 ** 3;

/** Why this path is ProPresenter's state rather than a document, or null. */
export function forbiddenReason(p) {
  const parts = path.resolve(p).split(path.sep);
  const at = parts.findIndex((s, i) => s === "ProPresenter" && parts[i - 1] === "RenewedVision" && parts[i + 1] === "Workspaces");
  if (at >= 0) return "it is inside ProPresenter's Workspaces folder, where ProPresenter keeps its database";
  if (parts.some((s) => /^database($|[ .-])/i.test(s))) return "it is inside a folder named Database";
  return null;
}

/**
 * The real path of a document the person pointed at, or an error saying why not. Reads nothing but the
 * file system's own record of the path.
 * @param {unknown} given
 */
export function openablePath(given) {
  if (typeof given !== "string" || !given.trim()) throw new Error("Give the full path of the file to open.");
  const asked = path.resolve(given.trim().replace(/^~(?=$|\/)/, os.homedir()));
  const refuse = (why) => new Error(`Not opened: ${why}. This never reads ProPresenter's database.`);
  const before = forbiddenReason(asked);
  if (before) throw refuse(before);
  if (!OPENABLE.includes(path.extname(asked).toLowerCase())) throw new Error(`Only ProPresenter documents open here (${OPENABLE.join(", ")}). ${path.basename(asked)} is not one.`);
  let real;
  try {
    real = realpathSync(asked);
  } catch {
    throw new Error(`No file at ${asked}.`);
  }
  const after = forbiddenReason(real);
  if (after) throw refuse(after);
  if (!OPENABLE.includes(path.extname(real).toLowerCase())) throw new Error(`${path.basename(asked)} leads to ${path.basename(real)}, which is not a ProPresenter document.`);
  const st = statSync(real);
  if (!st.isFile()) throw new Error(`${asked} is a folder, not a file.`);
  if (st.size > MAX_BYTES) throw new Error(`${path.basename(real)} is larger than 1.5 GB, too large to open here.`);
  return real;
}

export const MEDIA = [".png", ".jpg", ".jpeg", ".gif", ".tif", ".tiff", ".heic", ".bmp", ".webp", ".mp4", ".m4v", ".mov", ".mp3", ".m4a", ".aac", ".wav", ".aif", ".aiff"];

/** The real path of a picture, video or sound the person pointed at, under the same guards as a document. */
export function mediaPath(given) {
  if (typeof given !== "string" || !given.trim()) throw new Error("Give the full path of the picture, video or sound.");
  const asked = path.resolve(given.trim().replace(/^~(?=$|\/)/, os.homedir()));
  const refuse = (why) => new Error(`Not read: ${why}. This never reads ProPresenter's database.`);
  if (forbiddenReason(asked)) throw refuse(forbiddenReason(asked));
  const notMedia = (p) => new Error(`${path.basename(p)} is not a picture, video or sound ProPresenter takes (${MEDIA.join(", ")}).`);
  if (!MEDIA.includes(path.extname(asked).toLowerCase())) throw notMedia(asked);
  let real;
  try { real = realpathSync(asked); } catch { throw new Error(`No file at ${asked}.`); }
  if (forbiddenReason(real)) throw refuse(forbiddenReason(real));
  if (!MEDIA.includes(path.extname(real).toLowerCase())) throw notMedia(real);
  const st = statSync(real);
  if (!st.isFile()) throw new Error(`${asked} is a folder, not a file.`);
  if (st.size > MAX_BYTES) throw new Error(`${path.basename(real)} is larger than 1.5 GB, too large to add here.`);
  return real;
}
