/**
 * Spell Check screen — pick a playlist, scan its slides for candidate
 * typos, review them, and jump to the slide in ProPresenter to fix it
 * (the API can't edit slides). "Ignore" adds a word to the allowlist so
 * it stops being flagged everywhere.
 */
export function initSpellcheck() {
  const container = document.getElementById("view-spellcheck");
  let lastResults = null;

  async function render() {
    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="spell-check" class="w-5 h-5"></i> Spell Check</h1>
        <p class="text-sm opacity-70">
          Checks the slides in a playlist for likely typos. It leans on the words already common across your
          library, so worship vocabulary and names it has seen before aren't flagged. Refrain can't edit slides,
          so fix anything real in ProPresenter (the buttons jump you there).
        </p>

        <div class="flex flex-wrap items-end gap-2">
          <label class="form-control">
            <div class="label py-1"><span class="label-text">Playlist</span></div>
            <select id="spellcheck-playlist" class="select select-bordered select-sm min-w-[16rem]"><option value="">Loading playlists...</option></select>
          </label>
          <button id="spellcheck-scan-btn" class="btn btn-brand btn-sm" disabled>Check spelling</button>
        </div>

        <div id="spellcheck-status" class="text-sm opacity-70"></div>
        <div id="spellcheck-results" class="flex flex-col gap-3"></div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();

    const select = document.getElementById("spellcheck-playlist");
    const scanBtn = document.getElementById("spellcheck-scan-btn");

    try {
      const { playlists } = await fetch("/api/spellcheck/playlists").then((r) => r.json());
      if (!playlists?.length) {
        select.innerHTML = `<option value="">No playlists found</option>`;
      } else {
        select.innerHTML = `<option value="">Choose a playlist...</option>` + playlists.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
      }
    } catch (err) {
      select.innerHTML = `<option value="">Couldn't load playlists</option>`;
      document.getElementById("spellcheck-status").textContent = err.message;
    }

    select.addEventListener("change", () => (scanBtn.disabled = !select.value));
    scanBtn.addEventListener("click", () => runScan(select.value, scanBtn));
  }

  async function runScan(playlistId, scanBtn) {
    if (!playlistId) return;
    const statusEl = document.getElementById("spellcheck-status");
    const resultsEl = document.getElementById("spellcheck-results");
    scanBtn.disabled = true;
    statusEl.textContent = "Scanning slides...";
    resultsEl.innerHTML = "";
    try {
      const res = await fetch("/api/spellcheck/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId }),
      });
      const data = await res.json();
      if (!res.ok) {
        statusEl.textContent = data.error;
        return;
      }
      lastResults = data;
      renderResults(data);
    } catch (err) {
      statusEl.textContent = `Scan failed: ${err.message}`;
    } finally {
      scanBtn.disabled = false;
    }
  }

  function renderResults(data) {
    const statusEl = document.getElementById("spellcheck-status");
    const resultsEl = document.getElementById("spellcheck-results");
    const total = data.presentations.reduce((n, p) => n + p.slides.reduce((m, s) => m + s.words.length, 0), 0);

    statusEl.textContent = total
      ? `${total} word${total === 1 ? "" : "s"} to review across ${data.presentations.length} presentation${data.presentations.length === 1 ? "" : "s"}.${data.truncated ? ` (checked the first ${data.scannedCount})` : ""}`
      : `No likely typos found${data.truncated ? ` in the first ${data.scannedCount} items` : ""}. `;

    resultsEl.innerHTML = data.presentations
      .map(
        (p) => `
      <div class="card bg-base-200">
        <div class="card-body p-3 gap-2">
          <div class="font-medium">${escapeHtml(p.presentationName ?? "Untitled")}</div>
          ${p.slides
            .map(
              (s) => `
            <div class="text-sm bg-base-100 rounded p-2" data-presentation-id="${escapeHtml(p.presentationId)}" data-slide-index="${s.slideIndex}">
              <div class="whitespace-pre-line">${highlight(s.text, s.words.map((w) => w.word))}</div>
              <div class="flex flex-wrap items-center gap-2 mt-2">
                ${s.words
                  .map(
                    (w) => `
                  <span class="badge badge-warning gap-1 spellcheck-word" data-word="${escapeHtml(w.word)}" title="${w.suggestions.length ? "Suggestions: " + escapeHtml(w.suggestions.join(", ")) : "No suggestions"}">
                    ${escapeHtml(w.word)}${w.suggestions.length ? ` → ${escapeHtml(w.suggestions[0])}` : ""}
                    <button class="spellcheck-ignore-btn ml-1" data-word="${escapeHtml(w.word)}" title="Ignore this word everywhere (add to allowlist)">×</button>
                  </span>`
                  )
                  .join("")}
                <span class="flex-1"></span>
                <button class="btn btn-brand btn-xs spellcheck-live-btn" data-presentation-id="${escapeHtml(p.presentationId)}" data-slide-index="${s.slideIndex}">Go Live</button>
                <button class="btn btn-outline btn-xs spellcheck-editor-btn" data-presentation-id="${escapeHtml(p.presentationId)}">Show in Editor</button>
              </div>
            </div>`
            )
            .join("")}
        </div>
      </div>`
      )
      .join("");

    if (window.lucide) window.lucide.createIcons();
    wireResultActions();
  }

  function wireResultActions() {
    const resultsEl = document.getElementById("spellcheck-results");

    resultsEl.querySelectorAll(".spellcheck-live-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const res = await fetch("/api/trigger", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ presentationId: btn.dataset.presentationId, slideIndex: Number(btn.dataset.slideIndex) }),
          });
          if (!res.ok) alert(`Failed to go live: ${(await res.json()).error}`);
          else window.refreshReturnBar?.();
        } finally {
          btn.disabled = false;
        }
      })
    );

    resultsEl.querySelectorAll(".spellcheck-editor-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const res = await fetch("/api/focus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ presentationId: btn.dataset.presentationId }),
          });
          if (!res.ok) alert(`Failed to show in editor: ${(await res.json()).error}`);
        } finally {
          btn.disabled = false;
        }
      })
    );

    resultsEl.querySelectorAll(".spellcheck-ignore-btn").forEach((btn) =>
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const word = btn.dataset.word;
        try {
          await fetch("/api/spellcheck/allow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ word }),
          });
        } catch {
          // allowlisting is a convenience; don't block the UI on a failure
        }
        // Drop every occurrence of this word from the current results without a re-scan.
        dropWordFromResults(word);
      })
    );
  }

  // Removes a now-allowlisted word from the shown results (and any slide or
  // presentation that becomes empty as a result), so the list settles down
  // without another full scan.
  function dropWordFromResults(word) {
    const lower = word.toLowerCase();
    for (const p of lastResults.presentations) {
      for (const s of p.slides) s.words = s.words.filter((w) => w.word.toLowerCase() !== lower);
      p.slides = p.slides.filter((s) => s.words.length);
    }
    lastResults.presentations = lastResults.presentations.filter((p) => p.slides.length);
    renderResults(lastResults);
  }

  // Wrap each flagged word in the slide text with a <mark>, matching whole
  // words case-insensitively. Escapes first so the text stays safe.
  function highlight(text, words) {
    let safe = escapeHtml(text);
    const uniq = [...new Set(words)];
    for (const w of uniq) {
      const re = new RegExp(`\\b(${escapeRegExp(escapeHtml(w))})\\b`, "gi");
      safe = safe.replace(re, "<mark>$1</mark>");
    }
    return safe;
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
