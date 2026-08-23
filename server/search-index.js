/**
 * Builds and holds the in-memory search index (Section 5.2), persisted
 * to cache/search-index.json with atomic writes (Section 5.2) and a
 * boot-time skip-by-default / 24h time-gated rebuild (Section 5.3).
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { normalizeText } from "./propresenter-client.js";
import { resolveArrangement, flattenGroups } from "./arrangements.js";

const CACHE_DIR = "./cache";
const CACHE_PATH = path.join(CACHE_DIR, "search-index.json");
const REBUILD_TIME_GATE_MS = 24 * 60 * 60 * 1000;
// Bumped whenever an index entry gains a field the app relies on, so an
// older cache is treated as stale and rebuilt instead of silently serving
// entries missing it. v2 added each slide's (groupId, groupOffset) anchor
// and the arrangement each presentation was indexed under.
const SCHEMA_VERSION = 2;
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
 * nothing is happening" job (see isServiceDay), so that is the right trade.
 */
const FETCH_PACING_MS = 120;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let currentIndex = { builtAt: null, presentations: {} };
let rebuildInFlight = null;
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
export async function rebuildIndex(client, syncOptions = {}, preferredArrangements = []) {
  if (rebuildInFlight) return rebuildInFlight;
  const { folders = null, crawlPlaylists = false } = syncOptions;
  const startedAt = Date.now();

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

    const idsNeedingSlides = Object.keys(presentations).filter(
      (id) => presentations[id].slides.length === 0
    );
    let fetched = 0;
    rebuildProgress = { inProgress: true, stage: "presentations", current: 0, total: idsNeedingSlides.length };
    await runWithConcurrency(idsNeedingSlides, PRESENTATION_FETCH_CONCURRENCY, async (id) => {
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
        const { createdDate, modifiedDate } = await client.getFileDates(doc?.presentation?.presentation_path);
        presentations[id].createdDate = createdDate;
        presentations[id].modifiedDate = modifiedDate;
      } catch {
        // Presentation may have been deleted since the library listing
        // was fetched, or the API call failed transiently — skip it
        // rather than aborting the whole rebuild.
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

    const newIndex = {
      schemaVersion: SCHEMA_VERSION,
      builtAt: new Date().toISOString(),
      buildDurationMs: Date.now() - startedAt,
      crawledPlaylists: crawlPlaylists,
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
    rebuildProgress = { inProgress: false, stage: null, current: 0, total: 0 };
  }
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
 * Saturday or Sunday, when a church is most likely to be setting up for or
 * running a service. A rebuild crawls the whole library and makes
 * ProPresenter sluggish for as long as it runs, so Refrain never starts one
 * by itself on these days: it waits to be asked. Local time on purpose,
 * since "is it the weekend" means the operator's weekend.
 */
export function isServiceDay(now = new Date()) {
  const day = now.getDay();
  return day === 0 || day === 6;
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
