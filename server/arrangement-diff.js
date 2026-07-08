/**
 * Arrangement drift-tracking core logic (Section 8) — ChMS/storage-
 * agnostic. Takes a provider (planned arrangement) and a storage
 * backend (per-song history file), diffs planned vs. actual, and
 * writes the result with multi-logger collision protection (8.5) and
 * local staging before the remote write (8.4).
 */
import { writeFile, readFile, unlink, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const STAGING_DIR = "./staging/pending";

/**
 * Normalizes a section label for fuzzy comparison: lowercase, strip
 * trailing numbers/punctuation/whitespace. "Chorus 1" and "chorus:" both
 * become "chorus".
 */
function normalizeSectionName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[\d:.\-_]+$/g, "")
    .trim();
}

/**
 * Suggests a starting sectionMapping (ProPresenter group name -> target
 * vocabulary term) for groups with no mapping yet. Falls back to
 * identity (map a group to itself) when no target vocabulary is given
 * or nothing matches closely enough — the common case for the manual
 * provider, where planned and actual already share vocabulary. Once a
 * real ChMS provider is wired in, pass its section names as
 * `targetVocabulary` for real fuzzy suggestions (Section 8.3).
 */
export function suggestMapping(groupNames, targetVocabulary = []) {
  const suggestions = {};
  for (const group of groupNames) {
    const normalizedGroup = normalizeSectionName(group);
    const match = targetVocabulary.find((term) => normalizeSectionName(term) === normalizedGroup);
    suggestions[group] = match ?? group;
  }
  return suggestions;
}

function toCounts(arr) {
  const counts = new Map();
  for (const item of arr) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

/** Items in `seq` not consumed by matching against `otherCounts`. */
function unmatched(seq, otherCounts) {
  const remaining = new Map(otherCounts);
  const result = [];
  for (const item of seq) {
    const avail = remaining.get(item) ?? 0;
    if (avail > 0) remaining.set(item, avail - 1);
    else result.push(item);
  }
  return result;
}

/** Items in `seq` that ARE matched against `otherCounts`, in `seq`'s own order. */
function matched(seq, otherCounts) {
  const remaining = new Map(otherCounts);
  const result = [];
  for (const item of seq) {
    const avail = remaining.get(item) ?? 0;
    if (avail > 0) {
      remaining.set(item, avail - 1);
      result.push(item);
    }
  }
  return result;
}

/**
 * Diffs a planned section sequence against what actually got run.
 * - skipped: planned sections that never appeared in actual.
 * - added: actual sections that weren't planned.
 * - reordered: the actual-order sequence of sections common to both,
 *   only populated when that order differs from the planned order (a
 *   simple "did the shared sections happen in the planned order"
 *   check — not a full alignment algorithm, but the doc leaves the
 *   exact method open and this surfaces real drift plainly).
 */
export function diffSequences(planned, actual) {
  const plannedCounts = toCounts(planned);
  const actualCounts = toCounts(actual);

  const skipped = unmatched(planned, actualCounts);
  const added = unmatched(actual, plannedCounts);

  const matchedPlannedOrder = matched(planned, actualCounts);
  const matchedActualOrder = matched(actual, plannedCounts);
  const sameOrder =
    matchedPlannedOrder.length === matchedActualOrder.length &&
    matchedPlannedOrder.every((v, i) => v === matchedActualOrder[i]);

  return { skipped, added, reordered: sameOrder ? [] : matchedActualOrder };
}

/** Applies a group->term mapping to an actual sequence; unmapped groups are flagged, never silently dropped (Section 8.3). */
export function applyMapping(actualGroupSequence, sectionMapping) {
  return actualGroupSequence.map((group) => sectionMapping[group] ?? `[unmapped] ${group}`);
}

/**
 * Runs one comparison for a song: pulls the plan, diffs it against the
 * synced "actual" arrangement, and writes the result — staged locally
 * first (8.4), with multi-logger collision protection on the exact
 * service date (8.5).
 *
 * @returns {{ ok: true, record: object } | { ok: false, conflict: true, existingMachineId: string }}
 */
export async function runComparison({
  songId,
  songName,
  presentationId,
  serviceDate,
  actualGroupSequence,
  provider,
  storage,
  machineId,
  force = false,
}) {
  const existing = (await storage.readSongFile(songId)) ?? {
    songId,
    songName,
    propresenterPresentationId: presentationId,
    sectionMapping: suggestMapping(actualGroupSequence),
    manualPlannedArrangement: [],
    history: [],
  };

  const conflictEntry = existing.history.find(
    (h) => h.serviceDate === serviceDate && h.loggedByMachineId !== machineId
  );
  if (conflictEntry && !force) {
    return { ok: false, conflict: true, existingMachineId: conflictEntry.loggedByMachineId };
  }

  const { sectionSequence: planned } = await provider.getPlannedArrangement(songId, serviceDate);
  const actual = applyMapping(actualGroupSequence, existing.sectionMapping ?? {});
  const diff = diffSequences(planned, actual);

  const newEntry = { serviceDate, planned, actual, diff, loggedByMachineId: machineId };
  const historyWithoutThisDate = existing.history.filter((h) => h.serviceDate !== serviceDate);
  const updated = { ...existing, songName, propresenterPresentationId: presentationId, history: [...historyWithoutThisDate, newEntry] };

  await stageAndWrite(songId, updated, storage);
  return { ok: true, record: updated };
}

/**
 * Local staging before the remote write (Section 8.4): write to a local
 * staging file first, attempt the real backend write, and only clear
 * the staged copy on confirmed success. A failed write is left in
 * staging/pending/ for the health screen to surface and for a later
 * retry, rather than silently losing that week's data.
 */
async function stageAndWrite(songId, data, storage) {
  await mkdir(STAGING_DIR, { recursive: true });
  const stagedPath = path.join(STAGING_DIR, `${songId}.json`);
  await writeFile(stagedPath, JSON.stringify(data, null, 2));

  await storage.writeSongFile(songId, data);
  await unlink(stagedPath).catch(() => {});
}

/** Retries any staged writes left over from a previous failed attempt. */
export async function retryPendingUploads(storage) {
  const files = await readdir(STAGING_DIR).catch(() => []);
  let succeeded = 0;
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const songId = file.replace(/\.json$/, "");
    try {
      const raw = await readFile(path.join(STAGING_DIR, file), "utf-8");
      await storage.writeSongFile(songId, JSON.parse(raw));
      await unlink(path.join(STAGING_DIR, file));
      succeeded += 1;
    } catch {
      // Still unreachable — leave it staged for the next attempt.
    }
  }
  return { attempted: files.length, succeeded };
}

export async function getPendingUploadCount() {
  const files = await readdir(STAGING_DIR).catch(() => []);
  return files.filter((f) => f.endsWith(".json")).length;
}
