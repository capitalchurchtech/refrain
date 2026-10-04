/**
 * Quick slides in the menu (owner, 2026-09-30, menu option 4): the first four
 * safe slides and Clear all, reachable from every screen. A volunteer on
 * Prep or Search who needs the logo up now shouldn't have to find Service
 * first.
 *
 * **Every key takes two presses** (owner: "Require confirm click"). The menu
 * is where a pointer passes on its way to everything else, so a stray click
 * here must never reach the screens. The first press arms the key and says so
 * in words; a second within ARM_MS fires it. Arming another key, or waiting,
 * disarms. The Now tab keeps the full set and the editing.
 *
 * Part of the Live module (started from initLive), so a church with Live
 * switched off has no quick slides and core search is untouched.
 */
import { escapeHtml } from "./slide-tools.js";

const ARM_MS = 3000;
const SHOWN = 4;
const REFRESH_MS = 60_000;

/** What the menu shows for a safe-slide list: the first four, and whether there are more. */
export function quickSlidesView(list) {
  const all = Array.isArray(list) ? list : [];
  return { shown: all.slice(0, SHOWN), more: Math.max(0, all.length - SHOWN) };
}

const img = (sl) => `/api/preview/image/${encodeURIComponent(sl.presentationId)}/${sl.slideIndex}`;

export function initQuickSlides() {
  const host = document.getElementById("rail-quick");
  if (!host) return;
  let list = [];
  let picturesShown = true;
  let key = "";
  let armed = null; // { btn, timer }
  let noteTimer = null;

  const disarm = () => {
    if (!armed) return;
    clearTimeout(armed.timer);
    armed.btn.removeAttribute("data-armed");
    armed.btn.setAttribute("aria-label", armed.btn.dataset.name);
    armed = null;
  };

  const say = (btn, text) => {
    const note = host.querySelector(".rf-quick-note");
    if (note) note.textContent = text;
    if (btn) btn.title = text || btn.dataset.name;
  };

  async function post(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  }

  async function press(btn) {
    if (armed?.btn !== btn) {
      disarm();
      clearTimeout(noteTimer);
      btn.title = btn.dataset.name; // drop any earlier "Didn't work"
      btn.dataset.armed = "true";
      btn.setAttribute("aria-label", `${btn.dataset.name}: press again to put it up`);
      if (btn.dataset.clear) btn.setAttribute("aria-label", "Clear all: press again to clear the screens");
      armed = { btn, timer: setTimeout(disarm, ARM_MS) };
      say(null, btn.dataset.clear ? "Press again to clear" : "Press again to show");
      return;
    }
    disarm();
    clearTimeout(noteTimer);
    say(null, "");
    btn.disabled = true;
    try {
      if (btn.dataset.clear) {
        await post("/api/live/clear", { layer: "all" });
      } else {
        const sl = list.find((x) => x.id === btn.dataset.safe);
        if (!sl) throw new Error("That safe slide was removed.");
        // Fired by its anchor, the same way Now's safe keys and Search's Go
        // Live do, so a re-arranged deck can't turn "Logo" into a lyric.
        await post("/api/trigger", { presentationId: sl.presentationId, slideIndex: sl.slideIndex, groupId: sl.groupId, groupOffset: sl.groupOffset, slideText: sl.slideText ?? "", requireAnchor: true });
      }
      // Said, briefly: the operator's eyes are on the screens, not here.
      say(null, btn.dataset.clear ? "Cleared" : `On screen: ${btn.dataset.name}`);
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => say(null, ""), ARM_MS);
    } catch (err) {
      say(btn, `Didn't work: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  function paint() {
    const { shown, more } = quickSlidesView(list);
    const next = JSON.stringify([shown, more, picturesShown]);
    if (next === key) return;
    key = next;
    disarm();
    host.classList.toggle("hidden", !shown.length);
    if (!shown.length) {
      host.innerHTML = "";
      return;
    }
    const keys = shown
      .map(
        (sl, i) => `<button type="button" class="rf-quick-key" data-safe="${escapeHtml(sl.id)}" data-name="${escapeHtml(sl.label)}" title="${escapeHtml(sl.label)}" aria-label="${escapeHtml(sl.label)}">
          <span class="rf-quick-pic${picturesShown ? "" : " rf-quick-nopic"}">${picturesShown ? `<img src="${img(sl)}" alt="" loading="lazy" />` : ""}<span class="rf-quick-fallback">${escapeHtml(sl.label)}</span></span>
          <span class="rf-quick-num" aria-hidden="true"><i data-lucide="shield-check"></i><b>${i + 1}</b></span>
          <span class="rf-quick-again" aria-hidden="true">Again</span>
        </button>`
      )
      .join("");
    host.innerHTML = `
      <div class="rf-group-label">Quick slides</div>
      <div class="rf-quick-grid">${keys}</div>
      ${more ? `<a href="#service/live" class="rf-quick-more" title="All safe slides, on Service › Now">${more} more</a>` : ""}
      <button type="button" class="rf-quick-key rf-quick-clear" data-clear="all" data-name="Clear all" title="Clear all" aria-label="Clear all">
        <i data-lucide="x-octagon"></i><span class="rf-quick-clear-label">Clear all</span>
        <span class="rf-quick-again" aria-hidden="true">Again</span>
      </button>
      <div class="rf-quick-note" role="status" aria-live="polite"></div>`;
    host.querySelectorAll(".rf-quick-pic img").forEach((im) => {
      // No picture (ProPresenter closed, or a deck not indexed): the name instead.
      im.addEventListener("error", () => im.closest(".rf-quick-pic").classList.add("rf-quick-nopic"), { once: true });
    });
    host.querySelectorAll(".rf-quick-key").forEach((b) => b.addEventListener("click", () => press(b)));
    if (window.lucide) window.lucide.createIcons();
  }

  async function load() {
    try {
      const data = await fetch("/api/live/safe-slides").then((r) => r.json());
      list = data.safeSlides ?? [];
      // Slide pictures off: the keys show names, and ask for no picture.
      picturesShown = data.pictures !== false;
    } catch {
      return; // keep what's shown: a blip shouldn't empty the menu
    }
    paint();
  }

  // Now's editor and Search's "keep this slide" say when the list changes;
  // the timer catches another browser on this machine doing it.
  document.addEventListener("refrain:safe-slides-changed", load);
  setInterval(() => {
    if (!document.hidden) load();
  }, REFRESH_MS);
  load();
}
