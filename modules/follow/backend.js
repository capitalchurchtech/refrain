/**
 * Follow module — server backend (Phase 1: transcription harness only).
 *
 * Captures a live (or recorded-WAV) audio feed with ffmpeg, resamples it
 * to 16 kHz mono PCM, streams it into the Python/MLX Whisper sidecar, and
 * exposes the resulting transcript over SSE. No song matching, no slide
 * triggering — that's Phase 2, and it plugs in downstream of the same
 * transcript chunks this produces.
 *
 * This file is loaded lazily by server/module-host.js, and ONLY once the
 * module is enabled and actually hit. Nothing here runs at app startup,
 * so a disabled Follow performs no ffmpeg/Python detection and holds no
 * processes, devices, or timers. teardown() releases everything.
 *
 * External tools (python3 + mlx-whisper, ffmpeg) are dependencies of THIS
 * MODULE ONLY. They are never added to package.json or the install
 * scripts; they're detected lazily and, if missing, reported to the UI as
 * setup instructions rather than crashing anything.
 */
import express from "express";
import { spawn, execFile } from "node:child_process";
import { mkdir, readFile, writeFile, rename, access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR_PATH = path.join(HERE, "stt_sidecar.py");

const PYTHON_CMD = process.env.REFRAIN_FOLLOW_PYTHON || "python3";
const FFMPEG_CMD = process.env.REFRAIN_FOLLOW_FFMPEG || "ffmpeg";

// Model choices offered in the UI. Keep in step with MODEL_REPOS in
// stt_sidecar.py. "small" is the default: it's the smallest model that
// handles sung vocals over a band decently while staying real-time on
// Apple Silicon.
const MODELS = ["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"];
const DEFAULT_MODEL = "small";

const SAMPLE_RATE = 16000;
const DEP_CACHE_MS = 15000; // re-probe python/ffmpeg at most this often

export default async function createBackend({ dataDir }) {
  await mkdir(dataDir, { recursive: true });
  const settingsPath = path.join(dataDir, "settings.json");

  // --- Persistent per-module settings (its own JSON, never in core) ---
  let settings = {
    mode: "live", // "live" | "wav"
    deviceIndex: null, // avfoundation audio device index for live capture
    channel: null, // 0-based channel to isolate (null = downmix to mono)
    model: DEFAULT_MODEL,
    wavPath: null, // file to replay in "wav" mode
  };
  try {
    settings = { ...settings, ...JSON.parse(await readFile(settingsPath, "utf-8")) };
  } catch {
    // No saved settings yet — defaults are fine.
  }
  async function saveSettings() {
    // Atomic write (temp + rename), matching the app's config-write
    // safety so a crash mid-write can't corrupt saved preferences.
    const tmp = `${settingsPath}.tmp`;
    await writeFile(tmp, JSON.stringify(settings, null, 2));
    await rename(tmp, settingsPath);
  }

  // --- Runtime state ---
  let ffmpeg = null;
  let sidecar = null;
  let running = false;
  let currentLevel = 0; // smoothed 0..1 input level for the meter
  let levelTimer = null;
  const sseClients = new Set();

  // A session is one start→stop run. `chunks` are the deduped,
  // incremental transcript; `raw` is every window the sidecar emitted,
  // kept so real transcripts can be inspected for Phase 2 tuning.
  let session = newSession();
  function newSession() {
    return { startedAt: null, mode: null, model: null, chunks: [], raw: [] };
  }

  // Dedup state across overlapping windows (see mergeWindow()).
  let emittedWords = [];

  // ---- Dependency detection (lazy, cached) -------------------------------
  let depCache = null;
  let depCacheAt = 0;
  async function checkDeps(force = false) {
    if (!force && depCache && Date.now() - depCacheAt < DEP_CACHE_MS) return depCache;
    const [ffmpegOk, pythonOk] = await Promise.all([canRun(FFMPEG_CMD, ["-version"]), canRun(PYTHON_CMD, ["--version"])]);
    let mlxOk = false;
    let mlxError = null;
    if (pythonOk) {
      const probe = await run(PYTHON_CMD, ["-c", "import mlx_whisper, numpy"]);
      mlxOk = probe.ok;
      if (!probe.ok) mlxError = (probe.stderr || "").trim().split("\n").pop() || "import failed";
    }
    depCache = {
      ffmpeg: ffmpegOk,
      python: pythonOk,
      mlxWhisper: mlxOk,
      mlxError,
      ready: ffmpegOk && pythonOk && mlxOk,
    };
    depCacheAt = Date.now();
    return depCache;
  }

  // ---- Audio device enumeration (macOS / avfoundation) -------------------
  async function listDevices() {
    // avfoundation lists devices on stderr and exits non-zero by design.
    const { stderr } = await run(FFMPEG_CMD, ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]);
    const devices = [];
    let inAudio = false;
    for (const line of (stderr || "").split("\n")) {
      if (/AVFoundation audio devices/i.test(line)) {
        inAudio = true;
        continue;
      }
      if (/AVFoundation video devices/i.test(line)) {
        inAudio = false;
        continue;
      }
      if (!inAudio) continue;
      const m = line.match(/\[(\d+)\]\s+(.+?)\s*$/);
      if (m) devices.push({ index: Number(m[1]), name: m[2] });
    }
    return devices;
  }

  // ---- Transcript overlap dedup -----------------------------------------
  // Each Whisper window re-transcribes ~4 s that mostly overlaps the last
  // one. Emit only the genuinely new tail: find the longest suffix of what
  // we've already emitted that matches a prefix of this window, and append
  // whatever comes after it. A window with no overlap is treated as a fresh
  // phrase (the band moved on) and appended whole.
  function mergeWindow(text) {
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    const maxK = Math.min(emittedWords.length, words.length);
    let overlap = 0;
    for (let k = maxK; k > 0; k--) {
      const tail = emittedWords.slice(emittedWords.length - k);
      if (tail.every((w, i) => sameWord(w, words[i]))) {
        overlap = k;
        break;
      }
    }
    const tail = words.slice(overlap);
    if (!tail.length) return "";
    emittedWords = emittedWords.concat(tail);
    return tail.join(" ");
  }
  function sameWord(a, b) {
    return normalizeWord(a) === normalizeWord(b);
  }
  function normalizeWord(w) {
    return w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  }

  // ---- SSE ---------------------------------------------------------------
  function broadcast(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of sseClients) {
      res.write(payload);
    }
  }

  // ---- Capture lifecycle -------------------------------------------------
  function buildFfmpegArgs() {
    const args = ["-hide_banner", "-loglevel", "error"];
    if (settings.mode === "wav") {
      if (!settings.wavPath) throw new Error("No WAV file selected for offline mode.");
      args.push("-re", "-i", settings.wavPath); // -re = replay at real time
    } else {
      if (settings.deviceIndex == null) throw new Error("No input device selected.");
      args.push("-f", "avfoundation", "-i", `:${settings.deviceIndex}`);
    }
    // Isolate one channel (a vocal-only aux off the board), or downmix.
    if (settings.channel != null && Number.isInteger(settings.channel)) {
      args.push("-af", `pan=mono|c0=c${settings.channel}`);
    }
    args.push("-ar", String(SAMPLE_RATE), "-ac", "1", "-f", "s16le", "pipe:1");
    return args;
  }

  async function start() {
    if (running) await stop();

    const deps = await checkDeps(true);
    if (!deps.ready) {
      const missing = [];
      if (!deps.ffmpeg) missing.push("ffmpeg");
      if (!deps.python) missing.push("python3");
      if (deps.python && !deps.mlxWhisper) missing.push("mlx-whisper (Python package)");
      const err = new Error(`Missing dependencies: ${missing.join(", ")}. See the setup notes on the Follow screen.`);
      err.deps = deps;
      throw err;
    }

    const args = buildFfmpegArgs(); // throws (before spawning) on bad settings

    session = newSession();
    session.startedAt = new Date().toISOString();
    session.mode = settings.mode;
    session.model = settings.model;
    emittedWords = [];
    currentLevel = 0;

    // Sidecar first, so it's ready to consume as soon as audio flows.
    sidecar = spawn(PYTHON_CMD, [SIDECAR_PATH, settings.model], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    sidecar.on("error", (err) => {
      console.error("[follow] sidecar spawn error:", err.message);
      broadcast({ type: "error", message: `Transcriber failed to start: ${err.message}` });
      stop();
    });

    const rl = createInterface({ input: sidecar.stdout });
    rl.on("line", (line) => handleSidecarLine(line));
    forwardStderr(sidecar.stderr, "sidecar");

    ffmpeg = spawn(FFMPEG_CMD, args, { stdio: ["ignore", "pipe", "pipe"] });
    ffmpeg.on("error", (err) => {
      console.error("[follow] ffmpeg spawn error:", err.message);
      broadcast({ type: "error", message: `Audio capture failed to start: ${err.message}` });
      stop();
    });
    forwardStderr(ffmpeg.stderr, "ffmpeg");

    // Audio path: ffmpeg PCM -> level meter -> sidecar stdin.
    ffmpeg.stdout.on("data", (buf) => {
      updateLevel(buf);
      if (sidecar?.stdin.writable) sidecar.stdin.write(buf);
    });
    ffmpeg.stdout.on("end", () => {
      // End of input (e.g. WAV finished) — close the sidecar's stdin so it
      // flushes its final window and exits cleanly.
      if (sidecar?.stdin.writable) sidecar.stdin.end();
    });

    // If either side dies, tear the whole run down so we never leave one
    // half running (an orphaned Python process is the thing we most want
    // to avoid).
    ffmpeg.on("exit", (code) => {
      if (running && code) console.error(`[follow] ffmpeg exited with code ${code}`);
      stop();
    });
    sidecar.on("exit", (code) => {
      if (running && code) console.error(`[follow] sidecar exited with code ${code}`);
      stop();
    });

    running = true;
    levelTimer = setInterval(() => {
      if (running) broadcast({ type: "level", value: currentLevel });
    }, 200);

    broadcast({ type: "started", session: sessionMeta() });
  }

  async function stop() {
    if (!running && !ffmpeg && !sidecar) return;
    running = false;
    clearInterval(levelTimer);
    levelTimer = null;
    currentLevel = 0;

    const procs = [ffmpeg, sidecar];
    ffmpeg = null;
    sidecar = null;
    for (const p of procs) {
      if (!p) continue;
      try {
        p.stdin?.end?.();
      } catch {
        // stdin may already be gone; killing below is what matters.
      }
      p.kill("SIGTERM");
    }
    // Escalate to SIGKILL for anything still alive shortly after.
    setTimeout(() => {
      for (const p of procs) {
        if (p && p.exitCode == null && p.signalCode == null) p.kill("SIGKILL");
      }
    }, 1500).unref?.();

    broadcast({ type: "stopped" });
  }

  function handleSidecarLine(line) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return; // ignore any non-JSON noise
    }
    if (obj.error) {
      broadcast({ type: "error", message: obj.error });
      return;
    }
    if (!obj.text) return;
    session.raw.push({ t: obj.t, text: obj.text, conf: obj.conf ?? null });
    const added = mergeWindow(obj.text);
    if (!added) return;
    const chunk = { t: obj.t, text: added, conf: obj.conf ?? null };
    session.chunks.push(chunk);
    broadcast({ type: "transcript", chunk });
  }

  function updateLevel(buf) {
    // RMS over the int16 samples in this buffer, smoothed a little so the
    // meter doesn't strobe. Purely a "is audio arriving" confidence signal.
    const samples = Math.floor(buf.length / 2);
    if (!samples) return;
    let sumSq = 0;
    for (let i = 0; i + 1 < buf.length; i += 2) {
      const v = buf.readInt16LE(i) / 32768;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / samples);
    currentLevel = Math.max(rms, currentLevel * 0.6); // fast attack, slow decay
  }

  function sessionMeta() {
    return { startedAt: session.startedAt, mode: session.mode, model: session.model, chunkCount: session.chunks.length };
  }

  async function status() {
    const deps = await checkDeps();
    return {
      running,
      settings,
      models: MODELS,
      deps,
      session: sessionMeta(),
      level: currentLevel,
      sidecarInfo: { windowSeconds: 4, hopSeconds: 1, offline: true },
    };
  }

  // ---- Routes (mounted under /api/module/follow) -------------------------
  const router = express.Router();
  router.use(express.json());

  router.get("/status", async (_req, res) => {
    try {
      res.json(await status());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/devices", async (_req, res) => {
    try {
      const deps = await checkDeps();
      if (!deps.ffmpeg) return res.status(422).json({ error: "ffmpeg isn't installed — can't list input devices.", deps });
      res.json({ devices: await listDevices() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/settings", async (req, res) => {
    try {
      const body = req.body ?? {};
      if (body.mode !== undefined) {
        if (!["live", "wav"].includes(body.mode)) return res.status(400).json({ error: 'mode must be "live" or "wav"' });
        settings.mode = body.mode;
      }
      if (body.deviceIndex !== undefined) {
        settings.deviceIndex = body.deviceIndex === null ? null : Number(body.deviceIndex);
      }
      if (body.channel !== undefined) {
        settings.channel = body.channel === null || body.channel === "" ? null : Number(body.channel);
      }
      if (body.model !== undefined) {
        if (!MODELS.includes(body.model)) return res.status(400).json({ error: `Unknown model "${body.model}"` });
        settings.model = body.model;
      }
      if (body.wavPath !== undefined) {
        settings.wavPath = body.wavPath ? String(body.wavPath).trim() : null;
      }
      await saveSettings();
      res.json({ ok: true, settings });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/start", async (req, res) => {
    try {
      const body = req.body ?? {};
      // Allow start to carry the latest picker values so a click doesn't
      // depend on a separate save round-trip.
      if (body.mode || body.deviceIndex !== undefined || body.channel !== undefined || body.model || body.wavPath !== undefined) {
        if (body.mode) settings.mode = body.mode;
        if (body.deviceIndex !== undefined) settings.deviceIndex = body.deviceIndex === null ? null : Number(body.deviceIndex);
        if (body.channel !== undefined) settings.channel = body.channel === null || body.channel === "" ? null : Number(body.channel);
        if (body.model && MODELS.includes(body.model)) settings.model = body.model;
        if (body.wavPath !== undefined) settings.wavPath = body.wavPath ? String(body.wavPath).trim() : null;
        await saveSettings();
      }
      if (settings.mode === "wav" && settings.wavPath && !(await fileExists(settings.wavPath))) {
        return res.status(400).json({ error: `WAV file not found: ${settings.wavPath}` });
      }
      await start();
      res.json({ ok: true, session: sessionMeta() });
    } catch (err) {
      res.status(err.deps ? 422 : 400).json({ error: err.message, deps: err.deps });
    }
  });

  router.post("/stop", async (_req, res) => {
    await stop();
    res.json({ ok: true });
  });

  // Live event stream: transcript chunks, level meter, start/stop/error.
  router.get("/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "hello", running, session: sessionMeta() })}\n\n`);
    // Replay the current session's transcript so a reopened screen isn't blank.
    for (const chunk of session.chunks) res.write(`data: ${JSON.stringify({ type: "transcript", chunk })}\n\n`);
    sseClients.add(res);
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // Full session log for the "Export session log" button.
  router.get("/session", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="follow-session-${Date.now()}.json"`);
    res.send(JSON.stringify(session, null, 2));
  });

  return {
    router,
    getStatus: status,
    async teardown() {
      await stop();
      for (const res of sseClients) {
        try {
          res.end();
        } catch {
          // client already gone
        }
      }
      sseClients.clear();
    },
  };
}

// ---- small process helpers ----------------------------------------------
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout ?? "", stderr: stderr ?? (err?.message ?? "") });
    });
  });
}
async function canRun(cmd, args) {
  return (await run(cmd, args)).ok;
}
async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function forwardStderr(stream, label) {
  if (!stream) return;
  const rl = createInterface({ input: stream });
  rl.on("line", (line) => {
    if (line.trim()) console.error(`[follow:${label}] ${line}`);
  });
}
