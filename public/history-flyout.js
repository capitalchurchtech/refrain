import { showFailure } from "./notice.js";
import { escapeHtml } from "./slide-tools.js";

/**
 * The History key and its flyout (owner, 2026-10-07).
 *
 * Every item that has been on the screens this service, newest first, kept by
 * the server (30 places; see server/return-history.js). The flyout opens on
 * hover or press and lets the operator step Back and Forward through them like
 * a browser, or press any row.
 *
 * **Nothing here goes to the screens.** Going to a place opens that
 * presentation in ProPresenter's editor, the same focus-only action as Show,
 * because returning mid-service must never change what the audience sees. Back
 * and Forward move a cursor over the list; they do not trigger anything.
 *
 * Each place also says when it started, how long it was up and when it left,
 * from the server's item splits (the phone's History, 2026-10-09; added here on
 * 2026-10-11). The item on the screens now counts up and is marked Live.
 *
 * The cursor lives here, in the browser, and goes back to the newest place when
 * the newest place changes. Forward is only "the place I was before I pressed
 * Back", which is all the server's list needs to answer.
 */

const POLL_MS = 4000;

/** "now", "2 min ago", "1 h ago": when an item went up, to the nearest minute. */
export function agoText(iso, now = Date.now()) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return "now";
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}

/**
 * What the flyout shows for a history list and a cursor. Pure, for tests.
 * Index 0 is the newest; Back moves toward older entries, Forward toward newer.
 */
export function historyView(history, cursor, now = Date.now()) {
  const list = Array.isArray(history) ? history : [];
  const c = Math.min(Math.max(Number.isInteger(cursor) ? cursor : 0, 0), Math.max(list.length - 1, 0));
  return {
    cursor: c,
    rows: list.map((e, i) => ({ ...e, i, ago: agoText(e.leftAt, now), current: i === c })),
    back: c < list.length - 1 ? list[c + 1] : null,
    forward: c > 0 ? list[c - 1] : null,
  };
}

/** "5:12" or "1:05:12": a length of time. */
export function durationText(ms) {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const clockText = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

/**
 * The times line for one place, from the latest stay the server counted for
 * that presentation, or null when it has none (a place from before the server
 * started counting). `heardAt` is when the splits arrived, so the running
 * item keeps counting between polls. Pure, for tests.
 */
export function placeTimes(splits, entry, heardAt, now = Date.now()) {
  const s = (Array.isArray(splits) ? splits : []).find((x) => x.presentationId === entry?.presentationId);
  if (!s) return null;
  const elapsed = s.elapsedMs + (s.current ? Math.max(0, now - heardAt) : 0);
  return { live: Boolean(s.current) && !s.blank, cleared: Boolean(s.current) && Boolean(s.blank), started: clockText(s.startedAt), elapsed: durationText(elapsed), left: s.current ? "" : clockText(s.endedAt) };
}

const label = (e) => `${e.name ?? "Untitled"} #${e.slideIndex + 1}`;

export function initHistoryFlyout() {
  const key = document.getElementById("history-key");
  const flyout = document.getElementById("history-flyout");
  const rail = document.getElementById("nav-rail");
  if (!key || !flyout || !rail) return;

  let history = [];
  let splits = [];
  let splitsAt = Date.now(); // when `splits` arrived
  let cursor = 0;
  let headKey = "";
  let pinned = false; // opened by a press, so moving the mouse away does not close it
  let closeTimer = null;
  let pollTimer = null;
  let tickTimer = null;

  function place() {
    // Beside the rail, on whichever side it is, level with its key.
    const r = rail.getBoundingClientRect();
    const k = key.getBoundingClientRect();
    const onRight = document.documentElement.classList.contains("rail-right");
    // History is the fourth key, not the last, so the flyout hangs from its key
    // and scrolls inside itself rather than running off the screen.
    const top = Math.max(8, k.top - 8);
    flyout.style.bottom = "auto";
    flyout.style.top = `${top}px`;
    flyout.style.maxHeight = `${Math.max(160, window.innerHeight - top - 8)}px`;
    if (onRight) {
      flyout.style.right = `${window.innerWidth - r.left}px`;
      flyout.style.left = "auto";
    } else {
      flyout.style.left = `${r.right}px`;
      flyout.style.right = "auto";
    }
  }

  const timesHtml = (t) =>
    t
      ? `<span class="rf-hf-times${t.live ? " live" : ""}">${t.live ? `<b>Live</b> · ` : t.cleared ? `<b>Screens clear</b> · ` : ""}started ${escapeHtml(t.started)} · <span ${t.live || t.cleared ? "data-hf-tick" : ""}>${escapeHtml(t.elapsed)}</span>${t.left ? ` · left ${escapeHtml(t.left)}` : ""}</span>`
      : "";

  function paint() {
    const v = historyView(history, cursor);
    cursor = v.cursor;
    const hasAny = v.rows.length > 0;
    flyout.innerHTML = `
      <div class="rf-hf-head">History</div>
      <div class="rf-hf-nav">
        <button type="button" class="btn btn-outline" data-hf="back" ${v.back ? "" : "disabled"}>&lsaquo; Back</button>
        <button type="button" class="btn btn-outline" data-hf="forward" ${v.forward ? "" : "disabled"}>Forward &rsaquo;</button>
      </div>
      <p class="rf-hint rf-hf-target">${
        !hasAny
          ? "Nothing has been on the screens yet."
          : v.back
            ? `Back opens <b>${escapeHtml(label(v.back))}</b> in the editor.`
            : "That is the oldest place kept."
      }</p>
      <div class="rf-hf-list">${v.rows
        .map(
          (r) => `<button type="button" class="rf-hf-row${r.current ? " current" : ""}" data-i="${r.i}" title="Opens in ProPresenter's editor. Nothing goes to the screens.">
            <span class="rf-hf-name">${escapeHtml(r.name ?? "Untitled")}</span>
            <span class="rf-hf-meta"><span class="rf-hf-slide">#${r.slideIndex + 1}</span><span class="rf-hf-ago">${escapeHtml(r.ago)}</span><span class="rf-hf-go">Show</span></span>
            ${timesHtml(placeTimes(splits, r, splitsAt))}
          </button>`
        )
        .join("")}</div>
      ${hasAny ? `<p class="rf-hint">${v.rows.length} place${v.rows.length === 1 ? "" : "s"} kept. Opens in the editor, never on the screens.</p>` : ""}`;
  }

  async function openAt(i) {
    const entry = history[i];
    if (!entry) return;
    cursor = i;
    paint();
    try {
      const res = await fetch("/api/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presentationId: entry.presentationId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    } catch (err) {
      showFailure(`Couldn't open ${entry.name ?? "that"} in ProPresenter: ${err.message}. Nothing on the screens changed.`);
    }
  }

  async function load() {
    try {
      const data = await fetch("/api/return-pin").then((r) => r.json());
      history = Array.isArray(data.history) ? data.history : [];
      splits = Array.isArray(data.splits) ? data.splits : [];
      splitsAt = Date.now();
      // A new newest place puts the cursor back on it.
      const k = history[0] ? `${history[0].presentationId}:${history[0].slideIndex}` : "";
      if (k !== headKey) {
        headKey = k;
        cursor = 0;
      }
      if (!flyout.hidden) paint();
    } catch {
      // Keep what is shown; the next poll tries again.
    }
  }

  function setOpen(open) {
    clearTimeout(closeTimer);
    flyout.hidden = !open;
    key.setAttribute("aria-expanded", String(open));
    clearInterval(pollTimer);
    clearInterval(tickTimer);
    if (open) {
      place();
      load().then(paint);
      paint();
      pollTimer = setInterval(load, POLL_MS);
      // The running item counts on between polls.
      tickTimer = setInterval(() => {
        const el = flyout.querySelector("[data-hf-tick]");
        const live = splits.find((x) => x.current);
        if (el && live) el.textContent = durationText(live.elapsedMs + (Date.now() - splitsAt));
      }, 1000);
    } else {
      pinned = false;
    }
  }
  const closeSoon = () => {
    if (pinned) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setOpen(false), 250);
  };

  // Hover opens it, a press holds it open (and is how a touch screen gets it).
  key.addEventListener("mouseenter", () => {
    clearTimeout(closeTimer);
    if (flyout.hidden) setOpen(true);
  });
  key.addEventListener("mouseleave", closeSoon);
  flyout.addEventListener("mouseenter", () => clearTimeout(closeTimer));
  flyout.addEventListener("mouseleave", closeSoon);
  // The Return bar's History handle (public/return-bar.js) opens the same
  // flyout, held open as a press on the key holds it, and closes it when pressed
  // again. It hangs from the key, since that is where History lives.
  window.toggleHistoryFlyout = () => {
    if (!flyout.hidden && pinned) return setOpen(false);
    pinned = true;
    if (flyout.hidden) setOpen(true);
  };
  key.addEventListener("click", (e) => {
    if (!flyout.hidden && pinned) return setOpen(false);
    pinned = true;
    const wasHidden = flyout.hidden;
    if (wasHidden) setOpen(true);
    // Opened from the keyboard (Enter or Space has no pointer position): the
    // flyout sits apart from the rail in the page, so Tab would never reach it.
    // Put focus on its first control; Esc closes it and returns here.
    if (wasHidden && e.detail === 0) flyout.querySelector("button:not([disabled])")?.focus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !flyout.hidden) {
      setOpen(false);
      key.focus();
    }
  });
  // composedPath, not contains(): a press inside repaints the flyout, which
  // detaches the pressed button before this runs, and a detached target looks
  // like a press outside.
  document.addEventListener("click", (e) => {
    const path = e.composedPath();
    // A handle that opens History is a press on History, not outside it.
    const onHandle = path.some((el) => el.hasAttribute?.("data-opens-history"));
    if (!flyout.hidden && !path.includes(flyout) && !path.includes(key) && !onHandle) setOpen(false);
  });
  window.addEventListener("resize", () => !flyout.hidden && place());

  flyout.addEventListener("click", (e) => {
    const row = e.target.closest(".rf-hf-row");
    if (row) return openAt(Number(row.dataset.i));
    const nav = e.target.closest("[data-hf]");
    if (!nav || nav.disabled) return;
    const v = historyView(history, cursor);
    if (nav.dataset.hf === "back" && v.back) openAt(v.cursor + 1);
    if (nav.dataset.hf === "forward" && v.forward) openAt(v.cursor - 1);
  });
}
