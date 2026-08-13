import { initSetup } from "./setup.js";
import { initSearch } from "./search.js";
import { initHealth } from "./health.js";
import { initLyricsAssist } from "./lyrics-assist.js";
import { initArrangement } from "./arrangement.js";
import { initImageCrop } from "./image-crop.js";
import { initQrCode } from "./qr-code.js";
import { initSpellcheck } from "./spellcheck.js";
import { initLive } from "./live.js";
import { initScripture } from "./scripture.js";
import { initReturnBar } from "./return-bar.js";
import { installGlobalErrorBoundary, safeRender } from "./error-boundary.js";
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
  spellcheck: document.getElementById("view-spellcheck"),
  live: document.getElementById("view-live"),
  scripture: document.getElementById("view-scripture"),
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
  installGlobalErrorBoundary();
  viewApp.classList.remove("hidden");
  initSearch();
  const health = initHealth();
  const lyricsAssist = initLyricsAssist();
  const arrangement = initArrangement();
  const imageCrop = initImageCrop();
  const qrCode = initQrCode();
  const spellcheck = initSpellcheck();
  const live = initLive();
  const scripture = initScripture();
  initReturnBar();

  const renderers = {
    health: health.render,
    "lyrics-assist": lyricsAssist.render,
    arrangement: arrangement.render,
    "image-crop": imageCrop.render,
    "qr-code": qrCode.render,
    spellcheck: spellcheck.render,
    live: live.render,
    scripture: scripture.render,
  };

  initNav({
    viewIds: new Set(["search", "lyrics-assist", "arrangement", "image-crop", "qr-code", "spellcheck", "live", "scripture"]),
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
