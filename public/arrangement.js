/**
 * Arrangement drift-tracking screen (Section 8). Only meaningfully
 * wired up for the manual provider + local-folder storage pairing so
 * far — planning-center.js/sftp.js are still stubs, so this screen
 * only appears once config.json's arrangementModule is enabled and
 * active (Section 4.1's three-state gate, enforced by nav.js already
 * hiding "off" and the server 409-ing writes when not "active").
 */
export function initArrangement() {
  const container = document.getElementById("view-arrangement");
  let currentSongs = [];

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

    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        ${
          status.role !== "logger"
            ? `<div class="alert alert-info py-2 text-sm">Read-only — this machine's role is "reader." Comparisons run on the logger machine.</div>`
            : ""
        }
        <div class="flex flex-col gap-2" id="arrangement-song-list">
          ${songs
            .map(
              (s) => `
            <button class="btn btn-ghost justify-start song-btn" data-id="${s.presentationId}">
              <span class="flex-1 text-left">${escapeHtml(s.name)}</span>
              <span class="text-xs opacity-60">
                ${s.hasPlannedArrangement ? "" : "unmapped &middot; "}${s.historyCount} comparison(s)${s.lastServiceDate ? ` &middot; last ${s.lastServiceDate}` : ""}
              </span>
            </button>
          `
            )
            .join("")}
        </div>
        <div id="arrangement-detail"></div>
      </div>
    `;

    container.querySelectorAll(".song-btn").forEach((btn) => {
      btn.addEventListener("click", () => renderDetail(btn.dataset.id, status.role));
    });
  }

  async function renderDetail(presentationId, role) {
    const detailEl = document.getElementById("arrangement-detail");
    const record = await fetch(`/api/arrangement/song/${presentationId}`).then((r) => r.json());
    const isLogger = role === "logger";
    const uniqueGroups = [...new Set(record.groupSequence)];

    detailEl.innerHTML = `
      <div class="card bg-base-200 mt-2">
        <div class="card-body gap-4">
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
          <div class="flex items-center gap-2">
            <input type="date" id="service-date" class="input input-bordered input-sm" value="${new Date().toISOString().slice(0, 10)}" />
            <button id="run-comparison-btn" class="btn btn-primary btn-sm">Run Comparison Now</button>
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
                        (h) => `
                <div class="text-sm bg-base-100 rounded p-2">
                  <div class="font-medium">${h.serviceDate}</div>
                  ${h.diff.skipped.length ? `<div class="text-warning">Skipped: ${h.diff.skipped.map(escapeHtml).join(", ")}</div>` : ""}
                  ${h.diff.added.length ? `<div class="text-info">Added: ${h.diff.added.map(escapeHtml).join(", ")}</div>` : ""}
                  ${h.diff.reordered.length ? `<div class="opacity-70">Actual order: ${h.diff.reordered.map(escapeHtml).join(" &rarr; ")}</div>` : ""}
                  ${!h.diff.skipped.length && !h.diff.added.length && !h.diff.reordered.length ? `<div class="text-success">Matched plan exactly</div>` : ""}
                </div>
              `
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
    }
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

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  return { render };
}
