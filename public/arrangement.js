/**
 * Arrangement drift-tracking screen (Section 8). This screen only
 * appears once config.json's arrangementModule is enabled and active
 * (Section 4.1's three-state gate, enforced by nav.js already hiding
 * "off" and the server 409-ing writes when not "active"). The
 * "weekend plan" one-button workflow further gates on the configured
 * provider's supportsPlanBrowsing capability — Planning Center has it,
 * but nothing here hardcodes that it's the only provider that could.
 */
import { showFailure } from "./notice.js";

export function initArrangement() {
  const container = document.getElementById("view-arrangement");
  let currentSongs = [];
  // Guards against a slower-resolving fetch for an earlier click
  // clobbering a faster one for a later click (e.g. double-clicking
  // between two songs before the first detail fetch resolves) — only
  // the fetch matching the most recently requested id is allowed to render.
  let latestRequestedSongId = null;
  // Which of the last 5 plans the weekend-plan card is showing; null
  // means "let the server pick the most recent."
  let selectedPlanId = null;
  // The configured provider's human-readable name (e.g. "Planning
  // Center") — read from the server instead of hardcoded, so this
  // screen's copy never assumes which church-management system is
  // configured.
  let providerDisplayName = "the church-management system";

  async function render() {
    const status = await fetch("/api/arrangement/status").then((r) => r.json());
    if (status.status !== "active") {
      container.innerHTML = `
        <div class="alert alert-warning max-w-xl">
          Arrangement module is ${status.status === "misconfigured" ? "misconfigured" : "not enabled"}.
          see the Health screen for details.
        </div>
      `;
      return;
    }

    const { songs } = await fetch("/api/arrangement/songs").then((r) => r.json());
    currentSongs = songs;

    const showWeekendPlan = status.role === "logger" && status.providerSupportsPlanBrowsing;
    providerDisplayName = status.providerDisplayName || providerDisplayName;

    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="git-compare" class="w-5 h-5"></i> Arrangement</h1>
        <div id="arrangement-list-view" class="flex flex-col gap-4">
          ${
            status.role !== "logger"
              ? `<div class="alert alert-info py-2 text-sm">Read-only. This machine's role is "reader," so comparisons run on the logger machine.</div>`
              : ""
          }
          ${showWeekendPlan ? `<div id="weekend-plan-card" class="card bg-base-200 rf-hero"><div class="card-body p-3 gap-2"></div></div>` : ""}
          <div class="rf-field">
            <label for="arrangement-song-filter" class="flex items-center justify-between gap-2">
              <span>Filter songs</span>
              <span id="arrangement-song-count"></span>
            </label>
            <input type="text" id="arrangement-song-filter" class="input input-bordered w-full" placeholder="Type to narrow" />
          </div>
          <div>
            <h2 class="card-title">Tracked songs</h2>
            <div class="rf-list" id="arrangement-song-list"></div>
          </div>
        </div>
        <div id="arrangement-detail" class="hidden"></div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();

    renderSongList(currentSongs, status.role);

    document.getElementById("arrangement-song-filter").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = q ? currentSongs.filter((s) => s.name.toLowerCase().includes(q)) : currentSongs;
      renderSongList(filtered, status.role);
    });

    if (showWeekendPlan) loadWeekendPlan();
  }

  /**
   * The "here's this weekend's plan, one button to compare everything"
   * workflow: preview which of the plan's songs Refrain can find in
   * ProPresenter, then let the logger run every comparison in one go.
   */
  async function loadWeekendPlan() {
    const body = document.querySelector("#weekend-plan-card .card-body");
    if (!body) return;
    body.innerHTML = `<h2 class="card-title text-base"><i data-lucide="calendar-check" class="w-4 h-4"></i> This weekend's plan</h2><div class="text-sm opacity-60">Loading…</div>`;

    const planQuery = selectedPlanId ? `?planId=${encodeURIComponent(selectedPlanId)}` : "";
    const [planRes, plansList] = await Promise.all([
      fetch(`/api/arrangement/current-plan${planQuery}`),
      fetch("/api/arrangement/plans")
        .then((r) => r.json())
        .then((d) => d.plans ?? [])
        .catch(() => []),
    ]);
    const data = await planRes.json();
    if (!planRes.ok) {
      body.innerHTML = `<h2 class="card-title text-base"><i data-lucide="calendar-check" class="w-4 h-4"></i> This weekend's plan</h2><div class="text-sm rf-flag">${escapeHtml(data.error)}</div>`;
      return;
    }
    // Keep the picker in sync with whichever plan actually loaded (e.g. first load with no selection yet).
    selectedPlanId = data.plan.id;

    const matchedCount = data.songs.filter((s) => s.presentationId).length;
    const planPicker =
      plansList.length > 1
        ? `<select id="weekend-plan-select" class="select select-bordered select-sm w-full">
            ${plansList
              .map(
                (p) => `<option value="${escapeHtml(p.id)}" ${p.id === selectedPlanId ? "selected" : ""}>${escapeHtml(p.dates)}</option>`
              )
              .join("")}
          </select>`
        : "";
    body.innerHTML = `
      <h2 class="card-title text-base"><i data-lucide="calendar-check" class="w-4 h-4"></i> This weekend's plan</h2>
      ${planPicker}
      <div class="text-sm opacity-70">${escapeHtml(data.plan.dates)} &middot; ${matchedCount}/${data.songs.length} songs matched in ProPresenter</div>
      <div class="flex flex-col divide-y divide-base-300">
        ${data.songs
          .map(
            (s) => `
          <div class="flex items-center gap-2 py-1.5 text-sm">
            <span class="rf-led rf-led-col ${s.presentationId ? "lit" : ""}" title="${s.presentationId ? "Matched in ProPresenter" : "Not found in ProPresenter"}"></span>
            <span class="flex-1 truncate min-w-0">${escapeHtml(s.title)}</span>
          </div>
        `
          )
          .join("")}
      </div>
      <button id="compare-all-btn" class="btn btn-brand btn-sm w-fit mt-1">
        <i data-lucide="git-compare" class="w-3.5 h-3.5"></i> Compare all songs
      </button>
      <div id="compare-all-results"></div>
    `;

    document.getElementById("compare-all-btn").addEventListener("click", runWeekendCompare);
    const planSelect = document.getElementById("weekend-plan-select");
    if (planSelect) {
      planSelect.addEventListener("change", (e) => {
        selectedPlanId = e.target.value;
        loadWeekendPlan();
      });
    }
    if (window.lucide) window.lucide.createIcons();
  }

  async function runWeekendCompare() {
    const btn = document.getElementById("compare-all-btn");
    const resultsEl = document.getElementById("compare-all-results");
    btn.disabled = true;
    btn.textContent = "Comparing...";
    try {
      const res = await fetch("/api/arrangement/compare-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: selectedPlanId }),
      });
      const data = await res.json();
      if (!res.ok) {
        resultsEl.innerHTML = `<div class="text-sm rf-flag mt-2">${escapeHtml(data.error)}</div>`;
        return;
      }

      resultsEl.innerHTML = `
        <div id="arrangement-next-host" class="flex items-center gap-3 mt-2"></div>
        <div class="flex flex-col gap-2 mt-2">
          ${data.results
            .map((r) => {
              const matches = !r.diff.skipped.length && !r.diff.added.length && !r.diff.reordered.length;
              const suggestUpdate = (!matches || r.alwaysDiffers) && !r.ignored;
              const canPush = suggestUpdate && r.externalSongId && r.externalArrangementId;
              return `
              <div class="text-sm bg-base-100 rounded p-2 compare-result" data-presentation-id="${escapeHtml(r.presentationId ?? "")}" data-service-date="${escapeHtml(data.serviceDate)}">
                <div class="font-medium flex items-center justify-between gap-2">
                  <span class="flex items-center gap-2 min-w-0 truncate">
                    ${matches ? `<span class="rf-mark-gap"></span>` : `<i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 rf-flag"></i>`}
                    ${escapeHtml(r.presentationName ?? r.title)}
                  </span>
                  <label class="label cursor-pointer gap-1 py-0 shrink-0" title="Always recommend an update for this song, even when it matches">
                    <span class="label-text text-xs opacity-60">Always differs</span>
                    <input type="checkbox" class="toggle toggle-xs always-differs-toggle" ${r.alwaysDiffers ? "checked" : ""} />
                  </label>
                </div>
                ${renderSequenceComparison(r.planned, r.actual)}
                ${
                  r.ignored
                    ? `<div class="text-xs opacity-60 mt-1 flex items-center gap-1"><i data-lucide="eye-off" class="w-3 h-3"></i> Ignored. Marked as an atypical, non-representative performance.</div>`
                    : suggestUpdate
                      ? `<div class="rf-flag text-xs mt-1">${r.alwaysDiffers && matches ? "Flagged as always different. Review and update the plan." : "Consider updating the plan to match what was actually played."}</div>`
                      : ""
                }
                <div class="flex items-center gap-2 mt-1">
                  ${
                    canPush
                      ? `<button class="btn btn-outline btn-xs push-arrangement-btn" data-external-song-id="${escapeHtml(r.externalSongId)}" data-external-arrangement-id="${escapeHtml(r.externalArrangementId)}" data-sequence="${escapeHtml(JSON.stringify(r.actual))}">
                          <i data-lucide="upload" class="w-3 h-3"></i> Push to ${escapeHtml(providerDisplayName)}
                        </button>`
                      : ""
                  }
                  ${
                    !matches
                      ? `<button class="btn btn-ghost btn-xs ignore-week-btn">
                          <i data-lucide="${r.ignored ? "eye" : "eye-off"}" class="w-3 h-3"></i> ${r.ignored ? "Un-ignore" : "Ignore this week"}
                        </button>`
                      : ""
                  }
                </div>
                <div class="push-result text-xs mt-1"></div>
              </div>
            `;
            })
            .join("")}
          ${
            data.unmatched.length
              ? `<div class="text-sm bg-base-100 rounded p-2">
                  <div class="font-medium flex items-center gap-2"><i data-lucide="help-circle" class="w-3.5 h-3.5 rf-flag"></i> Not found in ProPresenter</div>
                  <div class="opacity-70 mt-1">${data.unmatched.map((u) => escapeHtml(u.title)).join(", ")}</div>
                </div>`
              : ""
          }
        </div>
      `;
      wireCompareAllResultActions(resultsEl);
      wireNextDivergent(resultsEl);
      if (window.lucide) window.lucide.createIcons();
      // Song-list counts (historyCount/lastServiceDate) are now stale
      // until the next full render() — not worth a rebuild here, since
      // render() would also wipe the results we just showed.
    } finally {
      if (btn.isConnected) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="git-compare" class="w-3.5 h-3.5"></i> Compare all songs`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  }

  /**
   * Walks the songs that actually need attention.
   *
   * Comparing a plan produces a list where most rows are fine and a few are
   * not, and the screen stopped at the list: the operator scrolled it looking
   * for the marked ones, pushed a correction, then scrolled again to find
   * where they were. Same shape as Spell Check's flagged slides, so it gets
   * the same control rather than a second idea about what "next" means.
   *
   * Only the divergent rows are in the walk. A row that matches is not work.
   */
  function wireNextDivergent(resultsEl) {
    const host = resultsEl.querySelector("#arrangement-next-host");
    if (!host) return;
    const rows = [...resultsEl.querySelectorAll(".compare-result")].filter((r) =>
      r.querySelector("[data-lucide='alert-triangle'], .rf-flag")
    );
    if (!rows.length) {
      host.innerHTML = `<span class="rf-hint">Every song matches its plan. Nothing to review.</span>`;
      return;
    }
    host.innerHTML = `<button id="arrangement-next-btn" class="btn btn-chip">Next song to review</button>
                      <span id="arrangement-next-progress" class="rf-silkscreen"></span>`;
    let cursor = -1;
    document.getElementById("arrangement-next-btn").addEventListener("click", () => {
      cursor = (cursor + 1) % rows.length;
      for (const r of rows) r.classList.remove("rf-current");
      rows[cursor].classList.add("rf-current");
      rows[cursor].scrollIntoView({ block: "center" });
      const p = document.getElementById("arrangement-next-progress");
      if (p) p.textContent = `${cursor + 1} of ${rows.length}`;
    });
  }

  /**
   * Wires up the two actions inside a freshly-rendered compare-all
   * results list: the "always differs" flag toggle (persisted per
   * song), and the "push to {provider}" button (an explicit, confirmed write
   * to the shared base Arrangement, with a one-click undo using the
   * pre-overwrite sequence the server hands back).
   */
  function wireCompareAllResultActions(resultsEl) {
    resultsEl.querySelectorAll(".always-differs-toggle").forEach((toggle) => {
      toggle.addEventListener("change", async (e) => {
        const presentationId = e.target.closest("[data-presentation-id]")?.dataset.presentationId;
        if (!presentationId) return;
        const checked = e.target.checked;
        e.target.disabled = true;
        try {
          await fetch(`/api/arrangement/song/${presentationId}/always-differs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alwaysDiffers: checked }),
          });
        } catch {
          e.target.checked = !checked;
        } finally {
          e.target.disabled = false;
        }
      });
    });

    resultsEl.querySelectorAll(".push-arrangement-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const { externalSongId, externalArrangementId, sequence } = btn.dataset;
        const parsedSequence = JSON.parse(sequence);
        const resultEl = btn.closest("[data-presentation-id]").querySelector(".push-result");
        const confirmed = window.confirm(
          `Overwrite this song's arrangement in ${providerDisplayName} with:\n\n${parsedSequence.join(", ")}\n\n` +
            "This updates the shared arrangement. Every future plan that reuses it changes too. You can undo right after."
        );
        if (!confirmed) return;

        btn.disabled = true;
        btn.textContent = "Pushing...";
        try {
          const res = await fetch("/api/arrangement/push-arrangement", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ externalSongId, externalArrangementId, sequence: parsedSequence }),
          });
          const data = await res.json();
          if (!res.ok) {
            resultEl.innerHTML = `<span class="rf-flag">${escapeHtml(data.error)}</span>`;
            btn.remove();
            return;
          }
          btn.remove();
          resultEl.innerHTML = `
            <span class="rf-nominal"><i data-lucide="check" class="w-3 h-3 inline"></i> Pushed to ${escapeHtml(providerDisplayName)}.</span>
            <button class="btn btn-ghost btn-xs undo-push-btn">Undo</button>
          `;
          if (window.lucide) window.lucide.createIcons();
          resultEl.querySelector(".undo-push-btn").addEventListener("click", async (e) => {
            const undoBtn = e.target;
            undoBtn.disabled = true;
            undoBtn.textContent = "Undoing...";
            try {
              const undoRes = await fetch("/api/arrangement/push-arrangement", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ externalSongId, externalArrangementId, sequence: data.previousSequence }),
              });
              const undoData = await undoRes.json();
              resultEl.innerHTML = undoRes.ok
                ? `<span class="opacity-60">Reverted.</span>`
                : `<span class="rf-flag">${escapeHtml(undoData.error)}</span>`;
            } catch (err) {
              resultEl.innerHTML = `<span class="rf-flag">${escapeHtml(err.message)}</span>`;
            }
          });
        } catch (err) {
          resultEl.innerHTML = `<span class="rf-flag">${escapeHtml(err.message)}</span>`;
          btn.remove();
        }
      });
    });

    resultsEl.querySelectorAll(".ignore-week-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const container = btn.closest("[data-presentation-id]");
        const { presentationId, serviceDate } = container.dataset;
        const currentlyIgnored = btn.textContent.includes("Un-ignore");
        btn.disabled = true;
        try {
          const res = await fetch(`/api/arrangement/song/${presentationId}/history/${serviceDate}/ignore`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ignored: !currentlyIgnored }),
          });
          if (!res.ok) throw new Error((await res.json()).error);
          // Simplest correct way to reflect the new ignored state everywhere
          // it affects (suggestion banner, push button) is to re-run the
          // whole comparison view — it's already idempotent and cheap.
          await runWeekendCompare();
        } catch (err) {
          btn.disabled = false;
          showFailure(`Could not change this week's ignore setting: ${err.message}`);
        }
      });
    });
  }

  /**
   * A list, not a key bank. Rows sit flush with a hairline groove between
   * them and hover as the affordance -- 184 raised keys would be absurd, and
   * that is what the `btn-ghost` stack this replaces amounted to.
   *
   * Two lines, because on one the song name -- the thing the operator is
   * scanning by -- was truncated to about 150px by the metadata beside it.
   *
   * The status is binary: a planned arrangement is on record or it is not, and
   * absent is not a fault. So a lit plum lamp against an unlit dot, the same
   * vocabulary as the rail's link lamp, rather than green versus amber.
   */
  function renderSongList(songs, role) {
    const listEl = document.getElementById("arrangement-song-list");
    const countEl = document.getElementById("arrangement-song-count");
    if (countEl) {
      countEl.textContent =
        songs.length === currentSongs.length
          ? `${currentSongs.length} tracked`
          : `${songs.length} of ${currentSongs.length}`;
    }

    listEl.innerHTML = songs.length
      ? songs
          .map((s) => {
            const meta = [
              `${s.historyCount} ${s.historyCount === 1 ? "service" : "services"}`,
              s.lastServiceDate,
            ].filter(Boolean);
            return `
      <button class="rf-list-row song-btn" data-id="${escapeHtml(s.presentationId)}">
        <span class="rf-led rf-led-col ${s.hasPlannedArrangement ? "lit" : ""}" title="${s.hasPlannedArrangement ? "Planned arrangement on record" : "No planned arrangement yet"}"></span>
        <span class="rf-list-body">
          <span class="rf-list-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
          <span class="rf-list-meta">${escapeHtml(meta.join(" \u00b7 "))}</span>
        </span>
      </button>`;
          })
          .join("")
      : `<div class="text-sm opacity-60 py-2">No matches</div>`;

    listEl.querySelectorAll(".song-btn").forEach((btn) => {
      btn.addEventListener("click", () => renderDetail(btn.dataset.id, role));
    });

    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * One song's record.
   *
   * The comparison is the hero, and that is the change that matters here. It
   * used to render *actual* as a prose line of arrow-joined section names and
   * *planned* as a textarea -- one a sentence, the other an edit field, so the
   * two things this screen exists to compare could not be compared at a
   * glance. They are now the same type on the same axis, and the resting state
   * is a reading, not a form. Editing is still one press away.
   *
   * The rest of the record -- section mapping, history -- drops below into
   * ordinary cards, because exactly one thing on a view is the hero.
   */
  async function renderDetail(presentationId, role) {
    latestRequestedSongId = presentationId;
    const listViewEl = document.getElementById("arrangement-list-view");
    const detailEl = document.getElementById("arrangement-detail");
    const record = await fetch(`/api/arrangement/song/${presentationId}`).then((r) => r.json());
    // Another song was clicked while this fetch was in flight — that
    // newer render will handle showing its own result, so bail out
    // rather than overwrite the screen with this stale one.
    if (latestRequestedSongId !== presentationId) return;
    const isLogger = role === "logger";
    const uniqueGroups = [...new Set(record.groupSequence)];
    const planned = record.manualPlannedArrangement ?? [];

    detailEl.innerHTML = `
      <button id="arrangement-back-btn" class="btn btn-chip w-fit">
        <i data-lucide="arrow-left" class="w-3 h-3"></i> Back
      </button>

      <div class="card bg-base-200 rf-hero mt-2">
        <div class="card-body p-3 gap-3">
          <h2 class="card-title">Comparison</h2>
          <div class="rf-detail-name">${escapeHtml(record.songName)}</div>
          ${renderComparison(record.groupSequence, planned, isLogger)}
          ${
            isLogger
              ? `
          <div class="rf-control-row">
            <div class="rf-field rf-field-fixed">
              <label for="service-date">Service date</label>
              <input type="date" id="service-date" class="input input-bordered" value="${new Date().toISOString().slice(0, 10)}" />
            </div>
            <button id="run-comparison-btn" class="btn btn-brand btn-sm">Run comparison</button>
          </div>
          <div id="comparison-result" class="rf-silkscreen"></div>`
              : ""
          }
        </div>
      </div>

      <div class="card bg-base-200 mt-3">
        <div class="card-body p-3 gap-2">
          <h2 class="card-title">Section mapping</h2>
          <div class="flex flex-col gap-1" id="mapping-rows">
            ${uniqueGroups
              .map(
                (g) => `
              <div class="flex items-center gap-2">
                <span class="text-sm w-40 shrink-0 truncate" title="${escapeHtml(g)}">${escapeHtml(g)}</span>
                <span class="rf-arrow">&rarr;</span>
                <input type="text" class="input input-bordered input-xs flex-1 mapping-input" data-group="${escapeHtml(g)}" value="${escapeHtml(record.sectionMapping[g] ?? g)}" aria-label="Name for ${escapeHtml(g)}" ${isLogger ? "" : "disabled"} />
              </div>`
              )
              .join("")}
          </div>
          ${isLogger ? `<button id="save-mapping-btn" class="btn btn-chip w-fit mt-1">Save mapping</button>` : ""}
          <div id="mapping-result" class="rf-silkscreen"></div>
        </div>
      </div>

      <div class="card bg-base-200 mt-3">
        <div class="card-body p-3 gap-2">
          <h2 class="card-title">History</h2>
          <div class="rf-list" id="history-list">
            ${
              (record.history ?? []).length === 0
                ? `<div class="text-sm opacity-60">No comparisons run yet.</div>`
                : [...record.history]
                    .reverse()
                    .map((h) => {
                      const matches = !h.diff.skipped.length && !h.diff.added.length && !h.diff.reordered.length;
                      return `
              <div class="text-sm rf-record-row history-entry" data-service-date="${escapeHtml(h.serviceDate)}"
                   role="button" tabindex="0"
                   aria-label="Open ${escapeHtml(record.songName)} from ${escapeHtml(formatCompactDate(h.serviceDate))} in ProPresenter">
                <div class="font-medium flex items-center justify-between gap-2">
                  <span class="flex items-center gap-2">
                    ${matches ? `<span class="rf-mark-gap"></span>` : `<i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 rf-flag"></i>`}
                    ${formatCompactDate(h.serviceDate)}
                  </span>
                  ${
                    isLogger && !matches
                      ? `<button class="btn btn-chip history-ignore-btn">
                          <i data-lucide="${h.ignored ? "eye" : "eye-off"}" class="w-3 h-3"></i> ${h.ignored ? "Un-ignore" : "Ignore"}
                        </button>`
                      : ""
                  }
                </div>
                ${
                  h.ignored
                    ? `<div class="text-xs opacity-60 mt-1 flex items-center gap-1"><i data-lucide="eye-off" class="w-3 h-3"></i> Ignored. Atypical performance, excluded from suggestions.</div>`
                    : ""
                }
                ${renderSequenceComparison(h.planned, h.actual)}
              </div>`;
                    })
                    .join("")
            }
          </div>
        </div>
      </div>
    `;

    wireHistoryOpen(presentationId, detailEl);

    if (isLogger) {
      wirePlannedEditor(presentationId, role, planned);

      document.getElementById("save-mapping-btn").addEventListener("click", async (e) => {
        // Captured synchronously: `currentTarget` is only valid for the
        // duration of the dispatch, and this handler awaits, so reading it
        // after the fetch gets null -- which threw inside the catch block and
        // swallowed the failure notice entirely.
        const btn = e.currentTarget;
        const sectionMapping = {};
        detailEl.querySelectorAll(".mapping-input").forEach((input) => {
          sectionMapping[input.dataset.group] = input.value.trim() || input.dataset.group;
        });
        const resultEl = document.getElementById("mapping-result");
        btn.disabled = true;
        try {
          const res = await fetch(`/api/arrangement/song/${presentationId}/mapping`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sectionMapping }),
          });
          // The old version fired and forgot: a rejected save looked exactly
          // like a successful one, so a mapping could be silently lost.
          if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
          resultEl.textContent = "Saved";
        } catch (err) {
          resultEl.textContent = "";
          showFailure(`Could not save the section mapping: ${err.message}. Your text is still in the fields — try again.`);
        } finally {
          if (btn.isConnected) btn.disabled = false;
        }
      });

      document.getElementById("run-comparison-btn").addEventListener("click", () => runComparison(presentationId, false));

      detailEl.querySelectorAll(".history-ignore-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          // Belt and braces with the row's own `closest("button")` check: this
          // one survives if the row handler is ever rewritten.
          e.stopPropagation();
          const serviceDate = btn.closest(".history-entry").dataset.serviceDate;
          const currentlyIgnored = btn.textContent.includes("Un-ignore");
          btn.disabled = true;
          try {
            const res = await fetch(`/api/arrangement/song/${presentationId}/history/${serviceDate}/ignore`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ignored: !currentlyIgnored }),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            await renderDetail(presentationId, role);
          } catch (err) {
            btn.disabled = false;
            showFailure(`Could not change this week's ignore setting: ${err.message}`);
          }
        });
      });
    }

    document.getElementById("arrangement-back-btn").addEventListener("click", () => {
      detailEl.classList.add("hidden");
      listViewEl.classList.remove("hidden");
    });

    if (window.lucide) window.lucide.createIcons();

    listViewEl.classList.add("hidden");
    detailEl.classList.remove("hidden");
    detailEl.scrollIntoView({ block: "start" });
  }

  /**
   * A history entry opens that song in ProPresenter's editor.
   *
   * **Focus, never trigger.** A record of something that happened is a place to
   * go and look, not something to put back on the screens -- and the operator
   * clicking a July service in the middle of a September one must not change
   * what the congregation is seeing. `/api/focus` moves the editor only.
   *
   * The Ignore button lives inside the row, so its click is stopped from
   * reaching the row underneath it; otherwise ignoring a week would also jump
   * the editor somewhere. And the row is reachable from the keyboard, because a
   * clickable div without that is worse than a static one -- it looks
   * actionable to a mouse and does not exist to anything else.
   */
  function wireHistoryOpen(presentationId, detailEl) {
    detailEl.querySelectorAll(".history-entry").forEach((row) => {
      const open = async () => {
        if (row.dataset.opening === "1") return;
        row.dataset.opening = "1";
        try {
          const res = await fetch("/api/focus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ presentationId }),
          });
          if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
        } catch (err) {
          showFailure(`Couldn't open that in ProPresenter: ${err.message}. Nothing on the screens changed.`);
        } finally {
          delete row.dataset.opening;
        }
      };
      row.addEventListener("click", (e) => {
        if (e.target.closest("button")) return; // the Ignore control is its own target
        open();
      });
      row.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.target.closest("button")) return;
        e.preventDefault(); // Space would scroll the panel out from under them
        open();
      });
    });
  }

  /**
   * Swaps the planned line for an editor and back.
   *
   * The planned arrangement has to stay editable — this is the screen where
   * you correct the record — but an edit field cannot be the resting state or
   * the comparison stops being a comparison. So the field is one press away
   * and puts itself away again when it is done.
   */
  function wirePlannedEditor(presentationId, role, planned) {
    const editBtn = document.getElementById("edit-planned-btn");
    if (!editBtn) return;
    const line = document.getElementById("planned-line");

    editBtn.addEventListener("click", () => {
      editBtn.classList.add("hidden");
      line.innerHTML = `
        <textarea id="planned-textarea" rows="4" class="textarea textarea-bordered w-full text-sm">${escapeHtml(planned.join("\n"))}</textarea>
        <div class="rf-silkscreen mt-1">One section per line</div>
        <div class="flex items-center gap-2 mt-2">
          <button id="save-planned-btn" class="btn btn-chip">Save</button>
          <button id="cancel-planned-btn" class="btn btn-chip">Cancel</button>
        </div>
      `;
      document.getElementById("planned-textarea").focus();

      document.getElementById("cancel-planned-btn").addEventListener("click", () => renderDetail(presentationId, role));

      document.getElementById("save-planned-btn").addEventListener("click", async (e) => {
        // See the note on the mapping save: `currentTarget` does not survive
        // the await.
        const btn = e.currentTarget;
        const manualPlannedArrangement = document
          .getElementById("planned-textarea")
          .value.split("\n")
          .map((t) => t.trim())
          .filter(Boolean);
        btn.disabled = true;
        try {
          const res = await fetch(`/api/arrangement/song/${presentationId}/planned`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manualPlannedArrangement }),
          });
          if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
          await renderDetail(presentationId, role);
        } catch (err) {
          if (btn.isConnected) btn.disabled = false;
          // Deliberately does not re-render: a failed save must leave the
          // operator's typing on screen so they can retry or copy it out.
          showFailure(`Could not save the planned arrangement: ${err.message}. Your text is still in the box.`);
        }
      });
    });
  }

  async function runComparison(presentationId, force) {
    const resultEl = document.getElementById("comparison-result");
    const serviceDate = document.getElementById("service-date").value;
    resultEl.textContent = "Running...";

    const res = await fetch("/api/arrangement/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presentationId, serviceDate, force }),
    });
    const data = await res.json();

    if (res.status === 409 && data.conflict) {
      const confirmed = confirm(`${data.error}\n\nOverwrite with this machine's data?`);
      if (confirmed) return runComparison(presentationId, true);
      resultEl.textContent = "Cancelled.";
      return;
    }
    if (!res.ok) {
      resultEl.textContent = `Error: ${data.error}`;
      return;
    }

    resultEl.textContent = "Done.";
    await renderDetail(presentationId, "logger");
    // The song list's counts (historyCount/lastServiceDate) are now
    // stale until the next full render() — not worth a rebuild here,
    // since render() would also wipe the detail view we just updated.
  }

  // String-based (not DOM textContent->innerHTML) so quote characters are
  // escaped too — this is interpolated into attribute values (title="...",
  // value="...", data-group="...") where an unescaped `"` would close the
  // attribute early and corrupt the tag.
  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // "2026-07-08" -> "Jul 8, 26" — appends a local midnight time before
  // parsing so the displayed day never shifts in negative-UTC-offset
  // timezones (a bare "YYYY-MM-DD" parses as UTC midnight per spec).
  function formatCompactDate(dateStr) {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "2-digit",
    });
  }

  // Common worship-chart shorthand — matches the abbreviation style PCO
  // itself already uses in its own "short" arrangement display, so this
  // reads the same way to anyone used to looking at a chart.
  const SECTION_ABBREVIATIONS = {
    intro: "In",
    verse: "V",
    prechorus: "PC",
    chorus: "C",
    bridge: "B",
    interlude: "Int",
    instrumental: "Inst",
    tag: "Tag",
    outro: "Out",
    ending: "End",
    vamp: "Vmp",
    turnaround: "TA",
  };

  /** "Verse 1" -> "V1", "(FS) Intro" -> "In", "Turnaround" -> "TA" — falls back to the original label untouched for anything unrecognized. */
  function abbreviateSection(label) {
    const stripped = String(label ?? "")
      .trim()
      .replace(/^\([^)]*\)\s*/, "");
    const match = stripped.match(/^([A-Za-z]+)\s*(\d+)?$/);
    if (!match) return stripped;
    const [, word, num] = match;
    const abbr = SECTION_ABBREVIATIONS[word.toLowerCase()] ?? word;
    return num ? `${abbr}${num}` : abbr;
  }

  /** Abbreviates every section and collapses consecutive repeats into "C1×2" instead of "C1, C1". */
  function compactTokens(sequence) {
    const collapsed = [];
    for (const raw of sequence ?? []) {
      const label = abbreviateSection(raw);
      const last = collapsed[collapsed.length - 1];
      if (last && last.label === label) last.count += 1;
      else collapsed.push({ label, count: 1 });
    }
    return collapsed.map((c) => (c.count > 1 ? `${c.label}×${c.count}` : c.label));
  }

  /**
   * Marks the tokens on one side that the other side has no counterpart for.
   *
   * Multiset difference rather than a positional diff on purpose: positionally,
   * a single inserted chorus makes every token after it "different", which
   * paints the whole line and tells the operator nothing. By count, only the
   * sections that are genuinely extra or missing get marked.
   */
  function markDivergence(mine, theirs) {
    const pool = new Map();
    for (const t of theirs) pool.set(t, (pool.get(t) ?? 0) + 1);
    return mine.map((label) => {
      const left = pool.get(label) ?? 0;
      if (left > 0) {
        pool.set(label, left - 1);
        return { label, diverges: false };
      }
      return { label, diverges: true };
    });
  }

  function renderTokens(tokens, joiner) {
    if (!tokens.length) return `<span class="rf-compare-empty">Not recorded</span>`;
    return tokens
      .map((t) => `<span class="${t.diverges ? "rf-flag" : ""}">${escapeHtml(t.label)}</span>`)
      .join(`<span class="rf-arrow">${joiner}</span>`);
  }

  /**
   * The detail view's hero: the two sequences in the same treatment, on the
   * same axis, so a divergence reads as a shape rather than as a sentence.
   *
   * "Planned" deliberately doesn't name the provider — a future
   * church-management integration wouldn't be Planning Center at all — while
   * "from ProPresenter" is provenance and belongs on the silkscreen line.
   */
  function renderComparison(actual, planned, isLogger) {
    const actualTokens = compactTokens(actual);
    const plannedTokens = compactTokens(planned);
    return `
      <div class="rf-compare">
        <div class="rf-compare-line">
          <span class="rf-silkscreen">Actual &middot; from ProPresenter</span>
          <span class="rf-compare-seq">${renderTokens(markDivergence(actualTokens, plannedTokens), " &rarr; ")}</span>
        </div>
        <div class="rf-compare-line">
          <span class="rf-silkscreen flex items-center gap-2">
            <span>Planned</span>
            ${isLogger ? `<button id="edit-planned-btn" class="btn btn-chip">Edit</button>` : ""}
          </span>
          <span class="rf-compare-seq" id="planned-line">${renderTokens(markDivergence(plannedTokens, actualTokens), " &rarr; ")}</span>
        </div>
      </div>
    `;
  }

  /**
   * The compact two-row version, for a history entry or a compare-all result
   * where the hero treatment would be too loud. Same vocabulary, comma-joined
   * and collapsed so it reads as a list rather than a flow diagram.
   */
  function renderSequenceComparison(planned, actual) {
    const plannedTokens = compactTokens(planned);
    const actualTokens = compactTokens(actual);
    return `
      <div class="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0.5 text-xs mt-1">
        <span class="opacity-60">Planned:</span><span>${renderTokens(markDivergence(plannedTokens, actualTokens), ", ")}</span>
        <span class="opacity-60">Slides:</span><span>${renderTokens(markDivergence(actualTokens, plannedTokens), ", ")}</span>
      </div>
    `;
  }

  return { render };
}
