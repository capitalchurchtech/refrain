/**
 * Refrain server entrypoint.
 *
 * See docs/refrain-architecture.md Section 16 for build order —
 * Step 0 is verifying ProPresenter API capabilities against your
 * actual installed version before relying on anything below.
 */
import { readFileSync } from "node:fs";
import express from "express";
import {
  loadConfig,
  saveConfig,
  configFileExists,
  isConfigComplete,
  getArrangementModuleStatus,
} from "./config.js";
import { ProPresenterClient } from "./propresenter-client.js";
import {
  loadIndexFromDisk,
  rebuildIndex,
  shouldAutoRebuild,
  search,
  getIndex,
  getRebuildProgress,
} from "./search-index.js";
import { discoverModules, discoverSlideSplitters } from "./plugin-loader.js";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

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
      enabled: m.id === "arrangement" ? getArrangementModuleStatus(config) !== "off" : m.enabledByDefault,
    })),
  });
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

function indexStatusPayload() {
  const index = getIndex();
  return {
    builtAt: index.builtAt,
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

app.post("/api/index/rebuild", async (_req, res) => {
  try {
    const index = await rebuildIndex(client, config.librarySync);
    res.json({ builtAt: index.builtAt, presentationCount: Object.keys(index.presentations).length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/search", (req, res) => {
  const { q, playlistId, dateField, dateFrom, dateTo } = req.query;
  res.json({ results: search({ query: q ?? "", playlistId, dateField, dateFrom, dateTo }) });
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

// --- First-run setup (Section 6) ---

app.get("/api/setup/status", (_req, res) => {
  res.json({
    needsSetup: !isConfigComplete(config),
    propresenter: config.propresenter,
    role: config.role ?? null,
  });
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
      storageBackend: config.arrangementModule?.storageBackend ?? null,
      provider: config.arrangementModule?.provider ?? null,
    },
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
});
