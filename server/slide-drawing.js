/**
 * Desktop previews drawn from the presentation's own file (owner, 2026-11-04),
 * not asked of ProPresenter. A ProPresenter thumbnail writes about 30 KB into
 * its workspace database (handoff section 33); reading the .pro writes nothing.
 * Quality Control's flagged slides and Live's safe-slide keys use this; a slide
 * it cannot draw falls back to the thumbnail route, then to its words.
 *
 * A whole file is drawn at once, in a worker (the main thread runs the
 * heartbeat, Go Live and the phones), and kept in memory by the file's version,
 * so the next slide from the same file is a lookup. Slides are numbered as
 * ProPresenter numbers its pictures and Go Live: through the arrangement it has
 * selected. The drawing is the propresenter-bundle package's; without the
 * package nothing is drawn and the screens use thumbnails as before.
 */
import { Worker } from "node:worker_threads";
import { pictureSource } from "./slide-pictures.js";

const DRAW_MS = 30_000;
const KEPT = 30; // files kept drawn, the least recently used dropped first

/**
 * The cue ids of a decoded presentation in the order ProPresenter plays them:
 * the selected arrangement's groups, else every group in order. The same
 * numbering resolveArrangement(doc, []) and flattenGroups give the API's answer.
 */
export function playedCueIds(doc) {
  const groups = new Map((doc?.cue_groups ?? []).map((g) => [g.group?.uuid?.string, g]));
  const selected = (doc?.arrangements ?? []).find((a) => a.uuid?.string && a.uuid.string === doc?.selected_arrangement?.string);
  const order = selected ? (selected.group_identifiers ?? []).map((id) => groups.get(id.string)).filter(Boolean) : doc?.cue_groups ?? [];
  const cues = new Set((doc?.cues ?? []).map((c) => c.uuid?.string));
  return order.flatMap((g) => (g.cue_identifiers ?? []).map((id) => id.string).filter((id) => cues.has(id)));
}

/** Draws one library file in a worker, with a time limit. */
function drawInWorker({ file, pid, version }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./slide-drawing-worker.js", import.meta.url), {
      workerData: { file, pid, version },
      resourceLimits: { maxOldGenerationSizeMb: 1024 },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Drawing took too long."));
    }, DRAW_MS);
    worker.once("message", (m) => {
      clearTimeout(timer);
      worker.terminate();
      if (m.ok) resolve(m);
      else reject(new Error(m.error));
    });
    worker.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Drawn files, kept in memory. `slide()` answers one slide by its played
 * number; `picture()` the file a drawn slide's numbered picture is read from.
 * One file is drawn at a time; a second ask for the same version waits on the
 * first.
 */
export function createSlideDrawing({ draw = drawInWorker, kept = KEPT } = {}) {
  const files = new Map(); // pid -> { version, byId, order, pictures, workspace }
  const drawing = new Map(); // `${pid}\0${version}` -> Promise
  let queue = Promise.resolve();

  const remember = (pid, entry) => {
    files.delete(pid);
    files.set(pid, entry);
    while (files.size > kept) files.delete(files.keys().next().value);
  };

  async function fileOf(pid, file, version, drawNew) {
    const have = files.get(pid);
    if (have?.version === version) {
      remember(pid, have);
      return have;
    }
    if (!drawNew) return null;
    const key = `${pid}\0${version}`;
    if (!drawing.has(key)) {
      const run = queue.then(async () => {
        const m = await draw({ file, pid, version });
        const entry = { version, order: m.order, byId: new Map(m.drawn.map((d) => [d.id, d])), pictures: m.pictures, workspace: m.workspace };
        remember(pid, entry);
        return entry;
      });
      queue = run.catch(() => {});
      drawing.set(key, run.finally(() => drawing.delete(key)));
    }
    return drawing.get(key).catch(() => null);
  }

  return {
    /**
     * Slide `idx` (0-based, as played) of presentation `pid`, drawn from
     * `file` at `version`: { html, fonts, width, height }, or null. With
     * `drawNew` false only a drawing already made is answered.
     */
    async slide(pid, file, version, idx, { drawNew = true } = {}) {
      if (!file || !version || !Number.isInteger(idx) || idx < 0) return null;
      const f = await fileOf(pid, file, version, drawNew);
      const d = f ? f.byId.get(f.order[idx]) : null;
      return d ? { html: d.html, fonts: d.fonts, width: d.width, height: d.height } : null;
    },
    /** The file picture `n` of a drawn presentation is read from (inside its workspace), or null. */
    picture(pid, n) {
      const f = files.get(pid);
      const pic = f?.pictures?.[n];
      return pic ? pictureSource({ ...pic, cached: null }, { workspace: f.workspace }) : null;
    },
  };
}
