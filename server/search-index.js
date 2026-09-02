/**
 * Builds and holds the in-memory search index (Section 5.2), persisted
 * to cache/search-index.json with atomic writes (Section 5.2) and a
 * boot-time skip-by-default / 24h time-gated rebuild (Section 5.3).
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { normalizeText } from "./propresenter-client.js";
import { resolveArrangement, flattenGroups } from "./arrangements.js";
import {
  readFingerprint,
  readFingerprintUnchangedSince,
  carriedEntryFields,
  planIncremental,
  fingerprintTargets,
} from "./index-fingerprint.js";

const CACHE_DIR = "./cache";
const CACHE_PATH = path.join(CACHE_DIR, "search-index.json");
const REBUILD_TIME_GATE_MS = 24 * 60 * 60 * 1000;
// Bumped whenever an index entry gains a field the app relies on, so an
// older cache is treated as stale and rebuilt instead of silently serving
// entries missing it. v2 added each slide's (groupId, groupOffset) anchor
// and the arrangement each presentation was indexed under. v3 added each
// presentation's file path and fingerprint, which is what lets a later rebuild
// re-read only the presentations whose file actually changed.
const SCHEMA_VERSION = 3;
const PRESENTATION_FETCH_CONCURRENCY = 1;
/**
 * Pause between presentation fetches during a rebuild.
 *
 * A rebuild used to be a tight loop of hundreds of back-to-back API calls.
 * Measured against a real ProPresenter 21.3: under that load its response
 * times went from 0.2s to nearly 6s and it stopped answering slide triggers
 * altogether. ProPresenter is a live production tool, and Refrain is a guest
 * on its API, so the crawl now paces itself rather than taking everything the
 * API will give. Rebuilds get slower; they are already a "do this when
 * nothing is happening" job — see performance-mode.js, which stops Refrain
 * starting one while anything is on the screens — so that is the right trade.
 */
const FETCH_PACING_MS = 120;

/**
 * Consecutive read failures before the crawl gives up on ProPresenter.
 *
 * A rebuild started too soon after ProPresenter launches has been measured
 * failing **221 of 445 reads** — and the old loop asked all 221 times anyway,
 * politely, 120ms apart, for four minutes. Once a run of reads is failing, the
 * app is busy indexing its own media and the useful thing to do is stop asking
 * and say so.
 *
 * Ten rather than two or three: a single slow document, or one deleted between
 * the library listing and the read, is ordinary and must not abandon a rebuild
 * the operator asked for. Ten in a row is not one bad document.
 */
const CRAWL_ABORT_AFTER_CONSECUTIVE_FAILURES = 10;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let currentIndex = { builtAt: null, presentations: {} };
let rebuildInFlight = null;
// Which kind of run is in flight, so a later caller can tell whether joining it
// would actually satisfy them. See the guard in rebuildIndex.
let rebuildInFlightMode = null;
// Set when a crawl gave up because ProPresenter stopped answering, so the
// Health screen can say the index is partial instead of implying a clean run.
let rebuildAbortedInfo = null;
let rebuildProgress = { inProgress: false, stage: null, current: 0, total: 0 };

export function getIndex() {
  return currentIndex;
}

export function getRebuildProgress() {
  return rebuildProgress;
}

/**
 * The ordered group-name sequence for a presentation (the arrangement-drift
 * module's "actual"), as recorded at index-build time from the arrangement
 * that was resolved then.
 */
export function getGroupSequence(presentationId) {
  return currentIndex.presentations[presentationId]?.groupSequence ?? null;
}

/** Presentation name lookup, for screens that only have a presentationId. */
export function getPresentationName(presentationId) {
  return currentIndex.presentations[presentationId]?.name ?? null;
}

export async function loadIndexFromDisk() {
  try {
    const raw = await readFile(CACHE_PATH, "utf-8");
    currentIndex = JSON.parse(raw);
    return currentIndex;
  } catch {
    return null;
  }
}

async function persistIndex(index) {
  await mkdir(CACHE_DIR, { recursive: true });
  const tmpPath = `${CACHE_PATH}.tmp`;
  await writeFile(tmpPath, JSON.stringify(index, null, 2));
  await rename(tmpPath, CACHE_PATH);
}

/**
 * Crawls the Library (+ optionally all playlists), dedupes by presentation
 * uuid, builds a fresh index, then atomically swaps it in.
 *
 * @param {{ folders?: string[]|null, crawlPlaylists?: boolean }} syncOptions
 *   - folders: limit the Library crawl to these folder names (null = all).
 *     A large church library can be slow to crawl in full; see config.json's
 *     librarySync.folders.
 *   - crawlPlaylists: whether to also crawl every playlist for "which
 *     playlist(s) is this in" metadata. This is the slowest and most
 *     failure-prone part of a rebuild on some ProPresenter installs — off
 *     by default. Search still covers every presentation in the synced
 *     folders either way.
 */
export async function rebuildIndex(client, syncOptions = {}, preferredArrangements = [], options = {}) {
  // Joining an in-flight run is only sound when it does at least as much work
  // as the caller asked for. A full rebuild is a superset of an incremental
  // one, so an incremental caller can wait on it. The reverse would report
  // success for a full rebuild that never re-read anything.
  if (rebuildInFlight) {
    if (options.incremental || rebuildInFlightMode === "full") return rebuildInFlight;
    throw new Error("A reindex is already running. Wait for it to finish, then start a full rebuild.");
  }
  const { folders = null, crawlPlaylists = false } = syncOptions;
  const { incremental = false } = options;
  rebuildInFlightMode = incremental ? "incremental" : "full";
  const startedAt = Date.now();
  // Captured before anything is fetched: currentIndex is only replaced at the
  // very end, but read it once so the failure fallback below cannot be
  // confused by a concurrent swap.
  const previousPresentations = currentIndex?.presentations ?? {};
  const buildOptions = { preferredArrangements, crawlPlaylists };

  rebuildProgress = { inProgress: true, stage: "library", current: 0, total: 0 };

  rebuildInFlight = (async () => {
    const presentations = {};

    console.log(`Fetching library${folders ? ` (folders: ${folders.join(", ")})` : ""}...`);
    const library = await client.getLibrary(folders);
    console.log(`Library: ${library?.length ?? 0} presentations found.`);
    for (const item of library ?? []) {
      const id = item.id;
      if (!id) continue;
      presentations[id] = {
        name: item.name ?? "Untitled",
        folder: item.folder ?? null,
        slides: [],
        appearsIn: [],
        createdDate: null,
        modifiedDate: null,
      };
    }

    if (crawlPlaylists) {
      console.log("Fetching playlist tree...");
      const playlists = await client.getPlaylists();
      const playlistIds = collectPlaylistIds(playlists);
      console.log(`Playlist tree: ${playlistIds.length} playlists found. Crawling items...`);
      let playlistsFetched = 0;
      let playlistFailures = 0;
      rebuildProgress = { inProgress: true, stage: "playlists", current: 0, total: playlistIds.length };
      await runWithConcurrency(playlistIds, PRESENTATION_FETCH_CONCURRENCY, async (pid) => {
        const { items } = await client.getPlaylistItems(pid).catch((err) => {
          playlistFailures += 1;
          console.log(`  playlist ${pid} failed/timed out: ${err.message}`);
          return { items: [] };
        });
        for (const item of items) {
          const presId = item.id;
          if (!presId) continue;
          if (!presentations[presId]) {
            presentations[presId] = {
              name: item.name ?? "Untitled",
              slides: [],
              appearsIn: [],
              createdDate: null,
              modifiedDate: null,
            };
          }
          if (!presentations[presId].appearsIn.includes(pid)) {
            presentations[presId].appearsIn.push(pid);
          }
        }
        playlistsFetched += 1;
        rebuildProgress.current = playlistsFetched;
        if (playlistsFetched % 100 === 0 || playlistsFetched === playlistIds.length) {
          console.log(`Crawling playlists... ${playlistsFetched}/${playlistIds.length}`);
        }
        await pause(FETCH_PACING_MS);
      });
      if (playlistFailures > 0) {
        console.log(`${playlistFailures} playlist(s) failed/timed out and were skipped.`);
      }
    }

    // Work out what actually has to be re-read. Everything else keeps the
    // slides the previous build already paid for.
    const skeletonIds = Object.keys(presentations).filter((id) => presentations[id].slides.length === 0);
    let plan = { mode: "full" };
    let carriedFingerprints = {};
    if (incremental) {
      if (!client.isLocalHost) {
        plan = { mode: "full", reason: "ProPresenter is on another machine, so its files cannot be checked" };
      } else {
        rebuildProgress = { inProgress: true, stage: "checking files", current: 0, total: skeletonIds.length };
        const targets = fingerprintTargets({ ids: skeletonIds, previous: currentIndex });
        const fingerprints = {};
        // Local disk and ~88KB a file: the whole library fingerprints in well
        // under a second, so this runs unpaced, unlike the API crawl below.
        await Promise.all(
          targets.map(async ({ id, path: filePath }) => {
            fingerprints[id] = await readFingerprint(filePath);
          })
        );
        carriedFingerprints = fingerprints;
        plan = planIncremental({
          ids: skeletonIds,
          previous: currentIndex,
          fingerprints,
          buildOptions,
          schemaVersion: SCHEMA_VERSION,
        });
      }
    }

    let idsNeedingSlides = skeletonIds;
    if (plan.mode === "incremental") {
      for (const [id, carried] of Object.entries(plan.carryOver)) {
        Object.assign(presentations[id], carried);
      }
      idsNeedingSlides = plan.needFetch;
      const { carriedOver, changed, added, unverifiable } = plan.counts;
      console.log(
        `Incremental reindex: ${carriedOver} unchanged, ${changed} changed, ${added} new, ` +
          `${unverifiable} unverifiable. Re-reading ${idsNeedingSlides.length} of ${skeletonIds.length}.`
      );
    } else if (incremental) {
      console.log(`Full rebuild instead of incremental: ${plan.reason}.`);
    }

    let fetched = 0;
    let failedButKept = 0;
    let failedAndEmpty = 0;
    let consecutiveFailures = 0;
    let crawlAborted = null;
    rebuildProgress = { inProgress: true, stage: "presentations", current: 0, total: idsNeedingSlides.length };
    await runWithConcurrency(idsNeedingSlides, PRESENTATION_FETCH_CONCURRENCY, async (id) => {
      // Once ProPresenter has stopped answering, stop asking. Remaining
      // presentations keep whatever the previous index had for them.
      if (crawlAborted) {
        const prev = previousPresentations[id];
        if (prev?.slides?.length) Object.assign(presentations[id], carriedEntryFields(prev));
        return;
      }
      // Used to tell "the file is as we read it" from "the operator saved it
      // while we were reading it" for presentations we had no prior path for.
      const fetchStartedAt = Date.now();
      try {
        const doc = await client.getPresentation(id);
        // Record which arrangement produced these indices, so the UI can show
        // it and the trigger path can tell when the live one has since changed.
        const resolved = resolveArrangement(doc, preferredArrangements);
        presentations[id].slides = flattenGroups(resolved.groups);
        presentations[id].groupSequence = resolved.groups.map((g) => g.name ?? "Untitled");
        presentations[id].arrangementName = resolved.arrangementName;
        presentations[id].arrangementId = resolved.arrangementId;
        presentations[id].arrangementSource = resolved.source;
        const presentationPath = doc?.presentation?.presentation_path ?? null;
        const { createdDate, modifiedDate } = await client.getFileDates(presentationPath);
        presentations[id].createdDate = createdDate;
        presentations[id].modifiedDate = modifiedDate;
        presentations[id].presentationPath = presentationPath;
        // Prefer the fingerprint taken BEFORE this fetch, when we had one.
        // If the operator saves this presentation while we are reading it,
        // the pre-fetch fingerprint describes older content than the slides
        // we just indexed, so the next reindex re-reads it. Fingerprinting
        // afterwards would do the opposite and leave stale slides looking
        // current.
        presentations[id].fingerprint =
          carriedFingerprints[id] ??
          (client.isLocalHost ? await readFingerprintUnchangedSince(presentationPath, fetchStartedAt) : null);
        consecutiveFailures = 0;
      } catch {
        // The presentation may have been deleted since the library listing was
        // fetched, or the call may have failed transiently.
        //
        // If we already had slides for it, keep them rather than leaving the
        // entry empty: a timeout on one song during a reindex would otherwise
        // drop that song out of search entirely, which looks exactly like the
        // lyrics having been deleted. The previous entry's fingerprint comes
        // back with it, so the next reindex sees the mismatch and retries.
        const prev = previousPresentations[id];
        if (prev?.slides?.length) {
          Object.assign(presentations[id], carriedEntryFields(prev));
          failedButKept += 1;
        } else {
          failedAndEmpty += 1;
        }
        consecutiveFailures += 1;
        if (consecutiveFailures >= CRAWL_ABORT_AFTER_CONSECUTIVE_FAILURES) {
          crawlAborted = {
            after: fetched + 1,
            of: idsNeedingSlides.length,
            consecutiveFailures,
          };
          console.log(
            `Stopped indexing after ${consecutiveFailures} reads in a row failed — ProPresenter is not keeping up. ` +
              `Kept the previous index for the remaining ${idsNeedingSlides.length - fetched - 1} presentation(s). ` +
              `Give it a few minutes after launch and try again.`
          );
        }
      }
      fetched += 1;
      rebuildProgress.current = fetched;
      // Breathe between documents so ProPresenter stays responsive to the
      // operator while this runs.
      await pause(FETCH_PACING_MS);
      if (fetched % 50 === 0 || fetched === idsNeedingSlides.length) {
        console.log(`Indexing... ${fetched}/${idsNeedingSlides.length} presentations`);
      }
    });

    if (failedButKept > 0) {
      console.log(`${failedButKept} presentation(s) could not be re-read — kept the slides from the previous index.`);
    }
    if (failedAndEmpty > 0) {
      console.log(`${failedAndEmpty} presentation(s) could not be read and have no slides indexed.`);
    }
    if (crawlAborted) {
      // Surfaced on the index status so the Health screen can say the index is
      // partial, rather than reporting a clean build over a third of a library.
      rebuildAbortedInfo = crawlAborted;
    } else {
      rebuildAbortedInfo = null;
    }

    const newIndex = {
      schemaVersion: SCHEMA_VERSION,
      builtAt: new Date().toISOString(),
      buildDurationMs: Date.now() - startedAt,
      crawledPlaylists: crawlPlaylists,
      // Recorded so the next incremental run can tell whether the settings
      // that decide what an entry CONTAINS have changed since this build.
      buildOptions,
      buildMode: plan.mode,
      // Only a full rebuild refreshes this. builtAt moves on every incremental
      // run, so it cannot answer "when did we last read the whole library".
      lastFullBuildAt:
        plan.mode === "full"
          ? new Date().toISOString()
          : (currentIndex?.lastFullBuildAt ?? currentIndex?.builtAt ?? null),
      reindexCounts: plan.counts ?? null,
      presentations,
    };
    currentIndex = newIndex;
    await persistIndex(newIndex);
    return newIndex;
  })();

  try {
    return await rebuildInFlight;
  } finally {
    rebuildInFlight = null;
    rebuildInFlightMode = null;
    rebuildProgress = { inProgress: false, stage: null, current: 0, total: 0 };
  }
}

/**
 * Works out what a reindex would have to re-read, without re-reading anything.
 *
 * The whole point of automatic reindexing is that deciding is cheap and acting
 * is not: on a real library this costs three API calls plus 445 local file
 * hashes, about 80ms, while acting costs ~135ms per changed presentation. The
 * watcher checks first and only acts when the answer is small.
 *
 * Deliberately skips the playlist crawl even when it is enabled — this is a
 * decision aid, and the crawl is the expensive part. That under-reports
 * playlist-only presentations, which is the safe direction: it can only make
 * the planner act on fewer presentations, never more.
 */
export async function planReindex(client, syncOptions = {}, preferredArrangements = []) {
  const { folders = null, crawlPlaylists = false } = syncOptions;
  if (!client.isLocalHost) {
    return { mode: "full", reason: "ProPresenter is on another machine, so its files cannot be checked" };
  }
  const library = await client.getLibrary(folders);
  const ids = [...new Set((library ?? []).map((item) => item.id).filter(Boolean))];
  const targets = fingerprintTargets({ ids, previous: currentIndex });
  const fingerprints = {};
  await Promise.all(
    targets.map(async ({ id, path: filePath }) => {
      fingerprints[id] = await readFingerprint(filePath);
    })
  );
  return planIncremental({
    ids,
    previous: currentIndex,
    fingerprints,
    buildOptions: { preferredArrangements, crawlPlaylists },
    schemaVersion: SCHEMA_VERSION,
  });
}

/**
 * What the index knows about one slide, for the live readout: the names an
 * operator would recognise rather than the uuids the API deals in.
 */
export function getIndexedSlide(presentationId, slideIndex) {
  const entry = currentIndex?.presentations?.[presentationId];
  if (!entry) return null;
  const slide = entry.slides?.find((s) => s.index === slideIndex) ?? null;
  return {
    presentationName: entry.name ?? null,
    arrangementName: entry.arrangementName ?? null,
    folder: entry.folder ?? null,
    text: slide?.text ?? null,
    slideCount: entry.slides?.length ?? null,
  };
}

/** Every distinct folder the indexed presentations live in. */
export function getIndexedLibraryDirs() {
  const dirs = new Set();
  for (const entry of Object.values(currentIndex?.presentations ?? {})) {
    if (entry.presentationPath) dirs.add(path.dirname(entry.presentationPath));
  }
  return [...dirs];
}

/**
 * Set when the last crawl gave up because ProPresenter stopped answering.
 *
 * Exposed so the Health screen can say the index is partial. Reporting a clean
 * build over a third of a library is the silent-failure shape this project has
 * been removing everywhere else.
 */
export function lastCrawlAbort() {
  return rebuildAbortedInfo;
}

/** Days since the whole library was last read, or null if never/unknown. */
export function daysSinceFullBuild(index = currentIndex, now = Date.now()) {
  const stamp = index?.lastFullBuildAt ?? index?.builtAt;
  if (!stamp) return null;
  const ms = now - new Date(stamp).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

async function runWithConcurrency(items, limit, worker) {
  let cursor = 0;
  async function runNext() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
}

/**
 * Flattens the /v1/playlists tree ({field_type: "playlist"|"group",
 * children}) down to just the leaf playlist uuids — a synchronous walk,
 * so the actual per-playlist item fetches can run with bounded concurrency.
 */
function collectPlaylistIds(node, ids = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectPlaylistIds(child, ids);
    return ids;
  }
  if (!node || typeof node !== "object") return ids;

  if (node.field_type === "playlist" && node.id?.uuid) {
    ids.push(node.id.uuid);
  }
  for (const child of node.children ?? []) {
    collectPlaylistIds(child, ids);
  }
  return ids;
}

/**
 * The flat slide list for a presentation, with each slide's durable anchor.
 * Arrangement selection and flattening live in arrangements.js, since the
 * trigger path needs the same resolution at click time.
 */
export function extractSlides(presentationDoc, preferredArrangements = []) {
  return flattenGroups(resolveArrangement(presentationDoc, preferredArrangements).groups);
}

/** Distinct Library folder names actually present in the built index — always matches what's really searchable, even if config.json's sync scope changed since the last rebuild. */
export function getIndexedFolders() {
  const folders = new Set();
  for (const entry of Object.values(currentIndex.presentations)) {
    if (entry.folder) folders.add(entry.folder);
  }
  return [...folders].sort();
}

/**
 * Distinct arrangement names seen in the built index, so the Health screen can
 * offer the church's real arrangement names ("FS", "T", ...) to choose from
 * instead of asking an admin to type labels blind.
 */
export function getIndexedArrangementNames() {
  const names = new Set();
  for (const entry of Object.values(currentIndex.presentations)) {
    if (entry.arrangementName) names.add(entry.arrangementName);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Whether the loaded index carries per-slide anchors.
 *
 * An older-schema cache still loads and still searches, so nothing looks
 * wrong -- but its slides have no (groupId, groupOffset), which is the
 * primary anchor `resolveTriggerIndex` uses to re-find a slide when
 * ProPresenter is on a different arrangement than the index was built from.
 * Correction degrades to matching on slide text, and text matching picks the
 * candidate nearest the *stored* index, so a repeated chorus in a re-lengthened
 * arrangement can resolve to the wrong repetition.
 *
 * That is a quiet accuracy loss on the live path, and the operator could not
 * see it: `schemaVersion` was not surfaced anywhere. It is now, because a
 * degradation nobody can observe is one nobody will fix.
 */
export function anchorsAvailable(index = currentIndex) {
  return index?.schemaVersion === SCHEMA_VERSION;
}

/**
 * The accuracy notice for a stale-schema index, or null.
 *
 * Deliberately worded about what Go Live will do, not about a version number.
 * "Schema 2 of 3" is true and useless; an operator needs to know the slide
 * they click might not be the slide that fires, and that reindexing fixes it.
 * Same remedy as the staleness notice, so it shares the Refresh button.
 */
export function indexAccuracyNotice(index = currentIndex) {
  if (!index?.builtAt) return null;
  if (anchorsAvailable(index)) return null;
  return {
    reason: "schema",
    message:
      "Index was built by an older version and is missing slide anchors, " +
      "so Go Live may fire the wrong slide when a song's arrangement has changed. Refresh.",
  };
}

export function shouldAutoRebuild(index) {
  if (!index?.builtAt) return true;
  // An older-schema cache still loads and still searches — slides just lack
  // their anchor, so Go Live degrades to the old behavior — but rebuild it in
  // the background so the anchors come back without blocking boot.
  if (index.schemaVersion !== SCHEMA_VERSION) return true;
  const age = Date.now() - new Date(index.builtAt).getTime();
  return age > REBUILD_TIME_GATE_MS;
}

/**
 * Case-insensitive substring search across all slide text, optionally
 * narrowed by a created/modified date range (Section 5.1). `dateField`
 * picks which timestamp to filter on — both are real filesystem dates
 * (see propresenter-client.js's getFileDates), so unlike the doc's
 * original "unverified" concern, this isn't a fallback/proxy: a
 * presentation with no resolvable date (e.g. crawled from a remote
 * reader machine) is excluded whenever a date filter is active, since
 * there's nothing to honestly compare against.
 * An empty query with a date range set is a valid "what did we use in
 * this timeframe" browse mode — every slide in range matches, since an
 * empty string is a substring of anything.
 * `folders`, when given, narrows results to presentations synced from
 * one of those Library folders — only useful once a church has more
 * than one folder in its sync scope (config.json's librarySync.folders).
 * @param {{ query: string, playlistId?: string, dateField?: "created"|"modified", dateFrom?: string, dateTo?: string, folders?: string[] }} opts
 */
export function search({ query, playlistId, dateField, dateFrom, dateTo, folders }) {
  const q = normalizeText(query).toLowerCase();
  const fromTime = dateFrom ? new Date(dateFrom).getTime() : null;
  const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
  if (!q && !fromTime && !toTime) return [];

  const dateKey = dateField === "created" ? "createdDate" : "modifiedDate";
  const folderSet = folders && folders.length > 0 ? new Set(folders) : null;

  const results = [];
  for (const [presentationId, entry] of Object.entries(currentIndex.presentations)) {
    if (playlistId && !entry.appearsIn.includes(playlistId)) continue;
    if (folderSet && !folderSet.has(entry.folder)) continue;

    if (fromTime || toTime) {
      const entryTime = entry[dateKey] ? new Date(entry[dateKey]).getTime() : null;
      if (entryTime === null) continue;
      if (fromTime && entryTime < fromTime) continue;
      if (toTime && entryTime > toTime) continue;
    }

    // An arrangement that repeats a group repeats its slides in the flat
    // index too (one song's chorus can occupy eight positions), so collapse
    // identical lyrics within a presentation to the earliest occurrence and
    // report how many times it recurs, rather than listing the same line over
    // and over. The anchor kept is the earliest one, so Go Live still lands on
    // the first time that line is sung.
    const seen = new Map();
    for (const slide of entry.slides) {
      if (!slide.text.toLowerCase().includes(q)) continue;
      const key = slide.text.toLowerCase();
      const already = seen.get(key);
      if (already) {
        already.repeatCount += 1;
        if (slide.index < already.slideIndex) {
          already.slideIndex = slide.index;
          already.groupId = slide.groupId ?? null;
          already.groupOffset = slide.groupOffset ?? null;
        }
        continue;
      }
      const result = {
        presentationId,
        presentationName: entry.name,
        slideIndex: slide.index,
        snippet: slide.text,
        groupId: slide.groupId ?? null,
        groupOffset: slide.groupOffset ?? null,
        arrangementName: entry.arrangementName ?? null,
        repeatCount: 1,
        appearsIn: entry.appearsIn,
        createdDate: entry.createdDate,
        modifiedDate: entry.modifiedDate,
      };
      seen.set(key, result);
      results.push(result);
    }
  }
  return results;
}
