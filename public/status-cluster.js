/**
 * The status cluster at the foot of the rail.
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
 *
 * Index freshness deliberately has no lamp. It is real but it is not binary and
 * it changes rarely; it gets the text line on Search instead. A lamp holding
 * one colour for weeks is furniture.
 *
 * These report. They are never interactive — that is the whole point of taking
 * them out of the key bank.
 */

const POLL_MS = 4000;

const LAMPS = [
  {
    id: "link",
    legend: "Link",
    // Lit means present, and absence is the fault here — so this one is lit
    // when things are fine, unlike the two below.
    read: (s) => Boolean(s?.connected),
    title: (on) => (on ? "ProPresenter linked" : "Lost ProPresenter. Retrying."),
  },
  {
    id: "live",
    legend: "Live",
    read: (s) => Boolean(s?.live),
    title: (on) => (on ? "Something is on the screens" : "Nothing on the screens"),
  },
  {
    id: "perf",
    legend: "Perf",
    read: (s) => Boolean(s?.performanceMode?.armed),
    title: (on) =>
      on ? "Performance mode on — Refrain is holding still" : "Performance mode off — background work allowed",
  },
];

export function initStatusCluster() {
  const host = document.getElementById("status-cluster");
  if (!host) return;

  host.innerHTML = LAMPS.map(
    (l) => `
    <div class="rf-status-row" data-lamp="${l.id}" data-on="false">
      <span class="rf-led" data-lamp-led></span>
      <span class="nav-label rf-status-legend whitespace-nowrap hidden">${l.legend}</span>
    </div>`
  ).join("");

  const rows = new Map([...host.querySelectorAll("[data-lamp]")].map((el) => [el.dataset.lamp, el]));
  let lastKey = null;

  function paint(state) {
    // Only touch the DOM when something actually changed, so a poll every four
    // seconds is not rewriting the rail continuously.
    const key = LAMPS.map((l) => (l.read(state) ? "1" : "0")).join("");
    if (key === lastKey) return;
    lastKey = key;

    for (const lamp of LAMPS) {
      const row = rows.get(lamp.id);
      if (!row) continue;
      const on = lamp.read(state);
      row.dataset.on = String(on);
      row.title = lamp.title(on);
      row.querySelector("[data-lamp-led]").classList.toggle("lit", on);
    }
  }

  async function check() {
    try {
      paint(await fetch("/api/live-state").then((r) => r.json()));
    } catch {
      // Cannot reach our own server: report the link as down rather than
      // leaving a stale "linked" on screen, which is the one lie this control
      // exists to prevent.
      paint({ connected: false, live: false, performanceMode: { armed: false } });
    }
  }

  check();
  setInterval(check, POLL_MS);
}
