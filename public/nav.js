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
  "library-sync": 8,
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
  "library-sync": "prep",
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
  // Expanded by default until the user chooses: on a fresh install navPinned
  // is unset (null), so a first-time user sees labels rather than a wall of
  // unlabeled icons. Once they collapse or expand, that choice (true/false)
  // is stored and respected.
  let pinned = prefs.navPinned == null ? true : Boolean(prefs.navPinned);

  function renderItems() {
    let prevGroup = null;
    navItemsEl.innerHTML = items
      .map((item, i) => {
        const group = NAV_GROUP[item.id] ?? DEFAULT_GROUP;
        // A thin divider where the group changes (service -> prep -> system).
        const divider =
          prevGroup && group !== prevGroup
            ? `<div class="border-t border-base-content/25 my-2 mx-2" aria-hidden="true"></div>`
            : "";
        prevGroup = group;
        // The number key that jumps here (first nine items), revealed while
        // Cmd/Ctrl is held via the .nav-key CSS.
        const keyBadge = i < 9 ? `<kbd class="kbd kbd-xs nav-key" aria-hidden="true">${i + 1}</kbd>` : "";
        return `${divider}
      <button
        class="nav-item btn btn-ghost btn-sm justify-start gap-3 px-2 relative ${item.id === activeId ? "btn-active" : ""}"
        data-id="${item.id}"
        title="${item.navLabel}"
      >
        <i data-lucide="${item.icon}" class="shrink-0"></i>
        <span class="nav-label whitespace-nowrap ${pinned ? "" : "hidden"}">${item.navLabel}</span>
        ${keyBadge}
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
    rail.classList.toggle("w-32", pinned);
    rail.classList.toggle("collapsed", !pinned);
    // The rail is `fixed` (Section 13.1: `sticky` detached from the top
    // near the bottom of a tall page, since a sticky element can't stay
    // pinned past its own container's bottom edge) — taking it out of
    // flow means main has to carry a matching margin instead of the
    // flex layout doing it automatically.
    const mainContent = document.getElementById("main-content");
    mainContent.classList.toggle("ml-16", !pinned);
    mainContent.classList.toggle("ml-32", pinned);
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

  // --- Modal focus management (accessibility) ---
  // On open, remember what had focus and move focus into the dialog; on
  // close, return focus to where it was. Tab is trapped inside the dialog.
  let modalReturnFocus = null;
  const focusablesIn = (el) =>
    [...el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
      (n) => n.offsetParent !== null
    );
  const onModalOpen = (modal) => {
    modalReturnFocus = document.activeElement;
    const f = focusablesIn(modal);
    (f[0] ?? modal).focus?.();
  };
  const onModalClose = () => {
    if (modalReturnFocus?.focus) modalReturnFocus.focus();
    modalReturnFocus = null;
  };
  const trapTab = (e, modal) => {
    const f = focusablesIn(modal);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Keyboard-shortcuts help overlay, opened by "?" or the Shortcuts button.
  const shortcutsModal = document.getElementById("shortcuts-modal");
  const shortcutsOpen = () => shortcutsModal && !shortcutsModal.classList.contains("hidden");
  const openShortcuts = () => {
    if (!shortcutsModal || shortcutsOpen()) return;
    shortcutsModal.classList.remove("hidden");
    onModalOpen(shortcutsModal);
  };
  const closeShortcuts = () => {
    if (!shortcutsOpen()) return;
    shortcutsModal.classList.add("hidden");
    onModalClose();
  };
  document.getElementById("nav-help-toggle")?.addEventListener("click", openShortcuts);
  document.getElementById("shortcuts-close")?.addEventListener("click", closeShortcuts);
  shortcutsModal?.addEventListener("click", (e) => {
    if (e.target === shortcutsModal) closeShortcuts();
  });

  // Welcome / how-to overlay for volunteers, shown on start until dismissed.
  const welcomeModal = document.getElementById("welcome-modal");
  const welcomeDontShow = document.getElementById("welcome-dontshow");
  let welcomeDismissed = Boolean(prefs.welcomeDismissed);
  const welcomeOpen = () => welcomeModal && !welcomeModal.classList.contains("hidden");
  const openWelcome = () => {
    if (!welcomeModal || welcomeOpen()) return;
    if (welcomeDontShow) welcomeDontShow.checked = welcomeDismissed;
    welcomeModal.classList.remove("hidden");
    onModalOpen(welcomeModal);
  };
  const closeWelcome = async () => {
    if (!welcomeOpen()) return;
    welcomeModal.classList.add("hidden");
    onModalClose();
    const next = Boolean(welcomeDontShow?.checked);
    if (next !== welcomeDismissed) {
      welcomeDismissed = next;
      await fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ welcomeDismissed: next }),
      });
    }
  };
  document.getElementById("welcome-close")?.addEventListener("click", closeWelcome);
  document.getElementById("welcome-gotit")?.addEventListener("click", closeWelcome);
  welcomeModal?.addEventListener("click", (e) => {
    if (e.target === welcomeModal) closeWelcome();
  });
  // Cross-links between the two help surfaces.
  document.getElementById("welcome-shortcuts-link")?.addEventListener("click", () => {
    closeWelcome();
    openShortcuts();
  });
  document.getElementById("shortcuts-welcome-link")?.addEventListener("click", () => {
    closeShortcuts();
    openWelcome();
  });

  // Hold Cmd/Ctrl to reveal each item's number badge. Cleared on release or
  // window blur, so a missed keyup (e.g. an OS shortcut stealing focus)
  // doesn't leave the badges stuck on.
  const hideKeys = () => rail.classList.remove("reveal-keys");
  window.addEventListener("keyup", (e) => {
    if (e.key === "Meta" || e.key === "Control") hideKeys();
  });
  window.addEventListener("blur", hideKeys);

  // Global keys. "/" or Cmd/Ctrl+K jumps to Search and focuses the box; a
  // digit 1-9 jumps to that nav item (bare, or with Cmd/Ctrl — browsers may
  // reserve Cmd/Ctrl+digit for tab switching, so the bare digit is the
  // reliable path); "?" opens help; Esc closes an open overlay. "/", "?",
  // and bare digits are ignored while a field has focus so they can still
  // be typed.
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey) rail.classList.add("reveal-keys");

    // While an overlay is open, trap Tab inside it and let Esc close it;
    // nothing else fires.
    const openModal = shortcutsOpen() ? shortcutsModal : welcomeOpen() ? welcomeModal : null;
    if (openModal) {
      if (e.key === "Escape") {
        if (openModal === shortcutsModal) closeShortcuts();
        else closeWelcome();
      } else if (e.key === "Tab") {
        trapTab(e, openModal);
      }
      return;
    }

    const typing = isTypingTarget(document.activeElement);

    // On the empty Search box, swallow a bare "/" — pressing it there is the
    // focus-search reflex, not a character to insert, so it shouldn't leave a
    // stray slash. A non-empty query still keeps "/" so terms like "24/7" work.
    const active = document.activeElement;
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && active && active.id === "query" && active.value === "") {
      e.preventDefault();
      return;
    }

    if (e.key === "?" && !typing) {
      e.preventDefault();
      openShortcuts();
      return;
    }

    const cmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
    const slash = e.key === "/" && !typing;
    if (cmdK || slash) {
      e.preventDefault();
      setActive("search");
      return;
    }

    const digit = e.key >= "1" && e.key <= "9" ? Number(e.key) : 0;
    if (digit) {
      const withMod = e.metaKey || e.ctrlKey;
      const bare = !e.metaKey && !e.ctrlKey && !e.altKey && !typing;
      if (withMod || bare) {
        const item = items[digit - 1];
        if (item) {
          e.preventDefault();
          hideKeys();
          setActive(item.id);
        }
      }
    }
  });

  renderItems();
  applyPinnedState();
  applyThemeUI();
  onNavigate(activeId);
  if (!welcomeDismissed) openWelcome();

  // Reflect the image-crop watcher's live state in the nav. Polled (not
  // pushed) — cheap on localhost, and the watcher can start/stop from
  // its own screen or at boot, so the nav needs to notice either way.
  if (navItemsEl.querySelector('[data-id="image-crop"]')) {
    pollImageCropDot();
    setInterval(pollImageCropDot, 8000);
  }
}
