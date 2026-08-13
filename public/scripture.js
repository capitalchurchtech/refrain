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
 */

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
    const { biblegatewayVersion, blueletterTranslation } = await fetch("/api/scripture/config").then((r) => r.json());
    const defaultVersion = VERSIONS.some((v) => v.code === biblegatewayVersion) ? biblegatewayVersion : "NIV";

    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-2xl">
        <div>
          <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="book-open" class="w-5 h-5"></i> Scripture</h1>
          <p class="text-sm opacity-70">
            Type a reference and open it in Bible Gateway or Blue Letter Bible. Refrain never fetches or
            stores scripture, it just opens the passage in a new tab, so read or copy from the page that opens.
          </p>
        </div>

        <div class="card bg-base-200">
          <div class="card-body p-3 gap-3">
            <div class="flex flex-wrap items-end gap-2">
              <label class="form-control flex-1 min-w-[14rem]">
                <div class="label py-1"><span class="label-text">Reference</span></div>
                <input id="scripture-ref" type="text" placeholder="John 3:16, Romans 8, Psalm 23:1-6" class="input input-bordered w-full" autofocus />
              </label>
              <label class="form-control">
                <div class="label py-1"><span class="label-text">Version</span></div>
                <select id="scripture-version" class="select select-bordered min-w-[9rem]">
                  ${VERSIONS.map((v) => `<option value="${v.code}" ${v.code === defaultVersion ? "selected" : ""}>${escapeHtml(v.label)}</option>`).join("")}
                </select>
              </label>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button id="scripture-bg-btn" class="btn btn-brand"><i data-lucide="external-link"></i> Bible Gateway</button>
              <button id="scripture-bg-copy" class="btn btn-outline btn-sm" title="Copy the Bible Gateway link"><span class="copy-icon" data-for="bg"><i data-lucide="copy"></i></span> Copy link</button>
              <span class="opacity-30">|</span>
              <button id="scripture-blb-btn" class="btn btn-brand"><i data-lucide="external-link"></i> Blue Letter Bible</button>
              <button id="scripture-blb-copy" class="btn btn-outline btn-sm" title="Copy the Blue Letter Bible link"><span class="copy-icon" data-for="blb"><i data-lucide="copy"></i></span> Copy link</button>
            </div>

            <p id="scripture-blb-note" class="text-xs opacity-60"></p>
          </div>
        </div>
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
