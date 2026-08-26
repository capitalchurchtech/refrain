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
        <h1>Spell Check</h1>

        <!-- E2, the hero: the scan is the whole screen. The three-sentence lede
             it replaced explained how the check decides what to flag, which is
             architecture the operator discovers by pressing the button, and it
             pushed the one control below the fold. -->
        <div class="card bg-base-200 rf-hero">
          <div class="card-body p-3 gap-3">
            <h2 class="card-title text-base">Check a playlist</h2>
            <div class="rf-field">
              <label for="spellcheck-playlist">Playlist</label>
              <select id="spellcheck-playlist" class="select select-bordered"><option value="">Loading...</option></select>
            </div>
            <button id="spellcheck-scan-btn" class="btn btn-brand btn-sm w-fit" disabled>Check spelling</button>
            <p class="text-xs opacity-60">Fix anything real in ProPresenter. The buttons on each result jump you there.</p>
          </div>
        </div>

        <details id="spellcheck-allowlist-panel" class="collapse collapse-arrow bg-base-200 rounded">
          <summary class="collapse-title text-sm font-medium min-h-0 py-2">
            <span class="flex items-center gap-2">Ignored words <span id="spellcheck-allowlist-count" class="opacity-60"></span></span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
            <p class="text-xs opacity-60">
              Never flagged. Add the names, archaic spellings and song titles your church uses on purpose.
            </p>
            <div id="spellcheck-allowlist-chips" class="flex flex-wrap gap-1"></div>
            <div class="rf-control-row">
              <div class="rf-field">
                <label for="spellcheck-allowlist-input">Add words</label>
                <input id="spellcheck-allowlist-input" class="input input-bordered" placeholder="Yahweh, Hosanna, o'er" />
              </div>
              <button id="spellcheck-allowlist-add" class="btn btn-outline btn-sm">Add</button>
            </div>
            <span id="spellcheck-allowlist-status" class="text-xs"></span>
          </div>
        </details>

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
        select.innerHTML = `<option value="">Choose one...</option>` + playlists.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
      }
    } catch (err) {
      select.innerHTML = `<option value="">Couldn't load playlists</option>`;
      document.getElementById("spellcheck-status").textContent = err.message;
    }

    await loadAllowlist();

    document.getElementById("spellcheck-allowlist-add").addEventListener("click", async () => {
      const input = document.getElementById("spellcheck-allowlist-input");
      if (!input.value.trim()) return;
      await mutateAllowlist("/api/spellcheck/allow", { words: input.value });
      input.value = "";
    });
    document.getElementById("spellcheck-allowlist-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("spellcheck-allowlist-add").click();
    });

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
                  <span class="rf-tile rf-flagged gap-1 inline-flex items-center spellcheck-word" data-word="${escapeHtml(w.word)}" title="${w.suggestions.length ? "Suggestions: " + escapeHtml(w.suggestions.join(", ")) : "No suggestions"}">
                    ${escapeHtml(w.word)}${w.suggestions.length ? ` → ${escapeHtml(w.suggestions[0])}` : ""}
                    <button class="spellcheck-ignore-btn ml-1 underline decoration-dotted" data-word="${escapeHtml(w.word)}" title="Never flag this word again. You can undo it under Ignored words.">ignore</button>
                  </span>`
                  )
                  .join("")}
                <span class="flex-1"></span>
                <button class="btn btn-brand btn-xs spellcheck-live-btn" data-presentation-id="${escapeHtml(p.presentationId)}" data-slide-index="${s.slideIndex}" data-group-id="${escapeHtml(s.groupId ?? "")}" data-group-offset="${s.groupOffset ?? ""}" data-slide-text="${escapeHtml(s.text ?? "")}">Go Live</button>
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
            // Same anchor as Search sends: the operator may have switched
            // arrangement between the scan and this click.
            body: JSON.stringify({
              presentationId: btn.dataset.presentationId,
              slideIndex: Number(btn.dataset.slideIndex),
              groupId: btn.dataset.groupId || null,
              groupOffset: btn.dataset.groupOffset === "" ? null : Number(btn.dataset.groupOffset),
              slideText: btn.dataset.slideText || "",
            }),
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
        // Drop every occurrence from the shown results without a re-scan, and
        // refresh the panel so the word visibly lands somewhere undoable.
        dropWordFromResults(word);
        loadAllowlist();
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

  // The list is shown as removable chips: a word ignored by mistake would
  // otherwise hide a real typo forever with no way to find out.
  async function loadAllowlist() {
    const chips = document.getElementById("spellcheck-allowlist-chips");
    const count = document.getElementById("spellcheck-allowlist-count");
    if (!chips) return;
    let allowlist = [];
    try {
      allowlist = (await fetch("/api/spellcheck/allowlist").then((r) => r.json())).allowlist ?? [];
    } catch {
      chips.innerHTML = `<span class="text-xs opacity-60">Couldn't load the ignored words.</span>`;
      return;
    }
    count.textContent = allowlist.length ? `(${allowlist.length})` : "(none yet)";
    chips.innerHTML = allowlist.length
      ? allowlist
          .map(
            (w) => `<span class="rf-tile gap-1 inline-flex items-center">${escapeHtml(w)}
              <button class="spellcheck-unallow-btn" data-word="${escapeHtml(w)}" title="Stop ignoring &quot;${escapeHtml(w)}&quot;" aria-label="Stop ignoring ${escapeHtml(w)}">&times;</button>
            </span>`
          )
          .join("")
      : `<span class="text-xs opacity-60">Nothing ignored yet. Use <em>ignore</em> on a flagged word, or add words below.</span>`;

    chips.querySelectorAll(".spellcheck-unallow-btn").forEach((btn) =>
      btn.addEventListener("click", () => mutateAllowlist("/api/spellcheck/unallow", { word: btn.dataset.word }))
    );
  }

  async function mutateAllowlist(url, body) {
    const status = document.getElementById("spellcheck-allowlist-status");
    status.textContent = "Saving...";
    status.className = "text-xs opacity-60";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        status.textContent = data.error;
        status.className = "text-xs rf-flag";
        return;
      }
      status.textContent = "Saved.";
      status.className = "text-xs rf-nominal";
      await loadAllowlist();
    } catch (err) {
      status.textContent = err.message;
      status.className = "text-xs rf-flag";
    }
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
