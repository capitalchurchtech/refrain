export function initSearch() {
  const queryInput = document.getElementById("query");
  const resultsEl = document.getElementById("results");
  const statusEl = document.getElementById("index-status");
  const connectionBanner = document.getElementById("connection-banner");
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

  async function refreshStatus() {
    const [indexRes, connRes] = await Promise.all([
      fetch("/api/index/status").then((r) => r.json()),
      fetch("/api/propresenter/status").then((r) => r.json()),
    ]);

    statusEl.innerHTML = indexRes.builtAt
      ? `
        <span class="inline-flex items-center gap-1" title="${indexRes.presentationCount} presentations indexed"><i data-lucide="database" class="w-3.5 h-3.5"></i>${indexRes.presentationCount}</span>
        <span class="inline-flex items-center gap-1 ml-3" title="Index last built"><i data-lucide="clock" class="w-3.5 h-3.5"></i>${new Date(indexRes.builtAt).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        ${
          indexRes.buildDurationMs == null
            ? ""
            : `<span class="inline-flex items-center gap-1 ml-3" title="Last rebuild duration"><i data-lucide="timer" class="w-3.5 h-3.5"></i>${formatDuration(indexRes.buildDurationMs)}</span>`
        }
      `
      : `<span class="inline-flex items-center gap-1"><i data-lucide="database" class="w-3.5 h-3.5"></i>Not built yet</span>`;
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
      resultsEl.innerHTML = "";
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
              <div class="font-semibold">${escapeHtml(song.presentationName)}</div>
              <div class="text-sm opacity-70">
                ${song.slides.length} matching slide${song.slides.length === 1 ? "" : "s"}${song.appearsIn.length ? ` &middot; in ${song.appearsIn.length} playlist(s)` : ""}
              </div>
            </div>
            <div class="flex flex-col gap-1 shrink-0">
              <button class="btn btn-brand btn-xs go-live-btn" data-presentation-id="${song.presentationId}" data-slide-index="0">
                Go Live (Slide 1)
              </button>
              <button class="btn btn-outline btn-xs show-in-editor-btn" data-presentation-id="${song.presentationId}">
                Show in Editor
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
                    Slide ${r.slideIndex + 1}${showModifiedDate && r.modifiedDate ? ` &middot; modified ${new Date(r.modifiedDate).toLocaleDateString()}` : ""}
                  </div>
                  <div class="text-sm">${highlightMatch(r.snippet, query)}</div>
                </div>
                <button class="btn btn-brand btn-xs go-live-btn shrink-0" data-presentation-id="${r.presentationId}" data-slide-index="${r.slideIndex}">
                  Go Live
                </button>
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
      parts.push(`<mark class="bg-warning text-warning-content rounded px-0.5">${escapeHtml(source.slice(matchStart, matchStart + q.length))}</mark>`);
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

  resultsEl.addEventListener("click", async (e) => {
    const liveBtn = e.target.closest(".go-live-btn");
    if (liveBtn) {
      liveBtn.disabled = true;
      try {
        const res = await fetch("/api/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presentationId: liveBtn.dataset.presentationId,
            slideIndex: Number(liveBtn.dataset.slideIndex),
          }),
        });
        if (!res.ok) {
          const { error } = await res.json();
          alert(`Failed to go live: ${error}`);
        }
      } finally {
        liveBtn.disabled = false;
      }
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
          alert(`Failed to show in editor: ${error}`);
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
}
