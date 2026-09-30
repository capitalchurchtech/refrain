import { initSetup } from "./setup.js";
// Core, not a module: Search starts on its own, whatever /api/modules says
// (CLAUDE.md rule 1, core search depends on nothing else).
import { initSearch } from "./search.js";
import { initTooltipFit } from "./tooltip-fit.js";
import { initUpdateNudge } from "./update-nudge.js";
import { initHealth } from "./health.js";
import { initPhonePanel } from "./phone-panel.js";
import { initReturnBar } from "./return-bar.js";
import { initStatusCluster } from "./status-cluster.js";
import { installGlobalErrorBoundary, safeRender } from "./error-boundary.js";
import { initNav, applyTheme } from "./nav.js";

const viewSetup = document.getElementById("view-setup");
const viewApp = document.getElementById("view-app");

// The core screens. Module screens are added from /api/modules at start,
// each from its own module.js (see startApp).
const views = {
  search: document.getElementById("view-search"),
  health: document.getElementById("view-health"),
};

// Search's own menu entry, used when /api/modules doesn't answer, so the
// menu still has the one screen that must always work.
const SEARCH_ITEM = { id: "search", navLabel: "Search", icon: "search", enabled: true, nav: { group: "service", order: 0 }, client: null };

async function boot() {
  // Apply theme before anything renders, on setup or main app screens
  // alike, so there's no flash of the wrong theme.
  const prefs = await fetch("/api/preferences").then((r) => r.json()).catch(() => ({ theme: "blackroom" }));
  applyTheme(prefs.theme ?? "blackroom");
  // Same reason as the theme: set the rail's side before anything renders.
  document.documentElement.classList.toggle("rail-right", prefs.navSide === "right");

  const { needsSetup } = await fetch("/api/setup/status").then((r) => r.json());

  if (needsSetup) {
    viewSetup.classList.remove("hidden");
    initSetup({
      onComplete: () => {
        viewSetup.classList.add("hidden");
        startApp();
      },
    });
  } else {
    startApp();
  }

  if (window.lucide) window.lucide.createIcons();
}

async function startApp() {
  installGlobalErrorBoundary();
  viewApp.classList.remove("hidden");
  initTooltipFit();
  initUpdateNudge();
  initSearch();
  const health = initHealth();
  const renderers = { health: health.render };
  initReturnBar();
  initPhonePanel();
  initStatusCluster();

  // Every module brings its own screen: module.js names the script in
  // public/ and the function that builds it. Nothing here lists them, so a
  // new module folder appears with no edit to this file (CLAUDE.md: auto
  // discovery, not central lists). One that fails to load is left out and
  // said so, rather than taking the rest down.
  // Bounded: a request that never answers must not hold up the menu. Search
  // is already running either way.
  const listed = await fetch("/api/modules", { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const modules = Array.isArray(listed?.modules) ? listed.modules : [];
  if (!modules.some((m) => m.id === "search")) modules.push(SEARCH_ITEM);
  const main = document.getElementById("main-content");
  const withScreens = modules.filter((m) => m.client && m.id !== "search");
  const loaded = await Promise.all(
    withScreens.map(async (m) => {
      try {
        return { m, mod: await import(`./${m.client.file}`) };
      } catch (err) {
        console.error(`Couldn't load the ${m.navLabel} screen (${m.client.file}):`, err);
        return null;
      }
    })
  );
  for (const entry of loaded) {
    if (!entry) continue;
    const { m, mod } = entry;
    let el = document.getElementById(`view-${m.id}`);
    if (!el) {
      el = document.createElement("section");
      el.id = `view-${m.id}`;
      el.className = "hidden";
      main.appendChild(el);
    }
    // Only a screen that started gets a menu entry: a misnamed init or one
    // that throws would otherwise be a menu key that opens a blank page.
    if (typeof mod[m.client.init] !== "function") {
      console.error(`The ${m.navLabel} screen has no ${m.client.init}() in ${m.client.file}; it's left out of the menu.`);
      continue;
    }
    try {
      const screen = mod[m.client.init]();
      if (screen?.render) renderers[m.id] = screen.render;
      views[m.id] = el;
    } catch (err) {
      console.error(`The ${m.navLabel} screen didn't start; it's left out of the menu:`, err);
    }
  }

  initNav({
    modules,
    viewIds: new Set(Object.keys(views).filter((id) => id !== "health")),
    onNavigate: (id) => {
      for (const [viewId, el] of Object.entries(views)) {
        el.classList.toggle("hidden", viewId !== id);
      }
      // Guard the render: a thrown renderer must not blank the screen, since
      // the target view is already the only one visible by this point.
      safeRender(renderers[id], views[id], id);
    },
  });
}

boot();
