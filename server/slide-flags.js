/**
 * Flag the slide that is live, to fix after the service (issue #1).
 *
 * Mid-service you spot a typo or a bad line break and can do nothing about it:
 * you are running the service. By the end nobody remembers which slide, or in
 * which service. One press here records it, and the record points back at the
 * slide later.
 *
 * Three constraints from the issue shape everything below:
 *
 * - **No new ProPresenter traffic.** Capture reads the heartbeat's cached live
 *   state, the same thing the Search readout shows, so it is free during a
 *   service and fine under performance mode. The cost of that is honest and
 *   written down: the text snapshot is the INDEXED text of that slide, not a
 *   fresh read of the screen. Refrain reindexes a deck within seconds of it
 *   being saved, so this is normally current -- but getting the true on-screen
 *   text would mean calling ProPresenter on every press, which the issue rules
 *   out.
 *
 * - **Read-only on ProPresenter.** This records and points. It never writes to
 *   a presentation.
 *
 * - **Two machines, one list, via a synced folder.** Each flag is its own
 *   small file, never an entry in one shared list. Two machines appending to
 *   one file in Dropbox or Drive is how sync services produce "conflicted
 *   copy" files and lose writes; two machines creating different files cannot
 *   collide.
 *
 * And the one from CLAUDE.md: never lose data silently. A flag is written on
 * this machine first, then copied to the shared folder. If the shared folder
 * is unreachable -- a network drive gone to sleep -- the flag stays safe here
 * and the copy is retried, and the operator is told which happened.
 */

import { readFile, writeFile, readdir, mkdir, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";

export const DEFAULT_FLAGS_FOLDER = "./data/slide-flags";
export const PENDING_DIR = "./data/slide-flags-pending";

// The heartbeat refreshes live state every 4 seconds while a screen is
// watching, and every 30 when nothing is. Older than this and "what is live" is
// a guess, so capture refuses rather than flag the wrong slide -- set just past
// one idle beat, so a press moments before the next refresh is not refused.
export const LIVE_STATE_MAX_AGE_MS = 45_000;

/**
 * The flag for whatever is live, or the reason there is nothing to flag.
 *
 * Pure: give it the heartbeat's cached state and the index entry, get a
 * record back. No I/O, so every refusal is testable without a ProPresenter.
 *
 * @param {object} liveState - server/index.js's cached heartbeat state
 * @param {object} [opts]
 * @param {object|null} [opts.indexEntry] - the presentation's search-index entry, for its library path
 * @param {number} [opts.now]
 * @param {string} [opts.machine]
 * @param {string} [opts.id]
 */
export function buildFlag(liveState, { indexEntry = null, now = Date.now(), machine = hostname(), id } = {}) {
  const slide = liveState?.slide;
  if (!liveState?.connected || !slide?.presentationId || !Number.isInteger(slide.slideIndex)) {
    return { ok: false, error: "Nothing to flag: Refrain cannot see a slide in ProPresenter right now." };
  }
  const age = now - (liveState.checkedAt ?? 0);
  if (!Number.isFinite(age) || age > LIVE_STATE_MAX_AGE_MS) {
    return {
      ok: false,
      error: "Nothing flagged: Refrain has not heard from ProPresenter recently, so it cannot be sure which slide is live.",
    };
  }
  const capturedAt = new Date(now).toISOString();
  return {
    ok: true,
    flag: {
      id: id ?? flagId(capturedAt),
      capturedAt,
      presentationId: slide.presentationId,
      presentationName: slide.presentationName ?? slide.name ?? null,
      folder: slide.folder ?? indexEntry?.folder ?? null,
      presentationPath: indexEntry?.presentationPath ?? null,
      arrangementName: slide.arrangementName ?? null,
      slideIndex: slide.slideIndex,
      // The slide's text as last indexed -- see the note at the top of this file.
      text: slide.text ?? null,
      // Whether it was actually on the screens, or merely the current slide of
      // a cleared presentation. Both are worth flagging; they read differently.
      wasOnScreen: Boolean(liveState.live),
      machine,
    },
  };
}

/**
 * Sortable, unique across machines, and safe as a filename on every synced
 * folder service (no colons, which some of them reject).
 */
export function flagId(capturedAtIso) {
  return `${capturedAtIso.replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
}

/** Only ids this module generated -- never a path from the browser. */
export function isFlagId(id) {
  return typeof id === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}$/.test(id);
}

async function writeAtomic(dir, name, data) {
  await mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, name);
  const tmpPath = `${finalPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2));
  await rename(tmpPath, finalPath);
}

/**
 * Saves a flag: here first, then to the flags folder.
 *
 * Returns `{ shared: true }` when it reached the flags folder and
 * `{ shared: false, reason }` when it is safe on this machine but the copy is
 * waiting. Only throws when it could not even be saved here -- the one case
 * where the operator genuinely needs to know it did not work.
 */
export async function saveFlag(flag, { folder = DEFAULT_FLAGS_FOLDER, pendingDir = PENDING_DIR } = {}) {
  // Never write "undefined.json": a flag without a real id could not be
  // listed back, which is the same as losing it.
  if (!isFlagId(flag?.id)) throw new Error("That is not a valid flag, so it was not saved.");
  const name = `${flag.id}.json`;
  await writeAtomic(pendingDir, name, flag);
  try {
    await writeAtomic(folder, name, flag);
  } catch (err) {
    return { shared: false, reason: err.message };
  }
  await unlink(path.join(pendingDir, name)).catch(() => {});
  return { shared: true };
}

/** Copies anything still waiting to the flags folder. Safe to call any time. */
export async function retryPendingFlags({ folder = DEFAULT_FLAGS_FOLDER, pendingDir = PENDING_DIR } = {}) {
  const names = (await readdir(pendingDir).catch(() => [])).filter((n) => n.endsWith(".json"));
  let succeeded = 0;
  for (const name of names) {
    try {
      const flag = JSON.parse(await readFile(path.join(pendingDir, name), "utf-8"));
      await writeAtomic(folder, name, flag);
      await unlink(path.join(pendingDir, name));
      succeeded += 1;
    } catch {
      // Still unreachable, or unreadable -- leave it for the next attempt.
    }
  }
  return { attempted: names.length, succeeded };
}

/**
 * Every flag this machine can see: the shared folder plus anything still
 * waiting to be copied there, newest first. A waiting flag is still a flag --
 * hiding it until the network came back would be losing it from the operator's
 * point of view.
 */
export async function listFlags({ folder = DEFAULT_FLAGS_FOLDER, pendingDir = PENDING_DIR } = {}) {
  const byId = new Map();
  const load = async (dir, pending) => {
    for (const name of await readdir(dir).catch(() => [])) {
      if (!name.endsWith(".json")) continue;
      try {
        const flag = JSON.parse(await readFile(path.join(dir, name), "utf-8"));
        if (!isFlagId(flag?.id)) continue;
        // The shared copy wins if both exist; it is the one other machines see.
        if (!byId.has(flag.id) || !pending) byId.set(flag.id, { ...flag, pending });
      } catch {
        // A half-synced or damaged file is skipped, not fatal to the list.
      }
    }
  };
  await load(folder, false);
  await load(pendingDir, true);
  return [...byId.values()].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}
