/**
 * Shared "paste text, split into slides" helpers, used by both the lyrics
 * helper and the Scripture page. Neither feature fetches copyrighted text
 * itself — the user pastes what they copied from a site — so this is purely
 * about cleaning that paste up and splitting it into slide-sized blocks.
 *
 * Kept framework-free and side-effect-light: the render function takes the
 * target element, so a caller just points it at its own results container.
 */

// Removes characters that are invisible or have no business in slide text:
// zero-width spaces, the BOM, word joiners, and control codes. Non-breaking
// spaces become normal spaces. Safe to run silently since none of it changes
// anything you can see.
export function stripInvisible(text) {
  return String(text)
    // Zero-width space/joiner/non-joiner, word joiner, BOM. Alternation
    // rather than a character class, which ESLint flags as misleading when
    // it contains joiner characters.
    .replace(/\u200B|\u200C|\u200D|\u2060|\uFEFF/g, "")
    // Control characters (newline and tab are deliberately kept). The
    // control-char match is the whole point here, so the lint rule against
    // it doesn't apply.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\u00A0/g, " "); // non-breaking space -> normal space
}

// The visible cleanup behind a "Clean up text" button: strip the invisibles
// above, turn tabs into spaces, collapse runs of spaces and extra blank
// lines, trim trailing space, and (optionally) straighten curly quotes,
// dashes, and ellipses into plain ASCII. Accented and other real characters
// are left alone, so non-English text survives.
export function cleanText(text, straightenQuotes) {
  let t = stripInvisible(String(text).replace(/\r\n?/g, "\n")).replace(/\t/g, " ");
  if (straightenQuotes) {
    t = t
      .replace(/[‘’‚‛]/g, "'") // curly single quotes
      .replace(/[“”„‟]/g, '"') // curly double quotes
      .replace(/[–—―]/g, "-") // en/em/bar dashes
      .replace(/…/g, "..."); // ellipsis
  }
  t = t
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").replace(/\s+$/, ""))
    .join("\n");
  return t.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

// Splits pasted text into slide-sized blocks server-side, using the chosen
// slide-splitter plugin. Always strips invisibles first, even if the user
// didn't press Clean up — they can't see them to know to.
export async function splitText(text, splitterId) {
  const { slides } = await fetch("/api/slides/split", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: stripInvisible(text), splitterId }),
  }).then((r) => r.json());
  return slides ?? [];
}

// Groups blocks that repeat word for word (after light normalization:
// trimmed lines, collapsed spaces, case-insensitive, blank lines ignored).
// Returns the unique blocks in first-seen order, each with a short label
// (A, B, C...) and how many times it occurred, plus the full play order as
// a list of those labels. Matching is exact, not fuzzy, so a block that
// changes even one word stays its own block rather than being wrongly merged.
export function groupRepeats(slides) {
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

export function splitterLabel(id) {
  return id
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

// Renders split slides into `slidesEl` as copy-able cards. When `grouped`,
// collapses word-for-word repeats into one card each and shows a play order.
export function renderSlidePreview(slidesEl, slides, grouped) {
  if (slides.length === 0) {
    slidesEl.innerHTML = `<div class="opacity-60 text-center py-4">No slides — try a different splitter or check your paste.</div>`;
    return;
  }

  const { unique, order } = groupRepeats(slides);
  const hasRepeats = order.length !== unique.length;

  const cards = grouped
    ? unique.map((u) => ({ text: u.text, heading: `${u.label} · appears ${u.count}×` }))
    : slides.map((text) => ({ text }));

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

  slidesEl.querySelectorAll(".copy-slide-btn").forEach((btn) => wireCopy(btn, () => cards[Number(btn.dataset.index)].text));
  const orderBtn = slidesEl.querySelector(".copy-order-btn");
  if (orderBtn) wireCopy(orderBtn, () => orderLine);

  if (window.lucide) window.lucide.createIcons();
}

// Copy-to-clipboard with a brief check/x on the button's icon.
function wireCopy(btn, getText) {
  btn.addEventListener("click", async () => {
    const iconWrap = btn.querySelector(".copy-icon");
    let copied = true;
    try {
      await navigator.clipboard.writeText(getText());
    } catch {
      // Clipboard access can be denied (permissions, non-HTTPS context) —
      // fail visibly rather than silently doing nothing.
      copied = false;
    }
    iconWrap.innerHTML = `<i data-lucide="${copied ? "check" : "x"}"></i>`;
    if (window.lucide) window.lucide.createIcons();
    if (!copied) btn.title = "Couldn't copy — select and copy the text manually";
    setTimeout(() => {
      iconWrap.innerHTML = `<i data-lucide="copy"></i>`;
      if (window.lucide) window.lucide.createIcons();
    }, 1200);
  });
}

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
