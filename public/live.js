import { mountLiveFlagSummary, refreshLiveSummaryOnNewFlags } from "./slide-flags.js";

/**
 * Live page — big, obvious controls for the operator during a service.
 *
 * In the order of need: a staff request waiting for approval, the message
 * poster (a pager code, with a Clear that takes only that message off), the
 * stage messages, then the folds that can wait (what is on screen, performance
 * mode, Macros, Looks), and the church's safe slides last. There is no
 * whole-screen Clear here; ProPresenter's own keys are beside this window.
 * One large button per Look and per Macro the church has in ProPresenter is
 * fetched live, so their own names show up with nothing hardcoded. Everything
 * is deliberately oversized and high-contrast: this screen is meant to be
 * usable at a glance from the back of a dark room.
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
        <div class="flex flex-wrap items-center justify-between gap-2">
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

/** Where Service day stands, for Now's row. Pure, for tests. */
export function dayRowText(day) {
  if (day?.dayEnded) return "Day ended";
  if (day?.checksDue?.length) return "Checks due";
  const n = day?.services?.length ?? 0;
  return n ? `${n} service${n === 1 ? "" : "s"} today` : "No services yet";
}

export function initLive() {
  const container = document.getElementById("view-live");

  /** Service day's row on Now: hidden when Service day is switched off. */
  async function paintDayRow() {
    const row = document.getElementById("live-day-row");
    const state = document.getElementById("live-day-state");
    if (!row || !state) return;
    if (document.documentElement.classList.contains("feature-off-service")) return row.classList.add("hidden");
    try {
      const res = await fetch("/api/service/day");
      if (!res.ok) return row.classList.add("hidden");
      state.textContent = dayRowText(await res.json());
    } catch {
      // The row stays, without a state; the Day screen is the source of truth.
    }
  }

  /**
   * Staff requests (server/staff-requests.js): messages from the announcement
   * app that wait here for someone to approve. One card each, with the words, who
   * sent it, a bar and a count of the time left (eight minutes), and two
   * answers. The ring moves for the first four seconds after a card first
   * appears and then holds still; nothing here posts without a press.
   */
  let requestsTimer = null;
  let requestsTick = null;
  const seenRequests = new Map(); // id -> when this window first saw it
  function wireRequests() {
    const host = document.getElementById("live-requests");
    clearInterval(requestsTimer);
    clearInterval(requestsTick);
    if (!host || document.documentElement.classList.contains("feature-off-requests")) return;
    let list = [];
    let skew = 0; // the server's clock minus this one's
    let problem = null;

    const left = (r) => Math.max(0, r.expiresAt - (Date.now() + skew));
    const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

    function paint() {
      const live = list.filter((r) => left(r) > 0);
      const key = `${problem ?? ""}#${live.map((r) => r.id).join("|")}`;
      if (host.dataset.key !== key) {
        host.dataset.key = key;
        host.innerHTML = (problem ? `<p class="rf-hint" role="status">${escapeHtml(problem)}</p>` : "") + live
          .map((r) => {
            if (!seenRequests.has(r.id)) seenRequests.set(r.id, Date.now());
            const fresh = Date.now() - seenRequests.get(r.id) < 4000;
            return `<div class="rf-req${fresh ? " arrive" : ""}" data-id="${escapeHtml(r.id)}" role="group" aria-label="Request from ${escapeHtml(r.from)}"><div class="rf-req-in">
              <div class="rf-req-top"><span class="rf-req-from">Request &middot; ${escapeHtml(r.from)}</span><span class="rf-req-left" data-left></span></div>
              <p class="rf-req-text">${escapeHtml(r.text)}</p>
              <div class="rf-req-life"><i data-bar></i></div>
              <div class="rf-req-acts"><button type="button" class="btn btn-brand" data-answer="approve">Post it</button><button type="button" class="btn btn-outline" data-answer="decline">Decline</button></div>
            </div></div>`;
          })
          .join("");
        // The ring settles four seconds after the card first showed.
        setTimeout(() => host.querySelectorAll(".rf-req.arrive").forEach((c) => c.classList.remove("arrive")), 4000);
      }
      host.querySelectorAll(".rf-req").forEach((card) => {
        const r = live.find((x) => x.id === card.dataset.id);
        if (!r) return;
        card.querySelector("[data-left]").textContent = clock(left(r));
        card.querySelector("[data-bar]").style.width = `${(left(r) / (r.expiresAt - r.createdAt)) * 100}%`;
      });
    }

    async function load() {
      try {
        const res = await fetch("/api/live/requests");
        if (!res.ok) {
          list = [];
          return paint();
        }
        const data = await res.json();
        skew = (data.now ?? Date.now()) - Date.now();
        list = data.requests ?? [];
        // Said where the cards would be, so a request that cannot arrive is not
        // mistaken for one nobody sent.
        problem = data.problem ?? (data.lastError ? `Staff requests aren't getting through: ${data.lastError}` : null);
        paint();
      } catch {
        // Keep what is shown; the next poll tries again.
      }
    }

    host.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-answer]");
      const card = btn?.closest(".rf-req");
      if (!btn || !card) return;
      const id = card.dataset.id;
      const approve = btn.dataset.answer === "approve";
      card.querySelectorAll("button").forEach((b) => (b.disabled = true));
      // Acknowledged in this frame, before the request is sent.
      btn.textContent = approve ? "Posting..." : "Declining...";
      try {
        const res = await fetch(`/api/live/requests/${encodeURIComponent(id)}/${approve ? "approve" : "decline"}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        list = list.filter((r) => r.id !== id);
        setStatus(approve ? "On screen: the request." : "Declined. The announcement app was told.");
      } catch (err) {
        // Still waiting, so the buttons come back (the server kept it).
        card.querySelectorAll("button").forEach((b) => (b.disabled = false));
        btn.textContent = approve ? "Post it" : "Decline";
        setStatus(`${approve ? "That didn't post" : "That wasn't declined"}: ${err.message}`);
      }
      host.dataset.key = "";
      paint();
      load();
    });

    load();
    requestsTimer = setInterval(() => (document.hidden || container.classList.contains("hidden") ? null : load()), 3000);
    requestsTick = setInterval(() => (container.classList.contains("hidden") ? null : paint()), 1000);
  }

  async function render() {
    container.innerHTML = `
      <div class="flex flex-col gap-4">
        <!-- The order is the order of need (owner, 2026-10-07): a staff request
             waiting, the message poster (the childcare code), the stage
             message, then everything that can wait. What is on the screens is
             the Live lamp's job and Settings > Status's readout now, not the
             top of this page. Clear is only the poster's Clear: ProPresenter's
             own clear keys are right beside this window. -->
        <div id="live-requests"></div>

        <div id="live-message-wrap" class="hidden">
          <div class="flex items-center justify-between gap-2">
            <h2 class="rf-subhead">Message to the screens</h2>
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
          <!-- The code, Post and Clear in one row. A pager code is a few
               characters, so this does not need half the screen. -->
          <div id="live-message-poster" class="rf-poster hidden">
            <select id="live-message-select" class="select select-bordered select-sm hidden" aria-label="Which message"></select>
            <div class="rf-poster-row">
              <div id="live-message-fields" class="rf-poster-fields"></div>
              <button id="live-message-post" class="btn btn-brand rf-poster-btn" title="Put this message on the screens">Post</button>
              <button id="live-message-clear" class="btn btn-outline rf-poster-btn" title="Takes this message off the screens. Nothing else is cleared.">Clear</button>
            </div>
          </div>
          <!-- Messages with no fill-in field (countdowns): Show and Take down,
               with what each says and whether it's up. Folded, closed, under
               the pager (owner, 2026-10-04). Its heading says when one of them
               is on screen, so a running countdown isn't hidden by the fold. -->
          <details id="live-message-plain-wrap" class="collapse collapse-arrow bg-base-200 rounded rf-now-fold hidden mt-3">
            <summary class="collapse-title min-h-0 py-2">
              <span class="flex items-center gap-2 text-sm font-medium"><i data-lucide="timer" class="w-4 h-4 opacity-70 shrink-0"></i> Other messages <span id="live-message-plain-count" class="text-xs opacity-60 font-normal"></span></span>
            </summary>
            <div class="collapse-content"><div id="live-message-plain" class="flex flex-col gap-2"></div></div>
          </details>
        </div>

        <!-- Stage message (handoff section 44): a note only the people on
             stage see. One press, because the audience never sees it; it
             stays up until it is cleared, and the clear is always in the same
             place above the list. -->
        <div id="live-stage-wrap">
          <!-- Edit is a state of its own (as designed): the page becomes this list
               and nothing in it shows anything on a monitor. -->
          <div id="live-stage-editbar" class="rf-editbar hidden">
            <h2 class="rf-edit-title">Edit messages</h2>
            <button id="live-stage-done" type="button" class="rf-chipbtn">Done</button>
          </div>
          <p id="live-stage-editrule" class="rf-edit-rule hidden">Up to 8 messages, 80 characters each. Drag to reorder.</p>
          <h2 class="rf-subhead" id="live-stage-head">Stage message</h2>
          <button id="live-stage-clear" type="button" class="btn btn-outline rf-stage-clear" disabled title="Nothing is on stage">Clear stage message</button>
          <p id="live-stage-now" class="rf-visually-hidden" role="status"></p>
          <div id="live-stage" class="rf-stage-list"></div>
          <p id="live-stage-editnote" class="rf-edit-note hidden" role="status"></p>
          <button id="live-stage-add" type="button" class="btn btn-outline rf-stage-row rf-stage-edit hidden">+ Add a message</button>
          <button id="live-stage-edit" type="button" class="btn btn-outline rf-stage-row rf-stage-edit" aria-pressed="false">Edit messages</button>
          <div class="rf-stage-custom">
            <input id="live-stage-text" class="input input-bordered flex-1 min-w-0" maxlength="80" placeholder="Say something else…" aria-label="Stage message to show" />
            <button id="live-stage-show" type="button" class="btn btn-outline">Show</button>
          </div>
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

        <!-- Last of the folds: Looks change rarely here, and a macro usually
             switches the Look as part of what it does. -->
        <details id="live-looks-wrap" class="collapse collapse-arrow bg-base-200 rounded rf-now-fold hidden">
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium"><i data-lucide="layers" class="w-4 h-4 opacity-70 shrink-0"></i> Looks <span id="live-looks-count" class="text-xs opacity-60 font-normal"></span></span>
          </summary>
          <div class="collapse-content"><div id="live-looks" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3"></div></div>
        </details>

        <!-- Flags and Service day, one row each with where they stand (owner,
             2026-10-07: no tab row; the Now page is the page, and these are
             the two places it leads to). -->
        <div class="flex flex-col gap-2">
          <div id="live-flag-summary"></div>
          <a id="live-day-row" class="rf-navrow" href="#service/service"><span class="rf-navrow-name">Service day</span><span class="rf-navrow-state" id="live-day-state"></span></a>
        </div>

        <div id="live-status" class="text-sm opacity-70"></div>

        <!-- Last (owner, 2026-10-07): up to four of the church's own safe
             slides as the slides themselves, a picture when slide pictures are
             on and the slide's words when they are off. Switched on in
             Settings > Features (off by default). -->
        <div id="live-safe-wrap">
          <div class="flex items-center justify-between gap-2">
            <h2 class="rf-subhead">Safe slides</h2>
            <button id="live-safe-edit" type="button" class="btn btn-chip hidden" aria-pressed="false">Edit</button>
          </div>
          <div id="live-safe" class="rf-safe-grid"></div>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    wireRequests();
    mountLiveFlagSummary(document.getElementById("live-flag-summary"));
    refreshLiveSummaryOnNewFlags("live-flag-summary");
    paintDayRow();

    rememberFolds();
    loadSafeSlides();
    wireStageMessage();
    document.getElementById("live-safe-edit")?.addEventListener("click", () => {
      editingSafe = !editingSafe;
      paintSafeSlides();
    });
    try {
      const { looks, macros, messages, currentLook, features = {} } = await fetch("/api/live/controls").then((r) => r.json());
      // Switched off on Settings › Features: the section isn't shown at all.
      // Looks and Macros hide by themselves with nothing to show; the stage
      // card is part of Messages.
      document.getElementById("live-stage-wrap")?.classList.toggle("hidden", features.messages === false);
      renderMessages(messages ?? []);
      renderButtons("live-looks", "live-looks-wrap", looks, "look");
      lookCount = looks?.length ?? 0;
      paintCurrentLook(currentLook);
      // A Look changes on a Look press, and often on a macro press too.
      document.getElementById("live-looks")?.addEventListener("click", (e) => e.target.closest("[data-look]") && setTimeout(refreshCurrentLook, 400));
      if (features.looks !== false) document.getElementById("live-macros")?.addEventListener("click", (e) => !editingMacros && e.target.closest("[data-macro]") && setTimeout(refreshCurrentLook, 600));
      macroList = macros ?? [];
      paintMacros();
      document.getElementById("live-macros-edit")?.addEventListener("click", () => {
        editingMacros = !editingMacros;
        paintMacros();
      });
      // Said only of what's switched on, and only when none of it came back.
      const asked = [features.looks !== false && "Looks", features.macros !== false && "Macros"].filter(Boolean);
      if (asked.length && !(looks?.length ?? 0) && !(macros?.length ?? 0)) setStatus(`No ${asked.join(" or ")} found.`);
    } catch {
      setStatus("Couldn't load Looks and Macros from ProPresenter.");
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
      const tokens = m.tokens.filter((t) => t.kind === "text");
      fields.innerHTML = tokens
        .map(
          (t) => `
        <label class="rf-poster-field">
          <span class="rf-poster-label">${escapeHtml(t.name)}</span>
          <input class="input input-bordered live-message-token" data-token="${escapeHtml(t.name)}" autocomplete="off" aria-label="${escapeHtml(t.name)}" />
        </label>`
        )
        .join("");
    }

    select.addEventListener("change", renderFields);
    renderFields();

    postBtn.addEventListener("click", async () => {
      const m = selected();
      const values = [...fields.querySelectorAll(".live-message-token")].map((inp) => ({ name: inp.dataset.token, text: inp.value }));
      const answer = await fire(postBtn, "/api/live/message", { id: m.id, values }, "Post");
      if (answer) {
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
      editingStage = true;
      paintStage();
    });
    document.getElementById("live-stage-done").addEventListener("click", () => {
      editingStage = false;
      paintStage();
    });
    document.getElementById("live-stage-add").addEventListener("click", () => {
      // A new row at the end to type into; saved on Enter or when you leave it
      // with words in it, dropped when you leave it empty.
      const list = document.getElementById("live-stage");
      if (list.querySelector("[data-stage-new]") || stagePresets.length >= STAGE_MAX) return;
      list.insertAdjacentHTML("beforeend", editRowHtml({ id: "", text: "" }, true));
      const row = list.querySelector("[data-stage-new]");
      const input = row.querySelector("input");
      input.focus();
      wireEditRow(row);
    });
    // Leaving the page leaves the editor: nothing should come back mid-edit.
    window.addEventListener("hashchange", () => {
      if (editingStage && !location.hash.startsWith("#service/live") && location.hash !== "#service") {
        editingStage = false;
        paintStage();
      }
    });
    show.addEventListener("click", async () => {
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
    // Messages switched off (main.js marks <html>): no card, no request.
    if (document.documentElement.classList.contains("feature-off-messages")) {
      document.getElementById("live-stage-wrap")?.classList.add("hidden");
      return;
    }
    try {
      const res = await fetch("/api/live/stage-message?fresh=1");
      const data = await res.json();
      // Messages switched off (Settings › Features): no card, and no checking.
      if (data.off) {
        document.getElementById("live-stage-wrap")?.classList.add("hidden");
        return;
      }
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

  const STAGE_MAX = 8;
  const STAGE_TEXT_MAX = 80;

  /** One row of the editor: a handle, the words, how many of 80 used, and remove. */
  function editRowHtml(m, isNew = false) {
    return `<div class="rf-erow" ${isNew ? "data-stage-new" : `data-stage-row="${escapeHtml(m.id)}"`} draggable="${isNew ? "false" : "true"}">
      <button type="button" class="rf-erow-grab" aria-label="Move ${escapeHtml(m.text || "this message")} (arrow keys, or drag)" tabindex="${isNew ? -1 : 0}">\u22ee\u22ee</button>
      <input class="rf-erow-text live-stage-name" value="${escapeHtml(m.text)}" aria-label="Stage message" autocomplete="off" spellcheck="false" />
      <span class="rf-erow-count">${[...m.text].length}/${STAGE_TEXT_MAX}</span>
      <button type="button" class="rf-erow-x" aria-label="Remove ${escapeHtml(m.text || "this message")}">\u2715</button>
    </div>`;
  }

  async function changeStage(id, body) {
    const res = await fetch(`/api/live/stage-messages/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setStatus(`Couldn't save that: ${data.error ?? res.statusText}`);
    stagePresets = data.presets ?? stagePresets;
    paintStage();
  }

  function wireEditRow(row) {
    const id = row.dataset.stageRow;
    const input = row.querySelector("input");
    const count = row.querySelector(".rf-erow-count");
    const note = document.getElementById("live-stage-editnote");
    const over = () => [...input.value.trim()].length > STAGE_TEXT_MAX;
    input.addEventListener("input", () => {
      const n = [...input.value.trim()].length;
      count.textContent = `${n}/${STAGE_TEXT_MAX}`;
      row.classList.toggle("rf-erow-over", n > STAGE_TEXT_MAX);
      // What was typed is kept; it just is not saved while it is too long.
      note.textContent = n > STAGE_TEXT_MAX ? `That message is ${n} characters. The limit is ${STAGE_TEXT_MAX}.` : "";
    });
    if (!id) {
      // The new row: Enter or leaving it with words adds it; leaving it empty drops it.
      const finish = async () => {
        if (!row.isConnected) return;
        if (over()) return;
        if (!input.value.trim()) return row.remove();
        const res = await fetch("/api/live/stage-messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: input.value }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return setStatus(`Couldn't add it: ${data.error ?? res.statusText}`);
        stagePresets = data.presets ?? stagePresets;
        paintStage();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") {
          input.value = "";
          input.blur();
        }
      });
      input.addEventListener("blur", finish);
      row.querySelector(".rf-erow-x").addEventListener("click", () => row.remove());
      return;
    }
    input.addEventListener("change", () => {
      if (over()) return;
      changeStage(id, { action: "edit", text: input.value });
    });
    row.querySelector(".rf-erow-x").addEventListener("click", () => changeStage(id, { action: "remove" }));
    // Keyboard: the handle moves it a place with the arrow keys.
    row.querySelector(".rf-erow-grab").addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        changeStage(id, { action: "move", dir: e.key === "ArrowUp" ? -1 : 1 });
      }
    });
    // Mouse and touch: drag the row to the place it should take.
    row.addEventListener("dragstart", (e) => {
      row.classList.add("rf-erow-drag");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    });
    row.addEventListener("dragend", () => row.classList.remove("rf-erow-drag"));
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = e.dataTransfer.getData("text/plain");
      const to = stagePresets.findIndex((m) => m.id === id);
      if (from && from !== id && to >= 0) changeStage(from, { action: "place", to });
    });
  }

  function paintStage() {
    const grid = document.getElementById("live-stage");
    if (!grid) return;
    const edit = document.getElementById("live-stage-edit");
    // The editor replaces the whole page (CSS, on `stage-editing`), so a mistake
    // while customising cannot put words on a monitor.
    document.documentElement.classList.toggle("stage-editing", editingStage);
    edit.classList.toggle("hidden", editingStage);
    for (const id of ["live-stage-editbar", "live-stage-editrule", "live-stage-add", "live-stage-editnote"]) document.getElementById(id).classList.toggle("hidden", !editingStage);
    document.getElementById("live-stage-head").classList.toggle("hidden", editingStage);
    document.getElementById("live-stage-add").textContent = `+ Add a message \u00b7 ${stagePresets.length} of ${STAGE_MAX}`;
    document.getElementById("live-stage-add").disabled = stagePresets.length >= STAGE_MAX;
    // Always in the same place above the list; dimmed when nothing is up and
    // lit when something is, so the operator never has to read to know.
    const clearBtn = document.getElementById("live-stage-clear");
    clearBtn.classList.toggle("hidden", editingStage);
    clearBtn.disabled = !stageCurrent;
    clearBtn.classList.toggle("ready", Boolean(stageCurrent));
    clearBtn.title = stageCurrent ? "Takes the message off the stage screens" : "Nothing is on stage";
    document.querySelector(".rf-stage-custom").classList.toggle("hidden", editingStage);
    document.getElementById("live-stage-now").textContent = stageCurrent ? `On stage now: "${stageCurrent}"` : "Nothing on stage.";
    if (editingStage) {
      grid.innerHTML = stagePresets.map((m) => editRowHtml(m)).join("");
      grid.querySelectorAll("[data-stage-row]").forEach(wireEditRow);
      return;
    }
    grid.innerHTML = stagePresets.length
      ? stagePresets
          // One line each, the whole width. A long one ends in an ellipsis and
          // the full words are in the title; 80 characters is the limit.
          .map((m) => `<button type="button" class="btn btn-outline rf-stage-row live-stage-key" data-stage="${escapeHtml(m.id)}" aria-pressed="${m.text === stageCurrent}" title="${escapeHtml(m.text)}"><span class="rf-stage-text">${escapeHtml(m.text)}</span></button>`)
          .join("")
      : `<p class="text-sm opacity-70">No saved messages. Press Edit messages to add some.</p>`;
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
  let safePictures = false;
  let editingSafe = false;
  // The page shows the first four, and no more can be kept than that. A list
  // saved when eight were allowed still reads whole in Edit, so nothing is
  // dropped behind anyone's back.
  const SAFE_SHOWN = 4;
  const SAFE_MAX = 4;

  const safeOff = () => document.documentElement.classList.contains("feature-off-safe-slides");

  async function loadSafeSlides() {
    if (safeOff()) return;
    try {
      const data = await fetch("/api/live/safe-slides").then((r) => r.json());
      safeList = data.safeSlides ?? [];
      safePictures = Boolean(data.pictures);
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
  /** The way to add one: keep what is on the screens now. Off when the list is full. */
  function keepTile() {
    const full = safeList.length >= SAFE_MAX;
    return `<button type="button" id="live-safe-keep" class="rf-safe-add" ${full ? "disabled" : ""} title="${full ? `There are already ${SAFE_MAX} safe slides. Remove one first.` : "Keep the slide that is on the screens now as a safe slide"}">Keep current</button>`;
  }

  function paintSafeSlides() {
    const grid = document.getElementById("live-safe");
    const edit = document.getElementById("live-safe-edit");
    if (!grid) return;
    edit.classList.toggle("hidden", !safeList.length);
    edit.textContent = editingSafe ? "Done" : "Edit";
    edit.setAttribute("aria-pressed", String(editingSafe));
    if (!safeList.length) {
      editingSafe = false;
      grid.innerHTML = `<p class="text-sm opacity-70 rf-safe-none">None yet. When a slide worth keeping is up (the logo, a blank), press <strong>Keep current</strong>.</p>${keepTile()}`;
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
        .join("") + `<button type="button" class="btn btn-chip live-safe-clear col-span-full">Remove all</button>`;
    } else {
      // The slide itself: its picture when pictures are on, its words when
      // they are off (they are off by default for now), so what each key does
      // is on the key.
      grid.innerHTML = safeList
        .slice(0, SAFE_SHOWN)
        .map((sl) => {
          const pic =
            safePictures && sl.presentationId != null
              ? `<img src="/api/preview/image/${encodeURIComponent(sl.presentationId)}/${sl.slideIndex}" alt="" loading="lazy" />`
              : `<span class="rf-safe-words">${escapeHtml((sl.slideText ?? "").trim() || sl.label)}</span>`;
          return `<button type="button" class="rf-safe-key live-safe-key" data-safe="${escapeHtml(sl.id)}" title="${escapeHtml(sl.presentationName ?? "")}, slide ${sl.slideIndex + 1}"><span class="rf-safe-pic">${pic}</span><span class="rf-safe-label">${escapeHtml(sl.label)}</span></button>`;
        })
        .join("") + keepTile();
    }
    if (window.lucide) window.lucide.createIcons();

    // Keep what is on the screens now (the tile is drawn with the keys, so it is
    // wired with them).
    grid.querySelector("#live-safe-keep")?.addEventListener("click", async (e) => {
      const answer = await fire(e.currentTarget, "/api/live/safe-slides/current", {}, "Keep current");
      if (answer?.added) {
        safeList = answer.safeSlides ?? safeList;
        paintSafeSlides();
        setStatus(`Kept as a safe slide: ${answer.added.label}.`);
      }
    });
    // A picture that will not load (ProPresenter not answering, nothing drawn
    // yet) falls back to the slide's words, never a broken image.
    grid.querySelectorAll(".rf-safe-pic img").forEach((img) =>
      img.addEventListener("error", () => {
        const sl = safeList.find((x) => x.id === img.closest(".live-safe-key")?.dataset.safe);
        const words = document.createElement("span");
        words.className = "rf-safe-words";
        words.textContent = (sl?.slideText ?? "").trim() || sl?.label || "";
        img.replaceWith(words);
      })
    );
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
      } catch (err) {
        setStatus(`That wasn't saved: ${err.message}`);
      }
      paintSafeSlides();
    };
    // Remove all takes two presses, because it empties the list.
    const clearBtn = grid.querySelector(".live-safe-clear");
    clearBtn?.addEventListener("click", async () => {
      if (!clearBtn.dataset.armed) {
        clearBtn.dataset.armed = "1";
        clearBtn.textContent = "Press again to remove all";
        setTimeout(() => {
          if (clearBtn.isConnected) {
            delete clearBtn.dataset.armed;
            clearBtn.textContent = "Remove all";
          }
        }, 3000);
        return;
      }
      try {
        const res = await fetch("/api/live/safe-slides/clear", { method: "POST" });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
        safeList = [];
        editingSafe = false;
      } catch (err) {
        setStatus(`That wasn't saved: ${err.message}`);
      }
      paintSafeSlides();
    });
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
