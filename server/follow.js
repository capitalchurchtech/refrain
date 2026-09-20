/**
 * Follow module — server engine (Phase 1: transcription harness only).
 *
 * Captures a live (or recorded-WAV) audio feed with ffmpeg, resamples it
 * to 16 kHz mono PCM, streams it into the Python/MLX Whisper sidecar
 * (modules/follow/stt_sidecar.py), dedupes the overlapping windows, and
 * fans the transcript out to the Follow screen over SSE. It does not
 * advance any slides yet — that's Phase 2, and it plugs in downstream of
 * these transcript chunks plus /api/live-state (which already knows the
 * currently-live presentation and slide from ProPresenter).
 *
 * External tools — python3 with mlx-whisper, and ffmpeg — are
 * dependencies of THIS MODULE ONLY. They are never added to package.json
 * or the install scripts. They're detected lazily (only when the Follow
 * screen asks, or on Start), and if missing the UI shows setup steps
 * rather than anything crashing. Whisper runs fully offline, so no audio
 * or text ever leaves the machine.
 *
 * Apple Silicon only (MLX). getFollowModuleStatus() in config.js reports
 * "misconfigured" elsewhere so the rest of the app is never affected.
 */
import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { access } from "node:fs/promises";
import { getIndex } from "./search-index.js";
import { buildSongCorpus, rankCandidates, tokenize } from "./follow-match.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR_PATH = path.join(HERE, "..", "modules", "follow", "stt_sidecar.py");

const PYTHON_CMD = process.env.REFRAIN_FOLLOW_PYTHON || "python3";
const FFMPEG_CMD = process.env.REFRAIN_FOLLOW_FFMPEG || "ffmpeg";

// UI model choices; keep in step with MODEL_REPOS in stt_sidecar.py.
// "small" is the smallest model that handles sung vocals over a band
// decently while staying real-time on Apple Silicon.
export const FOLLOW_MODELS = [
  "tiny",
  "base",
  "small",
  "medium",
  "large-v2",
  "large-v3",
  "large-v3-turbo",
  // Qwen3-ASR is the only mainstream open ASR model that lists singing as a
  // supported audio type. It runs through mlx-audio rather than mlx-whisper,
  // so it's a separate install — the Follow screen reports which one the
  // selected model needs.
  "qwen3-asr-0.6b",
  "qwen3-asr-1.7b",
];
export const FOLLOW_DEFAULT_MODEL = "small";

/** Which Python stack a model needs. Mirrors backend_for() in stt_sidecar.py. */
export function backendForModel(model) {
  return String(model ?? "").toLowerCase().includes("qwen3-asr") ? "qwen3" : "whisper";
}

const SAMPLE_RATE = 16000;
const DEP_CACHE_MS = 15000;

/** Whisper-on-MLX is Apple-Silicon-only. Cheap, side-effect-free check. */
export function isPlatformSupported() {
  return process.platform === "darwin" && process.arch === "arm64";
}

// ---- module-singleton runtime state (mirrors server/image-crop.js) ------
let ffmpeg = null;
let sidecar = null;
let running = false;
let currentLevel = 0;
let levelTimer = null;
const sseClients = new Set();

let session = newSession();
function newSession() {
  return { startedAt: null, mode: null, model: null, chunks: [], raw: [] };
}

// Running transcript, as words, for overlap dedup across windows.
let emittedWords = [];

// --- candidate song matching (Phase 1 readout only; never triggers) -------
// A rolling window of the most recent transcript words is scored against the
// song library so the screen can answer "could this have found the song?".
// Capped because evidence has to expire: a window long enough to span two
// songs would keep voting for the one that just ended.
const MATCH_WINDOW_WORDS = 40;
const CANDIDATE_THROTTLE_MS = 700;
let matchWords = [];
let corpus = null;
let corpusKey = null;
let lastCandidatesAt = 0;
let matchFolders = null;

/** (Re)build the song corpus when the search index or the folder scope changes. */
function ensureCorpus(folders) {
  const index = getIndex();
  const key = `${index?.builtAt ?? "none"}|${(folders ?? []).join(",")}`;
  if (corpus && corpusKey === key) return corpus;
  corpus = buildSongCorpus(index?.presentations ?? {}, folders ?? null);
  corpusKey = key;
  return corpus;
}

function broadcastCandidates(folders, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastCandidatesAt < CANDIDATE_THROTTLE_MS) return;
  lastCandidatesAt = now;
  const built = ensureCorpus(folders);
  if (!built?.docs?.length) return;
  const candidates = rankCandidates(matchWords, built, { limit: 5 });
  broadcast({ type: "candidates", candidates, windowWords: matchWords.length, songCount: built.totalDocs });
}

let depCache = null;
let depCacheAt = 0;

// ---- transcript overlap dedup (pure, exported for tests) -----------------
/**
 * Each Whisper window re-transcribes ~4 s that mostly overlaps the last
 * one. Given the words emitted so far and a new window's text, return only
 * the genuinely new tail: the longest suffix of `priorWords` that matches a
 * prefix of the new window is the overlap, and everything after it is new.
 * A window with no overlap is treated as a fresh phrase (the band moved on)
 * and returned whole.
 *
 * @returns {{ added: string, words: string[] }} added text + the updated word list
 */
export function mergeTranscriptWindow(priorWords, text) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return { added: "", words: priorWords };
  const maxK = Math.min(priorWords.length, words.length);
  let overlap = 0;
  for (let k = maxK; k > 0; k--) {
    const tail = priorWords.slice(priorWords.length - k);
    if (tail.every((w, i) => normalizeWord(w) === normalizeWord(words[i]))) {
      overlap = k;
      break;
    }
  }
  const tail = words.slice(overlap);
  if (!tail.length) return { added: "", words: priorWords };
  return { added: tail.join(" "), words: priorWords.concat(tail) };
}
function normalizeWord(w) {
  return w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

// ---- dependency detection (lazy, cached) --------------------------------
/**
 * Probe the module's external tools. `ready` is answered for the SELECTED
 * model, since the two backends need different Python packages — a Whisper
 * run doesn't need mlx-audio, and a Qwen3 run doesn't need mlx-whisper.
 */
export async function checkDeps(force = false, model = FOLLOW_DEFAULT_MODEL) {
  const backend = backendForModel(model);
  if (!force && depCache && Date.now() - depCacheAt < DEP_CACHE_MS) {
    return { ...depCache, backend, ready: readyFor(depCache, backend) };
  }
  const [ffmpegOk, pythonOk] = await Promise.all([canRun(FFMPEG_CMD, ["-version"]), canRun(PYTHON_CMD, ["--version"])]);
  let whisperOk = false;
  let audioOk = false;
  let mlxError = null;
  if (pythonOk) {
    const [whisperProbe, audioProbe] = await Promise.all([
      run(PYTHON_CMD, ["-c", "import mlx_whisper, numpy"]),
      run(PYTHON_CMD, ["-c", "import mlx_audio, numpy"]),
    ]);
    whisperOk = whisperProbe.ok;
    audioOk = audioProbe.ok;
    const failing = backend === "qwen3" ? audioProbe : whisperProbe;
    if (!failing.ok) mlxError = (failing.stderr || "").trim().split("\n").pop() || "import failed";
  }
  depCache = { ffmpeg: ffmpegOk, python: pythonOk, mlxWhisper: whisperOk, mlxAudio: audioOk, mlxError };
  depCacheAt = Date.now();
  return { ...depCache, backend, ready: readyFor(depCache, backend) };
}

function readyFor(deps, backend) {
  const engine = backend === "qwen3" ? deps.mlxAudio : deps.mlxWhisper;
  return Boolean(deps.ffmpeg && deps.python && engine);
}

// ---- audio device enumeration (macOS / avfoundation) --------------------
export async function listDevices() {
  const { stderr } = await run(FFMPEG_CMD, ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]);
  const devices = [];
  let inAudio = false;
  for (const line of (stderr || "").split("\n")) {
    if (/AVFoundation audio devices/i.test(line)) { inAudio = true; continue; }
    if (/AVFoundation video devices/i.test(line)) { inAudio = false; continue; }
    if (!inAudio) continue;
    const m = line.match(/\[(\d+)\]\s+(.+?)\s*$/);
    if (m) devices.push({ index: Number(m[1]), name: m[2] });
  }
  return devices;
}

// ---- SSE ----------------------------------------------------------------
function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

/** Register a Server-Sent-Events response; replays the current session so a reopened screen isn't blank. */
export function addSseClient(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`data: ${JSON.stringify({ type: "hello", running, session: sessionMeta() })}\n\n`);
  for (const chunk of session.chunks) res.write(`data: ${JSON.stringify({ type: "transcript", chunk })}\n\n`);
  sseClients.add(res);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15000);
  res.on("close", () => { clearInterval(heartbeat); sseClients.delete(res); });
}

// ---- capture lifecycle --------------------------------------------------
function buildFfmpegArgs(settings) {
  const args = ["-hide_banner", "-loglevel", "error"];
  if (settings.mode === "wav") {
    if (!settings.wavPath) throw new Error("No WAV file selected for offline mode.");
    args.push("-re", "-i", settings.wavPath);
  } else {
    if (settings.deviceIndex == null) throw new Error("No input device selected.");
    args.push("-f", "avfoundation", "-i", `:${settings.deviceIndex}`);
  }
  if (settings.channel != null && Number.isInteger(settings.channel)) {
    args.push("-af", `pan=mono|c0=c${settings.channel}`);
  }
  args.push("-ar", String(SAMPLE_RATE), "-ac", "1", "-f", "s16le", "pipe:1");
  return args;
}

/**
 * Start capture + transcription for the given settings
 * ({ mode, deviceIndex, channel, model, wavPath }). Throws (before
 * spawning anything) on missing deps or bad settings so the caller can
 * surface a clear error.
 */
export async function startCapture(settings) {
  if (running) await stopCapture();

  const model = FOLLOW_MODELS.includes(settings.model) ? settings.model : FOLLOW_DEFAULT_MODEL;
  const backend = backendForModel(model);

  const deps = await checkDeps(true, model);
  if (!deps.ready) {
    const missing = [];
    if (!deps.ffmpeg) missing.push("ffmpeg");
    if (!deps.python) missing.push("python3");
    if (deps.python && backend === "qwen3" && !deps.mlxAudio) missing.push("mlx-audio (Python package)");
    if (deps.python && backend === "whisper" && !deps.mlxWhisper) missing.push("mlx-whisper (Python package)");
    const err = new Error(`Missing dependencies for ${model}: ${missing.join(", ")}. See the setup notes on the Follow screen.`);
    err.deps = deps;
    throw err;
  }
  const args = buildFfmpegArgs(settings); // throws before spawning on bad settings

  session = newSession();
  session.startedAt = new Date().toISOString();
  session.mode = settings.mode === "wav" ? "wav" : "live";
  session.model = model;
  emittedWords = [];
  matchWords = [];
  // Which Library folders count as songs. Scoping to them is what stops a
  // transcript latching onto a sermon slide that shares a phrase.
  matchFolders = Array.isArray(settings.folders) && settings.folders.length ? settings.folders : null;
  currentLevel = 0;

  // Sidecar first, so it's ready to consume as soon as audio flows.
  sidecar = spawn(PYTHON_CMD, [SIDECAR_PATH, model], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  sidecar.on("error", (err) => {
    console.error("[follow] sidecar spawn error:", err.message);
    broadcast({ type: "error", message: `Transcriber failed to start: ${err.message}` });
    stopCapture();
  });
  createInterface({ input: sidecar.stdout }).on("line", handleSidecarLine);
  forwardStderr(sidecar.stderr, "sidecar");

  ffmpeg = spawn(FFMPEG_CMD, args, { stdio: ["ignore", "pipe", "pipe"] });
  ffmpeg.on("error", (err) => {
    console.error("[follow] ffmpeg spawn error:", err.message);
    broadcast({ type: "error", message: `Audio capture failed to start: ${err.message}` });
    stopCapture();
  });
  forwardStderr(ffmpeg.stderr, "ffmpeg");

  // Audio path: ffmpeg PCM -> level meter -> sidecar stdin.
  ffmpeg.stdout.on("data", (buf) => {
    updateLevel(buf);
    if (sidecar?.stdin.writable) sidecar.stdin.write(buf);
  });
  ffmpeg.stdout.on("end", () => {
    if (sidecar?.stdin.writable) sidecar.stdin.end(); // WAV finished -> flush + exit
  });

  // If either half dies, tear the whole run down — never leave one running.
  ffmpeg.on("exit", (code) => { if (running && code) console.error(`[follow] ffmpeg exited ${code}`); stopCapture(); });
  sidecar.on("exit", (code) => { if (running && code) console.error(`[follow] sidecar exited ${code}`); stopCapture(); });

  running = true;
  levelTimer = setInterval(() => { if (running) broadcast({ type: "level", value: currentLevel }); }, 200);
  broadcast({ type: "started", session: sessionMeta() });
}

export async function stopCapture() {
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
    try { p.stdin?.end?.(); } catch { /* already closed; the kill is what matters */ }
    p.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const p of procs) {
      if (p && p.exitCode == null && p.signalCode == null) p.kill("SIGKILL");
    }
  }, 1500).unref?.();

  broadcast({ type: "stopped" });
}

function handleSidecarLine(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return; }
  if (obj.error) { broadcast({ type: "error", message: obj.error }); return; }
  if (!obj.text) return;
  session.raw.push({ t: obj.t, text: obj.text, conf: obj.conf ?? null });
  const { added, words } = mergeTranscriptWindow(emittedWords, obj.text);
  emittedWords = words;
  if (!added) return;
  const chunk = { t: obj.t, text: added, conf: obj.conf ?? null };
  session.chunks.push(chunk);
  broadcast({ type: "transcript", chunk });

  // Score the library against what we've heard recently. Read-only: this
  // reports what Phase 2 *would* have concluded, and triggers nothing.
  matchWords = matchWords.concat(tokenize(added)).slice(-MATCH_WINDOW_WORDS);
  broadcastCandidates(matchFolders);
}

function updateLevel(buf) {
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

/** Runtime status for /api/follow/status (deps are fetched separately, being async). */
export function getFollowRuntimeStatus() {
  return { running, level: currentLevel, session: sessionMeta(), windowSeconds: 4, hopSeconds: 1, offline: true };
}

/** The full session log (deduped chunks + every raw window) for the export button. */
export function getFollowSession() {
  return session;
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
export async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

function forwardStderr(stream, label) {
  if (!stream) return;
  createInterface({ input: stream }).on("line", (line) => {
    if (line.trim()) console.error(`[follow:${label}] ${line}`);
  });
}

// Never orphan the sidecar/ffmpeg: kill them synchronously if this process
// exits, and turn Ctrl-C / a --watch restart into a clean exit that runs
// that handler. Registered once at import; harmless when nothing's running.
function killChildrenSync() {
  for (const p of [ffmpeg, sidecar]) {
    if (p) try { p.kill("SIGKILL"); } catch { /* already gone */ }
  }
}
process.once("exit", killChildrenSync);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { killChildrenSync(); process.exit(0); });
}
