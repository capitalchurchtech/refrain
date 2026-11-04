/**
 * The search index reads presentations from ProPresenter's own library files
 * (owner, 2026-11-04), not through its API.
 *
 * Every `GET /v1/presentation/{uuid}` makes ProPresenter load the document and
 * write to its workspace database: measured on ProPresenter 21.3, about 13 KB
 * of RocksDB write-ahead log per read, so a library-sized crawl leaves megabytes
 * of it. A crawl of two libraries preceded a bootstrap failure on the Park City
 * machine (handoff section 33). Reading the .pro file writes nothing anywhere.
 * Listing a library through the API wrote nothing (measured too), so the API
 * still says which presentations a library has, and the files say what is in
 * them.
 *
 * The answer is rebuilt in the API's own shape, so everything after it is
 * unchanged: the arrangement chosen, the flat slide numbers Go Live fires, Deep
 * Search. Measured against an index the API built (445 presentations, 27,105
 * slides): ids, slide counts, groups, offsets and arrangements all identical;
 * words identical except 2 slides whose box shows a timer, where the API gave
 * the timer's value at that moment. What it took to get there:
 *  - a box linked to the slide label reads "Slide Label", as the API reports it;
 *  - a list keeps its markers ("1.", "2."), as the API does;
 *  - right-to-left embedding marks are dropped, as the API drops them;
 *  - boxes in the file's order (front to back), one line each.
 *
 * Files are only read, and only on this computer: when ProPresenter runs on
 * another one, or the propresenter-bundle package is not installed, the index
 * reads through the API as before. Core search keeps working with nothing but
 * ProPresenter either way.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

let libLoad = null;
/** The propresenter-bundle package, or null when it is not installed (then the API is used). */
export function loadFileReader() {
  libLoad ??= import("propresenter-bundle").then((lib) => (lib.decodePresentation && lib.showsOwnLabel ? lib : null)).catch(() => null);
  return libLoad;
}

// What the API leaves out of a slide's words: the bidirectional embedding and override marks.
const EMBEDDING = /[‪-‮]/g;

/** A slide's words as ProPresenter's API reports them, from the slide's boxes. */
export function slideTextFromBoxes(lib, elements) {
  return (elements ?? [])
    .map((el) => {
      if (lib.showsOwnLabel(el)) return "Slide Label";
      const rtf = el.element?.text?.rtf_data;
      return rtf ? lib.readableText(Buffer.from(rtf).toString("latin1"), { listMarkers: true }) : "";
    })
    .filter((t) => t.trim())
    .join("\n")
    .replace(EMBEDDING, "");
}

/**
 * A decoded presentation in the shape `GET /v1/presentation/{uuid}` answers:
 * its groups (each slide in it, disabled ones included, as the API counts
 * them), its arrangements, the selected one, and the file's path.
 */
export function apiShapeFromDoc(lib, doc, filePath) {
  const cues = new Map((doc.cues ?? []).map((c) => [c.uuid?.string, c]));
  return {
    presentation: {
      id: { uuid: doc.uuid?.string ?? null, name: doc.name ?? "" },
      groups: (doc.cue_groups ?? []).map((g) => ({
        uuid: g.group?.uuid?.string ?? null,
        name: g.group?.name ?? "",
        slides: (g.cue_identifiers ?? [])
          .map((id) => cues.get(id.string))
          .filter(Boolean)
          .map((cue) => {
            const slide = (cue.actions ?? []).find((a) => a.slide);
            const els = slide?.slide?.presentation?.base_slide?.elements ?? [];
            return {
              enabled: cue.isEnabled !== false,
              text: slideTextFromBoxes(lib, els),
              // A box showing a timer, the clock or another live value: ProPresenter's text for this
              // slide changes by the second, so the Go Live check does not compare its words.
              liveWords: els.some((el) => !lib.showsOwnLabel(el) && lib.linksOf(el).some((l) => l.words)),
            };
          }),
      })),
      arrangements: (doc.arrangements ?? []).map((a) => ({ id: { uuid: a.uuid?.string ?? null, name: a.name ?? "" }, groups: (a.group_identifiers ?? []).map((g) => g.string) })),
      current_arrangement: doc.selected_arrangement?.string ?? null,
      presentation_path: filePath,
    },
  };
}

/** One file as the API would answer for it, or null when it is not a presentation this can read. */
export async function readPresentationFile(lib, filePath) {
  try {
    const { doc } = lib.decodePresentation(await readFile(filePath));
    return doc?.uuid?.string ? apiShapeFromDoc(lib, doc, filePath) : null;
  } catch {
    return null;
  }
}

/** The workspace folder a library file sits in (…/<workspace>/Libraries/<library>/x.pro), or null. */
export function workspaceOfFile(filePath) {
  const parts = path.resolve(String(filePath ?? "")).split(path.sep);
  const at = parts.lastIndexOf("Libraries");
  return at > 1 && at === parts.length - 3 ? parts.slice(0, at).join(path.sep) : null;
}

/**
 * Reads the presentations a library listing names from their files. `items` is
 * the API's listing ({ id, name, folder }); `knownPaths` is where the previous
 * index found each id (ProPresenter's own answers), which says which workspace
 * is ProPresenter's: a cloned workspace beside it holds the same ids. When there
 * is no previous path at all, `askPath` makes one API read to learn it.
 *
 * Each id is looked for at <workspace>/Libraries/<folder>/<name>.pro and its
 * id checked; failing that, the folder is read once and every file's id noted.
 * `summary()` is the per-library check: how many the API listed, how many were
 * read from files, which were not found on disk, and files on disk the API did
 * not list.
 */
export async function createFileReading({ lib, items, knownPaths = {}, askPath = async () => null }) {
  let workspace = null;
  for (const p of Object.values(knownPaths)) if ((workspace = workspaceOfFile(p))) break;
  if (!workspace && items.length) workspace = workspaceOfFile(await askPath(items[0].id).catch(() => null));
  const byId = new Map(items.map((i) => [i.id, i]));
  const byFolder = new Map();
  for (const item of items) {
    const key = item.folder ?? "";
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key).push(item);
  }
  const scans = new Map(); // folder -> Promise<Map<id, path>>
  const scan = (dir) => {
    if (!scans.has(dir)) {
      scans.set(dir, (async () => {
        const ids = new Map();
        for (const name of (await readdir(dir).catch(() => [])).filter((n) => /\.pro$/i.test(n))) {
          try {
            const { doc } = lib.decodePresentation(await readFile(path.join(dir, name)));
            if (doc?.uuid?.string) ids.set(doc.uuid.string, path.join(dir, name));
          } catch {
            /* not one this can read: left to the API */
          }
          await new Promise((r) => setImmediate(r)); // a whole folder decodes in slices, not one block
        }
        return ids;
      })());
    }
    return scans.get(dir);
  };
  const dirOf = (folder) => (workspace && folder ? path.join(workspace, "Libraries", folder) : null);
  const stats = { fromFiles: 0, notOnDisk: [] };
  const readFrom = new Map(); // id -> the file it was read from this run

  return {
    workspace,
    /** The API-shaped document for `id`, read from its file, or null (then the caller may use the API). */
    async read(id) {
      const item = byId.get(id);
      const dir = dirOf(item?.folder);
      const tries = [knownPaths[id], dir && item?.name ? path.join(dir, `${item.name}.pro`) : null].filter(Boolean);
      for (const p of tries) {
        // Only inside ProPresenter's workspace: a stale path from an old index is not followed elsewhere.
        if (workspace && !p.startsWith(workspace + path.sep)) continue;
        const doc = await readPresentationFile(lib, p);
        if (doc?.presentation?.id?.uuid === id) {
          stats.fromFiles += 1;
          readFrom.set(id, doc.presentation.presentation_path);
          return doc;
        }
      }
      if (dir) {
        const found = (await scan(dir)).get(id);
        const doc = found ? await readPresentationFile(lib, found) : null;
        if (doc?.presentation?.id?.uuid === id) {
          stats.fromFiles += 1;
          readFrom.set(id, doc.presentation.presentation_path);
          return doc;
        }
      }
      stats.notOnDisk.push(item?.name ?? id);
      return null;
    },
    /**
     * The per-library check, once the reading is done. A file is accounted for
     * when it is where a listed presentation was read from, this run or (for
     * one an incremental run carried over) the last; file names are no guide,
     * since ProPresenter's names often differ from them.
     */
    async summary() {
      const accounted = new Set();
      for (const item of items) {
        const p = readFrom.get(item.id) ?? knownPaths[item.id];
        if (p) accounted.add(path.resolve(p));
      }
      const libraries = [];
      for (const [folder, listed] of byFolder) {
        const dir = dirOf(folder);
        const onDisk = dir ? (await readdir(dir).catch(() => [])).filter((n) => /\.pro$/i.test(n)).map((n) => path.resolve(dir, n)) : [];
        libraries.push({ folder, listed: listed.length, onDisk: onDisk.length, notListed: onDisk.filter((p) => !accounted.has(p)).length });
      }
      return { workspace: workspace ? path.basename(workspace) : null, fromFiles: stats.fromFiles, notOnDisk: stats.notOnDisk.length, libraries };
    },
  };
}

/**
 * The Go Live check: the presentation as ProPresenter is playing it against the
 * same presentation read from its file, both in the arrangement ProPresenter has
 * selected. Same slide count and the same words on every slide is a match.
 * A slide whose file shows a live value (a timer) is compared by count only.
 * @returns {{ match: boolean, liveCount: number, fileCount: number, firstDifference: number | null }}
 */
export function compareWithLive({ liveSlides, fileSlides }) {
  const liveCount = liveSlides.length, fileCount = fileSlides.length;
  let firstDifference = null;
  for (let i = 0; i < Math.min(liveCount, fileCount); i++) {
    if (!fileSlides[i].liveWords && liveSlides[i].text !== fileSlides[i].text) {
      firstDifference = i;
      break;
    }
  }
  return { match: liveCount === fileCount && firstDifference === null, liveCount, fileCount, firstDifference };
}
