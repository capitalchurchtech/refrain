/**
 * The Service screen: today's services, a timing rundown of what went live in
 * each, and lock-in for live events (handoff section 37, phase 1; issue #6).
 *
 * Everything shown comes from /api/service/day, which reads the heartbeat's
 * recording. Nothing on this screen calls ProPresenter except adding a
 * service with a playlist, which reads that playlist once.
 *
 * The render functions are pure and exported so they can be tested without a
 * browser, the same as the Flags screen.
 */

import { showFailure } from "./notice.js";

const POLL_MS = 5_000;

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** 3:05, or 1:12:40 once it passes an hour. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A clock time in the machine's own locale, with seconds for the rundown. */
export function formatClock(iso, { seconds = true } = {}) {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
}

/** "+3:40 vs Early", comparing a service's running time with the first one that ran. */
export function comparisonText(service, first) {
  if (!first || first.serviceId === service.serviceId) return "";
  const a = service.summary;
  const b = first.summary;
  if (!a?.items || !b?.items || !a.endedAt || !b.endedAt) return "";
  const diff = a.runMs - b.runMs;
  if (Math.abs(diff) < 30_000) return `about the same as ${first.name}`;
  return `${formatDuration(Math.abs(diff))} ${diff > 0 ? "longer" : "shorter"} than ${first.name}`;
}

export function renderRowsHtml(rows) {
  if (!rows?.length) return `<div class="text-sm opacity-60">Nothing has gone live yet.</div>`;
  const body = rows
    .map((r) => {
      const returns = r.returns
        .map(
          (x) => `
        <tr class="opacity-70">
          <td></td>
          <td class="pl-4">↺ back again</td>
          <td class="tabular-nums whitespace-nowrap">${escapeHtml(formatClock(x.at))}</td>
          <td class="tabular-nums whitespace-nowrap">${escapeHtml(formatDuration(x.onScreenMs))}</td>
          <td></td>
        </tr>`
        )
        .join("");
      return `
        <tr class="${r.live ? "service-row-live" : ""}">
          <td class="tabular-nums opacity-60">${r.position ?? "+"}</td>
          <td>
            ${escapeHtml(r.name)}
            ${r.offPlan ? `<span class="badge badge-ghost badge-sm ml-1">Off-plan</span>` : ""}
            ${r.live ? `<span class="badge badge-ghost badge-sm ml-1">On screen</span>` : ""}
          </td>
          <td class="tabular-nums whitespace-nowrap">${escapeHtml(formatClock(r.firstLive))}</td>
          <td class="tabular-nums whitespace-nowrap">${escapeHtml(formatDuration(r.onScreenMs))}</td>
          <td class="tabular-nums whitespace-nowrap opacity-70">${r.gapBeforeMs == null ? "–" : escapeHtml(formatDuration(r.gapBeforeMs))}</td>
        </tr>${returns}`;
    })
    .join("");
  return `
    <div class="overflow-x-auto">
      <table class="table table-sm">
        <thead><tr><th>#</th><th>Item</th><th>Live at</th><th>On screen</th><th>Gap before</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function serviceStateText(s) {
  if (s.source === "lockin" && !s.endedAt) return "Locked in";
  if (s.endedAt) return "Ended";
  if (s.watching) return "Watching";
  if (s.startsAt && Date.parse(s.startsAt) > Date.now()) return `Starts ${formatClock(s.startsAt, { seconds: false })}`;
  return "";
}

export function renderServicesHtml(data) {
  const ran = (data.services ?? []).filter((s) => s.summary?.items);
  const first = ran[0] ?? null;
  const cards = (data.services ?? [])
    .map((s) => {
      const sum = s.summary ?? {};
      const line = sum.items
        ? `Started ${escapeHtml(formatClock(sum.startedAt))} · ran ${escapeHtml(formatDuration(sum.runMs))} · ${sum.items} item${sum.items === 1 ? "" : "s"}`
        : "Nothing has gone live in it yet.";
      const compare = comparisonText(s, first);
      const playlist = s.playlist
        ? `Playlist: ${escapeHtml(s.playlist.name)} (${s.playlist.count})`
        : s.playlistMatch
          ? `Playlist: the one whose name contains “${escapeHtml(s.playlistMatch)}”, read when the window opens`
          : "No playlist, so items are listed as they go live";
      const canEnd = !s.endedAt && s.source !== "lockin" && (s.watching || sum.items);
      return `
        <div class="card bg-base-200" data-service-id="${escapeHtml(s.serviceId)}">
          <div class="card-body p-3 gap-2">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="font-medium">${escapeHtml(s.name)}${s.startsAt ? ` <span class="opacity-60 tabular-nums">${escapeHtml(formatClock(s.startsAt, { seconds: false }))}</span>` : ""}</div>
                <div class="text-xs opacity-60">${playlist}</div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-xs opacity-70">${escapeHtml(serviceStateText(s))}</span>
                ${canEnd ? `<button type="button" class="btn btn-chip service-end-btn" data-service-id="${escapeHtml(s.serviceId)}">End</button>` : ""}
              </div>
            </div>
            <div class="text-sm">${line}${compare ? ` <span class="opacity-70">· ${escapeHtml(compare)}</span>` : ""}</div>
            ${sum.items ? renderRowsHtml(s.rows) : ""}
            ${
              s.playlist && s.source !== "lockin" && !s.endedAt
                ? `<div><button type="button" class="btn btn-chip service-checks-btn" data-service-id="${escapeHtml(s.serviceId)}">${data.checks?.[s.serviceId] ? "Run checks again" : "Run pre-service checks"}</button></div>`
                : ""
            }
            ${renderChecksHtml(data.checks?.[s.serviceId])}
          </div>
        </div>`;
    })
    .join("");
  return cards || `<div class="text-sm opacity-70">No services today yet. Add one below, or lock in when an event starts. What goes live is recorded either way.</div>`;
}

export function renderLockinHtml(data) {
  if (data.lockin) {
    const since = formatClock(data.lockin.startedAt, { seconds: false });
    const age = formatDuration(Date.now() - Date.parse(data.lockin.startedAt));
    const remind = data.lockinReminder
      ? `<div class="text-sm">Locked in for ${data.lockinReminder.hours} hours. If the event is over, release it so search can catch up.</div>`
      : "";
    return `
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="min-w-0">
          <div class="font-medium flex items-center gap-2"><span class="rf-led lit"></span> Locked in: ${escapeHtml(data.lockin.name)}</div>
          <div class="text-xs opacity-70 tabular-nums">Since ${escapeHtml(since)} (${escapeHtml(age)}). Watching closely and holding still until you release it.</div>
        </div>
        <button type="button" id="service-release-btn" class="btn btn-outline btn-sm">Release</button>
      </div>
      ${remind}`;
  }
  return `
    <div class="flex items-center gap-2 flex-wrap">
      <input id="service-lockin-name" type="text" maxlength="60" placeholder="Event name (optional)" class="input input-bordered input-sm flex-1 min-w-40" />
      <button type="button" id="service-lockin-btn" class="btn btn-outline btn-sm"><i data-lucide="lock" class="w-4 h-4"></i> Lock in for an event</button>
    </div>
    <div class="text-xs opacity-60">For events with no set time. Refrain watches closely and holds still (performance mode) until you release it. Nothing on the screens changes.</div>`;
}

const STATUS_TEXT = { pass: "Pass", attention: "Needs a look", couldnt: "Couldn't check" };

/** The last run of a service's checks: the headline, then anything that isn't a pass, with where. */
export function renderChecksHtml(run) {
  if (!run) return "";
  const rows = run.results
    .filter((r) => r.status !== "pass")
    .map((r) => {
      const details = (r.details ?? [])
        .slice(0, 8)
        .map((d) => `<li>${escapeHtml(d.name ?? "")}${d.slide ? `, slide ${d.slide}` : ""}${d.text ? `: ${escapeHtml(d.text)}` : ""}</li>`)
        .join("");
      const more = (r.details?.length ?? 0) > 8 ? `<li class="opacity-60">and ${r.details.length - 8} more</li>` : "";
      return `
        <div class="service-check" data-status="${escapeHtml(r.status)}">
          <div><span class="font-medium">${escapeHtml(STATUS_TEXT[r.status] ?? r.status)}:</span> ${escapeHtml(r.label)}. <span class="opacity-80">${escapeHtml(r.summary)}</span></div>
          ${details || more ? `<ul class="list-disc pl-5 text-xs opacity-80">${details}${more}</ul>` : ""}
        </div>`;
    })
    .join("");
  return `
    <div class="text-sm flex flex-col gap-1">
      <div><span class="font-medium">Checks: ${escapeHtml(run.headline)}</span> <span class="opacity-60 text-xs">(run ${escapeHtml(formatClock(run.at, { seconds: false }))})</span></div>
      ${rows}
    </div>`;
}

export function renderChecksDueHtml(due) {
  if (!due?.length) return "";
  return due
    .map(
      (d) => `<div class="rf-readout text-sm">${escapeHtml(d.name)} starts at ${escapeHtml(formatClock(d.startsAt, { seconds: false }))}. ${
        d.hasPlaylist ? "The pre-service checks haven't been run yet." : "Its playlist hasn't been found yet, so checks can't run."
      }</div>`
    )
    .join("");
}

/** The checklist, phase by phase. Checks and End steps tick themselves. */
export function renderChecklistHtml(checklist) {
  return (checklist ?? [])
    .map((p) => {
      const title = `${escapeHtml(p.name)}${p.serviceName ? ` <span class="opacity-60">· ${escapeHtml(p.serviceName)}</span>` : ""}`;
      const steps = p.steps
        .map((st) => {
          const auto = st.checks || st.end;
          const link = st.link ? ` <a href="${escapeHtml(st.link)}" class="link text-xs">Open</a>` : "";
          return `
            <label class="flex items-center gap-2 text-sm ${auto ? "opacity-80" : "cursor-pointer"}">
              <input type="checkbox" class="checkbox checkbox-sm service-step" ${st.done ? "checked" : ""} ${auto ? "disabled" : ""}
                data-phase-id="${escapeHtml(p.phaseId)}" data-step-id="${escapeHtml(st.id)}" data-service-id="${escapeHtml(p.serviceId ?? "")}" />
              <span>${escapeHtml(st.label)}${auto ? ` <span class="text-xs opacity-60">(${st.checks ? "ticks when the checks run" : "ticks when you End the day"})</span>` : ""}${link}</span>
            </label>`;
        })
        .join("");
      return `<div class="flex flex-col gap-1"><div class="text-xs uppercase tracking-wide opacity-60">${title}</div>${steps}</div>`;
    })
    .join("");
}

export function renderEndHtml(data) {
  if (data.dayEnded && !data.reopened) {
    return `
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="text-sm">Day ended at ${escapeHtml(formatClock(data.dayEnded.at, { seconds: false }))}. The summary is saved.</div>
        <div class="flex gap-2"><button type="button" id="service-summary-btn" class="btn btn-outline btn-sm">View summary</button></div>
      </div>`;
  }
  const again = data.reopened ? `<div class="text-sm">Things were recorded after the last End, so the day is open again. End it again to write a new summary; the earlier one is kept.</div>` : "";
  return `
    ${again}
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="text-xs opacity-70">End closes today's services and any lock-in, compares the arrangements of the songs that were shown (nothing is pushed back), and writes the day summary.</div>
      <button type="button" id="service-end-day-btn" class="btn btn-outline btn-sm">End the day</button>
    </div>`;
}

export function paceNote(data) {
  return data.holdingPace
    ? "Times are when Refrain first saw each item, within about 4 seconds."
    : `Outside a watched service Refrain checks less often, so times can be up to ${Math.round((data.beatMs ?? 30_000) / 1000)} seconds late.`;
}

export function initService() {
  const container = document.getElementById("view-service");
  let timer = null;
  let playlistsLoaded = false;
  let endArmed = null;

  async function post(url, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function paint(data) {
    const lock = document.getElementById("service-lockin");
    const list = document.getElementById("service-list");
    const outside = document.getElementById("service-outside");
    const note = document.getElementById("service-pace-note");
    if (!lock || !list) return;
    // Don't repaint the lock-in field out from under someone typing a name.
    if (!(document.activeElement?.id === "service-lockin-name")) lock.innerHTML = renderLockinHtml(data);
    list.innerHTML = renderServicesHtml(data);
    outside.innerHTML = data.outside?.length
      ? `<h2 class="rf-subhead">Not in a service</h2><div class="card bg-base-200"><div class="card-body p-3">${renderRowsHtml(data.outside)}</div></div>`
      : "";
    note.textContent = paceNote(data);
    const due = document.getElementById("service-due");
    if (due) due.innerHTML = renderChecksDueHtml(data.checksDue);
    const cl = document.getElementById("service-checklist");
    if (cl) cl.innerHTML = renderChecklistHtml(data.checklist) + (data.phaseProblems?.length ? `<div class="text-xs opacity-70">${escapeHtml(data.phaseProblems.join(" "))}</div>` : "");
    const end = document.getElementById("service-end");
    // Don't repaint End while it's armed, or the second press would miss.
    if (end && !endArmed) end.innerHTML = renderEndHtml(data);
    if (window.lucide) window.lucide.createIcons();
    wire();
  }

  async function load() {
    try {
      const res = await fetch("/api/service/day");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      paint(data);
    } catch (err) {
      const list = document.getElementById("service-list");
      if (list) list.innerHTML = `<div class="text-sm opacity-70">Couldn't load today's services: ${escapeHtml(err.message)}</div>`;
    }
  }

  function wire() {
    document.getElementById("service-lockin-btn")?.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        paint(await post("/api/service/lockin", { name: document.getElementById("service-lockin-name")?.value ?? "" }));
      } catch (err) {
        showFailure(`Couldn't lock in: ${err.message}`);
        load();
      }
    });
    document.getElementById("service-release-btn")?.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        paint(await post("/api/service/lockin/release"));
      } catch (err) {
        showFailure(`Couldn't release: ${err.message}`);
        load();
      }
    });
    document.querySelectorAll(".service-checks-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Checking...";
        try {
          paint(await post(`/api/service/services/${encodeURIComponent(btn.dataset.serviceId)}/checks`));
        } catch (err) {
          showFailure(`Couldn't run the checks: ${err.message}`);
          load();
        }
      })
    );
    document.querySelectorAll(".service-step").forEach((box) =>
      box.addEventListener("change", async () => {
        try {
          paint(await post("/api/service/steps", { phaseId: box.dataset.phaseId, stepId: box.dataset.stepId, serviceId: box.dataset.serviceId || null, done: box.checked }));
        } catch (err) {
          box.checked = !box.checked;
          showFailure(`That wasn't saved: ${err.message}`);
        }
      })
    );
    // Two presses, like Clear All: End closes the day and writes the summary,
    // so the first press arms it and says so.
    document.getElementById("service-end-day-btn")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (!endArmed) {
        btn.textContent = "Press again to end the day";
        btn.classList.replace("btn-outline", "btn-brand");
        endArmed = setTimeout(() => {
          endArmed = null;
          load();
        }, 3000);
        return;
      }
      clearTimeout(endArmed);
      endArmed = null;
      btn.disabled = true;
      btn.textContent = "Ending...";
      try {
        const data = await post("/api/service/end-day");
        paint(data);
        showSummary(data.summary);
        if (data.delivered && !data.delivered.ok) showFailure(`The summary is saved here, but copying it to the summary folder is waiting: ${data.delivered.reason}`);
      } catch (err) {
        showFailure(`Couldn't end the day: ${err.message}`);
        load();
      }
    });
    document.getElementById("service-summary-btn")?.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/service/summary");
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
        showSummary(await res.text());
      } catch (err) {
        showFailure(`Couldn't open the summary: ${err.message}`);
      }
    });
    document.querySelectorAll(".service-end-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          paint(await post(`/api/service/services/${encodeURIComponent(btn.dataset.serviceId)}/end`));
        } catch (err) {
          showFailure(`Couldn't end that service: ${err.message}`);
          load();
        }
      })
    );
  }

  function showSummary(text) {
    const pre = document.getElementById("service-summary");
    if (!pre) return;
    pre.textContent = text ?? "";
    pre.classList.remove("hidden");
  }

  async function loadPlaylists() {
    const select = document.getElementById("service-add-playlist");
    if (!select || playlistsLoaded) return;
    try {
      const res = await fetch("/api/spellcheck/playlists");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      select.innerHTML =
        `<option value="">No playlist</option>` +
        (data.playlists ?? []).map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
      playlistsLoaded = true;
    } catch {
      select.innerHTML = `<option value="">No playlist (ProPresenter isn't answering)</option>`;
    }
  }

  async function render() {
    if (!container) return;
    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-4xl">
        <div>
          <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="calendar-clock" class="w-5 h-5"></i> Service</h1>
          <p class="text-sm opacity-70">What went live today, when, and for how long.</p>
        </div>

        <div id="service-due" class="flex flex-col gap-2"></div>

        <div>
          <h2 class="rf-subhead">Live event</h2>
          <div class="card bg-base-200"><div id="service-lockin" class="card-body p-3 gap-2"></div></div>
        </div>

        <div>
          <h2 class="rf-subhead">Today's services</h2>
          <div id="service-list" class="flex flex-col gap-3 text-sm opacity-70">Loading...</div>
        </div>

        <div id="service-outside"></div>

        <details class="card bg-base-200">
          <summary class="cursor-pointer p-3 text-sm font-medium">Add a service for today</summary>
          <div class="p-3 pt-0 flex flex-col gap-2">
            <div class="flex gap-2 flex-wrap">
              <input id="service-add-name" type="text" maxlength="60" placeholder="Name, e.g. Evening" class="input input-bordered input-sm flex-1 min-w-40" />
              <input id="service-add-time" type="time" class="input input-bordered input-sm" aria-label="Start time (optional)" />
              <select id="service-add-playlist" class="select select-bordered select-sm flex-1 min-w-40" aria-label="Playlist (optional)"><option value="">Loading playlists...</option></select>
              <button type="button" id="service-add-btn" class="btn btn-outline btn-sm">Add</button>
            </div>
            <div class="text-xs opacity-60">The time and playlist are optional. A time lets Refrain watch closely from a little before it; a playlist lets the rundown number each item and spot anything off-plan. Recurring services can go in config.json instead (serviceModule.schedule).</div>
          </div>
        </details>

        <div>
          <h2 class="rf-subhead">Checklist</h2>
          <div class="card bg-base-200"><div id="service-checklist" class="card-body p-3 gap-3"></div></div>
        </div>

        <div>
          <h2 class="rf-subhead">End of the day</h2>
          <div class="card bg-base-200"><div id="service-end" class="card-body p-3 gap-2"></div></div>
          <pre id="service-summary" class="hidden mt-2 p-3 bg-base-200 rounded text-xs whitespace-pre-wrap"></pre>
        </div>

        <p id="service-pace-note" class="text-xs opacity-60"></p>
      </div>`;
    if (window.lucide) window.lucide.createIcons();

    container.querySelector("details")?.addEventListener("toggle", loadPlaylists);
    document.getElementById("service-add-btn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const select = document.getElementById("service-add-playlist");
      btn.disabled = true;
      try {
        paint(
          await post("/api/service/services", {
            name: document.getElementById("service-add-name").value,
            time: document.getElementById("service-add-time").value || null,
            playlistId: select.value || null,
            playlistName: select.value ? select.selectedOptions[0]?.textContent : null,
          })
        );
        document.getElementById("service-add-name").value = "";
        document.getElementById("service-add-time").value = "";
        select.value = "";
      } catch (err) {
        showFailure(`Couldn't add that service: ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    });

    await load();
    clearInterval(timer);
    // Cheap: the day endpoint reads memory, never ProPresenter. Stops itself
    // when the screen is hidden so a background tab isn't polling for nothing.
    timer = setInterval(() => {
      if (container.classList.contains("hidden")) {
        clearInterval(timer);
        return;
      }
      load();
    }, POLL_MS);
  }

  return { render };
}
