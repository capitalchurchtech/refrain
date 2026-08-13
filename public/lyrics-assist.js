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
import { cleanText, splitText, renderSlidePreview, splitterLabel } from "./slide-tools.js";

export function initLyricsAssist() {
  const container = document.getElementById("view-lyrics-assist");
  let initialized = false;

  async function render() {
    if (initialized) return;
    initialized = true;

    const { lyricsSites, defaultSplitterId } = await fetch("/api/lyrics-assist/config").then((r) => r.json());
    const { splitters } = await fetch("/api/slide-splitters").then((r) => r.json());

    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="music" class="w-5 h-5"></i> Lyrics</h1>
        <div class="card bg-base-200">
          <div class="card-body p-3 gap-3">
            <h2 class="card-title text-base">Find lyrics</h2>
            <p class="text-xs opacity-60">
              Opens a scoped search in a new tab (${escapeHtml(lyricsSites.join(", "))}).
              Refrain never fetches or reads lyrics pages itself — copy what you need from the page that opens.
            </p>
            <div class="flex flex-wrap gap-2">
              <input id="lyrics-song" type="text" placeholder="Song title" class="input input-bordered w-full" />
              <input id="lyrics-artist" type="text" placeholder="Artist (optional)" class="input input-bordered w-full" />
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button id="lyrics-search-btn" class="btn btn-brand w-fit">
                <i data-lucide="search"></i> Search Lyrics
              </button>
              <button id="lyrics-copy-search-btn" class="btn btn-outline btn-sm w-fit" title="Copy the search link so you can paste it into a full browser window">
                <span class="copy-search-icon"><i data-lucide="copy"></i></span> Copy search link
              </button>
            </div>
          </div>
        </div>

        <div class="card bg-base-200">
          <div class="card-body p-3 gap-3">
            <h2 class="card-title text-base">Paste &amp; split into slides</h2>
            <textarea id="lyrics-paste" rows="5" placeholder="Paste lyrics here..." class="textarea textarea-bordered w-full"></textarea>
            <div class="flex flex-wrap items-center gap-2">
              <button id="lyrics-clean-btn" class="btn btn-outline btn-xs" title="Remove hidden characters copied from the web, tidy up spacing and blank lines, and optionally straighten curly quotes and dashes">
                <i data-lucide="eraser" class="w-3.5 h-3.5"></i> Clean up text
              </button>
              <label class="label cursor-pointer gap-1 py-0">
                <input type="checkbox" id="lyrics-straighten" class="checkbox checkbox-xs" checked />
                <span class="label-text text-xs">Straighten quotes &amp; dashes</span>
              </label>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm opacity-70">Split by:</span>
              <select id="lyrics-splitter" class="select select-bordered select-sm">
                ${splitters
                  .map((s) => `<option value="${s.id}" ${s.id === defaultSplitterId ? "selected" : ""}>${splitterLabel(s.id)}</option>`)
                  .join("")}
              </select>
              <label class="label cursor-pointer gap-1 py-0" title="Collapse blocks that repeat word for word (a chorus written out every time) into one slide each, and show the play order so you can build the arrangement.">
                <input type="checkbox" id="lyrics-group-repeats" class="checkbox checkbox-xs" />
                <span class="label-text text-xs">Group repeats</span>
              </label>
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

    // Builds the scoped search URL, or null if there's no song title yet.
    function currentSearchUrl() {
      const song = document.getElementById("lyrics-song").value.trim();
      const artist = document.getElementById("lyrics-artist").value.trim();
      if (!song) return null;
      const siteScope = lyricsSites.map((site) => `site:${site}`).join(" OR ");
      const query = `(${siteScope}) "${song}" ${artist} lyrics`.trim();
      return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    }

    document.getElementById("lyrics-search-btn").addEventListener("click", () => {
      const url = currentSearchUrl();
      if (!url) return;
      // An anchor click (rather than window.open with a features string)
      // opens a normal full-size browser tab instead of a cramped popup.
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    document.getElementById("lyrics-copy-search-btn").addEventListener("click", async (e) => {
      const url = currentSearchUrl();
      if (!url) return;
      const iconWrap = e.currentTarget.querySelector(".copy-search-icon");
      let ok = true;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        ok = false;
      }
      iconWrap.innerHTML = `<i data-lucide="${ok ? "check" : "x"}"></i>`;
      if (window.lucide) window.lucide.createIcons();
      setTimeout(() => {
        iconWrap.innerHTML = `<i data-lucide="copy"></i>`;
        if (window.lucide) window.lucide.createIcons();
      }, 1200);
    });

    document.getElementById("lyrics-clean-btn").addEventListener("click", () => {
      const ta = document.getElementById("lyrics-paste");
      const straighten = document.getElementById("lyrics-straighten").checked;
      ta.value = cleanText(ta.value, straighten);
    });

    document.getElementById("lyrics-preview-btn").addEventListener("click", async () => {
      // splitText strips invisible/control characters before splitting,
      // even if the user didn't press Clean up — they can't see them to
      // know to, and they otherwise ride along into the slides.
      const text = document.getElementById("lyrics-paste").value;
      const splitterId = document.getElementById("lyrics-splitter").value;
      if (!text.trim()) return;

      const slides = await splitText(text, splitterId);
      renderSlidePreview(document.getElementById("lyrics-slides"), slides, document.getElementById("lyrics-group-repeats").checked);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  return { render };
}
