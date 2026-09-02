import { mountLiveReadout, paintGoing, clearGoing } from "./live-readout.js";
import { showFailure } from "./notice.js";
import { crumb } from "./breadcrumbs.js";

export function initSearch() {
  /**
   * Ask for a docked window, on the surface where it matters.
   *
   * Search and Live are the booth surface: narrow, beside ProPresenter, during
   * a service. Everything else -- Health, Setup, Image Crop, QR Codes,
   * Arrangement -- is a desk surface where a full window is correct, which is
   * why this used to be wrong: it fired during first-run setup, telling an
   * installer their window was too wide at the one moment it was not.
   *
   * Once per session and dismissible. The app cannot know when a service is
   * about to start, so this can only be a reminder, and a reminder that repeats
   * is a nag. Nothing is persisted: a new session is a new chance that the
   * operator is about to go live.
   */
  const DOCKED_WIDTH_CEILING = 900;
  let dockNudgeHandled = false;

  function maybeShowDockNudge() {
    if (dockNudgeHandled) return;
    const wrap = document.getElementById("dock-nudge");
    const text = document.getElementById("dock-nudge-text");
    if (!wrap || !text) return;
    if (window.innerWidth <= DOCKED_WIDTH_CEILING) return;
    dockNudgeHandled = true;
    text.textContent =
      "Before a service, drag this narrow and tuck it beside ProPresenter. " +
      "It is built to sit next to the thing you are running, not in front of it.";
    wrap.classList.remove("hidden");
    document.getElementById("dock-nudge-dismiss")?.addEventListener("click", () => {
      wrap.classList.add("hidden");
    });
  }

  maybeShowDockNudge();
  const queryInput = document.getElementById("query");
  const resultsEl = document.getElementById("results");
  const statusEl = document.getElementById("index-status");
  const connectionBanner = document.getElementById("connection-banner");
  mountLiveReadout(document.getElementById("search-readout"));
  const dateFilterToggle = document.getElementById("date-filter-toggle");
  const dateFilterPanel = document.getElementById("date-filter-panel");
  const dateFieldSelect = document.getElementById("date-field");
  const dateFromInput = document.getElementById("date-from");
  const dateToInput = document.getElementById("date-to");
  const dateFilterClear = document.getElementById("date-filter-clear");
  const libraryFilterWrap = document.getElementById("library-filter-wrap");
  const libraryFilterToggle = document.getElementById("library-filter-toggle");
  const libraryFilterPanel = document.getElementById("library-filter-panel");

  let debounceTimer = null;
  let allLibraryFolders = [];

  // Slide "modified"/"created" dates can never be in the future — avoid
  // a confusing "0 results" from a mis-picked date.
  const today = new Date().toISOString().slice(0, 10);
  dateFromInput.max = today;
  dateToInput.max = today;

  async function initLibraryFilter() {
    const { folders } = await fetch("/api/search/folders").then((r) => r.json());
    allLibraryFolders = folders;
    // Only worth showing once there's an actual choice to make — a
    // single synced folder has nothing to narrow.
    if (folders.length <= 1) return;

    libraryFilterWrap.classList.remove("hidden");
    libraryFilterPanel.innerHTML = folders
      .map(
        (name) => `
      <label class="label cursor-pointer gap-1 py-0">
        <input type="checkbox" class="checkbox checkbox-xs library-filter-checkbox" value="${escapeHtml(name)}" checked />
        <span class="label-text text-xs">${escapeHtml(name)}</span>
      </label>
    `
      )
      .join("");

    libraryFilterPanel.querySelectorAll(".library-filter-checkbox").forEach((cb) => {
      cb.addEventListener("change", () => runSearch(queryInput.value));
    });
  }

  function selectedFolders() {
    if (allLibraryFolders.length <= 1) return null;
    const checked = Array.from(libraryFilterPanel.querySelectorAll(".library-filter-checkbox:checked")).map((cb) => cb.value);
    // All checked (the default) means "no filter" — only send a subset
    // when the user has actually narrowed it down.
    return checked.length < allLibraryFolders.length ? checked : null;
  }

  /**
   * Shows the index's age when it is old enough to matter, with the one press
   * that fixes it.
   *
   * Nothing is rendered below the threshold -- an all-clear the operator did
   * not ask for is noise on the screen they use under pressure.
   */
  /**
   * One line for "this index cannot be fully trusted", whichever reason applies.
   *
   * Accuracy outranks age. A week-old index misses songs edited since, which is
   * annoying; a stale-schema one is missing the slide anchors Go Live uses to
   * correct for an arrangement change, which means the slide that fires may not
   * be the slide that was clicked. If both are true the operator gets told about
   * the one that can put the wrong words on the screen.
   *
   * Both have the same remedy, so they share the Refresh button rather than
   * stacking two notices with two buttons over the search field.
   */
  function renderStaleness(staleness, accuracy = null) {
    const el = document.getElementById("index-staleness");
    if (!el) return;
    const notice = accuracy ?? staleness;
    if (!notice) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("hidden");
    el.innerHTML = `
      <span class="rf-flag">${escapeHtml(notice.message)}</span>
      <button id="index-refresh-btn" class="btn btn-chip ml-2">Refresh</button>`;
    el.querySelector("#index-refresh-btn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Refreshing";
      crumb("reindex", { from: "stale" });
      try {
        const res = await fetch("/api/index/reindex-changed", { method: "POST" });
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({}));
          showFailure(`Couldn't refresh the index: ${error ?? "no answer"}. Try the Health screen.`);
          return;
        }
        await refreshStatus();
      } finally {
        btn.disabled = false;
      }
    });
  }

  async function refreshStatus() {
    const [indexRes, connRes] = await Promise.all([
      fetch("/api/index/status").then((r) => r.json()),
      fetch("/api/propresenter/status").then((r) => r.json()),
    ]);

    statusEl.innerHTML = indexRes.builtAt
      ? `
        <span class="inline-flex items-center gap-1" title="${indexRes.presentationCount} presentations indexed"><i data-lucide="database" class="w-3.5 h-3.5"></i><span class="rf-value">${indexRes.presentationCount}</span></span>
        <span class="inline-flex items-center gap-1 ml-3" title="Index last built"><i data-lucide="clock" class="w-3.5 h-3.5"></i>${new Date(indexRes.builtAt).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        ${
          indexRes.buildDurationMs == null
            ? ""
            : `<span class="inline-flex items-center gap-1 ml-3" title="Last rebuild duration"><i data-lucide="timer" class="w-3.5 h-3.5"></i>${formatDuration(indexRes.buildDurationMs)}</span>`
        }
      `
      : `<span class="inline-flex items-center gap-1"><i data-lucide="database" class="w-3.5 h-3.5"></i>Not built yet</span>`;

    // The silent failure: a four-day-old index renders identically to a fresh
    // one -- same colour, same weight, no signal -- while search quietly misses
    // anything edited since. The watcher only reindexes while Refrain is
    // running, and on most machines it is not, so a Sunday index can be days
    // behind with nothing having gone wrong.
    //
    // Text state rather than a lamp, per the meter reasoning: an indicator that
    // sits dark for weeks and lights once is not reporting, and the emitter
    // budget is spent. And it carries its own remedy, because telling an
    // operator something is wrong without the fix is half an answer.
    renderStaleness(indexRes.staleness, indexRes.accuracy);
    if (window.lucide) window.lucide.createIcons();

    if (!connRes.connected) {
      connectionBanner.textContent = `Can't reach ProPresenter at ${connRes.host}:${connRes.port}. Check it's running with Network API enabled (Preferences > Network).`;
      connectionBanner.classList.remove("hidden");
    } else {
      connectionBanner.classList.add("hidden");
    }
  }

  async function runSearch(query) {
    const hasDateFilter = Boolean(dateFromInput.value || dateToInput.value);
    // A date range with no text is a valid "what did we use in this
    // timeframe" browse mode — only bail out when there's truly nothing
    // to search on.
    if (!query && !hasDateFilter) {
      showEmptyHint();
      return;
    }
    const params = new URLSearchParams({ q: query });
    if (hasDateFilter) {
      params.set("dateField", dateFieldSelect.value);
      if (dateFromInput.value) params.set("dateFrom", dateFromInput.value);
      if (dateToInput.value) params.set("dateTo", dateToInput.value);
    }
    const folders = selectedFolders();
    if (folders) params.set("folders", folders.join(","));
    const res = await fetch(`/api/search?${params}`);
    const { results } = await res.json();
    renderResults(results, hasDateFilter, query);
  }

  // Search matches are per-slide, but a song can have several matching
  // slides (e.g. a repeated chorus) — group them under one song card so
  // the results read as "songs with matches" rather than one row per
  // slide, with a song-level "start from the top" action alongside each
  // slide's own exact-match action.
  function groupResultsBySong(results) {
    const songs = new Map();
    for (const r of results) {
      if (!songs.has(r.presentationId)) {
        songs.set(r.presentationId, {
          presentationId: r.presentationId,
          presentationName: r.presentationName,
          appearsIn: r.appearsIn,
          // Which arrangement these slide numbers came from, so the operator
          // can see whether they're looking at FS, T, or raw document order.
          arrangementName: r.arrangementName ?? null,
          slides: [],
        });
      }
      songs.get(r.presentationId).slides.push(r);
    }
    return [...songs.values()];
  }

  function renderResults(results, showModifiedDate, query) {
    if (results.length === 0) {
      resultsEl.innerHTML = `<div class="opacity-60 text-center py-8">No matches</div>`;
      return;
    }

    const songs = groupResultsBySong(results);

    resultsEl.innerHTML = songs
      .map(
        (song) => `
      <div class="card bg-base-200 shadow-sm">
        <div class="card-body p-3 gap-2">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-semibold flex items-center gap-2">
                ${escapeHtml(song.presentationName)}
                ${song.arrangementName ? `<span class="badge badge-ghost badge-sm shrink-0" title="Indexed from the &quot;${escapeHtml(song.arrangementName)}&quot; arrangement">${escapeHtml(song.arrangementName)}</span>` : ""}
              </div>
              <div class="text-sm opacity-70">
                ${song.slides.length} matching slide${song.slides.length === 1 ? "" : "s"}${song.appearsIn.length ? ` &middot; in ${song.appearsIn.length} playlist(s)` : ""}
              </div>
            </div>
            <!-- Show only. "Go Live (Slide 1)" used to sit here, and it was a
                 blind action: you searched for a word, matched a presentation,
                 and the header offered to fire slide 1 -- a slide you have not
                 looked at, and by definition not the one you matched. If you
                 wanted slide 1 you would be browsing, not searching.

                 A live action is only legitimate once the operator can see what
                 they are firing, which is true in the slide rows below and was
                 never true here. Dropping to one button also gives the title
                 back the width that was wrapping it onto four lines. -->
            <div class="shrink-0">
              <button class="btn btn-outline btn-xs show-in-editor-btn" data-presentation-id="${song.presentationId}">
                Show in editor
              </button>
            </div>
          </div>
          <div class="flex flex-col gap-2 border-t border-base-300 pt-2">
            ${song.slides
              .map(
                (r) => `
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="text-xs opacity-70">
                    Slide ${r.slideIndex + 1}${r.repeatCount > 1 ? ` &middot; sung ${r.repeatCount}&times;` : ""}${showModifiedDate && r.modifiedDate ? ` &middot; modified ${new Date(r.modifiedDate).toLocaleDateString()}` : ""}
                  </div>
                  <div class="text-sm rf-measure">${highlightMatch(r.snippet, query)}</div>
                </div>
                <!-- Go Live stays primary here and only here: the slide's text
                     is rendered alongside it, so this is the informed action.
                     Show sits apart from it rather than butted against it --
                     guarding by separation rather than by a confirm dialog,
                     because a confirmation the operator has to read is the
                     thing that makes them press twice. -->
                <div class="flex items-center gap-3 shrink-0">
                  <button class="btn btn-chip show-in-editor-btn" data-presentation-id="${r.presentationId}" title="Open in ProPresenter's editor without changing what is on the screens">
                    Show
                  </button>
                  <button class="btn btn-brand btn-xs go-live-btn" data-presentation-id="${r.presentationId}" data-slide-index="${r.slideIndex}" data-group-id="${escapeHtml(r.groupId ?? "")}" data-group-offset="${r.groupOffset ?? ""}" data-slide-text="${escapeHtml(r.snippet ?? "")}" data-presentation-name="${escapeHtml(r.presentationName ?? "")}" data-arrangement-name="${escapeHtml(r.arrangementName ?? "")}">
                    Go Live
                  </button>
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
      </div>
    `
      )
      .join("");

    // Arm the top match. Exactly one Go Live carries the lit collar at rest,
    // and the collar moves to whatever the operator hovers or tabs to from
    // there, so a broad query does not light 1315 buttons at once. See the
    // moving-hero block in refrain.css.
    //
    // With the header's blind Go Live gone, the first `.go-live-btn` in the
    // results is now the first *slide row* rather than a presentation header --
    // so the collar lands on the informed action for free. Asserted in the
    // browser rather than assumed.
    resultsEl.querySelector(".go-live-btn")?.classList.add("rf-armed");
    // The count, never the query. `search -> 117 results` is enough to see the
    // shape of what led to a crash; the words are the operator's church's.
    crumb("search", { results: songs.length });
  }

  // String-based (not DOM textContent->innerHTML) so quote characters are
  // escaped too — this is interpolated into attribute values
  // (value="${escapeHtml(name)}"), where an unescaped `"` would close the
  // attribute early and corrupt the tag.
  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Wraps every case-insensitive occurrence of `query` in the raw
  // (unescaped) text with <mark>, escaping every other segment — done
  // this way round (find matches in the raw string, then escape each
  // piece) rather than escaping first and searching the escaped string,
  // since escaping could otherwise shift character offsets or make an
  // exact substring match miss.
  function highlightMatch(text, query) {
    const q = (query ?? "").trim();
    if (!q) return escapeHtml(text);

    const source = String(text ?? "");
    const lowerSource = source.toLowerCase();
    const lowerQuery = q.toLowerCase();

    let cursor = 0;
    let matchStart = lowerSource.indexOf(lowerQuery, cursor);
    if (matchStart === -1) return escapeHtml(source);

    const parts = [];
    while (matchStart !== -1) {
      parts.push(escapeHtml(source.slice(cursor, matchStart)));
      parts.push(`<mark class="rf-match">${escapeHtml(source.slice(matchStart, matchStart + q.length))}</mark>`);
      cursor = matchStart + q.length;
      matchStart = lowerSource.indexOf(lowerQuery, cursor);
    }
    parts.push(escapeHtml(source.slice(cursor)));
    return parts.join("");
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return "under a second";
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
  }

  // Acknowledgement has to land inside 50ms, and a fetch round trip does not
  // qualify. The readout paints from the button's own data on mousedown, then
  // the next poll corrects it against what ProPresenter actually did.
  resultsEl.addEventListener("mousedown", (e) => {
    const btn = e.target.closest(".go-live-btn");
    if (!btn) return;
    paintGoing({
      presentationName: btn.dataset.presentationName || null,
      arrangementName: btn.dataset.arrangementName || null,
      slideIndex: btn.dataset.slideIndex === "" ? null : Number(btn.dataset.slideIndex),
      text: btn.dataset.slideText || "",
    });
  });

  resultsEl.addEventListener("click", async (e) => {
    const liveBtn = e.target.closest(".go-live-btn");
    if (liveBtn) {
      liveBtn.disabled = true;
      try {
        const res = await fetch("/api/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The anchor lets the server re-find this exact slide if
          // ProPresenter is now on a different arrangement than the one this
          // index was built from (see resolveTriggerIndex).
          body: JSON.stringify({
            presentationId: liveBtn.dataset.presentationId,
            slideIndex: Number(liveBtn.dataset.slideIndex),
            groupId: liveBtn.dataset.groupId || null,
            groupOffset: liveBtn.dataset.groupOffset === "" ? null : Number(liveBtn.dataset.groupOffset),
            slideText: liveBtn.dataset.slideText || "",
          }),
        });
        if (!res.ok) {
          const { error } = await res.json();
          clearGoing();
          // Cold zone: what happened, then the next action. The operator can
          // press again with this still on screen -- that is the whole point of
          // it not being an alert.
          showFailure(`Didn't go live: ${error ?? "ProPresenter didn't answer"}. Press Go Live again.`);
        } else {
          window.refreshReturnBar?.();
        }
      } finally {
        liveBtn.disabled = false;
      }
      crumb("golive", { presentation: liveBtn.dataset.presentationId, slide: Number(liveBtn.dataset.slideIndex) });
      return;
    }

    const editorBtn = e.target.closest(".show-in-editor-btn");
    if (editorBtn) {
      editorBtn.disabled = true;
      try {
        const res = await fetch("/api/focus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presentationId: editorBtn.dataset.presentationId }),
        });
        if (!res.ok) {
          const { error } = await res.json();
          showFailure(`Didn't open the editor: ${error ?? "ProPresenter didn't answer"}. Nothing on the screens changed.`);
        }
      } finally {
        editorBtn.disabled = false;
      }
    }
  });

  queryInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(queryInput.value), 200);
  });

  dateFilterToggle.addEventListener("click", () => {
    dateFilterPanel.classList.toggle("hidden");
  });

  libraryFilterToggle.addEventListener("click", () => {
    libraryFilterPanel.classList.toggle("hidden");
  });

  [dateFieldSelect, dateFromInput, dateToInput].forEach((el) => {
    el.addEventListener("change", () => runSearch(queryInput.value));
  });

  dateFilterClear.addEventListener("click", () => {
    dateFromInput.value = "";
    dateToInput.value = "";
    runSearch(queryInput.value);
  });

  refreshStatus();
  initLibraryFilter();
  showEmptyHint();

  // Shown before the first keystroke (and whenever the box is cleared), so
  // the empty screen teaches what to do instead of sitting blank.
  function showEmptyHint() {
    resultsEl.innerHTML = `
      <div class="opacity-60 text-center py-10 flex flex-col items-center gap-2">
        <i data-lucide="search" class="w-8 h-8 opacity-40"></i>
        <div>Type any word to find any slide across your library.</div>
        <div class="text-xs">Press <kbd class="kbd kbd-xs">/</kbd> from any screen to jump here.</div>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
  }
}
