export function initSearch() {
  const queryInput = document.getElementById("query");
  const resultsEl = document.getElementById("results");
  const statusEl = document.getElementById("index-status");
  const rebuildBtn = document.getElementById("rebuild-btn");
  const connectionBanner = document.getElementById("connection-banner");

  let debounceTimer = null;

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
    if (!query) {
      resultsEl.innerHTML = "";
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
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
              <div class="text-sm opacity-70">Slide ${r.slideIndex + 1}${r.appearsIn.length ? ` &middot; in ${r.appearsIn.length} playlist(s)` : ""}</div>
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
}
