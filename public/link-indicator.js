/**
 * The link indicator in the nav rail.
 *
 * The quality floor names this exactly: "disconnected is unmistakable and
 * always visible. A search tool that quietly stops listening mid-service is
 * worse than one that never worked." Before this, link state lived on Search
 * and Health only, and Search checked it once at page load - so ProPresenter
 * could drop at 10:04 and the screen would still look fine at 10:40.
 *
 * Reads the same cached state as the live readout, so one heartbeat serves
 * both and ProPresenter is called once every few seconds no matter how many
 * screens or tabs are open.
 *
 * Lost is a dark dot with no emission plus a silkscreen label, so the absence
 * is legible rather than merely unlit. It never pulses.
 */
const POLL_MS = 4000;

export function initLinkIndicator() {
  const led = document.getElementById("link-led");
  const row = document.getElementById("link-row");
  const label = document.getElementById("link-label");
  if (!led || !row) return;

  async function check() {
    let up = false;
    let live = false;
    try {
      const s = await fetch("/api/live-state").then((r) => r.json());
      up = Boolean(s.connected);
      live = Boolean(s.live);
    } catch {
      up = false;
    }
    const key = up ? "up" : "down";
    led.dataset.link = key;
    row.dataset.link = key;
    // Cold zone: what happened and the next action, one line, no apology.
    if (label) label.textContent = up ? (live ? "Live" : "Linked") : "No link";
    row.title = up ? "ProPresenter linked" : "Lost ProPresenter. Retrying.";
  }

  check();
  setInterval(check, POLL_MS);
}
