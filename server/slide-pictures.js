/**
 * Pictures for drawn slides: Bundles' (server/probundle.js) and the desktop
 * previews' (server/slide-drawing.js). A slide names a picture by file name;
 * this finds the file and makes one small copy of it to show, cached on disk.
 *
 * Where a picture may come from, and nowhere else:
 *  - a bundle's own media, which the reader copied into the cache under their
 *    content hash;
 *  - the ProPresenter workspace the presentation lives in (or, for a file
 *    opened from disk, the one on this computer), by the path the file gives,
 *    only inside that workspace and only as a picture or video.
 * Never a path a page sent: the page asks by number, the number came from the
 * reader.
 *
 * A video shows its first frame, as ProPresenter's own thumbnails do, through
 * ffmpeg when it is installed, else macOS's Quick Look. Neither is a Refrain
 * dependency: without them a video is drawn as missing.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PICTURE = /\.(png|jpe?g|gif|tiff?|heic|bmp|webp)$/i;
const VIDEO = /\.(mp4|m4v|mov)$/i;
export const USER_WORKSPACES = path.join(os.homedir(), "Library", "Application Support", "RenewedVision", "ProPresenter", "UserWorkspaces");
const KEEP_MS = 7 * 24 * 60 * 60_000;

/** The workspace folder a library presentation lives in (…/UserWorkspaces/<name>/Libraries/<library>/x.pro), or null. */
export function workspaceOfLibraryFile(file) {
  const parts = path.resolve(String(file ?? "")).split(path.sep);
  const at = parts.lastIndexOf("Libraries");
  return at > 1 ? parts.slice(0, at).join(path.sep) : null;
}

/**
 * This computer's ProPresenter workspace: of the workspace folders, the one
 * whose Libraries changed most recently, or null when there is none. A Mac can
 * hold several (a clone, a test one), and the folder's own name order says
 * nothing about which ProPresenter uses.
 */
export function localWorkspace(userWorkspaces = USER_WORKSPACES) {
  if (!existsSync(userWorkspaces)) return null;
  const changed = (dir) => {
    try {
      return statSync(path.join(dir, "Libraries")).mtimeMs;
    } catch {
      return 0;
    }
  };
  const found = readdirSync(userWorkspaces, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(userWorkspaces, d.name, "Media")))
    .map((d) => path.join(userWorkspaces, d.name))
    .map((dir) => ({ dir, at: changed(dir) }))
    .sort((a, b) => b.at - a.at);
  return found[0]?.dir ?? null;
}

const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);

/**
 * The file a numbered picture is read from, or null. `pic` is the reader's
 * { name, rel, cached }; `workspace` the folder its presentation belongs to.
 */
export function pictureSource(pic, { cacheDir, workspace }) {
  if (!pic || typeof pic.name !== "string") return null;
  if (pic.cached) {
    if (!/^[0-9a-f]{64}\.[a-z0-9]+$/.test(pic.cached)) return null;
    return path.join(cacheDir, pic.cached);
  }
  if (!workspace) return null;
  const ws = path.resolve(workspace);
  const name = path.basename(pic.name);
  const candidates = [
    ...(typeof pic.rel === "string" && !path.isAbsolute(pic.rel) ? [path.resolve(ws, pic.rel)] : []),
    path.join(ws, "Media", "Assets", name),
  ];
  let realWs;
  try {
    realWs = realpathSync(ws);
  } catch {
    return null;
  }
  for (const c of candidates) {
    if (!inside(c, ws) || !(PICTURE.test(c) || VIDEO.test(c)) || !existsSync(c)) continue;
    // A link inside the workspace that leads out of it is not followed.
    const real = realpathSync(c);
    if (inside(real, realWs) && (PICTURE.test(real) || VIDEO.test(real))) return real;
  }
  return null;
}

const run = (cmd, args, timeout = 20_000) =>
  new Promise((resolve, reject) => execFile(cmd, args, { timeout }, (err) => (err ? reject(err) : resolve())));

/** A video's first frame as a PNG file in `dir`, or null. */
async function videoStill(src, dir) {
  const out = path.join(dir, "first.png");
  for (const ffmpeg of ["ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) {
    try {
      await run(ffmpeg, ["-y", "-v", "error", "-ss", "0", "-i", src, "-frames:v", "1", "-vf", "scale=960:-2", out]);
      if (existsSync(out)) return out;
    } catch {
      /* not this one */
    }
  }
  if (process.platform === "darwin") {
    try {
      await run("qlmanage", ["-t", "-s", "960", "-o", dir, src]);
      const png = (await readdir(dir)).find((f) => f.endsWith(".png"));
      if (png) return path.join(dir, png);
    } catch {
      /* no Quick Look picture either */
    }
  }
  return null;
}

/**
 * A copy of `src` at most 960 pixels on its longer side, made once and kept in
 * `cacheDir`. JPEG, which keeps fine texture in a background; WebP only where
 * the picture has transparency. Returns { file, type } or null. `onlyMade`:
 * a copy already made, or null (nothing is resized during a service).
 */
export async function shownCopy(src, cacheDir, { onlyMade = false } = {}) {
  const s = await stat(src);
  const key = createHash("sha256").update(`${src}\0${s.size}\0${s.mtimeMs}`).digest("hex");
  for (const [ext, type] of [["jpg", "image/jpeg"], ["webp", "image/webp"]]) {
    const f = path.join(cacheDir, `shown-${key}.${ext}`);
    if (existsSync(f)) return { file: f, type };
  }
  if (onlyMade) return null;
  const { default: sharp } = await import("sharp");
  let input = src;
  let tmp = null;
  if (VIDEO.test(src)) {
    tmp = await mkdtemp(path.join(os.tmpdir(), "refrain-still-"));
    input = await videoStill(src, tmp);
  }
  try {
    if (!input) return null;
    const alpha = (await sharp(input).metadata()).hasAlpha;
    const img = sharp(input).rotate().resize(960, 960, { fit: "inside", withoutEnlargement: true });
    const ext = alpha ? "webp" : "jpg";
    const f = path.join(cacheDir, `shown-${key}.${ext}`);
    await mkdir(cacheDir, { recursive: true });
    const part = `${f}.${process.pid}.tmp`;
    await (alpha ? img.webp({ quality: 85 }) : img.jpeg({ quality: 82, mozjpeg: true })).toFile(part);
    await rename(part, f);
    return { file: f, type: alpha ? "image/webp" : "image/jpeg" };
  } catch {
    return null;
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}

/** Remove cached pictures nobody has made for a week. Best effort. */
export async function pruneCache(cacheDir, now = Date.now()) {
  let names;
  try {
    names = await readdir(cacheDir);
  } catch {
    return;
  }
  for (const n of names) {
    const f = path.join(cacheDir, n);
    try {
      if (now - (await stat(f)).mtimeMs > KEEP_MS) await unlink(f);
    } catch {
      /* already gone */
    }
  }
}

const MEDIA = /\.(png|jpe?g|gif|tiff?|heic|bmp|webp|mp4|m4v|mov)$/i;

/**
 * Every slide of a decoded presentation drawn (the package's drawPresentation),
 * its pictures numbered. `cached` maps a bundle's media file names to their
 * copies in `cacheDir`; anything else is looked for in `workspace`. A picture
 * neither has is drawn as missing, by name, rather than as a broken image.
 * `url(n)` is the address the page asks for picture n by.
 * @returns {{ drawn: object[], pictures: { name: string, rel: string|null, cached: string|null }[] }}
 */
export function drawWithPictures(lib, doc, { cached = new Map(), cacheDir, workspace, url }) {
  const pictures = [];
  const number = new Map();
  const picture = (name, rel) => {
    if (!MEDIA.test(name)) return null;
    const pic = { name, rel: rel ?? null, cached: cached.get(name) ?? null };
    if (!number.has(name) && !pictureSource(pic, { cacheDir, workspace })) return null;
    if (!number.has(name)) {
      number.set(name, pictures.length);
      pictures.push(pic);
    }
    return url(number.get(name));
  };
  return { drawn: lib.drawPresentation(doc, { picture }), pictures };
}
