/**
 * Builds and holds the in-memory search index (Section 5.2), persisted
 * to cache/search-index.json with atomic writes (Section 5.2) and a
 * boot-time skip-by-default / 24h time-gated rebuild (Section 5.3).
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { normalizeText } from "./propresenter-client.js";

const CACHE_DIR = "./cache";
const CACHE_PATH = path.join(CACHE_DIR, "search-index.json");
const REBUILD_TIME_GATE_MS = 24 * 60 * 60 * 1000;
const PRESENTATION_FETCH_CONCURRENCY = 1;

let currentIndex = { builtAt: null, presentations: {} };
let rebuildInFlight = null;
let rebuildProgress = { inProgress: false, stage: null, current: 0, total: 0 };

export function getIndex() {
  return currentIndex;
}

export function getRebuildProgress() {
  return rebuildProgress;
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
export async function rebuildIndex(client, syncOptions = {}) {
  if (rebuildInFlight) return rebuildInFlight;
  const { folders = null, crawlPlaylists = false } = syncOptions;

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
        presentations[id].slides = extractSlides(doc);
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
      if (fetched % 50 === 0 || fetched === idsNeedingSlides.length) {
        console.log(`Indexing... ${fetched}/${idsNeedingSlides.length} presentations`);
      }
    });

    const newIndex = { builtAt: new Date().toISOString(), presentations };
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
 * ProPresenter's flat trigger index is 0-based across every slide, walked
 * in the order of the presentation's *active arrangement* — not raw
 * document order. An arrangement's group list can reorder groups and
 * repeat the same group multiple times (verse/chorus/repeat structures),
 * and each repeat contributes its slides again to the flat index. Only
 * presentations with no arrangement selected (current_arrangement === "")
 * fall back to raw groups in document order. Verified empirically against
 * a real presentation on 2026-07-07 — a naive raw-document-order index
 * was off for any presentation with an arrangement selected.
 */
function extractSlides(presentationDoc) {
  const presentation = presentationDoc?.presentation ?? {};
  const rawGroups = presentation.groups ?? [];
  const groupsByUuid = new Map(rawGroups.map((g) => [g.uuid, g]));

  const activeArrangement = (presentation.arrangements ?? []).find(
    (a) => a.id?.uuid === presentation.current_arrangement
  );
  const orderedGroups = activeArrangement
    ? activeArrangement.groups.map((uuid) => groupsByUuid.get(uuid)).filter(Boolean)
    : rawGroups;

  const slides = [];
  let index = 0;
  for (const group of orderedGroups) {
    for (const slide of group.slides ?? []) {
      slides.push({ index, text: normalizeText(slide.text) });
      index += 1;
    }
  }
  return slides;
}

export function shouldAutoRebuild(index) {
  if (!index?.builtAt) return true;
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
 * @param {{ query: string, playlistId?: string, dateField?: "created"|"modified", dateFrom?: string, dateTo?: string }} opts
 */
export function search({ query, playlistId, dateField, dateFrom, dateTo }) {
  const q = normalizeText(query).toLowerCase();
  if (!q) return [];

  const fromTime = dateFrom ? new Date(dateFrom).getTime() : null;
  const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
  const dateKey = dateField === "created" ? "createdDate" : "modifiedDate";

  const results = [];
  for (const [presentationId, entry] of Object.entries(currentIndex.presentations)) {
    if (playlistId && !entry.appearsIn.includes(playlistId)) continue;

    if (fromTime || toTime) {
      const entryTime = entry[dateKey] ? new Date(entry[dateKey]).getTime() : null;
      if (entryTime === null) continue;
      if (fromTime && entryTime < fromTime) continue;
      if (toTime && entryTime > toTime) continue;
    }

    for (const slide of entry.slides) {
      if (slide.text.toLowerCase().includes(q)) {
        results.push({
          presentationId,
          presentationName: entry.name,
          slideIndex: slide.index,
          snippet: slide.text,
          appearsIn: entry.appearsIn,
          createdDate: entry.createdDate,
          modifiedDate: entry.modifiedDate,
        });
      }
    }
  }
  return results;
}
