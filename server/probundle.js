/**
 * Bundles: open, inspect, compare and check ProPresenter files (.pro and
 * .probundle), read only. The format work is the propresenter-bundle package;
 * this is the glue: where a file may come from, the limits, and the routes.
 *
 * Rules this keeps:
 *  - File work only. Nothing here calls ProPresenter's API.
 *  - A file comes from the search index (by presentation id, never a path a
 *    caller typed) or is uploaded from the page. Nothing is written.
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
import { readFile, stat, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

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

/** Reads and checks bytes in a worker, with a time limit. */
function readInWorker(bytes) {
  return new Promise((resolve, reject) => {
    const copy = new Uint8Array(bytes); // its own buffer, so it can be handed over
    const worker = new Worker(new URL("./probundle-worker.js", import.meta.url), {
      workerData: { bytes: copy, maxEntryBytes: PROBUNDLE_LIMITS.entryBytes },
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
export function probundleRouter({ getConfig, updateConfig, getStatus, getProblems, getIndex, busyReason, appRoot = process.cwd() }) {
  const router = express.Router();
  const store = createSourceStore();

  const refuseIfBusy = (res) => {
    const why = busyReason();
    if (why) {
      res.status(409).json({ error: why });
      return true;
    }
    return false;
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
  async function openBytes(res, bytes, { name, from }) {
    const pkg = await packageReady();
    if (!pkg.ok) return res.status(409).json({ error: pkg.error });
    if (reading) return res.status(429).json({ error: "Another file is being read. Try again when it has opened." });
    reading = true;
    try {
      const out = await readInWorker(bytes);
      if (!out.model) return res.status(422).json({ error: out.findings[0]?.message ?? "This file could not be read.", findings: out.findings });
      const sourceId = store.add({ name, from, kind: out.file.kind, model: out.model });
      res.json({ sourceId, name, from, kind: out.file.kind, media: out.file.media, model: out.model, findings: out.findings, predicted: out.predicted });
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
      await openBytes(res, bytes, { name: entry.name ?? path.basename(entry.presentationPath), from: entry.folder ? `Library: ${entry.folder}` : "Library" });
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
    await openBytes(res, req.body, { name: name.slice(0, 200) || "Uploaded file", from: "Uploaded" });
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
