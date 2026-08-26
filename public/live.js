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

  // Refreshed on a timer as well as on click, because it arms itself: a
  // volunteer who never touches this should still see it turn on when the
  // service starts, and be able to trust what the card says.
  let perfTimer = null;
  function wirePerformanceMode() {
    const dot = document.getElementById("perf-mode-dot");
    const state = document.getElementById("perf-mode-state");
    const why = document.getElementById("perf-mode-why");
    const toggle = document.getElementById("perf-mode-toggle");
    if (!toggle) return;

    const paint = (data) => {
      if (!document.getElementById("perf-mode-dot")) return; // re-rendered underneath us
      const on = Boolean(data?.armed);
      dot.className = `w-2.5 h-2.5 rounded-full ${on ? "bg-warning" : "bg-success"}`;
      state.textContent = on ? "On — Refrain is holding still" : "Off — Refrain may index in the background";
      why.textContent = data?.description ?? "";
      toggle.textContent = on ? "Turn off" : "Turn on";
      toggle.className = `btn btn-sm ${on ? "btn-warning" : "btn-outline"}`;
    };

    const load = () =>
      fetch("/api/performance-mode")
        .then((r) => r.json())
        .then(paint)
        .catch(() => {});

    toggle.addEventListener("click", async () => {
      const turningOn = toggle.textContent === "Turn on";
      toggle.disabled = true;
      try {
        const res = await fetch("/api/performance-mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ armed: turningOn }),
        });
        paint(await res.json());
      } finally {
        toggle.disabled = false;
      }
    });

    load();
    clearInterval(perfTimer);
    perfTimer = setInterval(load, 30_000);
  }

  async function render() {
    container.innerHTML = `
      <div class="flex flex-col gap-6">
        <div>
          <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="monitor" class="w-5 h-5"></i> Live</h1>
          <p class="text-sm opacity-70">Get things off the screen, or switch what the screens are showing. Big buttons on purpose.</p>
        </div>

        <div id="perf-mode-wrap">
          <div class="text-xs uppercase tracking-wide opacity-60 mb-2">Performance mode</div>
          <div id="perf-mode-card" class="card bg-base-200">
            <div class="card-body p-3 gap-2">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <span id="perf-mode-dot" class="w-2.5 h-2.5 rounded-full bg-base-content/30"></span>
                  <span id="perf-mode-state" class="font-medium">Checking...</span>
                </div>
                <button id="perf-mode-toggle" class="btn btn-sm btn-outline">Turn on</button>
              </div>
              <div id="perf-mode-why" class="text-sm opacity-70"></div>
              <div class="text-xs opacity-60">
                While this is on, Refrain does nothing on its own. No indexing, no reindexing, no
                update checks. It keeps checking the link every few seconds, because that is what the
                indicator in the rail is reading. Everything you press still works. It turns itself on
                when something has been on the screens for a couple of minutes, and off again once the
                screens have been clear for a while.
              </div>
            </div>
          </div>
        </div>

        <div id="live-message-wrap" class="hidden">
          <div class="text-xs uppercase tracking-wide opacity-60 mb-2">Message on screen</div>
          <div class="card bg-base-200">
            <div class="card-body p-3 gap-3">
              <select id="live-message-select" class="select select-bordered select-sm hidden"></select>
              <div id="live-message-fields" class="flex flex-col gap-2"></div>
              <div class="flex gap-2">
                <button id="live-message-post" class="btn btn-brand h-16 flex-1 text-base"><span class="flex items-center gap-2"><i data-lucide="send" class="w-5 h-5"></i> Post to screen</span></button>
                <button id="live-message-clear" class="btn btn-outline h-16"><span class="flex items-center gap-2"><i data-lucide="x" class="w-5 h-5"></i> Clear</span></button>
              </div>
              <p class="text-xs opacity-60">Fills a message you set up once in ProPresenter and shows it, so an urgent code is type-and-post. Clear takes it back down.</p>
            </div>
          </div>
        </div>

        <div>
          <div class="text-xs uppercase tracking-wide opacity-60 mb-2">Clear</div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button class="btn btn-error h-20 text-base" data-clear="all"><span class="flex flex-col items-center gap-1"><i data-lucide="x-octagon" class="w-6 h-6"></i> Clear All</span></button>
            <button class="btn btn-outline h-20 text-base" data-clear="slide"><span class="flex flex-col items-center gap-1"><i data-lucide="type" class="w-6 h-6"></i> Slide</span></button>
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
    wirePerformanceMode();

    try {
      const { looks, macros, messages } = await fetch("/api/live/controls").then((r) => r.json());
      renderMessages(messages ?? []);
      renderButtons("live-looks", "live-looks-wrap", looks, "look");
      renderButtons("live-macros", "live-macros-wrap", macros, "macro");
      if (!looks.length && !macros.length) {
        setStatus("No Looks or Macros found in ProPresenter (or it's unreachable). The Clear buttons still work.");
      }
    } catch {
      setStatus("Couldn't reach ProPresenter to load its controls. The Clear buttons still work.");
    }
  }

  // The message poster. Only messages with a fillable text token can be
  // posted from here, so timer-only messages are left out. When several
  // qualify, a small picker chooses between them.
  function renderMessages(messages) {
    const postable = (messages ?? []).filter((m) => m.tokens?.some((t) => t.kind === "text"));
    if (!postable.length) return;

    const wrap = document.getElementById("live-message-wrap");
    const select = document.getElementById("live-message-select");
    const fields = document.getElementById("live-message-fields");
    const postBtn = document.getElementById("live-message-post");
    const clearBtn = document.getElementById("live-message-clear");

    select.innerHTML = postable.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join("");
    select.classList.toggle("hidden", postable.length < 2);

    const selected = () => postable.find((m) => m.id === select.value) ?? postable[0];

    function renderFields() {
      const m = selected();
      fields.innerHTML = m.tokens
        .filter((t) => t.kind === "text")
        .map(
          (t) => `
        <label class="form-control">
          <div class="label py-0"><span class="label-text text-xs opacity-70">${escapeHtml(t.name)}</span></div>
          <input class="input input-bordered live-message-token" data-token="${escapeHtml(t.name)}" placeholder="Type the message..." />
        </label>`
        )
        .join("");
    }

    select.addEventListener("change", renderFields);
    renderFields();

    postBtn.addEventListener("click", () => {
      const m = selected();
      const values = [...fields.querySelectorAll(".live-message-token")].map((inp) => ({ name: inp.dataset.token, text: inp.value }));
      fire(postBtn, "/api/live/message", { id: m.id, values }, "Post");
    });
    clearBtn.addEventListener("click", () => fire(clearBtn, "/api/live/message-clear", { id: selected().id }, "Clear message"));

    wrap.classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
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
