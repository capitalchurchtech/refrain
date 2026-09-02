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
  getLibrarySyncModuleStatus,
  getEnvRequirements,
  ensureMachineId,
  readConfigFileRaw,
} from "./config.js";
import { ProPresenterClient } from "./propresenter-client.js";
import { scanForProPresenter } from "./propresenter-scan.js";
import {
  buildFindings,
  deriveSupportRoot,
  findOrphanedHelpers,
  readWorkspaceState,
  readCrashReports,
  readLibraryConsistency,
} from "./propresenter-doctor.js";
import {
  loadIndexFromDisk,
  rebuildIndex,
  shouldAutoRebuild,
  anchorsAvailable,
  indexAccuracyNotice,
  lastLibraryFolderIssues,
  search,
  getIndex,
  getRebuildProgress,
  getGroupSequence,
  getPresentationName,
  getIndexedFolders,
  extractSlides,
  getIndexedArrangementNames,
  planReindex,
  getIndexedLibraryDirs,
  daysSinceFullBuild,
  getIndexedSlide,
  lastCrawlAbort,
} from "./search-index.js";
import { startLibraryWatch, fullRebuildSuggestion,
  indexStaleness,
} from "./library-watch.js";
import {
  isLive,
  initialState as initialPerformanceState,
  advance as advancePerformance,
  armManually,
  disarmManually,
  describe as describePerformance,
} from "./performance-mode.js";
import { resolveArrangement, flattenGroups, findLiveIndex, parseSlideIndex } from "./arrangements.js";
import { pushLiveItem, findReturnEntry } from "./return-history.js";
import { checkLibrarySafeToTouch } from "./library-guard.js";
import { heartbeatInterval } from "./heartbeat-pacing.js";
import { buildInfo } from "./build-info.js";
import {
  syncLibrary,
  takeSnapshot,
  listSnapshots,
  listLibraryFiles,
  planSync,
  libraryDirFromPresentationPath,
  writeLastRun,
  readLastRun,
  DEFAULT_MINIMUM_FILES,
  DEFAULT_SNAPSHOTS_TO_KEEP,
} from "./library-sync.js";
import { discoverModules, discoverSlideSplitters, discoverProviders, discoverStorageBackends } from "./plugin-loader.js";
import { runComparison, suggestMapping, getPendingUploadCount, retryPendingUploads } from "./arrangement-diff.js";
import { startWatcher as startImageCropWatcher, getImageCropStatus, foldersOverlap, websafeToken } from "./image-crop.js";
import { generateQr, getQrHistoryList, getQrHistoryEntry, addQrHistoryEntry, clearQrHistory, QR_LIMITS } from "./qr-code.js";
import { loadSpeller, findTypos, tokenize, addToAllowlist, removeFromAllowlist, parseWordList } from "./spellcheck.js";
import { normalizeSongTitle } from "../providers/planning-center.js";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

// Which code is actually running, resolved once at boot. The crash report's
// most valuable field is the commit: a church updates by `git pull`, so two
// machines can both report v0.11.0 and be eleven commits apart, and without it
// every stack trace is guesswork about which source produced it.
const BUILD = buildInfo({ version });

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

/** Whether a module should appear in the nav at all. */
function navEnabledFor(m) {
  if (m.id === "arrangement") return getArrangementModuleStatus(config) !== "off";
  if (m.id === "library-sync") return getLibrarySyncModuleStatus(config) !== "off";
  return m.enabledByDefault;
}

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
      //
      // Library Sync is gated the same way as arrangement: it only makes sense
      // with a second machine or account, so a single-machine church never
      // sees it until they deliberately switch it on in config.json.
      enabled: navEnabledFor(m),
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
// Build identity for the crash report. The client fetches this once at boot and
// caches it, deliberately: at crash time the server may be the thing that
// broke, and a report missing its commit is the one field that makes the rest
// guesswork.
app.get("/api/build", (_req, res) => {
  res.json(BUILD);
});

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
  // navPinned is left as null when the user hasn't chosen, so the frontend
  // can default a first-time user to the expanded (labelled) nav.
  res.json({
    theme: config.theme ?? "dark",
    navPinned: config.navPinned ?? null,
    welcomeDismissed: Boolean(config.welcomeDismissed),
  });
});

app.post("/api/preferences", async (req, res) => {
  const { theme, navPinned, welcomeDismissed } = req.body ?? {};
  const newConfig = { ...config };
  if (theme !== undefined) newConfig.theme = theme;
  if (navPinned !== undefined) newConfig.navPinned = Boolean(navPinned);
  if (welcomeDismissed !== undefined) newConfig.welcomeDismissed = Boolean(welcomeDismissed);

  try {
    await saveConfig(newConfig);
  } catch (err) {
    return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
  }
  config = newConfig;
  res.json({ ok: true });
});

/**
 * Arrangement names to prefer when indexing, most-preferred first (e.g.
 * ["FS","T"]). A church names its arrangements for its own service styles,
 * and which one the library happens to have selected is arbitrary, so this
 * says which ones actually get run. Empty/absent = follow ProPresenter's
 * own selection, as before this setting existed.
 */
function preferredArrangements() {
  const list = config.preferredArrangements;
  return Array.isArray(list) ? list.filter((n) => typeof n === "string" && n.trim()) : [];
}

const MAX_PREFERRED_ARRANGEMENTS = 10;

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
      // Real arrangement names seen in the built index, so the admin picks
      // from what their own ProPresenter actually has rather than typing
      // church-specific labels blind.
      arrangementNameCandidates: getIndexedArrangementNames(),
      maxPreferredArrangements: MAX_PREFERRED_ARRANGEMENTS,
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

    if (body.preferredArrangements !== undefined) {
      if (!Array.isArray(body.preferredArrangements)) {
        return res.status(400).json({ error: "preferredArrangements must be a list" });
      }
      const cleaned = body.preferredArrangements
        .map((n) => String(n ?? "").trim())
        .filter(Boolean);
      if (cleaned.length > MAX_PREFERRED_ARRANGEMENTS) {
        return res
          .status(400)
          .json({ error: `Pick at most ${MAX_PREFERRED_ARRANGEMENTS} preferred arrangements` });
      }
      // Deduped case-insensitively, keeping the admin's stated order — that
      // order is the priority when a song has more than one of them.
      const seen = new Set();
      newConfig.preferredArrangements = cleaned.filter((n) => {
        const k = n.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
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

// Set at boot when a rebuild was due but deliberately skipped because it's
// a service day, so the Health screen can say so instead of just showing a
// stale index with no explanation.
// Why Refrain skipped index work it would otherwise have done, or null.
let indexWorkDeferred = null;

/**
 * Performance mode: while it is armed, Refrain does nothing on its own.
 *
 * Replaces the old Saturday/Sunday deferral. The day of the week was a proxy
 * for "a service is happening"; ProPresenter's own layer status is the actual
 * answer, and it is right about Wednesday evenings and empty Saturdays alike.
 */
let performance = initialPerformanceState();
let heartbeatTimer = null;

/**
 * The heartbeat. Two trivial calls every few seconds, feeding three things a
 * live operator needs: whether ProPresenter is answering, what is on the
 * screens, and whether performance mode should be armed.
 *
 * This is the one thing that keeps running while performance mode is armed.
 * Freezing it would be exactly backwards: the link indicator and the live
 * readout matter MORE during a service, not less. What performance mode stops
 * is index work, which is the expensive part.
 */
// When a browser last polled. The heartbeat follows this rather than running
// flat out forever: see heartbeat-pacing.js for why 43,200 requests a day at
// idle was not defensible.
let lastClientAt = null;
export function noteClientActivity() {
  lastClientAt = Date.now();
}

let liveState = {
  connected: false,
  live: false,
  slide: null,
  liveSince: null,
  checkedAt: null,
};

function slideKey(slide) {
  return slide ? `${slide.presentationId}:${slide.slideIndex}` : null;
}

async function heartbeat() {
  let layers = null;
  let current = null;
  try {
    // Both are a few milliseconds. Fetched together so the readout and the
    // link indicator can never disagree about the same moment.
    [layers, current] = await Promise.all([
      client.getLayerStatus(),
      client.getCurrentSlide().catch(() => null),
    ]);
  } catch {
    layers = null; // ProPresenter is not answering
  }

  const now = Date.now();
  const connected = layers !== null;
  const enriched = current
    ? { ...current, ...(getIndexedSlide(current.presentationId, current.slideIndex) ?? {}) }
    : null;

  // Elapsed time is measured from when THIS slide appeared, so it survives
  // polling and does not restart on every check.
  const sameSlide = slideKey(enriched) === slideKey(liveState.slide);
  liveState = {
    connected,
    live: Boolean(layers) && isLive(layers),
    layers: layers ?? null,
    slide: enriched,
    liveSince: enriched ? (sameSlide ? liveState.liveSince : now) : null,
    checkedAt: now,
  };

  // Everything that goes on the screens joins the history, from the first item
  // ProPresenter loads. It used to fill only from app-initiated jumps, so a
  // service run entirely from ProPresenter's own controls left the panel empty
  // and the operator with nothing to go back to -- which is most of a service.
  //
  // Recorded per presentation rather than per slide: advancing thirty slides
  // through one song would otherwise bury the running order under thirty copies
  // of it. `pushLiveItem` moves a revisited item to the front and takes the
  // newer slide index, so going back lands where the operator last was in it.
  if (enriched) {
    returnHistory = pushLiveItem(returnHistory, {
      presentationId: enriched.presentationId,
      slideIndex: enriched.slideIndex,
      name: enriched.presentationName ?? enriched.name ?? null,
      leftAt: new Date(now).toISOString(),
    });
  }

  const was = performance.armed;
  performance = advancePerformance({ state: performance, layers, now });
  if (performance.armed !== was) {
    console.log(`Performance mode ${performance.armed ? "ON" : "OFF"} — ${describePerformance(performance)}`);
  }
  return performance;
}

// Kept as the old name so the boot path reads the same.
const pollPerformance = heartbeat;

function startPerformancePolling() {
  clearTimeout(heartbeatTimer);
  // Rescheduled after each beat rather than fixed, so the rate can follow
  // whether anyone is actually watching without tearing down a timer.
  const beat = async () => {
    await heartbeat().catch(() => {});
    const next = heartbeatInterval({ lastClientAt });
    heartbeatTimer = setTimeout(beat, next);
    heartbeatTimer.unref?.();
  };
  beat();
}

/**
 * What is on the screens, and whether we can still see ProPresenter.
 *
 * Served from the heartbeat's cache, so a browser polling this costs nothing
 * on ProPresenter's side no matter how many tabs are open.
 */
function liveStatePayload() {
  return {
    connected: liveState.connected,
    live: liveState.live,
    slide: liveState.slide
      ? {
          presentationId: liveState.slide.presentationId,
          presentationName: liveState.slide.presentationName ?? liveState.slide.name ?? null,
          arrangementName: liveState.slide.arrangementName ?? null,
          slideIndex: liveState.slide.slideIndex,
          slideCount: liveState.slide.slideCount ?? null,
          text: liveState.slide.text ?? null,
        }
      : null,
    liveSince: liveState.liveSince ? new Date(liveState.liveSince).toISOString() : null,
    checkedAt: liveState.checkedAt ? new Date(liveState.checkedAt).toISOString() : null,
    performanceMode: { armed: performance.armed, source: performance.source },
  };
}

/** True when Refrain should not be doing anything of its own accord. */
function frozen() {
  return performance.armed;
}

// How long ProPresenter has been answering without interruption. The watcher
// uses this to hold off right after a launch, when reads fail en masse while
// ProPresenter is still indexing its own media.
let propresenterReadySince = null;
async function propresenterReadyForMs() {
  try {
    await client.testConnection();
    if (propresenterReadySince == null) propresenterReadySince = Date.now();
    return Date.now() - propresenterReadySince;
  } catch {
    propresenterReadySince = null;
    return null;
  }
}

let libraryWatch = null;
function autoReindexEnabled() {
  return config?.autoReindex !== false;
}

/**
 * Watches for presentations changing and reindexes just those. Started after
 * the index exists, since there is nothing to compare against before that, and
 * restarted whenever the library scope changes so it watches the right folders.
 */
function startWatching() {
  libraryWatch?.stop();
  libraryWatch = null;
  if (!autoReindexEnabled()) return;
  const dirs = getIndexedLibraryDirs();
  if (dirs.length === 0) return;
  libraryWatch = startLibraryWatch({
    dirs: () => dirs,
    plan: () => planReindex(client, config.librarySync, preferredArrangements()),
    reindex: () => rebuildIndex(client, config.librarySync, preferredArrangements(), { incremental: true }),
    // Performance mode is a hard stop, not a preference: while it is on, the
    // watcher does not even check, so Refrain makes no unsolicited API calls.
    frozen,
    rebuildInProgress: () => getRebuildProgress().inProgress,
    readyForMs: propresenterReadyForMs,
    crawlPlaylists: () => Boolean(config.librarySync?.crawlPlaylists),
  });
  console.log(`Watching ${dirs.length} library folder(s) for changes — edited presentations reindex on their own.`);
}

function indexStatusPayload() {
  const index = getIndex();
  return {
    indexWorkDeferred,
    builtAt: index.builtAt,
    buildDurationMs: index.buildDurationMs ?? null,
    crawledPlaylists: Boolean(index.crawledPlaylists),
    buildMode: index.buildMode ?? null,
    reindexCounts: index.reindexCounts ?? null,
    lastFullBuildAt: index.lastFullBuildAt ?? null,
    performanceMode: {
      armed: performance.armed,
      source: performance.source,
      since: performance.since ? new Date(performance.since).toISOString() : null,
      description: describePerformance(performance),
      lastError: performance.lastError,
    },
    fullRebuildSuggestion: fullRebuildSuggestion(daysSinceFullBuild(index)),
    staleness: indexStaleness(index?.builtAt ?? null),
    // Accuracy is reported separately from age because they are different
    // problems: a week-old index misses new songs, a stale-schema one can fire
    // the wrong slide. The second is worse and must not be readable as the first.
    anchorsAvailable: anchorsAvailable(index),
    accuracy: indexAccuracyNotice(index),
    crawlAborted: lastCrawlAbort(),
    // A configured folder that does not exist, or one that threw mid-crawl.
    // Either way the index is short by a whole folder and search misses every
    // song in it, which nothing used to say out loud.
    libraryFolderIssues: lastLibraryFolderIssues(),
    autoReindex: autoReindexEnabled()
      ? (libraryWatch?.status() ?? { watching: 0, outcome: "not started", pending: null })
      : null,
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
  rebuildIndex(client, config.librarySync, preferredArrangements(), { incremental: true })
    .then(startWatching)
    .catch((err) => {
      console.error("Library-scope rebuild failed:", err.message);
    });
});

/**
 * Turns a transport-level failure into something a volunteer can act on.
 * undici says "fetch failed"; the operator needs to know ProPresenter is the
 * thing that isn't answering, and where Refrain was looking.
 */
function indexBuildError(err) {
  const raw = err?.message ?? "Unknown error";
  if (/fetch failed|ECONNREFUSED|ETIMEDOUT|socket hang up|aborted|timeout/i.test(raw)) {
    return (
      `Could not reach ProPresenter at ${config.propresenter.host}:${config.propresenter.port}. ` +
      "Check it is running with its Network API enabled (Preferences > Network), and that the host and port under Settings are correct."
    );
  }
  return raw;
}

// An explicit rebuild is always honored, service day or not — the whole
// point of the deferral is that the operator decides.
app.post("/api/index/rebuild", async (_req, res) => {
  try {
    indexWorkDeferred = null; // the operator has taken it in hand
    const index = await rebuildIndex(client, config.librarySync, preferredArrangements());
    startWatching();
    res.json({ builtAt: index.builtAt, presentationCount: Object.keys(index.presentations).length });
  } catch (err) {
    res.status(502).json({ error: indexBuildError(err) });
  }
});

// Reindex only the presentations whose .pro file changed since the last build.
// Falls back to a full rebuild on its own when carrying entries over would be
// unsafe (settings changed, schema changed, ProPresenter on another machine) —
// the response says which happened so the operator isn't surprised by an
// hour-long crawl they didn't ask for.
app.post("/api/index/reindex-changed", async (_req, res) => {
  try {
    indexWorkDeferred = null; // the operator has taken it in hand
    const index = await rebuildIndex(client, config.librarySync, preferredArrangements(), { incremental: true });
    res.json({
      builtAt: index.builtAt,
      presentationCount: Object.keys(index.presentations).length,
      buildMode: index.buildMode,
      buildDurationMs: index.buildDurationMs,
      counts: index.reindexCounts,
    });
  } catch (err) {
    res.status(502).json({ error: indexBuildError(err) });
  }
});

// Performance mode is deliberately a manual switch as well as an automatic
// one: the operator knows a service starts in ten minutes and no amount of
// layer-watching does.
// Polled by the live readout and the link indicator. Deliberately reads the
// heartbeat's cache rather than calling ProPresenter, so a browser left open on
// this screen costs ProPresenter nothing.
app.get("/api/live-state", (_req, res) => {
  noteClientActivity();
  res.json(liveStatePayload());
});

app.get("/api/performance-mode", async (_req, res) => {
  await pollPerformance();
  res.json({
    armed: performance.armed,
    source: performance.source,
    since: performance.since ? new Date(performance.since).toISOString() : null,
    description: describePerformance(performance),
    lastError: performance.lastError,
  });
});

app.post("/api/performance-mode", (req, res) => {
  const { armed } = req.body ?? {};
  if (typeof armed !== "boolean") {
    return res.status(400).json({ error: "armed must be true or false" });
  }
  performance = armed ? armManually(performance, Date.now()) : disarmManually(performance, Date.now());
  console.log(`Performance mode ${armed ? "ON" : "OFF"} (by hand) — ${describePerformance(performance)}`);
  res.json({
    armed: performance.armed,
    source: performance.source,
    since: performance.since ? new Date(performance.since).toISOString() : null,
    description: describePerformance(performance),
  });
});

app.get("/api/search", (req, res) => {
  const { q, playlistId, dateField, dateFrom, dateTo, folders } = req.query;
  const folderList = Array.isArray(folders) ? folders : folders ? String(folders).split(",") : undefined;
  res.json({ results: search({ query: q ?? "", playlistId, dateField, dateFrom, dateTo, folders: folderList }) });
});

app.get("/api/search/folders", (_req, res) => {
  res.json({ folders: getIndexedFolders() });
});

// Where the operator has jumped away from, newest first. Arms only on an
// app-initiated Go Live and each place is captured once, so advancing slides
// by hand in ProPresenter afterward never moves it.
//
// This was a single slot, which is why Return "sometimes worked": a second
// jump overwrote the first, so the way back to the plan was destroyed by the
// act of leaving the tangent you were trying to leave. Two jumps is not an
// edge case — it is what hunting for something mid-service looks like.
//
// In-memory on purpose, like the slot before it: ephemeral live-service state,
// not data worth persisting. A restart clearing it is correct, since a "return
// to" from before a restart points into a service that already ended.
let returnHistory = [];

// Whether the bar should be offering the most recent place right now.
//
// Separate from the history on purpose, because "where you have been" and
// "there is something to come back from" are two different facts. Returning
// answers the second without erasing the first: the place stays reachable
// through the history, it just stops being an alert. Conflating them made the
// history-only state unreachable, since any non-empty history always had a head
// to show on the bar.
// The place the bar is currently offering to go back to, captured at the moment
// of an app-initiated jump.
//
// Held separately from the history rather than read off its head, and that
// separation is load-bearing now: the heartbeat pushes every item that goes
// live, so the head of the history is whatever is on the screens *right now* --
// which after a jump is the thing you jumped to. Reading the bar off it would
// have it offering to return you to where you already are.
let returnPin = null;

/**
 * Re-points a stored slide index at the slide the operator actually clicked.
 *
 * The trigger API takes a bare flat index and resolves it against whichever
 * arrangement the presentation currently has selected. The index was computed
 * when the library was indexed, possibly under a different arrangement — and
 * arrangements reorder and repeat groups, so the same number can be a
 * completely different lyric. Re-reading the presentation now and re-finding
 * the slide by its (group, offset) anchor keeps "the slide you clicked is the
 * slide that fires" true across an arrangement switch.
 *
 * Every failure path falls back to the requested index, so this can only make
 * Go Live more accurate, never less available.
 */
/**
 * How long the anchor lookup gets before Go Live proceeds without it.
 *
 * Everything in `resolveTriggerIndex` is optional pre-work: its whole contract
 * is that any failure falls back to the requested index. It was nonetheless
 * running on the 20s live budget, on top of the 20s the trigger itself needs,
 * so a ProPresenter that accepts connections and never answers made Go Live
 * take about forty seconds to report a failure, with the button disabled
 * throughout. Observed on a real rig: /v1/version answered in 14ms while
 * /v1/status/layers, /v1/presentation/slide_index and /v1/looks all hung
 * past 30s.
 *
 * The mandatory action keeps its full budget, because a slow-but-working
 * ProPresenter must not fail to go live. The nice-to-have gets four seconds
 * and then gets out of the way.
 */
const ANCHOR_RESOLVE_BUDGET_MS = 4000;
/** Same reasoning for reading where we were: it only feeds the Return bar. */
const RETURN_PIN_READ_BUDGET_MS = 3000;

async function resolveTriggerIndex(presentationId, requestedIndex, anchor) {
  if (!anchor || (!anchor.groupId && !anchor.slideText)) {
    return { index: requestedIndex, corrected: false, arrangementName: null, anchorChecked: false };
  }
  try {
    const doc = await client.getPresentation(presentationId, { timeoutMs: ANCHOR_RESOLVE_BUDGET_MS });
    // Deliberately the LIVE selection, not preferredArrangements(): ProPresenter
    // will interpret whatever number we send against what it has selected now.
    const live = resolveArrangement(doc, []);
    const found = findLiveIndex(flattenGroups(live.groups), {
      groupId: anchor.groupId ?? null,
      groupOffset: Number.isInteger(anchor.groupOffset) ? anchor.groupOffset : null,
      index: requestedIndex,
      text: anchor.slideText ?? "",
    });
    if (found === null) {
      return { index: requestedIndex, corrected: false, arrangementName: live.arrangementName, anchorChecked: true };
    }
    return { index: found, corrected: found !== requestedIndex, arrangementName: live.arrangementName, anchorChecked: true };
  } catch {
    // Timed out, or ProPresenter refused. Fire what was asked for, and report
    // it as unchecked rather than as "not corrected" -- those are different
    // claims and only one of them is honest here.
    return { index: requestedIndex, corrected: false, arrangementName: null, anchorChecked: false };
  }
}

app.post("/api/trigger", async (req, res) => {
  const { presentationId, slideIndex, groupId, groupOffset, slideText } = req.body ?? {};
  if (!presentationId || slideIndex === undefined) {
    return res.status(400).json({ error: "presentationId and slideIndex are required" });
  }
  if (typeof presentationId !== "string") {
    return res.status(400).json({ error: "presentationId must be a string" });
  }
  // A slide number is a non-negative integer or it is not a slide number.
  // `Number(slideIndex)` accepted NaN, 3.7 and -1 and passed them straight
  // into the trigger URL. Both current callers read the value out of the
  // search index so none of that is reachable today, but the route is the
  // contract, and "no caller does that yet" is not a validation strategy.
  //
  // The type is checked before the coercion, because `Number()` maps null, ""
  // and [] all to 0 -- so a caller whose slide index was simply missing would
  // have fired the first slide of the song instead of getting an error. That is
  // the worst possible failure here: silently correct-looking, and live.
  const requested = parseSlideIndex(slideIndex);
  if (requested === null) {
    return res.status(400).json({ error: "slideIndex must be a whole number, zero or greater" });
  }
  try {

    // Both reads are independent of each other, and ProPresenter can take
    // seconds per call on a busy machine, so run them together rather than
    // stacking their latency ahead of the slide actually going live. Reading
    // the current slide is best-effort: if it fails, keep whatever pin we had
    // rather than clobbering a good one.
    const [target, current] = await Promise.all([
      resolveTriggerIndex(presentationId, requested, { groupId, groupOffset, slideText }),
      client.getCurrentSlide({ timeoutMs: RETURN_PIN_READ_BUDGET_MS }).catch(() => null),
    ]);

    // Capture where we were before jumping, so "Return" can bring us back.
    // Compared against the corrected index, since that's what will fire.
    if (current && !(current.presentationId === presentationId && current.slideIndex === target.index)) {
      returnPin = { ...current, leftAt: new Date().toISOString() };
      // Also into the history, so a jump between heartbeats is not missed.
      returnHistory = pushLiveItem(returnHistory, returnPin);
    }

    await client.triggerSlide(presentationId, target.index);
    // Deliberately not awaited: the slide is already live, and focusing the
    // editor measured ~3s on a real machine. It's a nice-to-have, so it must
    // not hold up the operator's response.
    client.focusPresentation(presentationId).catch(() => {});
    res.json({
      ok: true,
      firedIndex: target.index,
      corrected: target.corrected,
      anchorChecked: target.anchorChecked,
      arrangementName: target.arrangementName,
    });
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

// Current return pin, for the app-wide "Return" bar to show/hide itself.
// `pin` is the most recent place, which is what the bar shows at rest;
// `history` is everything reachable behind it. Both come from one call so the
// bar and its pulldown can never disagree about the same moment.
app.get("/api/return-pin", (_req, res) => {
  noteClientActivity();
  res.json({ pin: returnPin, history: returnHistory });
});

// Snap back to where we were before the jump: bring that presentation up
// in ProPresenter's editor (not live) so the operator can pick the next
// slide themselves, then consume the pin. Deliberately focus-only, not a
// trigger — returning must never change what's on the screens mid-service.
app.post("/api/return", async (req, res) => {
  const { presentationId, slideIndex } = req.body ?? {};
  // Identified by value rather than by position: the history can gain an entry
  // between the operator seeing the list and clicking it, which would shift
  // every index and return them somewhere they did not choose. No body means
  // "the most recent", which is the bar's own button.
  const target =
    presentationId !== undefined
      ? findReturnEntry(returnHistory, presentationId, slideIndex)
      : returnPin;
  if (!target) return res.status(409).json({ error: "Nothing to return to." });
  try {
    await client.focusPresentation(target.presentationId);
    // Stand the bar down, but keep the place. The operator has answered "do you
    // want to go back", not "was this ever somewhere you were" -- and a place
    // they returned to once is a place they may want again. The history is what
    // the pulldown reads.
    returnPin = null;
    res.json({ ok: true, returnedTo: target, pinActive: false, history: returnHistory });
  } catch (err) {
    // leave the history intact so the operator can try again
    res.status(502).json({ error: err.message });
  }
});

// --- Live output controls (the "Live" page) ---

// Layers ProPresenter's clear API accepts. "Clear All" fans out across the
// visible ones (audio left alone, since clearing it would cut a playing
// track, which isn't what a screens-focused "clear" button implies).
const CLEAR_LAYERS = ["slide", "media", "props", "messages", "announcements", "video_input"];

// The church's own Looks and Macros, for the big-button grid. Degrades to
// empty lists (not an error) if ProPresenter is unreachable, so the Clear
// buttons still render and work.
app.get("/api/live/controls", async (_req, res) => {
  const [looks, macros, messages] = await Promise.all([
    client.getLooks().catch(() => []),
    client.getMacros().catch(() => []),
    client.getMessages().catch(() => []),
  ]);
  res.json({ looks, macros, messages });
});

app.post("/api/live/clear", async (req, res) => {
  const { layer } = req.body ?? {};
  const layers = layer === "all" ? CLEAR_LAYERS : [layer];
  if (layers.some((l) => !CLEAR_LAYERS.includes(l))) {
    return res.status(400).json({ error: `Unknown layer: ${layer}` });
  }
  try {
    // Clear every requested layer; report a failure only if they all fail,
    // so one unsupported layer can't block clearing the rest of the screen.
    const results = await Promise.allSettled(layers.map((l) => client.clearLayer(l)));
    if (results.every((r) => r.status === "rejected")) {
      throw results[0].reason;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/live/look", async (req, res) => {
  const { id } = req.body ?? {};
  if (!id) return res.status(400).json({ error: "id is required" });
  try {
    await client.triggerLook(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/live/macro", async (req, res) => {
  const { id } = req.body ?? {};
  if (!id) return res.status(400).json({ error: "id is required" });
  try {
    await client.triggerMacro(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/live/message", async (req, res) => {
  const { id, values } = req.body ?? {};
  if (!id) return res.status(400).json({ error: "id is required" });
  try {
    await client.triggerMessage(id, values);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/live/message-clear", async (req, res) => {
  const { id } = req.body ?? {};
  if (!id) return res.status(400).json({ error: "id is required" });
  try {
    await client.clearMessage(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});


// --- Library Sync (optional): one library, one direction, through a shared folder ---
//
// Everything here is inert unless the module is switched on, so a single
// machine setup is unaffected. The heavy lifting and all of the safety rules
// live in library-sync.js; these routes only resolve paths and report.

const LIBRARY_SYNC_STATE = "./cache/library-sync-last-run.json";
// Survives a restart, so an operator who quits ProPresenter and restarts
// Refrain before syncing is not stuck without a library path.
const LIBRARY_SYNC_DIR_CACHE = "./cache/library-sync-library-dir.json";

// One sync at a time. Two overlapping runs would interleave their copies and
// their snapshots, and this writes into a library nobody wants to gamble with.
let librarySyncInFlight = false;

function librarySyncSettings() {
  const mod = config.librarySyncModule ?? {};
  return {
    enabled: Boolean(mod.enabled),
    libraryName: mod.libraryName ?? "Songs",
    direction: mod.direction === "receive" ? "receive" : "send",
    sharedFolder: mod.sharedFolder ?? null,
    minimumFiles: Number.isInteger(mod.minimumFiles) ? mod.minimumFiles : DEFAULT_MINIMUM_FILES,
    snapshotsToKeep: Number.isInteger(mod.snapshotsToKeep) ? mod.snapshotsToKeep : DEFAULT_SNAPSHOTS_TO_KEEP,
  };
}

/**
 * Finds where a library actually lives on disk by asking ProPresenter for one
 * of its presentations and taking that file's folder. Deliberately derived
 * rather than hardcoded: no vendor install layout baked in, and it fails
 * honestly when the library is missing or empty instead of guessing a path.
 */
// The library directory, remembered from the last time ProPresenter told us.
//
// This exists because of a genuine tension the guard exposes: finding the
// library means asking ProPresenter's API, which requires it to be running --
// and writing to the library requires it to be closed. So the path is learned
// while the app is up (a read-only call, safe) and used while it is down.
let cachedLibraryDir = null;

async function resolveLibraryDir(libraryName) {
  const items = await client.getLibrary([libraryName]);
  if (!items?.length) {
    return { dir: null, error: `ProPresenter has no presentations in a library called "${libraryName}".` };
  }
  const doc = await client.getPresentation(items[0].id);
  const dir = libraryDirFromPresentationPath(doc?.presentation?.presentation_path);
  if (!dir) {
    return { dir: null, error: "ProPresenter did not report a file path for that library's presentations." };
  }
  cachedLibraryDir = { libraryName, dir, learnedAt: new Date().toISOString() };
  await writeLastRun(LIBRARY_SYNC_DIR_CACHE, cachedLibraryDir).catch(() => {});
  return { dir, error: null };
}

/** The two ends of the copy, given the configured direction. */
function syncEndpoints(settings, libraryDir) {
  const shared = path.join(settings.sharedFolder, "library");
  return settings.direction === "send"
    ? { from: libraryDir, to: shared, label: "ProPresenter to shared folder" }
    : { from: shared, to: libraryDir, label: "shared folder to ProPresenter" };
}

app.get("/api/library-sync/status", async (_req, res) => {
  const settings = librarySyncSettings();
  const status = getLibrarySyncModuleStatus(config);
  const payload = {
    status,
    settings,
    libraryDir: null,
    from: null,
    to: null,
    preview: null,
    snapshots: [],
    lastRun: await readLastRun(LIBRARY_SYNC_STATE),
    error: null,
  };
  if (status !== "active") return res.json(payload);

  try {
    const { dir, error } = await resolveLibraryDir(settings.libraryName);
    if (error) {
      payload.error = error;
      return res.json(payload);
    }
    payload.libraryDir = dir;
    const ends = syncEndpoints(settings, dir);
    payload.from = ends.from;
    payload.to = ends.to;
    // A dry run, so the operator sees exactly what a sync would do first.
    const [source, dest] = await Promise.all([listLibraryFiles(ends.from), listLibraryFiles(ends.to)]);
    const plan = planSync(source, dest);
    payload.preview = {
      sourceCount: source.length,
      destCount: dest.length,
      toCopy: plan.toCopy.length,
      toReplace: plan.toReplace.length,
      unchanged: plan.unchanged.length,
      extra: plan.extra.length,
    };
    payload.snapshots = (await listSnapshots(path.join(settings.sharedFolder, "snapshots"))).slice(-12).reverse();
  } catch (err) {
    payload.error = err.message;
  }
  res.json(payload);
});

app.post("/api/library-sync/run", async (_req, res) => {
  if (getLibrarySyncModuleStatus(config) !== "active") {
    return res.status(400).json({ error: "Library Sync is not switched on and configured yet." });
  }
  if (librarySyncInFlight) {
    return res.status(409).json({ error: "A sync is already running. Wait for it to finish." });
  }
  const settings = librarySyncSettings();

  /**
   * Nothing touches a library while ProPresenter is running.
   *
   * This is the fix for three corrupted workspaces. Receive writes .pro files
   * into the live library directory; send reads it. Doing either under a
   * running ProPresenter is how its catalog and the filesystem diverge, and a
   * torn file captured by `send` propagates to every other machine.
   *
   * Checked here rather than deeper down so it covers both directions and
   * cannot be reached around, and it refuses rather than warns.
   */
  const librarySafety = () =>
    checkLibrarySafeToTouch({
      apiProbe: async () => {
        try {
          // Cheapest call that proves the app is answering.
          await client.testConnection();
          return true;
        } catch {
          return false;
        }
      },
    });

  const safety = await librarySafety();
  if (!safety.safe) {
    return res.status(409).json({
      error: `${safety.reason} Library Sync copies presentation files in and out of the library ` +
        `folder, and doing that while ProPresenter has the workspace open can corrupt it.`,
      blockedBy: "propresenter-running",
      evidence: safety.evidence,
    });
  }

  librarySyncInFlight = true;
  try {
    // With ProPresenter closed the API cannot tell us where the library is, so
    // use the path learned the last time it was open.
    let dir = null;
    const live = await resolveLibraryDir(settings.libraryName).catch(() => ({ dir: null, error: null }));
    if (live.dir) {
      dir = live.dir;
    } else {
      const cached = cachedLibraryDir ?? (await readLastRun(LIBRARY_SYNC_DIR_CACHE));
      if (cached?.libraryName === settings.libraryName && cached.dir) {
        dir = cached.dir;
      }
    }
    if (!dir) {
      return res.status(409).json({
        error:
          `Refrain does not know where the "${settings.libraryName}" library lives on disk yet. ` +
          `Open the Library Sync screen once with ProPresenter running so it can learn the path, ` +
          `then quit ProPresenter and sync.`,
      });
    }

    const ends = syncEndpoints(settings, dir);
    const snapshotsDir = path.join(settings.sharedFolder, "snapshots");

    // Snapshot the side we are about to read FROM, before anything is written.
    // Cheap (unchanged files are hard-linked) and it is the restore point.
    const snapshot = await takeSnapshot({
      sourceDir: ends.from,
      snapshotsDir,
      keep: settings.snapshotsToKeep,
    });

    // The snapshot above reads the source folder and takes real time, so ask
    // again before starting the part that writes.
    const stillSafeAfterSnapshot = await librarySafety();
    if (!stillSafeAfterSnapshot.safe) {
      return res.status(409).json({
        error: `${stillSafeAfterSnapshot.reason} Nothing was copied. The snapshot was taken, so you can retry safely.`,
        blockedBy: "propresenter-running",
        evidence: stillSafeAfterSnapshot.evidence,
      });
    }

    const result = await syncLibrary({
      sourceDir: ends.from,
      destDir: ends.to,
      // Anything about to be replaced is preserved first, dated.
      backupDir: path.join(settings.sharedFolder, "replaced", new Date().toISOString().slice(0, 10)),
      minimumFiles: settings.minimumFiles,
      // Re-asked as the copy proceeds. A sync over a network share runs for
      // minutes, and ProPresenter launching partway through is the corruption
      // case the up-front check cannot see.
      safeToContinue: librarySafety,
    });

    const record = {
      at: new Date().toISOString(),
      direction: settings.direction,
      label: ends.label,
      from: ends.from,
      to: ends.to,
      snapshot: snapshot.name,
      snapshotLinked: snapshot.linked,
      ...result,
    };
    await writeLastRun(LIBRARY_SYNC_STATE, record);
    res.status(result.ok ? 200 : 409).json(record);
  } catch (err) {
    res.status(502).json({ error: err.message });
  } finally {
    librarySyncInFlight = false;
  }
});

app.post("/api/library-sync/config", async (req, res) => {
  const body = req.body ?? {};
  const current = config.librarySyncModule ?? {};
  const next = { ...current };

  if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
  if (body.libraryName !== undefined) next.libraryName = String(body.libraryName).trim() || null;
  if (body.direction !== undefined) {
    if (body.direction !== "send" && body.direction !== "receive") {
      return res.status(400).json({ error: 'direction must be "send" or "receive"' });
    }
    next.direction = body.direction;
  }
  if (body.sharedFolder !== undefined) next.sharedFolder = String(body.sharedFolder).trim() || null;
  if (body.minimumFiles !== undefined) {
    const n = Number(body.minimumFiles);
    if (!Number.isInteger(n) || n < 1) {
      return res.status(400).json({ error: "The safety floor must be a whole number of at least 1." });
    }
    next.minimumFiles = n;
  }
  if (body.snapshotsToKeep !== undefined) {
    const n = Number(body.snapshotsToKeep);
    if (!Number.isInteger(n) || n < 0) {
      return res.status(400).json({ error: "Snapshots to keep must be 0 or more." });
    }
    next.snapshotsToKeep = n;
  }

  const newConfig = { ...config, librarySyncModule: next };
  try {
    await saveConfig(newConfig);
  } catch (err) {
    return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
  }
  config = newConfig;
  res.json({ ok: true, settings: librarySyncSettings(), status: getLibrarySyncModuleStatus(config) });
});

// --- Spell check (typo-finding for a chosen playlist's slides) ---

const SPELLCHECK_MIN_LIBRARY_HITS = 2; // a word in >= this many presentations is treated as known church vocabulary
const SPELLCHECK_MAX_PRESENTATIONS = 120; // guard against an enormous playlist

/** Lowercased words that appear across enough of the indexed library to be real vocabulary, not typos. */
function libraryKnownWords() {
  const known = new Set();
  const counts = new Map();
  for (const entry of Object.values(getIndex().presentations)) {
    const inThis = new Set();
    for (const slide of entry.slides ?? []) for (const w of tokenize(slide.text)) inThis.add(w.toLowerCase());
    for (const w of inThis) {
      const n = (counts.get(w) ?? 0) + 1;
      counts.set(w, n);
      if (n >= SPELLCHECK_MIN_LIBRARY_HITS) known.add(w);
    }
  }
  return known;
}

/** Flattens ProPresenter's playlist tree into a selectable list of {id, name}. */
function flattenPlaylists(node, out = []) {
  if (Array.isArray(node)) {
    for (const n of node) flattenPlaylists(n, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node.playlists)) flattenPlaylists(node.playlists, out);
  const id = node.id?.uuid ?? node.uuid;
  const name = node.id?.name ?? node.name;
  if (node.field_type === "playlist" && id && name) out.push({ id, name });
  flattenPlaylists(node.children ?? [], out);
  return out;
}

app.get("/api/spellcheck/playlists", async (_req, res) => {
  try {
    const tree = await client.getPlaylists();
    res.json({ playlists: flattenPlaylists(tree), allowlist: config.spellcheckModule?.allowlist ?? [] });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/spellcheck/scan", async (req, res) => {
  const { playlistId } = req.body ?? {};
  if (!playlistId) return res.status(400).json({ error: "playlistId is required" });
  try {
    const [{ items }, speller] = await Promise.all([client.getPlaylistItems(playlistId), loadSpeller()]);
    const knownWords = libraryKnownWords();
    const allowlist = new Set((config.spellcheckModule?.allowlist ?? []).map((w) => w.toLowerCase()));

    const presentations = [];
    const scanned = items.slice(0, SPELLCHECK_MAX_PRESENTATIONS);
    for (const item of scanned) {
      let slides;
      try {
        slides = extractSlides(await client.getPresentation(item.id), preferredArrangements());
      } catch {
        continue; // a single unreadable presentation shouldn't sink the whole scan
      }
      const flaggedSlides = [];
      for (const slide of slides) {
        const words = findTypos(slide.text, { knownWords, allowlist, speller });
        // Carry the slide's anchor so Go Live from here survives an
        // arrangement switch between this scan and the click.
        if (words.length) {
          flaggedSlides.push({
            slideIndex: slide.index,
            groupId: slide.groupId ?? null,
            groupOffset: slide.groupOffset ?? null,
            text: slide.text,
            words,
          });
        }
      }
      if (flaggedSlides.length) {
        presentations.push({ presentationId: item.id, presentationName: item.name, slides: flaggedSlides });
      }
    }

    res.json({ presentations, scannedCount: scanned.length, truncated: items.length > scanned.length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * Saves an allowlist, only swapping the in-memory config once the write has
 * actually landed. The previous version updated config first, so a failed write
 * left the running app disagreeing with the file on disk.
 */
async function saveAllowlist(allowlist, res) {
  const next = { ...config, spellcheckModule: { ...config.spellcheckModule, allowlist } };
  try {
    await saveConfig(next);
  } catch (err) {
    return res.status(500).json({ error: `Failed to save the ignored words: ${err.message}` });
  }
  config = next;
  return res.json({ ok: true, allowlist });
}

app.get("/api/spellcheck/allowlist", (_req, res) => {
  res.json({ allowlist: config.spellcheckModule?.allowlist ?? [] });
});

app.post("/api/spellcheck/allow", async (req, res) => {
  const { word, words } = req.body ?? {};
  // Accepts one word (the inline Ignore button) or a typed list, so a whole
  // set of known-good church vocabulary can be pasted in at once.
  const incoming = parseWordList(words ?? word);
  if (!incoming.length) return res.status(400).json({ error: "Type at least one word to ignore." });
  return saveAllowlist(addToAllowlist(config.spellcheckModule?.allowlist ?? [], incoming), res);
});

app.post("/api/spellcheck/unallow", async (req, res) => {
  const { word, words } = req.body ?? {};
  const outgoing = parseWordList(words ?? word);
  if (!outgoing.length) return res.status(400).json({ error: "Say which word to stop ignoring." });
  return saveAllowlist(removeFromAllowlist(config.spellcheckModule?.allowlist ?? [], outgoing), res);
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

app.get("/api/scripture/config", (_req, res) => {
  const s = config.scriptureModule ?? {};
  res.json({
    biblegatewayVersion: s.biblegatewayVersion ?? "NIV",
    blueletterTranslation: s.blueletterTranslation ?? "KJV",
  });
});

app.get("/api/slide-splitters", async (_req, res) => {
  const splitters = await discoverSlideSplitters();
  res.json({ splitters: splitters.map((S) => ({ id: S.splitterId, displayName: S.displayName ?? null })) });
});

// Generic text -> slides splitter, shared by the lyrics helper and the
// Scripture page (both let the user paste text they copied from a site).
app.post("/api/slides/split", async (req, res) => {
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


/**
 * Read-only first aid for "ProPresenter won't start".
 *
 * Deliberately diagnosis only: it reports what it sees and hands back a command
 * plus a ready-made prompt, and never kills a process or moves a file itself.
 * Refrain stays up when ProPresenter doesn't, which is what makes this useful
 * at all, but that is also why it must not be able to make things worse.
 */
app.get("/api/propresenter/diagnose", async (_req, res) => {
  const host = config.propresenter?.host ?? "localhost";
  const port = config.propresenter?.port ?? null;
  const isLocalHost = Boolean(client.isLocalHost);

  let connected = false;
  try {
    await client.testConnection();
    connected = true;
  } catch {
    connected = false;
  }

  // Only look at this machine's files when this machine is the one running
  // ProPresenter; otherwise the answers would describe the wrong computer.
  let processes = { available: false };
  let workspaceState = { available: false, workspaces: [] };
  let crashReports = { available: false, reports: [] };
  let libraryConsistency = { available: false, folders: [], dangling: [] };
  let supportRoot = null;

  if (isLocalHost) {
    try {
      const { stdout } = await execFileAsync("ps", ["-Ao", "pid,ppid,comm"], { timeout: 5000 });
      processes = { available: true, ...findOrphanedHelpers(stdout) };
    } catch {
      processes = { available: false };
    }

    // Prefer a path derived from something real over a hardcoded vendor
    // location: a running helper's own executable path, or a presentation path
    // from the API while it still answers.
    const helperPath = (processes.rows ?? []).map((r) => r.comm).find((c) => c.includes("/ProPresenter/")) ?? null;
    let presentationPath = null;
    if (connected) {
      try {
        const items = await client.getLibrary(config.librarySync?.folders ?? null);
        if (items?.length) {
          const doc = await client.getPresentation(items[0].id);
          presentationPath = doc?.presentation?.presentation_path ?? null;
        }
      } catch {
        /* best effort only */
      }
    }
    supportRoot = deriveSupportRoot({ helperPath, presentationPath, home: homedir() });

    if (supportRoot) {
      workspaceState = await readWorkspaceState(supportRoot);
      libraryConsistency = await readLibraryConsistency(
        supportRoot,
        presentationPath ? path.resolve(path.dirname(presentationPath), "../..") : null
      );
    }
    crashReports = await readCrashReports(homedir());
  }

  res.json({
    checkedAt: new Date().toISOString(),
    host,
    port,
    isLocalHost,
    connected,
    supportRoot,
    findings: buildFindings({
      connected,
      host,
      port,
      isLocalHost,
      processes,
      workspaceState,
      crashReports,
      libraryConsistency,
    }),
  });
});

app.post("/api/setup/scan", async (req, res) => {
  try {
    // Scanning beyond this machine only happens when the caller asks for it.
    const scanNetwork = Boolean(req.body?.scanNetwork);
    const candidates = await scanForProPresenter({
      configuredPort: config.propresenter?.port ?? null,
      scanNetwork,
    });
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
  rebuildIndex(client, config.librarySync, preferredArrangements())
    .then(startWatching)
    .catch((err) => {
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
      preferredArrangements: preferredArrangements(),
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
/**
 * Anything that reached here matched no static file and no route.
 *
 * API callers get JSON, since something in the app is asking and needs a
 * machine-readable answer. A browser gets a page: warm zone, one joke, no
 * setup, and the useful thing (a way back) sitting right next to it.
 */
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: `No such endpoint: ${req.method} ${req.path}` });
  }
  res
    .status(404)
    .type("html")
    .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Not in this arrangement</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      background: #16121C; color: #F4EFF3;
      font-family: ui-sans-serif, system-ui, sans-serif;
      line-height: 1.42;
      padding: 24px;
    }
    .card { max-width: 26rem; }
    h1 {
      font-size: 15px; margin: 0 0 10px;
      letter-spacing: .15em; text-transform: uppercase;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #CBB4F0;
      text-shadow: 0 0 7px rgba(169,111,232,.55), 0 0 18px rgba(169,111,232,.22);
    }
    p { margin: 0 0 14px; color: #A295AC; font-size: 14px; }
    a { color: #F4EFF3; text-decoration: none; border-bottom: 1px solid #3D3348; }
    a:hover { border-bottom-color: #A96FE8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Not in this arrangement</h1>
    <p>That page isn't here. Search is, though.</p>
    <p><a href="/">Back to Refrain</a></p>
  </div>
</body>
</html>`);
});

app.listen(port, "127.0.0.1", async () => {
  console.log(`Refrain running at http://localhost:${port}`);

  if (!configFileExists()) {
    console.log("No config.json found — waiting for first-run setup before indexing.");
    return;
  }

  // Establish whether anything is on the screens before deciding to do work.
  await pollPerformance();
  startPerformancePolling();

  const existing = await loadIndexFromDisk();
  if (!existing) {
    if (frozen()) {
      indexWorkDeferred = "performance mode is on";
      console.log(`No search index cache found, but performance mode is on — not building. ${describePerformance(performance)}`);
      console.log("Search will be empty until you build it from the Health screen.");
    } else {
      console.log("No search index cache found — building initial index...");
      try {
        await rebuildIndex(client, config.librarySync, preferredArrangements());
        console.log("Initial index build complete.");
      } catch (err) {
        console.error("Initial index build failed:", err.message);
        console.error("Check ProPresenter is running with its Network API enabled (Preferences > Network).");
      }
    }
  } else if (shouldAutoRebuild(existing)) {
    if (frozen()) {
      indexWorkDeferred = "performance mode is on";
      console.log(`Cached index is stale, but performance mode is on — not reindexing. ${describePerformance(performance)}`);
      console.log("The existing index still works; it will catch up once performance mode ends.");
    } else {
      console.log("Cached index is stale (older than a day, or built by a previous version) — reindexing changed presentations in background...");
      rebuildIndex(client, config.librarySync, preferredArrangements(), { incremental: true })
        .then(startWatching)
        .catch((err) => console.error("Background rebuild failed:", err.message));
    }
  } else {
    console.log(`Loaded cached index (built ${existing.builtAt}, ${Object.keys(existing.presentations).length} presentations).`);
  }

  // Needs an index first: the folders to watch are derived from where the
  // indexed presentations actually live, not from configuration.
  startWatching();

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
