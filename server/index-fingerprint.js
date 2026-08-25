/**
 * Deciding which presentations a rebuild actually has to re-read.
 *
 * A full rebuild costs one HTTP request per presentation, paced so
 * ProPresenter stays responsive — measured at 15m16s for 445 presentations.
 * Almost none of them changed. The `.pro` file on disk is the ground truth for
 * "did this presentation change": its slides, its groups, and even which
 * arrangement is selected (`current_arrangement`) all live inside that file, so
 * any edit that would change the index also changes the file.
 *
 * Fingerprinting the whole library costs 0.46s (818 files, 70MB, measured), so
 * the saving is not marginal — it is minutes against half a second.
 *
 * Deliberately NOT read: ProPresenter's own catalog in
 * Workspaces/<name>-<id>/Database. That is a RocksDB store held under an
 * exclusive lock by the running app, in an undocumented private encoding, and a
 * corrupt one is what takes ProPresenter down entirely. The `.pro` files are
 * the same data, unlocked and read-only.
 *
 * This module is pure except for readFingerprint, so the decisions are testable
 * without a ProPresenter or a library on disk.
 */
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";

/**
 * A file's identity for change detection: size, mtime, and content hash.
 *
 * Size and mtime alone would be cheaper, but they are not sufficient here.
 * Library Sync copies presentations between macOS accounts and preserves
 * mtimes (see stageAndWrite/copyAtomic in arrangement-diff.js and
 * library-sync.js), so a synced-in file can arrive with content that differs
 * from the local copy while carrying the same size and mtime. Hashing removes
 * that hole, and at 0.46s for a whole library there is no reason to gamble.
 *
 * The hash alone would be enough to be correct; size and mtime ride along
 * because they cost nothing and make a mismatch legible when diagnosing why
 * something re-indexed.
 */
export function fileFingerprint({ size, mtimeMs, hash }) {
  return `${size}:${Math.round(mtimeMs)}:${hash}`;
}

/** Fingerprints one .pro file, or null if it cannot be read. */
export async function readFingerprint(filePath) {
  if (!filePath) return null;
  try {
    const [stats, contents] = await Promise.all([stat(filePath), readFile(filePath)]);
    if (!stats.isFile()) return null;
    return fileFingerprint({
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      hash: createHash("sha1").update(contents).digest("hex"),
    });
  } catch {
    // Deleted, renamed, permissions, or on a volume that went away. Callers
    // treat null as "cannot vouch for this one" and re-fetch it.
    return null;
  }
}

/**
 * Options that change what an index CONTAINS rather than which presentations
 * are in it. If either differs from the previous build, carrying entries over
 * would silently mix old and new interpretations of the same library, so the
 * whole index has to be rebuilt.
 *
 * - preferredArrangements decides which arrangement's slide order is indexed,
 *   and it is order-sensitive: ["FS","T"] and ["T","FS"] disagree about which
 *   wins for a song that has both.
 * - crawlPlaylists decides whether appearsIn is populated at all.
 *
 * Library folder scope is deliberately NOT here: it changes which
 * presentations the listing returns, and that is already handled correctly —
 * added folders bring ids that aren't in the previous index (so they're
 * fetched), removed folders stop appearing (so they're dropped).
 */
export function sameBuildOptions(a, b) {
  const prefA = a?.preferredArrangements ?? [];
  const prefB = b?.preferredArrangements ?? [];
  if (prefA.length !== prefB.length) return false;
  if (prefA.some((name, i) => name !== prefB[i])) return false;
  return Boolean(a?.crawlPlaylists) === Boolean(b?.crawlPlaylists);
}

/** Fields an entry must carry for its slides to be reusable next time. */
export const CARRIED_FIELDS = [
  "slides",
  "groupSequence",
  "arrangementName",
  "arrangementId",
  "arrangementSource",
  "createdDate",
  "modifiedDate",
  "presentationPath",
  "fingerprint",
];

/**
 * Copies the reusable fields off a previous index entry. Used both when a file
 * is unchanged and when a re-read fails and the previous entry is the best
 * thing we still have.
 */
export function carriedEntryFields(prev) {
  const carried = {};
  if (!prev) return carried;
  for (const field of CARRIED_FIELDS) {
    if (prev[field] !== undefined) carried[field] = prev[field];
  }
  return carried;
}

/**
 * Fingerprints a file, but returns null if it was modified after `sinceMs`.
 *
 * `sinceMs` comes from Date.now(), which is whole milliseconds, while mtimeMs
 * carries a fraction — so the mtime is floored to compare like with like.
 * Without that, a file written a fraction of a millisecond BEFORE the fetch
 * began reads as newer than it and every presentation looks mid-save. A real
 * mid-fetch save lands in a later millisecond, since a fetch is never that
 * fast.
 *
 * Used for presentations we had never seen before: their path is only known
 * once the doc has been fetched, so the fingerprint can only be taken
 * afterwards. If the operator saved the file during that fetch, the fingerprint
 * would describe content newer than the slides we just indexed, and the next
 * reindex would skip it and keep serving the stale ones. Returning null instead
 * costs one re-read next time and cannot go stale.
 */
export async function readFingerprintUnchangedSince(filePath, sinceMs) {
  if (!filePath) return null;
  try {
    const stats = await stat(filePath);
    if (Math.floor(stats.mtimeMs) > sinceMs) return null;
  } catch {
    return null;
  }
  return readFingerprint(filePath);
}

/**
 * Decides, for a set of presentation ids already discovered in this run, which
 * can reuse the previous index's slides and which must be re-read.
 *
 * `ids` is the skeleton built from the library listing (plus the playlist crawl
 * when enabled), so anything the previous index held that is no longer in `ids`
 * is simply absent from the result — deletions need no special handling.
 *
 * @param {object} opts
 * @param {string[]} opts.ids - presentation ids discovered this run
 * @param {object|null} opts.previous - the previous index, or null
 * @param {Record<string,string|null>} opts.fingerprints - id -> current file
 *   fingerprint, or null when the file could not be read
 * @param {object} opts.buildOptions - this run's { preferredArrangements, crawlPlaylists }
 * @param {number} opts.schemaVersion - the current index schema version
 * @returns {{mode: "full"|"incremental", reason?: string, carryOver?: object,
 *   needFetch?: string[], counts?: object}}
 */
export function planIncremental({ ids, previous, fingerprints = {}, buildOptions, schemaVersion }) {
  if (!previous?.builtAt) {
    return { mode: "full", reason: "no previous index to build on" };
  }
  if (previous.schemaVersion !== schemaVersion) {
    return { mode: "full", reason: "index was built by an older version of Refrain" };
  }
  if (!sameBuildOptions(previous.buildOptions, buildOptions)) {
    return { mode: "full", reason: "indexing settings changed since the last build" };
  }

  const carryOver = {};
  const needFetch = [];
  const counts = { carriedOver: 0, changed: 0, added: 0, unverifiable: 0 };

  for (const id of ids) {
    const prev = previous.presentations?.[id];
    if (!prev) {
      needFetch.push(id);
      counts.added += 1;
      continue;
    }
    // An entry from before fingerprinting existed, or one indexed while
    // ProPresenter was remote (no filesystem to stat). Nothing to compare
    // against, so re-read it rather than trusting it indefinitely.
    if (!prev.fingerprint || !prev.presentationPath) {
      needFetch.push(id);
      counts.unverifiable += 1;
      continue;
    }
    const current = fingerprints[id];
    if (!current) {
      needFetch.push(id);
      counts.unverifiable += 1;
      continue;
    }
    if (current !== prev.fingerprint) {
      needFetch.push(id);
      counts.changed += 1;
      continue;
    }
    carryOver[id] = carriedEntryFields(prev);
    counts.carriedOver += 1;
  }

  return { mode: "incremental", carryOver, needFetch, counts };
}

/**
 * The paths worth fingerprinting this run: only ids we might carry over, and
 * only where the previous index recorded where the file lives.
 */
export function fingerprintTargets({ ids, previous }) {
  const targets = [];
  for (const id of ids) {
    const path = previous?.presentations?.[id]?.presentationPath;
    if (path) targets.push({ id, path });
  }
  return targets;
}
