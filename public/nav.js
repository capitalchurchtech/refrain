/**
 * Nav rail (Section 13) — manual narrow/wide toggle, persisted in
 * config.json's navMode; below 600px an expanded rail shows as icons. Items are
 * driven by /api/modules (Section 17.11: nav renders from registered
 * modules, not hardcoded) plus the always-present core "Health" screen.
 *
 * Also owns theming (Section 2) — Dark/Light/System, cycled via one
 * button, persisted in config.json's theme.
 */

import { crumb } from "./breadcrumbs.js";

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
  // First in Prep: working through last service's flags is prep for the next.
  "slide-flags": 3,
  // Desk work before the service, not during it, so Prep rather than Service
  // (persona panel, handoff section 36): Service holds only what runs live.
  spellcheck: 4,
  "lyrics-assist": 4.5,
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
  "lyrics-assist": "prep",
  spellcheck: "prep",
  "slide-flags": "prep",
  arrangement: "prep",
  "image-crop": "prep",
  "qr-code": "prep",
  "library-sync": "prep",
  health: "system",
};
const DEFAULT_GROUP = "prep";

// Named so a group break can say what it separates. Cold zone, and short
// enough to survive the rail at silkscreen size.
const GROUP_LABEL = {
  service: "Service",
  prep: "Prep",
  system: "System",
};

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

  /**
   * The current screen lives in the URL fragment, so a refresh comes back to
   * where you were instead of dumping you on Search. It went unnoticed for a
   * long time because `npm run dev` runs `node --watch`, which restarts on
   * every server edit -- so everyone working on this was bounced to Search
   * constantly and read it as dev behaviour rather than a defect.
   *
   * The hash is validated on the way in. An unknown id reaching setActive
   * would hide every view and render an empty main, which reads as a crash
   * rather than as a bad URL, so anything unrecognised falls back to Search.
   *
   * This cannot bypass first-run setup: initNav is only ever called from
   * startApp(), which runs after the setup gate.
   *
   * The bonus is that screens become linkable. "Open /#health" is something
   * one church's tech admin can say to another remotely, which matters for a
   * tool with no support channel.
   */
  const hashId = location.hash.slice(1);
  let activeId = items.some((i) => i.id === hashId) ? hashId : (items[0]?.id ?? "search");

  // A bookmarked or shared link to a module that is switched off used to fall
  // through to Search with no word, which reads as a broken link. Say which
  // module and where to turn it on. The name comes from the module's own
  // navLabel, never a literal here.
  const offNotice = document.getElementById("module-off-notice");
  function showModuleOffNotice(id) {
    if (!offNotice) return;
    const off = modules.find((m) => m.id === id && !m.enabled);
    if (!off) {
      offNotice.classList.add("hidden");
      return;
    }
    offNotice.innerHTML = `${escapeText(off.navLabel)} is off. <a href="#health" class="link">Turn it on in Health.</a>`;
    offNotice.classList.remove("hidden");
  }
  function escapeText(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  let currentTheme = prefs.theme ?? "dark";
  // Expanded by default until the user chooses: on a fresh install navPinned
  // is unset (null), so a first-time user sees labels rather than a wall of
  // unlabeled icons. Once they collapse or expand, that choice (true/false)
  // is stored and respected.
  // Three states now. An install that predates them has only navPinned, so map
  // it rather than resetting someone's rail to the default.
  let navMode =
    prefs.navMode ?? (prefs.navPinned == null ? "full" : prefs.navPinned ? "full" : "icons");
  if (!["full", "icons", "sliver"].includes(navMode)) navMode = "full";
  /**
   * The sliver does not survive a reload; it comes back as icons.
   *
   * Every other preference here is a setting, and settings should persist. The
   * sliver is closer to a gesture — you push the rail out of the way for the
   * thing you are doing right now. Reloading is usually what someone does when
   * they are unsure what state they are in, and coming back to a 20px strip is
   * the least helpful answer to that.
   *
   * Only from sliver, and only in this session: the stored value is left alone,
   * so the preference is not quietly rewritten on every page load, and one
   * press of the toggle puts it back.
   */
  if (navMode === "sliver") navMode = "icons";

  function renderItems() {
    let prevGroup = null;
    navItemsEl.innerHTML = items
      .map((item, i) => {
        const group = NAV_GROUP[item.id] ?? DEFAULT_GROUP;
        // A group break is a scored groove in the panel plus, when pinned, a
        // silkscreen label naming what follows. The label is the half that
        // makes the division mean something; collapsed shows the groove only,
        // because a collapsed rail is for someone who already knows the
        // layout.
        // Rendered unconditionally and hidden by CSS when the rail is
        // collapsed. Nav items are built once, before the pin state is
        // applied, so a `pinned` check here renders nothing.
        const isBreak = Boolean(prevGroup) && group !== prevGroup;
        // The first group gets its legend too, with no groove above it -- there
        // is nothing to separate it from. Naming two of three groups would be
        // its own kind of confusing.
        const label = `<div class="rf-group-label">${GROUP_LABEL[group] ?? group}</div>`;
        const divider = isBreak
          ? `<div class="rf-group-break" aria-hidden="true"></div>${label}`
          : i === 0
            ? label
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
        <i data-lucide="${item.icon}" class="shrink-0 w-4 h-4"></i>
        <span class="nav-label whitespace-nowrap ${navMode === "full" ? "" : "hidden"}">${item.navLabel}</span>
        ${keyBadge}
      </button>
    `;
      })
      .join("");

    navItemsEl.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => setActive(btn.dataset.id));
    });

    applyImageCropDot(); // re-apply after every rebuild (innerHTML reset wipes it)
    applyUpdateDot();
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
      // A lit plum LED, not a green circle: green is not in the palette, and
      // this was the only other status light in the rail besides LINKED. It
      // keeps appearing-when-active rather than becoming a permanent unlit
      // dot, because an always-present light on a control is the one thing
      // nothing else in the app does -- while it exists, it is lit, and its
      // absence is the off state.
      dot.className = "watching-dot rf-led lit absolute top-1 right-1";
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

  /**
   * A dot on Health when a newer Refrain exists.
   *
   * The version check has been there all along, but only on the Health screen
   * -- which an operator opens roughly never, so an update could sit unnoticed
   * for months. This is the same quiet LED the Image Crop watcher uses: a
   * change in the rail they already look at, carrying no urgency and blocking
   * nothing. The detail, and the button, stay on Health where they belong.
   *
   * Never on the Search or Live items. Nothing about a software update belongs
   * in the operator's eyeline on the path to going live.
   */
  let updateAvailable = false;
  function applyUpdateDot() {
    const btn = navItemsEl.querySelector('[data-id="health"]');
    if (!btn) return;
    let dot = btn.querySelector(".update-dot");
    if (updateAvailable && !dot) {
      dot = document.createElement("span");
      dot.className = "update-dot rf-led lit absolute top-1 right-1";
      dot.title = "An update is available";
      btn.appendChild(dot);
    } else if (!updateAvailable && dot) {
      dot.remove();
    }
  }

  async function pollUpdateDot() {
    try {
      const u = await fetch("/api/version-check").then((r) => r.json());
      updateAvailable = Boolean(u.updateAvailable);
    } catch {
      // Offline is the normal state for a booth machine. No news is not news.
      updateAvailable = false;
    }
    applyUpdateDot();
  }

  /**
   * Where each screen was left, so coming back does not start at the top.
   *
   * Query and results already survive navigation -- leave Search for Health,
   * come back, and all 117 results are still there. Only the scroll position
   * was lost, which is the difference between a tool and a website: being
   * returned to the top of 117 results mid-service means finding your place
   * again by hand, every time.
   *
   * Screen id to scrollY. Deliberately not persisted across a reload; this is
   * about moving between screens within a sitting.
   */
  const scrollPositions = new Map();

  function restoreScroll(id) {
    const target = scrollPositions.get(id) ?? 0;
    if (!target) {
      window.scrollTo(0, 0);
      return;
    }
    // A screen that rebuilds itself from a fetch is still short on the first
    // frame, so the page cannot reach the target yet. Retry briefly rather
    // than restoring to a height that does not exist -- but stop the moment
    // the operator scrolls, because their intent outranks the restore.
    let attempts = 0;
    let done = false;
    const stop = () => {
      done = true;
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);
    const attempt = () => {
      if (done) return;
      window.scrollTo(0, target);
      if (window.scrollY < target - 1 && attempts++ < 6) {
        setTimeout(attempt, 50);
        return;
      }
      stop();
    };
    // A timer rather than requestAnimationFrame, and the retry loop below uses
    // one too, so the whole restore runs on one clock instead of two.
    setTimeout(attempt, 0);
  }

  function setActive(id) {
    // Which screen, never what was on it.
    crumb("nav", { to: id });
    // Before the switch, or activeId is already the destination.
    if (activeId && activeId !== id) scrollPositions.set(activeId, window.scrollY);
    activeId = id;
    /**
     * replaceState, not pushState. pushState would give back-button navigation
     * between screens, which sounds like a free bonus but adds a second
     * back-affordance competing with the Return bar. Return is a live-path
     * concept with a specific meaning, and a browser Back that walks through
     * screens muddies it. The bug was "do not lose your place on refresh", so
     * that is what this fixes.
     */
    history.replaceState(null, "", `#${id}`);
    offNotice?.classList.add("hidden");
    renderItems();
    onNavigate(id);
    restoreScroll(id);
    // Opening Search puts the cursor in the box, so it's ready to type from
    // any tab (this is what the "/" and Cmd/Ctrl+K shortcuts land on, and
    // it also re-focuses when you click back to the Search tab).
    if (id === "search") focusSearchInput();
  }

  function focusSearchInput() {
    const q = document.getElementById("query");
    if (q) {
      // `preventScroll` matters here: the query box sits at the top of a view
      // that can be 31,000px tall, so a plain focus() scrolls the whole page
      // back to the top -- which silently undid the scroll restore above and
      // made returning to Search always land at result one.
      q.focus({ preventScroll: true });
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

  /**
   * Three rail widths, cycled by one button: full, icons, sliver.
   *
   * The sliver is for a docked booth window, where the rail is the only thing
   * between Refrain's content and the edge of the screen. It keeps nothing but
   * the toggle, and it keeps hover-to-peek — a 20px rail with no way back is a
   * trap, which is why the pre-existing auto-sliver under 449px was gated to
   * pointer devices.
   *
   * That gate matters here too: with no hover there is no peek, so on touch the
   * cycle is two states rather than three. Losing a state is better than losing
   * the way back.
   */
  /**
   * Below 600px the expanded rail takes a third of the panel and clips the
   * screen beside it, so a stored "full" shows as icons there. That is a
   * display rule, not a preference change: nothing is saved, and widening the
   * window brings the labels back. Pressing the toggle while narrow is taken
   * at its word for the rest of the session.
   */
  const narrowQuery = window.matchMedia?.("(max-width: 599px)");
  let expandedWhileNarrow = false;
  const effectiveNavMode = () =>
    navMode === "full" && narrowQuery?.matches && !expandedWhileNarrow ? "icons" : navMode;
  narrowQuery?.addEventListener("change", () => {
    if (!narrowQuery.matches) expandedWhileNarrow = false;
    applyPinnedState();
  });

  function applyPinnedState() {
    const mode = effectiveNavMode();
    const isFull = mode === "full";
    const isSliver = mode === "sliver";
    const pinned = isFull;
    rail.classList.toggle("w-14", mode === "icons");
    rail.classList.toggle("w-36", isFull);
    rail.classList.toggle("w-5", isSliver);
    rail.classList.toggle("sliver", isSliver);
    if (!isSliver) cancelPeek();
    rail.classList.toggle("collapsed", !isFull);
    // The rail is `fixed` (Section 13.1: `sticky` detached from the top
    // near the bottom of a tall page, since a sticky element can't stay
    // pinned past its own container's bottom edge) — taking it out of
    // flow means main has to carry a matching margin instead of the
    // flex layout doing it automatically.
    const mainContent = document.getElementById("main-content");
    mainContent.classList.toggle("ml-14", mode === "icons");
    mainContent.classList.toggle("ml-36", isFull);
    mainContent.classList.toggle("ml-5", isSliver);
    document.querySelectorAll(".nav-label").forEach((el) => el.classList.toggle("hidden", !pinned));
    // Collapsed: just the mark. Expanded: swap in the full wordmark
    // logo, same as expanding replaces every other icon-only nav item
    // with an icon+label.
    brandMark.classList.toggle("hidden", pinned);
    brandLogo.classList.toggle("hidden", !pinned);
    setIcon(pinIcon, isFull ? "chevrons-left" : "chevrons-right");
    pinToggle.title = isFull
      ? "Collapse to icons"
      : mode === "icons"
        ? "Collapse to a sliver"
        : "Show the full menu";
  }

  /**
   * How long the pointer has to rest on the sliver before it opens.
   *
   * The sliver lives against the edge of the screen, which is precisely the
   * path a pointer takes on its way somewhere else, so opening on contact made
   * it flash every time you crossed it. Long enough to mean "I meant that",
   * short enough not to feel broken.
   */
  const PEEK_DELAY_MS = 1500;
  let peekTimer = null;

  function cancelPeek() {
    clearTimeout(peekTimer);
    peekTimer = null;
    rail.classList.remove("peek");
  }

  rail.addEventListener("pointerenter", (e) => {
    // Touch reports as a pointerenter that never leaves, which would pin the
    // rail open with no way to dismiss it. The cycle already skips the sliver
    // without hover; this makes the peek agree.
    if (e.pointerType === "touch") return;
    if (!rail.classList.contains("sliver")) return;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => rail.classList.add("peek"), PEEK_DELAY_MS);
  });

  // Leaving cancels immediately, whether it opened or was still counting down.
  // The delay is for opening; closing promptly is what makes it feel deliberate
  // rather than sticky.
  rail.addEventListener("pointerleave", cancelPeek);

  /** Hover-to-peek is the sliver's way back, so without it the sliver is a trap. */
  function canHover() {
    return window.matchMedia?.("(hover: hover)")?.matches ?? true;
  }

  function nextNavMode(current) {
    const cycle = canHover() ? ["full", "icons", "sliver"] : ["full", "icons"];
    const i = cycle.indexOf(current);
    return cycle[(i + 1) % cycle.length];
  }

  function applyThemeUI() {
    applyTheme(currentTheme);
    themeLabel.textContent = `Theme: ${THEME_LABEL[currentTheme]}`;
    setIcon(themeIcon, THEME_ICON[currentTheme] ?? "sun-moon");
  }

  brandRow.addEventListener("click", () => setActive("search"));

  pinToggle.addEventListener("click", async () => {
    const shown = effectiveNavMode();
    navMode = nextNavMode(shown);
    if (narrowQuery?.matches && navMode === "full") expandedWhileNarrow = true;
    applyPinnedState();
    await fetch("/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ navMode }),
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

  // Welcome / how-to overlay for volunteers. It opens on its own at most once
  // a day per browser, and never over Live or Health: a reload during a
  // service must not put a dialog over Clear, and a volunteer on the phone
  // with IT needs to read Health straight away. "Don't show this" still stops
  // it for good. The day stamp is a per-browser convenience, so storage that
  // throws or comes back empty just means it may show once more.
  const WELCOME_DAY_KEY = "refrain.welcomeShownOn";
  const todayStamp = () => new Date().toLocaleDateString("en-CA");
  const shouldAutoOpenWelcome = (screenId) => {
    if (welcomeDismissed || screenId === "live" || screenId === "health") return false;
    try {
      return localStorage.getItem(WELCOME_DAY_KEY) !== todayStamp();
    } catch {
      return true;
    }
  };
  const markWelcomeShownToday = () => {
    try {
      localStorage.setItem(WELCOME_DAY_KEY, todayStamp());
    } catch {
      // Private window or blocked storage: it shows again next load, no harm.
    }
  };
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

  // Someone editing the fragment by hand, or following a /#health link while
  // the app is already open. Same validation as on boot.
  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (id !== activeId && items.some((i) => i.id === id)) setActive(id);
    else if (!items.some((i) => i.id === id)) {
      showModuleOffNotice(id);
      history.replaceState(null, "", `#${activeId}`);
    }
  });

  renderItems();
  applyPinnedState();
  applyThemeUI();
  // Stamps the fragment on first paint too, so the URL is shareable without
  // having to click a nav key first.
  history.replaceState(null, "", `#${activeId}`);
  onNavigate(activeId);
  if (hashId && hashId !== activeId) showModuleOffNotice(hashId);
  if (shouldAutoOpenWelcome(activeId)) {
    openWelcome();
    markWelcomeShownToday();
  }

  // Reflect the image-crop watcher's live state in the nav. Polled (not
  // pushed) — cheap on localhost, and the watcher can start/stop from
  // its own screen or at boot, so the nav needs to notice either way.
  if (navItemsEl.querySelector('[data-id="image-crop"]')) {
    pollImageCropDot();
    setInterval(pollImageCropDot, 8000);
  }

  // Hourly, and the server caches the answer for six hours, so this is a
  // question GitHub is asked about four times a day per machine rather than
  // once a minute. It is checked at all because the alternative -- only on
  // Health -- is what let updates go unnoticed.
  pollUpdateDot();
  setInterval(pollUpdateDot, 60 * 60_000);
}
