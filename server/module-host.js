/**
 * Generic module host — the plumbing that lets a self-contained feature
 * module under modules/<id>/ own real server-side endpoints without any
 * shared/core file importing or naming that module.
 *
 * This is the mechanism the server/index.js TODO ("mount module routes
 * discovered via plugin-loader") always pointed at. It is deliberately
 * module-agnostic: nothing here knows what "follow", "python", or any
 * specific module is. It only knows the contract below.
 *
 * ── Module backend contract ─────────────────────────────────────────
 * A module folder MAY contain a `backend.js` whose default export is:
 *
 *     export default async function createBackend(context) {
 *       return { router, async teardown() {}, getStatus() {} };
 *     }
 *
 * - `router` is an Express router mounted under /api/module/<id> (so a
 *   route it defines as "/status" answers at /api/module/<id>/status).
 * - `teardown()` must release everything the module holds — child
 *   processes, watchers, timers, devices — leaving no orphans.
 * - `context` carries { moduleId, dataDir, getConfig, module }.
 *
 * ── Laziness / kill-ability guarantees ──────────────────────────────
 * - A module's backend.js is imported ONLY the first time an enabled
 *   module is actually hit. A disabled module never loads its backend,
 *   so it costs nothing and runs no detection/watchers/timers at all.
 * - Disabling a module (or app exit) tears its backend down and drops
 *   it, so re-enabling starts clean.
 * - If a module folder is removed, discovery simply stops finding it and
 *   its routes 404 — the rest of the app is unaffected.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

const MODULES_DIR = "./modules";

/**
 * Discover module.js metadata objects. Cross-platform dynamic import
 * (file:// URL) so this works on Windows too, where importing a bare
 * "C:\..." path throws. A folder without a valid module.js is skipped
 * rather than taking down discovery.
 */
async function discoverModuleMetas() {
  const dirs = await readdir(MODULES_DIR, { withFileTypes: true }).catch(() => []);
  const metas = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const modUrl = pathToFileURL(path.resolve(MODULES_DIR, dir.name, "module.js")).href;
    try {
      const mod = await import(modUrl);
      const meta = mod.default ?? mod;
      if (meta?.id) metas.push(meta);
    } catch {
      // Invalid/absent module.js — ignore this folder.
    }
  }
  return metas;
}

async function findModuleMeta(id) {
  const metas = await discoverModuleMetas();
  return metas.find((m) => m.id === id) ?? null;
}

/**
 * @param {object} deps
 * @param {() => object} deps.getConfig  current in-memory config
 */
export function createModuleHost({ getConfig }) {
  // moduleId -> initialized backend instance ({ router, teardown, getStatus })
  const instances = new Map();

  function isEnabled(meta, config) {
    return typeof meta.isEnabled === "function" ? Boolean(meta.isEnabled(config)) : false;
  }

  function buildContext(meta) {
    return {
      moduleId: meta.id,
      // Each module gets its own JSON-on-disk area, consistent with how
      // image-crop/arrangements use ./data. Never shared between modules.
      dataDir: path.resolve("./data", meta.id),
      getConfig,
      module: meta,
    };
  }

  async function getInstance(meta) {
    const existing = instances.get(meta.id);
    if (existing) return existing;
    const backendUrl = pathToFileURL(path.resolve(MODULES_DIR, meta.id, "backend.js")).href;
    const backendMod = await import(backendUrl);
    const create = backendMod.default ?? backendMod.createBackend;
    if (typeof create !== "function") {
      throw new Error(`Module "${meta.id}" has no backend factory export.`);
    }
    const instance = await create(buildContext(meta));
    instances.set(meta.id, instance);
    return instance;
  }

  async function teardown(id) {
    const instance = instances.get(id);
    if (!instance) return;
    instances.delete(id);
    try {
      await instance.teardown?.();
    } catch (err) {
      console.error(`Module "${id}" teardown error:`, err.message);
    }
  }

  async function teardownAll() {
    await Promise.all([...instances.keys()].map((id) => teardown(id)));
  }

  /**
   * Express middleware for /api/module/:moduleId/* — gates on enablement,
   * lazily loads the backend, and delegates to its router. Never loads a
   * disabled module's backend; tears one down if it's been turned off.
   */
  async function apiDispatcher(req, res, next) {
    try {
      const id = req.params.moduleId;
      const meta = await findModuleMeta(id);
      if (!meta) return res.status(404).json({ error: `Unknown module "${id}".` });

      if (!isEnabled(meta, getConfig())) {
        // Turned off (or never on) — make sure nothing lingers, and give
        // the UI a useful reason (disabled vs. platform-unsupported).
        await teardown(id);
        const supported = typeof meta.platformSupported === "function" ? meta.platformSupported() : true;
        return res.status(409).json({
          error: supported
            ? `Module "${id}" is disabled — enable it on the Health screen first.`
            : meta.platformMessage ?? `Module "${id}" isn't supported on this platform.`,
          disabled: true,
          supported,
        });
      }

      const instance = await getInstance(meta);
      return instance.router(req, res, next);
    } catch (err) {
      // A backend that failed to load/init shouldn't crash the server.
      console.error(`Module "${req.params.moduleId}" request error:`, err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  }

  /**
   * Serves a module's front-end asset from modules/<id>/public/<file>.
   * Only that subtree is reachable — backend.js, the Python sidecar, and
   * anything else in the module folder are never served. Ids and
   * filenames are constrained so nothing can traverse out of it.
   */
  async function assetsHandler(req, res) {
    const id = String(req.params.moduleId ?? "");
    const file = String(req.params[0] ?? "");
    if (!/^[a-z0-9_-]+$/i.test(id) || !/^[a-z0-9_./-]+$/i.test(file) || file.includes("..")) {
      return res.status(400).json({ error: "Bad module asset path." });
    }
    const publicRoot = path.resolve(MODULES_DIR, id, "public");
    const filePath = path.resolve(publicRoot, file);
    if (filePath !== publicRoot && !filePath.startsWith(publicRoot + path.sep)) {
      return res.status(400).json({ error: "Bad module asset path." });
    }
    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error("not a file");
    } catch {
      return res.status(404).json({ error: "Module asset not found." });
    }
    const type = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[
      path.extname(filePath).toLowerCase()
    ];
    if (type) res.setHeader("Content-Type", `${type}; charset=utf-8`);
    createReadStream(filePath).pipe(res);
  }

  return { apiDispatcher, assetsHandler, teardown, teardownAll, discoverModuleMetas };
}
