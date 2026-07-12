import { initSetup } from "./setup.js";
import { initSearch } from "./search.js";
import { initHealth } from "./health.js";
import { initLyricsAssist } from "./lyrics-assist.js";
import { initArrangement } from "./arrangement.js";
import { initImageCrop } from "./image-crop.js";
import { initQrCode } from "./qr-code.js";
import { initNav, applyTheme } from "./nav.js";

const viewSetup = document.getElementById("view-setup");
const viewApp = document.getElementById("view-app");

const views = {
  search: document.getElementById("view-search"),
  health: document.getElementById("view-health"),
  "lyrics-assist": document.getElementById("view-lyrics-assist"),
  arrangement: document.getElementById("view-arrangement"),
  "image-crop": document.getElementById("view-image-crop"),
  "qr-code": document.getElementById("view-qr-code"),
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

async function startApp() {
  viewApp.classList.remove("hidden");
  initSearch();
  const health = initHealth();
  const lyricsAssist = initLyricsAssist();
  const arrangement = initArrangement();
  const imageCrop = initImageCrop();
  const qrCode = initQrCode();

  const renderers = {
    health: health.render,
    "lyrics-assist": lyricsAssist.render,
    arrangement: arrangement.render,
    "image-crop": imageCrop.render,
    "qr-code": qrCode.render,
  };

  const builtInViewIds = ["search", "lyrics-assist", "arrangement", "image-crop", "qr-code"];
  const viewIds = new Set(builtInViewIds);

  // Self-contained modules that ship their own screen (served from
  // modules/<id>/public/<id>.js) instead of being statically wired in
  // above. Their screen JS is imported lazily on first navigation, so a
  // module that's absent or disabled costs the front end nothing. This
  // is generic — it names no specific module.
  try {
    const { modules } = await fetch("/api/modules").then((r) => r.json());
    const mainContent = document.getElementById("main-content");
    for (const m of modules) {
      if (!m.enabled || builtInViewIds.includes(m.id) || views[m.id]) continue;
      const section = document.createElement("section");
      section.id = `view-${m.id}`;
      section.className = "hidden";
      mainContent.appendChild(section);
      views[m.id] = section;
      viewIds.add(m.id);
      let screen = null;
      renderers[m.id] = async () => {
        if (!screen) {
          const mod = await import(`/module-assets/${m.id}/${m.id}.js`);
          const factory = mod.initModule ?? mod.default;
          screen = factory(section, { moduleId: m.id });
        }
        await screen.render();
      };
    }
  } catch {
    // Module discovery failed — the core app still works without it.
  }

  initNav({
    viewIds,
    onNavigate: (id) => {
      for (const [viewId, el] of Object.entries(views)) {
        el.classList.toggle("hidden", viewId !== id);
      }
      renderers[id]?.();
    },
  });
}

boot();
