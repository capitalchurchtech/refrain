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
 * pull away. Two shapes, because there are two situations:
 *
 *   - Just jumped: the bar, as before, with a pulldown handle beside Return.
 *   - Jumped a while ago and already came back: no bar, just the handle,
 *     so the history is reachable without an alert claiming something is
 *     happening now.
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
  const tab = document.getElementById("return-history-tab");
  const tabCount = document.getElementById("return-history-tab-count");
  const panel = document.getElementById("return-history-panel");
  if (!bar || !label || !btn || !panel) return;

  let history = [];
  let pin = null; // the place the bar is currently offering, or null
  let renderedKey = null; // so repeated polls don't thrash the DOM
  let open = false;

  const keyOf = (e) => `${e.presentationId}:${e.slideIndex}`;

  function setOpen(next) {
    open = next;
    panel.classList.toggle("hidden", !open);
    toggle.setAttribute("aria-expanded", String(open));
    tab.setAttribute("aria-expanded", String(open));
  }

  /**
   * What the pulldown should list.
   *
   * With the bar up, the head is already on it, so listing it again would offer
   * the same jump twice. With the bar down, there is nothing holding the head
   * and the whole history is fair game.
   */
  function listable() {
    return pin ? history.slice(1) : history;
  }

  /**
   * Renders a list of places into the panel.
   *
   * Takes the list rather than deriving it, because the two openers want
   * different sets: the bar's handle excludes the head (it is already on the
   * bar, and offering the same jump twice is a bug), while the standalone tab
   * has no bar and so shows everything.
   */
  function renderPanel(entries) {
    panel.innerHTML = entries
      .map(
        (e) => `
        <button class="rf-return-entry" data-presentation="${escapeHtml(e.presentationId)}" data-slide="${e.slideIndex}"
                title="${escapeHtml(e.name ?? "Untitled")}">
          <span class="rf-return-name">${escapeHtml(e.name ?? "Untitled")}</span>
          <span class="rf-return-meta">SLIDE ${e.slideIndex + 1}</span>
        </button>`
      )
      .join("");
    panel.querySelectorAll(".rf-return-entry").forEach((el) =>
      el.addEventListener("click", () =>
        goBack({ presentationId: el.dataset.presentation, slideIndex: Number(el.dataset.slide) }, el)
      )
    );
  }

  function paint() {
    // Re-render only when the history actually changed, so a poll every three
    // seconds does not rebuild the list under the operator's cursor or close a
    // panel they just opened.
    const key = `${pin ? keyOf(pin) : "-"}#${history.map(keyOf).join("|")}`;
    if (key === renderedKey) return;
    renderedKey = key;

    const rest = listable();

    if (pin) {
      const name = pin.name ? `“${escapeHtml(pin.name)}”` : "the previous slide";
      label.innerHTML = `Jumped away from ${name} (slide ${pin.slideIndex + 1}). <span class="opacity-70">Return opens it in the editor so you can pick what's next.</span>`;
      bar.classList.remove("hidden");
      tab.classList.add("hidden");
      toggle.classList.toggle("hidden", rest.length === 0);
      toggleCount.textContent = rest.length ? String(rest.length) : "";
    } else {
      // Already come back, or never jumped. No alert, but earlier places stay
      // reachable behind the handle.
      bar.classList.add("hidden");
      toggle.classList.add("hidden");
      tab.classList.toggle("hidden", rest.length === 0);
      tabCount.textContent = rest.length ? String(rest.length) : "";
    }

    // A panel showing nothing is worse than no panel.
    if (open && rest.length === 0) setOpen(false);
    if (open) renderPanel(rest);
  }

  /**
   * Focus a place in ProPresenter's editor.
   *
   * Deliberately focus-only, never a trigger: returning must not change what is
   * on the screens mid-service. Identified by presentation and slide rather
   * than by list position, because the history can gain an entry between render
   * and click.
   */
  async function goBack(target, sourceEl) {
    if (sourceEl) sourceEl.disabled = true;
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
      if (sourceEl) sourceEl.disabled = false;
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

  btn.addEventListener("click", () => goBack(pin, null));

  // Both handles open the same panel over the same list; only `listable()`
  // differs by whether the bar is holding the head. Guarded against opening on
  // an empty list, which the visibility check in paint() cannot catch because
  // it only runs when the data changes, not when a handle is clicked.
  function openPanel() {
    const rest = listable();
    if (rest.length === 0) return;
    renderPanel(rest);
    setOpen(!open);
  }
  toggle.addEventListener("click", openPanel);
  tab.addEventListener("click", openPanel);

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
