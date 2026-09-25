/**
 * Append-only records for a folder two machines may share.
 *
 * Extracted from slide-flags.js when service days needed the same guarantees
 * (handoff section 37). The rules, and why:
 *
 * - **A new file per record, never an edit.** Two machines rewriting one file
 *   in Dropbox or Drive is how sync services produce "conflicted copy" files
 *   and lose writes. Two machines creating different files cannot collide.
 * - **Here first, then the shared folder.** A record is written to a local
 *   pending folder, then copied. If the shared folder is unreachable (a network
 *   drive gone to sleep), it stays safe here and the copy is retried. This is
 *   CLAUDE.md's "never lose data silently".
 * - **Atomic writes.** Temp file then rename, so a crash mid-write leaves the
 *   old state or the new one, never half a file.
 * - **Damaged files are skipped, not fatal.** A half-synced file must not take
 *   the whole list down with it.
 */

import { readFile, writeFile, readdir, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

export async function writeAtomic(dir, name, data) {
  await mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, name);
  const tmpPath = `${finalPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2));
  await rename(tmpPath, finalPath);
}

/**
 * Saves one record: here first, then the shared folder.
 * Returns `{ shared: true }`, or `{ shared: false, reason }` when it is safe
 * here but the copy is waiting. Throws only if it could not be saved here.
 */
export async function saveRecord(subdir, name, data, { folder, pendingDir }) {
  const localDir = path.join(pendingDir, subdir);
  await writeAtomic(localDir, name, data);
  try {
    await writeAtomic(path.join(folder, subdir), name, data);
  } catch (err) {
    return { shared: false, reason: err.message };
  }
  await unlink(path.join(localDir, name)).catch(() => {});
  return { shared: true };
}

/** Copies anything still waiting in these subfolders to the shared folder. Safe to call any time. */
export async function retryPending(subdirs, { folder, pendingDir }) {
  let attempted = 0;
  let succeeded = 0;
  for (const subdir of subdirs) {
    const localDir = path.join(pendingDir, subdir);
    const names = (await readdir(localDir).catch(() => [])).filter((n) => n.endsWith(".json"));
    for (const name of names) {
      attempted += 1;
      try {
        const record = JSON.parse(await readFile(path.join(localDir, name), "utf-8"));
        await writeAtomic(path.join(folder, subdir), name, record);
        await unlink(path.join(localDir, name));
        succeeded += 1;
      } catch {
        // Still unreachable, or unreadable -- leave it for the next attempt.
      }
    }
  }
  return { attempted, succeeded };
}

/** Every parseable JSON record in a folder whose name passes `accept`. */
export async function readJsonDir(dir, accept = () => true) {
  const out = [];
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.endsWith(".json") || !accept(name)) continue;
    try {
      out.push(JSON.parse(await readFile(path.join(dir, name), "utf-8")));
    } catch {
      // A half-synced or damaged file is skipped, not fatal to the list.
    }
  }
  return out;
}

/** Names of the subfolders of a folder, for records grouped by day. */
export async function listSubdirs(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}
