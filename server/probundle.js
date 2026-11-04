/**
 * Bundles: open, inspect, compare and check ProPresenter files (.pro and
 * .probundle), read only. The format work is the propresenter-bundle package;
 * this is the glue: where a file may come from, the limits, and the routes.
 *
 * Rules this keeps:
 *  - File work only. Nothing here calls ProPresenter's API.
 *  - A file comes from the search index (by presentation id, never a path a
 *    caller typed) or is uploaded from the page. It is never written; the only
 *    files written are the pictures shown (slide-pictures.js), under ./data.
 *  - Never during a service: refused while performance mode is on or
 *    something is on the screens, and each read runs in a worker thread with a
 *    time limit, so the main thread (heartbeat, Go Live, phones) never waits.
 *  - The package is loaded only when this module is used. If it is missing,
 *    the module reports misconfigured; search and everything else are untouched.
 *  - Packs (a church's own templates) live in the packs folder, outside this
 *    repo. Only the default under ./data (gitignored) or a folder outside
 *    Refrain's own folder is accepted.
 */
import express from "express";
import { Worker } from "node:worker_threads";
import { readFile, readdir, stat, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { workspaceOfLibraryFile, localWorkspace, USER_WORKSPACES, pictureSource, shownCopy, pruneCache } from "./slide-pictures.js";

export const PROBUNDLE_LIMITS = {
  libraryFileBytes: 64 * 1024 * 1024, // a .pro from the library
  uploadBytes: 300 * 1024 * 1024, // a bundle carries its media
  entryBytes: 300 * 1024 * 1024,
  readMs: 30_000,
  kept: 6, // opened files kept for comparing, oldest dropped first
  keptMs: 60 * 60_000,
};

export const DEFAULT_PACKS_DIR = "./data/probundle-packs";

let packageState = null; // { ok, error }
async function packageReady() {
  if (packageState?.ok) return packageState;
  try {
    await import("propresenter-bundle");
    packageState = { ok: true, error: null };
  } catch (err) {
    packageState = { ok: false, error: `The propresenter-bundle package is not installed (${err.code ?? err.message}).` };
  }
  return packageState;
}

/** Reads, checks and draws bytes in a worker, with a time limit. */
function readInWorker(bytes, cacheDir, workspace) {
  return new Promise((resolve, reject) => {
    const copy = new Uint8Array(bytes); // its own buffer, so it can be handed over
    const worker = new Worker(new URL("./probundle-worker.js", import.meta.url), {
      workerData: { bytes: copy, maxEntryBytes: PROBUNDLE_LIMITS.entryBytes, cacheDir, workspace },
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 1024 },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`Reading the file took longer than ${PROBUNDLE_LIMITS.readMs / 1000} seconds and was stopped.`));
    }, PROBUNDLE_LIMITS.readMs);
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

/** Opened files, kept so two can be compared. In memory only; a restart forgets them. */
export function createSourceStore({ kept = PROBUNDLE_LIMITS.kept, keptMs = PROBUNDLE_LIMITS.keptMs, now = Date.now } = {}) {
  const sources = new Map();
  const prune = () => {
    for (const [id, s] of sources) if (now() - s.at > keptMs) sources.delete(id);
    while (sources.size > kept) sources.delete(sources.keys().next().value);
  };
  return {
    add(entry) {
      const id = randomUUID();
      sources.set(id, { ...entry, at: now() });
      prune();
      return id;
    },
    get(id) {
      prune();
      return typeof id === "string" ? sources.get(id) ?? null : null;
    },
    list() {
      prune();
      return [...sources].map(([id, s]) => ({ id, name: s.name, from: s.from, kind: s.kind, slideCount: s.model?.slideCount ?? 0, openedAt: new Date(s.at).toISOString() }));
    },
  };
}

/**
 * Whether a packs folder is one Refrain may use: the default under ./data
 * (gitignored), or anywhere outside Refrain's own folder. A folder elsewhere in
 * the repo could be committed with a church's templates in it.
 */
export function packsDirProblem(dir, appRoot = process.cwd()) {
  if (typeof dir !== "string" || !dir.trim()) return "Enter a folder.";
  const abs = path.resolve(appRoot, dir.trim());
  const root = path.resolve(appRoot);
  const data = path.join(root, "data");
  const inside = (p, parent) => p === parent || p.startsWith(parent + path.sep);
  if (inside(abs, root) && !inside(abs, data)) return "Packs hold a church's own templates, so they cannot live inside Refrain's folder (where they could be committed). Use a folder under ./data, or one outside Refrain.";
  return null;
}

/**
 * The routes, mounted at /api/probundle. `deps` is what index.js knows:
 * the config (live), a way to save it, the search index, and why not now.
 */
export function probundleRouter({ getConfig, updateConfig, getStatus, getProblems, getIndex, busyReason, appRoot = process.cwd(), userWorkspaces }) {
  const router = express.Router();
  const store = createSourceStore();
  // Pictures for drawn slides: a bundle's media and the small copies shown (gitignored, under ./data).
  const staging = path.resolve(appRoot, "data", "probundle-staging");
  const cacheDir = path.join(staging, "pictures");
  pruneCache(cacheDir);

  const refuseIfBusy = (res) => {
    const why = busyReason();
    if (why) {
      res.status(409).json({ error: why });
      return true;
    }
    return false;
  };

  // The workspace ProPresenter uses on this Mac, for a file opened from outside
  // it (an upload, Claude's draft): where the search index found its
  // presentations, which is ProPresenter's own answer; else the workspace
  // changed most recently.
  const thisMacWorkspace = () => {
    const root = path.resolve(userWorkspaces ?? USER_WORKSPACES);
    for (const e of Object.values(getIndex()?.presentations ?? {})) {
      const ws = e?.presentationPath ? workspaceOfLibraryFile(e.presentationPath) : null;
      if (ws && path.dirname(ws) === root) return ws;
    }
    return localWorkspace(root);
  };

  router.get("/status", async (_req, res) => {
    const pkg = await packageReady();
    const config = getConfig();
    const problems = [...getProblems(config), ...(pkg.ok ? [] : [pkg.error])];
    res.json({
      status: pkg.ok ? getStatus(config) : "misconfigured",
      problems,
      packsDir: config.probundleModule?.packsDir ?? null,
      defaultPacksDir: DEFAULT_PACKS_DIR,
      busy: busyReason(),
      opened: store.list(),
      limits: { uploadMB: PROBUNDLE_LIMITS.uploadBytes / 1024 / 1024, libraryMB: PROBUNDLE_LIMITS.libraryFileBytes / 1024 / 1024 },
    });
  });

  router.post("/config", async (req, res) => {
    const dir = req.body?.packsDir;
    const problem = packsDirProblem(dir, appRoot);
    if (problem) return res.status(400).json({ error: problem });
    const clean = dir.trim();
    try {
      await mkdir(path.resolve(appRoot, clean), { recursive: true });
    } catch (err) {
      return res.status(400).json({ error: `Couldn't make that folder: ${err.message}` });
    }
    await updateConfig((c) => ({ ...c, probundleModule: { ...c.probundleModule, packsDir: clean } }));
    res.json({ ok: true, status: getStatus(getConfig()), problems: getProblems(getConfig()) });
  });

  // Presentations Refrain has indexed, to open by name. The path comes from the index, never the page.
  router.get("/library", (req, res) => {
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const all = Object.entries(getIndex()?.presentations ?? {})
      .filter(([, e]) => e?.presentationPath)
      .map(([id, e]) => ({ id, name: e.name ?? "", folder: e.folder ?? null }))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.folder ?? "").toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ presentations: all.slice(0, 200), total: all.length });
  });

  // One file at a time: each read can hold a few hundred MB, on the machine running the service.
  let reading = false;
  async function openBytes(res, bytes, { name, from, workspace, draft = null }) {
    const pkg = await packageReady();
    if (!pkg.ok) return res.status(409).json({ error: pkg.error });
    if (reading) return res.status(429).json({ error: "Another file is being read. Try again when it has opened." });
    reading = true;
    try {
      const out = await readInWorker(bytes, cacheDir, workspace);
      if (!out.model) return res.status(422).json({ error: out.findings[0]?.message ?? "This file could not be read.", findings: out.findings });
      const sourceId = store.add({ name, from, kind: out.file.kind, model: out.model, drawn: out.drawn, pictures: out.pictures ?? [], workspace });
      res.json({ sourceId, name, from, kind: out.file.kind, media: out.file.media, model: out.model, findings: out.findings, predicted: out.predicted, drawnCount: out.drawn?.length ?? 0, ...(draft ? { draft } : {}) });
    } catch (err) {
      res.status(422).json({ error: err.message });
    } finally {
      reading = false;
    }
  }

  router.post("/open/library", async (req, res) => {
    if (refuseIfBusy(res)) return;
    const id = req.body?.presentationId;
    const entry = typeof id === "string" ? getIndex()?.presentations?.[id] : null;
    if (!entry?.presentationPath) return res.status(404).json({ error: "That presentation is not in the search index." });
    try {
      const s = await stat(entry.presentationPath);
      if (s.size > PROBUNDLE_LIMITS.libraryFileBytes) return res.status(413).json({ error: `That file is ${Math.round(s.size / 1024 / 1024)} MB, more than the ${PROBUNDLE_LIMITS.libraryFileBytes / 1024 / 1024} MB this reads.` });
      const bytes = await readFile(entry.presentationPath);
      await openBytes(res, bytes, { name: entry.name ?? path.basename(entry.presentationPath), from: entry.folder ? `Library: ${entry.folder}` : "Library", workspace: workspaceOfLibraryFile(entry.presentationPath) });
    } catch (err) {
      res.status(404).json({ error: `Couldn't read that presentation's file: ${err.code ?? err.message}` });
    }
  });

  router.post("/open/upload", express.raw({ type: "application/octet-stream", limit: PROBUNDLE_LIMITS.uploadBytes }), async (req, res) => {
    if (refuseIfBusy(res)) return;
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "No file arrived." });
    // Decoded before it is cut, so a long name in another alphabet can't be cut mid-character.
    let name = String(req.get("x-file-name") ?? "Uploaded file");
    try {
      name = decodeURIComponent(name);
    } catch {
      /* not encoded as the page sends it: shown as it arrived */
    }
    // A file from disk takes its pictures from its bundle, else from this computer's ProPresenter.
    await openBytes(res, req.body, { name: name.slice(0, 200) || "Uploaded file", from: "Uploaded", workspace: thisMacWorkspace() });
  });

  // CLAUDE'S DRAFTS: the MCP's working copies (data/probundle-staging/copies/<id>, changed in place as
  // the assistant works) and the bundles it built (data/probundle-staging/built). Named by id, never a
  // path; read only here. `version` is the file's modified time, which the page checks to redraw.
  const DRAFT_ID = /^(copy|built):([a-f0-9-]{36}|[^/\\]{1,200}\.(?:pro|probundle))$/;
  async function draftFile(id) {
    const m = DRAFT_ID.exec(String(id ?? ""));
    if (!m) return null;
    try {
      if (m[1] === "copy") {
        const dir = path.join(staging, "copies", m[2]);
        const meta = JSON.parse(await readFile(path.join(dir, "copy.json"), "utf8"));
        const file = path.join(dir, path.basename(String(meta.file ?? "")));
        if (!/\.(pro|probundle)$/i.test(file)) return null;
        const st = await stat(file);
        return { id, file, name: path.basename(file).replace(/\.(pro|probundle)$/i, ""), version: st.mtimeMs, note: meta.note ?? null, changed: meta.changed ?? meta.made ?? null, from: "Claude's working copy" };
      }
      if (m[2].startsWith(".")) return null;
      const file = path.join(staging, "built", m[2]);
      const st = await stat(file);
      return { id, file, name: m[2].replace(/\.(pro|probundle)$/i, ""), version: st.mtimeMs, note: null, changed: new Date(st.mtimeMs).toISOString(), from: "Built by Claude" };
    } catch {
      return null;
    }
  }

  router.get("/drafts", async (_req, res) => {
    const ids = [];
    for (const [kind, dir] of [["copy", "copies"], ["built", "built"]]) {
      const names = await readdir(path.join(staging, dir)).catch(() => []);
      for (const n of names) ids.push(`${kind}:${n}`);
    }
    const drafts = (await Promise.all(ids.map(draftFile))).filter(Boolean);
    drafts.sort((a, b) => b.version - a.version);
    res.json({ drafts: drafts.slice(0, 20).map(({ file: _f, ...d }) => d) });
  });

  router.get("/drafts/version", async (req, res) => {
    const d = await draftFile(req.query.id);
    if (!d) return res.status(404).json({ error: "That draft is gone." });
    res.json({ version: d.version, note: d.note, changed: d.changed });
  });

  router.post("/open/draft", async (req, res) => {
    if (refuseIfBusy(res)) return;
    const d = await draftFile(req.body?.id);
    if (!d) return res.status(404).json({ error: "That draft is gone." });
    try {
      const s = await stat(d.file);
      if (s.size > PROBUNDLE_LIMITS.uploadBytes) return res.status(413).json({ error: `That file is more than ${PROBUNDLE_LIMITS.uploadBytes / 1024 / 1024} MB.` });
      const bytes = await readFile(d.file);
      await openBytes(res, bytes, { name: d.name, from: d.from, workspace: thisMacWorkspace(), draft: { id: d.id, version: d.version, note: d.note, changed: d.changed } });
    } catch (err) {
      res.status(404).json({ error: `Couldn't read that draft: ${err.code ?? err.message}` });
    }
  });

  // DRAWN SLIDES, a few at a time as the page scrolls to them. The stylesheet and the font faces
  // come with each batch; @font-face has to go in the page itself, as a shadow root ignores it.
  router.get("/slides/:sourceId", async (req, res) => {
    const s = store.get(req.params.sourceId);
    if (!s?.drawn) return res.status(404).json({ error: "Open the file again; Refrain keeps the last few for an hour." });
    const from = Math.max(0, Number.parseInt(req.query.from, 10) || 0);
    const count = Math.min(48, Math.max(1, Number.parseInt(req.query.count, 10) || 24));
    const lib = await import("propresenter-bundle");
    const slides = s.drawn.slice(from, from + count).map((d, i) => ({
      n: from + i + 1, id: d.id, group: d.group, label: d.label, enabled: d.enabled, notes: d.notes, width: d.width,
      html: d.html.replaceAll("/api/probundle/picture/__SRC__/", `/api/probundle/picture/${encodeURIComponent(req.params.sourceId)}/`),
    }));
    res.json({ total: s.drawn.length, from, slides, css: lib.DRAW_CSS, fontCss: lib.fontFaces(s.drawn.slice(from, from + count).flatMap((d) => d.fonts)) });
  });

  // A picture a drawn slide shows, by its number in that file. Small copies are made once and kept.
  router.get("/picture/:sourceId/:n", async (req, res) => {
    if (refuseIfBusy(res)) return;
    const s = store.get(req.params.sourceId);
    const pic = s?.pictures?.[Number.parseInt(req.params.n, 10)];
    const src = pic ? pictureSource(pic, { cacheDir, workspace: s.workspace }) : null;
    if (!src) return res.status(404).end();
    try {
      const shown = await shownCopy(src, cacheDir);
      if (!shown) return res.status(404).end();
      res.set("Cache-Control", "private, max-age=3600").type(shown.type).sendFile(shown.file);
    } catch {
      res.status(404).end();
    }
  });

  router.post("/diff", async (req, res) => {
    const a = store.get(req.body?.before), b = store.get(req.body?.after);
    if (!a || !b) return res.status(404).json({ error: "Open both files again; Refrain keeps the last few for an hour." });
    const lib = await import("propresenter-bundle");
    res.json({ before: { name: a.name, from: a.from }, after: { name: b.name, from: b.from }, diff: lib.diffModels(a.model, b.model) });
  });

  router.get("/opened", (_req, res) => res.json({ opened: store.list() }));

  // Errors from the body parser (a file over the limit) as JSON the page can show.
  router.use((err, _req, res, _next) => {
    if (err?.type === "entity.too.large") return res.status(413).json({ error: `That file is more than ${PROBUNDLE_LIMITS.uploadBytes / 1024 / 1024} MB.` });
    res.status(400).json({ error: err?.message ?? "Bad request" });
  });

  return router;
}
