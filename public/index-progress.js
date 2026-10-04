/**
 * The indexing bar along the bottom of every screen (owner, 2026-10-04:
 * "there's no indication that indexing is even happening ... a banner at the
 * bottom that slowly loads like an old video game progress bar").
 *
 * Shown whenever a search index run is going, however it started: Rebuild,
 * Save and rebuild, the file watcher, the morning catch-up. Blocks fill one
 * at a time as presentations are read; there's no pulse or shimmer (the
 * brief keeps those for faults). When the run ends it says how it ended for
 * a few seconds, then goes. A press that can't run (something on the
 * screens) says why here too.
 *
 * Core, like the status lights: reads /api/index/status, which asks
 * ProPresenter nothing.
 */

export const BLOCKS = 24;
const FAST_MS = 1000;
const SLOW_MS = 15_000;
const DONE_MS = 6000;

const STAGES = {
  library: "Reading the library",
  playlists: "Reading playlists",
  "checking files": "Checking which files changed",
  presentations: "Reading presentations",
};

const minutes = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.round(ms / 60_000);
  return m < 1 ? "under a minute left" : `about ${m} min left`;
};

/** What the bar shows for one status answer. Pure, for tests. */
export function progressView(status) {
  const run = status?.rebuild;
  if (!run?.inProgress) return { show: false };
  const total = Number(run.total) || 0;
  const current = Math.min(Number(run.current) || 0, total);
  const filled = total ? Math.floor((current / total) * BLOCKS) : 0;
  const stage = STAGES[run.stage] ?? "Indexing";
  const parts = [stage];
  if (total) parts.push(`${current} of ${total}`);
  const left = run.stage === "presentations" ? minutes(run.etaMs) : null;
  if (left) parts.push(left);
  return { show: true, filled, text: parts.join(" · ") };
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

export function initIndexProgress() {
  const bar = document.createElement("div");
  bar.id = "index-progress";
  bar.className = "rf-index-bar";
  bar.hidden = true;
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.innerHTML = `
    <span class="rf-index-word">Indexing</span>
    <span class="rf-index-blocks" aria-hidden="true">${'<i></i>'.repeat(BLOCKS)}</span>
    <span class="rf-index-text"></span>`;
  document.body.appendChild(bar);
  const blocks = [...bar.querySelectorAll(".rf-index-blocks i")];
  const word = bar.querySelector(".rf-index-word");
  const text = bar.querySelector(".rf-index-text");

  let wasRunning = false;
  let timer = null;
  let hideTimer = null;
  let asked = false; // an operator pressed something that should index

  // Sits over the content column only, never over the menu.
  const place = () => {
    const main = document.getElementById("main-content");
    if (!main) return;
    const r = main.getBoundingClientRect();
    bar.style.left = `${Math.max(0, r.left)}px`;
    bar.style.width = `${r.width}px`;
  };
  window.addEventListener("resize", place);

  // Room under the content while the bar is up, so it covers nothing.
  const setShown = (on) => {
    bar.hidden = !on;
    document.body.toggleAttribute("data-index-bar", on);
  };

  const showMessage = (label, message, fault) => {
    clearTimeout(hideTimer);
    setShown(true);
    bar.dataset.state = fault ? "fault" : "done";
    word.textContent = label;
    text.textContent = message;
    place();
    hideTimer = setTimeout(() => setShown(false), fault ? DONE_MS * 2 : DONE_MS);
  };

  async function check() {
    clearTimeout(timer);
    let status = null;
    try {
      status = await fetch("/api/index/status", { cache: "no-store" }).then((r) => r.json());
    } catch {
      timer = setTimeout(check, SLOW_MS);
      return;
    }
    const view = progressView(status);
    if (view.show) {
      clearTimeout(hideTimer);
      wasRunning = true;
      asked = false;
      setShown(true);
      bar.dataset.state = "running";
      word.textContent = "Indexing";
      text.textContent = view.text;
      blocks.forEach((b, i) => b.toggleAttribute("data-on", i < view.filled));
      place();
    } else if (wasRunning) {
      wasRunning = false;
      blocks.forEach((b) => b.setAttribute("data-on", ""));
      const done = doneText(status);
      showMessage(done.fault ? "Stopped" : "Done", done.text, done.fault);
    } else if (asked && status?.held) {
      // A press that asked for indexing, which couldn't start.
      asked = false;
      showMessage("Waiting", status.held, true);
    }
    timer = setTimeout(check, view.show || asked ? FAST_MS : SLOW_MS);
  }

  // Settings' Rebuild and Save and rebuild say when they've asked, so the bar
  // looks at once instead of at its next slow check.
  document.addEventListener("refrain:index-requested", (e) => {
    if (e.detail?.reason) {
      showMessage("Waiting", e.detail.reason, true);
      return;
    }
    asked = true;
    setTimeout(check, 300);
  });
  check();
}
