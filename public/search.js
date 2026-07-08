export function initSearch() {
  const queryInput = document.getElementById("query");
  const resultsEl = document.getElementById("results");
  const statusEl = document.getElementById("index-status");
  const rebuildBtn = document.getElementById("rebuild-btn");
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

    statusEl.textContent = indexRes.builtAt
      ? `Index: ${indexRes.presentationCount} presentations, built ${new Date(indexRes.builtAt).toLocaleString()}`
      : "Index: not built yet";

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
    renderResults(results);
  }

  function renderResults(results) {
    if (results.length === 0) {
      resultsEl.innerHTML = `<div class="opacity-60 text-center py-8">No matches</div>`;
      return;
    }

    resultsEl.innerHTML = results
      .map(
        (r) => `
      <div class="card bg-base-200 shadow-sm">
        <div class="card-body p-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-semibold">${escapeHtml(r.presentationName)}</div>
              <div class="text-sm opacity-70">
                Slide ${r.slideIndex + 1}${r.appearsIn.length ? ` &middot; in ${r.appearsIn.length} playlist(s)` : ""}${r.modifiedDate ? ` &middot; modified ${new Date(r.modifiedDate).toLocaleDateString()}` : ""}
              </div>
              <div class="mt-1 text-sm">${escapeHtml(r.snippet)}</div>
            </div>
            <button class="btn btn-primary btn-sm shrink-0 go-live-btn" data-presentation-id="${r.presentationId}" data-slide-index="${r.slideIndex}">
              Go Live
            </button>
          </div>
        </div>
      </div>
    `
      )
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  resultsEl.addEventListener("click", async (e) => {
    const btn = e.target.closest(".go-live-btn");
    if (!btn) return;
    btn.disabled = true;
    try {
      const res = await fetch("/api/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presentationId: btn.dataset.presentationId,
          slideIndex: Number(btn.dataset.slideIndex),
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        alert(`Failed to go live: ${error}`);
      }
    } finally {
      btn.disabled = false;
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

  rebuildBtn.addEventListener("click", async () => {
    rebuildBtn.disabled = true;
    statusEl.textContent = "Rebuilding index...";
    try {
      await fetch("/api/index/rebuild", { method: "POST" });
      await refreshStatus();
    } finally {
      rebuildBtn.disabled = false;
    }
  });

  refreshStatus();
  initLibraryFilter();
}
