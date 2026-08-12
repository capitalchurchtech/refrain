/**
 * Live page — big, obvious controls for the operator during a service.
 *
 * Clear buttons get things off the screen fast (they always work, being
 * standard ProPresenter layers). Below them, one large button per Look and
 * per Macro the church has in ProPresenter, fetched live, so their own
 * "Logo", "Black", "Motion", etc. show up by name with nothing hardcoded.
 * Everything is deliberately oversized and high-contrast: this screen is
 * meant to be usable at a glance from the back of a dark room.
 */
export function initLive() {
  const container = document.getElementById("view-live");

  async function render() {
    container.innerHTML = `
      <div class="flex flex-col gap-6">
        <div>
          <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="monitor" class="w-5 h-5"></i> Live</h1>
          <p class="text-sm opacity-70">Get things off the screen, or switch what the screens are showing. Big buttons on purpose.</p>
        </div>

        <div>
          <div class="text-xs uppercase tracking-wide opacity-60 mb-2">Clear</div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button class="btn btn-error h-20 text-base" data-clear="all"><span class="flex flex-col items-center gap-1"><i data-lucide="x-octagon" class="w-6 h-6"></i> Clear All</span></button>
            <button class="btn btn-outline h-20 text-base" data-clear="slide"><span class="flex flex-col items-center gap-1"><i data-lucide="square" class="w-6 h-6"></i> Slide</span></button>
            <button class="btn btn-outline h-20 text-base" data-clear="media"><span class="flex flex-col items-center gap-1"><i data-lucide="image" class="w-6 h-6"></i> Media</span></button>
            <button class="btn btn-outline h-20 text-base" data-clear="messages"><span class="flex flex-col items-center gap-1"><i data-lucide="message-square" class="w-6 h-6"></i> Messages</span></button>
          </div>
        </div>

        <div id="live-looks-wrap" class="hidden">
          <div class="text-xs uppercase tracking-wide opacity-60 mb-2">Looks</div>
          <div id="live-looks" class="grid grid-cols-2 sm:grid-cols-3 gap-3"></div>
        </div>

        <div id="live-macros-wrap" class="hidden">
          <div class="text-xs uppercase tracking-wide opacity-60 mb-2">Macros</div>
          <div id="live-macros" class="grid grid-cols-2 sm:grid-cols-3 gap-3"></div>
        </div>

        <div id="live-status" class="text-sm opacity-70"></div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();

    wireClearButtons();

    try {
      const { looks, macros } = await fetch("/api/live/controls").then((r) => r.json());
      renderButtons("live-looks", "live-looks-wrap", looks, "look");
      renderButtons("live-macros", "live-macros-wrap", macros, "macro");
      if (!looks.length && !macros.length) {
        setStatus("No Looks or Macros found in ProPresenter (or it's unreachable). The Clear buttons still work.");
      }
    } catch {
      setStatus("Couldn't reach ProPresenter to load Looks and Macros. The Clear buttons still work.");
    }
  }

  function renderButtons(gridId, wrapId, items, kind) {
    if (!items?.length) return;
    const grid = document.getElementById(gridId);
    grid.innerHTML = items
      .map(
        (it) => `<button class="btn btn-brand h-20 text-base" data-${kind}="${escapeHtml(it.id)}">${escapeHtml(it.name)}</button>`
      )
      .join("");
    document.getElementById(wrapId).classList.remove("hidden");
    grid.querySelectorAll(`[data-${kind}]`).forEach((btn) =>
      btn.addEventListener("click", () => fire(btn, `/api/live/${kind}`, { id: btn.dataset[kind] }, btn.textContent.trim()))
    );
  }

  function wireClearButtons() {
    container.querySelectorAll("[data-clear]").forEach((btn) =>
      btn.addEventListener("click", () => fire(btn, "/api/live/clear", { layer: btn.dataset.clear }, btn.textContent.trim()))
    );
  }

  // Fire a control, briefly disabling its button and surfacing any failure.
  // Kept quiet on success: a live operator wants no dialog to dismiss.
  async function fire(btn, url, body, label) {
    btn.disabled = true;
    setStatus("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        setStatus(`${label} failed: ${error ?? res.statusText}`);
      }
    } catch (err) {
      setStatus(`${label} failed: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  function setStatus(msg) {
    const el = document.getElementById("live-status");
    if (el) el.textContent = msg;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  return { render };
}
