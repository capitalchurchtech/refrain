/**
 * The status cluster under the wordmark: four small icon lamps, plum when fine.
 *
 * Replaces the lone LINKED row, which read badly for three reasons that had
 * nothing to do with its geometry — that was already correct, every glyph
 * centred on the rail axis in both states.
 *
 * It was **optically light**: a 16px lucide icon is a line drawing filling its
 * box, while an 8px dot covers about a fifth of the same area, so it could not
 * hold a column of icons however well centred it was. It was **short**: 28px
 * among nav items at 36 and controls at 40, the smallest thing in the rail. And
 * it was **the wrong category**: everything else in that column is a control
 * with hover and press behaviour, so a static readout wedged among them read as
 * an orphan — a status line dressed as a menu item.
 *
 * A cluster fixes the category problem rather than the pixel problem. Status
 * stops pretending to be navigation.
 *
 * It also gathers state that was scattered across four places: link in the
 * rail, live state in the readout on Search only, performance mode on Live
 * only. Nothing told an operator what was on the screens while they were
 * looking at Health.
 *
 * **Which lamps earn a place**, by the rule that killed the global sync bar —
 * a lamp that never changes is decoration:
 *
 *   LINK  the quality floor names it: disconnected must be unmistakable
 *   LIVE  nothing else reports what is on the screens away from Search
 *   PERF  it arms and releases on its own, so it genuinely moves
 *   FEED  whether the status feed to the church's own announcement server is
 *         getting through; off, idle between send windows, or amber on failure
 *
 * Index freshness deliberately has no lamp. It is real but it is not binary and
 * it changes rarely; it gets the text line on Search instead. A lamp holding
 * one colour for weeks is furniture.
 *
 * These report. They are never interactive — that is the whole point of taking
 * them out of the key bank.
 */

const POLL_MS = 4000;

// Line drawings on a 24px grid, drawn here rather than looked up: the lamps are
// part of the rail and must not depend on the icon library having loaded.
const ICON = {
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  live: '<circle class="rf-lamp-fill" cx="12" cy="12" r="7"/>',
  perf: '<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/>',
  feed: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01"/>',
};

/**
 * What each lamp reads, as one of four states:
 *   on     fine, and doing its job (plum, quiet)
 *   off    nothing to report (dim)
 *   fault  needs a person (amber)
 *   live   something is on the screens (red)
 *
 * Plum on purpose (owner, 2026-10-07): a lamp that is fine should disappear
 * from the operator's attention. Only a fault or live changes colour.
 */
const LAMPS = [
  {
    id: "link",
    legend: "Link",
    read: (s) => (s?.connected ? "on" : "fault"),
    about: "Link: whether Refrain can reach ProPresenter.",
    title: (st) => (st === "on" ? "Now: connected." : "Now: lost ProPresenter. Retrying."),
  },
  {
    id: "live",
    legend: "Live",
    read: (s) => (s?.live ? "live" : "off"),
    about: "Live: whether anything is on the screens right now.",
    title: (st) => (st === "live" ? "Now: something is on the screens." : "Now: nothing on the screens."),
  },
  {
    id: "perf",
    legend: "Perf",
    read: (s) => (s?.performanceMode?.armed ? "on" : "off"),
    about: "Performance mode: Refrain holds still during a service, with no indexing or background work. It turns on by itself.",
    title: (st) => (st === "on" ? "Now: on, holding still." : "Now: off."),
  },
  {
    id: "feed",
    legend: "Feed",
    // The status feed to the church's own announcement server (Settings >
    // Telemetry). Off unless the church turned it on; amber when it is on but
    // cannot reach the server or is not set up; dim between send windows.
    read: (s) => (s?.feed === "ok" ? "on" : s?.feed === "fault" ? "fault" : "off"),
    about: "Feed: whether Refrain is reporting to your announcement server (Settings > Telemetry). Nothing goes anywhere else.",
    title: (st, s) =>
      st === "on"
        ? "Now: reporting."
        : st === "fault"
          ? "Now: not getting through. See Settings > Telemetry."
          : s?.feed === "idle"
            ? "Now: waiting for the send window."
            : "Now: switched off.",
  },
];

// Every poll, with the whole live state, so a screen can mark what is on the
// screens without polling a second time.
export const LIVE_STATE_EVENT = "refrain:live-state";

export function initStatusCluster() {
  const host = document.getElementById("status-cluster");
  if (!host) return;

  host.innerHTML = LAMPS.map(
    (l) => `
    <span class="rf-lamp" data-lamp="${l.id}" data-state="off" role="img" title="${l.about}" aria-label="${l.about}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${ICON[l.id]}</svg>
    </span>`
  ).join("");

  const rows = new Map([...host.querySelectorAll("[data-lamp]")].map((el) => [el.dataset.lamp, el]));
  let lastKey = null;

  function paint(state) {
    window.dispatchEvent(new CustomEvent(LIVE_STATE_EVENT, { detail: state }));
    // Only touch the DOM when something actually changed, so a poll every four
    // seconds is not rewriting the rail continuously.
    const states = LAMPS.map((l) => l.read(state));
    const key = `${states.join(",")}|${state?.feed ?? ""}`;
    if (key === lastKey) return;
    lastKey = key;

    LAMPS.forEach((lamp, i) => {
      const row = rows.get(lamp.id);
      if (!row) return;
      const st = states[i];
      row.dataset.state = st;
      row.title = `${lamp.about}\n${lamp.title(st, state)}`;
      row.setAttribute("aria-label", `${lamp.about} ${lamp.title(st, state)}`);
    });
  }

  async function check() {
    try {
      paint(await fetch("/api/live-state").then((r) => r.json()));
    } catch {
      // Cannot reach our own server: report the link as down rather than
      // leaving a stale "linked" on screen, which is the one lie this control
      // exists to prevent.
      paint({ connected: false, live: false, performanceMode: { armed: false }, feed: "off" });
    }
  }

  check();
  setInterval(check, POLL_MS);
}
