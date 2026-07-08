/**
 * Nav rail (Section 13) — manual narrow/wide toggle only, no automatic
 * breakpoint switching, persisted in config.json's navPinned. Items are
 * driven by /api/modules (Section 17.11: nav renders from registered
 * modules, not hardcoded) plus the always-present core "Health" screen.
 *
 * Also owns theming (Section 2) — Dark/Light/System, cycled via one
 * button, persisted in config.json's theme.
 */

const THEME_CYCLE = ["system", "light", "dark"];
const THEME_LABEL = { system: "System", light: "Light", dark: "Dark" };

// Explicit ordering, most-used first — module-discovery order (readdir,
// effectively alphabetical) isn't a usage-frequency order, and it isn't
// stable to rely on for "which tab a first-time user sees first."
const NAV_PRIORITY = { search: 0, "lyrics-assist": 1, arrangement: 2 };
const DEFAULT_PRIORITY = 99;

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
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
}

export async function initNav({ onNavigate, viewIds }) {
  const rail = document.getElementById("nav-rail");
  const navItemsEl = document.getElementById("nav-items");
  const pinToggle = document.getElementById("nav-pin-toggle");
  const pinIcon = document.getElementById("nav-pin-icon");
  const themeToggle = document.getElementById("theme-toggle");
  const themeIcon = document.getElementById("theme-icon");
  const themeLabel = document.getElementById("theme-label");
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
    navItemsEl.innerHTML = items
      .map(
        (item) => `
      <button
        class="nav-item btn btn-ghost btn-sm justify-start gap-3 px-2 ${item.id === activeId ? "btn-active" : ""}"
        data-id="${item.id}"
        title="${item.navLabel}"
      >
        <i data-lucide="${item.icon}" class="shrink-0"></i>
        <span class="nav-label whitespace-nowrap ${pinned ? "" : "hidden"}">${item.navLabel}</span>
      </button>
    `
      )
      .join("");

    navItemsEl.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => setActive(btn.dataset.id));
    });

    if (window.lucide) window.lucide.createIcons();
  }

  function setActive(id) {
    activeId = id;
    renderItems();
    onNavigate(id);
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
    setIcon(themeIcon, currentTheme === "dark" ? "moon" : currentTheme === "light" ? "sun" : "sun-moon");
  }

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

  renderItems();
  applyPinnedState();
  applyThemeUI();
  onNavigate(activeId);
}
