import { initSetup } from "./setup.js";
import { initSearch } from "./search.js";
import { initHealth } from "./health.js";
import { initNav, applyTheme } from "./nav.js";

const viewSetup = document.getElementById("view-setup");
const viewApp = document.getElementById("view-app");
const viewSearch = document.getElementById("view-search");
const viewHealth = document.getElementById("view-health");

async function boot() {
  // Apply theme before anything renders, on setup or main app screens
  // alike, so there's no flash of the wrong theme.
  const prefs = await fetch("/api/preferences").then((r) => r.json()).catch(() => ({ theme: "system" }));
  applyTheme(prefs.theme ?? "system");

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

function startApp() {
  viewApp.classList.remove("hidden");
  initSearch();
  const health = initHealth();

  initNav({
    viewIds: new Set(["search"]),
    onNavigate: (id) => {
      const isSearch = id === "search";
      viewSearch.classList.toggle("hidden", !isSearch);
      viewHealth.classList.toggle("hidden", isSearch);
      if (id === "health") health.render();
    },
  });
}

boot();
