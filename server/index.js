/**
 * Refrain server entrypoint.
 *
 * See docs/refrain-architecture.md Section 16 for build order —
 * Step 0 is verifying ProPresenter API capabilities against your
 * actual installed version before relying on anything below.
 */
// First, so every line after it carries a timestamp.
import "./log-stamp.js";
import { readFileSync, existsSync, statSync } from "node:fs";
import { copyFile, readdir, mkdir, stat, readFile, chmod, appendFile, rm as rmPath } from "node:fs/promises";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { platform, homedir, networkInterfaces, totalmem } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
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
  getServiceModuleStatus,
  getEnvRequirements,
  registerProviders,
  registerDeliveryBackends,
  getReportModuleStatus,
  getServiceFeedModuleStatus,
  getNetworkModuleStatus,
  deliveryBackendFor,
  cleanFolderSetting,
  ensureMachineId,
  readConfigFileRaw, featureOn, registerFeatureDefaults } from "./config.js";
import { ProPresenterClient, onProPresenterCall } from "./propresenter-client.js";
import { classifyCall, createCallStats, createAskedCounter, parseProPresenterPs, propresenterLoadNotice, formatServiceLine } from "./service-log.js";
import { scanForProPresenter } from "./propresenter-scan.js";
import {
  buildFindings,
  deriveSupportRoot,
  findOrphanedHelpers,
  parseLaunchdManaged,
  propresenterUptimeSeconds,
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
  findDuplicateNames,
  suggestQuery,
  searchOtherArrangements,
  otherSlidesCoverage,
} from "./search-index.js";
import { startLibraryWatch, fullRebuildSuggestion,
  indexStaleness,
  WATCH_DEFAULTS,
} from "./library-watch.js";

/** The same settle window the watcher uses, applied to the first build too. */
const WATCH_SETTLE_MS = WATCH_DEFAULTS.settleAfterReadyMs;
import {
  isLive,
  initialState as initialPerformanceState,
  advance as advancePerformance,
  armManually,
  disarmManually,
  describe as describePerformance,
  transitionReason as performanceTransitionReason,
} from "./performance-mode.js";
import { resolveArrangement, flattenGroups, findLiveIndex, parseSlideIndex, preferredNotSelected, selectedIsPreferred } from "./arrangements.js";
import { pushLiveItem, findReturnEntry } from "./return-history.js";
import { checkLibrarySafeToTouch, shouldAutoRunLibrarySync } from "./library-guard.js";
import { scanOrphanedMedia, resolveMediaPath, workspaceRootsFromLibraryDirs } from "./orphaned-media.js";
import { missingMediaBySlide } from "./pro-media.js";
import { findPastDates } from "./stale-dates.js";
import {
  buildFlag,
  saveFlag,
  listFlags,
  retryPendingFlags,
  flagTypes,
  buildUpdate,
  saveUpdate,
  visibleFlags,
  DEFAULT_FLAGS_FOLDER,
  DEFAULT_KEEP_RESOLVED_DAYS,
} from "./slide-flags.js";
import { heartbeatInterval } from "./heartbeat-pacing.js";
import QRCode from "qrcode";
import { emptyRegistry, seeDevice, setApproved, removeDevice, isApproved, isRemoved, deviceList, loadRegistry, saveRegistry } from "./remote-devices.js";
import { previewTargets, createThumbCache } from "./slide-preview.js";
import { createThumbStore, slideKey as pictureKey } from "./thumb-store.js";
import { readFingerprint } from "./index-fingerprint.js";
import { envEntries, applyEnvEdits, saveEnvFile, readText as readEnvText } from "./env-file.js";
import { crossSiteRefused } from "./request-guard.js";
import { markHidden, setHidden, isControlId, hiddenIds } from "./live-visibility.js";
import { safeSlides, addSafeSlide, removeSafeSlide, renameSafeSlide, moveSafeSlide } from "./safe-slides.js";
import { stageMessages, addStageMessage, removeStageMessage, editStageMessage, moveStageMessage, cleanStageText, messageFieldValue } from "./stage-messages.js";
import { layoutThemes, themesInDeck, themeReport } from "./theme-report.js";
import { createRemoteApp, pushRecent, serviceProgress, pinFailureGuard } from "./remote.js";
import { dailyPin, newSecret, endOfDay } from "./remote-auth.js";
import { randomUUID } from "node:crypto";
import { writeAtomic } from "./append-store.js";
import { createServiceFeed, cleanServiceFeedSettings, applyServiceFeedSettings, effectiveWindows, feedLamp } from "./service-feed.js";
import { createStaffRequests } from "./staff-requests.js";
import { compareToKnownGood, splitByService, recordOf } from "./known-good.js";
import {
  DEFAULT_DAYS_FOLDER,
  DEFAULT_LEAD_MINUTES,
  DEFAULT_TRAIL_MINUTES,
  buildEvent,
  newServiceId,
  dayKey,
  localTimeOn,
  foldDay,
  serviceWindow,
  activeServices,
  shouldHoldPace,
  transitionEvents,
  timelineRows,
  serviceSummary,
  lockinReminder,
  saveEvent,
  readDay,
  retryPendingEvents,
  matchPlaylist,
  stepKey,
} from "./service-days.js";
import { evaluateChecks, checksHeadline } from "./service-checks.js";
import { playbookPhases, checklistState, skippedSteps } from "./service-playbook.js";
import { renderDaySummary, flagsByService } from "./service-summary.js";
import { saveTextRecord, retryPending } from "./append-store.js";
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
import { discoverModules, discoverSlideSplitters, discoverProviders, discoverStorageBackends, discoverDeliveryBackends, moduleNav, moduleClient, moduleSettingsTab } from "./plugin-loader.js";
import { runComparison, suggestMapping, getPendingUploadCount, retryPendingUploads } from "./arrangement-diff.js";
import { startWatcher as startImageCropWatcher, getImageCropStatus, foldersOverlap, websafeToken } from "./image-crop.js";
import { generateQr, getQrHistoryList, getQrHistoryEntry, addQrHistoryEntry, clearQrHistory, QR_LIMITS } from "./qr-code.js";
import { loadSpeller, findTypos, tokenize, addToAllowlist, removeFromAllowlist, parseWordList } from "./spellcheck.js";
import { normalizeSongTitle } from "../providers/planning-center.js";
import * as autostart from "./autostart.js";
import { restartCommand, isConfirmedKill, runByLoginItem } from "./panic.js";
import { autoEndSettings, autoEndPlan, autoEndNote, withAutoNote } from "./auto-end.js";
import { installAsyncErrorCatching, routeErrorHandler } from "./async-routes.js";
import { THEMES, DEFAULT_THEME } from "../public/themes.js";
import { moduleFeatures, featureDefaults, featureForPath } from "./features.js";

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

// Every Express handler in this process answers even when it throws: both
// listeners, any router (async-routes.js).
installAsyncErrorCatching();
const app = express();
let config = loadConfig();
// Before anything asks for module status: the arrangement checks read each
// provider's declared requiredEnv instead of naming a vendor.
registerProviders(await discoverProviders());
// Switchable features, each declared by its own module (server/features.js).
const FEATURES = moduleFeatures(await discoverModules());
registerFeatureDefaults(featureDefaults(FEATURES));
registerDeliveryBackends(await discoverDeliveryBackends());
let client = new ProPresenterClient(config.propresenter);

app.use((req, res, next) => {
  if (crossSiteRefused(req.method, req.get("origin"), req.get("host"))) {
    return res.status(403).json({ error: "Refused: that request came from another website's page." });
  }
  next();
});
/**
 * The kill switch (GitHub issue #15), first after the cross-site guard so
 * nothing Refrain adds later can queue in front of it: it reads nothing from
 * ProPresenter or the index. Only on this app, which listens on this Mac
 * alone; the phone listener has no such route. Logs, answers, and exits 0
 * once the answer has gone, so the page can tell a kill from a hang and the
 * LaunchAgent (KeepAlive: SuccessfulExit false) leaves it stopped.
 */
app.post("/api/panic", express.json(), (req, res) => {
  if (!isConfirmedKill(req.body)) return res.status(400).json({ error: "Send { confirm: true } to stop Refrain." });
  let launchAgent = false;
  try {
    launchAgent = autostart.isSupported() && runByLoginItem(readFileSync(autostart.plistPath(), "utf8"), process.cwd());
  } catch {
    /* no login item */
  }
  const restart = restartCommand({ launchAgent, label: autostart.LABEL, installDir: process.cwd() });
  // The moment someone panics is the moment most worth recording (#13).
  console.log(`Stopped by the kill switch on Settings. Nothing on the screens was changed. To start again: ${restart}`);
  res.on("finish", () => setTimeout(() => process.exit(0), 50));
  setTimeout(() => process.exit(0), 3000); // if the answer never finishes sending
  res.json({ stopping: true, restart, comesBackAtLogin: launchAgent });
});

app.use(express.static("public"));
app.use(express.json());

// A switched-off feature's routes answer "switched off" (Settings › Features).
// One gate for all of them, from the prefixes each module declares, so a
// feature that's off can't be reached by a page left open from before.
app.use((req, res, next) => {
  const f = featureForPath(FEATURES, req.path);
  if (f && !featureOn(config, f.id)) return res.status(404).json({ error: `${f.label} is switched off. Turn it on in Settings › Features.`, feature: f.id, off: true });
  next();
});

// TODO: mount module *routes* discovered via plugin-loader.js, per
// docs/refrain-architecture.md Section 17.11, once a module has real
// server-side endpoints of its own (arrangement, lyrics-assist).

// --- Nav (Section 13) — driven by registered modules, not hardcoded ---

/** Whether a module should appear in the nav at all. */
function navEnabledFor(m) {
  // A switchable feature shows when it's on (Settings › Features); a core
  // module (no `feature` in its module.js) shows as it declares.
  if (m.feature) return featureOn(config, m.id);
  return m.enabledByDefault;
}

/** Every switchable feature with its state, for Settings › Features and the screens. */
const featureStates = () => FEATURES.map((f) => ({ id: f.id, label: f.label, summary: f.summary, description: f.description, default: f.default, parent: f.parent, parentLabel: f.parentLabel, on: featureOn(config, f.id) }));

/**
 * Section 8.4: a write that failed (backend unreachable) is staged locally
 * rather than lost. Retried at start and whenever Arrangement tracking is
 * switched on, so a staged upload is never stranded until the next restart.
 */
async function retryArrangementUploads() {
  if (config.role !== "logger" || getArrangementModuleStatus(config) !== "active") return;
  try {
    const storage = await getStorageBackend();
    const { attempted, succeeded } = await retryPendingUploads(storage);
    if (attempted > 0) console.log(`Retried ${attempted} pending arrangement upload(s) — ${succeeded} succeeded.`);
  } catch (err) {
    console.error("Pending-upload retry failed:", err.message);
  }
}

/**
 * Service days: load today (or yesterday, if a lock-in is still running from
 * it), put performance mode back if a lock-in survived a restart, copy any
 * events that were waiting for the shared folder, and start the minute timer
 * (which checks the switch itself). At start, and when Service day is
 * switched on.
 */
let serviceTimer = null;
async function startServiceDays({ restart = true } = {}) {
  if (!serviceModuleOn()) return;
  try {
    // Switched on while running, the day in memory stays (events still being
    // written would be lost by a reload), and no lock-in is put back: one
    // was released when Service day went off.
    if (!restart) await ensureServiceDay();
    else await loadServiceDay();
    const { lockin } = serviceState();
    if (restart && lockin && !(performance.armed && performance.source === "manual")) {
      setPerformance(armManually(performance, Date.now()));
      console.log(`Still locked in for "${lockin.name}" after the restart. Performance mode back on by hand.`);
    }
    const { folder } = serviceOptions();
    retryPendingEvents({ folder }).catch(() => {});
    serviceTimer ??= setInterval(() => {
      resolveScheduledPlaylists().catch(() => {});
      preServiceReindex().catch(() => {});
    }, 60_000);
    serviceTimer.unref?.();
    const summaryFolder = config.serviceModule?.summaryFolder;
    if (typeof summaryFolder === "string" && summaryFolder.trim()) {
      retryPending([""], { folder: summaryFolder.trim(), pendingDir: summaryPendingDir() }).catch(() => {});
    }
  } catch (err) {
    console.error("Service days could not start:", err.message);
  }
}

/** What the Image Crop watcher runs on: its settings when the feature is on and set up, else nothing. */
const imageCropWatch = (c) => (getImageCropModuleStatus(c) === "active" ? c.imageCropModule : null);

/** The settings that make a feature usable the moment it's switched on. */
function readyFeature(c, id) {
  if (id !== "image-crop") return c;
  const m = { ...c.imageCropModule };
  m.inputFolder ??= DEFAULT_IMAGE_CROP_INPUT;
  m.outputFolder ??= DEFAULT_IMAGE_CROP_OUTPUT;
  if (!m.presets?.length) m.presets = DEFAULT_IMAGE_CROP_PRESETS;
  return { ...c, imageCropModule: m };
}

/** Switches one feature on or off (Settings › Features). */
app.post("/api/features", async (req, res) => {
  const { id, on } = req.body ?? {};
  const f = FEATURES.find((x) => x.id === id);
  if (!f) return res.status(400).json({ error: "No such feature." });
  if (typeof on !== "boolean") return res.status(400).json({ error: "on must be true or false" });
  // Already so (a second tab, a repeat press): nothing to start or stop.
  if (featureOn(config, id) === on) return res.json({ ok: true, features: featureStates() });
  const change = (c) => (on ? readyFeature({ ...c, features: { ...c.features, [id]: true } }, id) : { ...c, features: { ...c.features, [id]: false } });
  // Image Crop starts on the settings it will be saved with. A folder it
  // can't use still switches it on, not watching, so the screen where the
  // folders are fixed is reachable; the answer says why.
  let warning = null;
  if (id === "image-crop") {
    try {
      await startImageCropWatcher(imageCropWatch(change(config)));
    } catch (err) {
      warning = `On, but not watching yet: ${err.message} Fix the folders on the Image Crop screen.`;
    }
  }
  // A lock-in ends with Service day, or performance mode would stay on with
  // its Release button switched off. If it can't be released, Service day
  // stays on.
  if (id === "service" && !on) {
    try {
      await releaseLockin(" (Service day switched off)");
    } catch (err) {
      return res.status(500).json({ error: `The lock-in couldn't be released, so Service day stays on: ${err.message}` });
    }
  }
  try {
    await updateConfig(change);
  } catch (err) {
    // The watcher goes back to what's saved.
    if (id === "image-crop") await startImageCropWatcher(imageCropWatch(config)).catch(() => {});
    const released = id === "service" && !on ? " The lock-in, if there was one, was already released." : "";
    return res.status(500).json({ error: `Couldn't save it: ${err.message}${released}` });
  }
  // What runs on its own starts when its feature does.
  if (on && id === "service") await startServiceDays({ restart: false });
  if (on && id === "arrangement") await retryArrangementUploads();
  console.log(`${f.label} switched ${on ? "on" : "off"} from Settings.`);
  res.json({ ok: true, features: featureStates(), ...(warning ? { warning } : {}) });
});

app.get("/api/modules", async (_req, res) => {
  const modules = await discoverModules();
  res.json({
    features: featureStates(),
    modules: modules.map((m) => ({
      id: m.id,
      navLabel: m.navLabel,
      icon: m.icon,
      route: m.route,
      // Menu placement and the screen's script, both declared by the module
      // itself, so a new module folder needs no edit anywhere else (CLAUDE.md:
      // auto discovery, not central lists).
      nav: moduleNav(m.nav),
      client: moduleClient(m.client),
      settingsTab: moduleSettingsTab(m.settingsTab),
      // "enabled" here means "show in the nav": a switchable feature shows
      // while it's on (Settings › Features), a core module always.
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

/**
 * Is there a newer Refrain?
 *
 * A plain GET of a public `package.json`. Nothing about this machine goes with
 * it -- no identifier, no version, no usage -- which is what keeps it on the
 * right side of the project's "no telemetry, ever" line. It asks a question; it
 * does not report an answer.
 *
 * Cached, because the nav now shows a dot from this and a poll must not turn
 * one question a day into thousands. Six hours: a church updates on a weekday,
 * not on a timer, and a stale-by-an-afternoon answer costs nothing.
 *
 * Skipped entirely while performance mode is armed. Nothing Refrain does
 * unasked should reach the network during a service, and an update is the least
 * urgent thing in the building at that moment.
 */
const VERSION_CHECK_TTL_MS = 6 * 60 * 60_000;
let versionCheckCache = null;

async function checkForUpdate({ force = false } = {}) {
  const fresh = versionCheckCache && Date.now() - versionCheckCache.at < VERSION_CHECK_TTL_MS;
  if (fresh && !force) return versionCheckCache.value;
  if (performance.armed && versionCheckCache) return versionCheckCache.value;

  const base = { currentVersion: version, repoUrl: GITHUB_REPO_URL, gitInstall: existsSync(".git") };
  let value;
  try {
    const ghRes = await fetch(GITHUB_PACKAGE_JSON_URL, { signal: AbortSignal.timeout(5000) });
    if (!ghRes.ok) throw new Error(`GitHub responded ${ghRes.status}`);
    const { version: latestVersion } = await ghRes.json();
    value = { ...base, latestVersion, updateAvailable: isNewerVersion(latestVersion, version) };
  } catch (err) {
    // Offline is the normal state for a booth machine on a locked-down network,
    // so this is not an error the operator needs to see -- it just means "no
    // news", and the Health screen says so quietly.
    value = { ...base, latestVersion: null, updateAvailable: false, error: err.message };
  }
  versionCheckCache = { at: Date.now(), value };
  return value;
}

app.get("/api/version-check", async (req, res) => {
  res.json(await checkForUpdate({ force: req.query.force === "1" }));
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
    // npm rewrites package-lock.json whenever it syncs it to package.json, and
    // a modified lockfile makes `git pull` refuse outright -- which is exactly
    // how an update got blocked in the field. Discarding it loses nothing: it
    // is generated, and the npm install below rebuilds it. The copy-paste
    // command on Health has done this for a while; the one-click route, which
    // is the one a volunteer actually presses, did not.
    await execFileAsync("git", ["checkout", "--", "package-lock.json"], { timeout: 30000 }).catch(() => {});
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
    // Blackroom by default (owner, 2026-09-30): a true-black, high-contrast
    // theme for a dark booth. Any theme the church picks is kept.
    // Only a theme the app has, even if a bad one was saved before themes
    // were checked: anything else would leave every screen unstyled.
    theme: THEMES.includes(config.theme) ? config.theme : DEFAULT_THEME,
    navPinned: config.navPinned ?? null,
    // Null when never chosen, so the frontend can fall back to navPinned for
    // an install that predates the third state.
    navMode: config.navMode ?? null,
    navSide: config.navSide === "left" ? "left" : "right",
    welcomeDismissed: Boolean(config.welcomeDismissed),
    // Search's own choices (owner, 2026-10-04: "so reloading doesn't wipe
    // them"): the libraries switched off (so a library added later is
    // searched), and which date the date filter uses. The date range itself
    // is never kept: a forgotten range would quietly hide songs on a later
    // Sunday.
    searchLibrariesOff: Array.isArray(config.searchLibrariesOff) ? config.searchLibrariesOff.filter((n) => typeof n === "string") : [],
    searchDateField: config.searchDateField === "created" ? "created" : "modified",
  });
});

/**
 * Every change to config.json goes through this one queue (code review,
 * 2026-10-04). Each change is computed from the settings as they are when its
 * turn comes, not when it was asked for, so two changes made together (a
 * Search preference and a theme, an ignored word and a safe slide) can't each
 * save a copy that drops the other's. The write is saveConfig's atomic
 * temp-then-rename, and the running settings are swapped only once it lands.
 * @param {(current: object) => object|Promise<object>} change  returns the new config
 * @returns {Promise<object>} the saved config
 */
let configTurn = Promise.resolve();
function updateConfig(change) {
  const run = configTurn.then(async () => {
    const next = await change(config);
    await saveConfig(next);
    config = next;
    return next;
  });
  configTurn = run.catch(() => {});
  return run;
}

app.post("/api/preferences", async (req, res) => {
  const { theme, navPinned, navMode, navSide, welcomeDismissed, searchLibrariesOff, searchDateField } = req.body ?? {};
  const changes = {};
  if (theme !== undefined) {
    // Only a theme the app has: a stray value would leave every screen unstyled.
    if (!THEMES.includes(theme)) return res.status(400).json({ error: `theme must be one of ${THEMES.join(", ")}` });
    changes.theme = theme;
  }
  if (navPinned !== undefined) changes.navPinned = Boolean(navPinned);
  // Three rail widths rather than two. `navPinned` is still written alongside
  // it so an older Refrain reading this config still gets a sensible rail
  // instead of a missing key.
  if (navSide !== undefined) {
    if (navSide !== "left" && navSide !== "right") {
      return res.status(400).json({ error: "navSide must be left or right" });
    }
    changes.navSide = navSide;
  }
  if (navMode !== undefined) {
    if (!["full", "icons", "sliver"].includes(navMode)) {
      return res.status(400).json({ error: "navMode must be full, icons or sliver" });
    }
    changes.navMode = navMode;
    changes.navPinned = navMode === "full";
  }
  if (welcomeDismissed !== undefined) changes.welcomeDismissed = Boolean(welcomeDismissed);
  if (searchLibrariesOff !== undefined) {
    if (!(Array.isArray(searchLibrariesOff) && searchLibrariesOff.length <= 200 && searchLibrariesOff.every((n) => typeof n === "string" && n.length <= 200))) {
      return res.status(400).json({ error: "searchLibrariesOff must be a list of library names" });
    }
    changes.searchLibrariesOff = searchLibrariesOff;
  }
  if (searchDateField !== undefined) {
    if (!["modified", "created"].includes(searchDateField)) return res.status(400).json({ error: "searchDateField must be modified or created" });
    changes.searchDateField = searchDateField;
  }

  try {
    await updateConfig((c) => ({ ...c, ...changes }));
  } catch (err) {
    return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
  }
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

    // Only the sections this form changed are written over the settings as
    // they are at its turn, so a change saved meanwhile elsewhere stays.
    const before = config;
    // Not features: those are switched one at a time on Settings › Features,
    // and a switch flipped meanwhile must stay flipped.
    const touched = Object.keys(newConfig).filter((k) => k !== "features" && JSON.stringify(newConfig[k]) !== JSON.stringify(before[k]));
    try {
      await updateConfig((c) => ({ ...c, ...Object.fromEntries(touched.map((k) => [k, newConfig[k]])) }));
    } catch (err) {
      return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
    }
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
/**
 * .env from Settings > Features (server/env-file.js). The values are only ever
 * served by this app, which listens on this Mac; the phone listener has no
 * route to them. Saving keeps the old file as .env.previous and takes effect
 * at the next restart, since .env is read once at startup.
 */
app.get("/api/env", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ entries: envEntries(await readEnvText(ENV_PATH), await readEnvText(ENV_EXAMPLE_PATH)) });
});

app.post("/api/env", async (req, res) => {
  const edits = req.body?.edits;
  if (!edits || typeof edits !== "object" || Array.isArray(edits)) return res.status(400).json({ error: "Nothing to save." });
  let text;
  try {
    text = applyEnvEdits(await readEnvText(ENV_PATH), edits);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    await saveEnvFile(ENV_PATH, text);
  } catch (err) {
    return res.status(500).json({ error: `Couldn't save .env: ${err.message}. Nothing changed.` });
  }
  console.log(`.env saved from Settings (${Object.keys(edits).length} value${Object.keys(edits).length === 1 ? "" : "s"}; previous copy in .env.previous). Takes effect at the next restart.`);
  res.json({ ok: true, entries: envEntries(text, await readEnvText(ENV_EXAMPLE_PATH)) });
});

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
 * Set while the operator has asked a running rebuild to stand down.
 *
 * Cleared when the next rebuild starts, so a stop applies to the run it was
 * aimed at and never silently blocks the next one.
 */
let rebuildStopRequested = false;

/**
 * Every rebuild goes through here, so none of them can forget the stop hook.
 *
 * `operatorInitiated` is the important half. Performance mode's promise is
 * that Refrain stops doing things *on its own* -- "anything the operator
 * presses still works; they are in charge". So a crawl Refrain started by
 * itself stands down when something goes live, and a crawl someone pressed a
 * button for does not: that one stops only when they say so.
 *
 * Without the distinction this would have quietly broken both Health rebuild
 * buttons, because performance mode also arms whenever ProPresenter is
 * unreachable -- which is exactly when someone is most likely to be pressing
 * Rebuild to fix things.
 */
/**
 * Protect ProPresenter (owner, 2026-10-04, after the main station's
 * ProPresenter was damaged overnight). **On unless `protectProPresenter` is
 * false**, turned off only on Settings › Search › Advanced. While on, Refrain
 * never reads the whole library from ProPresenter, the heaviest thing it asks
 * of it (each presentation about 10 MB that ProPresenter keeps until it
 * restarts): no index run of any kind, automatic or pressed, and none of the
 * playlist-wide readers (Spell Check, the pre-service checks, the FS/T
 * report's unknowns, Update pictures and pre-render). Search keeps working
 * from the saved index; Go Live, Now, Clear and the rest are unaffected.
 */
const protectOn = () => config.protectProPresenter !== false;
const PROTECT_REFUSAL =
  "Protect ProPresenter is on, so Refrain doesn't read presentations from ProPresenter in bulk. Search uses the index it already has. To run this, turn protection off in Settings › Search › Advanced.";

function startRebuild({ incremental = false, operatorInitiated = false } = {}) {
  // The one door every index run goes through, so no caller can forget.
  if (protectOn()) {
    indexWorkDeferred = "Protect ProPresenter is on: the index isn't read from ProPresenter";
    return Promise.reject(Object.assign(new Error(PROTECT_REFUSAL), { status: 409, protected: true }));
  }
  rebuildStopRequested = false;
  const started = Date.now();
  diag("index-start", { incremental, operatorInitiated, performance: { armed: performance.armed, source: performance.source } });
  const run = rebuildIndex(client, config.librarySync, preferredArrangements(), {
    incremental,
    // An operator's run still stands down when content goes live or
    // performance mode is switched on by hand: pressing Refresh at 07:38 is
    // not consent to crawl through the service (issue #13: it did). It
    // ignores only the "not answering" arm, which a crawl ProPresenter is
    // too busy to answer would otherwise trip on itself.
    shouldStop: operatorInitiated
      ? () => rebuildStopRequested || (performance.armed && performance.source !== "unknown")
      : () => rebuildStopRequested || frozen(),
  });
  run.then(
    (index) => diag("index-end", { ms: Date.now() - started, mode: index?.buildMode, attempted: index?.reindexAttempted, completed: index?.reindexCompleted, partial: index?.partial ?? null }),
    (err) => diag("index-end", { ms: Date.now() - started, error: err?.message })
  );
  return run;
}

/**
 * Why an operator's index run can't start now, or null. Refused up front
 * rather than started and stopped, and in words: performance mode is on, or
 * ProPresenter only just launched and is still busy loading (issue #11: a
 * crawl started at 113% CPU three minutes after launch).
 */
/**
 * The reasons an index run is held that can be answered without an await, so
 * a screen can know *before* offering a button whether pressing it would be
 * refused. Split out of operatorIndexRefusal() rather than duplicated, so the
 * sentence an operator reads on Search is the same one the route would have
 * sent back after a wasted press.
 */
function indexRunHeldReason() {
  if (protectOn()) return PROTECT_REFUSAL;
  if (performance.armed && performance.source !== "unknown") {
    return `Performance mode is on: ${describePerformance(performance)} The index won't run now; it catches up on its own after an hour with nothing on the screens.`;
  }
  // Performance mode arms after two minutes of content, so just after a
  // restart it can be off with a service on the screens.
  if (liveState.live) return "Something is on the screens, so the index won't run now: each presentation it reads makes ProPresenter wait. Run it when nothing is live.";
  return null;
}

async function operatorIndexRefusal() {
  const held = indexRunHeldReason();
  if (held) return held;
  const readyFor = await propresenterReadyForMs();
  if (readyFor != null && readyFor < WATCH_SETTLE_MS) {
    const wait = Math.max(1, Math.ceil((WATCH_SETTLE_MS - readyFor) / 60_000));
    return `ProPresenter started ${Math.round(readyFor / 1000)}s ago and is still loading. Try again in about ${wait} min.`;
  }
  return null;
}

// Refrain's own catch-up: the only time it starts an index run unasked,
// besides the watcher's handful of edited files. Not when performance mode
// ends, which on a Sunday is the moment ProPresenter launches (issue #11),
// but after an hour with nothing on the screens, outside any service window,
// with ProPresenter settled. A stale index that stays stale until the
// afternoon is a far smaller problem than a sluggish ProPresenter at setup.
const QUIET_CATCHUP_MS = 60 * 60_000;
let performanceOffSince = Date.now();
let catchUpCheckedAt = 0;
// After a catch-up that didn't finish (ProPresenter stopped answering, or it
// was stood down), wait this long before trying again rather than asking a
// struggling ProPresenter for the library every minute.
const CATCHUP_RETRY_MS = 3 * 3_600_000;
let catchUpNotBefore = 0;
// Not tied to autoReindex, which is about the file watcher: a stale or
// older-schema index was always caught up at boot whatever that says, and this
// is where that now happens.
async function maybeCatchUpIndex(now = Date.now()) {
  if (protectOn() || now - catchUpCheckedAt < 60_000 || now < catchUpNotBefore) return;
  catchUpCheckedAt = now;
  if (frozen() || liveState.live || holdHeartbeatPace(now) || getRebuildProgress().inProgress) return;
  if (performanceOffSince == null || now - performanceOffSince < QUIET_CATCHUP_MS) return;
  if (!shouldAutoRebuild(getIndex())) return;
  const readyFor = await propresenterReadyForMs();
  if (readyFor == null || readyFor < WATCH_SETTLE_MS) return;
  indexWorkDeferred = null;
  console.log("Nothing has been on the screens for an hour: catching the search index up now.");
  startRebuild({ incremental: true })
    .then((index) => {
      if (index?.partial) {
        catchUpNotBefore = Date.now() + CATCHUP_RETRY_MS;
        console.log(`The catch-up didn't finish (${index.partial.read} of ${index.partial.of}). Trying again in ${CATCHUP_RETRY_MS / 3_600_000} hours, or press Refresh.`);
      }
      startWatching();
    })
    .catch((err) => {
      catchUpNotBefore = Date.now() + CATCHUP_RETRY_MS;
      console.error("Catch-up reindex failed:", err.message);
    });
}

/**
 * Performance mode: while it is armed, Refrain does nothing on its own.
 *
 * Replaces the old Saturday/Sunday deferral. The day of the week was a proxy
 * for "a service is happening"; ProPresenter's own layer status is the actual
 * answer, and it is right about Wednesday evenings and empty Saturdays alike.
 */
let performance = initialPerformanceState();
// Every change of performance mode goes through here, so the quiet timers
// (index catch-up, slide pictures) see a lock-in or a manual arm ending, not
// only the heartbeat's own transitions.
function setPerformance(next, now = Date.now()) {
  if (next.armed !== performance.armed) performanceOffSince = next.armed ? null : now;
  performance = next;
}
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

// Set by beat(): brings the next beat forward when the pace should be faster
// than the one already scheduled (a browser arriving, a lock-in, a service
// added), instead of waiting out a 30s idle gap first.
let quickenHeartbeat = () => {};
// Runs a beat now (set by startPerformancePolling), for right after Refrain
// itself changed the slide, so the readout and previews catch up in a
// fraction of a second instead of at the next scheduled beat.
let beatNow = () => {};
export function noteClientActivity() {
  lastClientAt = Date.now();
  quickenHeartbeat();
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

// --- Service days (handoff section 37, phase 1) ---------------------------
//
// The day's events in memory, mirrored to disk as they happen (one file each,
// see server/service-days.js). Folded fresh whenever it is needed: a day is a
// few hundred events at most, and a fold nobody caches cannot go stale.
let serviceDay = { day: null, events: [], loading: null };
let recentSlides = [];

/** Where a phone on the church network would open the flag page, one URL per network address. */
function networkUrls() {
  const port = Number(config.networkModule?.port ?? 9997);
  const host = config.networkModule?.host;
  // Bound to one address: that's the only one that works, so it's the only one shown.
  if (typeof host === "string" && host && host !== "0.0.0.0") {
    return [`http://${/^(127\.|localhost$|::1$)/.test(host) ? "127.0.0.1" : host}:${port}/`];
  }
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(`http://${a.address}:${port}/`);
  }
  return out;
}

// --- The phone PIN (server/remote-auth.js) ----------------------------------
//
// The secret behind the daily PIN and every phone token lives on this
// machine only, in data/, never in config.json (which gets exported and
// shared). Created the first time it's needed; replaced by "Forget all
// phones". Written atomically, like every other file a volunteer would miss.
const REMOTE_SECRET_FILE = "./data/remote-secret.json";
let remoteSecret = null;
function loadRemoteSecret() {
  if (remoteSecret) return remoteSecret;
  try {
    // A secret others can read has to be treated as known: start again.
    if (statSync(REMOTE_SECRET_FILE).mode & 0o077) throw new Error("not private");
    remoteSecret = JSON.parse(readFileSync(REMOTE_SECRET_FILE, "utf-8")).secret ?? null;
  } catch {
    remoteSecret = null;
  }
  if (!remoteSecret) {
    remoteSecret = newSecret();
    saveRemoteSecret().catch((err) =>
      console.error("Couldn't save the phone PIN secret; phones will need the PIN again after a restart:", err.message)
    );
  }
  return remoteSecret;
}
async function saveRemoteSecret() {
  // Created readable only by the account Refrain runs as (never briefly
  // open to others), and checked afterwards: if it isn't private, it isn't
  // used, because this secret signs every phone and derives every PIN.
  await writeAtomic(path.dirname(REMOTE_SECRET_FILE), path.basename(REMOTE_SECRET_FILE), { secret: remoteSecret, createdAt: new Date().toISOString() }, { mode: 0o600 });
  const { mode } = await stat(REMOTE_SECRET_FILE);
  if (mode & 0o077) {
    await chmod(REMOTE_SECRET_FILE, 0o600);
    if ((await stat(REMOTE_SECRET_FILE)).mode & 0o077) throw new Error("the phone PIN secret file can't be made private");
  }
}
async function forgetAllPhones() {
  remoteSecret = newSecret();
  await saveRemoteSecret();
}
const remotePinGuard = pinFailureGuard({ dayOf: (now) => dayKey(now) });
const DEFAULT_PIN_HINT = "Today's PIN is in the Phone panel in the booth. Ask whoever is running the screens.";
function remotePinMode() {
  const pin = config.networkModule?.pin;
  if (pin === "daily") return "daily";
  return /^\d{4,8}$/.test(String(pin ?? "")) ? "fixed" : "none";
}
function expectedRemotePin(now = Date.now()) {
  const mode = remotePinMode();
  if (mode === "daily") return dailyPin(loadRemoteSecret(), dayKey(now));
  if (mode === "fixed") return String(config.networkModule.pin);
  return null;
}

// --- Phones, one by one (server/remote-devices.js) ---------------------------
const REMOTE_DEVICES_FILE = "./data/remote-devices.json";
let remoteDevices = emptyRegistry();
let remoteDevicesLoaded = false;
let remoteDevicesDirty = false;
async function ensureRemoteDevices() {
  if (remoteDevicesLoaded) return;
  remoteDevices = await loadRegistry(REMOTE_DEVICES_FILE);
  remoteDevicesLoaded = true;
}
// "Last seen" changes on every request; it's saved at most every 30s. A
// sign-in, an approval or a removal is saved straight away.
function changeDevices(next, { now = false } = {}) {
  remoteDevices = next;
  remoteDevicesDirty = true;
  if (now) flushRemoteDevices();
}
function flushRemoteDevices() {
  if (!remoteDevicesDirty) return;
  remoteDevicesDirty = false;
  saveRegistry(REMOTE_DEVICES_FILE, remoteDevices).catch((err) => console.error("Couldn't save the phone list:", err.message));
}
setInterval(flushRemoteDevices, 30_000).unref?.();

/** The last phone control presses, newest first, for Live and the phone panel. */
let phoneActivity = [];
function notePhoneAction(entry) {
  phoneActivity = [{ at: new Date().toISOString(), ...entry }, ...phoneActivity].slice(0, 20);
  console.log(`Phone "${entry.phone}": ${entry.label}${entry.ok ? "" : ` (failed: ${entry.error})`}`);
}

// Pictures of slides, for the current/next previews (server/slide-preview.js).
// Pictures rendered ahead of time come off disk; anything else is asked of
// ProPresenter (at most two at once, see slide-preview.js) and kept for next
// time. Keyed to the index fingerprint, so an edited presentation re-renders.
const thumbStore = createThumbStore({ dir: "./data/slide-pictures" });
/**
 * Which version of a presentation a picture belongs to: its .pro file's size
 * and modified time, read now (a stat, local disk). Read live rather than
 * taken from the index, which catches up with an edit only after the watcher
 * settles: remove a slide in ProPresenter and every later slide moves up one,
 * so a picture kept under the old version would show the wrong slide at its
 * number. Falls back to the index's when the file can't be read (ProPresenter
 * on another Mac).
 */
// Remembered for a few seconds: a screen asking for several pictures of one
// presentation (or re-checking them) costs one look at the file.
const pictureFingerprints = new Map(); // pid -> { at, fp }
async function pictureFingerprint(pid) {
  const seen = pictureFingerprints.get(pid);
  if (seen && Date.now() - seen.at < 3000) return seen.fp;
  const entry = getIndex().presentations?.[pid];
  const fp = (client.isLocalHost && entry?.presentationPath ? await readFingerprint(entry.presentationPath) : null) ?? entry?.fingerprint ?? null;
  pictureFingerprints.set(pid, { at: Date.now(), fp });
  if (pictureFingerprints.size > 500) pictureFingerprints.delete(pictureFingerprints.keys().next().value);
  return fp;
}
/**
 * Slide pictures on or off, everywhere (owner, 2026-10-04: "disable all image
 * previews ... temporary"). **Off unless `slidePictures.show` is true**, set
 * on Settings › Phones › Slide pictures. While off, Refrain asks ProPresenter
 * for no picture at all: every route that serves one answers "no picture",
 * the Update and pre-render runs don't start, and the screens show the
 * slide's words instead. Turning it back on is the one switch.
 */
const picturesOn = () => config.slidePictures?.show === true;

/**
 * Quick slides keep their pictures while pictures are off (owner,
 * 2026-10-07: "allow Refrain to collect images of any saved quick slide").
 * At most eight safe slides, each drawn once and kept on disk, so a volunteer
 * can tell the logo from the blank at a glance. On unless
 * `slidePictures.quickSlides` is false (Settings › Phones › Slide pictures).
 */
const quickSlidePicturesOn = () => config.slidePictures?.quickSlides !== false;
const isSafeSlide = (pid, idx) => safeSlides(config.liveModule?.safeSlides).some((x) => x.presentationId === pid && x.slideIndex === idx);
/** Whether a picture of this slide may be shown or drawn at all. */
const pictureAllowed = (pid, idx) => picturesOn() || (quickSlidePicturesOn() && isSafeSlide(pid, idx));

const thumbCache = createThumbCache(
  async (pid, idx, fp) => {
    if (!pictureAllowed(pid, idx)) return null;
    const img = await client.getSlideThumbnail(pid, idx);
    if (img && fp) thumbStore.put(pid, idx, fp, img).catch(() => {});
    return img;
  },
  // Checked before a picture waits for one of the two ProPresenter slots:
  // a stored one is a disk read, and shouldn't queue behind renders.
  { stored: (pid, idx, fp) => thumbStore.get(pid, idx, fp).catch(() => null) }
);
/**
 * Draws any saved quick slide that has no picture on disk yet, one at a time:
 * when one is saved, and when quick-slide pictures are switched on. Never
 * during a service (performance mode), when nothing new is drawn; the menu
 * shows the name until there's a picture.
 */
let collectingQuickSlides = false;
async function collectQuickSlidePictures() {
  if (collectingQuickSlides || !quickSlidePicturesOn()) return;
  collectingQuickSlides = true;
  try {
    for (const s of safeSlides(config.liveModule?.safeSlides)) {
      if (performance.armed || !pictureAllowed(s.presentationId, s.slideIndex)) break;
      const fp = await pictureFingerprint(s.presentationId).catch(() => null);
      if (!fp || (await storedSlideThumb(s.presentationId, s.slideIndex))) continue;
      await thumbCache(s.presentationId, s.slideIndex, fp).catch(() => null);
    }
  } finally {
    collectingQuickSlides = false;
  }
}

/** A picture already rendered and kept on disk, or null. Never asks ProPresenter. */
async function storedSlideThumb(pid, idx) {
  const fp = await pictureFingerprint(pid);
  return fp ? thumbStore.get(pid, idx, fp).catch(() => null) : null;
}
// The store's size cap is kept whether or not pre-rendering is on.
setInterval(() => thumbStore.prune().catch(() => {}), 3_600_000).unref();

// --- Slide pictures ahead of the service (owner request, 2026-09-27) ---------
// Today's service playlists, plus any named in config `slidePictures.playlists`,
// rendered one picture at a time while nothing is on the screens and no
// service window is open. **Off unless `slidePictures.prerender` is true**:
// ProPresenter keeps ~1-2 MB for every slide it draws until it restarts, so
// rendering ahead only pays when ProPresenter is restarted before the service
// (rendered the day before, say). The disk store works either way. It stops the moment either changes. Sunday morning
// is usually live from the first slide, so in practice this runs the day
// before or between services, which is when the work belongs.
const PRERENDER_CHECK_MS = 5 * 60_000;
const PRERENDER_PACING_MS = 100;
let prerenderCheckedAt = 0;
let slidePicturesStatus = { lastRunAt: null, presentations: 0, ready: 0, rendered: 0, stopped: false };
async function prerenderTargets() {
  const ids = new Map();
  if (serviceModuleOn() && serviceDay.day) {
    for (const s of serviceState().services) for (const it of s.playlist?.items ?? []) if (it.presentationId) ids.set(it.presentationId, it.name);
  }
  const pinned = Array.isArray(config.slidePictures?.playlists) ? config.slidePictures.playlists : [];
  if (pinned.length) {
    const all = flattenPlaylists(await client.getPlaylists());
    for (const want of pinned) {
      const pl = all.find((p) => p.id === want || String(p.name ?? "").toLowerCase() === String(want).toLowerCase());
      if (!pl) continue;
      const { items } = await client.getPlaylistItems(pl.id);
      for (const it of items) if (it.id) ids.set(it.id, it.name);
    }
  }
  return ids;
}
// Quiet means nothing on the screens right now, performance mode off for 10
// minutes (it only arms after 2 minutes of content, so just after a restart
// mid-service it is still off), no service window, and no index run.
const PRERENDER_QUIET_MS = 10 * 60_000;
const quietForPictures = (now = Date.now()) =>
  !frozen() &&
  !liveState.live &&
  performanceOffSince != null &&
  now - performanceOffSince >= PRERENDER_QUIET_MS &&
  !holdHeartbeatPace(now) &&
  !getRebuildProgress().inProgress;
/**
 * Brings today's slide pictures up to date (owner, 2026-10-04: "we make
 * updates until about 15 minutes before service"). For each presentation in
 * today's playlists: read it from ProPresenter, keep every picture whose
 * slide is unchanged (same group, place and words, wherever an edit or an
 * arrangement change moved it; thumb-store.carryOver), and draw only the new
 * or changed ones, one at a time.
 *
 * `operator`: pressed on Service › Day or Settings. Reads every presentation
 * (an arrangement switch may not change the file), runs with content on the
 * screens, and stops only for performance mode. Otherwise it's pre-render:
 * only presentations whose file changed, and only while it's quiet.
 */
let picturesRun = null; // progress while running
async function refreshPictures({ operator = false } = {}) {
  // Why a run stops, said as it is: the switch, performance mode, or (for
  // pre-render) something going on the screens.
  const stopReason = () =>
    !picturesOn() ? "slide pictures were turned off" : operator ? (performance.armed ? "performance mode came on" : null) : !quietForPictures() ? "something went on the screens" : null;
  const stop = () => {
    const why = stopReason();
    if (why) run.stopReason = why;
    return Boolean(why);
  };
  const started = Date.now();
  const run = { running: true, operator, startedAt: new Date(started).toISOString(), presentations: 0, done: 0, ready: 0, total: 0, drawn: 0, kept: 0, stopped: false };
  picturesRun = run;
  try {
    const targets = await prerenderTargets();
    run.presentations = targets.size;
    for (const [pid] of targets) {
      if (stop()) {
        run.stopped = true;
        break;
      }
      const fp = await pictureFingerprint(pid);
      if (!fp) {
        run.done += 1;
        continue;
      }
      const known = await thumbStore.info(pid);
      if (!operator && known?.fingerprint === fp && known.count && (await thumbStore.complete(pid, fp, known.count))) {
        run.ready += known.count;
        run.total += known.count;
        run.done += 1;
        continue;
      }
      let slides;
      try {
        const doc = await client.getPresentation(pid);
        // The arrangement ProPresenter has selected: its pictures are
        // numbered by it (as Go Live and the Now preview are).
        slides = flattenGroups(resolveArrangement(doc, []).groups).slice(0, 300);
      } catch {
        run.done += 1;
        continue;
      }
      const keys = slides.map((sl) => pictureKey(sl));
      run.kept += await thumbStore.carryOver(pid, fp, keys);
      // Anything Now or the menu kept in memory for this presentation may be
      // from before the change.
      thumbCache.forget(pid);
      pictureFingerprints.delete(pid);
      run.total += keys.length;
      for (let i = 0; i < keys.length; i++) {
        if (stop()) {
          run.stopped = true;
          break;
        }
        if (await thumbStore.get(pid, i, fp)) {
          run.ready += 1;
          continue;
        }
        const img = await client.getSlideThumbnail(pid, i).catch(() => null);
        if (img) {
          await thumbStore.put(pid, i, fp, img, Date.now(), keys[i]);
          run.drawn += 1;
          run.ready += 1;
        }
        await new Promise((r) => setTimeout(r, PRERENDER_PACING_MS));
      }
      run.done += 1;
      if (run.stopped) break;
    }
    await thumbStore.prune();
  } catch (err) {
    console.log(`Slide pictures: couldn't finish (${err.message}).`);
  } finally {
    run.running = false;
    run.finishedAt = new Date().toISOString();
    slidePicturesStatus = { lastRunAt: run.finishedAt, presentations: run.presentations, ready: run.ready, total: run.total, rendered: run.drawn, kept: run.kept, stopped: run.stopped, stopReason: run.stopReason ?? null, operator };
    if (run.drawn || run.stopped || operator) {
      console.log(
        `Slide pictures${operator ? " (pressed)" : ""}: drew ${run.drawn}, kept ${run.kept} unchanged, ${run.ready} of ${run.total} ready across ${run.presentations} presentation(s) in today's playlists, in ${((Date.now() - started) / 1000).toFixed(0)}s${run.stopped ? `. Stopped: ${run.stopReason ?? "interrupted"}` : ""}.`
      );
    }
  }
  return run;
}

async function maybePrerender(now = Date.now()) {
  if (now - prerenderCheckedAt < PRERENDER_CHECK_MS) return;
  prerenderCheckedAt = now;
  if (protectOn() || !picturesOn() || config.slidePictures?.prerender !== true || picturesRun?.running || !quietForPictures(now) || !client.isLocalHost) return;
  const readyFor = await propresenterReadyForMs();
  if (readyFor == null || readyFor < WATCH_SETTLE_MS) return;
  await refreshPictures();
}

/**
 * Protect ProPresenter on or off (Settings › Search › Advanced). Off lets the
 * index and the playlist-wide readers run again; on stops them, and stops the
 * file watcher at once.
 */
app.post("/api/protect", async (req, res) => {
  const { on } = req.body ?? {};
  if (typeof on !== "boolean") return res.status(400).json({ error: "on must be true or false" });
  try {
    await updateConfig((c) => ({ ...c, protectProPresenter: on }));
  } catch (err) {
    return res.status(500).json({ error: `Couldn't save it: ${err.message}` });
  }
  if (!on) indexWorkDeferred = null;
  startWatching(); // stops the watcher when protected, starts it when not
  console.log(`Protect ProPresenter turned ${on ? "on" : "off"} from Settings.`);
  res.json({ ok: true, on: protectOn() });
});

/** "Update pictures for today", from Service › Day or Settings. Runs in the background; progress below. */
app.post("/api/slide-pictures/update", (_req, res) => {
  if (protectOn()) return res.status(409).json({ error: PROTECT_REFUSAL });
  if (!picturesOn()) return res.status(409).json({ error: "Slide pictures are off (Settings › Phones › Slide pictures)." });
  if (performance.armed) return res.status(409).json({ error: "Performance mode is on, so no pictures are drawn now. Update them before the service, or after." });
  if (picturesRun?.running) return res.status(409).json({ error: "Already updating the pictures.", run: picturesRun });
  refreshPictures({ operator: true }).catch((err) => console.error("Updating pictures failed:", err.message));
  res.json({ ok: true, run: picturesRun });
});

app.get("/api/slide-pictures/status", (_req, res) => {
  res.json({ show: picturesOn(), run: picturesRun, last: slidePicturesStatus });
});

/**
 * How many slides a presentation has, for one the index doesn't know (not in
 * a searched library). Asked of ProPresenter once per presentation, then
 * remembered; until it answers, the slides up to the live one are listed.
 */
const slideCountCache = new Map();
// One document read at a time, whatever the phones ask for: it's the heaviest
// call Refrain makes during a service, so a deck change with several phones
// open costs one read, not one per phone.
let slideCountInFlight = false;
function learnSlideCount(presentationId) {
  if (protectOn() || slideCountCache.has(presentationId) || slideCountInFlight) return;
  slideCountInFlight = true;
  slideCountCache.set(presentationId, null);
  client
    .getPresentation(presentationId)
    .then((doc) => slideCountCache.set(presentationId, flattenGroups(resolveArrangement(doc, []).groups).length))
    .catch(() => slideCountCache.delete(presentationId))
    .finally(() => (slideCountInFlight = false));
}

/** Every slide of the presentation on the screens, words from the index. At most 300. */
function currentSlides() {
  const slide = liveState.live ? liveState.slide : null;
  if (!slide?.presentationId || !Number.isInteger(slide.slideIndex)) return null;
  let known = Number.isInteger(slide.slideCount) ? slide.slideCount : slideCountCache.get(slide.presentationId);
  if (!Number.isInteger(known)) {
    learnSlideCount(slide.presentationId);
    known = slide.slideIndex + 1;
  }
  const count = Math.min(Math.max(known, slide.slideIndex + 1), 300);
  const slides = [];
  for (let i = 0; i < count; i++) slides.push({ slideIndex: i, text: getIndexedSlide(slide.presentationId, i)?.text ?? null });
  return { presentationId: slide.presentationId, presentationName: slide.presentationName ?? slide.name ?? null, currentIndex: slide.slideIndex, slides };
}

function currentPreview() {
  return previewTargets(liveState.live ? liveState.slide : null, (pid, idx) => getIndexedSlide(pid, idx)?.text ?? null);
}

/**
 * Starts the phone listener when networkModule is on. Separate app, separate
 * port, a handful of routes; see server/remote.js for the boundary.
 */
let remoteServer = null;
function startRemoteListener() {
  const { status, problems } = getNetworkModuleStatus(config, port);
  if (status !== "active") {
    if (status === "misconfigured") console.warn(`Phone flags are misconfigured: ${problems.join(" ")}`);
    return;
  }
  ensureRemoteDevices().catch(() => {});
  const remoteApp = createRemoteApp({
    getState: () => ({
      liveState,
      recent: recentSlides,
      progress: serviceProgress(serviceModuleOn() && serviceDay.day ? serviceState() : null, liveState),
    }),
    saveFlag: (flag) => saveFlag(flag, { folder: slideFlagsFolder() }),
    flagTypes: configuredFlagTypes,
    knownSlide: (presentationId, slideIndex) => getIndexedSlide(presentationId, slideIndex),
    devices: {
      see: (id, { name, signIn } = {}) => changeDevices(seeDevice(remoteDevices, id, { name, signIn }), { now: Boolean(signIn) }),
      approved: (id) => isApproved(remoteDevices, id),
      removed: (id) => isRemoved(remoteDevices, id),
      name: (id) => remoteDevices.devices?.[id]?.name ?? null,
    },
    currentSlides,
    noteActivity: noteClientActivity,
    // Pictures already on disk only: a phone never makes ProPresenter draw.
    thumb: storedSlideThumb,
    pictures: () => picturesOn() && config.networkModule?.phonePictures === true,
    // What a phone may do, from Settings › Features: flag (Flags) and send
    // alerts (Messages: stage messages and the pager).
    features: () => ({ flags: featureOn(config, "slide-flags"), messages: featureOn(config, "messages") }),
    stage: async () => ({ presets: stagePresets(), current: await readStage() }),
    // Messages a phone can fill in: those with a text field (a pager code).
    messages: async () => {
      const hidden = new Set(hiddenIds(config.liveModule?.hiddenMessages));
      return (await client.getMessages())
        .filter((m) => !hidden.has(m.id))
        .map((m) => ({ id: m.id, name: m.name, active: m.active, fields: m.tokens.filter((t) => t.kind === "text").map((t) => t.name) }))
        .filter((m) => m.fields.length);
    },
    // An approved phone's confirmed press: an alert, never a slide (owner,
    // 2026-10-04: the phone is for alerts and flags).
    control: async (action, deviceId) => {
      const phone = remoteDevices.devices?.[deviceId]?.name ?? "A phone";
      try {
        if (action.kind === "stage") await showStage(action.text);
        else if (action.kind === "stage-clear") await clearStage();
        else if (action.kind === "message") await postMessage(action.messageId, action.values);
        else if (action.kind === "message-clear") await client.clearMessage(action.messageId);
        else throw new Error("That isn't something a phone can do.");
        notePhoneAction({ phone, label: action.label, ok: true });
        return { label: action.label };
      } catch (err) {
        notePhoneAction({ phone, label: action.label, ok: false, error: err.message });
        throw err;
      }
    },
    pinGuard: remotePinGuard,
    auth: {
      expectedPin: () => expectedRemotePin(),
      secret: () => loadRemoteSecret(),
      hint: () => (typeof config.networkModule?.pinHint === "string" && config.networkModule.pinHint.trim() ? config.networkModule.pinHint.trim() : DEFAULT_PIN_HINT),
      daily: () => remotePinMode() === "daily",
    },
  });
  const host = typeof config.networkModule?.host === "string" && config.networkModule.host ? config.networkModule.host : "0.0.0.0";
  const remotePort = Number(config.networkModule?.port ?? 9997);
  remoteServer = remoteApp.listen(remotePort, host, () => {
    console.log(`Phone flags on: ${networkUrls().join(", ") || `port ${remotePort}`}${remotePinMode() === "none" ? "" : remotePinMode() === "daily" ? " (daily PIN)" : " (PIN)"}.`);
  });
  remoteServer.on("error", (err) => console.error(`Phone flags couldn't start on port ${remotePort}: ${err.message}`));
}

function serviceModuleOn() {
  return getServiceModuleStatus(config) !== "off";
}

function serviceOptions() {
  const m = config.serviceModule ?? {};
  const num = (v, d) => (Number.isFinite(v) && v >= 0 ? v : d);
  return {
    folder: typeof m.folder === "string" && m.folder.trim() ? m.folder.trim() : DEFAULT_DAYS_FOLDER,
    schedule: Array.isArray(m.schedule) ? m.schedule : [],
    windows: { leadMinutes: num(m.leadMinutes, DEFAULT_LEAD_MINUTES), trailMinutes: num(m.trailMinutes, DEFAULT_TRAIL_MINUTES) },
  };
}

function serviceState(now = Date.now()) {
  return foldDay(serviceDay.events, { schedule: serviceOptions().schedule, day: serviceDay.day ?? dayKey(now), now });
}

function previousDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d - 1, 12).getTime());
}

/**
 * Loads the day to record into. Usually today; yesterday instead while a
 * lock-in opened yesterday is still running, so an event that crosses
 * midnight stays one event rather than being split across two folders.
 */
async function loadServiceDay(now = Date.now()) {
  const { folder, schedule } = serviceOptions();
  const today = dayKey(now);
  const yesterday = previousDay(today);
  const yEvents = await readDay(yesterday, { folder });
  if (foldDay(yEvents, { schedule, day: yesterday, now }).lockin) {
    serviceDay = { day: yesterday, events: yEvents, loading: null };
  } else {
    serviceDay = { day: today, events: await readDay(today, { folder }), loading: null };
  }
}

/** Moves on to a new day once the old one is over (no lock-in holding it open). */
function rollServiceDayIfNeeded(now = Date.now()) {
  if (serviceDay.loading || serviceDay.day === dayKey(now)) return;
  if (serviceDay.day && serviceState(now).lockin) return;
  serviceDay.loading = loadServiceDay(now).catch((err) => {
    console.error("Could not load the service day:", err.message);
    serviceDay.loading = null;
  });
}

/** Records events: in memory straight away, on disk here first and then the shared folder. */
function recordServiceEvents(events) {
  const { folder } = serviceOptions();
  setImmediate(() => quickenHeartbeat());
  for (const raw of events) {
    // Filed under the day being recorded, which is yesterday during a lock-in
    // that crossed midnight.
    const event = { ...raw, day: serviceDay.day ?? raw.day };
    serviceDay.events.push(event);
    saveEvent(event, { folder })
      .then((r) => {
        if (!r.shared) console.warn(`Service event kept on this machine; the shared folder is unreachable (${r.reason}). It will be copied later.`);
      })
      .catch((err) => console.error("Could not save a service event:", err.message));
  }
}

function holdHeartbeatPace(now = Date.now()) {
  return serviceModuleOn() && shouldHoldPace(serviceState(now), now, serviceOptions().windows);
}

/**
 * Scheduled services name their playlist by pattern. Resolve it once the
 * window opens, before anything is live: a couple of playlist reads, and
 * never while performance mode is holding still.
 */
const resolvedSchedulePlaylists = new Set();
const scheduleMatchNotes = new Map();
async function resolveScheduledPlaylists(now = Date.now()) {
  if (!serviceModuleOn() || performance.armed || !liveState.connected) return;
  const { windows } = serviceOptions();
  const pending = activeServices(serviceState(now), now, windows).filter(
    (s) => s.source === "schedule" && s.playlistMatch && !s.playlist && !resolvedSchedulePlaylists.has(s.serviceId)
  );
  if (!pending.length) return;
  let playlists;
  try {
    playlists = flattenPlaylists(await client.getPlaylists());
  } catch {
    return; // try again next minute
  }
  for (const s of pending) {
    // Retried each minute while the window is open: this week's playlist is
    // sometimes built on the morning itself. Logged once per reason.
    const { playlist: match, reason } = matchPlaylist(playlists, s.playlistMatch, serviceDay.day);
    if (!match) {
      const said = scheduleMatchNotes.get(s.serviceId);
      if (said !== reason) console.log(`Service "${s.name}": ${reason}. Recording without a playlist for now.`);
      scheduleMatchNotes.set(s.serviceId, reason);
      continue;
    }
    resolvedSchedulePlaylists.add(s.serviceId);
    try {
      const { items } = await client.getPlaylistItems(match.id);
      recordServiceEvents([
        buildEvent("service-added", {
          serviceId: s.serviceId,
          name: s.name,
          source: "schedule",
          startsAt: s.startsAt,
          playlist: { id: match.id, name: match.name, items: items.map((i) => ({ presentationId: i.id, name: i.name, arrangementName: i.arrangementName })) },
        }),
      ]);
    } catch (err) {
      console.error(`Service "${s.name}": could not read playlist "${match.name}":`, err.message);
    }
  }
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

  // The last few slides that were on the screens, for a flag sent late from
  // a phone (server/remote.js). In memory only: it's a scrollback, not a record.
  if (liveState.live && enriched) recentSlides = pushRecent(recentSlides, enriched, now);

  // The service timeline: what goes live, when, and in which service. It reads
  // only what this beat already fetched. Skipped while ProPresenter is not
  // answering, because "can't see" is not "nothing is live", and recording a
  // departure there would turn every network blip into a false return.
  if (connected && serviceModuleOn() && serviceDay.day) {
    rollServiceDayIfNeeded(now);
    const current =
      liveState.live && enriched
        ? {
            presentationId: enriched.presentationId,
            name: enriched.presentationName ?? enriched.name ?? null,
            arrangementName: enriched.arrangementName ?? null,
          }
        : null;
    const events = transitionEvents(serviceState(now), current, now, { opts: serviceOptions().windows });
    if (events.length) recordServiceEvents(events);
  }

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

  const before = performance;
  setPerformance(advancePerformance({ state: performance, layers, now }), now);
  if (performance.armed !== before.armed) {
    console.log(`Performance mode ${performance.armed ? "ON" : "OFF"} — ${performanceTransitionReason(before, performance)}`);
    diag("performance", { armed: performance.armed, source: performance.source, reason: performanceTransitionReason(before, performance) });
  }
  maybeCatchUpIndex(now).catch(() => {});
  maybePrerender(now).catch(() => {});
  return performance;
}

// Kept as the old name so the boot path reads the same.
const pollPerformance = heartbeat;

// --- Service log (issue #13; server/service-log.js) ---------------------------
// One line a minute while a service holds the pace or performance mode is on,
// every 30 minutes otherwise, and a line at once for anything slow. Local log
// only; nothing leaves the machine.
const SLOW_BEAT_MS = 2000;
const SLOW_CALL_MS = 3000;
const STALL_MS = 500;
const SERVICE_LOG_MS = 60_000;
const IDLE_LOG_EVERY = 30; // minutes
const callStats = createCallStats();
const askedOfProPresenter = createAskedCounter();
const slowCallSaidAt = new Map();

// The diagnostics file: one JSON line a minute, always, plus one per notable
// event, in data/diagnostics/YYYY-MM-DD.jsonl, kept 14 days. The text log is
// for reading; this is for lining up a bad Sunday against a good one. Local
// only, never sent anywhere. Appends only, so nothing here can lose anything.
const DIAGNOSTICS_DIR = "./data/diagnostics";
const DIAGNOSTICS_KEEP_DAYS = 14;
let diagnosticsDirReady = false;
function diag(event, data = {}) {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const line = JSON.stringify({ t: now.toISOString(), event, ...data }) + "\n";
  (diagnosticsDirReady ? Promise.resolve() : mkdir(DIAGNOSTICS_DIR, { recursive: true }).then(() => (diagnosticsDirReady = true)))
    .then(() => appendFile(path.join(DIAGNOSTICS_DIR, `${day}.jsonl`), line))
    .catch(() => {});
}
async function pruneDiagnostics(now = Date.now()) {
  try {
    for (const name of await readdir(DIAGNOSTICS_DIR)) {
      const m = name.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (m && now - new Date(`${m[1]}T12:00:00`).getTime() > DIAGNOSTICS_KEEP_DAYS * 86_400_000) await rmPath(path.join(DIAGNOSTICS_DIR, name), { force: true });
    }
  } catch {
    /* nothing to prune */
  }
}
setTimeout(() => pruneDiagnostics(), 30_000).unref();
setInterval(() => pruneDiagnostics(), 86_400_000).unref();

// Service feed (server/service-feed.js): off unless the church sets it up, and
// it only talks to the address they typed in. Status reads the heartbeat's
// cache, never ProPresenter; logs are copies of the files above, sent only when
// someone presses Send log on the Service screen.
const SERVICE_FEED_STATE = "./data/service-feed";
const serviceFeed = createServiceFeed({
  getModule: () => config.serviceFeedModule,
  getLive: () => liveStatePayload(),
  isFrozen: () => frozen(),
  // The same rule as the Now screen's pictures: during a service only one
  // already on disk, so telemetry never makes ProPresenter draw anything.
  getPicture: async (pid, idx) => (!picturesOn() ? null : performance.armed ? storedSlideThumb(pid, idx) : thumbCache(pid, idx, await pictureFingerprint(pid))),
  appVersion: version,
  listLogs: async () => {
    const names = await readdir(DIAGNOSTICS_DIR).catch(() => []);
    return Promise.all(names.map(async (name) => ({ name, size: (await stat(path.join(DIAGNOSTICS_DIR, name)).catch(() => ({ size: 0 }))).size })));
  },
  readLog: (name) => readFile(path.join(DIAGNOSTICS_DIR, name), "utf-8"),
  loadSent: async () => JSON.parse(await readFile(path.join(SERVICE_FEED_STATE, "sent.json"), "utf-8").catch(() => "{}")),
  saveSent: (sent) => writeAtomic(SERVICE_FEED_STATE, "sent.json", sent),
});
setInterval(() => serviceFeed.tickStatus().catch(() => {}), 2_000).unref();

// Staff requests (owner, 2026-10-07): messages from the church's announcement
// app that someone at this console approves before they reach the screens.
// Off until switched on in Settings > Features; see server/staff-requests.js.
const STAFF_REQUESTS_STATE = "./data/staff-requests";
const staffRequests = createStaffRequests({
  getModule: () => config.serviceFeedModule,
  isOn: () => featureOn(config, "requests"),
  loadHandled: async () => JSON.parse(await readFile(path.join(STAFF_REQUESTS_STATE, "handled.json"), "utf-8").catch(() => "[]")),
  saveHandled: (list) => writeAtomic(STAFF_REQUESTS_STATE, "handled.json", list),
  // Through the same poster the operator uses, into the message with a text
  // field (the one named in liveModule.requestMessageId, else the first not put
  // away). The recents are not touched: a request is not something typed here.
  post: async (text) => {
    // Messages switched off closes every route that puts a message on the
    // screens; an approved request is one too.
    if (!featureOn(config, "messages")) throw new Error("Messages are switched off in Settings \u203a Features, so nothing was posted. The request is still waiting.");
    const hidden = new Set(hiddenIds(config.liveModule?.hiddenMessages));
    let messages;
    try {
      messages = await client.getMessages();
    } catch {
      throw new Error("ProPresenter isn't answering, so nothing was posted. The request is still waiting.");
    }
    const candidates = messages.filter((m) => !hidden.has(m.id) && m.tokens?.some((t) => t.kind === "text"));
    const wanted = config.liveModule?.requestMessageId;
    const target = candidates.find((m) => m.id === wanted) ?? candidates[0];
    if (!target) throw new Error("There is no ProPresenter message with a text field to put this in. Add a Text token to your pager message, as for the pager.");
    const token = target.tokens.find((t) => t.kind === "text");
    try {
      await client.triggerMessage(target.id, [{ name: token.name, text: messageFieldValue(text) }]);
    } catch {
      throw new Error("ProPresenter didn't take the message, so nothing was posted. The request is still waiting.");
    }
  },
});
setInterval(() => staffRequests.tick().catch(() => {}), staffRequests.POLL_MS).unref();

onProPresenterCall(({ path: p, method, ms, ok, timedOut }) => {
  const kind = classifyCall(p, method);
  callStats.record({ kind, ms, ok, timedOut });
  if (ok) askedOfProPresenter.note(p);
  if (ms >= SLOW_CALL_MS || timedOut) {
    diag("slow-call", { kind, path: p, ms: Math.round(ms), ok, timedOut });
    const last = slowCallSaidAt.get(kind) ?? 0;
    if (Date.now() - last > 30_000) {
      slowCallSaidAt.set(kind, Date.now());
      console.log(`Slow ProPresenter call: ${kind} ${p} took ${(ms / 1000).toFixed(1)}s${timedOut ? " and timed out" : ok ? "" : " and failed"}.`);
    }
  }
});
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
// A stall is Refrain's own thread not getting back to its timers: whatever it
// was doing held up the heartbeat, Go Live and phone presses alike.
let stallTickAt = Date.now();
setInterval(() => {
  const late = Date.now() - stallTickAt - 250;
  if (late > STALL_MS) {
    console.log(`Refrain was stalled for ${late}ms${getRebuildProgress().inProgress ? " (while indexing)" : ""}.`);
    diag("stall", { ms: late, indexing: getRebuildProgress().inProgress });
  }
  stallTickAt = Date.now();
}, 250).unref();
const propresenterSamples = [];
let propresenterClosedSince = null;
let propresenterLoad = null;
let lastCpu = process.cpuUsage();
let lastCpuAt = Date.now();
let minutesSinceLine = 0;
// ProPresenter's process: an object when it's running, null when it isn't,
// undefined when Refrain couldn't look (ps failed or timed out), which must
// never read as "closed".
async function sampleProPresenter() {
  if (!client.isLocalHost || platform() === "win32") return undefined;
  try {
    const { stdout } = await execFileAsync("ps", ["-Ao", "pid,%cpu,rss,comm"], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    return parseProPresenterPs(stdout);
  } catch {
    return undefined;
  }
}
async function serviceLogTick() {
  const pp = await sampleProPresenter();
  if (pp) askedOfProPresenter.seen(pp.pid);
  // When ProPresenter was first seen not running on this Mac, for auto-end.
  if (pp !== undefined) propresenterClosedSince = pp ? null : (propresenterClosedSince ?? Date.now());
  autoEndTick().catch((err) => console.error("Auto-end check failed:", err.message));
  propresenterSamples.push(pp);
  if (propresenterSamples.length > 10) propresenterSamples.shift();
  const asked = askedOfProPresenter.counts();
  const notice = propresenterLoadNotice(propresenterSamples, Math.round(totalmem() / 1024 / 1024), { asked });
  if (notice?.message !== propresenterLoad?.message && notice) {
    console.log(`Heads up: ${notice.message}`);
    diag("load-notice", notice);
  }
  propresenterLoad = notice;

  const now = Date.now();
  const cpu = process.cpuUsage(lastCpu);
  const refrainCpu = ((cpu.user + cpu.system) / 1000 / (now - lastCpuAt)) * 100;
  lastCpu = process.cpuUsage();
  lastCpuAt = now;
  const calls = callStats.take();
  const loopMaxMs = loopDelay.max / 1e6;
  const loopP99Ms = loopDelay.percentile(99) / 1e6;
  loopDelay.reset();

  const inService = holdHeartbeatPace(now) || performance.armed;
  const run = getRebuildProgress();
  const refrainSample = { cpu: Math.round(refrainCpu * 10) / 10, rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024), loopMaxMs: Math.round(loopMaxMs), loopP99Ms: Math.round(loopP99Ms) };
  const paceMs = heartbeatInterval({ lastClientAt, hold: holdHeartbeatPace(now) });
  diag("minute", {
    inService,
    paceMs,
    live: liveState.live,
    connected: liveState.connected,
    performance: { armed: performance.armed, source: performance.source },
    calls: Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, { ...v, totalMs: Math.round(v.totalMs), maxMs: Math.round(v.maxMs) }])),
    refrain: refrainSample,
    propresenter: pp,
    asked,
    index: run.inProgress ? { current: run.current, total: run.total } : null,
  });
  minutesSinceLine += 1;
  if (!inService && minutesSinceLine < IDLE_LOG_EVERY) return;
  minutesSinceLine = 0;
  console.log(
    formatServiceLine({
      why: inService ? (performance.armed ? "performance mode" : "service") : "idle, every 30 min",
      paceMs,
      calls,
      refrain: refrainSample,
      propresenter: pp,
      performance,
      index: run.inProgress ? `${run.current}/${run.total}` : null,
      asked: pp ? asked : null,
    })
  );
}
setInterval(() => serviceLogTick().catch(() => {}), SERVICE_LOG_MS).unref();
// One sample soon after start, so Health has ProPresenter's numbers before
// the first minute is up. Not logged: the minute line needs a minute of calls.
setTimeout(() => sampleProPresenter().then((pp) => pp && propresenterSamples.push(pp)).catch(() => {}), 5000).unref();

function startPerformancePolling() {
  clearTimeout(heartbeatTimer);
  // Rescheduled after each beat rather than fixed, so the rate can follow
  // whether anyone is actually watching without tearing down a timer.
  let beating = false;
  const beat = async () => {
    if (beating) return; // one at a time; the scheduled one reschedules itself
    beating = true;
    clearTimeout(heartbeatTimer);
    const beatStarted = Date.now();
    await heartbeat().catch(() => {});
    const beatMs = Date.now() - beatStarted;
    if (beatMs > SLOW_BEAT_MS) {
      console.log(`Slow check: asking ProPresenter what's on screen took ${(beatMs / 1000).toFixed(1)}s.`);
      diag("slow-beat", { ms: beatMs });
    }
    beating = false;
    const next = heartbeatInterval({ lastClientAt, hold: holdHeartbeatPace() });
    scheduledFor = Date.now() + next;
    heartbeatTimer = setTimeout(beat, next);
    heartbeatTimer.unref?.();
  };
  let scheduledFor = 0;
  quickenHeartbeat = () => {
    const due = Date.now() + heartbeatInterval({ lastClientAt, hold: holdHeartbeatPace() });
    if (due >= scheduledFor) return;
    clearTimeout(heartbeatTimer);
    scheduledFor = due;
    heartbeatTimer = setTimeout(beat, due - Date.now());
    heartbeatTimer.unref?.();
  };
  // Twice: a slide fired from a safe slide can take ProPresenter longer than
  // 150ms to report, and the phone's quick refresh only looks for ~3s.
  beatNow = () => {
    setTimeout(beat, 150);
    setTimeout(beat, 800);
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
    feed: serviceFeedLamp(),
    // How many staff requests are waiting, for the rail's dot on every screen.
    requests: staffRequests.list().length,
    // The index needs a refresh (old, or built without the slide anchors): a
    // dot on Settings, where the notice and its Refresh now live.
    indexNotice: Boolean(deferredStaleness() ?? lockinStaleness() ?? indexStaleness(getIndex()?.builtAt ?? null) ?? indexAccuracyNotice(getIndex())),
  };
}

function serviceFeedLamp() {
  return feedLamp({
    moduleStatus: getServiceFeedModuleStatus(config).status,
    lastError: serviceFeed.state().lastError,
    mod: config.serviceFeedModule,
    now: new Date(),
  });
}

/** True when Refrain should not be doing anything of its own accord. */
function frozen() {
  return performance.armed;
}

// How long ProPresenter has been answering without interruption. The watcher
// uses this to hold off right after a launch, when reads fail en masse while
// ProPresenter is still indexing its own media.
let propresenterReadySince = null;
/**
 * How long ProPresenter has been up and answering, in milliseconds, or null.
 *
 * Two clocks, and the difference matters. Refrain can only observe from its own
 * first successful probe, which is fine when Refrain starts first -- and wrong
 * the moment it does not. An operator who opens ProPresenter, waits ten
 * minutes, then starts Refrain was being told "up 0s of 180s" and made to wait
 * again for a settling period that had long since passed.
 *
 * So prefer ProPresenter's real process uptime, which is the number the settle
 * gate is actually asking about. The observed window stays as the fallback for
 * when the process list cannot be read.
 *
 * The API still has to answer: a process that is up with its Network API off is
 * not ready for anything.
 */
async function propresenterReadyForMs() {
  try {
    await client.testConnection();
  } catch {
    propresenterReadySince = null;
    return null;
  }
  if (propresenterReadySince == null) propresenterReadySince = Date.now();
  const observed = Date.now() - propresenterReadySince;

  if (!client.isLocalHost) return observed; // its processes are on another machine
  try {
    const { stdout } = await execFileAsync("ps", ["-Ao", "pid,etime,comm"], { timeout: 5000 });
    const secs = propresenterUptimeSeconds(stdout);
    if (secs != null) return Math.max(observed, secs * 1000);
  } catch {
    // Fall through to what we observed ourselves.
  }
  return observed;
}

/**
 * Waits for ProPresenter to finish starting up before the first crawl.
 *
 * The watcher has always refused to reindex until ProPresenter has been
 * answering for `settleAfterReadyMs`, for a measured reason recorded in
 * library-watch.js: reads fail en masse while ProPresenter is still indexing
 * its own media after launch -- 221 of 445 lost.
 *
 * The **first** build had no such gate, on either the boot path or setup, and
 * that is the one build a fresh machine cannot avoid. Worse, it is the build
 * whose failure is invisible: an index silently missing half the library looks
 * exactly like a complete one.
 *
 * Waiting rather than skipping, because with no index there is no watcher to
 * come back later -- `startWatching` derives its folders from indexed
 * presentations, so a skipped first build never happens at all.
 *
 * It also means Refrain stops issuing hundreds of document reads at a
 * just-launched ProPresenter, which is the heaviest and least necessary load
 * it ever puts on the app.
 */
async function awaitProPresenterSettled({
  settleMs = WATCH_SETTLE_MS,
  pollMs = 10_000,
  giveUpAfterMs = 10 * 60_000,
  onWait = null,
} = {}) {
  const startedAt = Date.now();
  let announced = null;
  for (;;) {
    const readyFor = await propresenterReadyForMs();
    if (readyFor != null && readyFor >= settleMs) return true;

    // "Still starting up" and "not there at all" are different situations and
    // need different words: one resolves itself, the other needs somebody to
    // open ProPresenter or switch its Network API on.
    const state = readyFor == null ? "absent" : "settling";
    if (state !== announced) {
      announced = state;
      onWait?.(state, readyFor);
    }

    // Bounded, because the first version was not. On a fresh machine -- the
    // one case this gate exists for -- ProPresenter being unavailable is the
    // *likely* state, not the exception, and an uncapped wait meant Refrain
    // sat there indefinitely looking like it had hung. Giving up is safe: the
    // index is built on demand from Health, and saying so beats waiting
    // silently for something that may never happen.
    if (Date.now() - startedAt >= giveUpAfterMs) return false;
    await new Promise((r) => setTimeout(r, pollMs));
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
  if (!autoReindexEnabled() || protectOn()) return;
  const dirs = getIndexedLibraryDirs();
  if (dirs.length === 0) return;
  libraryWatch = startLibraryWatch({
    dirs: () => dirs,
    plan: () => planReindex(client, config.librarySync, preferredArrangements()),
    reindex: () => startRebuild({ incremental: true }),
    // Performance mode is a hard stop, not a preference: while it is on, the
    // watcher does not even check, so Refrain makes no unsolicited API calls.
    frozen,
    rebuildInProgress: () => getRebuildProgress().inProgress,
    readyForMs: propresenterReadyForMs,
    crawlPlaylists: () => Boolean(config.librarySync?.crawlPlaylists),
  });
  console.log(`Watching ${dirs.length} library folder(s) for changes — edited presentations reindex on their own.`);
}

/**
 * A lock-in holds performance mode on, so nothing reindexes in the
 * background. After a day of that, the reason search may be behind is the
 * lock-in, and the index-age notice on Search says so rather than just "old".
 */
function lockinStaleness(now = Date.now()) {
  if (!serviceModuleOn() || !serviceDay.day) return null;
  const { lockin } = serviceState(now);
  if (!lockin || now - lockin.startedAt < 24 * 3_600_000) return null;
  return { message: `Not reindexing: locked in for "${lockin.name}" since ${new Date(lockin.startedAt).toLocaleDateString([], { weekday: "long" })}. Release it on the Service screen once the event is over.` };
}

/**
 * A deck changed while performance mode was holding, so search is behind and
 * "No matches" is a lie the operator has no way to see through.
 *
 * This is the special-event case above all: the operator imports a deck ten
 * minutes before doors, or presses Lock in (which is the *right* press for an
 * event with no set time), and from then on nothing reindexes. Search then
 * answers "No matches" for a presentation that is sitting in the library,
 * identically to how it answers for a word nobody ever wrote.
 *
 * Nothing here starts work of its own, so performance mode's promise is
 * untouched. It only stops the operator being kept in the dark about work
 * that is waiting.
 *
 * **It carries no Refresh.** It used to, on the reasoning that a press is
 * operator-initiated and therefore allowed. The stability work for #11-#13
 * ended that: `operatorIndexRefusal()` now refuses a run whenever performance
 * mode is armed with a known source, which is every state this notice can
 * appear in. So the button could only ever spend a press to print a sentence,
 * and the sentence is better said up front -- the operator who will not press
 * a control whose outcome they cannot predict is the one this notice is for.
 * `indexRunHeldReason()` decides whether that is the case, so the notice and
 * the route agree on the state even though they word it differently: the
 * route explains a press that failed, this explains why there is nothing to
 * press. The route's own sentence is too long for a row that sits beside the
 * index chip at docked width, and the operator here does not need the
 * mechanism named -- only that it fixes itself.
 *
 * Two conditions have to hold before saying any of it:
 *
 * - **ProPresenter has to be answering.** Performance mode also arms when it
 *   is unreachable, not only when something is live, and an index that cannot
 *   be read is the link's problem, not the index's. The readout and the LINK
 *   lamp already report that; this notice stays out of the way.
 * - **The watcher has to exist.** With `autoReindex: false` there is none, so
 *   nothing local knows a file changed and this cannot fire at all. That is a
 *   real gap for exactly the churches whose index drifts furthest, and it is
 *   not closeable here: the signal would have to come from somewhere other
 *   than a watcher that setting deliberately turns off.
 */
function deferredStaleness() {
  if (!frozen()) return null;
  if (!liveState.connected) return null;
  if (!libraryWatch?.status()?.unreadChanges) return null;
  const held = indexRunHeldReason();
  if (!held) return null;
  // Short on purpose. This row is `flex items-center` beside the index chip,
  // so at docked width every extra word wraps and pushes the search box down
  // -- and the booth path is the one place that cost is unacceptable. The
  // reason (performance mode) is already on the PERF lamp and spelled out on
  // Health; what the operator needs here is that search is behind and that
  // the button beside this fixes it. No trailing "Refresh." either: the
  // button says it.
  // One sentence, no button: what is true, then what happens next. Both
  // clauses hold for every reason `indexRunHeldReason()` gives -- performance
  // mode armed by content, by hand, or by a lock-in, and content live just
  // after a restart -- because all of them end when the screens go quiet.
  return { message: "A presentation changed since this index. It catches up when the screens are quiet.", held: true };
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
    reindexAttempted: index.reindexAttempted ?? null,
    reindexCompleted: index.reindexCompleted ?? null,
    lastFullBuildAt: index.lastFullBuildAt ?? null,
    performanceMode: {
      armed: performance.armed,
      source: performance.source,
      since: performance.since ? new Date(performance.since).toISOString() : null,
      description: describePerformance(performance),
      lastError: performance.lastError,
    },
    fullRebuildSuggestion: fullRebuildSuggestion(daysSinceFullBuild(index)),
    // Order is by how actionable each one is, not by severity. A named deck
    // that changed minutes ago outranks "you have been locked in since
    // Saturday", which outranks "this index is a few days old" -- and all
    // three share the one Refresh button beside them.
    staleness: deferredStaleness() ?? lockinStaleness() ?? indexStaleness(index?.builtAt ?? null),
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
    rebuild: rebuildProjection(getRebuildProgress()),
    partial: index.partial ?? null,
    // Why an index run wouldn't start right now, or null: for the progress
    // bar, so a press that can't run says so.
    held: indexRunHeldReason(),
  };
}

/**
 * The run in progress, with its own rate and time left. Health once showed
 * the last run's duration (24 min) beside a crawl that was going to take four,
 * and the morning's decisions followed the wrong number (issue #13).
 */
function rebuildProjection(p, now = Date.now()) {
  if (!p.inProgress || !p.startedAt) return p;
  const elapsedMs = now - p.startedAt;
  const perSec = p.current > 0 ? p.current / (elapsedMs / 1000) : null;
  return { ...p, elapsedMs, perSec, etaMs: perSec ? Math.round(((p.total - p.current) / perSec) * 1000) : null };
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

/**
 * Presentation names that collide across two different Library folders --
 * see findDuplicateNames's own doc for why this exists. Pure and in-memory
 * (no ProPresenter call, no file read), so unlike most of this file there is
 * nothing here that can fail; the try/catch is only for consistency with the
 * rest of the routes in this file, not because a real failure is expected.
 */
app.get("/api/duplicate-names", (_req, res) => {
  try {
    res.json({ groups: findDuplicateNames() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Media nothing refers to -- see server/orphaned-media.js for the three rules
 * that keep this from ever calling an in-use file safe to delete.
 *
 * A button, never automatic. It reads every reference file in every workspace
 * (about five seconds on the booth's library), which is fine when someone asks
 * for it and not something to do behind their back. Because an operator
 * pressed it, it runs under performance mode like anything else they press --
 * see performance-mode.js: "it is only Refrain's own initiative that stops."
 *
 * One at a time, because two overlapping scans would read the whole library
 * twice for one answer.
 */
let orphanedMediaInFlight = false;

/**
 * Which theme each deck uses, and the decks that don't match their library's
 * most-used theme (see server/theme-report.js for why that's the working
 * definition of "current"). A button on Health, never automatic: it reads
 * ProPresenter's theme list once and every indexed .pro file.
 */
let themeReportInFlight = false;
app.post("/api/theme-report", async (_req, res) => {
  if (themeReportInFlight) return res.status(409).json({ error: "A theme check is already running." });
  if (performance.armed) return res.status(409).json({ error: "Performance mode is on, so Refrain is holding still. Run this when nothing is live." });
  if (!liveState.connected) return res.status(409).json({ error: "ProPresenter isn't answering, and the theme list comes from it." });
  themeReportInFlight = true;
  try {
    const layouts = layoutThemes(await client.getThemes());
    const decks = [];
    let unreadable = 0;
    for (const [presentationId, entry] of Object.entries(getIndex().presentations ?? {})) {
      if (!entry.presentationPath) continue;
      try {
        decks.push({ presentationId, name: entry.name, folder: entry.folder ?? null, themes: themesInDeck(await readFile(entry.presentationPath), layouts) });
      } catch {
        unreadable++;
      }
    }
    res.json({ libraries: themeReport(decks), decksRead: decks.length, themedDecks: decks.filter((d) => d.themes.size).length, unreadable, layouts: layouts.size });
  } catch (err) {
    res.status(502).json({ error: err.message });
  } finally {
    themeReportInFlight = false;
  }
});

app.post("/api/orphaned-media/scan", async (_req, res) => {
  // Reads the whole library into memory; the same hold as the theme report.
  if (performance.armed) return res.status(409).json({ ok: false, error: "Performance mode is on, so Refrain is holding still. Run this when nothing is live." });
  if (orphanedMediaInFlight) {
    return res.status(409).json({ error: "A scan is already running. Wait for it to finish." });
  }
  orphanedMediaInFlight = true;
  try {
    const result = await scanOrphanedMedia({ libraryDirs: getIndexedLibraryDirs() });
    res.status(result.ok ? 200 : 409).json(result);
  } catch (err) {
    // Fail closed, surfaced as a refusal: an unreadable reference file means
    // this scan cannot say what is unused, so it says that instead.
    res.status(502).json({
      ok: false,
      error:
        `Could not read everything needed to tell what is unused (${err.message}). ` +
        `Nothing is reported, because a file Refrain could not read might be the one using that media.`,
    });
  } finally {
    orphanedMediaInFlight = false;
  }
});

/**
 * Shows one of the scan's files in Finder, so a person can look at it and
 * decide. Refrain does not delete media, and this is the closest it gets.
 *
 * The workspace must be one the index knows and the file must sit inside that
 * workspace's Media folder -- this takes a path from the browser, so it
 * refuses anything else rather than revealing wherever it is pointed.
 */
app.post("/api/orphaned-media/reveal", async (req, res) => {
  const { root, relPath } = req.body ?? {};
  const target = resolveMediaPath(workspaceRootsFromLibraryDirs(getIndexedLibraryDirs()), root, relPath);
  if (!target) {
    return res.status(400).json({ error: "That is not a file from this workspace's Media folder." });
  }
  if (platform() !== "darwin") {
    return res.status(501).json({ error: "Showing a file in the file manager is only supported on macOS right now." });
  }
  try {
    await stat(target);
  } catch {
    return res.status(404).json({ error: "That file is not there any more. It may already have been moved or deleted." });
  }
  execFile("open", ["-R", target], (err) => {
    if (err) return res.status(500).json({ error: `Could not show it in Finder: ${err.message}` });
    res.json({ ok: true });
  });
});

app.get("/api/library-folders", async (_req, res) => {
  // What search holds now, per library, from the index itself: shown on
  // Settings > Search whether or not ProPresenter is answering, so "what's
  // being searched" never depends on it (owner, 2026-09-30).
  const indexed = {};
  for (const p of Object.values(getIndex().presentations ?? {})) {
    const f = p.folder ?? "Other";
    indexed[f] = (indexed[f] ?? 0) + 1;
  }
  const selected = config.librarySync?.folders ?? null; // null = every folder searched
  try {
    const folders = await client.getLibraryFolders();
    res.json({ folders: (folders ?? []).map((f) => f.name), selected, indexed });
  } catch (err) {
    res.status(502).json({ error: err.message, selected, indexed });
  }
});

app.post("/api/library-folders", async (req, res) => {
  const { folders } = req.body ?? {};
  if (folders !== null && !Array.isArray(folders)) {
    return res.status(400).json({ error: "folders must be an array of names, or null for all" });
  }

  try {
    await updateConfig((c) => ({ ...c, librarySync: { ...c.librarySync, folders } }));
  } catch (err) {
    return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
  }
  // Said, not swallowed (owner, 2026-10-04: "there was no indication"). With
  // something on the screens a run would stand down at once and only the log
  // knew; now the save answers with why it isn't indexing, and doesn't start.
  const refusal = await operatorIndexRefusal();
  if (refusal) return res.json({ ok: true, rebuild: "waiting", reason: refusal });
  res.json({ ok: true, rebuild: "started" });

  // The sync scope changed — reindex to match, same as a first-run
  // build (Section 5.3). The caller polls /api/index/status for
  // progress rather than this request staying open for what could be
  // a slow full-library crawl.
  indexWorkDeferred = null;
  startRebuild({ incremental: true, operatorInitiated: true })
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
/**
 * Stand a running rebuild down.
 *
 * The Health screen used to tell operators to quit Refrain to stop a rebuild,
 * because that was true. It takes effect at the next document boundary and
 * leaves a usable index: everything not re-read keeps what it had.
 */
app.post("/api/index/stop", (_req, res) => {
  if (!getRebuildProgress().inProgress) {
    return res.status(409).json({ error: "No rebuild is running." });
  }
  rebuildStopRequested = true;
  console.log("Rebuild stop requested — standing down at the next presentation.");
  res.json({ ok: true });
});

app.post("/api/index/rebuild", async (_req, res) => {
  const refusal = await operatorIndexRefusal();
  if (refusal) return res.status(409).json({ error: refusal });
  try {
    indexWorkDeferred = null; // the operator has taken it in hand
    const index = await startRebuild({ operatorInitiated: true });
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
  const refusal = await operatorIndexRefusal();
  if (refusal) return res.status(409).json({ error: refusal });
  try {
    indexWorkDeferred = null; // the operator has taken it in hand
    const index = await startRebuild({ incremental: true, operatorInitiated: true });
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

/**
 * Slide flags (issue #1): one press records the slide that is live, to fix
 * after the service. See server/slide-flags.js.
 *
 * Reads only the heartbeat's cached state -- nothing here calls ProPresenter,
 * which is what lets it run during a service with performance mode on.
 */
// --- Service screen ---------------------------------------------------------

function jsonTime(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// --- Ending the day on its own (server/auto-end.js) ---------------------------
// Checked once a minute, beside the service log. Sends the summary straight
// after an automatic end when sending is set up: turning auto-end on is the
// church saying nobody needs to read it first. A failed send is tried again
// every 15 minutes, up to 8 times, and the Day screen says how it went.
let autoEndRunning = false;
const AUTO_SEND_RETRY_MS = 15 * 60_000;
const AUTO_SEND_MAX_TRIES = 8;

function autoEndFacts(state, now) {
  return {
    now,
    settings: autoEndSettings(config.serviceModule?.autoEnd),
    state,
    liveNow: Boolean(liveState.live),
    performanceArmed: Boolean(performance.armed),
    closedSince: propresenterClosedSince,
    // In its window and not ended: a crash or a move to the backup Mac
    // mid-service must not end the day and send a half summary.
    serviceUnderWay: activeServices(state, now, serviceOptions().windows).some((s) => s.endedAt == null),
  };
}

async function autoSend(attempt) {
  try {
    await deliverSummary(serviceDay.day, serviceDay.events);
    console.log(`Sent the day summary for ${serviceDay.day} (automatic).`);
  } catch (err) {
    console.error(`Sending the day summary failed (try ${attempt} of ${AUTO_SEND_MAX_TRIES}): ${err.message}`);
  }
}

async function autoEndTick(now = Date.now()) {
  if (!serviceModuleOn() || autoEndRunning || endingDay) return;
  const settings = autoEndSettings(config.serviceModule?.autoEnd);
  if (!settings.enabled) return;
  autoEndRunning = true;
  try {
    await ensureServiceDay();
    const state = serviceState(now);
    const last = state.dayEnds.at(-1);
    if (last) {
      // Only the latest End, only if it ended on its own and was meant to
      // send then. A day ended by hand is never sent from here, nor one that
      // ended on its own while sending wasn't set up.
      if (!last.auto || !last.autoSend || state.reopened) return;
      if (getReportModuleStatus(config).status !== "active") return;
      const sends = serviceDay.events.filter((e) => e.type === "summary-sent" && e.summaryFile === last.summaryFile);
      if (sends.some((e) => e.ok)) return;
      // Counted from the day's record, so a restart doesn't start again.
      const lastTry = sends.reduce((t, e) => Math.max(t, Date.parse(e.at)), 0);
      if (sends.length >= AUTO_SEND_MAX_TRIES || now - lastTry < AUTO_SEND_RETRY_MS) return;
      await autoSend(sends.length + 1);
      return;
    }
    const plan = autoEndPlan(autoEndFacts(state, now));
    if (plan.status !== "due") return;
    const sendable = getReportModuleStatus(config).status === "active";
    const out = await endDay({ auto: { trigger: plan.trigger, note: autoEndNote(plan.trigger, settings), send: sendable } });
    if (out.error) return console.error(`Auto-end didn't end the day: ${out.error}`);
    if (!out.auto) return; // a press of End got there first; nothing to send from here
    if (sendable) await autoSend(1);
    else console.log("The day summary wasn't sent: sending isn't set up (reportModule).");
  } finally {
    autoEndRunning = false;
  }
}

/**
 * Settings › Features › Day summary (owner, 2026-10-04). Auto-end on or off
 * and its two times, sending by email on or off, and the addresses. The mail
 * server login is in .env (Secrets), never here. Saved like a preference: in
 * turn, applied to the settings as they are then.
 */
app.post("/api/day-summary-settings", async (req, res) => {
  const { autoEnd, sendByEmail, recipients } = req.body ?? {};
  // Out of range is refused, not quietly replaced with a default the screen
  // then claims to have saved.
  if (autoEnd !== undefined) {
    const { idleMinutes, closedMinutes } = autoEnd ?? {};
    if (idleMinutes !== undefined && !(Number.isFinite(idleMinutes) && idleMinutes >= 15 && idleMinutes <= 1440)) {
      return res.status(400).json({ error: "Minutes with nothing on the screens must be 15 to 1440." });
    }
    if (closedMinutes !== undefined && !(Number.isFinite(closedMinutes) && closedMinutes >= 5 && closedMinutes <= 360)) {
      return res.status(400).json({ error: "Minutes with ProPresenter closed must be 5 to 360." });
    }
  }
  if (recipients !== undefined && !(Array.isArray(recipients) && recipients.length <= 50 && recipients.every((r) => typeof r === "string" && r.length <= 200))) {
    return res.status(400).json({ error: "recipients must be a list of email addresses" });
  }
  const cleanRecipients = recipients?.map((r) => r.trim()).filter(Boolean);
  const bad = (cleanRecipients ?? []).filter((r) => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(r));
  if (bad.length) return res.status(400).json({ error: `Not an email address: ${bad.join(", ")}` });
  try {
    await updateConfig((c) => {
      const next = { ...c, serviceModule: { ...c.serviceModule }, reportModule: { ...c.reportModule } };
      if (autoEnd !== undefined) next.serviceModule.autoEnd = autoEndSettings({ ...autoEndSettings(c.serviceModule?.autoEnd), ...autoEnd });
      // Sending and addresses only where the backend takes a list of
      // addresses: a church sending to a folder keeps its setup untouched.
      if (deliveryBackendFor(c)?.takesRecipients) {
        if (sendByEmail !== undefined) next.reportModule.enabled = Boolean(sendByEmail);
        if (cleanRecipients) next.reportModule.recipients = cleanRecipients;
      }
      return next;
    });
  } catch (err) {
    return res.status(500).json({ error: `Couldn't save it: ${err.message}` });
  }
  res.json({ ok: true, autoEnd: autoEndSettings(config.serviceModule?.autoEnd), report: getReportModuleStatus(config) });
});

/** For the Day screen: what auto-end will do, and whether it can send. */
function autoEndPayload(state, now) {
  const plan = autoEndPlan(autoEndFacts(state, now));
  const report = getReportModuleStatus(config);
  return {
    ...plan,
    dueAt: plan.dueAt ? jsonTime(plan.dueAt) : null,
    settings: autoEndSettings(config.serviceModule?.autoEnd),
    sendable: report.status === "active",
    sendProblem: report.status === "active" ? null : report.status === "off" ? "Sending is off." : (report.problems ?? []).join(" "),
    endedAutomatically: Boolean(state.dayEnds.at(-1)?.auto),
    closedWatch: client.isLocalHost && platform() !== "win32",
  };
}

function servicePayload(now = Date.now()) {
  const state = serviceState(now);
  const { windows } = serviceOptions();
  const watching = new Set(activeServices(state, now, windows).map((s) => s.serviceId));
  const rowOut = (r) => ({ ...r, firstLive: jsonTime(r.firstLive), lastLive: jsonTime(r.lastLive), returns: r.returns.map((x) => ({ ...x, at: jsonTime(x.at) })) });
  return {
    day: serviceDay.day,
    status: getServiceModuleStatus(config),
    services: state.services.map((s) => {
      const w = serviceWindow(s, windows);
      const sum = serviceSummary(state, s.serviceId, now);
      return {
        serviceId: s.serviceId,
        name: s.name,
        source: s.source,
        startsAt: jsonTime(s.startsAt),
        endedAt: jsonTime(s.endedAt),
        playlist: s.playlist ? { id: s.playlist.id, name: s.playlist.name, count: s.playlist.items?.length ?? 0 } : null,
        playlistMatch: s.playlistMatch ?? null,
        window: w ? { from: jsonTime(w.from), to: jsonTime(w.to) } : null,
        watching: watching.has(s.serviceId),
        summary: { ...sum, startedAt: jsonTime(sum.startedAt), endedAt: jsonTime(sum.endedAt) },
        rows: timelineRows(state, s.serviceId, now).map(rowOut),
      };
    }),
    outside: timelineRows(state, null, now).map(rowOut),
    lockin: state.lockin ? { ...state.lockin, startedAt: jsonTime(state.lockin.startedAt) } : null,
    lockinReminder: lockinReminder(state.lockin, now),
    checks: Object.fromEntries(
      [...state.checks].map(([id, run]) => [id ?? "day", { at: jsonTime(run.at), headline: checksHeadline(run.results), results: run.results }])
    ),
    // A scheduled or timed service starting within 45 minutes whose checks
    // haven't been run: one line at the top of the screen, never a modal.
    checksDue: state.services
      .filter((s) => s.startsAt && s.startsAt > now && s.startsAt - now <= 45 * 60_000 && !state.checks.has(s.serviceId) && !s.endedAt)
      .map((s) => ({ serviceId: s.serviceId, name: s.name, startsAt: jsonTime(s.startsAt), hasPlaylist: Boolean(s.playlist) })),
    checklist: checklistState(currentPhases(), {
      services: state.services.filter((s) => !(s.source === "lockin" && s.endedAt)),
      isDone: (k) => state.steps.get(k),
      checksRun: (serviceId) => state.checks.has(serviceId),
      dayEnded: state.dayEnds.length > 0 && !state.reopened,
      stepKey,
    }),
    phaseProblems: playbookPhases(config.serviceModule?.phases).problems,
    dayEnded: state.dayEnds.length ? { at: jsonTime(state.dayEnds.at(-1).at), summaryFile: state.dayEnds.at(-1).summaryFile } : null,
    reopened: state.reopened,
    report: reportPayload(state),
    telemetry: { status: getServiceFeedModuleStatus(config).status, lastLogOkAt: serviceFeed.state().lastLogOkAt },
    autoEnd: autoEndPayload(state, now),
    holdingPace: holdHeartbeatPace(now),
    beatMs: heartbeatInterval({ lastClientAt, hold: holdHeartbeatPace(now), now }),
    performance: { armed: performance.armed, source: performance.source },
  };
}

function reportPayload(state) {
  const { status, problems } = getReportModuleStatus(config);
  const Backend = deliveryBackendFor(config);
  const recipients = (config.reportModule?.recipients ?? []).length;
  return {
    status,
    problems,
    backend: Backend ? { id: Backend.backendId, name: Backend.displayName, sendsOffMachine: Boolean(Backend.sendsOffMachine) } : null,
    recipients,
    requireReview: config.reportModule?.requireReview !== false,
    lastSent: state.lastSent ? { ...state.lastSent, at: jsonTime(state.lastSent.at) } : null,
  };
}

/** Delivers a day's latest summary through the configured backend, and records the outcome either way. */
async function deliverSummary(day, events) {
  const Backend = deliveryBackendFor(config);
  const last = events.filter((e) => e.type === "day-ended" && e.summaryFile).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  if (!Backend || !last) throw new Error(!last ? "End the day first, so there's a summary to send." : "No delivery backend is set.");
  const { folder } = serviceOptions();
  let markdown = null;
  for (const dir of [path.join(folder, day), path.join("./data/service-days-pending", day)]) {
    markdown = await readFile(path.join(dir, last.summaryFile), "utf-8").catch(() => null);
    if (markdown) break;
  }
  if (!markdown) throw new Error("The summary file is missing.");
  const label = new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  try {
    const out = await new Backend().deliver({ day, subject: `Refrain summary: ${label}`, markdown, moduleConfig: config.reportModule ?? {}, env: process.env });
    recordServiceEvents([buildEvent("summary-sent", { ok: true, detail: out.detail, backend: Backend.backendId, summaryFile: last.summaryFile })]);
    return out;
  } catch (err) {
    recordServiceEvents([buildEvent("summary-sent", { ok: false, detail: err.message, backend: Backend.backendId, summaryFile: last.summaryFile })]);
    throw err;
  }
}

function currentPhases() {
  return playbookPhases(config.serviceModule?.phases).phases;
}

function summaryPendingDir() {
  return "./data/service-summaries-pending";
}

/**
 * Pre-service checks for one service's playlist (phase 2). One scan of the
 * playlist feeds typos, passed dates, missing media and arrangement
 * references; the index and duplicate names are read from memory. Refuses to
 * read ProPresenter while performance mode is holding still, and says so.
 */
async function runServiceChecks(service) {
  const connected = liveState.connected;
  const performanceArmed = performance.armed;
  let scan = null;
  let scanError = null;
  if (protectOn()) scanError = PROTECT_REFUSAL;
  else if (connected && !performanceArmed) {
    try {
      scan = await scanPlaylist(service.playlist.id);
    } catch (err) {
      scanError = err.message;
    }
  }
  const index = getIndex();
  return evaluateChecks({
    connected,
    performanceArmed,
    scan,
    scanError,
    indexedIds: new Set(Object.keys(index?.presentations ?? {})),
    staleness: indexStaleness(index?.builtAt ?? null),
    groups: findDuplicateNames(),
    preferred: preferredArrangements(),
  });
}

/**
 * One hour before a timed service, refresh the index for anything edited
 * since, then go quiet. Refrain-initiated, so it stands down on its own if
 * something goes live. Once per service per run of the app.
 */
const preServiceReindexed = new Set();
let preServiceReindexRunning = false;
async function preServiceReindex(now = Date.now()) {
  if (protectOn() || !serviceModuleOn() || preServiceReindexRunning || performance.armed || !liveState.connected) return;
  const due = serviceState(now).services.find(
    (s) => s.startsAt && s.startsAt - now > 0 && s.startsAt - now <= 60 * 60_000 && !s.endedAt && !preServiceReindexed.has(s.serviceId)
  );
  if (!due) return;
  preServiceReindexed.add(due.serviceId);
  preServiceReindexRunning = true;
  console.log(`"${due.name}" starts within the hour: refreshing the search index for anything edited since.`);
  try {
    await startRebuild({ incremental: true });
  } catch (err) {
    console.error("Pre-service reindex failed:", err.message);
  } finally {
    preServiceReindexRunning = false;
  }
}

function requireServiceModule(res) {
  if (serviceModuleOn()) return true;
  res.status(409).json({ error: "Service day is switched off. Turn it on in Settings › Features." });
  return false;
}

async function ensureServiceDay() {
  if (!serviceDay.day) await loadServiceDay();
  if (serviceDay.loading) await serviceDay.loading;
}

app.get("/api/service/day", async (_req, res) => {
  noteClientActivity();
  if (!requireServiceModule(res)) return;
  await ensureServiceDay();
  res.json({ ...servicePayload(), propresenterLoad });
});

/** Adds a service for today: a name, and optionally a time and a playlist. */
app.post("/api/service/services", async (req, res) => {
  if (!requireServiceModule(res)) return;
  await ensureServiceDay();
  const name = String(req.body?.name ?? "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "Give the service a name." });
  let startsAt = null;
  if (req.body?.time) {
    startsAt = localTimeOn(serviceDay.day, req.body.time);
    if (startsAt == null) return res.status(400).json({ error: 'The time should look like "09:00".' });
  }
  let playlist = null;
  const playlistId = req.body?.playlistId ? String(req.body.playlistId) : null;
  if (playlistId) {
    try {
      // One read, pressed by the operator, the same as Spell Check's scan.
      const { items } = await client.getPlaylistItems(playlistId);
      playlist = {
        id: playlistId,
        name: String(req.body?.playlistName ?? "Playlist").slice(0, 120),
        items: items.map((i) => ({ presentationId: i.id, name: i.name, arrangementName: i.arrangementName })),
      };
    } catch (err) {
      return res.status(502).json({ error: `Couldn't read that playlist from ProPresenter: ${err.message}` });
    }
  }
  const event = buildEvent("service-added", { name, source: "today", startsAt, playlist });
  recordServiceEvents([event]);
  res.json({ ok: true, serviceId: newServiceId(event), ...servicePayload() });
});

app.post("/api/service/services/:id/end", async (req, res) => {
  if (!requireServiceModule(res)) return;
  await ensureServiceDay();
  const service = serviceState().services.find((s) => s.serviceId === req.params.id);
  if (!service) return res.status(404).json({ error: "No service by that id today." });
  if (service.endedAt != null) return res.status(409).json({ error: "That service has already ended." });
  recordServiceEvents([buildEvent("service-ended", { serviceId: service.serviceId })]);
  res.json({ ok: true, ...servicePayload() });
});

/**
 * Lock in for a live event: a watched window with no end, plus performance
 * mode turned on by hand, until released. Nothing here touches ProPresenter.
 */
app.post("/api/service/lockin", async (req, res) => {
  if (!requireServiceModule(res)) return;
  await ensureServiceDay();
  if (serviceState().lockin) return res.status(409).json({ error: "Already locked in. Release it first." });
  const now = Date.now();
  const name =
    String(req.body?.name ?? "").trim().slice(0, 60) ||
    `Live event, ${new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const added = buildEvent("service-added", { name, source: "lockin" }, { now });
  // Remember whether lock-in is the reason performance mode is on, so release
  // turns off only what lock-in turned on.
  const armedPerformance = !(performance.armed && performance.source === "manual");
  if (armedPerformance) setPerformance(armManually(performance, now), now);
  recordServiceEvents([added, buildEvent("lockin-started", { serviceId: newServiceId(added), name, armedPerformance }, { now: now + 1 })]);
  console.log(`Locked in for "${name}". Performance mode on by hand until released.`);
  res.json({ ok: true, ...servicePayload() });
});

/** Ends a lock-in and the performance mode it put on. False when nothing was locked in. */
async function releaseLockin(why = "") {
  await ensureServiceDay();
  const { lockin } = serviceState();
  if (!lockin) return false;
  const now = Date.now();
  recordServiceEvents([buildEvent("lockin-released", { serviceId: lockin.serviceId }, { now })]);
  if (lockin.armedPerformance && performance.armed && performance.source === "manual") {
    setPerformance(disarmManually(performance, now), now);
  }
  console.log(`Released lock-in "${lockin.name}"${why}.`);
  return true;
}

app.post("/api/service/lockin/release", async (_req, res) => {
  if (!requireServiceModule(res)) return;
  if (!(await releaseLockin())) return res.status(409).json({ error: "Nothing is locked in." });
  res.json({ ok: true, ...servicePayload() });
});

app.post("/api/service/services/:id/checks", async (req, res) => {
  if (!requireServiceModule(res)) return;
  await ensureServiceDay();
  const service = serviceState().services.find((s) => s.serviceId === req.params.id);
  if (!service) return res.status(404).json({ error: "No service by that id today." });
  if (!service.playlist) return res.status(409).json({ error: "Checks read the service's playlist. Add this service again with a playlist, or set playlistMatch in the schedule." });
  const results = await runServiceChecks(service);
  recordServiceEvents([buildEvent("checks-run", { serviceId: service.serviceId, results })]);
  res.json({ ok: true, results, headline: checksHeadline(results), ...servicePayload() });
});

/** Ticks or unticks a checklist step. Only steps the playbook actually has. */
app.post("/api/service/steps", async (req, res) => {
  if (!requireServiceModule(res)) return;
  await ensureServiceDay();
  const { phaseId, stepId, serviceId = null, done } = req.body ?? {};
  const phase = currentPhases().find((p) => p.id === phaseId);
  const step = phase?.steps.find((st) => st.id === stepId);
  if (!phase || !step || step.checks || step.end || typeof done !== "boolean") {
    return res.status(400).json({ error: "That isn't a step you can tick." });
  }
  if (phase.scope !== "day" && !serviceState().services.some((s) => s.serviceId === serviceId)) {
    return res.status(400).json({ error: "That step belongs to a service; say which one." });
  }
  recordServiceEvents([buildEvent("step-set", { phaseId, stepId, serviceId: phase.scope === "day" ? null : serviceId, done })]);
  res.json({ ok: true, ...servicePayload() });
});

/** Why End can or can't compare arrangements on this machine, in words. */
async function driftReadiness() {
  const status = getArrangementModuleStatus(config);
  if (status !== "active") return `the Arrangement module is ${status} on this machine`;
  if (config.role !== "logger") return "this machine isn't the logger (see Settings)";
  const Provider = await getArrangementProviderClass();
  if (!Provider.supportsPlanBrowsing) return `${Provider.displayName} has no weekend plans to compare against`;
  return null;
}

/**
 * End the day (phase 4). Closes open services and any lock-in, compares the
 * arrangements of the songs actually shown (results listed, never pushed),
 * and writes the day summary: to the day's folder always, and to
 * serviceModule.summaryFolder when one is set (phase 5, folder delivery).
 * A new summary file every time, never an overwrite.
 */
app.post("/api/service/end-day", async (_req, res) => {
  if (!requireServiceModule(res)) return;
  const out = await endDay();
  if (out.error) return res.status(500).json({ error: out.error });
  res.json({ ok: true, summary: out.markdown, delivered: out.delivered, ...servicePayload() });
});

/**
 * Ends the day: the End key, and auto-end (`auto`: { trigger, note }), which
 * also says so at the top of the summary and in the day's record.
 */
let endingDay = null;
async function endDay(opts = {}) {
  // One at a time: a press of End while auto-end is mid-way (waiting on the
  // arrangement comparison) gets that same result, not a second End.
  if (endingDay) return endingDay;
  endingDay = endDayOnce(opts).finally(() => {
    endingDay = null;
  });
  return endingDay;
}

async function endDayOnce({ auto = null } = {}) {
  await ensureServiceDay();
  const now = Date.now();
  let state = serviceState(now);

  const closing = [];
  for (const s of state.services) {
    if (s.endedAt == null && s.source !== "lockin") closing.push(buildEvent("service-ended", { serviceId: s.serviceId }, { now }));
  }
  if (state.lockin) {
    closing.push(buildEvent("lockin-released", { serviceId: state.lockin.serviceId }, { now }));
    if (state.lockin.armedPerformance && performance.armed && performance.source === "manual") setPerformance(disarmManually(performance, now), now);
  }
  if (closing.length) recordServiceEvents(closing);
  state = serviceState(now);

  // Arrangement drift, for songs that actually went live.
  let drift = { ran: false, reason: await driftReadiness() };
  if (!drift.reason) {
    const shown = new Set(state.segments.map((g) => g.presentationId));
    try {
      const out = await compareWeekendSongs({ onlyPresentationIds: shown });
      drift = out.notFound ? { ran: false, reason: "no past plan was found to compare against" } : { ran: true, ...out };
    } catch (err) {
      drift = { ran: false, reason: `the comparison failed (${err.message})` };
    }
  }

  let flags = [];
  try {
    flags = (await listFlags({ folder: slideFlagsFolder() })).filter((f) => dayKey(Date.parse(f.capturedAt)) === serviceDay.day);
  } catch {
    // No flags folder yet is the same as no flags.
  }

  const payload = servicePayload(now);
  const services = payload.services.map((s) => ({
    ...s,
    startsAt: s.startsAt ? Date.parse(s.startsAt) : null,
    summary: { ...s.summary, startedAt: s.summary.startedAt ? Date.parse(s.summary.startedAt) : null },
    rows: timelineRows(state, s.serviceId, now),
  }));
  let markdown = renderDaySummary({
    day: serviceDay.day,
    services: services.filter((s) => s.summary.items || s.source !== "lockin"),
    outside: timelineRows(state, null, now),
    flags: flagsByService(flags, state),
    checks: state.checks,
    skipped: skippedSteps(payload.checklist),
    drift,
    reopened: state.dayEnds.length > 0,
    endedAt: now,
  });

  // Said in the summary itself when nobody pressed End.
  if (auto) markdown = withAutoNote(markdown, auto.note);
  const ended = buildEvent("day-ended", auto ? { auto: auto.trigger, autoSend: Boolean(auto.send) } : {}, { now: now + 1 });
  const summaryFile = `summary-${ended.id}.md`;
  const { folder } = serviceOptions();
  let delivered = null;
  try {
    await saveTextRecord(serviceDay.day, summaryFile, markdown, { folder, pendingDir: "./data/service-days-pending" });
  } catch (err) {
    return { error: `Couldn't save the day summary on this machine: ${err.message}. The day was not ended.` };
  }
  const summaryFolder = config.serviceModule?.summaryFolder;
  if (typeof summaryFolder === "string" && summaryFolder.trim()) {
    const stamp = new Date(now).toTimeString().slice(0, 5).replace(":", "");
    const name = `${serviceDay.day} Refrain summary ${stamp}.md`;
    try {
      const r = await saveTextRecord("", name, markdown, { folder: summaryFolder.trim(), pendingDir: summaryPendingDir() });
      delivered = r.shared ? { ok: true, name } : { ok: false, name, reason: r.reason };
    } catch (err) {
      delivered = { ok: false, name, reason: err.message };
    }
  }
  recordServiceEvents([{ ...ended, summaryFile, delivered }]);
  // Straight after End only when the church has opted out of reviewing
  // first. Its outcome is recorded either way and shown on the screen.
  if (!auto && getReportModuleStatus(config).status === "active" && config.reportModule?.requireReview === false) {
    deliverSummary(serviceDay.day, serviceDay.events).catch((err) => console.error("Sending the day summary failed:", err.message));
  }
  console.log(`Ended ${serviceDay.day}${auto ? ` automatically (${auto.trigger})` : ""}. Summary written${delivered ? (delivered.ok ? ` and copied to ${summaryFolder}` : `; copying to ${summaryFolder} is waiting (${delivered.reason})`) : ""}.`);
  return { markdown, delivered, auto: Boolean(auto) };
}

/**
 * Sends the day summary (issue #4). A person presses Send, after reading it,
 * unless the church has set reportModule.requireReview to false. This is the
 * first thing in Refrain that can send data off the machine; it only exists
 * for a church that turned the report module on and filled in where to send.
 */
app.post("/api/service/send-summary", async (_req, res) => {
  if (!requireServiceModule(res)) return;
  await ensureServiceDay();
  const { status, problems } = getReportModuleStatus(config);
  if (status !== "active") return res.status(409).json({ error: status === "off" ? "Sending summaries is off (reportModule.enabled)." : problems.join(" ") });
  if (!serviceDay.events.some((e) => e.type === "day-ended")) return res.status(409).json({ error: "End the day first, so there's a summary to send." });
  try {
    const out = await deliverSummary(serviceDay.day, serviceDay.events);
    res.json({ ok: true, detail: out.detail, ...servicePayload() });
  } catch (err) {
    res.status(502).json({ error: err.message, ...servicePayload() });
  }
});

/** Send log (Service screen): hands this machine's diagnostics to the announcement server. */
app.post("/api/service-feed/send-log", async (_req, res) => {
  const out = await serviceFeed.sendLogs();
  // Also pressed from Settings > Telemetry, so it must not need the Service screen.
  res.status(out.ok ? 200 : 409).json({ ...out, ...(serviceModuleOn() ? servicePayload() : {}) });
});

/** The latest summary for a day, as Markdown. */
app.get("/api/service/summary", async (req, res) => {
  if (!requireServiceModule(res)) return;
  await ensureServiceDay();
  const day = typeof req.query.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day) ? req.query.day : serviceDay.day;
  const { folder } = serviceOptions();
  const events = day === serviceDay.day ? serviceDay.events : await readDay(day, { folder });
  const last = events.filter((e) => e.type === "day-ended" && e.summaryFile).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  if (!last) return res.status(404).json({ error: "That day hasn't been ended yet." });
  for (const dir of [path.join(folder, day), path.join("./data/service-days-pending", day)]) {
    try {
      const text = await readFile(path.join(dir, last.summaryFile), "utf-8");
      return res.type("text/markdown").send(text);
    } catch {
      // try the other copy
    }
  }
  res.status(404).json({ error: "The summary file is missing." });
});

/**
 * A recent day that had services but was never ended, for one line on Health
 * (proposed default: shown once, then it stops; the screen remembers it was
 * seen). Looks back a week, skipping today.
 */
app.get("/api/service/unfinished", async (_req, res) => {
  if (!serviceModuleOn()) return res.json({ day: null });
  const { folder, schedule } = serviceOptions();
  let day = dayKey(Date.now());
  for (let i = 0; i < 7; i++) {
    day = previousDay(day);
    const events = await readDay(day, { folder });
    if (!events.length) continue;
    const st = foldDay(events, { schedule, day });
    const hadService = st.segments.some((g) => g.serviceId) || st.services.some((s) => s.source !== "schedule");
    if (hadService && !st.dayEnds.length) return res.json({ day, services: st.services.map((s) => s.name) });
  }
  res.json({ day: null });
});

function slideFlagsFolder() {
  const folder = config.slideFlagsModule?.folder;
  return typeof folder === "string" && folder.trim() ? folder.trim() : DEFAULT_FLAGS_FOLDER;
}

function configuredFlagTypes() {
  return flagTypes(config.slideFlagsModule?.types);
}

/** A type the church configured, null for "no type", or undefined if it is neither. */
function acceptFlagType(type) {
  if (type === undefined || type === null || type === "") return null;
  return configuredFlagTypes().some((t) => t.label === type) ? type : undefined;
}

app.post("/api/slide-flags", async (req, res) => {
  noteClientActivity();
  const type = acceptFlagType(req.body?.type);
  if (type === undefined) return res.status(400).json({ error: "That is not one of this church's flag types." });
  const slideId = liveState.slide?.presentationId;
  const built = buildFlag(liveState, { type, indexEntry: slideId ? getIndex().presentations?.[slideId] ?? null : null });
  if (!built.ok) return res.status(409).json({ error: built.error });
  try {
    const saved = await saveFlag(built.flag, { folder: slideFlagsFolder() });
    res.json({ ok: true, flag: built.flag, ...saved });
  } catch (err) {
    // Could not even save it on this machine -- the one outcome the operator
    // must hear about, because the flag does not exist.
    res.status(500).json({ error: `The flag was not saved: ${err.message}` });
  }
});

app.get("/api/slide-flags", async (_req, res) => {
  try {
    // Cheap, and the natural moment: someone is looking at the list.
    await retryPendingFlags({ folder: slideFlagsFolder() });
    const all = await listFlags({ folder: slideFlagsFolder() });
    const days = Number.isInteger(config.slideFlagsModule?.keepResolvedDays)
      ? config.slideFlagsModule.keepResolvedDays
      : DEFAULT_KEEP_RESOLVED_DAYS;
    const flags = visibleFlags(all, { keepResolvedDays: days });
    res.json({ flags, types: configuredFlagTypes(), keepResolvedDays: days, hiddenResolved: all.length - flags.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * A change to one flag: a note, a type, resolved or not. Saved as its own
 * file, never an edit to the flag's -- see server/slide-flags.js for why that
 * matters when two machines share the folder.
 */
app.post("/api/slide-flags/:id", async (req, res) => {
  const body = req.body ?? {};
  const fields = {};
  if (body.note !== undefined) fields.note = String(body.note);
  if (body.resolved !== undefined) fields.resolved = Boolean(body.resolved);
  if (body.type !== undefined) {
    const type = acceptFlagType(body.type);
    if (type === undefined) return res.status(400).json({ error: "That is not one of this church's flag types." });
    fields.type = type;
  }
  const built = buildUpdate(req.params.id, fields);
  if (!built.ok) return res.status(400).json({ error: built.error });
  try {
    const saved = await saveUpdate(built.update, { folder: slideFlagsFolder() });
    res.json({ ok: true, update: built.update, ...saved });
  } catch (err) {
    res.status(500).json({ error: `That change was not saved: ${err.message}` });
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
  setPerformance(armed ? armManually(performance, Date.now()) : disarmManually(performance, Date.now()));
  console.log(`Performance mode ${armed ? "ON" : "OFF"} (by hand) — ${describePerformance(performance)}`);
  res.json({
    armed: performance.armed,
    source: performance.source,
    since: performance.since ? new Date(performance.since).toISOString() : null,
    description: describePerformance(performance),
  });
});

app.get("/api/search", (req, res) => {
  // Query strings can carry lists and objects (?q[]=a, ?q[a]=b); search
  // takes text only, so anything else counts as not given (stress test,
  // 2026-10-04: q.trim threw).
  for (const key of ["q", "playlistId", "dateField", "dateFrom", "dateTo"]) {
    const v = req.query[key];
    if (v !== undefined && typeof v !== "string") return res.status(400).json({ error: `Send ${key} once, as text.` });
  }
  const text = (v) => (typeof v === "string" ? v : undefined);
  const q = text(req.query.q);
  const playlistId = text(req.query.playlistId);
  const dateField = text(req.query.dateField);
  const dateFrom = text(req.query.dateFrom);
  const dateTo = text(req.query.dateTo);
  const folders = Array.isArray(req.query.folders) ? req.query.folders.filter((f) => typeof f === "string") : text(req.query.folders);
  const folderList = Array.isArray(folders) ? folders : folders ? String(folders).split(",") : undefined;
  const params = { query: q ?? "", playlistId, dateField, dateFrom, dateTo, folders: folderList };
  let results = search(params);
  // Close matches, only when nothing matched exactly (see suggestQuery).
  let corrected = null;
  if (!results.length && q && q.trim()) {
    const suggestion = suggestQuery(q);
    if (suggestion) {
      const retry = search({ ...params, query: suggestion });
      if (retry.length) {
        results = retry;
        corrected = suggestion;
      }
    }
  }
  // Which arrangements the index reads, so an empty result can say "in FS or T"
  // and offer Deep Search for the rest.
  res.json({ results, corrected, searched: preferredArrangements() });
});

// Deep Search: the slides a song has outside the arrangement the index reads.
// Only ever asked for by a person pressing the button on an empty result.
app.get("/api/search/deep", (req, res) => {
  const v = req.query.q;
  if (typeof v !== "string") return res.status(400).json({ error: "Send q once, as text." });
  const folders = Array.isArray(req.query.folders) ? req.query.folders.filter((f) => typeof f === "string") : typeof req.query.folders === "string" ? req.query.folders : undefined;
  const folderList = Array.isArray(folders) ? folders : folders ? folders.split(",") : undefined;
  res.json({ results: searchOtherArrangements({ query: v, folders: folderList }), ...otherSlidesCoverage() });
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
      return { index: requestedIndex, corrected: false, arrangementName: live.arrangementName, anchorChecked: true, missing: true };
    }
    return { index: found, corrected: found !== requestedIndex, arrangementName: live.arrangementName, anchorChecked: true };
  } catch {
    // Timed out, or ProPresenter refused. Fire what was asked for, and report
    // it as unchecked rather than as "not corrected" -- those are different
    // claims and only one of them is honest here.
    return { index: requestedIndex, corrected: false, arrangementName: null, anchorChecked: false };
  }
}

/**
 * Puts one slide on the screens by its anchor, recording where the operator
 * was for Return. Shared by Search's Go Live, safe slides on Live, and an
 * approved phone's safe slides, so all three fire exactly the same way.
 * Returns `{ refused }` instead of firing when `requireAnchor` is set and the
 * slide can't be found. Throws if ProPresenter fails.
 */
async function fireSlide({ presentationId, slideIndex, groupId, groupOffset, slideText, requireAnchor = false }) {
  // Both reads are independent of each other, and ProPresenter can take
  // seconds per call on a busy machine, so run them together rather than
  // stacking their latency ahead of the slide actually going live. Reading
  // the current slide is best-effort: if it fails, keep whatever pin we had
  // rather than clobbering a good one.
  const [target, current] = await Promise.all([
    resolveTriggerIndex(presentationId, slideIndex, { groupId, groupOffset, slideText }),
    client.getCurrentSlide({ timeoutMs: RETURN_PIN_READ_BUDGET_MS }).catch(() => null),
  ]);

  // Capture where we were before jumping, so "Return" can bring us back.
  // Compared against the corrected index, since that's what will fire.
  if (current && !(current.presentationId === presentationId && current.slideIndex === target.index)) {
    returnPin = { ...current, leftAt: new Date().toISOString() };
    // Also into the history, so a jump between heartbeats is not missed.
    returnHistory = pushLiveItem(returnHistory, returnPin);
  }

  // A safe slide must be exactly the slide that was saved. If ProPresenter
  // no longer has it (the deck was edited and the group is gone), refuse,
  // rather than firing whatever now sits at that number. Search's Go Live
  // doesn't ask for this and behaves as it always has.
  if (requireAnchor && target.missing) {
    return { refused: "Can't find that slide any more. The presentation was changed; save it as a safe slide again." };
  }

  await client.triggerSlide(presentationId, target.index);

  /**
   * Record where we just went, not only where we came from.
   *
   * The heartbeat already puts everything on the screens into the history,
   * but it runs every 4 seconds -- so a jump followed by Return inside that
   * window left no trace of the song that was just used. That is not an edge
   * case, it is the shape of the whole feature: find it, send it, go back.
   * The operator could return to the plan and then had no way forward to the
   * thing they had just sent.
   *
   * Pushed after the pin so it lands in front of it, which is the truth: this
   * is what is live now, and the pin is what it replaced.
   */
  returnHistory = pushLiveItem(returnHistory, {
    presentationId,
    slideIndex: target.index,
    name: getPresentationName(presentationId),
    leftAt: new Date().toISOString(),
  });
  // Deliberately not awaited: the slide is already live, and focusing the
  // editor measured ~3s on a real machine. It's a nice-to-have, so it must
  // not hold up the operator's response.
  client.focusPresentation(presentationId).catch(() => {});
  return {
    ok: true,
    firedIndex: target.index,
    corrected: target.corrected,
    anchorChecked: target.anchorChecked,
    arrangementName: target.arrangementName,
  };
}

app.post("/api/trigger", async (req, res) => {
  const { presentationId, slideIndex, groupId, groupOffset, slideText, requireAnchor } = req.body ?? {};
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
    const out = await fireSlide({ presentationId, slideIndex: requested, groupId, groupOffset, slideText, requireAnchor: requireAnchor === true });
    if (out.refused) return res.status(409).json({ error: out.refused });
    res.json(out);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * Presentations whose preferred arrangement (FS, say) exists but isn't the
 * one selected (handoff §38). Answered from the index where it recorded the
 * selected arrangement (every presentation read since this was added). Any
 * others are read through ProPresenter, at most PREFERRED_READS_PER_PRESS per
 * press, paced, and never during performance mode, with something on the
 * screens, in a service window, or beside an index run: each read costs
 * ProPresenter ~10 MB it keeps until it restarts, and in a church that uses
 * FS as standard the candidates can be most of the library.
 */
const PREFERRED_READS_PER_PRESS = 40;
let preferredReportRunning = false;
app.post("/api/index/preferred-arrangements", async (_req, res) => {
  const preferred = preferredArrangements();
  if (!preferred.length) return res.status(409).json({ error: "No preferred arrangement is set (preferredArrangements in config.json)." });
  if (preferredReportRunning) return res.status(409).json({ error: "Already checking." });
  const candidates = Object.entries(getIndex().presentations ?? {}).filter(([, p]) => p.arrangementSource === "preferred");
  const known = candidates.filter(([, p]) => p.selectedArrangementId !== undefined);
  const unknown = candidates.filter(([, p]) => p.selectedArrangementId === undefined);
  const busy = () =>
    frozen()
      ? `Performance mode is on, so Refrain is holding still. ${describePerformance(performance)}`
      : liveState.live
        ? "Something is on the screens. Check when nothing is live: each read makes ProPresenter wait."
        : holdHeartbeatPace()
          ? "A service window is open. Check outside it."
          : getRebuildProgress().inProgress
            ? "The index is being rebuilt. Check once it finishes."
            : null;
  if (unknown.length && protectOn()) unknown.length = 0; // answered from the index only
  if (unknown.length && busy()) return res.status(409).json({ error: busy() });
  preferredReportRunning = true;
  try {
    const entry = (id, p, hit) => ({ presentationId: id, name: p.name ?? "Untitled", folder: p.folder ?? null, ...hit });
    const notSelected = [];
    for (const [id, p] of known) {
      if (p.selectedArrangementId !== p.arrangementId && !selectedIsPreferred(p.selectedArrangementName, preferred)) {
        notSelected.push(entry(id, p, { preferredName: p.arrangementName, selectedName: p.selectedArrangementName }));
      }
    }
    let read = 0;
    let unread = 0;
    let stopped = false;
    for (const [id, p] of unknown.slice(0, PREFERRED_READS_PER_PRESS)) {
      if (busy()) {
        stopped = true;
        break;
      }
      try {
        const hit = preferredNotSelected(await client.getPresentation(id), preferred);
        if (hit) notSelected.push(entry(id, p, hit));
      } catch {
        unread += 1;
      }
      read += 1;
      await new Promise((r) => setTimeout(r, 120));
    }
    notSelected.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ checked: known.length + read - unread, unread, remaining: unknown.length - read, stopped, notSelected });
  } finally {
    preferredReportRunning = false;
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
  // Only what's switched on is asked of ProPresenter (Settings › Features).
  const on = { looks: featureOn(config, "looks"), macros: featureOn(config, "macros"), messages: featureOn(config, "messages") };
  const [looks, macros, messages, currentLook] = await Promise.all([
    on.looks ? client.getLooks().catch(() => []) : [],
    on.macros ? client.getMacros().catch(() => []) : [],
    on.messages ? client.getMessages().catch(() => []) : [],
    on.looks ? client.getCurrentLook().catch(() => null) : null,
  ]);
  res.json({ features: on, looks, currentLook, macros: markHidden(macros, config.liveModule?.hiddenMacros), messages: markHidden(messages, config.liveModule?.hiddenMessages) });
});

/** Just the current Look, for Live to refresh after a Look or a macro. */
app.get("/api/live/current-look", async (_req, res) => {
  res.json({ currentLook: await client.getCurrentLook().catch(() => null) });
});

// --- Safe slides (handoff §39a) ---------------------------------------------

/**
 * Every change to `liveModule` (hidden macros, safe slides, recent message
 * values) goes through this one queue. Each change is computed from the
 * config as it is when its turn comes, not when it was asked for, so two
 * changes made together can't each save a copy that drops the other's. The
 * write itself is saveConfig's atomic temp-then-rename.
 * @param {(liveModule: object) => object} change  returns the new liveModule
 * @returns {Promise<object>} the saved liveModule
 */
function updateLiveModule(change) {
  // The same queue as every other config change (updateConfig).
  return updateConfig((c) => ({ ...c, liveModule: change({ ...(c.liveModule ?? {}) }) })).then((saved) => saved.liveModule);
}

/**
 * updateLiveModule for a route: answers itself on failure and returns null.
 * A change can refuse by throwing an error with a `status` (e.g. 400 for "the
 * list is full"); anything else is a failed save.
 */
async function saveLiveModule(res, change) {
  try {
    return await updateLiveModule(change);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.status ? err.message : `Failed to save config.json: ${err.message}` });
    return null;
  }
}
const refuse = (status, message) => Object.assign(new Error(message), { status });

/**
 * Today's phone PIN, for the booth: shown on the Flags screen and Health so
 * whoever is running the screens can read it out. This route is on the main
 * app, which only this machine can reach; the phone listener never serves it.
 */
app.get("/api/network/pin", (_req, res) => {
  if (getNetworkModuleStatus(config, port).status !== "active") return res.status(409).json({ error: "Phone flags are off." });
  const mode = remotePinMode();
  res.json({ mode, pin: expectedRemotePin(), changesAt: mode === "daily" ? new Date(endOfDay()).toISOString() : null, urls: networkUrls(), wrongToday: remotePinGuard.count() });
});

/**
 * Everything the booth's Phone panel needs, on or off: addresses, today's
 * PIN, a QR code for the first address (made here, no service), the phones
 * that have signed in, and the last phone presses.
 */
app.get("/api/network/setup", async (_req, res) => {
  await ensureRemoteDevices();
  const { status, problems } = getNetworkModuleStatus(config, port);
  const urls = status === "active" ? networkUrls() : [];
  const loopbackOnly = urls.length > 0 && urls.every((u) => u.includes("127.0.0.1"));
  const qrSvg = urls[0] && !loopbackOnly ? await QRCode.toString(urls[0], { type: "svg", margin: 1, errorCorrectionLevel: "M" }).catch(() => null) : null;
  res.json({
    status,
    problems,
    running: Boolean(remoteServer?.listening),
    urls,
    loopbackOnly,
    pinMode: remotePinMode(),
    pin: status === "active" ? expectedRemotePin() : null,
    wrongToday: remotePinGuard.count(),
    qrSvg,
    phones: deviceList(remoteDevices),
    activity: phoneActivity,
  });
});

/** Saves networkModule over the latest config, atomically. */
async function saveNetworkModule(change) {
  await updateConfig((c) => ({ ...c, networkModule: { ...(c.networkModule ?? {}), ...change } }));
}

/**
 * Turns phones on from the booth's panel: every network address, port 9997,
 * a daily PIN unless one is already chosen. Starts now, no restart. This is
 * what makes Refrain reachable from other devices on the network, so it's
 * only ever a deliberate press on this Mac.
 */
app.post("/api/network/enable", async (_req, res) => {
  try {
    const current = config.networkModule ?? {};
    await saveNetworkModule({ enabled: true, host: current.host ?? "0.0.0.0", port: current.port ?? 9997, pin: current.pin ?? "daily" });
  } catch (err) {
    return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
  }
  if (!remoteServer?.listening) startRemoteListener();
  await new Promise((r) => setTimeout(r, 200)); // let it bind before reporting its address
  res.json({ ok: true });
});

/** Turns phones off and stops the listener now. */
app.post("/api/network/disable", async (_req, res) => {
  try {
    await saveNetworkModule({ enabled: false });
  } catch (err) {
    return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
  }
  remoteServer?.close();
  remoteServer = null;
  res.json({ ok: true });
});

/** Approve a phone for control, take approval back, or remove it (signs it out). */
app.post("/api/network/phones/:id", async (req, res) => {
  await ensureRemoteDevices();
  const { action } = req.body ?? {};
  if (!remoteDevices.devices?.[req.params.id]) return res.status(404).json({ error: "No phone by that id." });
  if (action === "approve") changeDevices(setApproved(remoteDevices, req.params.id, true), { now: true });
  else if (action === "unapprove") changeDevices(setApproved(remoteDevices, req.params.id, false), { now: true });
  else if (action === "remove") changeDevices(removeDevice(remoteDevices, req.params.id), { now: true });
  else return res.status(400).json({ error: 'action must be "approve", "unapprove" or "remove"' });
  res.json({ ok: true, phones: deviceList(remoteDevices) });
});

/**
 * Next and previous slide from the booth: clicking Live's Next preview. One
 * press, like the other Live keys. The active presentation's own next, not
 * ProPresenter's playlist-wide one (see propresenter-client.js).
 */
app.post("/api/live/step", async (req, res) => {
  const dir = req.body?.dir;
  if (dir !== "next" && dir !== "previous") return res.status(400).json({ error: 'dir must be "next" or "previous"' });
  try {
    if (dir === "next") await client.triggerNext();
    else await client.triggerPrevious();
    beatNow();
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/** The current and next slide, for Live's preview (same rules as the phone's). */
app.get("/api/preview", (_req, res) => {
  noteClientActivity();
  const p = currentPreview();
  const img = (t) => (t && picturesOn() ? `/api/preview/image/${encodeURIComponent(t.presentationId)}/${t.slideIndex}` : null);
  res.json({
    presentationName: p.presentationName ?? null,
    atEnd: p.atEnd,
    current: p.current ? { slideNumber: p.current.slideIndex + 1, text: p.current.text, image: img(p.current) } : null,
    next: p.next ? { slideNumber: p.next.slideIndex + 1, text: p.next.text, image: img(p.next) } : null,
    lastPhoneAction: phoneActivity[0] ?? null,
  });
});

app.get("/api/preview/image/:pid/:idx", async (req, res) => {
  const idx = Number(req.params.idx);
  if (!pictureAllowed(req.params.pid, idx)) return res.status(404).json({ error: "Slide pictures are off." });
  const p = currentPreview();
  const nowOrNext = [p.current, p.next].some((t) => t && t.presentationId === req.params.pid && t.slideIndex === idx);
  // The church's own safe slides too (at most eight, same as the phone's
  // route), for the safe slides on Now. Rendered once and kept on disk.
  const aSafeSlide = isSafeSlide(req.params.pid, idx);
  // And slides Spell Check flagged, so they can be found by eye in the editor.
  // Each new picture costs ProPresenter memory until it restarts, so these are
  // never drawn during a service.
  const flagged = spellcheckPictures.has(`${req.params.pid}:${idx}`);
  if (!nowOrNext && !aSafeSlide && !flagged) {
    return res.status(404).json({ error: "Only the current and next slide, a safe slide, or a slide Spell Check found can be previewed." });
  }
  // The address can show a different slide after one is removed in
  // ProPresenter, so the browser checks each time; the answer is tagged with
  // the file's version, and an unchanged picture is a 304 before any picture
  // work is done.
  const fp = await pictureFingerprint(req.params.pid);
  const tag = fp ? `"${fp}:${idx}"` : null;
  if (tag && req.headers["if-none-match"] === tag) return res.status(304).end();
  // During a service (performance mode), nothing new is drawn: only pictures
  // already on disk, rendered ahead (owner, 2026-10-04: "pre cached so that it
  // does not hurt performance at all").
  const img = performance.armed ? await storedSlideThumb(req.params.pid, idx) : await thumbCache(req.params.pid, idx, fp);
  if (!img) return res.status(404).json({ error: "No picture for that slide." });
  res.set("Cache-Control", "private, no-cache");
  if (tag) res.set("ETag", tag);
  res.type(img.type).send(img.bytes);
});

/** New secret: every phone is signed out, and the daily PIN changes now. */
app.post("/api/network/forget-phones", async (_req, res) => {
  try {
    await forgetAllPhones();
    res.json({ ok: true, pin: expectedRemotePin() });
  } catch (err) {
    res.status(500).json({ error: `Couldn't save the new secret: ${err.message}` });
  }
});

app.get("/api/live/safe-slides", (_req, res) => {
  res.json({ safeSlides: safeSlides(config.liveModule?.safeSlides), pictures: picturesOn() || quickSlidePicturesOn() });
});

/** Saves a slide from Search as a safe slide. Reads nothing from ProPresenter. */
app.post("/api/live/safe-slides", async (req, res) => {
  const b = req.body ?? {};
  const input = {
    presentationId: b.presentationId,
    presentationName: b.presentationName,
    slideIndex: parseSlideIndex(b.slideIndex),
    groupId: b.groupId || null,
    groupOffset: b.groupOffset === "" || b.groupOffset == null ? null : Number(b.groupOffset),
    slideText: b.slideText,
    label: b.label,
  };
  let added = null;
  const saved = await saveLiveModule(res, (m) => {
    const r = addSafeSlide(m.safeSlides, input);
    if (r.error) throw refuse(400, r.error);
    added = r.added;
    return { ...m, safeSlides: r.list };
  });
  if (!saved) return;
  collectQuickSlidePictures().catch(() => {});
  res.json({ ok: true, added, safeSlides: saved.safeSlides });
});

/**
 * Keeps the slide on the screens now as a safe slide, from Now's "Keep as
 * safe slide" (owner, 2026-10-04: the slide worth keeping, the logo, is
 * usually the one up). One read of the live presentation, on this press
 * only, so it's kept by its anchor (group and position) like one kept from
 * Search, and can't later fire a different slide.
 */
app.post("/api/live/safe-slides/current", async (_req, res) => {
  const preview = currentPreview();
  const now = preview.current;
  if (!now) return res.status(409).json({ error: "Nothing is on the screens to keep." });
  let slide = null;
  try {
    const doc = await client.getPresentation(now.presentationId, { timeoutMs: ANCHOR_RESOLVE_BUDGET_MS });
    slide = flattenGroups(resolveArrangement(doc, []).groups).find((x) => x.index === now.slideIndex) ?? null;
  } catch {
    return res.status(502).json({ error: "ProPresenter didn't answer. Try again in a moment." });
  }
  if (!slide) return res.status(409).json({ error: "That slide has just changed. Try again." });
  const input = {
    presentationId: now.presentationId,
    // The name ProPresenter reports for what's live, so a picture-only slide
    // (no words to name it by) is labelled "-Important Screens-, slide 2",
    // not "Safe slide". Presentations outside the index are kept too.
    presentationName: preview.presentationName ?? getIndex().presentations?.[now.presentationId]?.name ?? null,
    slideIndex: now.slideIndex,
    groupId: slide.groupId ?? null,
    groupOffset: Number.isInteger(slide.groupOffset) ? slide.groupOffset : null,
    slideText: slide.text ?? "",
  };
  let added = null;
  const saved = await saveLiveModule(res, (m) => {
    const r = addSafeSlide(m.safeSlides, input);
    if (r.error) throw refuse(400, r.error);
    added = r.added;
    return { ...m, safeSlides: r.list };
  });
  if (!saved) return;
  collectQuickSlidePictures().catch(() => {});
  res.json({ ok: true, added, safeSlides: saved.safeSlides });
});

/** Takes every safe slide off the list at once (the slides themselves are untouched in ProPresenter). */
app.post("/api/live/safe-slides/clear", async (_req, res) => {
  const saved = await saveLiveModule(res, (m) => ({ ...m, safeSlides: [] }));
  if (!saved) return;
  res.json({ ok: true, safeSlides: [] });
});

/** Rename, move or remove one. */
app.post("/api/live/safe-slides/:id", async (req, res) => {
  const { action, label, dir } = req.body ?? {};
  if (!["remove", "rename", "move"].includes(action)) return res.status(400).json({ error: 'action must be "remove", "rename" or "move"' });
  const saved = await saveLiveModule(res, (m) => {
    const current = safeSlides(m.safeSlides);
    if (!current.some((x) => x.id === req.params.id)) throw refuse(404, "No safe slide by that id.");
    const list =
      action === "remove"
        ? removeSafeSlide(current, req.params.id)
        : action === "rename"
          ? renameSafeSlide(current, req.params.id, label)
          : moveSafeSlide(current, req.params.id, Number(dir));
    return { ...m, safeSlides: list };
  });
  if (!saved) return;
  res.json({ ok: true, safeSlides: saved.safeSlides });
});

/**
 * Hides or shows one macro on the Live screen. Saved to config.json (atomic
 * write), so it survives a restart and applies to every browser on this
 * machine. Only changes what Refrain shows; nothing in ProPresenter moves.
 */
app.post("/api/live/visibility", async (req, res) => {
  const { kind, id, hidden } = req.body ?? {};
  // Macros, and messages (owner, 2026-10-04: "we really only want the pager
  // and the stage messages, but let the church decide"). A hidden message
  // stays in ProPresenter; it leaves Now and the phone.
  const field = { macro: "hiddenMacros", message: "hiddenMessages" }[kind];
  if (!field) return res.status(400).json({ error: 'kind must be "macro" or "message"' });
  if (!isControlId(id) || typeof hidden !== "boolean") return res.status(400).json({ error: "id and hidden are required" });
  const saved = await saveLiveModule(res, (m) => ({ ...m, [field]: setHidden(m[field], id, hidden) }));
  if (!saved) return;
  res.json({ ok: true, [field]: saved[field] });
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

/**
 * Posts a ProPresenter message with its fields filled, from Now or a phone.
 * Field values are upper-cased (owner, 2026-10-03: pager codes). Nothing is
 * remembered: a code is random each time (owner, 2026-10-08), and keeping a
 * list of them would only be a list of codes to tap by mistake.
 */
async function postMessage(id, values) {
  const filled = (Array.isArray(values) ? values : []).map((v) => ({ name: String(v?.name ?? ""), text: messageFieldValue(v?.text) }));
  await client.triggerMessage(id, filled);
}

app.post("/api/live/message", async (req, res) => {
  const { id, values } = req.body ?? {};
  if (!id) return res.status(400).json({ error: "id is required" });
  try {
    await postMessage(id, values);
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

// --- Changed songs (owner, 2026-10-07; server/known-good.js) --------------------
// Which songs' arrangements differ from the last order a person accepted, and
// when ProPresenter last saved each. Compares the search index with a small file
// of song titles and group orders; asks ProPresenter for nothing.
const KNOWN_GOOD_DIR = "./data";
const KNOWN_GOOD_FILE = "known-good.json";
let knownGood = null; // { songs: { [presentationId]: { name, arrangement, sequence } } }
let knownGoodWrite = Promise.resolve();

let knownGoodLoading = null;
/** Read once, however many callers arrive before it finishes, so none replaces another's changes. */
function loadKnownGood() {
  if (knownGood) return Promise.resolve(knownGood);
  knownGoodLoading ??= readFile(path.join(KNOWN_GOOD_DIR, KNOWN_GOOD_FILE), "utf-8")
    .then((text) => {
      const raw = JSON.parse(text);
      return { songs: raw && typeof raw.songs === "object" && raw.songs ? raw.songs : {} };
    })
    .catch(() => ({ songs: {} }))
    .then((loaded) => (knownGood = loaded));
  return knownGoodLoading;
}

/**
 * Saved one write at a time, atomically, so two changes cannot interleave a
 * half file. The returned promise rejects when the write fails, so a person
 * pressing Dismiss is told; the queue itself carries on after a failure.
 */
function saveKnownGood() {
  const snapshot = { savedAt: new Date().toISOString(), songs: { ...knownGood.songs } };
  const run = knownGoodWrite.then(() => writeAtomic(KNOWN_GOOD_DIR, KNOWN_GOOD_FILE, snapshot));
  knownGoodWrite = run.catch((err) => console.error(`Couldn't save the known good arrangements (${err.message}).`));
  return run;
}

/** Learns what is new, and says what changed. */
async function refreshKnownGood() {
  const kg = await loadKnownGood();
  const { learn, changes } = compareToKnownGood(kg.songs, getIndex().presentations);
  if (Object.keys(learn).length) {
    Object.assign(kg.songs, learn);
    // Learned in memory either way; a failed save is logged and tried again the
    // next minute, since nothing a person pressed depends on it.
    await saveKnownGood().catch(() => {});
  }
  return { changes };
}

/** When the first service of the day starts, or performance mode began; null when neither is known. */
function serviceStartMs(now = Date.now()) {
  const starts = serviceState(now).services.map((s) => s.startsAt).filter(Number.isFinite);
  if (starts.length) return Math.min(...starts);
  return performance.armed && Number.isFinite(performance.since) ? performance.since : null;
}

/** When the last service ended, once every one of today's has; null while any is still going or none is known. */
function serviceEndMs(now = Date.now()) {
  const services = serviceState(now).services;
  const ends = services.map((s) => s.endedAt);
  return services.length && ends.every(Number.isFinite) ? Math.max(...ends) : null;
}

// Learned in the background too, so a song edited before anyone opens the screen
// is learned as it was and not as it became. Cheap: it only reads the index.
setInterval(() => {
  if (serviceModuleOn()) refreshKnownGood().catch(() => {});
}, 60_000).unref();

app.get("/api/service/changed-songs", async (_req, res) => {
  if (!requireServiceModule(res)) return;
  await ensureServiceDay();
  const { changes } = await refreshKnownGood();
  const start = serviceStartMs();
  res.json({ ...splitByService(changes, start, serviceEndMs()), total: changes.length, serviceStart: Number.isFinite(start) ? new Date(start).toISOString() : null });
});

// Dismiss: keep the song as it is now and take it off the list. One song, or
// every change from before the service in one press.
app.post("/api/service/changed-songs/dismiss", async (req, res) => {
  if (!requireServiceModule(res)) return;
  const { presentationId, group } = req.body ?? {};
  if (typeof presentationId !== "string" && group !== "before") return res.status(400).json({ error: "Say which song, or group \"before\"." });
  await ensureServiceDay();
  const kg = await loadKnownGood();
  const { changes } = await refreshKnownGood();
  const start = serviceStartMs();
  const targets = group === "before" ? splitByService(changes, start).before : changes.filter((c) => c.presentationId === presentationId);
  const index = getIndex().presentations;
  const before = {};
  for (const c of targets) {
    const now = recordOf(index[c.presentationId]);
    if (!now) continue;
    before[c.presentationId] = kg.songs[c.presentationId];
    kg.songs[c.presentationId] = now;
  }
  if (targets.length) {
    try {
      await saveKnownGood();
    } catch (err) {
      // Not kept, so not dismissed: put the old order back and say so, or the
      // change would come back after a restart with nothing said.
      for (const [id, was] of Object.entries(before)) kg.songs[id] = was;
      return res.status(500).json({ error: `Couldn't save that, so nothing was dismissed (${err.message}).` });
    }
  }
  res.json({ ok: true, dismissed: targets.length });
});

// --- Staff requests ------------------------------------------------------------
// What is waiting for an approval, and the two answers. Behind the Staff
// requests switch (the gate in features.js answers 404 "switched off").
app.get("/api/live/requests", (_req, res) => {
  noteClientActivity();
  res.json({ requests: staffRequests.list(), ...staffRequests.state(), now: Date.now() });
});

app.post("/api/live/requests/:id/approve", async (req, res) => {
  const r = await staffRequests.approve(String(req.params.id));
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true });
});

app.post("/api/live/requests/:id/decline", async (req, res) => {
  const r = await staffRequests.decline(String(req.params.id));
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true });
});

// --- Stage message (handoff section 44) --------------------------------------
// A note for the people on stage, in the Stage Message box of the stage
// layouts; the audience never sees it. It stays up until someone takes it
// down, from Now or a phone. `stageNow` is what Refrain last saw or set, so a
// phone checking every few seconds doesn't ask ProPresenter each time.
let stageNow = "";
let stageReadAt = 0;
let stageConnected = true;

/**
 * What the stage says, re-read from ProPresenter when the last read is older
 * than `maxAgeMs`, so a message put up or taken down in ProPresenter itself
 * shows on Now and on phones within that time. However many screens ask, it
 * is at most one read per `maxAgeMs`; a failed read keeps the last answer.
 */
async function readStage(maxAgeMs = 10_000) {
  if (Date.now() - stageReadAt >= maxAgeMs) {
    stageReadAt = Date.now();
    try {
      stageNow = await client.getStageMessage();
      stageConnected = true;
    } catch {
      stageConnected = false;
    }
  }
  return stageNow;
}

async function showStage(text) {
  const clean = cleanStageText(text);
  if (!clean) throw refuse(400, "Type the message first.");
  await client.showStageMessage(clean);
  stageNow = clean;
  stageReadAt = Date.now();
  return clean;
}

async function clearStage() {
  await client.clearStageMessage();
  stageNow = "";
  stageReadAt = Date.now();
}

const stagePresets = () => stageMessages(config.liveModule?.stageMessages);

/** The presets, and what the stage says now (read from ProPresenter when it answers). */
app.get("/api/live/stage-message", async (req, res) => {
  // `?fresh=1` when Now opens; its 10s check takes the shared answer.
  const current = await readStage(req.query.fresh ? 0 : 10_000);
  res.json({ presets: stagePresets(), current, connected: stageConnected });
});

/** Shows a preset (`{ presetId }`) or typed text (`{ text }`). One press, by design: only the stage sees it. */
app.post("/api/live/stage-message", async (req, res) => {
  const { presetId, text } = req.body ?? {};
  const preset = presetId ? stagePresets().find((m) => m.id === presetId) : null;
  if (presetId && !preset) return res.status(404).json({ error: "That message isn't there any more." });
  try {
    res.json({ ok: true, current: await showStage(preset ? preset.text : text) });
  } catch (err) {
    res.status(err.status ?? 502).json({ error: err.message });
  }
});

app.post("/api/live/stage-message/clear", async (_req, res) => {
  try {
    await clearStage();
    res.json({ ok: true, current: "" });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/** Adds a preset. Saved to config.json; nothing in ProPresenter changes. */
app.post("/api/live/stage-messages", async (req, res) => {
  if (typeof req.body?.text !== "string") return res.status(400).json({ error: "Type the message first." });
  let added = null;
  const saved = await saveLiveModule(res, (m) => {
    const r = addStageMessage(m.stageMessages, req.body?.text);
    if (r.error) throw refuse(400, r.error);
    added = r.added;
    return { ...m, stageMessages: r.list };
  });
  if (!saved) return;
  res.json({ ok: true, added, presets: stageMessages(saved.stageMessages) });
});

/** Edits, moves or removes one preset. */
app.post("/api/live/stage-messages/:id", async (req, res) => {
  const { action, text, dir } = req.body ?? {};
  if (!["remove", "edit", "move"].includes(action)) return res.status(400).json({ error: 'action must be "remove", "edit" or "move"' });
  if (action === "edit" && typeof text !== "string") return res.status(400).json({ error: "text must be the new wording" });
  if (action === "move" && ![-1, 1].includes(Number(dir))) return res.status(400).json({ error: "dir must be -1 or 1" });
  const saved = await saveLiveModule(res, (m) => {
    const current = stageMessages(m.stageMessages);
    if (!current.some((x) => x.id === req.params.id)) throw refuse(404, "That message isn't there any more.");
    const list =
      action === "remove" ? removeStageMessage(current, req.params.id) : action === "edit" ? editStageMessage(current, req.params.id, text) : moveStageMessage(current, req.params.id, Number(dir));
    return { ...m, stageMessages: list };
  });
  if (!saved) return;
  res.json({ ok: true, presets: stageMessages(saved.stageMessages) });
});

// --- Library Sync (optional): one library, one direction, through a shared folder ---
//
// Everything here is inert unless the module is switched on, so a single
// machine setup is unaffected. The heavy lifting and all of the safety rules
// live in library-sync.js; these routes only resolve paths and report.

/**
 * Share Library is removed (owner, 2026-09-29: "it's a dangerous feature").
 * It copied files into a ProPresenter library, the one thing Refrain does that
 * writes to ProPresenter's data, and it could run on its own while ProPresenter
 * was closed. Its screen and its Settings card are gone; this gate keeps it
 * from running, by hand or automatically, whatever config.json says. The code
 * below stays, unreachable, so the decision is easy to revisit or finish by
 * deleting it.
 */
const SHARE_LIBRARY_REMOVED = true;
const SHARE_LIBRARY_REMOVED_MESSAGE = "Share Library has been removed from Refrain. Nothing was copied.";
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
    sharedFolder: cleanFolderSetting(mod.sharedFolder),
    minimumFiles: Number.isInteger(mod.minimumFiles) ? mod.minimumFiles : DEFAULT_MINIMUM_FILES,
    snapshotsToKeep: Number.isInteger(mod.snapshotsToKeep) ? mod.snapshotsToKeep : DEFAULT_SNAPSHOTS_TO_KEEP,
    // Off by default even once the rest of this is configured -- turning it on
    // is a separate, explicit decision to let Refrain touch the filesystem
    // with nobody watching, not something a library name and a folder path
    // should imply.
    autoWhenClosed: Boolean(mod.autoWhenClosed),
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
  if (SHARE_LIBRARY_REMOVED) return res.status(410).json({ error: SHARE_LIBRARY_REMOVED_MESSAGE });
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

/**
 * Runs (or refuses to run) a Library Sync, for both the button and the
 * automatic trigger below -- one implementation of the safety-critical part,
 * so the two callers cannot drift into disagreeing about what "safe" means.
 *
 * Returns rather than responds, so it has no Express dependency and the
 * automatic trigger can call it directly; `trigger` only affects what gets
 * written into the last-run record, never the safety decision itself.
 */
async function runLibrarySync({ trigger = "manual" } = {}) {
  if (SHARE_LIBRARY_REMOVED) return { statusCode: 410, body: { error: SHARE_LIBRARY_REMOVED_MESSAGE } };
  if (getLibrarySyncModuleStatus(config) !== "active") {
    return { statusCode: 400, body: { error: "Library Sync is not switched on and configured yet." } };
  }
  if (librarySyncInFlight) {
    return { statusCode: 409, body: { error: "A sync is already running. Wait for it to finish." } };
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
    return {
      statusCode: 409,
      body: {
        error: `${safety.reason} Library Sync copies presentation files in and out of the library ` +
          `folder, and doing that while ProPresenter has the workspace open can corrupt it.`,
        blockedBy: "propresenter-running",
        evidence: safety.evidence,
      },
    };
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
      return {
        statusCode: 409,
        body: {
          error:
            `Refrain does not know where the "${settings.libraryName}" library lives on disk yet. ` +
            `Open the Library Sync screen once with ProPresenter running so it can learn the path, ` +
            `then quit ProPresenter and sync.`,
        },
      };
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
      return {
        statusCode: 409,
        body: {
          error: `${stillSafeAfterSnapshot.reason} Nothing was copied. The snapshot was taken, so you can retry safely.`,
          blockedBy: "propresenter-running",
          evidence: stillSafeAfterSnapshot.evidence,
        },
      };
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
      trigger,
      ...result,
    };
    await writeLastRun(LIBRARY_SYNC_STATE, record);
    return { statusCode: result.ok ? 200 : 409, body: record };
  } catch (err) {
    return { statusCode: 502, body: { error: err.message } };
  } finally {
    librarySyncInFlight = false;
  }
}

app.post("/api/library-sync/run", async (_req, res) => {
  const { statusCode, body } = await runLibrarySync({ trigger: "manual" });
  res.status(statusCode).json(body);
});

/**
 * Runs Library Sync on its own once ProPresenter is confirmed closed --
 * "the operator packed up and went home" is exactly the moment this is both
 * safe and useful, and the one moment nobody is at the Health screen to press
 * the button.
 *
 * Polls locally (`ps`, `launchctl list`) rather than piggybacking on the
 * heartbeat's network reachability, and deliberately does not gate on
 * performance mode -- see shouldAutoRunLibrarySync's comment for why that
 * would have meant this almost never fires. A minute's delay in noticing
 * costs nothing here; nobody is waiting on it.
 */
let librarySyncAutoArmed = true;
const LIBRARY_SYNC_AUTO_POLL_MS = 60_000;

async function pollAutoLibrarySync() {
  const settings = librarySyncSettings();
  // Cheap exit before spawning ps/launchctl on every install that has not
  // turned this on -- most of them, including every core-search-only user.
  if (getLibrarySyncModuleStatus(config) !== "active" || !settings.autoWhenClosed) return;
  if (librarySyncInFlight) return;

  const safety = await checkLibrarySafeToTouch({
    apiProbe: async () => {
      try {
        await client.testConnection();
        return true;
      } catch {
        return false;
      }
    },
  });

  const decision = shouldAutoRunLibrarySync({ safety, armed: librarySyncAutoArmed });
  librarySyncAutoArmed = decision.armed;
  if (!decision.run) return;

  console.log("ProPresenter is closed — running the scheduled Share Library sync...");
  const { body } = await runLibrarySync({ trigger: "auto" }).catch((err) => ({ body: { error: err.message } }));
  if (body?.ok) {
    console.log(
      `Share Library sync complete — added ${body.copied?.length ?? 0}, updated ${body.replaced?.length ?? 0}, ` +
        `${body.unchanged ?? 0} already matched.`
    );
  } else {
    console.log(`Share Library sync did not run: ${body?.error ?? "unknown error"}`);
  }
}

function startAutoLibrarySyncPolling() {
  if (SHARE_LIBRARY_REMOVED) return; // never runs on its own, whatever config.json says
  setInterval(() => {
    pollAutoLibrarySync().catch((err) => console.log(`Share Library auto-check failed: ${err.message}`));
  }, LIBRARY_SYNC_AUTO_POLL_MS).unref?.();
}


app.post("/api/library-sync/config", async (req, res) => {
  if (SHARE_LIBRARY_REMOVED) return res.status(410).json({ error: SHARE_LIBRARY_REMOVED_MESSAGE });
  const body = req.body ?? {};
  const current = config.librarySyncModule ?? {};
  const next = { ...current };

  if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
  if (body.autoWhenClosed !== undefined) next.autoWhenClosed = Boolean(body.autoWhenClosed);
  if (body.libraryName !== undefined) next.libraryName = String(body.libraryName).trim() || null;
  if (body.direction !== undefined) {
    if (body.direction !== "send" && body.direction !== "receive") {
      return res.status(400).json({ error: 'direction must be "send" or "receive"' });
    }
    next.direction = body.direction;
  }
  if (body.sharedFolder !== undefined) next.sharedFolder = cleanFolderSetting(body.sharedFolder);
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

  try {
    await updateConfig((c) => ({ ...c, librarySyncModule: next }));
  } catch (err) {
    return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
  }
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
    res.json({ playlists: flattenPlaylists(tree), allowlist: config.spellcheckModule?.allowlist ?? [], protected: protectOn() ? PROTECT_REFUSAL : null });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * Reads a playlist's presentations and finds likely typos, dates that have
 * passed, and media that isn't on this Mac. Shared by Spell Check's scan and
 * the Service screen's pre-service checks, so both say the same thing.
 * `docs` carries each presentation document read, for checks that need more.
 */
/**
 * `only`, when given, is the presentations to check instead of a playlist's:
 * one song from a Flags or Service row (handoff section 40.5).
 */
async function scanPlaylist(playlistId, { only = null } = {}) {
  const [{ items }, speller] = await Promise.all([only ? { items: only } : client.getPlaylistItems(playlistId), loadSpeller()]);
  const knownWords = libraryKnownWords();
  const allowlist = new Set((config.spellcheckModule?.allowlist ?? []).map((w) => w.toLowerCase()));

  // Missing media (issue #9) rides on the same scan: same playlist, same
  // slides, same jump to the slide. Read from the .pro file on disk because
  // the API reports no media; see server/pro-media.js. Only slides the
  // arrangement actually plays are checked, since only they are looked up.
  const mediaEnv = {
    exists: existsSync,
    home: homedir(),
    mediaRoots: [path.join(homedir(), "Documents", "ProPresenter"), ...workspaceRootsFromLibraryDirs(getIndexedLibraryDirs())],
  };
  let mediaUnreadable = 0;
  const docs = new Map();

  const presentations = [];
  const scanned = items.slice(0, SPELLCHECK_MAX_PRESENTATIONS);
  for (const item of scanned) {
    let slides;
    let liveSlides = [];
    let missingMedia = new Map();
    try {
      const doc = await client.getPresentation(item.id);
      docs.set(item.id, doc);
      slides = extractSlides(doc, preferredArrangements());
      // The arrangement ProPresenter has selected, which is what its slide
      // pictures are numbered by (and Go Live fires against). It can differ
      // from the preferred one the findings are read in.
      liveSlides = flattenGroups(resolveArrangement(doc, []).groups);
      const proPath = doc?.presentation?.presentation_path;
      if (proPath) {
        try {
          const bytes = await readFile(proPath);
          // The decode is synchronous; give waiting requests (a heartbeat,
          // a Go Live) their turn before each file, not after all of them.
          await new Promise((r) => setImmediate(r));
          missingMedia = missingMediaBySlide(bytes, mediaEnv);
        } catch {
          // Counted, not hidden: "no missing media" and "could not look"
          // must never read the same.
          mediaUnreadable++;
        }
      }
    } catch {
      continue; // a single unreadable presentation shouldn't sink the whole scan
    }
    const flaggedSlides = [];
    for (const slide of slides) {
      const words = findTypos(slide.text, { knownWords, allowlist, speller });
      // Dates that are already over -- the announcement for last month's
      // event still in this weekend's loop. See server/stale-dates.js.
      const pastDates = findPastDates(slide.text);
      const media = slide.groupId != null ? (missingMedia.get(`${slide.groupId}:${slide.groupOffset}`) ?? []) : [];
      // Carry the slide's anchor so Go Live from here survives an
      // arrangement switch between this scan and the click.
      if (words.length || pastDates.length || media.length) {
        flaggedSlides.push({
          slideIndex: slide.index,
          // Where this slide is in ProPresenter's selected arrangement, for its
          // picture; null when it isn't played there.
          pictureIndex: findLiveIndex(liveSlides, { groupId: slide.groupId ?? null, groupOffset: slide.groupOffset ?? null, index: slide.index, text: slide.text }),
          groupId: slide.groupId ?? null,
          groupOffset: slide.groupOffset ?? null,
          text: slide.text,
          words,
          pastDates,
          missingMedia: media,
        });
      }
    }
    if (flaggedSlides.length) {
      presentations.push({ presentationId: item.id, presentationName: item.name, slides: flaggedSlides });
    }
  }
  return { items, presentations, docs, scannedCount: scanned.length, truncated: items.length > scanned.length, mediaUnreadable };
}

/**
 * Slides a Spell Check scan flagged, by `presentationId:slideIndex`: the
 * picture route may draw these. The newest scans' slides are kept, at most
 * SPELLCHECK_PICTURES_MAX, so the set can't grow without end.
 */
const SPELLCHECK_PICTURES_MAX = 600;
const spellcheckPictures = new Set();
function allowSpellcheckPictures(presentations) {
  for (const p of presentations) for (const s of p.slides) {
    if (!Number.isInteger(s.pictureIndex)) continue;
    const key = `${p.presentationId}:${s.pictureIndex}`;
    spellcheckPictures.delete(key);
    spellcheckPictures.add(key);
  }
  while (spellcheckPictures.size > SPELLCHECK_PICTURES_MAX) spellcheckPictures.delete(spellcheckPictures.values().next().value);
}

app.post("/api/spellcheck/scan", async (req, res) => {
  // Reads and decodes up to 120 presentation files on the thread that also
  // runs the heartbeat, Go Live and phone confirms: not during a service.
  if (protectOn()) return res.status(409).json({ error: PROTECT_REFUSAL });
  if (performance.armed) return res.status(409).json({ error: "Performance mode is on, so Refrain is holding still. Run this when nothing is live." });
  const { playlistId, presentationId } = req.body ?? {};
  const one = typeof presentationId === "string" && /^[A-Za-z0-9-]{1,64}$/.test(presentationId) ? presentationId : null;
  if (!playlistId && !one) return res.status(400).json({ error: "playlistId or presentationId is required" });
  try {
    const only = one ? [{ id: one, name: getIndex().presentations?.[one]?.name ?? null }] : null;
    const { presentations, scannedCount, truncated, mediaUnreadable } = await scanPlaylist(playlistId, { only });
    if (!picturesOn()) for (const p of presentations) for (const sl of p.slides) sl.pictureIndex = null;
    allowSpellcheckPictures(presentations);
    // Pictures from before a slide was removed are dropped from memory: when
    // the file's version can't be read (ProPresenter on another Mac), the
    // version in the key can't tell old from new.
    for (const p of presentations) {
      thumbCache.forget(p.presentationId);
      pictureFingerprints.delete(p.presentationId);
    }
    // Each presentation's version, for the picture addresses: a new version
    // (a slide removed, then Check again) is a new address, never an old picture.
    for (const p of presentations) p.pictureVersion = (await pictureFingerprint(p.presentationId)) ?? String(Date.now());
    res.json({ presentations, scannedCount, truncated, mediaUnreadable });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});


/**
 * Saves an allowlist, only swapping the in-memory config once the write has
 * actually landed. The previous version updated config first, so a failed write
 * left the running app disagreeing with the file on disk.
 */
async function saveAllowlist(change, res) {
  let allowlist;
  try {
    const saved = await updateConfig((c) => {
      allowlist = change(c.spellcheckModule?.allowlist ?? []);
      return { ...c, spellcheckModule: { ...c.spellcheckModule, allowlist } };
    });
    allowlist = saved.spellcheckModule.allowlist;
  } catch (err) {
    return res.status(500).json({ error: `Failed to save the ignored words: ${err.message}` });
  }
  return res.json({ ok: true, allowlist });
}

/**
 * Pictures ahead of time on or off, from Settings › Phones (owner,
 * 2026-10-04). Saved to config.json (atomic), and swapped into the running
 * config only once the write has landed. Takes effect at the next quiet
 * check; nothing is rendered by pressing it.
 */
app.post("/api/slide-pictures", async (req, res) => {
  const { prerender, show, quickSlides } = req.body ?? {};
  for (const [name, v] of Object.entries({ prerender, show, quickSlides })) {
    if (v !== undefined && typeof v !== "boolean") return res.status(400).json({ error: `${name} must be true or false` });
  }
  if (prerender === undefined && show === undefined && quickSlides === undefined) return res.status(400).json({ error: "Send show, prerender and/or quickSlides." });
  const change = Object.fromEntries(Object.entries({ prerender, show, quickSlides }).filter(([, v]) => v !== undefined));
  try {
    await updateConfig((c) => ({ ...c, slidePictures: { playlists: [], ...c.slidePictures, ...change } }));
  } catch (err) {
    return res.status(500).json({ error: `Couldn't save it: ${err.message}` });
  }
  if (quickSlides === true) collectQuickSlidePictures();
  res.json({ ok: true, prerender: config.slidePictures.prerender === true, show: picturesOn(), quickSlides: quickSlidePicturesOn() });
});

/**
 * Settings > Telemetry. Saves the station's name, address, slide-text choice and
 * send windows to config.json (atomic, swapped in once written). The key is a
 * secret and stays in .env. Takes effect on the next tick; a station gets its
 * id the first time it is turned on.
 */
app.post("/api/service-feed", async (req, res) => {
  const cleaned = cleanServiceFeedSettings(req.body);
  if (!cleaned.ok) return res.status(400).json({ error: cleaned.error });
  try {
    await updateConfig((c) => applyServiceFeedSettings(c, cleaned.value, randomUUID));
  } catch (err) {
    return res.status(500).json({ error: `Couldn't save it: ${err.message}` });
  }
  res.json({ ok: true, ...getServiceFeedModuleStatus(config), ...serviceFeed.state() });
});

app.get("/api/spellcheck/allowlist", (_req, res) => {
  res.json({ allowlist: config.spellcheckModule?.allowlist ?? [] });
});

app.post("/api/spellcheck/allow", async (req, res) => {
  const { word, words } = req.body ?? {};
  // Accepts one word (the inline Ignore button) or a typed list, so a whole
  // set of known-good church vocabulary can be pasted in at once.
  const incoming = parseWordList(words ?? word);
  if (!incoming.length) return res.status(400).json({ error: "Type at least one word to ignore." });
  return saveAllowlist((list) => addToAllowlist(list, incoming), res);
});

app.post("/api/spellcheck/unallow", async (req, res) => {
  const { word, words } = req.body ?? {};
  const outgoing = parseWordList(words ?? word);
  if (!outgoing.length) return res.status(400).json({ error: "Say which word to stop ignoring." });
  return saveAllowlist((list) => removeFromAllowlist(list, outgoing), res);
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
  if (typeof text !== "string" || !text.trim()) return res.status(400).json({ error: "text is required" });

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

    try {
      await updateConfig((c) => ({ ...c, arrangementModule: { ...c.arrangementModule, folders } }));
    } catch (err) {
      return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
    }
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
      // Which part of the plan it sits under (a service time, usually), so a
      // set repeated per service can be told apart. Null when the provider
      // has no such concept.
      section: song.section ?? null,
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
/**
 * Compares a weekend plan's songs against what actually played. The body of
 * "Compare all songs", shared with End (which passes `onlyPresentationIds`
 * so it compares only the songs that were actually shown).
 * @returns {Promise<{ plan, serviceDate, results, unmatched } | { notFound: true }>}
 */
async function compareWeekendSongs({ planId = null, onlyPresentationIds = null } = {}) {
  const storage = await getStorageBackend();
  const provider = await getArrangementProvider(storage);
  const plans = await provider.getRecentPlans(5);
  const plan = planId ? plans.find((p) => p.id === planId) : plans[0];
  if (!plan) return { notFound: true };
  const serviceDate = plan.sortDate.slice(0, 10);
  let matched = matchPlanSongsToPresentations(await provider.getPlanSongs(plan.id));
  if (onlyPresentationIds) matched = matched.filter((song) => song.presentationId && onlyPresentationIds.has(song.presentationId));

  config = await ensureMachineId(config);
  const results = [];
  const unmatched = [];
  const done = new Set();
  for (const song of matched) {
    if (!song.presentationId) {
      unmatched.push({ title: song.title });
      continue;
    }
    // A song planned in three services is one comparison, not three.
    if (done.has(song.presentationId)) continue;
    done.add(song.presentationId);
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
  return { plan, serviceDate, results, unmatched };
}

app.post("/api/arrangement/compare-all", async (req, res) => {
  if (!requireArrangementActive(res)) return;
  if (config.role !== "logger") {
    return res.status(403).json({ error: "Only the logger machine can run comparisons — see Settings for role." });
  }
  if (!(await requireProviderCapability(res, "supportsPlanBrowsing", "The weekend compare-all workflow"))) return;

  try {
    const out = await compareWeekendSongs({ planId: req.body?.planId ?? null });
    if (out.notFound) {
      return res.status(404).json({
        error: "No past plan found — check the Service Type ID in Configuration, and that it has at least one plan with a past date.",
      });
    }
    res.json(out);
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
    return res.status(403).json({ error: "Only the logger machine can push arrangements — see Settings for role." });
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
    return res.status(403).json({ error: "Only the logger machine can run comparisons — see Settings for role." });
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
    // On and off is the Image Crop feature (Settings › Features), not this form.
    const { inputFolder, outputFolder, presets } = req.body ?? {};
    const newConfig = { ...config, imageCropModule: { ...config.imageCropModule } };
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
    // The route is only reachable while Image Crop is on (the feature gate).
    newConfig.imageCropModule = readyFeature(newConfig, "image-crop").imageCropModule;
    if (foldersOverlap(newConfig.imageCropModule.inputFolder, newConfig.imageCropModule.outputFolder)) {
      return res.status(400).json({
        error: "Input and output folders can't be the same folder or nested inside one another — cropped outputs would be re-cropped in an endless loop.",
      });
    }

    // Start the watcher against the *candidate* config before persisting,
    // so a bad path (permission denied, etc.) surfaces as a 400 the user
    // sees instead of leaving a broken enabled=true saved to disk.
    await startImageCropWatcher(imageCropWatch(newConfig));
    // In turn with every other change; only imageCropModule is taken from
    // the form, so a change made meanwhile elsewhere isn't undone.
    await updateConfig((c) => ({ ...c, imageCropModule: newConfig.imageCropModule }));
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
      // Which helpers launchd is keeping alive deliberately. Without this the
      // Workspaces helper looked orphaned every time ProPresenter was closed,
      // and the screen told the operator to kill a service launchd restarts
      // within seconds.
      let managedPids = new Set();
      try {
        const { stdout: lc } = await execFileAsync("launchctl", ["list"], { timeout: 5000 });
        managedPids = parseLaunchdManaged(lc);
      } catch {
        // Nothing learned; every helper stays a candidate, which over-reports
        // rather than under-reports.
      }
      processes = { available: true, ...findOrphanedHelpers(stdout, { managedPids }) };
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

  try {
    await updateConfig((c) => ({ ...c, propresenter: { host, port: Number(port) }, role }));
  } catch (err) {
    return res.status(500).json({ error: `Failed to save config.json: ${err.message}` });
  }

  client = new ProPresenterClient(config.propresenter);

  res.json({ ok: true });

  // First-run always needs a full build (Section 5.3) — kick it off after
  // responding so the setup screen can poll /api/index/status for progress
  // rather than holding the request open.
  //
  // Unless something is already on the screens. This path had no performance
  // check at all, where the boot path has always had one, and the gap is worst
  // on exactly the machine this route exists for: a fresh install set up during
  // load-in would start crawling the whole library with nobody choosing it.
  if (frozen()) {
    indexWorkDeferred = "performance mode is on";
    console.log(`Setup finished, but something is live — not building the index yet. ${describePerformance(performance)}`);
  } else {
    // Same settle gate as boot. On a fresh machine this is *the* first build,
    // and it usually runs minutes after someone launched ProPresenter.
    awaitProPresenterSettled({
      onWait: (state) => {
        indexWorkDeferred =
          state === "absent"
            ? "waiting for ProPresenter — it is not answering yet"
            : "waiting for ProPresenter to finish starting up";
        console.log(`Setup finished — ${state === "absent" ? "ProPresenter is not answering; waiting" : "waiting for ProPresenter to settle"} before the first build.`);
      },
    })
      .then((settled) => {
        if (!settled) {
          indexWorkDeferred = "ProPresenter never became available — build the index from Settings";
          console.log("Gave up waiting for ProPresenter. Build the index from Settings once it is up.");
          return null;
        }
        indexWorkDeferred = null;
        return startRebuild();
      })
      .then(startWatching)
      .catch((err) => {
        if (err.protected) return console.log("Setup finished. Protect ProPresenter is on, so no index is read from ProPresenter.");
        console.error("Setup index build failed:", err.message);
      });
  }
});

// --- Health / status screen (Section 7) ---

/**
 * Start at login — read, then set.
 *
 * A button rather than a double-clicked script, because the script asked the
 * operator to find a file in a folder and trust it, which is the step that
 * does not happen. The work is identical; this one is where they already are.
 */
app.get("/api/autostart", async (_req, res) => {
  try {
    res.json(await autostart.status());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/autostart", async (req, res) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be true or false" });
  }
  if (!autostart.isSupported()) {
    return res.status(400).json({ error: "Starting at login is a macOS feature." });
  }
  try {
    const result = enabled
      ? await autostart.install({ appDir: process.cwd(), port })
      : await autostart.uninstall();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

  // ProPresenter's own process, from the service log's last sample: its load
  // is the thing to watch on a long service day, and only this machine sees it.
  propresenter.process = propresenterSamples.at(-1) ?? null;
  propresenter.load = propresenterLoad;
  propresenter.slidePictures = { ...slidePicturesStatus, show: picturesOn(), quickSlides: quickSlidePicturesOn(), prerender: config.slidePictures?.prerender === true, onThisMac: client.isLocalHost };
  res.json({
    version,
    role: config.role ?? null,
    preferredArrangements: preferredArrangements(),
    propresenter,
    // For the health check on Settings > Status.
    performanceMode: { armed: performance.armed },
    feed: serviceFeedLamp(),
    index: indexStatusPayload(),
    // Where Refrain actually lives and which port it answers on, so the
    // Health screen can hand over a command that works on this machine rather
    // than one with a placeholder path in it.
    installDir: process.cwd(),
    port,
    // Whether Refrain starts itself at login. Read on every Health load rather
    // than cached: the operator can also install or remove it with the
    // double-click scripts, and a stale toggle would lie about which.
    autostart: await autostart.status().catch(() => ({ supported: false })),
    shareLibrary: SHARE_LIBRARY_REMOVED ? null : {
      status: getLibrarySyncModuleStatus(config),
      ...librarySyncSettings(),
      // Just the age/outcome, not the full record -- the Library Sync screen
      // has the rest. A cheap file read, and only ever attempted once the
      // module is actually configured, so an install that has never touched
      // this feature never pays for it.
      lastRun:
        getLibrarySyncModuleStatus(config) === "active"
          ? await readLastRun(LIBRARY_SYNC_STATE).then((r) => (r ? { at: r.at, ok: r.ok, reason: r.reason ?? null } : null))
          : null,
    },
    arrangementModule: {
      status: getArrangementModuleStatus(config),
      enabled: featureOn(config, "arrangement"),
      storageBackend: config.arrangementModule?.storageBackend ?? null,
      storageBackendDisplayName: await getStorageBackendDisplayName(),
      localFolderPath: config.arrangementModule?.localFolderPath ?? null,
      provider: config.arrangementModule?.provider ?? null,
      providerDisplayName: await getArrangementProviderDisplayName(),
      planningCenterServiceTypeId: config.arrangementModule?.planningCenterServiceTypeId ?? null,
      pendingUploads: await getPendingUploadCount(),
    },
    config: {
      // NOTE: `librarySync` here is the SEARCH SCOPE — which Library folders
      // get indexed. The feature that copies files between machines is
      // `librarySyncModule` below, surfaced as "Share Library". Two keys a
      // character apart meaning unrelated things; the names are historical and
      // the UI no longer repeats the confusion.
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
    networkModule: { ...getNetworkModuleStatus(config, port), urls: getNetworkModuleStatus(config, port).status === "active" ? networkUrls() : [], pinMode: remotePinMode() },
    reportModule: getReportModuleStatus(config),
    protectProPresenter: protectOn(),
    features: featureStates(),
    serviceFeedModule: {
      ...getServiceFeedModuleStatus(config),
      ...serviceFeed.state(),
      settings: {
        enabled: Boolean(config.serviceFeedModule?.enabled),
        name: config.serviceFeedModule?.name ?? "",
        url: config.serviceFeedModule?.url ?? "",
        includeSlideText: config.serviceFeedModule?.includeSlideText === true,
        includeSlideImage: config.serviceFeedModule?.includeSlideImage === true,
        windows: effectiveWindows(config.serviceFeedModule),
        keySet: Boolean(process.env.SERVICE_FEED_TOKEN),
      },
    },
    // Settings › Features › Day summary: auto-end and where the summary goes.
    daySummary: {
      autoEnd: autoEndSettings(config.serviceModule?.autoEnd),
      sendByEmail: Boolean(config.reportModule?.enabled),
      // Whether this screen edits sending at all (a backend that takes
      // addresses), and its name, from the backend rather than written here.
      backend: deliveryBackendFor(config) ? { name: deliveryBackendFor(config).displayName, takesRecipients: Boolean(deliveryBackendFor(config).takesRecipients) } : null,
      recipients: Array.isArray(config.reportModule?.recipients) ? config.reportModule.recipients : [],
      serviceModuleOn: serviceModuleOn(),
      closedWatch: client.isLocalHost && platform() !== "win32",
    },
  });
});

/**
 * 9999, not 3000.
 *
 * 3000 is the busiest port on a developer's machine -- this very repo found a
 * Next.js server already holding it, which made `http://localhost:3000` reach
 * the wrong app while Refrain sat on 127.0.0.1. A booth Mac is less crowded,
 * but the number also has to be remembered by a volunteer under time pressure,
 * and four of the same digit is the one they will not have to think about.
 */
const port = process.env.PORT || 9999;
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

// Last: an error from any route (thrown, rejected, or a body that wasn't
// JSON) gets one plain answer, never a hang or a stack trace.
app.use(routeErrorHandler);

const server = app.listen(port, "127.0.0.1", async () => {
  /**
   * The launcher window is the only interface some operators ever see, and it
   * used to open with a URL and then go quiet. Everything Refrain decides at
   * boot -- whether ProPresenter is there, whether it is going to index, why it
   * is not -- was decided silently. When something then took minutes, there was
   * no way to tell waiting from broken.
   *
   * So: say what this is, say whether ProPresenter is reachable, and if it is
   * not, say the one thing that is nearly always wrong.
   */
  // Codes remembered by an earlier version are deleted: they were kept per
  // machine and are never shown again.
  if (config.liveModule?.messageRecent) {
    updateLiveModule(({ messageRecent: _dropped, ...rest }) => rest).catch((err) => console.error("Couldn't clear old message codes:", err.message));
  }
  console.log("");
  console.log(`  Refrain is running.  Open  http://localhost:${port}`);
  console.log("  Leave this window open while you use it. Closing it stops Refrain.");
  console.log("");

  if (!configFileExists()) {
    console.log("  First run: finish setup in the browser and Refrain will index after that.");
    console.log("");
    return;
  }

  // Say this before anything slow happens, so a long first build is not the
  // first time the operator learns ProPresenter cannot be reached.
  try {
    await client.testConnection();
    console.log(`  ProPresenter: connected at ${config.propresenter.host}:${config.propresenter.port}`);
  } catch {
    console.log(`  ProPresenter: NOT reachable at ${config.propresenter.host}:${config.propresenter.port}`);
    console.log("    Open ProPresenter, then check Preferences > Network is switched on.");
    console.log("    Refrain will keep trying, and search still works from the index it has.");
  }
  console.log("");

  /**
   * Say so, once, if there is a newer Refrain.
   *
   * Deliberately not awaited: this is the launcher window a volunteer watches
   * while waiting for the app, and holding boot for up to five seconds on a
   * network call to tell them about an update they will install on Tuesday is
   * the wrong trade. It prints a line or two later, or it never prints.
   */
  checkForUpdate()
    .then((u) => {
      if (!u.updateAvailable) return;
      console.log(`  An update is available: v${u.latestVersion} (this is v${u.currentVersion}).`);
      console.log("  Nothing is required — update from Settings when it suits you.");
      console.log("");
    })
    .catch(() => {});

  // Establish whether anything is on the screens before deciding to do work.
  await pollPerformance();
  startPerformancePolling();
  startAutoLibrarySyncPolling();

  const existing = await loadIndexFromDisk();
  if (!existing) {
    if (frozen()) {
      indexWorkDeferred = "performance mode is on";
      console.log(`No search index cache found, but performance mode is on — not building. ${describePerformance(performance)}`);
      console.log("Search will be empty until you build it from Settings.");
    } else {
      const settled = await awaitProPresenterSettled({
        onWait: (state, readyFor) => {
          indexWorkDeferred =
            state === "absent"
              ? "waiting for ProPresenter — it is not answering yet"
              : "waiting for ProPresenter to finish starting up";
          console.log(
            state === "absent"
              ? "No index yet, and ProPresenter is not answering. Waiting. Open it, and check its Network API is on (Preferences > Network)."
              : `No index yet — waiting for ProPresenter to settle before the first build (up ${Math.round(readyFor / 1000)}s of ${WATCH_SETTLE_MS / 1000}s). Crawling a just-launched ProPresenter loses about half the library, silently.`
          );
        },
      });
      if (!settled) {
        indexWorkDeferred = "ProPresenter never became available — build the index from Settings";
        console.log("Gave up waiting for ProPresenter. Search will stay empty until you build the index from Settings.");
        return;
      }
      indexWorkDeferred = null;
      console.log("No search index cache found — building initial index...");
      try {
        await startRebuild();
        console.log("Initial index build complete.");
      } catch (err) {
        if (err.protected) {
          console.log("No search index yet, and Protect ProPresenter is on, so none is read from ProPresenter. Search is empty until protection is turned off and the index built (Settings › Search › Advanced).");
        } else {
          console.error("Initial index build failed:", err.message);
          console.error("Check ProPresenter is running with its Network API enabled (Preferences > Network).");
        }
      }
    }
  } else if (shouldAutoRebuild(existing)) {
    // Not straight away: a restart is often on a service morning, with
    // ProPresenter just launched (issue #11). The quiet catch-up picks it up.
    indexWorkDeferred = "the index is behind; it catches up after an hour with nothing on the screens, or press Refresh";
    console.log(
      `Loaded cached index (built ${existing.builtAt ?? "never completely"}${existing.partial ? `, ${existing.partial.read} of ${existing.partial.of} read before it stopped` : ""}). ` +
        "It's behind; it still works, and it catches up after an hour with nothing on the screens, or when you press Refresh on Search."
    );
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
  await retryArrangementUploads();
  if (config.role === "logger" && getArrangementModuleStatus(config) === "off") {
    // Staged writes stay on disk while it's off; switching it on sends them.
    const waiting = await getPendingUploadCount().catch(() => 0);
    if (waiting > 0) console.log(`${waiting} arrangement upload(s) are waiting. Switch Arrangement tracking on in Settings › Features to send them.`);
  }

  await startServiceDays();

  // The service feed names this console by a stable id it makes once. Written
  // atomically like every config change; a failure just means no feed yet.
  if (config.serviceFeedModule?.enabled && !config.serviceFeedModule.consoleId) {
    try {
      await updateConfig((c) => ({ ...c, serviceFeedModule: { ...c.serviceFeedModule, consoleId: c.serviceFeedModule?.consoleId ?? randomUUID() } }));
    } catch (err) {
      console.error("Service feed: could not save this console's id:", err.message);
    }
  }

  startRemoteListener();

  // Flags captured while the shared folder was unreachable, copied now.
  retryPendingFlags({ folder: slideFlagsFolder() })
    .then(({ attempted, succeeded }) => {
      if (attempted > 0) console.log(`Copied ${succeeded} of ${attempted} waiting slide flag(s) to the flags folder.`);
    })
    .catch(() => {});

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
      await startImageCropWatcher(imageCropWatch(config));
      console.log(`Watching ${config.imageCropModule.inputFolder} for images to crop.`);
    } catch (err) {
      console.error("Failed to start image-crop watcher:", err.message);
    }
  }
});

/**
 * Two copies of Refrain, one port.
 *
 * This became reachable the moment starting at login became a button: the
 * operator enables it while Refrain is already running in a Terminal window,
 * and a second copy launches immediately. Unhandled, `listen` throws
 * EADDRINUSE, the process dies non-zero, and a KeepAlive LaunchAgent restarts
 * it forever -- a crash loop caused by turning on a convenience.
 *
 * So the second copy stands down, says why, and exits 0. The LaunchAgent's
 * KeepAlive is `SuccessfulExit: false`, so a deliberate exit is left alone
 * while a real crash still restarts. Nothing is lost either way: the copy that
 * holds the port is a complete Refrain.
 */
server.on("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.log("");
  console.log(`  Refrain is already running on port ${port}, so this copy is standing down.`);
  console.log(`  Open http://localhost:${port} — that one is the live copy.`);
  console.log("  (To hand over to this copy instead, quit the other one first.)");
  console.log("");
  process.exit(0);
});
