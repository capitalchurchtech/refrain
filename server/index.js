/**
 * Refrain server entrypoint.
 *
 * See docs/refrain-architecture.md Section 16 for build order —
 * Step 0 is verifying ProPresenter API capabilities against your
 * actual installed version before relying on anything below.
 */
import express from "express";
import { loadConfig } from "./config.js";
import { ProPresenterClient } from "./propresenter-client.js";
import {
  loadIndexFromDisk,
  rebuildIndex,
  shouldAutoRebuild,
  search,
  getIndex,
} from "./search-index.js";
// import { discoverPlugins } from "./plugin-loader.js";

const app = express();
const config = loadConfig();
const client = new ProPresenterClient(config.propresenter);

app.use(express.static("public"));
app.use(express.json());

// TODO: mount module routes discovered via plugin-loader.js, per
// docs/refrain-architecture.md Section 17.11 (auto-discovery, no
// central registry file to edit).

app.get("/api/propresenter/status", async (_req, res) => {
  try {
    await client.testConnection();
    res.json({ connected: true, host: config.propresenter.host, port: config.propresenter.port });
  } catch (err) {
    res.json({ connected: false, host: config.propresenter.host, port: config.propresenter.port, error: err.message });
  }
});

app.get("/api/index/status", (_req, res) => {
  const index = getIndex();
  res.json({
    builtAt: index.builtAt,
    presentationCount: Object.keys(index.presentations).length,
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
  const { q, playlistId } = req.query;
  res.json({ results: search({ query: q ?? "", playlistId }) });
});

app.post("/api/trigger", async (req, res) => {
  const { presentationId, slideIndex } = req.body ?? {};
  if (!presentationId || slideIndex === undefined) {
    return res.status(400).json({ error: "presentationId and slideIndex are required" });
  }
  try {
    await client.triggerSlide(presentationId, slideIndex);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, "127.0.0.1", async () => {
  console.log(`Refrain running at http://localhost:${port}`);

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
