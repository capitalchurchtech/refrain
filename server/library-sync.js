/**
 * One-way sync of a single ProPresenter library between two machines (or two
 * macOS accounts) through a shared folder.
 *
 * Why this exists: a ProPresenter library is a plain folder of .pro files, so
 * one library can be kept in step without dragging the others along. Verified
 * against a real install: ProPresenter picks up files copied into a library
 * folder live, with no restart, and notices removals too. A symlinked library
 * folder does NOT work (the library appears but reports zero presentations),
 * so it has to be a real copy.
 *
 * The overriding rule here is that a song library is years of work and this is
 * a program that writes into it on a schedule. So:
 *   - nothing is ever deleted, on either side. There is no mirror mode.
 *   - the sender refuses to run when the source looks implausibly small, which
 *     is what an empty or half-migrated folder looks like.
 *   - the receiver moves any file it is about to replace into a dated backup
 *     folder first, so an incoming file can never destroy the old version.
 *   - snapshots hard-link unchanged files, so keeping a month of them costs
 *     little more than one copy.
 *   - every file lands via a temp file and a rename, so a crash mid-write
 *     cannot leave a half-written .pro behind.
 *   - "has this changed" is answered by hashing the contents, not by comparing
 *     timestamps. Copying cannot preserve an mtime exactly (utimes rounds to
 *     the millisecond while the filesystem keeps nanoseconds), so a timestamp
 *     comparison reports every file as changed on every run, which would
 *     re-copy the whole library and back up all of it, every time. These files
 *     are small enough that hashing them is the cheaper and honest answer.
 *
 * The trade for never deleting: songs removed on the sending side linger on
 * the receiving side. That is deliberate. Pruning is a human decision, taken
 * with a snapshot in hand, not something a scheduled job gets to do.
 */
import { readdir, stat, mkdir, copyFile, rename, link, rm, readFile, writeFile, utimes } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/** Files that make up a library. Anything else in the folder is left alone. */
const LIBRARY_FILE_EXT = ".pro";

/** A source smaller than this is treated as a mistake rather than an instruction. */
export const DEFAULT_MINIMUM_FILES = 25;

/** How many dated snapshots to keep before the oldest are pruned. */
export const DEFAULT_SNAPSHOTS_TO_KEEP = 30;

/**
 * Decides whether a source folder is safe to sync FROM. The whole point is to
 * refuse the disaster case: a source that has been emptied, renamed, or is
 * mid-migration would otherwise be copied over the good copy as "the truth".
 */
export function checkSourceGuard(fileCount, minimumFiles = DEFAULT_MINIMUM_FILES) {
  if (!Number.isInteger(fileCount) || fileCount < 0) {
    return { ok: false, reason: "Could not count the files in the source folder." };
  }
  if (fileCount === 0) {
    return { ok: false, reason: "The source folder has no presentations in it. Refusing to sync." };
  }
  if (fileCount < minimumFiles) {
    return {
      ok: false,
      reason: `The source folder has only ${fileCount} presentation${fileCount === 1 ? "" : "s"}, below the safety floor of ${minimumFiles}. Refusing to sync in case the library is mid-move or incomplete.`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * Works out what a sync would do, without doing any of it. `source` and `dest`
 * are arrays of { name, size, hash }.
 *
 * A file counts as unchanged when its size and content hash both match.
 * Nothing is ever marked for deletion: a file present only in the destination
 * is reported as `extra` and left alone.
 */
export function planSync(source, dest) {
  const destByName = new Map((dest ?? []).map((f) => [f.name, f]));
  const plan = { toCopy: [], toReplace: [], unchanged: [], extra: [] };

  for (const file of source ?? []) {
    const existing = destByName.get(file.name);
    if (!existing) {
      plan.toCopy.push(file.name);
    } else if (existing.size === file.size && existing.hash === file.hash) {
      plan.unchanged.push(file.name);
    } else {
      plan.toReplace.push(file.name);
    }
  }

  const sourceNames = new Set((source ?? []).map((f) => f.name));
  for (const file of dest ?? []) {
    if (!sourceNames.has(file.name)) plan.extra.push(file.name);
  }
  return plan;
}

/** Snapshot folder name for a moment in time, sortable and human readable. */
export function snapshotName(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/**
 * Which snapshots to drop to keep at most `keep`, oldest first. Names sort
 * chronologically by construction (see snapshotName), so a lexical sort is a
 * chronological one. Returns [] when `keep` is 0 or less, meaning "never prune".
 */
export function prunePlan(snapshotNames, keep = DEFAULT_SNAPSHOTS_TO_KEEP) {
  if (!Number.isInteger(keep) || keep <= 0) return [];
  const sorted = [...(snapshotNames ?? [])].sort();
  return sorted.length <= keep ? [] : sorted.slice(0, sorted.length - keep);
}

/** sha1 of a file's contents. These are small documents, so this is cheap. */
async function hashFile(file) {
  return createHash("sha1").update(await readFile(file)).digest("hex");
}

/** The .pro files in a folder, with the fields planSync compares on. */
export async function listLibraryFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(LIBRARY_FILE_EXT) || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const s = await stat(full);
    files.push({ name: entry.name, size: s.size, mtimeMs: Math.floor(s.mtimeMs), hash: await hashFile(full) });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/** Copy preserving mtime, via a temp file so a partial write is never visible. */
async function copyAtomic(from, to) {
  const tmp = `${to}.refrain-tmp`;
  await copyFile(from, tmp);
  const s = await stat(from);
  await rename(tmp, to);
  // Keep mtime so the next run's unchanged-check works and we don't re-copy.
  await utimes(to, s.atime, s.mtime);
}

/**
 * A dated snapshot of `sourceDir`, hard-linking anything identical to the most
 * recent snapshot so repeated snapshots cost almost nothing. Returns the
 * snapshot name and how many files were linked rather than copied.
 */
export async function takeSnapshot({ sourceDir, snapshotsDir, keep = DEFAULT_SNAPSHOTS_TO_KEEP, now = new Date() }) {
  const files = await listLibraryFiles(sourceDir);
  // Two runs inside the same second would otherwise pick the same folder name
  // and the second would write into the first, making its "hard-linked" count
  // a lie. Suffix instead, so every run gets its own restore point.
  const base = snapshotName(now);
  const taken = new Set(await listSnapshots(snapshotsDir));
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base}-${n}`;
  const target = path.join(snapshotsDir, name);
  await mkdir(target, { recursive: true });

  // Most recent existing snapshot is the link source, matching rsync's
  // --link-dest. Compare on size+hash, and fall back to a real copy whenever
  // linking isn't possible (different volume, or the file changed).
  const existing = (await listSnapshots(snapshotsDir)).filter((n) => n !== name);
  const previous = existing.length ? path.join(snapshotsDir, existing[existing.length - 1]) : null;
  const previousFiles = previous ? new Map((await listLibraryFiles(previous)).map((f) => [f.name, f])) : new Map();

  let linked = 0;
  let copied = 0;
  for (const file of files) {
    const dest = path.join(target, file.name);
    const prior = previousFiles.get(file.name);
    if (previous && prior && prior.size === file.size && prior.hash === file.hash) {
      try {
        await link(path.join(previous, file.name), dest);
        linked += 1;
        continue;
      } catch {
        // fall through to a copy
      }
    }
    await copyAtomic(path.join(sourceDir, file.name), dest);
    copied += 1;
  }

  const pruned = prunePlan(await listSnapshots(snapshotsDir), keep);
  for (const old of pruned) {
    await rm(path.join(snapshotsDir, old), { recursive: true, force: true });
  }

  return { name, fileCount: files.length, linked, copied, pruned };
}

/** Dated snapshot folder names, oldest first. */
export async function listSnapshots(snapshotsDir) {
  try {
    const entries = await readdir(snapshotsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{6}(-\d+)?$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Copies a library one way, from `sourceDir` into `destDir`.
 *
 * Never deletes, never mirrors. Refuses outright when the source looks too
 * small to be real, and when `backupDir` is given, a file about to be replaced
 * is moved there first so the previous version always survives.
 *
 * @returns {Promise<{ok: boolean, reason?: string, copied: string[], replaced: string[], unchanged: number, extra: string[], backedUp: string[]}>}
 */
export async function syncLibrary({ sourceDir, destDir, backupDir = null, minimumFiles = DEFAULT_MINIMUM_FILES }) {
  const resolvedSource = path.resolve(sourceDir);
  const resolvedDest = path.resolve(destDir);
  if (resolvedSource === resolvedDest) {
    return { ok: false, reason: "Source and destination are the same folder.", copied: [], replaced: [], unchanged: 0, extra: [], backedUp: [] };
  }

  const source = await listLibraryFiles(resolvedSource);
  const guard = checkSourceGuard(source.length, minimumFiles);
  if (!guard.ok) {
    return { ok: false, reason: guard.reason, copied: [], replaced: [], unchanged: 0, extra: [], backedUp: [] };
  }

  await mkdir(resolvedDest, { recursive: true });
  const dest = await listLibraryFiles(resolvedDest);
  const plan = planSync(source, dest);

  const backedUp = [];
  if (backupDir && plan.toReplace.length) {
    await mkdir(backupDir, { recursive: true });
    for (const name of plan.toReplace) {
      // Copy rather than move: if the sync then fails, the destination is
      // still intact and we have the backup either way.
      await copyAtomic(path.join(resolvedDest, name), path.join(backupDir, name));
      backedUp.push(name);
    }
  }

  for (const name of [...plan.toCopy, ...plan.toReplace]) {
    await copyAtomic(path.join(resolvedSource, name), path.join(resolvedDest, name));
  }

  return {
    ok: true,
    copied: plan.toCopy,
    replaced: plan.toReplace,
    unchanged: plan.unchanged.length,
    extra: plan.extra,
    backedUp,
  };
}

/**
 * Derives the on-disk folder for a library from a presentation's own
 * `presentation_path`, rather than hardcoding a vendor's install layout. Also
 * means the path is self-verifying: if it doesn't resolve, the library isn't
 * where we think it is.
 */
export function libraryDirFromPresentationPath(presentationPath) {
  if (!presentationPath) return null;
  const dir = path.dirname(String(presentationPath));
  return dir && dir !== "." && dir !== "/" ? dir : null;
}

/** Records the last run so the screen can show what happened, kept small and atomic. */
export async function writeLastRun(statePath, record) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tmp`;
  await writeFile(tmp, JSON.stringify(record, null, 2));
  await rename(tmp, statePath);
}

export async function readLastRun(statePath) {
  try {
    return JSON.parse(await readFile(statePath, "utf-8"));
  } catch {
    return null;
  }
}
