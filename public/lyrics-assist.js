/**
 * Lyrics search-assist (Section 14). Two independent steps:
 * 1. Build a scoped search URL and open it in a new tab — never fetch
 *    or parse lyrics sites or search results ourselves (ToS boundary).
 * 2. Split lyrics the user pastes back in into slide-sized blocks and
 *    preview them.
 *
 * ProPresenter's API has no presentation-creation endpoint (checked
 * every candidate path — all 404), so this stops at "here are your
 * formatted slides, copy each into a new presentation yourself" rather
 * than a one-click import.
 */
export function initLyricsAssist() {
  const container = document.getElementById("view-lyrics-assist");
  let initialized = false;

  async function render() {
    if (initialized) return;
    initialized = true;

    const { lyricsSites, defaultSplitterId } = await fetch("/api/lyrics-assist/config").then((r) => r.json());
    const { splitters } = await fetch("/api/slide-splitters").then((r) => r.json());

    container.innerHTML = `
      <div class="flex flex-col gap-6 max-w-2xl">
        <div class="card bg-base-200">
          <div class="card-body gap-3">
            <h2 class="card-title text-base">Find lyrics</h2>
            <p class="text-xs opacity-60">
              Opens a scoped search in a new tab (${escapeHtml(lyricsSites.join(", "))}).
              Refrain never fetches or reads lyrics pages itself — copy what you need from the page that opens.
            </p>
            <div class="flex gap-2">
              <input id="lyrics-song" type="text" placeholder="Song title" class="input input-bordered w-full" />
              <input id="lyrics-artist" type="text" placeholder="Artist (optional)" class="input input-bordered w-full" />
            </div>
            <button id="lyrics-search-btn" class="btn btn-primary w-fit">
              <i data-lucide="search"></i> Search Lyrics
            </button>
          </div>
        </div>

        <div class="card bg-base-200">
          <div class="card-body gap-3">
            <h2 class="card-title text-base">Paste &amp; split into slides</h2>
            <textarea id="lyrics-paste" rows="8" placeholder="Paste lyrics here..." class="textarea textarea-bordered w-full"></textarea>
            <div class="flex items-center gap-2">
              <span class="text-sm opacity-70">Split by:</span>
              <select id="lyrics-splitter" class="select select-bordered select-sm">
                ${splitters
                  .map((s) => `<option value="${s.id}" ${s.id === defaultSplitterId ? "selected" : ""}>${splitterLabel(s.id)}</option>`)
                  .join("")}
              </select>
              <button id="lyrics-preview-btn" class="btn btn-outline btn-sm">Preview Slides</button>
            </div>
            <p class="text-xs opacity-60">
              ProPresenter's API doesn't support creating presentations programmatically on this
              version — copy each slide below into a new presentation yourself.
            </p>
          </div>
        </div>

        <div id="lyrics-slides" class="flex flex-col gap-2"></div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    document.getElementById("lyrics-search-btn").addEventListener("click", () => {
      const song = document.getElementById("lyrics-song").value.trim();
      const artist = document.getElementById("lyrics-artist").value.trim();
      if (!song) return;

      const siteScope = lyricsSites.map((site) => `site:${site}`).join(" OR ");
      const query = `(${siteScope}) "${song}" ${artist} lyrics`.trim();
      window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, "_blank", "noopener");
    });

    document.getElementById("lyrics-preview-btn").addEventListener("click", async () => {
      const text = document.getElementById("lyrics-paste").value;
      const splitterId = document.getElementById("lyrics-splitter").value;
      if (!text.trim()) return;

      const { slides } = await fetch("/api/lyrics-assist/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, splitterId }),
      }).then((r) => r.json());

      renderSlides(slides);
    });
  }

  function renderSlides(slides) {
    const slidesEl = document.getElementById("lyrics-slides");
    if (slides.length === 0) {
      slidesEl.innerHTML = `<div class="opacity-60 text-center py-4">No slides — try a different splitter or check your paste.</div>`;
      return;
    }

    slidesEl.innerHTML = slides
      .map(
        (text, i) => `
      <div class="card bg-base-200 shadow-sm">
        <div class="card-body p-4">
          <div class="flex items-start justify-between gap-4">
            <div class="text-sm whitespace-pre-line">${escapeHtml(text)}</div>
            <button class="btn btn-ghost btn-xs shrink-0 copy-slide-btn" data-index="${i}" title="Copy this slide">
              <span class="copy-icon"><i data-lucide="copy"></i></span>
            </button>
          </div>
        </div>
      </div>
    `
      )
      .join("");

    slidesEl.querySelectorAll(".copy-slide-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const iconWrap = btn.querySelector(".copy-icon");
        let copied = true;
        try {
          await navigator.clipboard.writeText(slides[Number(btn.dataset.index)]);
        } catch {
          // Clipboard access can be denied (permissions, non-HTTPS
          // context) — fail visibly rather than silently doing nothing.
          copied = false;
        }
        // Lucide's createIcons() replaces <i data-lucide> with a
        // rendered <svg>, consuming the original node — re-create it
        // inside the stable wrapper rather than mutating a stale node.
        iconWrap.innerHTML = `<i data-lucide="${copied ? "check" : "x"}"></i>`;
        if (window.lucide) window.lucide.createIcons();
        if (!copied) btn.title = "Couldn't copy — select and copy the text manually";
        setTimeout(() => {
          iconWrap.innerHTML = `<i data-lucide="copy"></i>`;
          if (window.lucide) window.lucide.createIcons();
        }, 1200);
      });
    });

    if (window.lucide) window.lucide.createIcons();
  }

  function splitterLabel(id) {
    return id
      .split("-")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  return { render };
}
