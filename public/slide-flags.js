import { showFailure } from "./notice.js";

/**
 * Flagging slides during a service, and working through them after it
 * (issues #1 and #2).
 *
 * Three surfaces, one module:
 *
 * - **"Flag this slide"**, a chip under the Search readout. The fast path:
 *   untyped, one press. A Tier 3 chip on purpose -- it sits in the operator's
 *   eyeline on the path to live and changes nothing on the screens, so it must
 *   never read as Go Live or a Clear.
 * - **The type grid**, on the Live screen. One tap picks what kind of problem
 *   it was AND captures the slide. Alphabetical and left-aligned, because
 *   mid-service the operator is scanning, not reading.
 * - **The Flags screen**, for afterwards: grouped by day and by presentation in
 *   the order they came up, each with its note, type, resolved state and Show
 *   in Editor.
 *
 * Every press answers instantly ("Flagging...") before the server replies, for
 * the same reason the readout paints optimistically: a press that shows
 * nothing gets pressed twice, and a duplicate is noise in a list someone has
 * to work through.
 */

const FLAG_EVENT = "refrain:flag-added";
const LIST_LIMIT = 200;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const slideNumber = (f) => (Number.isInteger(f.slideIndex) ? f.slideIndex + 1 : "?");

/**
 * What to tell the operator about a save. Pure, so the one sentence that must
 * never lie -- "saved" when it was not -- is tested.
 */
export function describeFlagSave(result) {
  const f = result?.flag ?? {};
  const kind = f.type ? ` as ${f.type}` : "";
  const where = `${f.presentationName ?? "that presentation"}, slide ${slideNumber(f)}`;
  if (result?.shared === false) {
    return `Flagged ${where}${kind}. Saved on this machine; it will copy to the shared flags folder once it can reach it.`;
  }
  return `Flagged ${where}${kind}.`;
}

/** POSTs a capture, with the failure handling both surfaces share. */
async function capture(type) {
  const res = await fetch("/api/slide-flags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(type ? { type } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "The flag was not saved.");
  window.dispatchEvent(new CustomEvent(FLAG_EVENT, { detail: data.flag }));
  return data;
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
      const data = await capture(null);
      label.textContent = "Flagged";
      status.textContent = describeFlagSave(data);
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

/**
 * The grid's markup. Pure. Types arrive already sorted from the server -- the
 * sort lives in one place (server/slide-flags.js flagTypes) so a team's own
 * types slot into the right place wherever they are shown.
 */
export function renderTypeGridHtml(types) {
  return `
    <div class="grid grid-cols-3 gap-2 slide-flag-grid">
      ${(types ?? [])
        .map(
          (t) => `
        <button type="button" class="btn btn-chip h-auto py-2 flex-col items-start justify-start gap-1 text-left slide-flag-type-btn" data-type="${escapeHtml(t.label)}" title="Flag the live slide as: ${escapeHtml(t.label)}">
          <i data-lucide="${escapeHtml(t.icon)}" class="w-4 h-4"></i>
          <span class="slide-flag-type-label leading-tight normal-case">${escapeHtml(t.label)}</span>
        </button>`
        )
        .join("")}
    </div>
    <div class="slide-flag-grid-status text-xs opacity-60 mt-2" aria-live="polite"></div>`;
}

export function mountTypeGrid(host, types) {
  if (!host) return;
  host.innerHTML = renderTypeGridHtml(types);
  if (window.lucide) window.lucide.createIcons();
  const status = host.querySelector(".slide-flag-grid-status");
  host.querySelectorAll(".slide-flag-type-btn").forEach((btn) => {
    const label = btn.querySelector(".slide-flag-type-label");
    btn.addEventListener("click", async () => {
      const type = btn.dataset.type;
      btn.disabled = true;
      label.textContent = "Flagging...";
      try {
        const data = await capture(type);
        status.textContent = describeFlagSave(data);
      } catch (err) {
        status.textContent = "";
        showFailure(err.message);
      } finally {
        btn.disabled = false;
        label.textContent = type;
      }
    });
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

/**
 * Within one day, flags by presentation in the order the presentations came up
 * -- the issue's "in service order" -- and each presentation's flags by time.
 * The first flag's time is the proxy for when a presentation was on: Refrain
 * does not keep a service timeline (that is issue #6), and a flag is only ever
 * captured while its presentation is up. Pure.
 */
export function groupByPresentation(flags) {
  const byPres = new Map();
  for (const f of flags ?? []) {
    const key = f.presentationId ?? f.presentationName ?? "?";
    if (!byPres.has(key)) byPres.set(key, { presentationId: f.presentationId, presentationName: f.presentationName, flags: [] });
    byPres.get(key).flags.push(f);
  }
  const groups = [...byPres.values()];
  for (const g of groups) g.flags.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  return groups.sort((a, b) => a.flags[0].capturedAt.localeCompare(b.flags[0].capturedAt));
}

/** One flag's row on the Flags screen. */
function renderReviewRow(f, types, showMachine) {
  const typeOptions = [`<option value="" ${f.type ? "" : "selected"}>No type</option>`]
    .concat(types.map((t) => `<option value="${escapeHtml(t.label)}" ${t.label === f.type ? "selected" : ""}>${escapeHtml(t.label)}</option>`))
    .join("");
  // A type since removed from config is still shown, not silently turned into
  // "No type" the moment someone opens the list.
  const orphanType = f.type && !types.some((t) => t.label === f.type) ? `<option value="${escapeHtml(f.type)}" selected>${escapeHtml(f.type)}</option>` : "";
  const facts = [
    f.wasOnScreen === false ? "not on the screens when flagged" : "",
    f.pending ? "waiting to copy to the shared flags folder" : "",
    showMachine && f.machine ? `from ${escapeHtml(f.machine)}` : "",
  ].filter(Boolean);
  return `
    <div class="text-sm bg-base-100 rounded p-2 flex flex-col gap-2 slide-flag-row ${f.resolved ? "opacity-60" : ""}" data-flag-id="${escapeHtml(f.id)}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <span class="opacity-60 tabular-nums">${escapeHtml(new Date(f.capturedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))}</span>
          <span>slide ${slideNumber(f)}${f.arrangementName ? ` · ${escapeHtml(f.arrangementName)}` : ""}</span>
          ${f.resolved ? `<span class="badge badge-ghost badge-sm ml-1">Resolved</span>` : ""}
        </div>
        <button type="button" class="btn btn-chip shrink-0 slide-flag-editor-btn" data-presentation-id="${escapeHtml(f.presentationId)}" title="Opens the presentation in ProPresenter's editor. It can't select the slide for you, so the number says which one.">Show slide ${slideNumber(f)} in Editor</button>
      </div>
      ${
        f.text
          ? `<div class="whitespace-pre-line opacity-80">${escapeHtml(f.text)}</div>`
          : // A blank slide is often exactly what gets flagged -- a wrong
            // background -- so say it was blank rather than show nothing,
            // which reads like missing data.
            `<div class="text-xs opacity-60 italic">No text on this slide.</div>`
      }
      ${facts.length ? `<div class="text-xs opacity-60">${facts.join(" · ")}</div>` : ""}
      <div class="flex flex-wrap items-center gap-2">
        <label class="sr-only" for="flag-type-${escapeHtml(f.id)}">Type</label>
        <select id="flag-type-${escapeHtml(f.id)}" class="select select-bordered select-xs slide-flag-type-select">${typeOptions}${orphanType}</select>
        <button type="button" class="btn btn-chip slide-flag-resolve-btn" data-resolved="${f.resolved ? "1" : "0"}">${f.resolved ? "Reopen" : "Mark resolved"}</button>
      </div>
      <div class="flex flex-col gap-1">
        <label class="sr-only" for="flag-note-${escapeHtml(f.id)}">Note</label>
        <textarea id="flag-note-${escapeHtml(f.id)}" class="textarea textarea-bordered textarea-xs slide-flag-note" rows="2" placeholder="Add a note">${escapeHtml(f.note ?? "")}</textarea>
        <div class="flex items-center gap-2">
          <button type="button" class="btn btn-chip slide-flag-note-save hidden">Save note</button>
          <span class="slide-flag-row-status text-xs opacity-60" aria-live="polite"></span>
        </div>
      </div>
    </div>`;
}

/** The Flags screen's list. Pure, so escaping, grouping and the empty state are tested. */
export function renderReviewHtml(flags, types = [], { hiddenResolved = 0, keepResolvedDays = 14 } = {}) {
  const all = flags ?? [];
  const hiddenNote = hiddenResolved
    ? `<div class="text-xs opacity-60">${hiddenResolved} resolved flag${hiddenResolved === 1 ? "" : "s"} older than ${keepResolvedDays} days not shown. They are kept, not deleted.</div>`
    : "";
  if (all.length === 0) {
    return `
      <div class="text-sm opacity-70 rf-measure">Nothing flagged. During a service, press <strong>Flag this slide</strong> under the readout on Search, or pick a type on the Live screen.</div>
      ${hiddenNote}`;
  }
  const shown = all.slice(0, LIST_LIMIT);
  // Only name the machine when more than one is flagging -- on a single-machine
  // install it is the same word on every row.
  const machines = new Set(shown.map((f) => f.machine).filter(Boolean));
  const open = shown.filter((f) => !f.resolved).length;
  const days = groupFlagsByDay(shown)
    .map(
      (day) => `
      <div class="flex flex-col gap-3">
        <div class="rf-silkscreen">${escapeHtml(day.date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }))}</div>
        ${groupByPresentation(day.flags)
          .map(
            (p) => `
          <div class="card bg-base-200">
            <div class="card-body p-3 gap-2">
              <div class="font-medium">${escapeHtml(p.presentationName ?? "Untitled")}</div>
              ${p.flags.map((f) => renderReviewRow(f, types, machines.size > 1)).join("")}
            </div>
          </div>`
          )
          .join("")}
      </div>`
    )
    .join("");
  const older = all.length - shown.length;
  return `
    <div class="text-sm opacity-70">${open} open, ${shown.length - open} resolved.</div>
    ${days}
    ${older > 0 ? `<div class="text-xs opacity-60">${older} older flag${older === 1 ? "" : "s"} not shown.</div>` : ""}
    ${hiddenNote}`;
}

async function postChange(flagIdValue, change) {
  const res = await fetch(`/api/slide-flags/${encodeURIComponent(flagIdValue)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "That change was not saved.");
  return data;
}

function wireReview(host, reload) {
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

  host.querySelectorAll(".slide-flag-row").forEach((row) => {
    const id = row.dataset.flagId;
    const status = row.querySelector(".slide-flag-row-status");
    const note = row.querySelector(".slide-flag-note");
    const saveNote = row.querySelector(".slide-flag-note-save");
    const initialNote = note.value;
    const say = (data) => {
      status.textContent = data.shared === false ? "Saved on this machine; waiting to copy to the shared folder." : "Saved.";
    };

    note.addEventListener("input", () => saveNote.classList.toggle("hidden", note.value === initialNote));
    saveNote.addEventListener("click", async () => {
      saveNote.disabled = true;
      try {
        say(await postChange(id, { note: note.value }));
        await reload();
      } catch (err) {
        showFailure(err.message);
      } finally {
        saveNote.disabled = false;
      }
    });

    row.querySelector(".slide-flag-type-select").addEventListener("change", async (e) => {
      const select = e.currentTarget; // captured before the await
      select.disabled = true;
      try {
        say(await postChange(id, { type: select.value || null }));
      } catch (err) {
        showFailure(err.message);
      } finally {
        select.disabled = false;
      }
    });

    row.querySelector(".slide-flag-resolve-btn").addEventListener("click", async (e) => {
      const btn = e.currentTarget; // captured before the await
      btn.disabled = true;
      try {
        await postChange(id, { resolved: btn.dataset.resolved !== "1" });
        await reload();
      } catch (err) {
        btn.disabled = false;
        showFailure(err.message);
      }
    });
  });
}

/** The Flags screen. */
export function initSlideFlags() {
  const container = document.getElementById("view-slide-flags");

  async function load() {
    const list = document.getElementById("slide-flags-list");
    if (!list) return;
    try {
      const res = await fetch("/api/slide-flags");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      list.innerHTML = renderReviewHtml(data.flags, data.types, data);
    } catch (err) {
      list.innerHTML = `<div class="text-sm opacity-70">Couldn't load flagged slides: ${escapeHtml(err.message)}</div>`;
      return;
    }
    if (window.lucide) window.lucide.createIcons();
    wireReview(list, load);
  }

  async function render() {
    if (!container) return;
    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        <div>
          <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="flag" class="w-5 h-5"></i> Flags</h1>
          <p class="text-sm opacity-70">Slides flagged during a service, to fix now it is over. Show in Editor opens each one in ProPresenter.</p>
        </div>
        <div id="slide-flags-list" class="flex flex-col gap-4 text-sm opacity-70">Loading...</div>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    await load();
  }

  window.addEventListener(FLAG_EVENT, () => {
    if (container && !container.classList.contains("hidden")) load();
  });
  return { render };
}

/**
 * The Live screen's section: the type grid, and how many are open with a way
 * to the Flags screen. The full list lives there; during a service this
 * section only needs to capture.
 */
export async function mountLiveFlags(gridHost, summaryHost) {
  let types = [];
  let flags = [];
  try {
    const res = await fetch("/api/slide-flags");
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      types = data.types ?? [];
      flags = data.flags ?? [];
    }
  } catch {
    // The grid still renders from nothing; the summary just says so.
  }
  mountTypeGrid(gridHost, types);
  renderLiveSummary(summaryHost, flags);
}

export function liveSummaryText(flags) {
  const open = (flags ?? []).filter((f) => !f.resolved).length;
  if (open === 0) return "Nothing flagged and open.";
  return `${open} flagged slide${open === 1 ? "" : "s"} open.`;
}

function renderLiveSummary(host, flags) {
  if (!host) return;
  host.innerHTML = `
    <div class="flex items-center gap-2 text-sm">
      <span class="opacity-70 slide-flag-live-summary">${escapeHtml(liveSummaryText(flags))}</span>
      <a href="#slide-flags" class="link text-sm">Review</a>
    </div>`;
}

/**
 * Keep the Live summary current as flags are added anywhere on the page.
 * Registered once and looked up fresh each time: a screen that re-renders
 * replaces its elements, and a listener holding the old one would pile up and
 * write into a detached node.
 */
let liveSummaryWired = false;
export function refreshLiveSummaryOnNewFlags(summaryHostId) {
  if (liveSummaryWired) return;
  liveSummaryWired = true;
  window.addEventListener(FLAG_EVENT, async () => {
    const host = document.getElementById(summaryHostId);
    if (!host) return;
    try {
      const data = await fetch("/api/slide-flags").then((r) => r.json());
      renderLiveSummary(host, data.flags);
    } catch {
      // Leave the last count; the Flags screen is the source of truth.
    }
  });
}
