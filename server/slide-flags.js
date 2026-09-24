/**
 * Flag the slide that is live, to fix after the service (issues #1 and #2).
 *
 * Mid-service you spot a typo or a bad line break and can do nothing about it:
 * you are running the service. By the end nobody remembers which slide, or in
 * which service. One press here records it, and the record points back at the
 * slide later. One tap on a type records what KIND of problem it was too --
 * a typo is a different job from a wrong background.
 *
 * Three constraints from the issues shape everything below:
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
 * - **Two machines, one list, via a synced folder.** Every write is a NEW file;
 *   nothing is ever rewritten. A flag is its own file, and so is every later
 *   change to it -- a note, a new type, marking it resolved -- in `updates/`,
 *   merged in time order when the list is read. Two machines rewriting one
 *   file in Dropbox or Drive is how sync services produce "conflicted copy"
 *   files and lose writes; two machines creating different files cannot
 *   collide, even when both touch the same flag.
 *
 * And the one from CLAUDE.md: never lose data silently. Everything is written
 * on this machine first, then copied to the shared folder. If the shared
 * folder is unreachable -- a network drive gone to sleep -- the write stays
 * safe here and the copy is retried, and the operator is told which happened.
 */

import { readFile, writeFile, readdir, mkdir, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";

export const DEFAULT_FLAGS_FOLDER = "./data/slide-flags";
export const PENDING_DIR = "./data/slide-flags-pending";
const UPDATES = "updates";

// The heartbeat refreshes live state every 4 seconds while a screen is
// watching, and every 30 when nothing is. Older than this and "what is live" is
// a guess, so capture refuses rather than flag the wrong slide -- set just past
// one idle beat, so a press moments before the next refresh is not refused.
export const LIVE_STATE_MAX_AGE_MS = 45_000;

/**
 * The starting set from issue #2, with the icons it names. Two distinctions
 * the issue insists on, because they are different jobs for different people:
 * foreground vs background image, and typo vs wrong verse or lyrics.
 *
 * Order here does not matter -- see flagTypes.
 */
export const DEFAULT_FLAG_TYPES = [
  { label: "Background image", icon: "wallpaper" },
  { label: "Foreground image", icon: "image" },
  { label: "Formatting", icon: "type" },
  { label: "Missing slide", icon: "file-plus" },
  { label: "Other", icon: "circle-ellipsis" },
  { label: "Slide order", icon: "list-ordered" },
  { label: "Template", icon: "layout-template" },
  { label: "Timing or advance", icon: "timer" },
  { label: "Typo or spelling", icon: "spell-check" },
  { label: "Video or audio", icon: "film" },
  { label: "Wrong verse or lyrics", icon: "text-quote" },
];

// Resolved flags stay in the list this long, then drop out of it. See
// visibleFlags: they are hidden, never deleted.
export const DEFAULT_KEEP_RESOLVED_DAYS = 14;

/**
 * The types to offer, from config or the defaults, sorted alphabetically.
 *
 * Sorted here, at render time, rather than trusting config order -- the issue
 * is explicit: mid-service the operator is scanning, not reading, and a
 * left-aligned alphabetical grid is scannable where a grouped one is not. A
 * team adding its own type gets it in the right place without thinking about
 * it. Strict alphabetical does put "Other" in the middle; a pinned exception
 * would be one more rule to remember, so it is not made.
 */
export function flagTypes(configured) {
  const source = Array.isArray(configured) && configured.length ? configured : DEFAULT_FLAG_TYPES;
  const seen = new Set();
  const types = [];
  for (const t of source) {
    const label = typeof t === "string" ? t.trim() : typeof t?.label === "string" ? t.label.trim() : "";
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const icon = typeof t?.icon === "string" && /^[a-z0-9-]+$/.test(t.icon) ? t.icon : "flag";
    types.push({ label, icon });
  }
  return types.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/**
 * The flag for whatever is live, or the reason there is nothing to flag.
 *
 * Pure: give it the heartbeat's cached state and the index entry, get a
 * record back. No I/O, so every refusal is testable without a ProPresenter.
 *
 * @param {object} liveState - server/index.js's cached heartbeat state
 * @param {object} [opts]
 * @param {object|null} [opts.indexEntry] - the presentation's search-index entry, for its library path
 * @param {string|null} [opts.type] - a label from flagTypes, or null for an untyped quick flag
 * @param {number} [opts.now]
 * @param {string} [opts.machine]
 * @param {string} [opts.id]
 */
export function buildFlag(liveState, { indexEntry = null, type = null, now = Date.now(), machine = hostname(), id } = {}) {
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
      // null from the quick "Flag this slide" chip; the type can be set later.
      type: typeof type === "string" && type ? type : null,
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

/**
 * A later change to a flag: its note, its type, whether it is resolved.
 * Only the fields present are changed, so two machines editing different
 * things about one flag both land.
 */
export function buildUpdate(flagIdValue, fields = {}, { now = Date.now(), machine = hostname() } = {}) {
  if (!isFlagId(flagIdValue)) return { ok: false, error: "That is not a flag Refrain knows." };
  const change = {};
  if (typeof fields.note === "string") change.note = fields.note.slice(0, 2000);
  if (typeof fields.resolved === "boolean") change.resolved = fields.resolved;
  if (fields.type === null || (typeof fields.type === "string" && fields.type)) change.type = fields.type;
  if (Object.keys(change).length === 0) return { ok: false, error: "Nothing to change." };
  const at = new Date(now).toISOString();
  return { ok: true, update: { flagId: flagIdValue, updateId: flagId(at), at, machine, ...change } };
}

function isUpdateName(name) {
  const m = /^(.+)~(.+)\.json$/.exec(name);
  return Boolean(m && isFlagId(m[1]) && isFlagId(m[2]));
}

async function writeAtomic(dir, name, data) {
  await mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, name);
  const tmpPath = `${finalPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2));
  await rename(tmpPath, finalPath);
}

/** Here first, then the shared folder. Throws only if it could not be saved here. */
async function saveRecord(subdir, name, data, { folder, pendingDir }) {
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
  return saveRecord("", `${flag.id}.json`, flag, { folder, pendingDir });
}

/** Saves a change to a flag, the same way -- a new file, never an edit. */
export async function saveUpdate(update, { folder = DEFAULT_FLAGS_FOLDER, pendingDir = PENDING_DIR } = {}) {
  if (!isFlagId(update?.flagId) || !isFlagId(update?.updateId)) {
    throw new Error("That is not a valid change, so it was not saved.");
  }
  return saveRecord(UPDATES, `${update.flagId}~${update.updateId}.json`, update, { folder, pendingDir });
}

/** Copies anything still waiting to the flags folder. Safe to call any time. */
export async function retryPendingFlags({ folder = DEFAULT_FLAGS_FOLDER, pendingDir = PENDING_DIR } = {}) {
  let attempted = 0;
  let succeeded = 0;
  for (const subdir of ["", UPDATES]) {
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

async function readJsonDir(dir, accept) {
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

/**
 * Every flag this machine can see, with its changes applied, newest first.
 *
 * The shared folder plus anything still waiting to be copied there: a waiting
 * flag is still a flag, and hiding it until the network came back would be
 * losing it from the operator's point of view.
 */
export async function listFlags({ folder = DEFAULT_FLAGS_FOLDER, pendingDir = PENDING_DIR } = {}) {
  const byId = new Map();
  for (const [dir, pending] of [[folder, false], [pendingDir, true]]) {
    for (const flag of await readJsonDir(dir, () => true)) {
      if (!isFlagId(flag?.id)) continue;
      // The shared copy wins if both exist; it is the one other machines see.
      if (!byId.has(flag.id) || !pending) byId.set(flag.id, { ...flag, pending });
    }
  }

  const updates = new Map();
  for (const [dir, pending] of [[path.join(folder, UPDATES), false], [path.join(pendingDir, UPDATES), true]]) {
    for (const u of await readJsonDir(dir, isUpdateName)) {
      if (!isFlagId(u?.flagId) || !isFlagId(u?.updateId)) continue;
      const key = u.updateId;
      // The same update in both places is one update.
      if (!updates.has(key) || !pending) updates.set(key, { ...u, pending });
    }
  }
  // Applied oldest first, so the latest change to each field wins.
  const ordered = [...updates.values()].sort((a, b) => a.at.localeCompare(b.at) || a.updateId.localeCompare(b.updateId));
  for (const u of ordered) {
    const flag = byId.get(u.flagId);
    if (!flag) continue; // its flag has not synced here yet; it will apply when it does
    if ("note" in u) flag.note = u.note;
    if ("type" in u) flag.type = u.type;
    if ("resolved" in u) {
      flag.resolved = u.resolved;
      flag.resolvedAt = u.resolved ? u.at : null;
    }
    flag.updatedAt = u.at;
    if (u.pending) flag.pending = true;
  }

  return [...byId.values()].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

/**
 * The flags worth showing: every open one, and resolved ones for a while.
 *
 * Hidden, not deleted. The issue asks for resolved items to be "pruned" after
 * a window, and in a shared folder a prune is one machine deleting files on
 * every other machine's behalf. A flag is a few hundred bytes; ten thousand of
 * them is a few megabytes. So they drop out of the list and stay on disk,
 * where a change of mind can still find them.
 */
export function visibleFlags(flags, { now = Date.now(), keepResolvedDays = DEFAULT_KEEP_RESOLVED_DAYS } = {}) {
  const cutoff = now - keepResolvedDays * 86_400_000;
  return (flags ?? []).filter((f) => !f.resolved || !f.resolvedAt || new Date(f.resolvedAt).getTime() >= cutoff);
}
