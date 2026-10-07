/**
 * Known good arrangements, and what changed since (owner, 2026-10-07).
 *
 * The problem: for a live event a song's arrangement gets dragged into a
 * different order, and afterwards nobody can say which songs were touched or
 * what they were before. Refrain cannot put them back (ProPresenter offers no
 * way to change an arrangement from outside, and Refrain never rewrites its
 * files), but it can say exactly which songs differ, how, and when ProPresenter
 * last saved them.
 *
 * How it knows "before": for every song, the order of groups in the arrangement
 * the search index reads (its group sequence), remembered the first time
 * Refrain sees the song and moved only when a person presses **Dismiss** on a
 * change. It reads nothing from ProPresenter: it compares the index's own
 * records, which the index already holds. A song edited before Refrain first
 * learned it is learned as it is, which is why the first week is quiet.
 *
 * What it cannot see: a song's other arrangements (the index reads one), and
 * edits within a slide's words (Spell Check's job). The time is when the song's
 * file was last saved, which is the only time Refrain has; a song saved twice
 * shows the later one.
 *
 * Pure: index.js owns the file and the clock.
 */

/** Two sequences are the same if every group is the same name in the same place. */
export const sameSequence = (a, b) => a.length === b.length && a.every((g, i) => g === b[i]);

/**
 * The longest run both sequences share, so a moved or added group is marked and
 * everything around it is not. `before` entries are "same" or "gone"; `after`
 * entries are "same" or "new". Standard longest-common-subsequence; songs have a
 * dozen groups, so the table is tiny.
 */
export function diffChips(before, after) {
  const n = before.length;
  const m = after.length;
  const t = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      t[i][j] = before[i] === after[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  const b = [];
  const a = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      b.push({ name: before[i], state: "same" });
      a.push({ name: after[j], state: "same" });
      i += 1;
      j += 1;
    } else if (t[i + 1][j] >= t[i][j + 1]) {
      b.push({ name: before[i], state: "gone" });
      i += 1;
    } else {
      a.push({ name: after[j], state: "new" });
      j += 1;
    }
  }
  for (; i < n; i += 1) b.push({ name: before[i], state: "gone" });
  for (; j < m; j += 1) a.push({ name: after[j], state: "new" });
  return { before: b, after: a };
}

/** One index entry, as the record kept for it. Null if it has no group order to keep. */
export function recordOf(entry) {
  if (!entry || !Array.isArray(entry.groupSequence) || !entry.groupSequence.length) return null;
  return { name: entry.name ?? "Untitled", arrangement: entry.arrangementName ?? null, sequence: entry.groupSequence.map(String) };
}

/**
 * Compares the index with what is kept.
 *
 * - A song not kept yet is **learned**, never reported.
 * - A song whose indexed arrangement changed (the preferred setting moved from
 *   FS to T) is **re-learned**: its order is not comparable with the old one.
 * - A song whose order differs is a **change**, and stays one until it matches
 *   again or is dismissed.
 *
 * @param {Record<string, {name, arrangement, sequence}>} known
 * @param {Record<string, object>} presentations the index's entries
 * @returns {{ learn: Record<string, object>, changes: object[] }}
 */
export function compareToKnownGood(known, presentations) {
  const learn = {};
  const changes = [];
  for (const [presentationId, entry] of Object.entries(presentations ?? {})) {
    const now = recordOf(entry);
    if (!now) continue;
    const was = known?.[presentationId];
    if (!was || was.arrangement !== now.arrangement) {
      learn[presentationId] = now;
      continue;
    }
    if (sameSequence(was.sequence, now.sequence)) {
      // A rename is not a change; keep the name current.
      if (was.name !== now.name) learn[presentationId] = now;
      continue;
    }
    const chips = diffChips(was.sequence, now.sequence);
    changes.push({
      presentationId,
      name: now.name,
      arrangement: now.arrangement,
      before: chips.before,
      after: chips.after,
      modifiedDate: entry.modifiedDate ?? null,
    });
  }
  // Newest save first, so the thing that just happened is on top.
  changes.sort((x, y) => String(y.modifiedDate ?? "").localeCompare(String(x.modifiedDate ?? "")));
  return { learn, changes };
}

/**
 * Splits changes into those saved during the service and those before it, by
 * when the song was last saved. With no service start there is no split: all are
 * "since". Anything saved at or after the start counts as during, so a song saved
 * both before and during lands where the person looks hardest. When every
 * service has ended (`serviceEndMs`), a save after the last one is not "during":
 * it is returned in `since`, as the clean-up it usually is.
 */
export function splitByService(changes, serviceStartMs, serviceEndMs = null) {
  if (!Number.isFinite(serviceStartMs)) return { during: [], before: [], since: changes };
  const at = (c) => (c.modifiedDate ? new Date(c.modifiedDate).getTime() : NaN);
  const ended = Number.isFinite(serviceEndMs);
  const after = ended ? changes.filter((c) => at(c) > serviceEndMs) : [];
  const during = changes.filter((c) => !(at(c) < serviceStartMs) && !(ended && at(c) > serviceEndMs));
  const before = changes.filter((c) => at(c) < serviceStartMs);
  // After the last service ended: usually the clean-up itself, so it is not
  // shown as something done live. `since` carries it when a start is known.
  return { during, before, since: after };
}
