/**
 * Nav rail (Section 13) — manual narrow/wide toggle only, no automatic
 * breakpoint switching, persisted in config.json's navPinned. Items are
 * driven by /api/modules (Section 17.11: nav renders from registered
 * modules, not hardcoded) plus the always-present core "Health" screen.
 *
 * Also owns theming (Section 2) — Dark/Light/System, cycled via one
 * button, persisted in config.json's theme.
 */

const THEME_CYCLE = ["system", "light", "dark", "blackroom"];
const THEME_LABEL = { system: "System", light: "Light", dark: "Dark", blackroom: "Blackroom" };
const THEME_ICON = { system: "sun-moon", light: "sun", dark: "moon", blackroom: "moon-star" };

// Explicit ordering and grouping, by when a tool is used in the week:
// live-service tools first, prep tools next, system last. Module-discovery
// order (readdir, effectively alphabetical) isn't a usage order and would
// bury an in-service tool like Live behind a prep tool like Image Crop. A
// module not listed here falls to the end of the prep group.
const NAV_PRIORITY = {
  search: 0,
  live: 1,
  scripture: 2,
  "lyrics-assist": 3,
  spellcheck: 4,
  arrangement: 5,
  "image-crop": 6,
  "qr-code": 7,
};
const DEFAULT_PRIORITY = 99;

// Which visual group each item sits in; a thin divider is drawn where the
// group changes, so the in-service / prep / system split is visible.
const NAV_GROUP = {
  search: "service",
  live: "service",
  scripture: "service",
  "lyrics-assist": "service",
  spellcheck: "service",
  arrangement: "prep",
  "image-crop": "prep",
  "qr-code": "prep",
  health: "system",
};
const DEFAULT_GROUP = "prep";

const svgCache = new Map();

/**
 * Fetches an SVG file and inlines its markup into `el`, so its paths'
 * `fill="currentColor"` (see public/img/*.svg) picks up the ambient
 * text color and stays in sync with the light/dark toggle — a plain
 * <img> can't do that, since an external image's internal styling is
 * opaque to the page's CSS.
 */
export async function injectSvg(el, path, sizeClasses = []) {
  if (!svgCache.has(path)) {
    svgCache.set(path, fetch(path).then((r) => r.text()));
  }
  el.innerHTML = await svgCache.get(path);
  const svg = el.querySelector("svg");
  if (svg) svg.classList.add(...sizeClasses);
}

export function applyTheme(theme) {
  const blackroom = theme === "blackroom";
  // Blackroom rides on top of the dark theme (see index.html) via a
  // class, so it inherits dark's accent colors; system resolves to the
  // OS preference; everything else maps to its own DaisyUI theme.
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : blackroom
        ? "dark"
        : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.classList.toggle("blackroom", blackroom);
}

export async function initNav({ onNavigate, viewIds }) {
  const rail = document.getElementById("nav-rail");
  const navItemsEl = document.getElementById("nav-items");
  const pinToggle = document.getElementById("nav-pin-toggle");
  const pinIcon = document.getElementById("nav-pin-icon");
  const themeToggle = document.getElementById("theme-toggle");
  const themeIcon = document.getElementById("theme-icon");
  const themeLabel = document.getElementById("theme-label");
  const brandRow = document.getElementById("brand-row");
  const brandMark = document.getElementById("brand-mark");
  const brandLogo = document.getElementById("brand-logo");

  await Promise.all([
    injectSvg(brandMark, "img/icon.svg", ["h-5", "w-auto"]),
    injectSvg(brandLogo, "img/logo.svg", ["h-9", "w-auto"]),
  ]);

  const [{ modules }, prefs] = await Promise.all([
    fetch("/api/modules").then((r) => r.json()),
    fetch("/api/preferences").then((r) => r.json()),
  ]);

  // Core screens that aren't pluggable feature modules, always present.
  const coreItems = [{ id: "health", navLabel: "Health", icon: "heart-pulse" }];
  // A module can be "enabled" per its own metadata/config while still
  // having no real screen built yet (e.g. lyrics-assist's component is
  // still null) — only show nav entries the frontend can actually render.
  const moduleItems = modules
    .filter((m) => m.enabled && viewIds.has(m.id))
    .sort((a, b) => (NAV_PRIORITY[a.id] ?? DEFAULT_PRIORITY) - (NAV_PRIORITY[b.id] ?? DEFAULT_PRIORITY));
  const items = [...moduleItems, ...coreItems];

  let activeId = items[0]?.id ?? "search";
  let currentTheme = prefs.theme ?? "system";
  let pinned = Boolean(prefs.navPinned);

  function renderItems() {
    let prevGroup = null;
    navItemsEl.innerHTML = items
      .map((item) => {
        const group = NAV_GROUP[item.id] ?? DEFAULT_GROUP;
        // A thin divider where the group changes (service -> prep -> system).
        const divider =
          prevGroup && group !== prevGroup
            ? `<div class="border-t border-base-300 my-1 mx-2" aria-hidden="true"></div>`
            : "";
        prevGroup = group;
        return `${divider}
      <button
        class="nav-item btn btn-ghost btn-sm justify-start gap-3 px-2 relative ${item.id === activeId ? "btn-active" : ""}"
        data-id="${item.id}"
        title="${item.navLabel}"
      >
        <i data-lucide="${item.icon}" class="shrink-0"></i>
        <span class="nav-label whitespace-nowrap ${pinned ? "" : "hidden"}">${item.navLabel}</span>
      </button>
    `;
      })
      .join("");

    navItemsEl.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => setActive(btn.dataset.id));
    });

    applyImageCropDot(); // re-apply after every rebuild (innerHTML reset wipes it)
    if (window.lucide) window.lucide.createIcons();
  }

  // A small live dot on the Image Crop nav item while its watcher is
  // running, so you can trust it's active at a glance without opening
  // the screen (the whole point of the module is not having to).
  let imageCropWatching = false;
  function applyImageCropDot() {
    const btn = navItemsEl.querySelector('[data-id="image-crop"]');
    if (!btn) return;
    let dot = btn.querySelector(".watching-dot");
    if (imageCropWatching && !dot) {
      dot = document.createElement("span");
      dot.className = "watching-dot absolute top-1 right-1 w-2 h-2 rounded-full bg-success";
      dot.title = "Watching for images";
      btn.appendChild(dot);
    } else if (!imageCropWatching && dot) {
      dot.remove();
    }
  }
  async function pollImageCropDot() {
    try {
      const s = await fetch("/api/image-crop/status").then((r) => r.json());
      imageCropWatching = Boolean(s.watching);
    } catch {
      imageCropWatching = false;
    }
    applyImageCropDot();
  }

  function setActive(id) {
    activeId = id;
    renderItems();
    onNavigate(id);
    // Opening Search puts the cursor in the box, so it's ready to type from
    // any tab (this is what the "/" and Cmd/Ctrl+K shortcuts land on, and
    // it also re-focuses when you click back to the Search tab).
    if (id === "search") focusSearchInput();
  }

  function focusSearchInput() {
    const q = document.getElementById("query");
    if (q) {
      q.focus();
      q.select();
    }
  }

  // True when the keyboard focus is in a field, so a bare "/" is left alone
  // to be typed rather than hijacked as a shortcut.
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  // Lucide's createIcons() replaces each <i data-lucide> element with a
  // rendered <svg>, consuming the original node — so toggling an icon
  // later means re-creating the element inside a stable wrapper, not
  // mutating the (now-gone) original node's dataset.
  function setIcon(wrapperEl, iconName) {
    wrapperEl.innerHTML = `<i data-lucide="${iconName}"></i>`;
    if (window.lucide) window.lucide.createIcons();
  }

  function applyPinnedState() {
    rail.classList.toggle("w-16", !pinned);
    rail.classList.toggle("w-56", pinned);
    rail.classList.toggle("collapsed", !pinned);
    // The rail is `fixed` (Section 13.1: `sticky` detached from the top
    // near the bottom of a tall page, since a sticky element can't stay
    // pinned past its own container's bottom edge) — taking it out of
    // flow means main has to carry a matching margin instead of the
    // flex layout doing it automatically.
    const mainContent = document.getElementById("main-content");
    mainContent.classList.toggle("ml-16", !pinned);
    mainContent.classList.toggle("ml-56", pinned);
    document.querySelectorAll(".nav-label").forEach((el) => el.classList.toggle("hidden", !pinned));
    // Collapsed: just the mark. Expanded: swap in the full wordmark
    // logo, same as expanding replaces every other icon-only nav item
    // with an icon+label.
    brandMark.classList.toggle("hidden", pinned);
    brandLogo.classList.toggle("hidden", !pinned);
    setIcon(pinIcon, pinned ? "chevrons-left" : "chevrons-right");
  }

  function applyThemeUI() {
    applyTheme(currentTheme);
    themeLabel.textContent = `Theme: ${THEME_LABEL[currentTheme]}`;
    setIcon(themeIcon, THEME_ICON[currentTheme] ?? "sun-moon");
  }

  brandRow.addEventListener("click", () => setActive("search"));

  pinToggle.addEventListener("click", async () => {
    pinned = !pinned;
    applyPinnedState();
    await fetch("/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ navPinned: pinned }),
    });
  });

  themeToggle.addEventListener("click", async () => {
    const nextIndex = (THEME_CYCLE.indexOf(currentTheme) + 1) % THEME_CYCLE.length;
    currentTheme = THEME_CYCLE[nextIndex];
    applyThemeUI();
    await fetch("/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: currentTheme }),
    });
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentTheme === "system") applyTheme("system");
  });

  // Global shortcuts: "/" or Cmd/Ctrl+K jumps to Search from any tab and
  // focuses the box. "/" is ignored while a field has focus so it can still
  // be typed; Cmd/Ctrl+K works even from a field.
  document.addEventListener("keydown", (e) => {
    const cmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
    const slash = e.key === "/" && !isTypingTarget(document.activeElement);
    if (cmdK || slash) {
      e.preventDefault();
      setActive("search");
    }
  });

  renderItems();
  applyPinnedState();
  applyThemeUI();
  onNavigate(activeId);

  // Reflect the image-crop watcher's live state in the nav. Polled (not
  // pushed) — cheap on localhost, and the watcher can start/stop from
  // its own screen or at boot, so the nav needs to notice either way.
  if (navItemsEl.querySelector('[data-id="image-crop"]')) {
    pollImageCropDot();
    setInterval(pollImageCropDot, 8000);
  }
}
