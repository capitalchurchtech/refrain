import { mountLiveFlagSummary, refreshLiveSummaryOnNewFlags } from "./slide-flags.js";
import { lastKnownConnected, LINK_EVENT } from "./status-cluster.js";
import { mountLiveReadout, unmountLiveReadout } from "./live-readout.js";
import { initQuickSlides } from "./quick-slides.js";

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
/**
 * What the macro bank shows. Normally only the ones not hidden; while
 * editing, all of them, hidden ones included, so they can be brought back.
 * Pure, for tests.
 */
export function macroBank(macros, editing = false) {
  const list = macros ?? [];
  const hiddenCount = list.filter((m) => m.hidden).length;
  return { shown: editing ? list : list.filter((m) => !m.hidden), hiddenCount };
}

/**
 * Rows for messages with no fill-in field. Pure, for tests. A message whose
 * text is fixed can only be shown as it is, so its row offers Show and Take
 * down and shows the text, rather than a field ProPresenter would ignore.
 * Giving a message a text field in ProPresenter moves it to the poster below.
 */
export function plainMessagesHtml(plain) {
  const esc = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  return (plain ?? [])
    .map(
      (m) => `
    <div class="card bg-base-200 live-message-row" data-active="${m.active ? "1" : ""}">
      <div class="card-body p-3 gap-1">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="font-medium flex items-center gap-2">${m.active ? `<span class="rf-led lit" title="On screen"></span>` : ""}${esc(m.name)}${m.active ? ` <span class="text-xs opacity-70">On screen</span>` : ""}</div>
            ${m.text ? `<div class="text-xs opacity-70 truncate">Says: ${esc(m.text)}</div>` : ""}
          </div>
          <div class="flex gap-2 shrink-0">
            <button type="button" class="btn btn-outline btn-sm" data-message-show="${esc(m.id)}">Show</button>
            <button type="button" class="btn btn-outline btn-sm" data-message-hide="${esc(m.id)}">Take down</button>
          </div>
        </div>
      </div>
    </div>`
    )
    .join("");
}

/** The Now / Next pair, and the last phone press. Pure, for tests. */
export function livePreviewHtml(p) {
  const esc = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pane = (label, s, empty, step = false, keep = false) => {
    const inner = `
      <figcaption class="rf-subhead">${label}${s ? ` · slide ${s.slideNumber}` : ""}${step ? " · click to show" : ""}</figcaption>
      ${s?.image ? `<img src="${esc(s.image)}" alt="${esc(s.text ?? "")}" />` : `<div class="live-preview-empty">${esc(empty)}</div>`}
      ${
        // The slide worth keeping (the logo, a blank) is usually the one up,
        // so it can be kept from here as well as from Search.
        keep ? `<button type="button" class="btn btn-chip mt-2 live-keep-safe" title="Keep the slide on screen now as a safe slide">Keep as safe slide</button>` : ""
      }`;
    // The Next picture is also the Next key (owner request): one click, like
    // the other Live keys.
    return step
      ? `<button type="button" class="live-preview-pane live-preview-step" data-step="next" title="Show the next slide">${inner}</button>`
      : `<figure class="live-preview-pane">${inner}</figure>`;
  };
  const phone = p.lastPhoneAction
    ? `<div class="text-xs opacity-80 col-span-full">Phone: ${esc(p.lastPhoneAction.phone)} pressed ${esc(p.lastPhoneAction.label)} at ${esc(
        new Date(p.lastPhoneAction.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      )}${p.lastPhoneAction.ok ? "" : " (failed)"}</div>`
    : "";
  if (!p.current) return phone;
  return `${pane("Now", p.current, "", false, true)}${pane("Next", p.next, p.atEnd ? "End of this presentation" : "", Boolean(p.next))}${phone}`;
}

export function initLive() {
  const container = document.getElementById("view-live");
  initQuickSlides();

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
      /**
       * The lit state is the engaged state. This read inverted before: on --
       * the deliberate, holding-still, safe-during-service state -- rendered
       * as bg-warning, and off, which permits background indexing, rendered
       * as bg-success. Both colours are retired anyway; green is not in the
       * palette, and --rf-fault's amber is scoped under #view-health, so on
       * the Live screen an amber button fell through to raw DaisyUI warning:
       * the saturated warm reserved for what is on the screens, in the worst
       * possible place for it.
       */
      dot.className = `rf-led${on ? " lit" : ""}`;
      state.textContent = on ? "Holding still. Nothing runs on its own." : "Background work allowed.";
      why.textContent = data?.description ?? "";
      toggle.textContent = on ? "Turn off" : "Turn on";
      // Tier 2 machined in both states: the toggle is an ordinary control, and
      // the dot beside it is what reports the state.
      toggle.className = "btn btn-sm btn-outline";
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

    // Lock in, from where the operator already is. Only when the Service
    // module is on; its state lives on the Service screen.
    const lockBtn = document.getElementById("live-lockin-btn");
    const paintLock = async () => {
      try {
        const res = await fetch("/api/service/day");
        if (!res.ok) return lockBtn.classList.add("hidden");
        const day = await res.json();
        lockBtn.classList.remove("hidden");
        lockBtn.textContent = day.lockin ? "Release lock-in" : "Lock in";
        lockBtn.dataset.locked = day.lockin ? "1" : "";
      } catch {
        lockBtn.classList.add("hidden");
      }
    };
    lockBtn?.addEventListener("click", async () => {
      lockBtn.disabled = true;
      try {
        const url = lockBtn.dataset.locked ? "/api/service/lockin/release" : "/api/service/lockin";
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!res.ok) setStatus((await res.json().catch(() => ({}))).error ?? "Lock-in didn't change. Try again.");
      } finally {
        lockBtn.disabled = false;
        await paintLock();
        load();
      }
    });
    paintLock();

    load();
    clearInterval(perfTimer);
    perfTimer = setInterval(load, 30_000);
  }

  let readoutEl = null;
  let previewTimer = null;
  let previewKey = "";

  function startPreview() {
    clearInterval(previewTimer);
    previewKey = "";
    const tick = async () => {
      const host = document.getElementById("live-preview");
      if (!host || container.classList.contains("hidden")) return clearInterval(previewTimer);
      try {
        const p = await fetch("/api/preview").then((r) => r.json());
        const key = JSON.stringify([p.current?.image, p.next?.image, p.atEnd, p.lastPhoneAction?.at]);
        if (key === previewKey) return;
        previewKey = key;
        host.innerHTML = livePreviewHtml(p);
        host.classList.toggle("hidden", !p.current && !p.lastPhoneAction);
        host.querySelector(".live-keep-safe")?.addEventListener("click", async (e) => {
          const btn = e.currentTarget;
          const answer = await fire(btn, "/api/live/safe-slides/current", {}, "Keep as safe slide");
          if (answer?.added) {
            btn.textContent = "Kept";
            setStatus(`Kept as a safe slide: ${answer.added.label}.`);
            safeList = answer.safeSlides ?? safeList;
            paintSafeSlides();
            document.dispatchEvent(new CustomEvent("refrain:safe-slides-changed"));
          }
        });
        host.querySelector("[data-step]")?.addEventListener("click", async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          const ok = await fire(btn, "/api/live/step", { dir: btn.dataset.step }, "Next slide");
          if (ok) refreshSoon();
        });
      } catch {
        // Leave the last preview up; the readout above says if the link is down.
      }
    };
    tick();
    previewTimer = setInterval(tick, 3000);
    // After a press: every 0.4s for a few seconds, then back to every 3s.
    refreshSoon = () => {
      let n = 0;
      const t = setInterval(() => {
        tick();
        if (++n >= 8) clearInterval(t);
      }, 400);
    };
  }
  let refreshSoon = () => {};
  async function render() {
    // Live is rebuilt on each visit; let go of the old readout element so the
    // shared poll doesn't keep painting a detached copy.
    if (readoutEl) unmountLiveReadout(readoutEl);
    container.innerHTML = `
      <div class="flex flex-col gap-6">
        <div>
          <h2 class="rf-page-sub">Now</h2>
        </div>

        <!-- What's on the screens now, the same readout as Search's (one poll
             feeds both). Every press below used to be checked by looking at
             ProPresenter; this is where the answer shows instead. -->
        <div id="live-readout" class="rf-readout" data-mode="standby"></div>
        <!-- The current slide and the next one, as pictures (owner request).
             Checked every few seconds while Live is showing; a picture only
             loads when the slide changes. -->
        <div id="live-preview" class="hidden live-preview"></div>

        <div id="perf-mode-wrap">
          <h2 class="rf-subhead">Performance mode</h2>
          <div id="perf-mode-card" class="card bg-base-200">
            <div class="card-body p-3 gap-2">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <span id="perf-mode-dot" class="rf-led"></span>
                  <span id="perf-mode-state" class="font-medium">Checking</span>
                </div>
                <span class="flex gap-2">
                  <button id="live-lockin-btn" class="btn btn-sm btn-outline hidden" title="Hold still until released. For events with no set time.">Lock in</button>
                  <button id="perf-mode-toggle" class="btn btn-sm btn-outline">Turn on</button>
                </span>
              </div>
              <div id="perf-mode-why" class="text-sm opacity-70"></div>
              <!-- One line, and it has to be true in the state you are reading it
                   in. This paragraph used to describe the ON behaviour always, so
                   reading it while off told the operator the opposite of the truth.
                   The link-checking sentence is gone too: implementation detail on
                   the live path, and it contradicted "nothing runs on its own" one
                   sentence later. -->
              <div class="text-xs opacity-60 rf-measure">
                Turns on by itself after a couple of minutes live.
              </div>
            </div>
          </div>
        </div>

        <!-- Safe slides (handoff §39a): the church's own known-good slides to
             cut to in a hurry. First on the page, because a known picture is
             usually a better answer to "something's wrong" than an empty
             screen. -->
        <div id="live-safe-wrap">
          <div class="flex items-center justify-between gap-2">
            <h2 class="rf-subhead">Safe slides</h2>
            <button id="live-safe-edit" type="button" class="btn btn-chip hidden" aria-pressed="false">Edit</button>
          </div>
          <div id="live-safe" class="grid grid-cols-2 sm:grid-cols-4 gap-3"></div>
        </div>

        <!-- Stage message (handoff section 44): a note only the people on
             stage see, in the Stage Message box of the stage layouts. One
             press, because the audience never sees it; it stays up until
             Take down. -->
        <div id="live-stage-wrap">
          <div class="flex items-center justify-between gap-2">
            <h2 class="rf-subhead">Stage message</h2>
            <button id="live-stage-edit" type="button" class="btn btn-chip" aria-pressed="false">Edit</button>
          </div>
          <p id="live-stage-now" class="text-sm opacity-70 mb-2"></p>
          <div id="live-stage" class="grid grid-cols-1 sm:grid-cols-3 gap-3"></div>
          <div class="flex flex-wrap gap-2 mt-3">
            <input id="live-stage-text" class="input input-bordered flex-1 min-w-0" maxlength="80" placeholder="Say something else" aria-label="Stage message to show" />
            <button id="live-stage-show" type="button" class="btn btn-outline">Show</button>
            <button id="live-stage-clear" type="button" class="btn btn-outline">Take down</button>
          </div>
        </div>

        <div id="live-message-wrap" class="hidden">
          <div class="flex items-center justify-between gap-2">
            <h2 class="rf-subhead">Messages</h2>
            <span class="flex items-center gap-2">
              <span id="live-messages-hidden-note" class="text-xs opacity-60"></span>
              <button id="live-messages-edit" type="button" class="btn btn-chip" aria-pressed="false">Edit</button>
            </span>
          </div>
          <!-- Edit: one row per ProPresenter message, to keep it here or put
               it away (owner, 2026-10-04). Nothing is shown or taken down
               while editing. -->
          <p id="live-messages-editing" class="hidden text-sm mb-2">Choose which messages show here and on phones. Hidden ones stay in ProPresenter.</p>
          <div id="live-messages-edit-list" class="hidden flex flex-col gap-2 mb-3"></div>
          <div id="live-message-poster" class="card bg-base-200 hidden">
            <div class="card-body p-3 gap-3">
              <select id="live-message-select" class="select select-bordered select-sm hidden"></select>
              <div id="live-message-fields" class="flex flex-col gap-2"></div>
              <div class="flex gap-2">
                <button id="live-message-post" class="btn btn-outline h-16 flex-1 text-base"><span class="flex items-center gap-2"><i data-lucide="send" class="w-5 h-5"></i> Post to screen</span></button>
                <button id="live-message-clear" class="btn btn-outline h-16"><span class="flex items-center gap-2"><i data-lucide="x" class="w-5 h-5"></i> Clear</span></button>
              </div>
            </div>
          </div>
          <!-- Messages with no fill-in field (countdowns): Show and Take down,
               with what each says and whether it's up. Folded, closed, under
               the pager (owner, 2026-10-04: the pager and the stage message
               are the ones used; the rest stay one press away). Its heading
               says when one of them is on screen, so a running countdown
               isn't hidden by the fold. -->
          <details id="live-message-plain-wrap" class="collapse collapse-arrow bg-base-200 rounded rf-now-fold hidden mt-3">
            <summary class="collapse-title min-h-0 py-2">
              <span class="flex items-center gap-2 text-sm font-medium"><i data-lucide="timer" class="w-4 h-4 opacity-70 shrink-0"></i> Other messages <span id="live-message-plain-count" class="text-xs opacity-60 font-normal"></span></span>
            </summary>
            <div class="collapse-content"><div id="live-message-plain" class="flex flex-col gap-2"></div></div>
          </details>
        </div>

        <!-- Folded like the rest below (owner, 2026-10-04), in the Settings
             fold style. Each fold remembers whether it was left open, on this
             machine, so a church that lives in Macros keeps it open. Edit sits
             inside: a key in the heading would open and close the fold. -->
        <details id="live-macros-wrap" class="collapse collapse-arrow bg-base-200 rounded rf-now-fold hidden">
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium"><i data-lucide="zap" class="w-4 h-4 opacity-70 shrink-0"></i> Macros <span id="live-macros-hidden-note" class="text-xs opacity-60 font-normal"></span></span>
          </summary>
          <div class="collapse-content flex flex-col gap-2">
            <div class="flex items-center justify-end gap-2">
              <button id="live-macros-edit" type="button" class="btn btn-chip" aria-pressed="false">Edit</button>
            </div>
            <!-- Said once, in words, because in this mode a tap does something
                 different from what the same tile did a second ago. -->
            <p id="live-macros-editing" class="hidden text-sm">Tap a macro to hide or show it. Nothing runs while you're editing.</p>
            <div id="live-macros" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3"></div>
          </div>
        </details>

        <!-- Folded, beside Looks (owner, 2026-10-03): Refrain runs beside
             ProPresenter, whose own clear keys are right there, so these are
             the spare set, not the first thing on the screen. Clear all is
             also in the menu's quick slides, two presses, on every screen. -->
        <details id="live-clear-wrap" class="collapse collapse-arrow bg-base-200 rounded rf-now-fold">
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium"><i data-lucide="x-octagon" class="w-4 h-4 opacity-70 shrink-0"></i> Clear</span>
          </summary>
          <div class="collapse-content">
          <!-- Across the top of the bank whenever the LINK lamp is dark. The
               keys stay live on purpose: a clear is the one thing an operator
               may still need, and it may land the moment the link comes back.
               The banner is there so nobody presses one believing it will. -->
          <div id="live-clear-offline" class="hidden rf-offline-banner" role="status">
            <span class="rf-offline-word">Offline</span>
            <span>ProPresenter isn't answering. A clear may not reach the screens.</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button class="btn btn-outline h-20 text-base" data-clear="all" data-arm="true"><span class="flex flex-col items-center gap-1"><i data-lucide="x-octagon" class="w-6 h-6"></i> Clear all</span></button>
            <button class="btn btn-outline h-20 text-base" data-clear="slide"><span class="flex flex-col items-center gap-1"><i data-lucide="type" class="w-6 h-6"></i> Slide</span></button>
            <button class="btn btn-outline h-20 text-base" data-clear="media"><span class="flex flex-col items-center gap-1"><i data-lucide="image" class="w-6 h-6"></i> Media</span></button>
            <button class="btn btn-outline h-20 text-base" data-clear="messages"><span class="flex flex-col items-center gap-1"><i data-lucide="message-square" class="w-6 h-6"></i> Messages</span></button>
          </div>
          </div>
        </details>

        <!-- Last: Looks change rarely here, and a macro usually switches the
             Look as part of what it does. -->
        <details id="live-looks-wrap" class="collapse collapse-arrow bg-base-200 rounded rf-now-fold hidden">
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium"><i data-lucide="layers" class="w-4 h-4 opacity-70 shrink-0"></i> Looks <span id="live-looks-count" class="text-xs opacity-60 font-normal"></span></span>
          </summary>
          <div class="collapse-content"><div id="live-looks" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3"></div></div>
        </details>

        <!-- Flagging lives on the Flags screen, which has no live controls
             (handoff §39b): reaching it from here meant scrolling a thumb past
             every Clear, Look and Macro. One line keeps the count and the way. -->
        <div id="live-flag-summary"></div>

        <div id="live-status" class="text-sm opacity-70"></div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    readoutEl = document.getElementById("live-readout");
    mountLiveReadout(readoutEl);
    startPreview();
    mountLiveFlagSummary(document.getElementById("live-flag-summary"));
    refreshLiveSummaryOnNewFlags("live-flag-summary");

    wireClearButtons();
    rememberFolds();
    loadSafeSlides();
    wireStageMessage();
    document.getElementById("live-safe-edit")?.addEventListener("click", () => {
      editingSafe = !editingSafe;
      paintSafeSlides();
    });
    wirePerformanceMode();
    paintClearOffline(lastKnownConnected());

    try {
      const { looks, macros, messages, messageRecent: recent, currentLook } = await fetch("/api/live/controls").then((r) => r.json());
      messageRecent = recent ?? {};
      renderMessages(messages ?? []);
      renderButtons("live-looks", "live-looks-wrap", looks, "look");
      lookCount = looks?.length ?? 0;
      paintCurrentLook(currentLook);
      // A Look changes on a Look press, and often on a macro press too.
      document.getElementById("live-looks")?.addEventListener("click", (e) => e.target.closest("[data-look]") && setTimeout(refreshCurrentLook, 400));
      document.getElementById("live-macros")?.addEventListener("click", (e) => !editingMacros && e.target.closest("[data-macro]") && setTimeout(refreshCurrentLook, 600));
      macroList = macros ?? [];
      paintMacros();
      document.getElementById("live-macros-edit")?.addEventListener("click", () => {
        editingMacros = !editingMacros;
        paintMacros();
      });
      if (!looks.length && !macros.length) {
        setStatus("No Looks or Macros found.");
      }
    } catch {
      setStatus("Couldn't load Looks and Macros from ProPresenter. Clear still works.");
    }
  }

  // The message poster. Only messages with a fillable text token can be
  // posted from here, so timer-only messages are left out. When several
  // qualify, a small picker chooses between them.
  function renderMessages(messages) {
    messageList = messages ?? [];
    const all = messageList.filter((m) => !m.hidden);
    renderedMessageKey = messageKey(messageList);
    const postable = all.filter((m) => m.tokens?.some((t) => t.kind === "text"));
    const plain = all.filter((m) => !postable.includes(m));
    const wrap = document.getElementById("live-message-wrap");
    // Shown while any message exists, even with all of them hidden, so the
    // Edit that brings them back is still there.
    if (!messageList.length) return;
    wrap.classList.remove("hidden");
    paintMessageEdit();
    wireMessageEdit();
    const poster = document.getElementById("live-message-poster");
    renderPlainMessages(editingMessages ? [] : plain);
    poster.classList.toggle("hidden", editingMessages || !postable.length);
    if (editingMessages || !postable.length) return;

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
        .map((t) => {
          // Recent values fill the field; they never post. Posting stays the
          // one deliberate press, so a mis-tap on an old code costs nothing.
          const recent = messageRecent[m.id]?.[t.name] ?? [];
          const chips = recent.length
            ? `<div class="flex flex-wrap gap-1 mt-1">${recent
                .map((v) => `<button type="button" class="btn btn-chip live-message-recent" data-token="${escapeHtml(t.name)}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`)
                .join("")}</div>`
            : "";
          return `
        <label class="form-control">
          <div class="label py-0"><span class="label-text text-xs opacity-70">${escapeHtml(t.name)}</span></div>
          <input class="input input-bordered live-message-token" data-token="${escapeHtml(t.name)}" placeholder="Type the message..." />
        </label>${chips}`;
        })
        .join("");
      fields.querySelectorAll(".live-message-recent").forEach((chip) =>
        chip.addEventListener("click", () => {
          const input = [...fields.querySelectorAll(".live-message-token")].find((i) => i.dataset.token === chip.dataset.token);
          if (input) {
            input.value = chip.dataset.value;
            input.focus();
          }
        })
      );
    }

    select.addEventListener("change", renderFields);
    renderFields();

    postBtn.addEventListener("click", async () => {
      const m = selected();
      const values = [...fields.querySelectorAll(".live-message-token")].map((inp) => ({ name: inp.dataset.token, text: inp.value }));
      const answer = await fire(postBtn, "/api/live/message", { id: m.id, values }, "Post");
      if (answer) {
        // The recents the server just saved, for next time. The fields aren't
        // re-rendered under the operator's hands.
        if (answer.recent) messageRecent = { ...messageRecent, [m.id]: answer.recent };
        setStatus(`On screen: ${m.name}.`);
      }
    });
    clearBtn.addEventListener("click", () => fire(clearBtn, "/api/live/message-clear", { id: selected().id }, "Clear message"));

    wrap.classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * One row per message that has nothing to fill in: its name, what it says
   * now, whether it's on screen, and Show / Take down. After a press the list
   * is re-read, so "On screen" reflects what ProPresenter says, not a guess.
   */
  function renderPlainMessages(plain) {
    const host = document.getElementById("live-message-plain");
    if (!host) return;
    host.innerHTML = plainMessagesHtml(plain);
    // The fold: hidden when there's nothing in it; its heading counts them
    // and says when one is on screen, since a closed fold would hide that.
    const list = plain ?? [];
    const onScreen = list.filter((m) => m.active).length;
    document.getElementById("live-message-plain-wrap")?.classList.toggle("hidden", !list.length);
    const count = document.getElementById("live-message-plain-count");
    if (count) count.textContent = list.length ? `(${list.length})${onScreen ? ` · ${onScreen} on screen` : ""}` : "";
    host.querySelectorAll("[data-message-show]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await fire(btn, "/api/live/message", { id: btn.dataset.messageShow, values: [] }, "Show message");
        refreshMessages();
      })
    );
    host.querySelectorAll("[data-message-hide]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        await fire(btn, "/api/live/message-clear", { id: btn.dataset.messageHide }, "Take down message");
        refreshMessages();
      })
    );
  }

  // Which messages were drawn, and which had fields. If that changes in
  // ProPresenter (one added, removed, or given a field), the poster and the
  // list both need rebuilding, so Live redraws itself; otherwise only the
  // rows' "On screen" state is updated.
  let renderedMessageKey = "";
  const messageKey = (list) => (list ?? []).map((m) => `${m.id}:${m.tokens?.some((t) => t.kind === "text") ? 1 : 0}:${m.hidden ? 1 : 0}`).join("|");
  async function refreshMessages() {
    try {
      const { messages } = await fetch("/api/live/controls").then((r) => r.json());
      if (messageKey(messages) !== renderedMessageKey) return render();
      if (editingMessages) return;
      renderPlainMessages((messages ?? []).filter((m) => !m.hidden && !m.tokens?.some((t) => t.kind === "text")));
    } catch {
      // Leave the list as it was; the next visit re-reads it.
    }
  }

  let messageRecent = {};
  let lookCount = 0;

  /**
   * Edit on the Messages heading: every ProPresenter message as a row with
   * Keep here / Hide. Saved per machine (liveModule.hiddenMessages); a hidden
   * message leaves Now and the phone, and stays in ProPresenter.
   */
  let messageList = [];
  let editingMessages = false;
  function paintMessageEdit() {
    const edit = document.getElementById("live-messages-edit");
    const note = document.getElementById("live-messages-hidden-note");
    const line = document.getElementById("live-messages-editing");
    const list = document.getElementById("live-messages-edit-list");
    if (!edit) return;
    const hiddenCount = messageList.filter((m) => m.hidden).length;
    note.textContent = hiddenCount && !editingMessages ? `${hiddenCount} hidden` : "";
    edit.textContent = editingMessages ? "Done" : "Edit";
    edit.setAttribute("aria-pressed", String(editingMessages));
    line.classList.toggle("hidden", !editingMessages);
    list.classList.toggle("hidden", !editingMessages);
    list.innerHTML = editingMessages
      ? messageList
          .map(
            (m) => `<div class="flex items-center justify-between gap-2 bg-base-200 rounded p-2${m.hidden ? " opacity-60" : ""}">
          <span class="min-w-0 truncate">${escapeHtml(m.name)}</span>
          <span class="rf-tabs shrink-0" role="radiogroup" aria-label="${escapeHtml(m.name)}" style="margin-bottom:0">
            <button type="button" role="radio" class="rf-tab live-message-vis" data-id="${escapeHtml(m.id)}" data-hidden="false" aria-checked="${!m.hidden}"><span>Show here</span></button>
            <button type="button" role="radio" class="rf-tab live-message-vis" data-id="${escapeHtml(m.id)}" data-hidden="true" aria-checked="${Boolean(m.hidden)}"><span>Hide</span></button>
          </span>
        </div>`
          )
          .join("")
      : "";
    list.querySelectorAll(".live-message-vis").forEach((b) =>
      b.addEventListener("click", async () => {
        const hidden = b.dataset.hidden === "true";
        try {
          const res = await fetch("/api/live/visibility", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "message", id: b.dataset.id, hidden }) });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? res.statusText);
          const set = new Set(data.hiddenMessages ?? []);
          messageList = messageList.map((m) => ({ ...m, hidden: set.has(m.id) }));
          renderedMessageKey = messageKey(messageList);
          paintMessageEdit();
        } catch (err) {
          setStatus(`Couldn't save that: ${err.message}`);
        }
      })
    );
  }
  // Wired once per drawing of Now (the key is new each time Now is drawn).
  // Done redraws Now rather than re-running the poster's setup here, which
  // would give Post a second click handler and post twice.
  function wireMessageEdit() {
    const edit = document.getElementById("live-messages-edit");
    if (!edit || edit.dataset.wired) return;
    edit.dataset.wired = "1";
    edit.addEventListener("click", () => {
      editingMessages = !editingMessages;
      if (!editingMessages) return render();
      paintMessageEdit();
      renderPlainMessages([]);
      document.getElementById("live-message-poster")?.classList.add("hidden");
    });
  }

  /**
   * Which Look is on, in the folded heading and on its tile, so a tap on the
   * neighbouring one is visible. Matched by name: ProPresenter reports the
   * live Look under a different id from the list's.
   */
  function paintCurrentLook(current) {
    const count = document.getElementById("live-looks-count");
    const name = current?.name ?? null;
    // The Look's name is the operator's own, so it keeps its own case: the
    // subhead's uppercase applies to the heading, not to their name.
    if (count && lookCount) count.innerHTML = `(${lookCount})${name ? ` · <span class="rf-looks-current">Current: ${escapeHtml(name)}</span>` : ""}`;
    document.querySelectorAll("#live-looks [data-look]").forEach((btn) => {
      const on = Boolean(name) && btn.title === name;
      btn.classList.toggle("rf-tile-current", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }

  async function refreshCurrentLook() {
    try {
      paintCurrentLook((await fetch("/api/live/current-look").then((r) => r.json())).currentLook);
    } catch {
      // Keep what's shown; the next visit re-reads it.
    }
  }
  /**
   * The stage message card. Presets are one press each and the one that's up
   * stays latched; typed text goes up with Show. Edit turns the keys into
   * rows to reword, reorder or remove, and Show into Add.
   */
  let stagePresets = [];
  let stageCurrent = "";
  let editingStage = false;
  let stageTimer = null;
  async function wireStageMessage() {
    const edit = document.getElementById("live-stage-edit");
    const text = document.getElementById("live-stage-text");
    const show = document.getElementById("live-stage-show");
    const clear = document.getElementById("live-stage-clear");
    if (!edit) return;
    edit.addEventListener("click", () => {
      editingStage = !editingStage;
      paintStage();
    });
    show.addEventListener("click", async () => {
      if (editingStage) {
        const res = await fetch("/api/live/stage-messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.value }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return setStatus(`Couldn't add it: ${data.error ?? res.statusText}`);
        stagePresets = data.presets ?? stagePresets;
        text.value = "";
        return paintStage();
      }
      const answer = await fire(show, "/api/live/stage-message", { text: text.value }, "Stage message");
      if (answer) {
        stageCurrent = answer.current ?? "";
        text.value = "";
        paintStage();
      }
    });
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter") show.click();
    });
    clear.addEventListener("click", async () => {
      if (await fire(clear, "/api/live/stage-message/clear", {}, "Take down")) {
        stageCurrent = "";
        paintStage();
      }
    });
    try {
      const data = await fetch("/api/live/stage-message?fresh=1").then((r) => r.json());
      stagePresets = data.presets ?? [];
      stageCurrent = data.current ?? "";
    } catch {
      /* painted empty below */
    }
    paintStage();
    // A phone, or ProPresenter itself, can change the stage message; check
    // every 10s while Now is on screen, so "On stage now" stays true. The
    // server reads ProPresenter at most that often however many ask.
    clearInterval(stageTimer);
    stageTimer = setInterval(async () => {
      if (!document.getElementById("live-stage") || container.classList.contains("hidden")) return clearInterval(stageTimer);
      if (document.hidden || editingStage) return;
      try {
        const data = await fetch("/api/live/stage-message").then((r) => r.json());
        if ((data.current ?? "") !== stageCurrent) {
          stageCurrent = data.current ?? "";
          paintStage();
        }
      } catch {
        /* keep what's shown */
      }
    }, 10_000);
  }

  function paintStage() {
    const grid = document.getElementById("live-stage");
    if (!grid) return;
    const edit = document.getElementById("live-stage-edit");
    edit.textContent = editingStage ? "Done" : "Edit";
    edit.setAttribute("aria-pressed", String(editingStage));
    document.getElementById("live-stage-show").textContent = editingStage ? "Add" : "Show";
    document.getElementById("live-stage-clear").classList.toggle("hidden", editingStage);
    document.getElementById("live-stage-text").placeholder = editingStage ? "A new message to keep" : "Say something else";
    document.getElementById("live-stage-now").textContent = stageCurrent ? `On stage now: "${stageCurrent}"` : "Nothing on stage.";
    if (editingStage) {
      grid.innerHTML = stagePresets
        .map(
          (m, i) => `<div class="flex items-center gap-1 col-span-full" data-stage-row="${escapeHtml(m.id)}">
          <input class="input input-bordered input-sm flex-1 live-stage-name" maxlength="80" value="${escapeHtml(m.text)}" aria-label="Stage message" />
          <button type="button" class="btn btn-chip live-stage-move" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move earlier">↑</button>
          <button type="button" class="btn btn-chip live-stage-move" data-dir="1" ${i === stagePresets.length - 1 ? "disabled" : ""} aria-label="Move later">↓</button>
          <button type="button" class="btn btn-chip live-stage-remove">Remove</button>
        </div>`
        )
        .join("");
      const change = async (id, body) => {
        const res = await fetch(`/api/live/stage-messages/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return setStatus(`Couldn't save that: ${data.error ?? res.statusText}`);
        stagePresets = data.presets ?? stagePresets;
        paintStage();
      };
      grid.querySelectorAll("[data-stage-row]").forEach((row) => {
        const id = row.dataset.stageRow;
        row.querySelector(".live-stage-name").addEventListener("change", (e) => change(id, { action: "edit", text: e.target.value }));
        row.querySelectorAll(".live-stage-move").forEach((b) => b.addEventListener("click", () => change(id, { action: "move", dir: Number(b.dataset.dir) })));
        row.querySelector(".live-stage-remove").addEventListener("click", () => change(id, { action: "remove" }));
      });
      return;
    }
    grid.innerHTML = stagePresets.length
      ? stagePresets
          .map((m) => `<button type="button" class="btn btn-outline h-16 text-base live-stage-key" data-stage="${escapeHtml(m.id)}" aria-pressed="${m.text === stageCurrent}"><span class="truncate">${escapeHtml(m.text)}</span></button>`)
          .join("")
      : `<p class="text-sm opacity-70 col-span-full">No saved messages. Press Edit to add some.</p>`;
    grid.querySelectorAll(".live-stage-key").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const answer = await fire(btn, "/api/live/stage-message", { presetId: btn.dataset.stage }, "Stage message");
        if (answer) {
          stageCurrent = answer.current ?? "";
          paintStage();
        }
      })
    );
  }

  /**
   * Each fold on Now opens as it was last left, on this machine (browser
   * storage, a convenience: if it's unavailable they open closed).
   */
  function rememberFolds() {
    container.querySelectorAll("details.rf-now-fold[id]").forEach((d) => {
      const key = `refrain.fold.${d.id}`;
      try {
        d.open = localStorage.getItem(key) === "open";
      } catch {
        /* closed */
      }
      d.addEventListener("toggle", () => {
        try {
          localStorage.setItem(key, d.open ? "open" : "closed");
        } catch {
          /* not remembered */
        }
      });
    });
  }

  let safeList = [];
  let editingSafe = false;

  async function loadSafeSlides() {
    try {
      safeList = (await fetch("/api/live/safe-slides").then((r) => r.json())).safeSlides ?? [];
    } catch {
      safeList = [];
    }
    paintSafeSlides();
  }

  /**
   * One press each, no arm step: a safe slide is safe by definition. It fires
   * through the same route as Search's Go Live, by the slide's anchor, and
   * with requireAnchor, so a deck that changed refuses rather than putting
   * up whatever now sits at that number. Edit renames, reorders and removes;
   * nothing fires while editing.
   */
  function paintSafeSlides() {
    const grid = document.getElementById("live-safe");
    const edit = document.getElementById("live-safe-edit");
    if (!grid) return;
    edit.classList.toggle("hidden", !safeList.length);
    edit.textContent = editingSafe ? "Done" : "Edit";
    edit.setAttribute("aria-pressed", String(editingSafe));
    if (!safeList.length) {
      editingSafe = false;
      grid.innerHTML = `<p class="text-sm opacity-70 col-span-full">None yet. When a slide worth keeping is up (the logo, a blank), press <strong>Keep as safe slide</strong> under the Now picture.</p>`;
    } else if (editingSafe) {
      grid.innerHTML = safeList
        .map(
          (sl, i) => `
        <div class="flex items-center gap-1 col-span-full" data-safe-row="${escapeHtml(sl.id)}">
          <input class="input input-bordered input-sm flex-1 live-safe-name" maxlength="40" value="${escapeHtml(sl.label)}" aria-label="Name for this safe slide" />
          <button type="button" class="btn btn-chip live-safe-move" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move earlier">↑</button>
          <button type="button" class="btn btn-chip live-safe-move" data-dir="1" ${i === safeList.length - 1 ? "disabled" : ""} aria-label="Move later">↓</button>
          <button type="button" class="btn btn-chip live-safe-remove">Remove</button>
        </div>`
        )
        .join("");
    } else {
      grid.innerHTML = safeList
        .map(
          (sl) => `<button type="button" class="btn btn-outline h-16 text-base live-safe-key" data-safe="${escapeHtml(sl.id)}" title="${escapeHtml(sl.presentationName ?? "")}, slide ${sl.slideIndex + 1}"><span class="flex items-center gap-2 min-w-0"><i data-lucide="shield-check" class="w-5 h-5 shrink-0"></i><span class="truncate">${escapeHtml(sl.label)}</span></span></button>`
        )
        .join("");
    }
    if (window.lucide) window.lucide.createIcons();

    grid.querySelectorAll(".live-safe-key").forEach((btn) => {
      const sl = safeList.find((x) => x.id === btn.dataset.safe);
      btn.addEventListener("click", async () => {
        const ok = await fire(
          btn,
          "/api/trigger",
          { presentationId: sl.presentationId, slideIndex: sl.slideIndex, groupId: sl.groupId, groupOffset: sl.groupOffset, slideText: sl.slideText ?? "", requireAnchor: true },
          sl.label
        );
        if (ok) setStatus(`On screen: ${sl.label}.`);
      });
    });
    const change = async (id, body) => {
      try {
        const res = await fetch(`/api/live/safe-slides/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        safeList = data.safeSlides ?? [];
        document.dispatchEvent(new CustomEvent("refrain:safe-slides-changed"));
      } catch (err) {
        setStatus(`That wasn't saved: ${err.message}`);
      }
      paintSafeSlides();
    };
    grid.querySelectorAll("[data-safe-row]").forEach((row) => {
      const id = row.dataset.safeRow;
      row.querySelector(".live-safe-name").addEventListener("change", (e) => change(id, { action: "rename", label: e.target.value }));
      row.querySelectorAll(".live-safe-move").forEach((b) => b.addEventListener("click", () => change(id, { action: "move", dir: Number(b.dataset.dir) })));
      row.querySelector(".live-safe-remove").addEventListener("click", () => change(id, { action: "remove" }));
    });
  }

  function renderButtons(gridId, wrapId, items, kind) {
    if (!items?.length) return;
    const grid = document.getElementById(gridId);
    grid.innerHTML = items.map((it) => tileHtml(it, kind)).join("");
    document.getElementById(wrapId).classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
    grid.querySelectorAll(`[data-${kind}]`).forEach((btn) =>
      btn.addEventListener("click", () => fire(btn, `/api/live/${kind}`, { id: btn.dataset[kind] }, btn.textContent.trim()))
    );
  }

  /**
   * The macro bank, with the church's hidden ones put away (handoff §39f).
   * Edit turns every tile into a hide/show toggle and shows the hidden ones
   * marked as such. While editing, a tap never runs a macro: the fire path is
   * not wired at all in that mode, rather than guarded inside it.
   */
  let macroList = [];
  let editingMacros = false;
  function paintMacros() {
    const wrap = document.getElementById("live-macros-wrap");
    const grid = document.getElementById("live-macros");
    const note = document.getElementById("live-macros-hidden-note");
    const edit = document.getElementById("live-macros-edit");
    const editingLine = document.getElementById("live-macros-editing");
    if (!wrap || !grid) return;
    if (!macroList.length) return wrap.classList.add("hidden");
    wrap.classList.remove("hidden");
    const { shown, hiddenCount } = macroBank(macroList, editingMacros);
    note.textContent = hiddenCount && !editingMacros ? `${hiddenCount} hidden` : "";
    edit.textContent = editingMacros ? "Done" : "Edit";
    edit.setAttribute("aria-pressed", String(editingMacros));
    editingLine.classList.toggle("hidden", !editingMacros);
    grid.innerHTML = shown.length
      ? shown.map((it) => tileHtml(it, "macro", editingMacros && it.hidden ? "rf-tile-put-away" : "")).join("")
      : `<p class="text-sm opacity-70 col-span-full">All ${macroList.length} macros are hidden. Edit to bring some back.</p>`;
    if (window.lucide) window.lucide.createIcons();
    grid.querySelectorAll("[data-macro]").forEach((btn) => {
      const item = macroList.find((m) => m.id === btn.dataset.macro);
      if (editingMacros) {
        btn.setAttribute("aria-pressed", String(!item?.hidden));
        btn.title = `${item?.name ?? ""}: ${item?.hidden ? "hidden. Tap to show." : "shown. Tap to hide."}`;
        btn.addEventListener("click", () => toggleMacro(btn, item));
      } else {
        btn.addEventListener("click", () => fire(btn, "/api/live/macro", { id: btn.dataset.macro }, btn.textContent.trim()));
      }
    });
  }

  async function toggleMacro(btn, item) {
    if (!item) return;
    btn.disabled = true;
    try {
      const res = await fetch("/api/live/visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "macro", id: item.id, hidden: !item.hidden }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      const hidden = new Set(data.hiddenMacros ?? []);
      macroList = macroList.map((m) => ({ ...m, hidden: hidden.has(m.id) }));
    } catch (err) {
      setStatus(`That wasn't saved: ${err.message}`);
    }
    paintMacros();
  }

  // One tile, for a Look or a Macro.
  function tileHtml(it, kind, extraClass = "") {
    return (
        // No size class here. `h-20` used to be, and it never did anything:
        // it is applied from this template string only, so Tailwind's runtime
        // scanner never saw it at boot and generated no rule (see CLAUDE.md on
        // JS-applied classes needing a static home). The bank has therefore
        // always rendered at the Tier 3 floor, which is what it should look
        // like -- 34 tiles at 80px would be a very long screen. Removed rather
        // than given a home, so the code stops implying an intent that is not
        // happening.
        // The name goes in a span so it can be clamped to two lines, and the
        // full name goes in `title` so nothing is ever lost -- no abbreviating
        // and no case transform, because the operator named these in
        // ProPresenter and Refrain does not restyle a name its user wrote.
        // Macros carry the icon the operator chose for them in ProPresenter
        // (`image_type`), which makes a bank of 26 mono labels scannable by
        // shape instead of by reading every one under pressure. Looks have no
        // equivalent and simply render without one, so the markup has to work
        // either way rather than reserving a gap.
      `<button class="btn rf-tile${extraClass ? ` ${extraClass}` : ""}" data-${kind}="${escapeHtml(it.id)}" title="${escapeHtml(it.name)}">${
            // The macro's own colour, as ProPresenter shows it. Printed ink,
            // never lit: a flat swatch and a lit collar are different objects,
            // so even a red macro cannot be read as the live signal. No colour
            // means no swatch — an invented grey would be a classification the
            // operator never chose.
            it.color ? `<span class="rf-tile-swatch" style="background:${escapeHtml(it.color)}"></span>` : ""
          }${
            it.icon ? `<i data-lucide="${escapeHtml(it.icon)}" class="rf-tile-icon"></i>` : ""
      }<span class="rf-tile-label">${escapeHtml(it.name)}</span></button>`
    );
  }

  // Clear All takes everything off every screen, so it arms on the first
  // press and fires on a second within ARM_MS. The armed label says so in
  // words, because a nervous volunteer should not have to guess why nothing
  // happened. At rest it is an outline key like its neighbours; only armed
  // does it take the brand collar, so the loudest key on Live is the one
  // waiting on you. (.btn-brand has a static rule in refrain.css, so the
  // JIT note in CLAUDE.md does not bite.) The single-layer clears stay one
  // press.
  const ARM_MS = 3000;
  function wireClearButtons() {
    container.querySelectorAll("[data-clear]").forEach((btn) => {
      const label = btn.textContent.trim();
      const idleHtml = btn.innerHTML;
      let disarmTimer = null;
      const disarm = () => {
        clearTimeout(disarmTimer);
        disarmTimer = null;
        btn.classList.replace("btn-brand", "btn-outline");
        btn.innerHTML = idleHtml;
        if (window.lucide) window.lucide.createIcons();
      };
      btn.addEventListener("click", () => {
        if (btn.dataset.arm === "true" && !disarmTimer) {
          btn.classList.replace("btn-outline", "btn-brand");
          btn.innerHTML = `<span class="flex flex-col items-center gap-1"><i data-lucide="x-octagon" class="w-6 h-6"></i> Press again to clear</span>`;
          if (window.lucide) window.lucide.createIcons();
          disarmTimer = setTimeout(disarm, ARM_MS);
          return;
        }
        if (disarmTimer) disarm();
        fire(btn, "/api/live/clear", { layer: btn.dataset.clear }, label);
      });
    });
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
        return false;
      }
      // The server's answer, for callers that need it; truthy either way.
      return (await res.json().catch(() => null)) ?? {};
    } catch (err) {
      setStatus(`${label} failed: ${err.message}`);
      return false;
    } finally {
      btn.disabled = false;
    }
  }

  // Null means no check has come back yet: say nothing rather than guess.
  function paintClearOffline(connected) {
    document.getElementById("live-clear-offline")?.classList.toggle("hidden", connected !== false);
  }
  window.addEventListener(LINK_EVENT, (e) => paintClearOffline(e.detail.connected));

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
