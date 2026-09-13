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
  const pendingEl = document.getElementById("search-pending");
  const connectionBanner = document.getElementById("connection-banner");
  mountLiveReadout(document.getElementById("search-readout"));
  const dateFilterToggle = document.getElementById("date-filter-toggle");
  const dateFilterPanel = document.getElementById("date-filter-panel");
  const dateFieldSelect = document.getElementById("date-field");
  const dateFromInput = document.getElementById("date-from");
  const dateToInput = document.getElementById("date-to");
  const dateFilterClear = document.getElementById("date-filter-clear");
  const queryClear = document.getElementById("query-clear");
  const libraryFilterWrap = document.getElementById("library-filter-wrap");
  const libraryFilterToggle = document.getElementById("library-filter-toggle");
  const libraryFilterPanel = document.getElementById("library-filter-panel");

  let debounceTimer = null;
  // Which search is the current one. Two can be in flight at once -- the
  // debounce only spaces out their *starts*, and a broad query takes about a
  // second to render -- so without this a slower earlier query can paint over
  // a faster later one and leave results that do not match the box.
  let latestSearchToken = 0;
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
    const token = ++latestSearchToken;
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

    try {
      const res = await fetch(`/api/search?${params}`);
      // A 500 returns an HTML error page, and parsing that as JSON throws
      // somewhere less obvious than here.
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      const { results } = await res.json();
      // Superseded by a newer keystroke: that search owns the screen now,
      // including the "Searching" line, so leave both alone.
      if (token !== latestSearchToken) return;
      renderResults(results, hasDateFilter, query);
    } catch (err) {
      if (token !== latestSearchToken) return;
      // Without this the acknowledgement was permanent: "Searching" stayed on
      // screen for the rest of the session, and nothing said the search had
      // failed at all. The previous results stay up, because they are still
      // the best thing available.
      clearPending();
      showFailure(`Search didn't run: ${err.message}. Type again to retry.`);
    }
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

  /**
   * How many matching slides are worth putting in the DOM at once.
   *
   * The server is not the cost here. `/api/search` answers in 19-40ms even for
   * 12,205 matches; rendering them was taking **4.8 seconds**, in a document
   * 3.75 million pixels tall, during which the screen is frozen. On a common
   * word like "the" it was 2.3s. That is the opposite of the quality floor --
   * acknowledgement inside 50ms -- and it is worst exactly when someone types
   * a short word mid-service.
   *
   * Whole songs, never a part of one: the operator reads a song's matches
   * together, so truncating inside a song would hide the third chorus while
   * showing the second. So this is a floor to stop at, not a hard slice, and
   * one song always renders however many slides it has.
   */
  const MAX_RENDERED_SLIDES = 250;

  /** Takes whole songs until the slide budget is spent. */
  function capForRender(songs) {
    const shown = [];
    let shownSlides = 0;
    for (const song of songs) {
      if (shown.length && shownSlides + song.slides.length > MAX_RENDERED_SLIDES) break;
      shown.push(song);
      shownSlides += song.slides.length;
    }
    return { shown, hiddenSongs: songs.length - shown.length, shownSlides };
  }

  /**
   * Instant, synchronous "heard you". Cleared by whatever renders next.
   *
   * Deliberately does not blank the outgoing results: during a service the
   * previous list is still the best thing on screen until a better one exists,
   * and clearing it would make every keystroke a flash of empty panel.
   */
  function acknowledgeInput(value) {
    if (!pendingEl) return;
    pendingEl.textContent = value.trim() ? "Searching" : "";
  }

  function clearPending() {
    if (pendingEl) pendingEl.textContent = "";
  }

  function renderResults(results, showModifiedDate, query) {
    clearPending();
    if (results.length === 0) {
      resultsEl.innerHTML = `<div class="opacity-60 text-center py-8">No matches</div>`;
      return;
    }

    const allSongs = groupResultsBySong(results);
    const { shown: songs, hiddenSongs, shownSlides } = capForRender(allSongs);

    // Said plainly, with the number, because a silently truncated result list
    // is a search that lies about what it found.
    const cappedNotice = hiddenSongs
      ? `<div class="rf-hint px-1 pb-2">Showing ${shownSlides} matching slide${shownSlides === 1 ? "" : "s"} in the first ${songs.length} of ${allSongs.length} songs. Add another word to narrow it.</div>`
      : "";

    resultsEl.innerHTML = cappedNotice + songs
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
    // Collapse whitespace runs, not just the ends. The server matches through
    // normalizeText(), which turns "dont  let" into "dont let" -- so a doubled
    // space or a stray tab returned four results here and marked none of them,
    // because this side was still looking for the literal two spaces. Slide
    // text is normalized at index time, so only the query needs it.
    const q = (query ?? "").replace(/\s+/g, " ").trim();
    if (!q) return escapeHtml(text);

    const source = String(text ?? "");
    const lowerQuery = q.toLowerCase();

    // The server forgives a dropped apostrophe -- "ive" is a hit on "I've" --
    // and it unifies the curly forms onto the straight one on both sides. Both
    // have to be mirrored here, or a line comes back as a result with no mark
    // on it and the operator cannot tell why it matched.
    //
    // So build the same normalized copy the server matched against, and carry
    // an index map back to the original: `map[i]` is the offset in `source` of
    // normalized character `i`, which turns a match span in the copy into the
    // real span to wrap, apostrophes and all.
    const CURLY = /[\u2018\u2019\u02BC]/g;
    const unifiedQuery = lowerQuery.replace(CURLY, "'");
    const queryHasApostrophe = unifiedQuery.includes("'");

    const map = [];
    let normalized = "";
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i].replace(CURLY, "'");
      // Only the text side folds, matching the server. A query that carries an
      // apostrophe is matched literally.
      if (ch === "'" && !queryHasApostrophe) continue;
      normalized += ch.toLowerCase();
      map.push(i);
    }
    map.push(source.length);

    let cursor = 0;
    let matchStart = normalized.indexOf(unifiedQuery, cursor);
    if (matchStart === -1) return escapeHtml(source);

    const parts = [];
    while (matchStart !== -1) {
      const start = map[matchStart];
      const end = map[matchStart + unifiedQuery.length];
      parts.push(escapeHtml(source.slice(cursor, start)));
      parts.push(`<mark class="rf-match">${escapeHtml(source.slice(start, end))}</mark>`);
      cursor = end;
      matchStart = normalized.indexOf(unifiedQuery, matchStart + unifiedQuery.length);
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

  /**
   * The keystroke is acknowledged before anything is searched.
   *
   * Measured on the real 445-presentation index: `/api/search` answers in
   * 19-40ms, but keystroke-to-results was 586ms -- 200ms of debounce, 16ms of
   * fetch, and the rest spent building and parsing the result list. The
   * quality floor is visual acknowledgement inside 50ms, and there was none of
   * any kind: results simply replaced themselves whenever they were ready.
   *
   * So two separate things, which were previously conflated:
   *
   * - **Acknowledgement** happens synchronously, in the event handler, so it
   *   cannot be late. No spinner and nothing animated -- the direction rules
   *   both out, and a spinner is hesitation with a costume on. A mono line
   *   where the count goes, swapped for the count itself.
   * - **The search** still waits, but only 90ms now rather than 200. A 19ms
   *   query does not need protecting from a fast typist, and the render is
   *   bounded by MAX_RENDERED_SLIDES above.
   */
  const SEARCH_DEBOUNCE_MS = 90;

  queryInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    syncClearButton();
    acknowledgeInput(queryInput.value);
    debounceTimer = setTimeout(() => runSearch(queryInput.value), SEARCH_DEBOUNCE_MS);
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

  /**
   * Clearing the search, from the button in the field or from Alt+X.
   *
   * One function for both, so the two routes cannot drift into clearing
   * different things -- the date range is the part that would quietly be left
   * behind, and a stale filter on an empty box is invisible.
   */
  function clearSearch() {
    clearTimeout(debounceTimer);
    queryInput.value = "";
    dateFromInput.value = "";
    dateToInput.value = "";
    syncClearButton();
    showEmptyHint();
    queryInput.focus({ preventScroll: true });
  }

  /** The button exists only while there is something to clear. */
  function syncClearButton() {
    if (queryClear) queryClear.hidden = queryInput.value.length === 0;
  }

  queryClear?.addEventListener("click", clearSearch);

  /**
   * Alt+X does the same thing from any screen.
   *
   * Matched on `e.code === "KeyX"` rather than `e.key`, because on macOS
   * Option+X produces the character "\u2248" -- `e.key` would never be "x" and the
   * shortcut would silently do nothing on exactly the machines this runs on.
   * `e.code` is the physical key, so it holds on both platforms.
   *
   * It is a document-level listener because initSearch() runs once at boot and
   * the screens are shown and hidden rather than mounted, so this stays live
   * wherever the operator is. When they are elsewhere, the hash sends them back
   * to Search first -- clearing a box you cannot see would look like nothing
   * happened.
   */
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || e.code !== "KeyX") return;
    e.preventDefault();
    if (location.hash !== "#search") location.hash = "#search";
    clearSearch();
  });

  /**
   * Clicking into a field that already holds a query selects the whole thing,
   * the way a browser's address bar does. One click and type replaces the
   * search instead of click, select, type -- which is the gesture an operator
   * mid-service actually makes.
   *
   * Nothing is destroyed: the text is visibly selected, still there, and one
   * more click puts the cursor where it was aimed.
   *
   * The mouse needs more than a `focus` handler, and the reason is worth
   * writing down because it is not what you would guess.
   *
   * Measured on the running app, a click on an unfocused field fires
   * `focus`, `mousedown`, `mouseup` -- in that order, with focus FIRST -- and
   * then places the caret, collapsing the selection, after every one of those
   * handlers has run. So selecting on `focus` is undone, and a flag that asks
   * "was the field already focused?" at `mousedown` time reads true, because
   * focus already happened. The first version of this did exactly that and
   * selected nothing.
   *
   * What holds for both orderings is the focus event itself: it fires once,
   * only when focus is actually gained. So `focus` raises the flag, and the
   * selection is made from a timeout after `mouseup` -- after the browser has
   * placed its caret, rather than before it. A timeout and not
   * requestAnimationFrame: rAF does not reliably fire in a hidden pane, which
   * is a trap this repo has hit before.
   *
   * A second click finds the flag down, so the caret lands where it was
   * aimed, and double-click keeps the browser's own word-select.
   */
  let justFocused = false;

  queryInput.addEventListener("focus", () => {
    if (!queryInput.value) return;
    justFocused = true;
    queryInput.select();
  });

  queryInput.addEventListener("blur", () => {
    justFocused = false;
  });

  queryInput.addEventListener("mouseup", () => {
    if (!justFocused) return;
    justFocused = false;
    setTimeout(() => {
      // Only if the click did not leave a selection of its own -- a
      // click-and-drag across part of the text is a deliberate selection and
      // must survive.
      if (queryInput.selectionStart === queryInput.selectionEnd) queryInput.select();
    }, 0);
  });

  /**
   * Esc clears the box while the box has focus, which is what a macOS search
   * field has always done -- the operator who reaches for it already knows it
   * works, and the one who does not loses nothing by never pressing it.
   *
   * Scoped to the field rather than the document, unlike Alt+X: Esc means
   * "back out of this" everywhere else in the app, and an overlay's Esc must
   * keep closing the overlay. The guard is both conditions, not just focus,
   * because a dialog can open while the field still holds focus behind it.
   */
  queryInput.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!queryInput.value) return;
    if (!document.getElementById("shortcuts-modal")?.classList.contains("hidden")) return;
    if (!document.getElementById("welcome-modal")?.classList.contains("hidden")) return;
    e.preventDefault();
    e.stopPropagation();
    clearSearch();
  });

  dateFilterClear.addEventListener("click", () => {
    dateFromInput.value = "";
    dateToInput.value = "";
    runSearch(queryInput.value);
  });

  refreshStatus();
  initLibraryFilter();
  syncClearButton();
  showEmptyHint();

  // Shown before the first keystroke (and whenever the box is cleared), so
  // the empty screen teaches what to do instead of sitting blank.
  function showEmptyHint() {
    clearPending();
    resultsEl.innerHTML = `
      <div class="opacity-60 text-center py-10 flex flex-col items-center gap-2">
        <i data-lucide="search" class="w-8 h-8 opacity-40"></i>
        <div>Type any word to find any slide across your library.</div>
        <div class="text-xs">Press <kbd class="kbd kbd-xs">/</kbd> from any screen to jump here.</div>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
  }
}
