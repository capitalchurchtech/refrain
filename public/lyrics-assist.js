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
      <div class="flex flex-col gap-4 max-w-2xl">
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
      ta.value = cleanLyrics(ta.value, straighten);
    });

    document.getElementById("lyrics-preview-btn").addEventListener("click", async () => {
      // Always drop invisible/control characters before splitting, even if
      // the user didn't press Clean up — they can't see them to know to,
      // and they otherwise ride along into the slides.
      const text = stripInvisible(document.getElementById("lyrics-paste").value);
      const splitterId = document.getElementById("lyrics-splitter").value;
      if (!text.trim()) return;

      const { slides } = await fetch("/api/lyrics-assist/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, splitterId }),
      }).then((r) => r.json());

      renderSlides(slides, document.getElementById("lyrics-group-repeats").checked);
    });
  }

  // Groups blocks that repeat word for word (after light normalization:
  // trimmed lines, collapsed spaces, case-insensitive, blank lines
  // ignored). Returns the unique blocks in first-seen order, each with a
  // short label (A, B, C...) and how many times it occurred, plus the
  // full play order as a list of those labels. Matching is exact, not
  // fuzzy, so a chorus that changes even one word stays its own block
  // rather than being wrongly merged and lost.
  function groupRepeats(slides) {
    const normalize = (s) =>
      s
        .split("\n")
        .map((l) => l.trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
    const byKey = new Map();
    const unique = [];
    const order = [];
    slides.forEach((text) => {
      const key = normalize(text);
      if (!byKey.has(key)) {
        const index = unique.length;
        const label = index < 26 ? String.fromCharCode(65 + index) : `#${index + 1}`;
        const block = { label, text, count: 0 };
        byKey.set(key, block);
        unique.push(block);
      }
      const block = byKey.get(key);
      block.count += 1;
      order.push(block.label);
    });
    return { unique, order };
  }

  // Removes characters that are invisible or have no business in slide
  // text: zero-width spaces, the BOM, word joiners, and control codes.
  // Non-breaking spaces become normal spaces. Safe to run silently since
  // none of it changes anything you can see.
  function stripInvisible(text) {
    return String(text)
      // Zero-width space/joiner/non-joiner, word joiner, BOM. Alternation
      // rather than a character class, which ESLint flags as misleading
      // when it contains joiner characters.
      .replace(/\u200B|\u200C|\u200D|\u2060|\uFEFF/g, "")
      // Control characters (newline and tab are deliberately kept). The
      // control-char match is the whole point here, so the lint rule
      // against it doesn't apply.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/\u00A0/g, " "); // non-breaking space -> normal space
  }

  // The visible cleanup behind the "Clean up text" button: strip the
  // invisibles above, turn tabs into spaces, collapse runs of spaces and
  // extra blank lines, trim trailing space, and (optionally) straighten
  // curly quotes, dashes, and ellipses into plain ASCII. Accented letters
  // and other real characters are left alone, so non-English lyrics survive.
  function cleanLyrics(text, straightenQuotes) {
    let t = stripInvisible(String(text).replace(/\r\n?/g, "\n")).replace(/\t/g, " ");
    if (straightenQuotes) {
      t = t
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // curly single quotes
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // curly double quotes
        .replace(/[\u2013\u2014\u2015]/g, "-") // en/em/bar dashes
        .replace(/\u2026/g, "..."); // ellipsis
    }
    t = t
      .split("\n")
      .map((line) => line.replace(/ {2,}/g, " ").replace(/\s+$/, ""))
      .join("\n");
    return t.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "");
  }

  function renderSlides(slides, grouped) {
    const slidesEl = document.getElementById("lyrics-slides");
    if (slides.length === 0) {
      slidesEl.innerHTML = `<div class="opacity-60 text-center py-4">No slides — try a different splitter or check your paste.</div>`;
      return;
    }

    const { unique, order } = groupRepeats(slides);
    const hasRepeats = order.length !== unique.length;

    // In grouped mode each card is a unique block (with its label and
    // repeat count); otherwise it's every slide as split, unchanged.
    const cards = grouped
      ? unique.map((u) => ({ text: u.text, heading: `${u.label} · appears ${u.count}×` }))
      : slides.map((text) => ({ text }));

    // A "play order" line only makes sense once something repeats.
    const orderLine = order.join(", ");
    const header = grouped
      ? `<div class="card bg-base-200 shadow-sm">
           <div class="card-body p-3 gap-1">
             <div class="flex items-center justify-between gap-2">
               <span class="text-sm font-semibold">Play order</span>
               <button class="btn btn-ghost btn-xs shrink-0 copy-order-btn" title="Copy the play order">
                 <span class="copy-icon"><i data-lucide="copy"></i></span>
               </button>
             </div>
             <div class="text-sm">${escapeHtml(orderLine)}</div>
             <div class="text-xs opacity-60">${unique.length} unique ${unique.length === 1 ? "slide" : "slides"} below. Create each once, then arrange them in this order.</div>
           </div>
         </div>`
      : hasRepeats
        ? `<div class="alert py-2 text-sm">
             <i data-lucide="copy-check" class="w-4 h-4 shrink-0"></i>
             <span>Some blocks repeat word for word. Tick <strong>Group repeats</strong> and preview again to collapse them into one slide each plus a play order.</span>
           </div>`
        : "";

    slidesEl.innerHTML =
      header +
      cards
        .map(
          (card, i) => `
      <div class="card bg-base-200 shadow-sm">
        <div class="card-body p-3">
          ${card.heading ? `<div class="text-xs font-semibold opacity-70">${escapeHtml(card.heading)}</div>` : ""}
          <div class="flex items-start justify-between gap-4">
            <div class="text-sm whitespace-pre-line">${escapeHtml(card.text)}</div>
            <button class="btn btn-ghost btn-xs shrink-0 copy-slide-btn" data-index="${i}" title="Copy this slide">
              <span class="copy-icon"><i data-lucide="copy"></i></span>
            </button>
          </div>
        </div>
      </div>
    `
        )
        .join("");

    // Shared copy-with-feedback for a button given the text to copy.
    const wireCopy = (btn, getText) =>
      btn.addEventListener("click", async () => {
        const iconWrap = btn.querySelector(".copy-icon");
        let copied = true;
        try {
          await navigator.clipboard.writeText(getText());
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

    slidesEl.querySelectorAll(".copy-slide-btn").forEach((btn) => wireCopy(btn, () => cards[Number(btn.dataset.index)].text));
    const orderBtn = slidesEl.querySelector(".copy-order-btn");
    if (orderBtn) wireCopy(orderBtn, () => orderLine);

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
