/**
 * Media files that nothing in ProPresenter refers to.
 *
 * From docs/ideas.md: "Orphaned media. The inverse of #9 — assets referenced by
 * no presentation at all. This is disk cleanup, not service safety, and should
 * stay well away from any pre-service flow." On the booth Mac the Media folder
 * is 37 GB across 2,189 files, so the question is real.
 *
 * **This is a report, never a deletion.** Everything here errs toward calling a
 * file "in use", because the failure that matters is the other one: telling a
 * volunteer a file is safe to delete when a presentation still needs it. Three
 * rules follow from that, and each one was learned by measuring rather than
 * assumed:
 *
 * 1. **Match on the filename, anywhere.** A `.pro` file stores a media
 *    reference twice -- an absolute `file://` URL and a workspace-relative
 *    `Media/Assets/<name>` path. The absolute URL is usually from a DIFFERENT
 *    Mac (the booth's decks point at `/Users/other-mac/...` and `/Users/second-mac/...`),
 *    so matching absolute paths would have reported all 2,189 files as orphans.
 *    The bare filename appears in both forms, so a file counts as used if its
 *    name appears anywhere at all. Over-matching only ever hides an orphan;
 *    it can never invent one.
 *
 * 2. **Skip the Media folder by its exact path, never by name.**
 *    `Playlists/Media` is a FILE -- ProPresenter's Media bin -- and it is the
 *    only thing referencing hundreds of files. An early version skipped
 *    anything whose path ended in `/Media`, threw the bin away, and reported
 *    522 in-use files as orphaned.
 *
 * 3. **Fail closed on any read error.** An unreadable reference file is not
 *    "a file with no references" -- it is a file whose references we did not
 *    see, and every name only it mentioned would show up as an orphan. So one
 *    failed read ends the scan with an error instead of a quietly wrong list.
 *
 * Deliberately not read: ProPresenter's state database. It is built from these
 * files at startup (see library-guard.js), so it is a derived copy rather than
 * a source of truth -- and measured against this library it changed nothing.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Extensions of files that hold media rather than references to it. Kept out
 * of the reference corpus only because they are large -- a Downloads folder of
 * video would otherwise be read into memory for nothing. A media file does not
 * refer to other media files, so leaving these out cannot hide a reference.
 */
const MEDIA_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".heic", ".heif", ".tif", ".tiff", ".bmp", ".webp", ".psd",
  ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".wmv", ".mpg", ".mpeg", ".webm",
  ".mp3", ".wav", ".m4a", ".aac", ".aif", ".aiff", ".flac",
]);

// See the ceiling check in scanOrphanedMedia.
const MAX_CORPUS_BYTES = 1_000_000_000;

/**
 * The workspace roots behind a set of library directories.
 *
 * A ProPresenter library lives at `<workspace>/Libraries/<name>`, so the root is
 * two levels up -- derived from the paths the index already holds, the same
 * way resolveLibraryDir learns the library folder, rather than from an install
 * location baked into the code. Anything not shaped like that is ignored
 * rather than guessed at.
 */
export function workspaceRootsFromLibraryDirs(libraryDirs) {
  const roots = new Set();
  for (const dir of libraryDirs ?? []) {
    if (typeof dir !== "string" || !dir) continue;
    const librariesDir = path.dirname(dir);
    if (path.basename(librariesDir) !== "Libraries") continue;
    roots.add(path.dirname(librariesDir));
  }
  return [...roots].sort();
}

/**
 * Which of `names` appear anywhere in `corpus`, as plain text or in either
 * URL-encoded form.
 *
 * Semantically identical to calling `corpus.includes()` for every variant of
 * every name -- the tests check exactly that -- but that naive version took 30
 * seconds on the booth's 94 MB of references. This finds each distinct file
 * extension's occurrences once, then asks, at each one, whether any name with
 * that extension ends there. A few scans of the corpus instead of six thousand.
 *
 * Byte-exact throughout: names are UTF-8 in the `.pro` files, so comparison is
 * done on UTF-8 bytes (via a latin1 string key, which maps each byte to one
 * character losslessly) rather than on JavaScript strings.
 */
export function findReferencedNames(corpus, names) {
  const referenced = new Set();
  if (!Buffer.isBuffer(corpus) || corpus.length === 0) return referenced;

  // extension bytes -> byte length -> latin1 key -> original names
  const byExt = new Map();
  const fallback = [];

  for (const name of new Set(names ?? [])) {
    if (typeof name !== "string" || !name) continue;
    for (const variant of new Set([name, encodeURIComponent(name), encodeURI(name)])) {
      const bytes = Buffer.from(variant, "utf8");
      const dot = variant.lastIndexOf(".");
      if (dot <= 0 || dot === variant.length - 1) {
        fallback.push({ bytes, name });
        continue;
      }
      const ext = Buffer.from(variant.slice(dot), "utf8").toString("latin1");
      let byLen = byExt.get(ext);
      if (!byLen) byExt.set(ext, (byLen = new Map()));
      let keys = byLen.get(bytes.length);
      if (!keys) byLen.set(bytes.length, (keys = new Map()));
      const key = bytes.toString("latin1");
      if (!keys.has(key)) keys.set(key, []);
      keys.get(key).push(name);
    }
  }

  for (const [ext, byLen] of byExt) {
    const extBytes = Buffer.from(ext, "latin1");
    let from = 0;
    for (;;) {
      const at = corpus.indexOf(extBytes, from);
      if (at === -1) break;
      const end = at + extBytes.length;
      for (const [len, keys] of byLen) {
        const start = end - len;
        if (start < 0) continue;
        const hit = keys.get(corpus.toString("latin1", start, end));
        if (hit) for (const n of hit) referenced.add(n);
      }
      from = at + 1;
    }
  }

  for (const { bytes, name } of fallback) {
    if (!referenced.has(name) && corpus.includes(bytes)) referenced.add(name);
  }
  return referenced;
}

/** Regular files under `dir`, not following symlinks. Throws on any read error -- see rule 3. */
async function listFiles(dir, { skipDir = null } = {}) {
  const out = [];
  const walk = async (d) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (p !== skipDir) await walk(p);
      } else if (entry.isFile()) {
        out.push(p);
      }
    }
  };
  await walk(dir);
  return out;
}

/**
 * Scans every workspace Refrain has indexed for media nothing refers to.
 *
 * The reference corpus is every non-media file in every workspace beside them,
 * not just the one being checked: a deck in another workspace can reach this
 * workspace's media through an absolute URL, and reading a little more can only
 * ever make the answer more conservative.
 *
 * @param {object} opts
 * @param {string[]} opts.libraryDirs - from search-index's getIndexedLibraryDirs
 * @param {number} [opts.maxListed] - largest orphans to return per workspace; totals always cover all of them
 * @param {number} [opts.maxCorpusBytes] - refuse, rather than read, more reference data than this
 */
export async function scanOrphanedMedia({ libraryDirs, maxListed = 500, maxCorpusBytes = MAX_CORPUS_BYTES } = {}) {
  const started = Date.now();
  const roots = workspaceRootsFromLibraryDirs(libraryDirs);
  if (roots.length === 0) {
    return {
      ok: false,
      error:
        "Refrain does not know where ProPresenter's workspace is yet. It learns that from the search index, " +
        "so build the index once with ProPresenter open, then scan again.",
    };
  }

  // Every workspace sitting beside the indexed ones, for the reference corpus.
  const parents = [...new Set(roots.map((r) => path.dirname(r)))];
  const siblingRoots = new Set(roots);
  for (const parent of parents) {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) siblingRoots.add(path.join(parent, entry.name));
    }
  }

  const referenceFiles = [];
  for (const root of siblingRoots) {
    const files = await listFiles(root, { skipDir: path.join(root, "Media") });
    for (const f of files) {
      if (MEDIA_EXTENSIONS.has(path.extname(f).toLowerCase())) continue;
      referenceFiles.push(f);
    }
  }

  // The whole corpus is held in memory at once, on the machine that is also
  // running ProPresenter -- and this button is not gated on a service being
  // over. The booth's is 187 MB; past the ceiling, refuse and say why rather
  // than risk pushing that machine into swap. Refusing can never produce a
  // wrong list, only no list.
  let corpusBytes = 0;
  for (const f of referenceFiles) corpusBytes += (await stat(f)).size;
  if (corpusBytes > maxCorpusBytes) {
    return {
      ok: false,
      error:
        `There is ${Math.round(corpusBytes / 1e6)} MB of presentations, playlists and themes to read, which is more ` +
        `than this scan will hold in memory at once (${Math.round(maxCorpusBytes / 1e6)} MB). Nothing is reported.`,
    };
  }

  // A zero byte between files, so a name cannot be "found" straddling the end
  // of one file and the start of the next.
  const chunks = [];
  for (const f of referenceFiles) {
    chunks.push(await readFile(f), Buffer.from([0]));
  }
  const corpus = Buffer.concat(chunks);

  const workspaces = [];
  for (const root of roots) {
    const mediaDir = path.join(root, "Media");
    let mediaFiles;
    try {
      mediaFiles = (await listFiles(mediaDir)).filter((f) => !path.basename(f).startsWith("."));
    } catch (err) {
      if (err.code === "ENOENT") {
        workspaces.push({ root, name: path.basename(root), mediaDir, missing: true, mediaFiles: 0, orphanCount: 0, orphanBytes: 0, orphans: [], truncated: false });
        continue;
      }
      throw err;
    }

    const referenced = findReferencedNames(corpus, mediaFiles.map((f) => path.basename(f)));
    const orphans = [];
    let orphanBytes = 0;
    for (const f of mediaFiles) {
      if (referenced.has(path.basename(f))) continue;
      const { size } = await stat(f);
      orphanBytes += size;
      orphans.push({ relPath: path.relative(root, f), bytes: size });
    }
    // Largest first: the cleanup worth doing is the one that frees the most.
    orphans.sort((a, b) => b.bytes - a.bytes || a.relPath.localeCompare(b.relPath));
    workspaces.push({
      root,
      name: path.basename(root),
      mediaDir,
      missing: false,
      mediaFiles: mediaFiles.length,
      orphanCount: orphans.length,
      orphanBytes,
      orphans: orphans.slice(0, maxListed),
      truncated: orphans.length > maxListed,
    });
  }

  return {
    ok: true,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    referenceFiles: referenceFiles.length,
    workspaces,
  };
}

/**
 * The absolute path to reveal for a file from a scan, or null if it is not one.
 *
 * Only ever a path inside a known workspace's Media folder: the route takes a
 * relative path from the browser, and "reveal any path you like" is not a
 * thing a localhost app should offer even if nothing today would abuse it.
 */
export function resolveMediaPath(roots, root, relPath) {
  if (typeof root !== "string" || typeof relPath !== "string") return null;
  if (!(roots ?? []).includes(root)) return null;
  const mediaDir = path.join(root, "Media");
  const target = path.resolve(root, relPath);
  if (target !== mediaDir && !target.startsWith(mediaDir + path.sep)) return null;
  return target;
}
