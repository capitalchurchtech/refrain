import { showFailure } from "./notice.js";

/**
 * "Flag this slide" and the list it feeds (issue #1).
 *
 * The button is a Tier 3 chip on purpose. It sits under the Search readout,
 * in the operator's eyeline on the path to live, and it must never be
 * mistaken for Go Live or a Clear: it changes nothing on the screens, so it
 * does not get to look like something that does. One press, no dialog, no
 * typing -- whoever is running a service has one hand free at most.
 *
 * It answers instantly (the chip reads "Flagging..." before the server replies)
 * for the same reason the readout paints optimistically: a press that shows
 * nothing gets pressed twice, and two identical flags are noise in a list
 * someone has to work through after the service.
 */

const FLAG_EVENT = "refrain:flag-added";
const LIST_LIMIT = 50;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * What to tell the operator about a save. Pure, so the one sentence that must
 * never lie -- "saved" when it was not -- is tested.
 */
export function describeFlagSave(result) {
  const f = result?.flag ?? {};
  const where = `${f.presentationName ?? "that presentation"}, slide ${Number.isInteger(f.slideIndex) ? f.slideIndex + 1 : "?"}`;
  if (result?.shared === false) {
    return `Flagged ${where}. Saved on this machine; it will copy to the shared flags folder once it can reach it.`;
  }
  return `Flagged ${where}.`;
}

export function mountFlagButton(host) {
  if (!host) return;
  host.innerHTML = `
    <div class="flex items-center gap-2 flex-wrap">
      <button type="button" class="btn btn-chip slide-flag-btn" title="Remember this slide to fix after the service. Nothing on the screens changes.">
        <i data-lucide="flag" class="w-3 h-3"></i> <span class="slide-flag-label">Flag this slide</span>
      </button>
      <span class="slide-flag-status text-xs opacity-60" aria-live="polite"></span>
    </div>`;
  if (window.lucide) window.lucide.createIcons();

  const btn = host.querySelector(".slide-flag-btn");
  const label = host.querySelector(".slide-flag-label");
  const status = host.querySelector(".slide-flag-status");
  let resetTimer = null;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    clearTimeout(resetTimer);
    label.textContent = "Flagging...";
    try {
      const res = await fetch("/api/slide-flags", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The flag was not saved.");
      label.textContent = "Flagged";
      status.textContent = describeFlagSave(data);
      window.dispatchEvent(new CustomEvent(FLAG_EVENT, { detail: data.flag }));
    } catch (err) {
      label.textContent = "Flag this slide";
      status.textContent = "";
      showFailure(err.message);
    } finally {
      btn.disabled = false;
      resetTimer = setTimeout(() => {
        label.textContent = "Flag this slide";
      }, 2000);
    }
  });
}

/** Flags grouped under the local day they were captured, newest day first. Pure. */
export function groupFlagsByDay(flags) {
  const groups = new Map();
  for (const f of flags ?? []) {
    const d = new Date(f.capturedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, { day: key, date: d, flags: [] });
    groups.get(key).flags.push(f);
  }
  return [...groups.values()].sort((a, b) => b.day.localeCompare(a.day));
}

/** The list's markup. Pure, so escaping and the empty state are tested. */
export function renderFlagListHtml(flags) {
  const all = flags ?? [];
  if (all.length === 0) {
    return `<div class="text-sm opacity-70 rf-measure">Nothing flagged yet. During a service, press <strong>Flag this slide</strong> under the readout on Search, or here.</div>`;
  }
  const shown = all.slice(0, LIST_LIMIT);
  // Only name the machine when more than one is flagging -- on a single-machine
  // install it is the same word on every row.
  const machines = new Set(shown.map((f) => f.machine).filter(Boolean));
  const days = groupFlagsByDay(shown)
    .map(
      (g) => `
      <div class="flex flex-col gap-2">
        <div class="rf-silkscreen">${escapeHtml(g.date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }))}</div>
        ${g.flags
          .map(
            (f) => `
          <div class="text-sm bg-base-100 rounded p-2 flex flex-col gap-1">
            <div class="flex items-center justify-between gap-2">
              <span class="min-w-0">
                <span class="opacity-60 tabular-nums">${escapeHtml(new Date(f.capturedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))}</span>
                <strong>${escapeHtml(f.presentationName ?? "Untitled")}</strong>
                <span class="opacity-70">slide ${Number.isInteger(f.slideIndex) ? f.slideIndex + 1 : "?"}${f.arrangementName ? ` · ${escapeHtml(f.arrangementName)}` : ""}</span>
              </span>
              <button type="button" class="btn btn-chip shrink-0 slide-flag-editor-btn" data-presentation-id="${escapeHtml(f.presentationId)}">Show in Editor</button>
            </div>
            ${
              f.text
                ? `<div class="whitespace-pre-line opacity-80">${escapeHtml(f.text)}</div>`
                : // A blank slide is often exactly what gets flagged -- a wrong
                  // background -- so say it was blank rather than show nothing,
                  // which reads like missing data.
                  `<div class="text-xs opacity-60 italic">No text on this slide.</div>`
            }
            <div class="text-xs opacity-60">
              ${[
                f.wasOnScreen === false ? "not on the screens when flagged" : "",
                f.pending ? "waiting to copy to the shared flags folder" : "",
                machines.size > 1 && f.machine ? `from ${escapeHtml(f.machine)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>`
          )
          .join("")}
      </div>`
    )
    .join("");
  const older = all.length - shown.length;
  return `${days}${older > 0 ? `<div class="text-xs opacity-60">${older} older flag${older === 1 ? "" : "s"} not shown.</div>` : ""}`;
}

export async function renderFlagList(host) {
  if (!host) return;
  try {
    const res = await fetch("/api/slide-flags");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    host.innerHTML = renderFlagListHtml(data.flags);
  } catch (err) {
    host.innerHTML = `<div class="text-sm opacity-70">Couldn't load flagged slides: ${escapeHtml(err.message)}</div>`;
    return;
  }
  host.querySelectorAll(".slide-flag-editor-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const res = await fetch("/api/focus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presentationId: btn.dataset.presentationId }),
        });
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({}));
          showFailure(`Didn't open the editor: ${error ?? "ProPresenter didn't answer"}. Nothing on the screens changed.`);
        }
      } finally {
        btn.disabled = false;
      }
    });
  });
}

/**
 * Re-render the list with this id whenever a flag is added anywhere on the
 * page. Registered once per id and looked up fresh each time: a screen that
 * re-renders replaces its elements, and a listener holding the old one would
 * pile up and write into a detached node.
 */
const refreshing = new Set();
export function refreshOnNewFlags(hostId) {
  if (refreshing.has(hostId)) return;
  refreshing.add(hostId);
  window.addEventListener(FLAG_EVENT, () => {
    const host = document.getElementById(hostId);
    if (host) renderFlagList(host);
  });
}
