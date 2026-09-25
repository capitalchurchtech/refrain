/**
 * Pre-service checks (handoff section 37, phase 2).
 *
 * One list, scoped to the service's playlist, each check answering **pass**,
 * **needs a look**, or **couldn't check**. The third is never shown as the
 * first: a check that didn't run is not a check that passed. That is the same
 * rule Spell Check's scan follows for files it couldn't read.
 *
 * Everything here is pure. index.js gathers the data (one playlist scan, the
 * index, duplicate names) and these turn it into results, so each rule is
 * testable without ProPresenter. Checks are named by id, so a church's
 * playbook can list the ones it wants (see service-playbook.js).
 */

export const CHECK_IDS = ["propresenter", "index", "typos", "past-dates", "missing-media", "arrangement-refs", "duplicate-names"];

export const CHECK_LABELS = {
  propresenter: "ProPresenter answering",
  index: "Search index covers the playlist",
  typos: "Likely typos",
  "past-dates": "Dates that have passed",
  "missing-media": "Media on this Mac",
  "arrangement-refs": "Playlist arrangements exist",
  "duplicate-names": "Presentations with a twin in another library",
};

const result = (id, status, summary, details = []) => ({ id, label: CHECK_LABELS[id] ?? id, status, summary, details: details.slice(0, 50) });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function checkPropresenter({ connected }) {
  return connected
    ? result("propresenter", "pass", "Connected.")
    : result("propresenter", "couldnt", "ProPresenter isn't answering, so the checks below that read it couldn't run.");
}

/** Every playlist presentation is in the search index, and the index isn't flagged stale. */
export function checkIndex({ items, indexedIds, staleness }) {
  const missing = (items ?? []).filter((i) => !indexedIds.has(i.id));
  if (missing.length) {
    return result("index", "attention", `${plural(missing.length, "presentation")} in the playlist aren't in the search index, so Search won't find ${missing.length === 1 ? "it" : "them"}. Refresh the index, or if ${missing.length === 1 ? "it's" : "they're"} in a library Refrain doesn't search, add that library on Health.`, missing.map((i) => ({ name: i.name })));
  }
  if (staleness?.message) return result("index", "attention", staleness.message);
  return result("index", "pass", "All in the index.");
}

/** Typos, passed dates and missing media, all from one playlist scan. */
export function checksFromScan(scan) {
  const find = (key) => {
    const details = [];
    for (const p of scan.presentations ?? []) {
      for (const s of p.slides ?? []) {
        for (const x of s[key] ?? []) {
          details.push({
            name: p.presentationName,
            slide: s.slideIndex + 1,
            text: key === "words" ? x.word : key === "pastDates" ? x.text : x.fileName,
          });
        }
      }
    }
    return details;
  };
  const typos = find("words");
  const dates = find("pastDates");
  const media = find("missingMedia");
  const out = [
    typos.length
      ? result("typos", "attention", `${plural(typos.length, "likely typo")}. Spell Check shows each on its slide.`, typos)
      : result("typos", "pass", "None found."),
    dates.length
      ? result("past-dates", "attention", `${plural(dates.length, "date")} already over, like last week's event still in the loop.`, dates)
      : result("past-dates", "pass", "None found."),
  ];
  if (media.length) {
    out.push(result("missing-media", "attention", `${plural(media.length, "file")} a slide needs isn't on this Mac.`, media));
  } else if (scan.mediaUnreadable) {
    out.push(result("missing-media", "couldnt", `Couldn't read ${plural(scan.mediaUnreadable, "presentation file")}, so their media wasn't checked.`));
  } else {
    out.push(result("missing-media", "pass", "Everything is here."));
  }
  if (scan.truncated) {
    for (const r of out) r.summary += ` (Only the first ${scan.scannedCount} items were read.)`;
  }
  return out;
}

/**
 * Issue #5: a playlist entry stores its arrangement by id, and nothing keeps
 * that in step with the presentation. When it points at an arrangement the
 * presentation doesn't have, ProPresenter silently plays something else.
 * `docs` is the presentation documents the scan already read.
 */
export function checkArrangementRefs({ items, docs }) {
  const broken = [];
  let unread = 0;
  for (const item of items ?? []) {
    if (!item.arrangementUuid) continue; // no arrangement chosen: nothing to go stale
    const doc = docs.get(item.id);
    if (!doc) {
      unread++;
      continue;
    }
    const ids = (doc.presentation?.arrangements ?? []).map((a) => a?.id?.uuid).filter(Boolean);
    if (!ids.includes(item.arrangementUuid)) {
      broken.push({ name: item.name, text: item.arrangementName ? `points at "${item.arrangementName}", which this presentation doesn't have` : "points at an arrangement this presentation doesn't have" });
    }
  }
  if (broken.length) return result("arrangement-refs", "attention", `${plural(broken.length, "entry", "entries")} will fall back to a different arrangement. Re-pick it in the playlist.`, broken);
  if (unread) return result("arrangement-refs", "couldnt", `Couldn't read ${plural(unread, "presentation")} to check.`);
  return result("arrangement-refs", "pass", "Every entry's arrangement exists.");
}

/** Playlist presentations whose name also exists in another library folder. */
export function checkDuplicateNames({ items, groups }) {
  const ids = new Set((items ?? []).map((i) => i.id));
  const hits = (groups ?? []).filter((g) => (g.entries ?? g.presentations ?? []).some((e) => ids.has(e.presentationId)));
  if (!hits.length) return result("duplicate-names", "pass", "No twins.");
  const details = hits.map((g) => {
    const entries = g.entries ?? g.presentations ?? [];
    return { name: entries[0]?.name ?? g.name, text: `also in ${[...new Set(entries.map((e) => e.folder).filter(Boolean))].join(", ")}` };
  });
  return result("duplicate-names", "attention", `${plural(hits.length, "presentation")} share a name with one in another library, so check the right one is in the playlist.`, details);
}

/** The whole list, in a fixed order, with "couldn't check" for anything that needed ProPresenter and didn't get it. */
export function evaluateChecks({ connected, performanceArmed, scan, scanError, indexedIds, staleness, groups, only = null }) {
  const out = [checkPropresenter({ connected })];
  const blocked = !connected
    ? "ProPresenter isn't answering."
    : performanceArmed
      ? "Performance mode is on, so Refrain is holding still. Run the checks before the service starts."
      : scanError
        ? `Couldn't read the playlist: ${scanError}`
        : null;
  if (blocked || !scan) {
    for (const id of ["typos", "past-dates", "missing-media", "arrangement-refs", "index", "duplicate-names"]) {
      out.push(result(id, "couldnt", blocked ?? "Not run."));
    }
  } else {
    out.push(checkIndex({ items: scan.items, indexedIds, staleness }));
    out.push(...checksFromScan(scan));
    out.push(checkArrangementRefs({ items: scan.items, docs: scan.docs }));
    out.push(checkDuplicateNames({ items: scan.items, groups }));
  }
  const order = new Map(CHECK_IDS.map((id, i) => [id, i]));
  const kept = only ? out.filter((r) => only.includes(r.id)) : out;
  return kept.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

/** "3 need a look", or "All clear", or "2 couldn't be checked". */
export function checksHeadline(results) {
  const attention = results.filter((r) => r.status === "attention").length;
  const couldnt = results.filter((r) => r.status === "couldnt").length;
  if (attention) return `${attention} need${attention === 1 ? "s" : ""} a look${couldnt ? `, ${couldnt} couldn't be checked` : ""}`;
  if (couldnt) return `${couldnt} couldn't be checked`;
  return "All clear";
}
