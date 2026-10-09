/**
 * The one place that knows whether the search index is being built.
 *
 * Before this, the bottom bar polled the server itself and Settings' Search
 * index card was drawn once from /api/health, so the card never moved and
 * leaving Settings and coming back rebuilt it from scratch. Now this module
 * polls once, keeps the run's state (including the throughput trace that
 * would otherwise start empty on every visit), and every view is a disposable
 * subscriber: the bottom bar, the Settings card, whatever comes next. Tearing a
 * view down loses nothing because nothing lived in it.
 *
 * Core, like the status lights: reads /api/index/status, which asks
 * ProPresenter nothing, so search keeps working with nothing else running.
 */

const FAST_MS = 1000;
const SLOW_MS = 15_000;
const DONE_MS = 6000;
const FAULT_MS = 12_000;
const TRACE = 32;
const ASKED_LOOKS = 10;

/** The four things a run does, in order. Labels are written for the operator. */
export const STAGE_LABELS = ["Library", "Playlists", "Files", "Slides"];
const STAGE_KEYS = ["library", "playlists", "checking files", "presentations"];
const STAGE_SENTENCE = ["Reading the library", "Reading playlists", "Checking which files changed", "Reading presentations"];
const SWEEP_SENTENCE = "Re-reading presentations that failed the first time";

/** Which of the four a server stage belongs to. The final sweep is part of the last. */
export function stageIndex(stage) {
  if (stage === "sweep") return 3;
  const i = STAGE_KEYS.indexOf(stage);
  return i < 0 ? 0 : i;
}

const minutes = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.round(ms / 60_000);
  return m < 1 ? "under a minute left" : `about ${m} min left`;
};

const ratio = (current, total) => (total > 0 ? Math.min(1, Math.max(0, current / total)) : 0);

/** The four stage bars for a run that is going. */
function stagesFor(active, frac) {
  return STAGE_LABELS.map((label, i) => ({
    label,
    state: i < active ? "done" : i === active ? "active" : "pending",
    frac: i < active ? 1 : i === active ? frac : 0,
  }));
}

/**
 * What every view shows while a run is going. Pure.
 * `stopping` is the operator's own press, which the server does not report.
 */
export function runningState(run, { stopping = false, hist = [] } = {}) {
  const total = Number(run.total) || 0;
  const raw = Number(run.current) || 0;
  const current = total ? Math.min(raw, total) : raw;
  const active = stageIndex(run.stage);
  const frac = ratio(current, total);
  const left = active === 3 && run.stage !== "sweep" ? minutes(run.etaMs) : null;

  let sentence;
  // The server only checks for a stop between presentation reads, so before
  // that stage a stop takes effect when reading presentations begins.
  if (stopping) sentence = active === 3 ? "Stopping after this presentation" : "Stopping as soon as it reaches the presentations";
  else if (run.stage === "sweep") sentence = SWEEP_SENTENCE;
  else {
    const parts = [STAGE_SENTENCE[active]];
    if (total) parts.push(`${current} of ${total}`);
    if (left) parts.push(left);
    sentence = parts.join(" · ");
  }

  // The sweep re-reads failures without naming them, so the last title would be stale there.
  const first = Array.isArray(run.recentNames) ? run.recentNames[0] : null;
  const stageLine = run.stage === "sweep" ? SWEEP_SENTENCE : STAGE_SENTENCE[active];
  const name = run.stage === "presentations" && typeof first === "string" && first ? first : null;
  return {
    phase: stopping ? "stopping" : "running",
    word: stopping ? "Stopping" : "Indexing",
    sentence,
    // The dock has one line: the title being read once there is one, else the stage.
    short: name ?? stageLine,
    frac,
    pct: `${Math.floor(frac * 100)}%`,
    stages: stagesFor(active, frac),
    reading: name ?? stageLine,
    trail: Array.isArray(run.recentNames) ? run.recentNames.slice(1) : [],
    hist,
    current,
    total,
  };
}

/** How a finished run is described, from the status after it. Pure. */
export function doneText(status) {
  if (status?.partial) {
    const p = status.partial;
    const where = Number.isFinite(p.read) && Number.isFinite(p.of) ? ` after ${p.read} of ${p.of}` : "";
    return { fault: true, text: `Indexing stopped${where}. Search still works with what it has. Run it again when nothing is on the screens.` };
  }
  return { fault: false, text: `Search index ready: ${status?.presentationCount ?? 0} presentations.` };
}

/** The state after a run ends. `last` is the final numbers of the run. Pure. */
export function endedState(status, last = {}) {
  const done = doneText(status);
  const total = Number(status?.partial?.of) || last.total || 0;
  const current = Number(status?.partial?.read) || (done.fault ? last.current || 0 : total);
  const frac = done.fault ? ratio(current, total) : 1;
  return {
    phase: done.fault ? "stopped" : "done",
    word: done.fault ? "Stopped" : "Done",
    sentence: done.text,
    short: done.fault ? `Stopped after ${current} of ${total}` : `Ready: ${status?.presentationCount ?? 0} presentations`,
    frac,
    pct: `${Math.floor(frac * 100)}%`,
    stages: stagesFor(3, frac).map((s, i) => (i < 3 || !done.fault ? { ...s, state: "done", frac: 1 } : { ...s, state: "pending" })),
    reading: done.fault ? "Stopped" : "All read",
    trail: [],
    hist: [],
    current,
    total,
  };
}

/** A press that asked for indexing which could not start, or a reason it won't. */
export function waitingState(reason) {
  return {
    phase: "waiting",
    word: "Waiting",
    sentence: reason,
    short: reason,
    frac: 0,
    pct: "0%",
    stages: stagesFor(-1, 0),
    reading: "Waiting",
    trail: [],
    hist: [],
    current: 0,
    total: 0,
  };
}

export const IDLE = Object.freeze({ phase: "idle", word: "", sentence: "", short: "", frac: 0, pct: "0%", stages: [], reading: "", trail: [], hist: [], current: 0, total: 0 });

/** Appends one speed reading, keeping the last TRACE. Pure. */
export function pushTrace(hist, perSec) {
  if (!Number.isFinite(perSec) || perSec <= 0) return hist;
  const out = [...hist, perSec];
  return out.length > TRACE ? out.slice(out.length - TRACE) : out;
}

// ---- the store ----

const listeners = new Set();
let state = IDLE;
let started = false;
let timer = null;
let hideTimer = null;
let wasRunning = false;
let asked = false; // an operator pressed something that should index
let askedLooks = 0;
let stopping = false;
let hist = [];
let lastRun = {};
let lastRaw = null; // the server's own report of the run, so a press can be worded the way a poll would

function emit(next) {
  state = next;
  listeners.forEach((fn) => fn(state));
}

function showFor(next, ms) {
  clearTimeout(hideTimer);
  emit(next);
  hideTimer = setTimeout(() => emit(IDLE), ms);
}

// One pending check at most: an event-triggered check overlapping the loop's
// own used to leave two loops running for the life of the page.
function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(check, ms);
}

async function check() {
  clearTimeout(timer);
  let status = null;
  try {
    status = await fetch("/api/index/status", { cache: "no-store" }).then((r) => r.json());
  } catch {
    schedule(SLOW_MS);
    return;
  }
  const run = status?.rebuild;
  if (run?.inProgress) {
    clearTimeout(hideTimer);
    if (!wasRunning) hist = [];
    wasRunning = true;
    asked = false;
    askedLooks = 0;
    if (run.stage === "presentations") hist = pushTrace(hist, run.perSec);
    lastRaw = run;
    lastRun = { current: Number(run.current) || 0, total: Number(run.total) || 0 };
    emit(runningState(run, { stopping, hist }));
  } else if (wasRunning) {
    wasRunning = false;
    stopping = false;
    const ended = endedState(status, lastRun);
    showFor(ended, ended.phase === "stopped" ? FAULT_MS : DONE_MS);
  } else if (asked && status?.held) {
    asked = false;
    showFor(waitingState(status.held), FAULT_MS);
  }
  // A press that never produced a run stops being waited for after a few looks.
  if (asked && !run?.inProgress && ++askedLooks > ASKED_LOOKS) asked = false;
  schedule(run?.inProgress || asked ? FAST_MS : SLOW_MS);
}

function start() {
  if (started) return;
  started = true;
  // Settings' Rebuild and Save and rebuild say when they have asked, so the
  // views look at once instead of at the next slow check.
  document.addEventListener("refrain:index-requested", (e) => {
    if (e.detail?.reason) {
      showFor(waitingState(e.detail.reason), FAULT_MS);
      return;
    }
    asked = true;
    askedLooks = 0;
    schedule(300);
  });
  check();
}

/** Calls `fn` now and on every change. Returns the function that stops it. */
export function subscribeRun(fn) {
  listeners.add(fn);
  fn(state);
  start();
  return () => listeners.delete(fn);
}

/**
 * Asks the server to stand the run down. Resolves to an error message, or
 * null when it was accepted. The press shows at once (Stopping), before the
 * server has reached its next presentation boundary.
 */
export async function requestStop() {
  stopping = true;
  if (state.phase === "running" && lastRaw) emit(runningState(lastRaw, { stopping: true, hist }));
  try {
    const res = await fetch("/api/index/stop", { method: "POST" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    return null;
  } catch (err) {
    stopping = false;
    check();
    return `Couldn't stop it: ${err.message}`;
  }
}
