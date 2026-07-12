/**
 * Refrain server entrypoint.
 *
 * See docs/refrain-architecture.md Section 16 for build order —
 * Step 0 is verifying ProPresenter API capabilities against your
 * actual installed version before relying on anything below.
 */
import { readFileSync, existsSync } from "node:fs";
import { copyFile, readdir, mkdir } from "node:fs/promises";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { platform, homedir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
import express from "express";
import {
  loadConfig,
  saveConfig,
  configFileExists,
  isConfigComplete,
  getArrangementModuleStatus,
  getImageCropModuleStatus,
  getEnvRequirements,
  ensureMachineId,
  readConfigFileRaw,
} from "./config.js";
import { ProPresenterClient } from "./propresenter-client.js";
import { scanForProPresenter } from "./propresenter-scan.js";
import {
  loadIndexFromDisk,
  rebuildIndex,
  shouldAutoRebuild,
  search,
  getIndex,
  getRebuildProgress,
  getGroupSequence,
  getPresentationName,
  getIndexedFolders,
} from "./search-index.js";
import { discoverModules, discoverSlideSplitters, discoverProviders, discoverStorageBackends } from "./plugin-loader.js";
import { runComparison, suggestMapping, getPendingUploadCount, retryPendingUploads } from "./arrangement-diff.js";
import { startWatcher as startImageCropWatcher, getImageCropStatus, foldersOverlap, websafeToken } from "./image-crop.js";
import { generateQr, getQrHistoryList, getQrHistoryEntry, addQrHistoryEntry, clearQrHistory, QR_LIMITS } from "./qr-code.js";
import { normalizeSongTitle } from "../providers/planning-center.js";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

/**
 * Candidate lyrics sites a church can pick from for the Lyrics-assist
 * screen's scoped search — capped at 5 selections (config.json's
 * lyricsSites) since a long `site:a OR site:b OR ...` clause makes the
 * scoped Google search increasingly unreliable.
 */
const LYRICS_SITE_CANDIDATES = [
  "genius.com",
  "azlyrics.com",
  "lyrics.com",
  "musixmatch.com",
  "youtube.com",
  "praisecharts.com",
  "worshiptogether.com",
  "hymnary.org",
  "letssingit.com",
  "songlyrics.com",
];
const MAX_LYRICS_SITES = 5;

/**
 * Accepts either a bare Planning Center ID ("574087") or a full URL
 * copy-pasted straight from the browser (e.g.
 * "https://services.planningcenteronline.com/service_types/574087") —
 * church admins are far more likely to have the page open than to know
 * the ID is the trailing number, so pull it out either way. Works for
 * any PCO resource URL (service types, plans, ...) since they all end
 * in the numeric id.
 */
function extractPcoId(input) {
  const trimmed = String(input ?? "").trim();
  const match = trimmed.match(/(\d+)\/?$/);
  return match ? match[1] : trimmed;
}

// Defense in depth: an async route handler that throws without its own
// try/catch produces an unhandled rejection, which crashes the whole
// process by default on modern Node — taking down an in-progress index
// rebuild along with it (observed directly: a transient error while
// polling plugin discovery mid-rebuild killed the server outright).
// Every route below should still catch its own errors; this is only a
// last-resort net so a missed one degrades to a logged error instead of
// an outage.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (server stayed up):", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (server stayed up):", err);
});

const app = express();
let config = loadConfig();
let client = new ProPresenterClient(config.propresenter);

app.use(express.static("public"));
app.use(express.json());

// TODO: mount module *routes* discovered via plugin-loader.js, per
// docs/refrain-architecture.md Section 17.11, once a module has real
// server-side endpoints of its own (arrangement, lyrics-assist).

// --- Nav (Section 13) — driven by registered modules, not hardcoded ---

app.get("/api/modules", async (_req, res) => {
  const modules = await discoverModules();
  res.json({
    modules: modules.map((m) => ({
      id: m.id,
      navLabel: m.navLabel,
      icon: m.icon,
      route: m.route,
      // "enabled" here means "show in the nav," not "the feature is running."
      // The arrangement module is gated (hidden until configured, per its
      // three-state status) because it needs real setup — credentials, a
      // storage backend, a role. Image-crop needs none of that: it's a
      // self-contained local utility with its own on/off toggle on its own
      // screen, so it's always navigable (you flip it on from inside),
      // matching how Search/Lyrics are always present.
      enabled: m.id === "arrangement" ? getArrangementModuleStatus(config) !== "off" : m.enabledByDefault,
    })),
  });
});

const GITHUB_REPO_URL = "https://github.com/capitalchurchtech/refrain";
const GITHUB_PACKAGE_JSON_URL = "https://raw.githubusercontent.com/capitalchurchtech/refrain/main/package.json";

/** True if `a` (e.g. "0.2.0") is a newer semver than `b` (e.g. "0.1.0"). */
function isNewerVersion(a, b) {
  const partsA = String(a).split(".").map(Number);
  const partsB = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/**
 * Checks the project's own public GitHub repo for a newer package.json
 * version than the one running locally — not tied to a formal GitHub
 * Release (the project doesn't cut those consistently yet), just
 * whatever's on the main branch. A single unauthenticated GET to
 * GitHub's own infrastructure, not a project-controlled server — no
 * request identifies this install or its church in any way, consistent
 * with the "no phone-home" privacy commitment in the README.
 */
app.get("/api/version-check", async (_req, res) => {
  try {
    const ghRes = await fetch(GITHUB_PACKAGE_JSON_URL, { signal: AbortSignal.timeout(5000) });
    if (!ghRes.ok) throw new Error(`GitHub responded ${ghRes.status}`);
    const { version: latestVersion } = await ghRes.json();
    res.json({
      currentVersion: version,
      latestVersion,
      updateAvailable: isNewerVersion(latestVersion, version),
      repoUrl: GITHUB_REPO_URL,
      gitInstall: existsSync(".git"),
    });
  } catch (err) {
    res.json({
      currentVersion: version,
      latestVersion: null,
      updateAvailable: false,
      repoUrl: GITHUB_REPO_URL,
      gitInstall: existsSync(".git"),
      error: err.message,
    });
  }
});

/**
 * One-click update for Git installs: fast-forward pull plus npm install.
 * Doesn't restart the server (the caller tells the user to relaunch, or
 * the background service picks it up on its next restart). ZIP installs
 * have no .git and are told to use the ZIP re-download flow instead.
 */
app.post("/api/update", async (_req, res) => {
  if (!existsSync(".git")) {
    return res.status(409).json({
      error: "This copy of Refrain wasn't set up with Git, so it can't update itself. Download the latest ZIP from GitHub instead (see the README's Updating section).",
    });
  }
  try {
    const pull = await execFileAsync("git", ["pull", "--ff-only"], { timeout: 120000 });
    const install = await execFileAsync("npm", ["install"], { timeout: 300000 });
    const output = [pull.stdout, pull.stderr, install.stdout, install.stderr].filter(Boolean).join("\n").trim();
    res.json({ ok: true, output });
  } catch (err) {
    // git/npm failures put the useful message on stderr.
    res.status(500).json({ error: (err.stderr || err.message || "Update failed").trim() });
  }
});

app.get("/api/preferences", (_req, res) => {
  res.json({ theme: config.theme ?? "system", navPinned: Boolean(config.navPinned) });
});

app.post("/api/preferences", async (req, res) => {
  const { theme, navPinned } = req.body ?? {};
  const newConfig = { ...config };
  if (theme !== undefined) newConfig.theme = theme;
  if (navPinned !== undefined) newConfig.navPinned = Boolean(navPinned);

  try {
    await saveConfig(newConfig);
  } catch (err) {
    return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
  }
  config = newConfig;
  res.json({ ok: true });
});

app.get("/api/config-options", async (_req, res) => {
  try {
    const [splitters, providers, backends] = await Promise.all([
      discoverSlideSplitters(),
      discoverProviders(),
      discoverStorageBackends(),
    ]);
    res.json({
      slideSplitters: splitters.map((S) => S.splitterId),
      // {id, displayName} pairs, not raw ids — so the UI never has to
      // hardcode a friendly label per known vendor (Section 17.2/17.3).
      providers: providers.map((P) => ({ id: P.providerId, displayName: P.displayName })),
      storageBackends: backends.map((B) => ({ id: B.backendId, displayName: B.displayName })),
      lyricsSiteCandidates: LYRICS_SITE_CANDIDATES,
      maxLyricsSites: MAX_LYRICS_SITES,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to list plugin options: ${err.message}` });
  }
});

// Byte-for-byte config.json download — offered right before "Save
// Configuration" on Health, so there's always a one-click way back to
// the exact prior state if a change turns out to be wrong.
app.get("/api/config/export", (_req, res) => {
  const raw = readConfigFileRaw();
  if (raw === null) return res.status(404).json({ error: "config.json doesn't exist yet." });
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="refrain-config-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(raw);
});

/**
 * Edits the subset of config.json that's safe to expose as constrained
 * UI controls (enums validated against real plugin ids, numeric ranges,
 * required strings) — everything else (lyricsSites, machineId, the
 * folder-scope settings with their own dedicated endpoints) stays
 * config.json-file-only so a stray edit here can't corrupt something
 * more free-form.
 */
app.post("/api/config", async (req, res) => {
  try {
    const body = req.body ?? {};
    const newConfig = {
      ...config,
      propresenter: { ...config.propresenter },
      librarySync: { ...config.librarySync },
      arrangementModule: { ...config.arrangementModule },
      qrCodeModule: { ...config.qrCodeModule },
    };

    if (body.role !== undefined) {
      if (!["reader", "logger"].includes(body.role)) {
        return res.status(400).json({ error: "role must be \"reader\" or \"logger\"" });
      }
      newConfig.role = body.role;
    }

    const changingConnection =
      (body.propresenterHost !== undefined && String(body.propresenterHost).trim() !== config.propresenter.host) ||
      (body.propresenterPort !== undefined && Number(body.propresenterPort) !== config.propresenter.port);
    if (changingConnection && getRebuildProgress().inProgress) {
      return res.status(409).json({
        error: "Can't change the ProPresenter connection while an index rebuild is running — wait for it to finish first.",
      });
    }

    if (body.propresenterHost !== undefined) {
      const host = String(body.propresenterHost).trim();
      if (!host) return res.status(400).json({ error: "ProPresenter host can't be empty" });
      newConfig.propresenter.host = host;
    }

    if (body.propresenterPort !== undefined) {
      const port = Number(body.propresenterPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return res.status(400).json({ error: "ProPresenter port must be a whole number between 1 and 65535" });
      }
      newConfig.propresenter.port = port;
    }

    if (body.crawlPlaylists !== undefined) {
      newConfig.librarySync.crawlPlaylists = Boolean(body.crawlPlaylists);
    }

    if (body.slideSplitter !== undefined) {
      const splitters = await discoverSlideSplitters();
      if (!splitters.some((S) => S.splitterId === body.slideSplitter)) {
        return res.status(400).json({ error: `Unknown slide splitter "${body.slideSplitter}"` });
      }
      newConfig.slideSplitter = body.slideSplitter;
    }

    if (body.arrangementEnabled !== undefined) {
      newConfig.arrangementModule.enabled = Boolean(body.arrangementEnabled);
    }

    if (body.arrangementProvider !== undefined) {
      const providers = await discoverProviders();
      if (!providers.some((P) => P.providerId === body.arrangementProvider)) {
        return res.status(400).json({ error: `Unknown provider "${body.arrangementProvider}"` });
      }
      newConfig.arrangementModule.provider = body.arrangementProvider;
    }

    if (body.arrangementStorageBackend !== undefined) {
      const backends = await discoverStorageBackends();
      if (!backends.some((B) => B.backendId === body.arrangementStorageBackend)) {
        return res.status(400).json({ error: `Unknown storage backend "${body.arrangementStorageBackend}"` });
      }
      newConfig.arrangementModule.storageBackend = body.arrangementStorageBackend;
    }

    if (body.arrangementLocalFolderPath !== undefined) {
      if (typeof body.arrangementLocalFolderPath !== "string") {
        return res.status(400).json({ error: "arrangementLocalFolderPath must be a string" });
      }
      newConfig.arrangementModule.localFolderPath = body.arrangementLocalFolderPath.trim() || null;
    }

    if (body.planningCenterServiceTypeId !== undefined) {
      if (typeof body.planningCenterServiceTypeId !== "string") {
        return res.status(400).json({ error: "planningCenterServiceTypeId must be a string" });
      }
      const id = extractPcoId(body.planningCenterServiceTypeId);
      newConfig.arrangementModule.planningCenterServiceTypeId = id || null;
    }

    if (body.lyricsSites !== undefined) {
      if (!Array.isArray(body.lyricsSites) || body.lyricsSites.length === 0) {
        return res.status(400).json({ error: "Pick at least one lyrics site" });
      }
      if (body.lyricsSites.length > MAX_LYRICS_SITES) {
        return res.status(400).json({ error: `Pick at most ${MAX_LYRICS_SITES} lyrics sites` });
      }
      if (!body.lyricsSites.every((site) => LYRICS_SITE_CANDIDATES.includes(site))) {
        return res.status(400).json({ error: "Unknown lyrics site in selection" });
      }
      newConfig.lyricsSites = body.lyricsSites;
    }

    if (body.qrDefaultBaseUrl !== undefined) {
      if (typeof body.qrDefaultBaseUrl !== "string") {
        return res.status(400).json({ error: "qrDefaultBaseUrl must be a string" });
      }
      newConfig.qrCodeModule.defaultBaseUrl = body.qrDefaultBaseUrl.trim() || null;
    }

    if (body.qrDefaultLogoUrl !== undefined) {
      if (typeof body.qrDefaultLogoUrl !== "string") {
        return res.status(400).json({ error: "qrDefaultLogoUrl must be a string" });
      }
      newConfig.qrCodeModule.defaultLogoUrl = body.qrDefaultLogoUrl.trim() || null;
    }

    if (body.qrRecentLimit !== undefined) {
      const n = Number(body.qrRecentLimit);
      if (!Number.isInteger(n) || n < 0 || n > QR_MAX_RECENT_LIMIT) {
        return res.status(400).json({ error: `qrRecentLimit must be a whole number from 0 to ${QR_MAX_RECENT_LIMIT}` });
      }
      newConfig.qrCodeModule.recentLimit = n;
    }

    if (body.qrDefaultSize !== undefined) {
      // Blank clears it (back to the built-in default). Otherwise it must be
      // a pixel size within the generator's allowed range.
      if (body.qrDefaultSize === "" || body.qrDefaultSize === null) {
        newConfig.qrCodeModule.defaultSize = null;
      } else {
        const n = Number(body.qrDefaultSize);
        if (!Number.isInteger(n) || n < QR_LIMITS.minSize || n > QR_LIMITS.maxSize) {
          return res.status(400).json({ error: `qrDefaultSize must be a whole number from ${QR_LIMITS.minSize} to ${QR_LIMITS.maxSize}` });
        }
        newConfig.qrCodeModule.defaultSize = n;
      }
    }

    try {
      await saveConfig(newConfig);
    } catch (err) {
      return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
    }
    config = newConfig;
    if (changingConnection) client = new ProPresenterClient(config.propresenter);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to update configuration: ${err.message}` });
  }
});

const ENV_PATH = "./.env";
const ENV_EXAMPLE_PATH = "./.env.example";

/**
 * Opens .env in the user's default text editor — it's a dotfile, so
 * Finder/Explorer hide it by default and a first-time user can easily
 * not realize it exists at all. Creates it from .env.example first if
 * it's missing, so there's always something to open. macOS-only for
 * now (`open -t`, LaunchServices' "open with default text editor"
 * flag); other platforms get a clear message instead of a silent
 * failure since this whole app assumes a local, single-admin machine.
 */
app.post("/api/env/open", async (_req, res) => {
  try {
    if (!existsSync(ENV_PATH)) {
      if (!existsSync(ENV_EXAMPLE_PATH)) {
        return res.status(404).json({ error: ".env.example not found — can't create a starting .env." });
      }
      try {
        await copyFile(ENV_EXAMPLE_PATH, ENV_PATH);
      } catch (err) {
        return res.status(500).json({ error: `Failed to create .env: ${err.message}` });
      }
    }

    if (platform() !== "darwin") {
      return res.status(501).json({
        error: "Opening .env automatically is only supported on macOS right now — open it manually from the project's root folder.",
      });
    }

    exec(`open -t ${ENV_PATH}`, (err) => {
      if (err) return res.status(500).json({ error: `Failed to open .env: ${err.message}` });
      res.json({ ok: true });
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to open .env: ${err.message}` });
  }
});

/**
 * Auto-detect common Google Drive/Dropbox/OneDrive desktop-sync mount
 * points (Section 17.3's setup helper) — a one-click default instead of
 * asking a non-technical volunteer to type an exact path. Deliberately
 * just filesystem checks against well-known locations, no API/OAuth.
 */
async function detectSyncedFolderCandidates() {
  const home = homedir();
  const candidates = [];

  if (platform() === "darwin") {
    const cloudStorageDir = path.join(home, "Library", "CloudStorage");
    const entries = await readdir(cloudStorageDir).catch(() => []);
    for (const entry of entries) {
      if (entry.startsWith("GoogleDrive-")) {
        candidates.push({ label: `Google Drive (${entry.replace("GoogleDrive-", "")})`, path: path.join(cloudStorageDir, entry, "My Drive") });
      } else if (entry.startsWith("Dropbox")) {
        candidates.push({ label: "Dropbox", path: path.join(cloudStorageDir, entry) });
      } else if (entry.startsWith("OneDrive")) {
        candidates.push({ label: "OneDrive", path: path.join(cloudStorageDir, entry) });
      }
    }
    candidates.push({ label: "Dropbox", path: path.join(home, "Dropbox") });
  } else if (platform() === "win32") {
    for (const drive of ["G", "H"]) {
      candidates.push({ label: "Google Drive", path: `${drive}:\\My Drive` });
    }
    candidates.push({ label: "OneDrive", path: path.join(home, "OneDrive") });
    candidates.push({ label: "Dropbox", path: path.join(home, "Dropbox") });
  }

  const checked = await Promise.all(
    candidates.map(async (c) => ({ ...c, exists: existsSync(c.path) }))
  );
  return checked.filter((c) => c.exists);
}

app.get("/api/arrangement/detect-storage-paths", async (_req, res) => {
  try {
    const candidates = await detectSyncedFolderCandidates();
    res.json({ candidates });
  } catch (err) {
    res.status(500).json({ error: `Failed to scan for synced folders: ${err.message}` });
  }
});

function indexStatusPayload() {
  const index = getIndex();
  return {
    builtAt: index.builtAt,
    buildDurationMs: index.buildDurationMs ?? null,
    crawledPlaylists: Boolean(index.crawledPlaylists),
    presentationCount: Object.keys(index.presentations).length,
    rebuild: getRebuildProgress(),
  };
}

app.get("/api/propresenter/status", async (_req, res) => {
  try {
    await client.testConnection();
    res.json({
      connected: true,
      host: config.propresenter.host,
      port: config.propresenter.port,
      lastCheckIn: new Date().toISOString(),
    });
  } catch (err) {
    res.json({
      connected: false,
      host: config.propresenter.host,
      port: config.propresenter.port,
      error: err.message,
    });
  }
});

app.get("/api/index/status", (_req, res) => {
  res.json(indexStatusPayload());
});

app.get("/api/library-folders", async (_req, res) => {
  try {
    const folders = await client.getLibraryFolders();
    res.json({
      folders: (folders ?? []).map((f) => f.name),
      selected: config.librarySync?.folders ?? null, // null = every folder synced
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/library-folders", async (req, res) => {
  const { folders } = req.body ?? {};
  if (folders !== null && !Array.isArray(folders)) {
    return res.status(400).json({ error: "folders must be an array of names, or null for all" });
  }

  const newConfig = { ...config, librarySync: { ...config.librarySync, folders } };
  try {
    await saveConfig(newConfig);
  } catch (err) {
    return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
  }
  config = newConfig;
  res.json({ ok: true });

  // The sync scope changed — reindex to match, same as a first-run
  // build (Section 5.3). The caller polls /api/index/status for
  // progress rather than this request staying open for what could be
  // a slow full-library crawl.
  rebuildIndex(client, config.librarySync).catch((err) => {
    console.error("Library-scope rebuild failed:", err.message);
  });
});

app.post("/api/index/rebuild", async (_req, res) => {
  try {
    const index = await rebuildIndex(client, config.librarySync);
    res.json({ builtAt: index.builtAt, presentationCount: Object.keys(index.presentations).length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/search", (req, res) => {
  const { q, playlistId, dateField, dateFrom, dateTo, folders } = req.query;
  const folderList = Array.isArray(folders) ? folders : folders ? String(folders).split(",") : undefined;
  res.json({ results: search({ query: q ?? "", playlistId, dateField, dateFrom, dateTo, folders: folderList }) });
});

app.get("/api/search/folders", (_req, res) => {
  res.json({ folders: getIndexedFolders() });
});

app.post("/api/trigger", async (req, res) => {
  const { presentationId, slideIndex } = req.body ?? {};
  if (!presentationId || slideIndex === undefined) {
    return res.status(400).json({ error: "presentationId and slideIndex are required" });
  }
  try {
    await client.triggerSlide(presentationId, slideIndex);
    await client.focusPresentation(presentationId).catch(() => {
      // Focusing the editor is a nice-to-have; the trigger already
      // succeeded and put the right thing live, so don't fail the
      // request over this.
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/focus", async (req, res) => {
  const { presentationId } = req.body ?? {};
  if (!presentationId) {
    return res.status(400).json({ error: "presentationId is required" });
  }
  try {
    await client.focusPresentation(presentationId);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- Lyrics search-assist (Section 14) ---
//
// The app never fetches or parses lyrics sites or search results itself
// — that's a permanent boundary (ToS), not a placeholder for a future
// scraper. This only ever hands back a search URL for the browser to
// open, and splits text the user pastes in themselves.

app.get("/api/lyrics-assist/config", (_req, res) => {
  res.json({
    lyricsSites: config.lyricsSites ?? [],
    defaultSplitterId: config.slideSplitter ?? "blank-line-delimited",
  });
});

app.get("/api/slide-splitters", async (_req, res) => {
  const splitters = await discoverSlideSplitters();
  res.json({ splitters: splitters.map((S) => ({ id: S.splitterId })) });
});

app.post("/api/lyrics-assist/split", async (req, res) => {
  const { text, splitterId } = req.body ?? {};
  if (!text) return res.status(400).json({ error: "text is required" });

  const splitters = await discoverSlideSplitters();
  const Splitter = splitters.find((S) => S.splitterId === splitterId) ?? splitters[0];
  if (!Splitter) return res.status(500).json({ error: "No slide splitters available" });

  const slides = new Splitter().split(text);
  res.json({ slides, splitterId: Splitter.splitterId });
});

// --- Arrangement drift-tracking module (Section 8) ---
//
// Only wired up for the manual provider + local-folder storage pairing
// so far (Build Order Step 7's first half) — planning-center.js and
// sftp.js remain the documented "Not Implemented" stubs until their own
// pass. Instances are built fresh per request via the same
// auto-discovery plugin-loader.js already uses for slide-splitters, so
// a community-contributed provider/backend just needs providerId /
// backendId to match config.json, per CONTRIBUTING.md.

async function getStorageBackendClass() {
  const backends = await discoverStorageBackends();
  const backendId = config.arrangementModule?.storageBackend ?? "local-folder";
  const Backend = backends.find((B) => B.backendId === backendId);
  if (!Backend) throw new Error(`Unknown storage backend "${backendId}"`);
  return Backend;
}

async function getStorageBackendDisplayName() {
  return (await getStorageBackendClass().catch(() => null))?.displayName ?? null;
}

async function getArrangementProviderDisplayName() {
  return (await getArrangementProviderClass().catch(() => null))?.displayName ?? null;
}

async function getStorageBackend() {
  const Backend = await getStorageBackendClass();
  const backendId = Backend.backendId;

  if (backendId === "local-folder" || backendId === "synced-folder") {
    return new Backend({ dirPath: config.arrangementModule?.localFolderPath ?? "./data/arrangements" });
  }
  if (backendId === "firestore") {
    return new Backend({
      projectId: process.env.FIRESTORE_PROJECT_ID,
      serviceAccountKeyPath: process.env.FIRESTORE_SERVICE_ACCOUNT_KEY_PATH,
      role: config.role,
    });
  }
  if (backendId === "sftp") {
    return new Backend({
      host: process.env.SFTP_HOST,
      username: process.env.SFTP_USERNAME,
      privateKeyPath: process.env.SFTP_PRIVATE_KEY_PATH,
      knownHostFingerprint: process.env.SFTP_KNOWN_HOST_FINGERPRINT,
    });
  }
  return new Backend();
}

/** The configured provider's class (not an instance) — cheap, no credentials needed, for capability checks. */
async function getArrangementProviderClass() {
  const providers = await discoverProviders();
  const providerId = config.arrangementModule?.provider ?? "manual";
  const Provider = providers.find((P) => P.providerId === providerId);
  if (!Provider) throw new Error(`Unknown arrangement provider "${providerId}"`);
  return Provider;
}

async function getArrangementProvider(storage) {
  const Provider = await getArrangementProviderClass();
  if (Provider.providerId === "planning-center") {
    return new Provider({
      appId: process.env.PLANNING_CENTER_APP_ID,
      secret: process.env.PLANNING_CENTER_SECRET,
      serviceTypeId: config.arrangementModule?.planningCenterServiceTypeId ?? null,
    });
  }
  return new Provider({ storage });
}

/** Gates a route on a provider capability (e.g. "supportsPlanBrowsing") rather than a hardcoded vendor name. */
async function requireProviderCapability(res, capability, featureLabel) {
  const Provider = await getArrangementProviderClass();
  if (!Provider[capability]) {
    res.status(409).json({
      error: `${featureLabel} needs a church-management provider that supports it (e.g. Planning Center) — the configured provider, ${Provider.displayName}, doesn't.`,
    });
    return null;
  }
  return Provider;
}

function requireArrangementActive(res) {
  const status = getArrangementModuleStatus(config);
  if (status !== "active") {
    res.status(409).json({ error: `Arrangement module is ${status}, not active` });
    return false;
  }
  return true;
}

app.get("/api/arrangement/status", async (_req, res) => {
  const providerId = config.arrangementModule?.provider ?? null;
  const Provider = providerId ? (await discoverProviders()).find((P) => P.providerId === providerId) : null;
  res.json({
    status: getArrangementModuleStatus(config),
    role: config.role ?? null,
    provider: providerId,
    // The UI reads these instead of hardcoding a vendor name/behavior,
    // so it never assumes Planning Center is the only possible
    // church-management integration (Section 17.2).
    providerDisplayName: Provider?.displayName ?? null,
    providerSupportsPush: Provider?.supportsPush ?? false,
    providerSupportsPlanBrowsing: Provider?.supportsPlanBrowsing ?? false,
    storageBackend: config.arrangementModule?.storageBackend ?? null,
    pendingUploads: await getPendingUploadCount(),
  });
});

/**
 * Which Library folders count as "songs" for drift-tracking — separate
 * from librarySync.folders (what's searchable). A church might want
 * sermons searchable without tracking their "arrangement" as if they
 * were songs. null = every folder currently searched, same as before
 * this setting existed.
 */
/**
 * Every ProPresenter Library folder (not just currently-indexed ones —
 * a church should be able to pick their song folder for drift-tracking
 * independent of whatever's currently in the search scope, e.g. right
 * after first setup before they've touched Library Sync at all).
 */
app.get("/api/arrangement/folders", async (_req, res) => {
  try {
    const folders = await client.getLibraryFolders();
    res.json({
      folders: (folders ?? []).map((f) => f.name),
      selected: config.arrangementModule?.folders ?? null,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/arrangement/folders", async (req, res) => {
  try {
    const { folders } = req.body ?? {};
    if (folders !== null && !Array.isArray(folders)) {
      return res.status(400).json({ error: "folders must be an array of names, or null for all" });
    }

    const newConfig = { ...config, arrangementModule: { ...config.arrangementModule, folders } };
    try {
      await saveConfig(newConfig);
    } catch (err) {
      return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
    }
    config = newConfig;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to update arrangement folders: ${err.message}` });
  }
});

/** Every presentation in the search index whose Library folder is in scope for drift-tracking (arrangementModule.folders — a subset of librarySync.folders, since only searchable presentations are indexed at all). */
app.get("/api/arrangement/songs", async (_req, res) => {
  if (!requireArrangementActive(res)) return;
  try {
    const storage = await getStorageBackend();
    const index = getIndex();
    const trackedFolders = config.arrangementModule?.folders ?? null;

    const songs = await Promise.all(
      Object.entries(index.presentations)
        .filter(([, entry]) => !trackedFolders || trackedFolders.includes(entry.folder))
        .map(async ([presentationId, entry]) => {
          const record = await storage.readSongFile(presentationId).catch(() => null);
          return {
            presentationId,
            name: entry.name,
            hasPlannedArrangement: Boolean(record?.manualPlannedArrangement?.length),
            historyCount: record?.history?.length ?? 0,
            lastServiceDate: record?.history?.at(-1)?.serviceDate ?? null,
          };
        })
    );
    res.json({ songs });
  } catch (err) {
    res.status(500).json({ error: `Failed to list songs: ${err.message}` });
  }
});

app.get("/api/arrangement/song/:presentationId", async (req, res) => {
  if (!requireArrangementActive(res)) return;
  const { presentationId } = req.params;
  const groupSequence = getGroupSequence(presentationId);
  if (!groupSequence) return res.status(404).json({ error: "Presentation not found in search index" });

  const storage = await getStorageBackend();
  const record = (await storage.readSongFile(presentationId)) ?? {
    songId: presentationId,
    songName: getPresentationName(presentationId),
    propresenterPresentationId: presentationId,
    sectionMapping: suggestMapping(groupSequence),
    manualPlannedArrangement: [],
    history: [],
  };
  res.json({ ...record, groupSequence });
});

app.post("/api/arrangement/song/:presentationId/mapping", async (req, res) => {
  if (!requireArrangementActive(res)) return;
  const { presentationId } = req.params;
  const { sectionMapping } = req.body ?? {};
  if (!sectionMapping) return res.status(400).json({ error: "sectionMapping is required" });

  const storage = await getStorageBackend();
  const groupSequence = getGroupSequence(presentationId) ?? [];
  const existing = (await storage.readSongFile(presentationId)) ?? {
    songId: presentationId,
    songName: getPresentationName(presentationId),
    propresenterPresentationId: presentationId,
    sectionMapping: suggestMapping(groupSequence),
    manualPlannedArrangement: [],
    history: [],
  };
  const updated = { ...existing, sectionMapping };
  await storage.writeSongFile(presentationId, updated);
  res.json({ ok: true });
});

app.post("/api/arrangement/song/:presentationId/planned", async (req, res) => {
  if (!requireArrangementActive(res)) return;
  const { presentationId } = req.params;
  const { manualPlannedArrangement } = req.body ?? {};
  if (!Array.isArray(manualPlannedArrangement)) {
    return res.status(400).json({ error: "manualPlannedArrangement must be an array" });
  }

  const storage = await getStorageBackend();
  const groupSequence = getGroupSequence(presentationId) ?? [];
  const existing = (await storage.readSongFile(presentationId)) ?? {
    songId: presentationId,
    songName: getPresentationName(presentationId),
    propresenterPresentationId: presentationId,
    sectionMapping: suggestMapping(groupSequence),
    manualPlannedArrangement: [],
    history: [],
  };
  const updated = { ...existing, manualPlannedArrangement };
  await storage.writeSongFile(presentationId, updated);
  res.json({ ok: true });
});

/**
 * Some songs (medleys, songs PCO structurally can't represent well) will
 * never cleanly diff-match — this lets the admin flag "always recommend
 * an update for this song" so the weekend workflow surfaces it every
 * time instead of relying on the diff to notice.
 */
app.post("/api/arrangement/song/:presentationId/always-differs", async (req, res) => {
  if (!requireArrangementActive(res)) return;
  const { presentationId } = req.params;
  const { alwaysDiffers } = req.body ?? {};
  if (typeof alwaysDiffers !== "boolean") {
    return res.status(400).json({ error: "alwaysDiffers must be a boolean" });
  }

  const storage = await getStorageBackend();
  const groupSequence = getGroupSequence(presentationId) ?? [];
  const existing = (await storage.readSongFile(presentationId)) ?? {
    songId: presentationId,
    songName: getPresentationName(presentationId),
    propresenterPresentationId: presentationId,
    sectionMapping: suggestMapping(groupSequence),
    manualPlannedArrangement: [],
    history: [],
  };
  const updated = { ...existing, alwaysDiffers };
  await storage.writeSongFile(presentationId, updated);
  res.json({ ok: true });
});

/**
 * Marks one specific past comparison as "ignore this one" — e.g. only
 * part of the song was played, or the arrangement that week was a
 * one-off, non-representative departure from how it's normally done.
 * Keeps the history entry (for audit purposes) but excludes it from
 * drift suggestions and undoes it without deleting the record.
 */
app.post("/api/arrangement/song/:presentationId/history/:serviceDate/ignore", async (req, res) => {
  if (!requireArrangementActive(res)) return;
  const { presentationId, serviceDate } = req.params;
  const { ignored } = req.body ?? {};
  if (typeof ignored !== "boolean") {
    return res.status(400).json({ error: "ignored must be a boolean" });
  }

  const storage = await getStorageBackend();
  const existing = await storage.readSongFile(presentationId);
  const entryIndex = existing?.history.findIndex((h) => h.serviceDate === serviceDate) ?? -1;
  if (entryIndex === -1) {
    return res.status(404).json({ error: "No comparison found for that song and service date" });
  }

  const history = [...existing.history];
  history[entryIndex] = { ...history[entryIndex], ignored };
  await storage.writeSongFile(presentationId, { ...existing, history });
  res.json({ ok: true });
});

/**
 * Matches each Planning Center plan song to a ProPresenter presentation
 * by normalized title — there's no shared stable ID between the two
 * systems, so this is a best-effort text match, not a guarantee.
 */
function matchPlanSongsToPresentations(planSongs) {
  const index = getIndex();
  const indexed = Object.entries(index.presentations).map(([presentationId, entry]) => ({
    presentationId,
    name: entry.name,
    normalized: normalizeSongTitle(entry.name),
  }));

  return planSongs.map((song) => {
    const normalized = normalizeSongTitle(song.title);
    const match = indexed.find((p) => p.normalized === normalized);
    return {
      title: song.title,
      sectionSequence: song.sectionSequence,
      presentationId: match?.presentationId ?? null,
      presentationName: match?.name ?? null,
      externalSongId: song.externalSongId ?? null,
      externalArrangementId: song.externalArrangementId ?? null,
    };
  });
}

/** Plain-language description of what changed, for the "update the plan" workflow. */
function describeDrift(diff) {
  if (!diff.skipped.length && !diff.added.length && !diff.reordered.length) {
    return "Matches exactly — no changes needed.";
  }
  return "Doesn't match what was actually played — consider updating the plan.";
}

/**
 * Preview of "this weekend's plan" (Section 8's one-button workflow) —
 * the most recent past plan for the configured service type, plus which
 * of its songs Refrain can find in ProPresenter. Read-only: doesn't run
 * or save any comparisons, just lets the UI show what's about to happen
 * before the admin commits to it.
 */
app.get("/api/arrangement/current-plan", async (req, res) => {
  if (!requireArrangementActive(res)) return;
  if (!(await requireProviderCapability(res, "supportsPlanBrowsing", "This weekend's plan"))) return;
  try {
    const provider = await getArrangementProvider(await getStorageBackend());
    const { planId } = req.query;
    const plans = await provider.getRecentPlans(5);
    const plan = planId ? plans.find((p) => p.id === planId) : plans[0];
    if (!plan) {
      return res.status(404).json({
        error: "No past plan found — check the Service Type ID in Configuration, and that it has at least one plan with a past date.",
      });
    }
    const songs = await provider.getPlanSongs(plan.id);
    res.json({ plan, songs: matchPlanSongsToPresentations(songs) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/** The last 5 already-happened plans for the configured service type, for the UI's plan picker. */
app.get("/api/arrangement/plans", async (_req, res) => {
  if (!requireArrangementActive(res)) return;
  if (!(await requireProviderCapability(res, "supportsPlanBrowsing", "Plan browsing"))) return;
  try {
    const provider = await getArrangementProvider(await getStorageBackend());
    const plans = await provider.getRecentPlans(5);
    res.json({ plans });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * The one-button "compare everything from this weekend" workflow:
 * finds the most recent plan, matches its songs into ProPresenter, runs
 * (and saves) a real comparison for every match, and returns a
 * plain-language suggestion per song for what — if anything — the
 * church-management system's arrangement should be updated to.
 */
app.post("/api/arrangement/compare-all", async (req, res) => {
  if (!requireArrangementActive(res)) return;
  if (config.role !== "logger") {
    return res.status(403).json({ error: "Only the logger machine can run comparisons — see Health for role." });
  }
  if (!(await requireProviderCapability(res, "supportsPlanBrowsing", "The weekend compare-all workflow"))) return;

  try {
    const storage = await getStorageBackend();
    const provider = await getArrangementProvider(storage);
    const { planId } = req.body ?? {};
    const plans = await provider.getRecentPlans(5);
    const plan = planId ? plans.find((p) => p.id === planId) : plans[0];
    if (!plan) {
      return res.status(404).json({
        error: "No past plan found — check the Service Type ID in Configuration, and that it has at least one plan with a past date.",
      });
    }
    const serviceDate = plan.sortDate.slice(0, 10);
    const matched = matchPlanSongsToPresentations(await provider.getPlanSongs(plan.id));

    config = await ensureMachineId(config);
    const results = [];
    const unmatched = [];
    for (const song of matched) {
      if (!song.presentationId) {
        unmatched.push({ title: song.title });
        continue;
      }
      const actualGroupSequence = getGroupSequence(song.presentationId);
      if (!actualGroupSequence) {
        unmatched.push({ title: song.title, reason: "Matched a presentation, but it's not in the search index." });
        continue;
      }
      try {
        const result = await runComparison({
          songId: song.presentationId,
          songName: song.presentationName,
          presentationId: song.presentationId,
          serviceDate,
          actualGroupSequence,
          provider,
          storage,
          machineId: config.machineId,
          force: true, // this is a deliberate re-run of the whole weekend, not a single accidental double-click
          planId: plan.id,
        });
        const lastEntry = result.record.history.at(-1);
        results.push({
          title: song.title,
          presentationId: song.presentationId,
          presentationName: song.presentationName,
          planned: lastEntry.planned,
          actual: lastEntry.actual,
          diff: lastEntry.diff,
          suggestion: describeDrift(lastEntry.diff),
          alwaysDiffers: result.record.alwaysDiffers ?? false,
          ignored: lastEntry.ignored ?? false,
          externalSongId: song.externalSongId,
          externalArrangementId: song.externalArrangementId,
        });
      } catch (err) {
        unmatched.push({ title: song.title, reason: err.message });
      }
    }

    res.json({ plan, serviceDate, results, unmatched });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * Pushes a song's actual (as-played) arrangement up to the
 * church-management provider's base arrangement (any provider with
 * supportsPush) — only ever fired from an explicit, user-clicked
 * "confirm" in the UI (Section 8), never automatically. Overwrites the
 * shared Arrangement, so it affects every future plan that reuses it,
 * not just the plan this was reviewed from. Returns the pre-overwrite
 * sequence so the UI can offer a one-click undo (just call this route
 * again with that sequence).
 */
app.post("/api/arrangement/push-arrangement", async (req, res) => {
  if (!requireArrangementActive(res)) return;
  if (config.role !== "logger") {
    return res.status(403).json({ error: "Only the logger machine can push arrangements — see Health for role." });
  }
  if (!(await requireProviderCapability(res, "supportsPush", "Pushing an arrangement update"))) return;

  const { externalSongId, externalArrangementId, sequence } = req.body ?? {};
  if (!externalSongId || !externalArrangementId || !Array.isArray(sequence) || !sequence.length) {
    return res.status(400).json({ error: "externalSongId, externalArrangementId, and a non-empty sequence are required" });
  }
  if (sequence.some((s) => String(s).startsWith("[unmapped]"))) {
    return res.status(400).json({
      error: "This arrangement has unmapped sections — fix the song's section mapping before pushing this update.",
    });
  }

  try {
    const provider = await getArrangementProvider(await getStorageBackend());
    const previousSequence = await provider.getArrangementSequence(externalSongId, externalArrangementId);
    await provider.updateArrangementSequence(externalSongId, externalArrangementId, sequence);
    res.json({ ok: true, previousSequence });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/arrangement/compare", async (req, res) => {
  if (!requireArrangementActive(res)) return;
  if (config.role !== "logger") {
    return res.status(403).json({ error: "Only the logger machine can run comparisons — see Health for role." });
  }
  const { presentationId, serviceDate, force } = req.body ?? {};
  if (!presentationId || !serviceDate) {
    return res.status(400).json({ error: "presentationId and serviceDate are required" });
  }

  const actualGroupSequence = getGroupSequence(presentationId);
  if (!actualGroupSequence) return res.status(404).json({ error: "Presentation not found in search index" });

  config = await ensureMachineId(config);
  const storage = await getStorageBackend();
  const provider = await getArrangementProvider(storage);

  try {
    const result = await runComparison({
      songId: presentationId,
      songName: getPresentationName(presentationId),
      presentationId,
      serviceDate,
      actualGroupSequence,
      provider,
      storage,
      machineId: config.machineId,
      force: Boolean(force),
    });
    if (!result.ok) {
      return res.status(409).json({
        conflict: true,
        error: `Machine "${result.existingMachineId}" already logged ${serviceDate} — resubmit with force to overwrite.`,
      });
    }
    res.json({ ok: true, record: result.record });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- Image Crop module (watched-folder smart cropping) ---

// The full menu of known sizes, offered in the UI's "add a common size"
// picker so a volunteer never has to look up pixel dimensions. `seed: true`
// ones are what a fresh install starts with; the rest are one click away
// from the picker. The seeded set is a slide background (1080p) plus the
// lower-third and book graphic sizes a service typically drops straight
// onto a screen at native size; the social/video sizes sit in the menu.
// `abbr` is the compact, editable filename suffix (output is
// `photo_<abbr>.jpg`); `_` separates parts, `-` stays inside a token.
// Custom presets with no abbr fall back to a websafe form of their name.
const PRESET_CATALOG = [
  { name: "1080p (16:9)", width: 1920, height: 1080, abbr: "hd", seed: true },
  { name: "Thirds square", width: 693, height: 693, abbr: "thirds-sq", seed: true },
  { name: "Thirds wide", width: 777, height: 502, abbr: "thirds-wide", seed: true },
  { name: "Thirds tall", width: 605, height: 808, abbr: "thirds-tall", seed: true },
  { name: "Book graphic", width: 515, height: 787, abbr: "book", seed: true },
  { name: "4K UHD (16:9)", width: 3840, height: 2160, abbr: "4k", seed: false },
  { name: "1440p / 2.5K (16:9)", width: 2560, height: 1440, abbr: "2-5k", seed: false },
  { name: "YouTube thumbnail", width: 1280, height: 720, abbr: "yt", seed: false },
  { name: "OG / Facebook share", width: 1200, height: 630, abbr: "og", seed: false },
  { name: "Instagram square (1:1)", width: 1080, height: 1080, abbr: "in_sq", seed: false },
  { name: "Instagram portrait (4:5)", width: 1080, height: 1350, abbr: "in_pt", seed: false },
  { name: "Instagram story / Reels (9:16)", width: 1080, height: 1920, abbr: "in_st", seed: false },
  { name: "X / Twitter share (16:9)", width: 1200, height: 675, abbr: "x", seed: false },
  { name: "X / Twitter header", width: 1500, height: 500, abbr: "x_hdr", seed: false },
  { name: "LinkedIn share", width: 1200, height: 627, abbr: "li", seed: false },
  { name: "Pinterest pin (2:3)", width: 1000, height: 1500, abbr: "pin", seed: false },
  { name: "Facebook cover", width: 820, height: 312, abbr: "fb_cov", seed: false },
  { name: "Ultrawide banner (21:9)", width: 2560, height: 1080, abbr: "uw", seed: false },
];

const stripSeedFlag = ({ name, width, height, abbr }) => ({ name, width, height, abbr });
const DEFAULT_IMAGE_CROP_PRESETS = PRESET_CATALOG.filter((p) => p.seed).map(stripSeedFlag);

// Default drop folders inside the app's own data folder. Created at
// startup (see below) so a volunteer can find and alias them right away,
// and pre-filled in the UI. They can still point the module at any other
// folder instead.
const DEFAULT_IMAGE_CROP_INPUT = "./data/image-crop/input";
const DEFAULT_IMAGE_CROP_OUTPUT = "./data/image-crop/output";

// Beyond ~8K per side a single output is hundreds of MB uncompressed —
// a fat-fingered "10000" shouldn't be able to OOM the box. Comfortably
// clears any real slide/social target.
const MAX_PRESET_DIMENSION = 8000;
const MAX_PRESETS = 25;

app.get("/api/image-crop/status", (_req, res) => {
  res.json({
    status: getImageCropModuleStatus(config),
    config: config.imageCropModule ?? null,
    catalog: PRESET_CATALOG.map(stripSeedFlag), // for the UI's "add a common size" picker
    defaults: { inputFolder: DEFAULT_IMAGE_CROP_INPUT, outputFolder: DEFAULT_IMAGE_CROP_OUTPUT },
    ...getImageCropStatus(),
  });
});

app.post("/api/image-crop/config", async (req, res) => {
  try {
    const { enabled, inputFolder, outputFolder, presets } = req.body ?? {};
    const newConfig = { ...config, imageCropModule: { ...config.imageCropModule } };

    if (enabled !== undefined) newConfig.imageCropModule.enabled = Boolean(enabled);
    if (inputFolder !== undefined) {
      if (typeof inputFolder !== "string") return res.status(400).json({ error: "inputFolder must be a string" });
      newConfig.imageCropModule.inputFolder = inputFolder.trim() || null;
    }
    if (outputFolder !== undefined) {
      if (typeof outputFolder !== "string") return res.status(400).json({ error: "outputFolder must be a string" });
      newConfig.imageCropModule.outputFolder = outputFolder.trim() || null;
    }
    if (presets !== undefined) {
      if (!Array.isArray(presets) || presets.length === 0) {
        return res.status(400).json({ error: "presets must be a non-empty array" });
      }
      if (presets.length > MAX_PRESETS) {
        return res.status(400).json({ error: `At most ${MAX_PRESETS} presets.` });
      }
      const validPreset = (p) =>
        p &&
        typeof p.name === "string" &&
        p.name.trim() &&
        (p.abbr === undefined || p.abbr === null || typeof p.abbr === "string") &&
        Number.isInteger(p.width) &&
        Number.isInteger(p.height) &&
        p.width > 0 &&
        p.height > 0 &&
        p.width <= MAX_PRESET_DIMENSION &&
        p.height <= MAX_PRESET_DIMENSION;
      if (!presets.every(validPreset)) {
        return res.status(400).json({
          error: `Each preset needs a name and positive integer width/height no larger than ${MAX_PRESET_DIMENSION}px.`,
        });
      }
      // Sanitize any provided abbr through the same websafe rule the
      // cropper uses, so a hand-edited/hostile value can't reach a filename raw.
      newConfig.imageCropModule.presets = presets.map((p) => {
        const preset = { name: p.name.trim(), width: p.width, height: p.height };
        const abbr = p.abbr ? websafeToken(p.abbr) : "";
        if (abbr) preset.abbr = abbr;
        return preset;
      });
    }

    // First time this module is turned on with no folders configured yet,
    // default to a zero-setup location inside the app's own data folder —
    // "drop a file in, it works" shouldn't require picking a path first.
    if (newConfig.imageCropModule.enabled) {
      newConfig.imageCropModule.inputFolder ??= DEFAULT_IMAGE_CROP_INPUT;
      newConfig.imageCropModule.outputFolder ??= DEFAULT_IMAGE_CROP_OUTPUT;
      if (!newConfig.imageCropModule.presets?.length) {
        newConfig.imageCropModule.presets = DEFAULT_IMAGE_CROP_PRESETS;
      }
      if (foldersOverlap(newConfig.imageCropModule.inputFolder, newConfig.imageCropModule.outputFolder)) {
        return res.status(400).json({
          error: "Input and output folders can't be the same folder or nested inside one another — cropped outputs would be re-cropped in an endless loop.",
        });
      }
    }

    // Start the watcher against the *candidate* config before persisting,
    // so a bad path (permission denied, etc.) surfaces as a 400 the user
    // sees instead of leaving a broken enabled=true saved to disk.
    await startImageCropWatcher(getImageCropModuleStatus(newConfig) === "active" ? newConfig.imageCropModule : null);
    config = newConfig;
    await saveConfig(config);
    res.json({ ok: true, config: config.imageCropModule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/image-crop/open-folder", async (req, res) => {
  const { which } = req.body ?? {};
  if (which !== "input" && which !== "output") {
    return res.status(400).json({ error: 'which must be "input" or "output"' });
  }
  const folder = which === "input" ? config.imageCropModule?.inputFolder : config.imageCropModule?.outputFolder;
  if (!folder) return res.status(409).json({ error: "That folder isn't configured yet — save a config first." });

  try {
    await mkdir(folder, { recursive: true });
  } catch (err) {
    return res.status(500).json({ error: `Failed to create folder: ${err.message}` });
  }

  if (platform() !== "darwin") {
    return res.status(501).json({ error: "Opening a folder automatically is only supported on macOS right now — open it manually." });
  }
  execFile("open", [folder], (err) => {
    if (err) return res.status(500).json({ error: `Failed to open folder: ${err.message}` });
    res.json({ ok: true });
  });
});

// --- QR Codes module (fully local generation) ---

// How many recently-downloaded codes to keep for one-click restore.
// Configurable (qrCodeModule.recentLimit); 0 turns the recent list off.
const QR_DEFAULT_RECENT_LIMIT = 20;
const QR_MAX_RECENT_LIMIT = 100;
function qrRecentLimit() {
  const n = config.qrCodeModule?.recentLimit;
  return Number.isInteger(n) && n >= 0 && n <= QR_MAX_RECENT_LIMIT ? n : QR_DEFAULT_RECENT_LIMIT;
}

app.get("/api/qr/config", (_req, res) => {
  res.json({
    defaultBaseUrl: config.qrCodeModule?.defaultBaseUrl || null,
    defaultLogoUrl: config.qrCodeModule?.defaultLogoUrl || null,
    defaultSize: config.qrCodeModule?.defaultSize || null,
    recentLimit: qrRecentLimit(),
  });
});

app.post("/api/qr/generate", async (req, res) => {
  try {
    const result = await generateQr(req.body ?? {});
    res.json(result);
  } catch (err) {
    // validateQrOptions throws user-facing messages; anything else is a 500.
    res.status(400).json({ error: err.message });
  }
});

// Recent-codes history: the last N downloaded codes, for one-click restore.
app.get("/api/qr/history", async (_req, res) => {
  try {
    res.json({ entries: await getQrHistoryList(qrRecentLimit()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/qr/history/:id", async (req, res) => {
  try {
    const entry = await getQrHistoryEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: "No saved code with that id." });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/qr/history", async (req, res) => {
  try {
    res.json({ entries: await addQrHistoryEntry(req.body ?? {}, qrRecentLimit()) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/qr/history", async (_req, res) => {
  try {
    await clearQrHistory();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- First-run setup (Section 6) ---

app.get("/api/setup/status", (_req, res) => {
  res.json({
    needsSetup: !isConfigComplete(config),
    propresenter: config.propresenter,
    role: config.role ?? null,
  });
});

app.post("/api/setup/scan", async (_req, res) => {
  try {
    const candidates = await scanForProPresenter({ configuredPort: config.propresenter?.port ?? null });
    res.json({ candidates });
  } catch (err) {
    res.status(500).json({ error: `Scan failed: ${err.message}` });
  }
});

app.post("/api/setup/test-connection", async (req, res) => {
  const { host, port } = req.body ?? {};
  if (!host || !port) {
    return res.status(400).json({ connected: false, error: "host and port are required" });
  }
  try {
    await new ProPresenterClient({ host, port }).testConnection();
    res.json({ connected: true });
  } catch (err) {
    res.json({
      connected: false,
      error: `${err.message} — check ProPresenter is running with its Network API enabled (Preferences > Network), and that the host/port are correct.`,
    });
  }
});

app.post("/api/setup", async (req, res) => {
  const { host, port, role } = req.body ?? {};
  if (!host || !port || (role !== "reader" && role !== "logger")) {
    return res.status(400).json({ error: "host, port, and a valid role are required" });
  }

  const newConfig = { ...config, propresenter: { host, port: Number(port) }, role };
  try {
    await saveConfig(newConfig);
  } catch (err) {
    return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
  }

  config = newConfig;
  client = new ProPresenterClient(config.propresenter);

  res.json({ ok: true });

  // First-run always needs a full build (Section 5.3) — kick it off after
  // responding so the setup screen can poll /api/index/status for progress
  // rather than holding the request open.
  rebuildIndex(client, config.librarySync).catch((err) => {
    console.error("Setup index build failed:", err.message);
  });
});

// --- Health / status screen (Section 7) ---

app.get("/api/health", async (_req, res) => {
  let propresenter;
  try {
    await client.testConnection();
    propresenter = { connected: true, host: config.propresenter.host, port: config.propresenter.port };
  } catch (err) {
    propresenter = {
      connected: false,
      host: config.propresenter.host,
      port: config.propresenter.port,
      error: err.message,
    };
  }

  res.json({
    version,
    role: config.role ?? null,
    propresenter,
    index: indexStatusPayload(),
    arrangementModule: {
      status: getArrangementModuleStatus(config),
      enabled: Boolean(config.arrangementModule?.enabled),
      storageBackend: config.arrangementModule?.storageBackend ?? null,
      storageBackendDisplayName: await getStorageBackendDisplayName(),
      localFolderPath: config.arrangementModule?.localFolderPath ?? null,
      provider: config.arrangementModule?.provider ?? null,
      providerDisplayName: await getArrangementProviderDisplayName(),
      planningCenterServiceTypeId: config.arrangementModule?.planningCenterServiceTypeId ?? null,
      pendingUploads: await getPendingUploadCount(),
    },
    config: {
      librarySync: {
        folders: config.librarySync?.folders ?? null,
        crawlPlaylists: Boolean(config.librarySync?.crawlPlaylists),
      },
      slideSplitter: config.slideSplitter ?? null,
      lyricsSites: config.lyricsSites ?? [],
      qrCodeModule: {
        defaultBaseUrl: config.qrCodeModule?.defaultBaseUrl ?? null,
        defaultLogoUrl: config.qrCodeModule?.defaultLogoUrl ?? null,
        defaultSize: config.qrCodeModule?.defaultSize ?? null,
        recentLimit: qrRecentLimit(),
      },
    },
    envRequirements: getEnvRequirements(config),
  });
});

const port = process.env.PORT || 3000;
app.listen(port, "127.0.0.1", async () => {
  console.log(`Refrain running at http://localhost:${port}`);

  if (!configFileExists()) {
    console.log("No config.json found — waiting for first-run setup before indexing.");
    return;
  }

  const existing = await loadIndexFromDisk();
  if (!existing) {
    console.log("No search index cache found — building initial index...");
    try {
      await rebuildIndex(client, config.librarySync);
      console.log("Initial index build complete.");
    } catch (err) {
      console.error("Initial index build failed:", err.message);
      console.error("Check ProPresenter is running with its Network API enabled (Preferences > Network).");
    }
  } else if (shouldAutoRebuild(existing)) {
    console.log("Cached index is stale (>24h old) — rebuilding in background...");
    rebuildIndex(client, config.librarySync).catch((err) => console.error("Background rebuild failed:", err.message));
  } else {
    console.log(`Loaded cached index (built ${existing.builtAt}, ${Object.keys(existing.presentations).length} presentations).`);
  }

  // Section 8.4: a write that failed last run (backend unreachable) is
  // staged locally rather than lost — retry it now that the app's back
  // up, instead of leaving it stuck until the next comparison happens
  // to touch that exact song again.
  if (config.role === "logger" && getArrangementModuleStatus(config) === "active") {
    try {
      const storage = await getStorageBackend();
      const { attempted, succeeded } = await retryPendingUploads(storage);
      if (attempted > 0) {
        console.log(`Retried ${attempted} pending arrangement upload(s) — ${succeeded} succeeded.`);
      }
    } catch (err) {
      console.error("Pending-upload retry failed:", err.message);
    }
  }

  // Create the default image-crop folders up front (even if the module is
  // off) so a volunteer can open and alias them straight away, and they're
  // the paths the screen pre-fills. Harmless if unused; they can point the
  // module at a different folder instead.
  try {
    await mkdir(DEFAULT_IMAGE_CROP_INPUT, { recursive: true });
    await mkdir(DEFAULT_IMAGE_CROP_OUTPUT, { recursive: true });
  } catch (err) {
    console.error("Couldn't create default image-crop folders:", err.message);
  }

  if (getImageCropModuleStatus(config) === "active") {
    try {
      await startImageCropWatcher(config.imageCropModule);
      console.log(`Watching ${config.imageCropModule.inputFolder} for images to crop.`);
    } catch (err) {
      console.error("Failed to start image-crop watcher:", err.message);
    }
  }
});
