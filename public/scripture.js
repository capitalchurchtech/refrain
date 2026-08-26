import { CLEAN_PASTE_HINT, NO_SLIDE_CREATION } from "./strings.js";
/**
 * Scripture lookup — same shape as the lyrics helper: type a reference,
 * open it (or copy the link) in Bible Gateway or Blue Letter Bible.
 * Refrain only builds the URL and opens a normal browser tab; it never
 * fetches or reads scripture pages itself, so there's no bundled bible and
 * no version-licensing problem.
 *
 * Bible Gateway carries almost every translation. Blue Letter Bible is the
 * one to reach for original-language study (interlinear, Strong's), but it
 * doesn't carry some modern versions (NIV, NLT, MSG), so when the chosen
 * version isn't on BLB the BLB link falls back to the configured default.
 *
 * A second step lets the user paste the passage they copied from the site
 * and split it into slide-sized blocks (shared with the lyrics helper).
 * Refrain still never fetches scripture itself; it only formats the paste.
 */
import { cleanText, splitText, renderSlidePreview, splitterLabel } from "./slide-tools.js";

// Versions offered in the picker. blb is the Blue Letter Bible translation
// code, or null when BLB doesn't carry that version (licensing).
const VERSIONS = [
  { code: "NIV", label: "NIV", blb: null },
  { code: "ESV", label: "ESV", blb: "ESV" },
  { code: "NLT", label: "NLT", blb: null },
  { code: "KJV", label: "KJV", blb: "KJV" },
  { code: "NKJV", label: "NKJV", blb: "NKJV" },
  { code: "NASB", label: "NASB", blb: "NASB" },
  { code: "CSB", label: "CSB", blb: "CSB" },
  { code: "AMP", label: "AMP", blb: null },
  { code: "MSG", label: "The Message", blb: null },
  { code: "NRSV", label: "NRSV", blb: null },
];

export function initScripture() {
  const container = document.getElementById("view-scripture");

  async function render() {
    const [{ biblegatewayVersion, blueletterTranslation }, { splitters }] = await Promise.all([
      fetch("/api/scripture/config").then((r) => r.json()),
      fetch("/api/slide-splitters").then((r) => r.json()),
    ]);
    const defaultVersion = VERSIONS.some((v) => v.code === biblegatewayVersion) ? biblegatewayVersion : "NIV";
    const defaultSplitterId = splitters.some((s) => s.id === "blank-line-delimited") ? "blank-line-delimited" : splitters[0]?.id;

    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        <h1>Scripture</h1>

        <!-- E1. Looking the passage up is the errand; the collar used to sit on
             Bible Gateway, which leaves the app. The two-sentence lede went
             with it: "Refrain never fetches or stores scripture" is an
             architecture fact, already in the README, not a next action. -->
        <div class="card bg-base-200">
          <div class="card-body p-3 gap-3">
            <h2 class="card-title text-base">Look up a passage</h2>
            <div class="rf-control-row">
              <div class="rf-field">
                <label for="scripture-ref">Reference</label>
                <input id="scripture-ref" type="text" placeholder="John 3:16" class="input input-bordered w-full" autofocus />
              </div>
              <div class="rf-field" style="flex: 0 1 8rem">
                <label for="scripture-version">Version</label>
                <select id="scripture-version" class="select select-bordered">
                  ${VERSIONS.map((v) => `<option value="${v.code}" ${v.code === defaultVersion ? "selected" : ""}>${escapeHtml(v.label)}</option>`).join("")}
                </select>
              </div>
            </div>

            <!-- One Tier 2 primary per row, each with its own chip, rather than
                 four equal-weight controls and an "|" glyph doing the work a
                 row break should do. -->
            <div class="flex items-center gap-2">
              <button id="scripture-bg-btn" class="btn btn-outline btn-sm"><i data-lucide="external-link" class="w-3.5 h-3.5"></i> Bible Gateway</button>
              <button id="scripture-bg-copy" class="btn btn-chip" title="Copy the Bible Gateway link"><span class="copy-icon" data-for="bg"><i data-lucide="copy" class="w-3 h-3"></i></span> Copy</button>
            </div>
            <div class="flex items-center gap-2">
              <button id="scripture-blb-btn" class="btn btn-outline btn-sm"><i data-lucide="external-link" class="w-3.5 h-3.5"></i> Blue Letter Bible</button>
              <button id="scripture-blb-copy" class="btn btn-chip" title="Copy the Blue Letter Bible link"><span class="copy-icon" data-for="blb"><i data-lucide="copy" class="w-3 h-3"></i></span> Copy</button>
            </div>

            <p id="scripture-blb-note" class="text-xs opacity-60"></p>
            <p class="text-xs opacity-60">Read or copy from the page that opens.</p>
          </div>
        </div>

        <!-- E2, the hero. Same as Lyrics: the split is the payoff. -->
        <div class="card bg-base-200 rf-hero">
          <div class="card-body p-3 gap-3">
            <h2 class="card-title text-base">Paste and split into slides</h2>
            <div class="rf-field">
              <label for="scripture-paste">Passage</label>
              <textarea id="scripture-paste" rows="6" class="textarea textarea-bordered w-full"></textarea>
            </div>
            <div class="rf-control-row">
              <div class="rf-field">
                <label for="scripture-splitter">Split by</label>
                <select id="scripture-splitter" class="select select-bordered">
                  ${splitters.map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === defaultSplitterId ? "selected" : ""}>${escapeHtml(splitterLabel(s))}</option>`).join("")}
                </select>
              </div>
              <button id="scripture-preview-btn" class="btn btn-brand btn-sm">Preview Slides</button>
            </div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button id="scripture-clean-btn" class="btn btn-chip" title="${CLEAN_PASTE_HINT}">
                <i data-lucide="eraser" class="w-3 h-3"></i> Clean up
              </button>
              <label class="rf-check">
                <input type="checkbox" id="scripture-straighten" class="checkbox checkbox-xs" checked />
                Straighten quotes
              </label>
            </div>
          </div>
        </div>

        <p id="scripture-slides-note" class="text-xs opacity-60 hidden">${NO_SLIDE_CREATION}</p>
        <div id="scripture-slides" class="flex flex-col gap-2"></div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();

    const refEl = document.getElementById("scripture-ref");
    const versionEl = document.getElementById("scripture-version");
    const blbNote = document.getElementById("scripture-blb-note");

    function selectedVersion() {
      return VERSIONS.find((v) => v.code === versionEl.value) ?? VERSIONS[0];
    }

    function bibleGatewayUrl() {
      const ref = refEl.value.trim();
      if (!ref) return null;
      return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(ref)}&version=${encodeURIComponent(versionEl.value)}`;
    }

    function blueLetterUrl() {
      const ref = refEl.value.trim();
      if (!ref) return null;
      // Fall back to the configured BLB translation when the chosen version
      // isn't carried there (e.g. NIV, NLT, MSG).
      const t = selectedVersion().blb ?? blueletterTranslation ?? "KJV";
      return `https://www.blueletterbible.org/search/search.cfm?Criteria=${encodeURIComponent(ref)}&t=${encodeURIComponent(t)}`;
    }

    // Note whether BLB will use the chosen version or the fallback, so the
    // operator isn't surprised when NIV opens as KJV over there.
    function updateBlbNote() {
      const v = selectedVersion();
      const t = v.blb ?? blueletterTranslation ?? "KJV";
      blbNote.textContent = v.blb
        ? `Blue Letter Bible opens ${v.code} with interlinear and Strong's for word studies.`
        : `Blue Letter Bible doesn't carry ${v.code}, so it opens ${t} instead (best for Hebrew/Greek study).`;
    }
    versionEl.addEventListener("change", updateBlbNote);
    updateBlbNote();

    document.getElementById("scripture-bg-btn").addEventListener("click", () => openTab(bibleGatewayUrl()));
    document.getElementById("scripture-blb-btn").addEventListener("click", () => openTab(blueLetterUrl()));

    document.getElementById("scripture-bg-copy").addEventListener("click", (e) => copyLink(e.currentTarget, bibleGatewayUrl()));
    document.getElementById("scripture-blb-copy").addEventListener("click", (e) => copyLink(e.currentTarget, blueLetterUrl()));

    // Enter in the reference field opens Bible Gateway, the common case.
    refEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") openTab(bibleGatewayUrl());
    });

    // Paste & split into slides (shared with the lyrics helper).
    document.getElementById("scripture-clean-btn").addEventListener("click", () => {
      const ta = document.getElementById("scripture-paste");
      ta.value = cleanText(ta.value, document.getElementById("scripture-straighten").checked);
    });

    document.getElementById("scripture-preview-btn").addEventListener("click", async () => {
      const text = document.getElementById("scripture-paste").value;
      if (!text.trim()) return;
      const slides = await splitText(text, document.getElementById("scripture-splitter").value);
      renderSlidePreview(document.getElementById("scripture-slides"), slides, false);
      document.getElementById("scripture-slides-note").classList.toggle("hidden", slides.length === 0);
    });
  }

  // Opens the URL as a normal full browser tab (an anchor click, not
  // window.open, so it's a real tab rather than a cramped popup).
  function openTab(url) {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function copyLink(btn, url) {
    if (!url) return;
    const iconWrap = btn.querySelector(".copy-icon");
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
