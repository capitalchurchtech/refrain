import { initSetup } from "./setup.js";
import { initSearch } from "./search.js";
import { initHealth } from "./health.js";
import { initLyricsAssist } from "./lyrics-assist.js";
import { initNav, applyTheme } from "./nav.js";

const viewSetup = document.getElementById("view-setup");
const viewApp = document.getElementById("view-app");

const views = {
  search: document.getElementById("view-search"),
  health: document.getElementById("view-health"),
  "lyrics-assist": document.getElementById("view-lyrics-assist"),
};

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
  const lyricsAssist = initLyricsAssist();

  const renderers = { health: health.render, "lyrics-assist": lyricsAssist.render };

  initNav({
    viewIds: new Set(["search", "lyrics-assist"]),
    onNavigate: (id) => {
      for (const [viewId, el] of Object.entries(views)) {
        el.classList.toggle("hidden", viewId !== id);
      }
      renderers[id]?.();
    },
  });
}

boot();
