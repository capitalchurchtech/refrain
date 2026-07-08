/**
 * Arrangement drift-tracking screen (Section 8). This screen only
 * appears once config.json's arrangementModule is enabled and active
 * (Section 4.1's three-state gate, enforced by nav.js already hiding
 * "off" and the server 409-ing writes when not "active"). The
 * "weekend plan" one-button workflow further gates on the configured
 * provider's supportsPlanBrowsing capability — Planning Center has it,
 * but nothing here hardcodes that it's the only provider that could.
 */
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
          Arrangement module is ${status.status === "misconfigured" ? "misconfigured" : "not enabled"} —
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
        <div id="arrangement-list-view" class="flex flex-col gap-4">
          ${
            status.role !== "logger"
              ? `<div class="alert alert-info py-2 text-sm">Read-only — this machine's role is "reader." Comparisons run on the logger machine.</div>`
              : ""
          }
          ${showWeekendPlan ? `<div id="weekend-plan-card" class="card bg-base-200"><div class="card-body p-3 gap-2"></div></div>` : ""}
          <input type="text" id="arrangement-song-filter" class="input input-bordered w-full" placeholder="Filter..." />
          <div class="flex flex-col divide-y divide-base-300" id="arrangement-song-list"></div>
        </div>
        <div id="arrangement-detail" class="hidden"></div>
      </div>
    `;

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
      body.innerHTML = `<h2 class="card-title text-base"><i data-lucide="calendar-check" class="w-4 h-4"></i> This weekend's plan</h2><div class="text-sm text-warning">${escapeHtml(data.error)}</div>`;
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
            <i data-lucide="${s.presentationId ? "check-circle-2" : "help-circle"}" class="w-3.5 h-3.5 shrink-0 ${s.presentationId ? "text-success" : "text-warning"}"></i>
            <span class="flex-1 truncate min-w-0">${escapeHtml(s.title)}</span>
          </div>
        `
          )
          .join("")}
      </div>
      <button id="compare-all-btn" class="btn btn-brand btn-sm w-fit mt-1">
        <i data-lucide="git-compare" class="w-3.5 h-3.5"></i> Compare All Songs
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
        resultsEl.innerHTML = `<div class="text-sm text-warning mt-2">${escapeHtml(data.error)}</div>`;
        return;
      }

      resultsEl.innerHTML = `
        <div class="flex flex-col gap-2 mt-2">
          ${data.results
            .map((r) => {
              const matches = !r.diff.skipped.length && !r.diff.added.length && !r.diff.reordered.length;
              const suggestUpdate = (!matches || r.alwaysDiffers) && !r.ignored;
              const canPush = suggestUpdate && r.externalSongId && r.externalArrangementId;
              return `
              <div class="text-sm bg-base-100 rounded p-2" data-presentation-id="${escapeHtml(r.presentationId ?? "")}" data-service-date="${escapeHtml(data.serviceDate)}">
                <div class="font-medium flex items-center justify-between gap-2">
                  <span class="flex items-center gap-2 min-w-0 truncate">
                    <i data-lucide="${matches ? "check-circle-2" : "alert-triangle"}" class="w-3.5 h-3.5 shrink-0 ${matches ? "text-success" : "text-warning"}"></i>
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
                    ? `<div class="text-xs opacity-60 mt-1 flex items-center gap-1"><i data-lucide="eye-off" class="w-3 h-3"></i> Ignored — marked as an atypical, non-representative performance.</div>`
                    : suggestUpdate
                      ? `<div class="text-warning text-xs mt-1">${r.alwaysDiffers && matches ? "Flagged as always different — review and update the plan." : "Consider updating the plan to match what was actually played."}</div>`
                      : ""
                }
                <div class="flex items-center gap-2 mt-1">
                  ${
                    canPush
                      ? `<button class="btn btn-brand btn-xs push-arrangement-btn" data-external-song-id="${escapeHtml(r.externalSongId)}" data-external-arrangement-id="${escapeHtml(r.externalArrangementId)}" data-sequence="${escapeHtml(JSON.stringify(r.actual))}">
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
                  <div class="font-medium flex items-center gap-2"><i data-lucide="help-circle" class="w-3.5 h-3.5 text-warning"></i> Not found in ProPresenter</div>
                  <div class="opacity-70 mt-1">${data.unmatched.map((u) => escapeHtml(u.title)).join(", ")}</div>
                </div>`
              : ""
          }
        </div>
      `;
      wireCompareAllResultActions(resultsEl);
      if (window.lucide) window.lucide.createIcons();
      // Song-list counts (historyCount/lastServiceDate) are now stale
      // until the next full render() — not worth a rebuild here, since
      // render() would also wipe the results we just showed.
    } finally {
      if (btn.isConnected) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="git-compare" class="w-3.5 h-3.5"></i> Compare All Songs`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
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
            "This updates the shared arrangement — it will affect every future plan that reuses it, not just this one. You can undo immediately after."
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
            resultEl.innerHTML = `<span class="text-warning">${escapeHtml(data.error)}</span>`;
            btn.remove();
            return;
          }
          btn.remove();
          resultEl.innerHTML = `
            <span class="text-success"><i data-lucide="check" class="w-3 h-3 inline"></i> Pushed to ${escapeHtml(providerDisplayName)}.</span>
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
                : `<span class="text-warning">${escapeHtml(undoData.error)}</span>`;
            } catch (err) {
              resultEl.innerHTML = `<span class="text-warning">${escapeHtml(err.message)}</span>`;
            }
          });
        } catch (err) {
          resultEl.innerHTML = `<span class="text-warning">${escapeHtml(err.message)}</span>`;
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
          alert(`Failed to update: ${err.message}`);
        }
      });
    });
  }

  function renderSongList(songs, role) {
    const listEl = document.getElementById("arrangement-song-list");
    listEl.innerHTML = songs.length
      ? songs
          .map(
            (s) => `
      <button class="btn btn-ghost btn-sm justify-start song-btn w-full h-auto py-2 rounded-none min-w-0" data-id="${s.presentationId}">
        <i data-lucide="${s.hasPlannedArrangement ? "check-circle-2" : "alert-circle"}" class="w-3.5 h-3.5 shrink-0 ${s.hasPlannedArrangement ? "text-success" : "text-warning"}"></i>
        <span class="flex-1 text-left truncate min-w-0">${escapeHtml(s.name)}</span>
        <span class="text-xs opacity-60 flex items-center gap-2 shrink-0">
          <span class="flex items-center gap-1"><i data-lucide="history" class="w-3 h-3"></i>${s.historyCount}</span>
          ${s.lastServiceDate ? `<span class="flex items-center gap-1"><i data-lucide="calendar" class="w-3 h-3"></i>${escapeHtml(s.lastServiceDate)}</span>` : ""}
        </span>
      </button>
    `
          )
          .join("")
      : `<div class="text-sm opacity-60 py-2">No matches</div>`;

    listEl.querySelectorAll(".song-btn").forEach((btn) => {
      btn.addEventListener("click", () => renderDetail(btn.dataset.id, role));
    });

    if (window.lucide) window.lucide.createIcons();
  }

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

    detailEl.innerHTML = `
      <button id="arrangement-back-btn" class="btn btn-ghost btn-sm w-fit">
        <i data-lucide="arrow-left" class="w-4 h-4"></i> Back
      </button>
      <div class="card bg-base-200 mt-2">
        <div class="card-body p-3 gap-4">
          <h2 class="card-title text-base">${escapeHtml(record.songName)}</h2>

          <div>
            <div class="text-sm font-semibold mb-1">Actual arrangement (from ProPresenter)</div>
            <div class="text-sm opacity-70">${record.groupSequence.map(escapeHtml).join(" &rarr; ")}</div>
          </div>

          <div>
            <div class="text-sm font-semibold mb-1">Section mapping</div>
            <div class="flex flex-col gap-1" id="mapping-rows">
              ${uniqueGroups
                .map(
                  (g) => `
                <div class="flex items-center gap-2">
                  <span class="text-sm w-40 shrink-0 truncate" title="${escapeHtml(g)}">${escapeHtml(g)}</span>
                  <span class="opacity-50">&rarr;</span>
                  <input type="text" class="input input-bordered input-xs flex-1 mapping-input" data-group="${escapeHtml(g)}" value="${escapeHtml(record.sectionMapping[g] ?? g)}" ${isLogger ? "" : "disabled"} />
                </div>
              `
                )
                .join("")}
            </div>
            ${isLogger ? `<button id="save-mapping-btn" class="btn btn-outline btn-xs mt-2">Save Mapping</button>` : ""}
          </div>

          <div>
            <div class="text-sm font-semibold mb-1">Planned arrangement (one section per line)</div>
            <textarea id="planned-textarea" rows="4" class="textarea textarea-bordered w-full text-sm" ${isLogger ? "" : "disabled"}>${escapeHtml((record.manualPlannedArrangement ?? []).join("\n"))}</textarea>
            ${isLogger ? `<button id="save-planned-btn" class="btn btn-outline btn-xs mt-2">Save Planned Arrangement</button>` : ""}
          </div>

          ${
            isLogger
              ? `
          <div class="flex flex-wrap items-center gap-2">
            <input type="date" id="service-date" class="input input-bordered input-sm" value="${new Date().toISOString().slice(0, 10)}" />
            <button id="run-comparison-btn" class="btn btn-brand btn-sm">Run Comparison Now</button>
            <span id="comparison-result" class="text-sm"></span>
          </div>`
              : ""
          }

          <div>
            <div class="text-sm font-semibold mb-1">History</div>
            <div class="flex flex-col gap-2" id="history-list">
              ${
                (record.history ?? []).length === 0
                  ? `<div class="text-sm opacity-60">No comparisons run yet.</div>`
                  : [...record.history]
                      .reverse()
                      .map(
                        (h) => {
                          const matches = !h.diff.skipped.length && !h.diff.added.length && !h.diff.reordered.length;
                          return `
                <div class="text-sm bg-base-100 rounded p-2 history-entry" data-service-date="${escapeHtml(h.serviceDate)}">
                  <div class="font-medium flex items-center justify-between gap-2">
                    <span class="flex items-center gap-2">
                      <i data-lucide="${matches ? "check-circle-2" : "alert-triangle"}" class="w-3.5 h-3.5 shrink-0 ${matches ? "text-success" : "text-warning"}"></i>
                      ${formatCompactDate(h.serviceDate)}
                    </span>
                    ${
                      isLogger && !matches
                        ? `<button class="btn btn-ghost btn-xs history-ignore-btn">
                            <i data-lucide="${h.ignored ? "eye" : "eye-off"}" class="w-3 h-3"></i> ${h.ignored ? "Un-ignore" : "Ignore"}
                          </button>`
                        : ""
                    }
                  </div>
                  ${
                    h.ignored
                      ? `<div class="text-xs opacity-60 mt-1 flex items-center gap-1"><i data-lucide="eye-off" class="w-3 h-3"></i> Ignored — atypical performance, excluded from suggestions.</div>`
                      : ""
                  }
                  ${renderSequenceComparison(h.planned, h.actual)}
                </div>
              `;
                        }
                      )
                      .join("")
              }
            </div>
          </div>
        </div>
      </div>
    `;

    if (isLogger) {
      document.getElementById("save-mapping-btn").addEventListener("click", async () => {
        const sectionMapping = {};
        detailEl.querySelectorAll(".mapping-input").forEach((input) => {
          sectionMapping[input.dataset.group] = input.value.trim() || input.dataset.group;
        });
        await fetch(`/api/arrangement/song/${presentationId}/mapping`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sectionMapping }),
        });
      });

      document.getElementById("save-planned-btn").addEventListener("click", async () => {
        const manualPlannedArrangement = document
          .getElementById("planned-textarea")
          .value.split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        await fetch(`/api/arrangement/song/${presentationId}/planned`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manualPlannedArrangement }),
        });
      });

      document.getElementById("run-comparison-btn").addEventListener("click", () => runComparison(presentationId, false));

      detailEl.querySelectorAll(".history-ignore-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
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
            alert(`Failed to update: ${err.message}`);
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

  /** Abbreviates every section and collapses consecutive repeats into "C1×2" instead of "C1, C1" — comma-joined, not arrow-joined, to read as a compact list rather than a flow diagram. */
  function compactSequence(sequence) {
    if (!sequence?.length) return "(none)";
    const collapsed = [];
    for (const raw of sequence) {
      const label = abbreviateSection(raw);
      const last = collapsed[collapsed.length - 1];
      if (last && last.label === label) last.count += 1;
      else collapsed.push({ label, count: 1 });
    }
    return collapsed.map((c) => (c.count > 1 ? `${c.label}×${c.count}` : c.label)).join(", ");
  }

  /**
   * Two-row "Planned" vs "Slides" comparison, abbreviated and
   * comma-joined — replaces a single run-on sentence of full section
   * names with something scannable at a glance. "Planned" (not e.g.
   * "PCO") deliberately doesn't name the provider, since a future
   * church-management integration wouldn't be PCO at all.
   */
  function renderSequenceComparison(planned, actual) {
    return `
      <div class="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0.5 text-xs mt-1">
        <span class="opacity-60">Planned:</span><span>${escapeHtml(compactSequence(planned))}</span>
        <span class="opacity-60">Slides:</span><span>${escapeHtml(compactSequence(actual))}</span>
      </div>
    `;
  }

  return { render };
}
