/**
 * What is on the screens, right now.
 *
 * Before this existed, pressing Go Live changed nothing an operator could see:
 * the button disabled for a moment and the screen was byte-identical a second
 * later. So the Reluctant Operator pressed twice, because nothing told them the
 * first press landed.
 *
 * Built as the bezel / glass / phosphor stack from the creative direction: a
 * recessed instrument that reports, not a control you press. Standing by is
 * plum; live is hot. Nothing on this path animates, and the phosphor never
 * pulses — a moving light in a live tool means something is wrong, and that
 * signal is not spent on decoration.
 *
 * Latency is the whole product here, so the readout paints optimistically the
 * instant a key goes down and corrects itself when the server answers. An
 * operator forgives a plain interface that answers instantly and never trusts a
 * beautiful one that hesitates.
 */

const POLL_MS = 2000;

// Mount points that want a readout. Each screen that can send something to the
// screens gets one; they all read the same state.
const mounts = new Set();
let latest = null;
let optimistic = null;
let pollTimer = null;
let tickTimer = null;

function elapsed(sinceIso, now = Date.now()) {
  if (!sinceIso) return "";
  const ms = now - new Date(sinceIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/**
 * One line of truth, in the operator's vocabulary.
 *
 * Cold zone throughout: terse, no personality, no apology. "Go" produces
 * "LIVE", never "Success".
 */
function readoutContent(state) {
  if (optimistic) {
    return {
      mode: "going",
      status: "GOING",
      primary: optimistic.presentationName || "Sending",
      secondary: optimistic.arrangementName ? `${optimistic.arrangementName}` : "",
      slide: optimistic.slideIndex != null ? `SLIDE ${optimistic.slideIndex + 1}` : "",
      time: "",
      detail: optimistic.text || "",
    };
  }
  if (!state) {
    return { mode: "standby", status: "----", primary: "Checking", secondary: "", slide: "", time: "", detail: "" };
  }
  if (!state.connected) {
    return {
      mode: "lost",
      status: "NO LINK",
      primary: "Lost ProPresenter. Retrying.",
      secondary: "",
      slide: "",
      time: "",
      detail: "",
    };
  }
  if (!state.slide) {
    return {
      mode: "standby",
      status: "STANDING BY",
      primary: "Nothing on screen",
      secondary: "",
      slide: "",
      time: "",
      detail: "",
    };
  }
  const s = state.slide;
  return {
    mode: state.live ? "live" : "standby",
    status: state.live ? "LIVE" : "STANDING BY",
    primary: s.presentationName || "Untitled",
    secondary: s.arrangementName || "",
    slide: `SLIDE ${s.slideIndex + 1}${s.slideCount ? ` / ${s.slideCount}` : ""}`,
    time: elapsed(state.liveSince),
    detail: s.text || "",
  };
}

function render() {
  const c = readoutContent(latest);
  for (const el of mounts) {
    el.dataset.mode = c.mode;
    el.innerHTML = `
      <div class="rf-bezel">
        <div class="rf-glass">
          <div class="rf-readout-row">
            <span class="rf-status">${escapeHtml(c.status)}</span>
            ${c.time ? `<span class="rf-time">${escapeHtml(c.time)}</span>` : ""}
          </div>
          <div class="rf-primary">${escapeHtml(c.primary)}</div>
          <div class="rf-readout-row rf-meta">
            ${c.secondary ? `<span class="rf-arr">${escapeHtml(c.secondary)}</span>` : ""}
            ${c.slide ? `<span class="rf-slide">${escapeHtml(c.slide)}</span>` : ""}
          </div>
          ${c.detail ? `<div class="rf-detail">${escapeHtml(c.detail)}</div>` : ""}
        </div>
      </div>`;
  }
}

async function load() {
  try {
    latest = await fetch("/api/live-state").then((r) => r.json());
  } catch {
    // A failed poll is itself information: we cannot see ProPresenter.
    latest = { connected: false, live: false, slide: null };
  }
  render();
}

/**
 * Called on mousedown, before the request is even sent, so the acknowledgement
 * lands inside 50ms. Corrected by the next poll either way, so a failed trigger
 * cannot leave a false "GOING" on screen for long.
 */
export function paintGoing(target) {
  optimistic = target;
  render();
  setTimeout(() => {
    if (optimistic === target) {
      optimistic = null;
      load();
    }
  }, 1500);
}

/** Clears an optimistic paint immediately, for a trigger that failed outright. */
export function clearGoing() {
  optimistic = null;
  render();
}

export function mountLiveReadout(el) {
  if (!el) return;
  mounts.add(el);
  render();
  if (!pollTimer) {
    load();
    pollTimer = setInterval(load, POLL_MS);
    // The elapsed clock ticks on its own so the readout counts up between
    // polls rather than jumping in two-second steps.
    tickTimer = setInterval(() => {
      if (latest?.liveSince && !optimistic) render();
    }, 1000);
  }
}

export function unmountLiveReadout(el) {
  mounts.delete(el);
  if (mounts.size === 0) {
    clearInterval(pollTimer);
    clearInterval(tickTimer);
    pollTimer = null;
    tickTimer = null;
  }
}

/** Exported for the link indicator, which reads the same state. */
export function currentLiveState() {
  return latest;
}
