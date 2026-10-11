import { showFailure } from "./notice.js";

/**
 * App-wide "Return", and the history behind it.
 *
 * When the operator uses the app to jump to a slide during a service, the
 * server records the slide that was live just before the jump (see
 * /api/trigger and returnHistory in server/index.js). This surfaces that on
 * every screen so they can snap back to where the plan was in one click.
 *
 * It used to surface exactly one place, because the server kept exactly one.
 * That works for a single tangent and fails silently for two: the second jump
 * overwrote the first, so the way back to the plan was destroyed by the act of
 * leaving the tangent. Two jumps is not an edge case, it is what hunting for
 * something mid-service looks like — which is why Return "sometimes worked".
 *
 * Now the most recent place stays on the bar, and everything behind it is one
 * press away, in the same History flyout as the rail's History key (owner,
 * 2026-10-10: a second list under the bar was a second place for the same
 * thing). Two shapes, because there are two situations:
 *
 *   - Just jumped: the bar, as before, with a History handle beside Return that
 *     opens the flyout.
 *   - Jumped a while ago and already came back: no bar. The whole history is on
 *     the rail's History key, so nothing here claims something is happening
 *     now.
 *
 * It polls on a light interval, to catch a jump made from another device or
 * screen, and refreshes immediately when this page triggers a Go Live via
 * window.refreshReturnBar().
 */

const POLL_MS = 3000;

export function initReturnBar() {
  const bar = document.getElementById("return-bar");
  const label = document.getElementById("return-bar-label");
  const btn = document.getElementById("return-bar-btn");
  const toggle = document.getElementById("return-history-toggle");
  const toggleCount = document.getElementById("return-history-count");
  if (!bar || !label || !btn || !toggle) return;

  let history = [];
  let pin = null; // the place the bar is currently offering, or null
  let renderedKey = null; // so repeated polls don't thrash the DOM

  const keyOf = (e) => `${e.presentationId}:${e.slideIndex}`;

  function paint() {
    // Re-render only when the history actually changed, so a poll every three
    // seconds does not rewrite the bar under the operator's cursor.
    const key = `${pin ? keyOf(pin) : "-"}#${history.map(keyOf).join("|")}`;
    if (key === renderedKey) return;
    renderedKey = key;

    // The head is already on the bar, so the handle counts only what is behind it.
    const rest = pin ? history.slice(1) : history;

    if (pin) {
      const name = pin.name ? `“${escapeHtml(pin.name)}”` : "the previous slide";
      label.innerHTML = `Jumped from ${name} (slide ${pin.slideIndex + 1}). <span class="opacity-70">Return opens it in the editor.</span>`;
      bar.classList.remove("hidden");
      toggle.classList.toggle("hidden", rest.length === 0);
      toggleCount.textContent = rest.length ? String(rest.length) : "";
    } else {
      // Already come back, or never jumped. No alert: earlier places are one
      // hover away on the rail's History key (public/history-flyout.js).
      bar.classList.add("hidden");
      toggle.classList.add("hidden");
    }
  }

  /**
   * Focus a place in ProPresenter's editor.
   *
   * Deliberately focus-only, never a trigger: returning must not change what is
   * on the screens mid-service. Identified by presentation and slide rather
   * than by list position, because the history can gain an entry between render
   * and click.
   */
  async function goBack(target) {
    btn.disabled = true;
    try {
      const res = await fetch("/api/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target ?? {}),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        showFailure(`Couldn't go back: ${error ?? res.statusText}. Nothing on the screens changed.`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.history)) {
        history = data.history;
        pin = null; // returning always stands the bar down
        paint();
      } else {
        await load();
      }
    } finally {
      btn.disabled = false;
    }
  }

  async function load() {
    try {
      const data = await fetch("/api/return-pin").then((r) => r.json());
      pin = data.pin ?? null;
      history = Array.isArray(data.history) ? data.history : pin ? [pin] : [];
      paint();
    } catch {
      // Can't reach the server: leave whatever is on screen rather than
      // clearing a way back the operator may still need.
    }
  }

  btn.addEventListener("click", () => goBack(pin));

  // The handle opens the History flyout (public/history-flyout.js), the same
  // window as the rail's History key, and closes it when pressed again.
  toggle.addEventListener("click", () => window.toggleHistoryFlyout?.());

  // Let Go Live handlers ask for an immediate refresh instead of waiting on
  // the poll, so the bar appears the moment they jump.
  window.refreshReturnBar = load;

  load();
  setInterval(load, POLL_MS);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
