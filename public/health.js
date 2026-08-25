const ARRANGEMENT_STATUS_LABEL = {
  off: null, // hidden entirely per Section 4.1
  misconfigured: "Misconfigured",
  active: "Active",
};

export function initHealth() {
  const container = document.getElementById("view-health");

  // Checked once per page load, not on every save-triggered re-render —
  // it's an external call to GitHub, no need to repeat it every time a
  // config field is saved.
  let versionCheck = null;
  async function fetchVersionCheck() {
    if (versionCheck) return versionCheck;
    versionCheck = await fetch("/api/version-check")
      .then((r) => r.json())
      .catch(() => ({ currentVersion: null, latestVersion: null, updateAvailable: false, repoUrl: null }));
    return versionCheck;
  }

  async function render() {
    // A full container.innerHTML replace (below) recreates the Library
    // Sync <details> from scratch every time, which would otherwise
    // silently re-collapse it right after the user opens it to click
    // Save inside — capture and restore its open/closed state across
    // the re-render.
    const wasLibrarySyncOpen = document.getElementById("library-sync-details")?.open ?? false;
    const scrollY = window.scrollY;

    const [health, libraryFolders, configOptions, versionInfo] = await Promise.all([
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/library-folders").then((r) => (r.ok ? r.json() : { folders: [], selected: null, error: true })),
      fetch("/api/config-options").then((r) => r.json()),
      fetchVersionCheck(),
    ]);
    const trackArrangement = health.arrangementModule.status !== "off";
    const arrangementFolders = trackArrangement
      ? await fetch("/api/arrangement/folders").then((r) => (r.ok ? r.json() : { folders: [], selected: null, error: true }))
      : null;
    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="heart-pulse" class="w-5 h-5"></i> Health</h1>
        ${renderHealth(health, configOptions, versionInfo)}
        ${renderLibraryCard(libraryFolders, arrangementFolders)}
      </div>`;

    const librarySyncDetails = document.getElementById("library-sync-details");
    if (librarySyncDetails) librarySyncDetails.open = wasLibrarySyncOpen;
    window.scrollTo(0, scrollY);

    if (window.lucide) window.lucide.createIcons();

    const updateNowBtn = document.getElementById("update-now-btn");
    if (updateNowBtn) {
      const statusEl = document.getElementById("update-status");
      updateNowBtn.addEventListener("click", async () => {
        updateNowBtn.disabled = true;
        statusEl.textContent = "Updating...";
        statusEl.className = "text-sm opacity-70";
        try {
          const res = await fetch("/api/update", { method: "POST" });
          const data = await res.json();
          if (!res.ok) {
            statusEl.textContent = data.error;
            statusEl.className = "text-sm text-warning";
            updateNowBtn.disabled = false;
            return;
          }
          statusEl.textContent = "Updated. Restart Refrain to finish.";
          statusEl.className = "text-sm text-success";
        } catch (err) {
          statusEl.textContent = `Update failed: ${err.message}`;
          statusEl.className = "text-sm text-warning";
          updateNowBtn.disabled = false;
        }
      });
    }
    const recheckBtn = document.getElementById("update-recheck-btn");
    if (recheckBtn) {
      recheckBtn.addEventListener("click", () => {
        versionCheck = null; // bust the cached check so it re-fetches
        render();
      });
    }

    const diagnoseBtn = document.getElementById("pp-diagnose-btn");
    if (diagnoseBtn) {
      const statusEl = document.getElementById("pp-diagnose-status");
      const resultsEl = document.getElementById("pp-diagnose-results");

      // Severity drives the stripe and chip so the worst thing reads first
      // without having to be read at all.
      const TONE = {
        problem: { border: "border-error", chip: "badge-error", label: "Problem" },
        warn: { border: "border-warning", chip: "badge-warning", label: "Check" },
        info: { border: "border-info", chip: "badge-info", label: "Info" },
        ok: { border: "border-success", chip: "badge-success", label: "OK" },
      };

      diagnoseBtn.addEventListener("click", async () => {
        diagnoseBtn.disabled = true;
        statusEl.textContent = "Checking this machine...";
        resultsEl.innerHTML = "";
        try {
          const data = await fetch("/api/propresenter/diagnose").then((r) => r.json());
          statusEl.textContent = `Checked ${new Date(data.checkedAt).toLocaleTimeString()}`;
          resultsEl.innerHTML = (data.findings ?? [])
            .map((f, i) => {
              const tone = TONE[f.severity] ?? TONE.info;
              return `
              <div class="border-l-2 ${tone.border} bg-base-100 rounded p-2 flex flex-col gap-1">
                <div class="flex items-start justify-between gap-2">
                  <div class="text-sm font-medium">
                    <span class="badge ${tone.chip} badge-sm mr-1">${tone.label}</span>${escapeHtml(f.title)}
                  </div>
                  ${
                    f.prompt
                      ? `<button type="button" class="btn btn-ghost btn-xs shrink-0 pp-copy-prompt" data-index="${i}" title="Copy a ready-made prompt to paste into Claude Code">
                           <span class="copy-icon"><i data-lucide="clipboard"></i></span> Copy prompt
                         </button>`
                      : ""
                  }
                </div>
                <div class="text-xs opacity-70 whitespace-pre-line">${escapeHtml(f.detail)}</div>
                ${
                  f.command
                    ? `<div class="flex items-center gap-2 mt-1">
                         <code class="text-xs bg-base-200 rounded px-2 py-1 flex-1 overflow-x-auto whitespace-nowrap">${escapeHtml(f.command)}</code>
                         <button type="button" class="btn btn-ghost btn-xs shrink-0 pp-copy-command" data-index="${i}" title="Copy this command">
                           <span class="copy-icon"><i data-lucide="copy"></i></span>
                         </button>
                       </div>`
                    : ""
                }
              </div>`;
            })
            .join("");
          if (window.lucide) window.lucide.createIcons();

          // Copy with visible confirmation: under pressure a silent copy is
          // indistinguishable from a dead button.
          const wireCopy = (selector, pick) =>
            resultsEl.querySelectorAll(selector).forEach((btn) =>
              btn.addEventListener("click", async () => {
                const text = pick(data.findings[Number(btn.dataset.index)]);
                const iconWrap = btn.querySelector(".copy-icon");
                let ok = true;
                try {
                  await navigator.clipboard.writeText(text);
                } catch {
                  ok = false;
                }
                iconWrap.innerHTML = `<i data-lucide="${ok ? "check" : "x"}"></i>`;
                if (window.lucide) window.lucide.createIcons();
                if (!ok) btn.title = "Couldn't copy - select the text manually";
                setTimeout(() => {
                  iconWrap.innerHTML = `<i data-lucide="${selector.includes("prompt") ? "clipboard" : "copy"}"></i>`;
                  if (window.lucide) window.lucide.createIcons();
                }, 1200);
              })
            );
          wireCopy(".pp-copy-prompt", (f) => f.prompt);
          wireCopy(".pp-copy-command", (f) => f.command);
        } catch (err) {
          statusEl.textContent = `Diagnose failed: ${err.message}`;
        } finally {
          diagnoseBtn.disabled = false;
        }
      });
    }

    const configDetectBtn = document.getElementById("config-detect-btn");
    if (configDetectBtn) {
      const detectResult = document.getElementById("config-detect-result");
      const networkOffer = document.getElementById("config-network-scan-offer");

      // Local-only unless the operator escalates: a network sweep reaches other
      // machines' ProPresenter, which may be live.
      const runDetect = async (button, scanNetwork) => {
        button.disabled = true;
        detectResult.textContent = scanNetwork ? "Searching the network..." : "Looking on this machine...";
        detectResult.className = "text-sm opacity-70";
        try {
          const res = await fetch("/api/setup/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scanNetwork }),
          });
          const data = await res.json();
          const found = data.candidates?.[0];
          if (found) {
            document.getElementById("config-host").value = found.host;
            document.getElementById("config-port").value = found.port;
            const extra = data.candidates.length > 1 ? ` (+${data.candidates.length - 1} more)` : "";
            detectResult.textContent = `Found ${found.name} at ${found.host}:${found.port}${extra} — Save to apply.`;
            detectResult.className = "text-sm text-success";
            networkOffer?.classList.add("hidden");
          } else if (scanNetwork) {
            detectResult.textContent = "Nothing found on the network either. Type the host and port above.";
            detectResult.className = "text-sm text-warning";
          } else {
            detectResult.textContent = "No ProPresenter on this machine. Check its Network API is on, or type the host and port above.";
            detectResult.className = "text-sm text-warning";
            networkOffer?.classList.remove("hidden");
            if (window.lucide) window.lucide.createIcons();
          }
        } catch (err) {
          detectResult.textContent = `Scan failed: ${err.message}`;
          detectResult.className = "text-sm text-error";
        } finally {
          button.disabled = false;
        }
      };

      configDetectBtn.addEventListener("click", () => runDetect(configDetectBtn, false));
      document
        .getElementById("config-network-scan-btn")
        ?.addEventListener("click", (e) => runDetect(e.currentTarget, true));
    }

    const reindexBtn = document.getElementById("health-reindex-btn");
    if (reindexBtn) {
      const label = document.getElementById("health-reindex-btn-label");
      const statusEl = document.getElementById("health-reindex-status");
      reindexBtn.addEventListener("click", async () => {
        reindexBtn.disabled = true;
        label.textContent = "Checking files...";
        statusEl.textContent = "";
        statusEl.className = "text-sm";
        try {
          const res = await fetch("/api/index/reindex-changed", { method: "POST" });
          const data = await res.json();
          if (!res.ok) {
            statusEl.textContent = data.error;
            statusEl.className = "text-sm text-error";
            return;
          }
          // Say what happened rather than just "done". A reindex that quietly
          // turned into a full rebuild is exactly the surprise the warning
          // above is trying to prevent.
          const c = data.counts;
          // "unverifiable" has to be named, not folded into the others. On the
          // first reindex after an upgrade it can be most of the library, and a
          // message reading "0 changed, 0 new" for a run that re-read 221
          // presentations over half a minute is just baffling.
          const parts = c
            ? [
                `${c.changed} changed`,
                `${c.added} new`,
                ...(c.unverifiable ? [`${c.unverifiable} re-checked`] : []),
                `${c.carriedOver} reused`,
              ]
            : [];
          const message =
            data.buildMode === "incremental" && c
              ? `Reindexed in ${formatDuration(data.buildDurationMs)}: ${parts.join(", ")}.`
              : `Full rebuild was needed, finished in ${formatDuration(data.buildDurationMs)}.`;
          // Re-render so the status tiles and the last-run line stop showing
          // pre-reindex figures, then put the result back on the fresh element
          // the re-render just created.
          await render();
          const freshStatus = document.getElementById("health-reindex-status");
          if (freshStatus) {
            freshStatus.textContent = message;
            freshStatus.className = "text-sm text-success";
          }
          return;
        } catch (err) {
          statusEl.textContent = `Reindex failed: ${err.message}`;
          statusEl.className = "text-sm text-error";
        } finally {
          if (reindexBtn.isConnected) {
            reindexBtn.disabled = false;
            label.textContent = "Reindex changed only";
          }
        }
      });
    }

    const btn = document.getElementById("health-rebuild-btn");
    if (btn) {
      const btnLabel = document.getElementById("health-rebuild-btn-label");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btnLabel.textContent = "Rebuilding...";
        try {
          await fetch("/api/index/rebuild", { method: "POST" });
          await render();
        } finally {
          if (btn.isConnected) {
            btn.disabled = false;
            btnLabel.textContent = "Rebuild Everything";
          }
        }
      });
    }

    const saveFoldersBtn = document.getElementById("save-library-folders-btn");
    if (saveFoldersBtn) {
      saveFoldersBtn.addEventListener("click", async () => {
        const allChecked = document.getElementById("library-folder-all").checked;
        const folders = allChecked
          ? null
          : Array.from(document.querySelectorAll(".library-folder-checkbox:checked")).map((el) => el.value);

        saveFoldersBtn.disabled = true;
        saveFoldersBtn.textContent = "Saving...";
        try {
          await fetch("/api/library-folders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folders }),
          });
        } finally {
          if (saveFoldersBtn.isConnected) {
            saveFoldersBtn.disabled = false;
            saveFoldersBtn.textContent = "Save & Rebuild";
          }
        }
        // Not awaited: /api/health's live ProPresenter connectivity
        // check can take up to 8s to time out when unreachable, and
        // the save itself already succeeded — don't make the button
        // hang on an unrelated status refresh.
        render();
      });

      const allCheckbox = document.getElementById("library-folder-all");
      const folderCheckboxes = document.querySelectorAll(".library-folder-checkbox");
      allCheckbox.addEventListener("change", () => {
        folderCheckboxes.forEach((cb) => (cb.disabled = allCheckbox.checked));
      });
    }

    const saveArrangementFoldersBtn = document.getElementById("save-arrangement-folders-btn");
    if (saveArrangementFoldersBtn) {
      saveArrangementFoldersBtn.addEventListener("click", async () => {
        const allChecked = document.getElementById("arrangement-folder-all").checked;
        const folders = allChecked
          ? null
          : Array.from(document.querySelectorAll(".arrangement-folder-checkbox:checked")).map((el) => el.value);

        saveArrangementFoldersBtn.disabled = true;
        saveArrangementFoldersBtn.textContent = "Saving...";
        try {
          await fetch("/api/arrangement/folders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folders }),
          });
        } finally {
          if (saveArrangementFoldersBtn.isConnected) {
            saveArrangementFoldersBtn.disabled = false;
            saveArrangementFoldersBtn.textContent = "Save";
          }
        }
        render(); // not awaited — see save-library-folders-btn's handler for why
      });

      const arrangementAllCheckbox = document.getElementById("arrangement-folder-all");
      const arrangementFolderCheckboxes = document.querySelectorAll(".arrangement-folder-checkbox");
      arrangementAllCheckbox.addEventListener("change", () => {
        arrangementFolderCheckboxes.forEach((cb) => (cb.disabled = arrangementAllCheckbox.checked));
      });
    }

    const lyricsSiteCheckboxes = document.querySelectorAll(".config-lyrics-site-checkbox");
    const lyricsSitesHint = document.getElementById("config-lyrics-sites-hint");
    if (lyricsSiteCheckboxes.length) {
      const maxLyricsSites = lyricsSiteCheckboxes.length ? Number(lyricsSitesHint?.dataset.max) || 5 : 5;
      lyricsSiteCheckboxes.forEach((cb) => {
        cb.addEventListener("change", () => {
          const checkedCount = document.querySelectorAll(".config-lyrics-site-checkbox:checked").length;
          const atLimit = checkedCount >= maxLyricsSites;
          lyricsSiteCheckboxes.forEach((other) => {
            if (!other.checked) other.disabled = atLimit;
          });
          lyricsSitesHint.classList.toggle("hidden", !atLimit);
        });
      });
    }

    const arrangementProviderSelect = document.getElementById("config-arrangement-provider");
    const planningCenterServiceTypeWrap = document.getElementById("config-planning-center-service-type-wrap");
    if (arrangementProviderSelect) {
      arrangementProviderSelect.addEventListener("change", () => {
        planningCenterServiceTypeWrap.classList.toggle("hidden", arrangementProviderSelect.value !== "planning-center");
      });
    }

    const arrangementStorageSelect = document.getElementById("config-arrangement-storage");
    const storagePathWrap = document.getElementById("config-storage-path-wrap");
    const detectPathBtn = document.getElementById("detect-storage-path-btn");
    if (arrangementStorageSelect) {
      arrangementStorageSelect.addEventListener("change", () => {
        const backend = arrangementStorageSelect.value;
        storagePathWrap.classList.toggle("hidden", !["local-folder", "synced-folder"].includes(backend));
        detectPathBtn.classList.toggle("hidden", backend !== "synced-folder");
      });
    }
    if (detectPathBtn) {
      detectPathBtn.addEventListener("click", async () => {
        const resultEl = document.getElementById("detect-storage-path-result");
        detectPathBtn.disabled = true;
        resultEl.textContent = "Scanning for Google Drive / Dropbox / OneDrive...";
        try {
          const { candidates } = await fetch("/api/arrangement/detect-storage-paths").then((r) => r.json());
          if (!candidates.length) {
            resultEl.textContent = "Nothing found — make sure the desktop sync app is installed and has synced at least once, or enter the path by hand.";
            return;
          }
          resultEl.innerHTML = candidates
            .map(
              (c) =>
                `<button type="button" class="btn btn-ghost btn-xs detect-path-option" data-path="${escapeHtml(c.path)}">${escapeHtml(c.label)}: ${escapeHtml(c.path)}</button>`
            )
            .join("<br>");
          resultEl.querySelectorAll(".detect-path-option").forEach((btn) => {
            btn.addEventListener("click", () => {
              document.getElementById("config-storage-path").value = btn.dataset.path;
              resultEl.textContent = "";
            });
          });
        } catch (err) {
          resultEl.textContent = `Scan failed: ${err.message}`;
        } finally {
          detectPathBtn.disabled = false;
        }
      });
    }

    const backupConfigBtn = document.getElementById("backup-config-btn");
    if (backupConfigBtn) {
      backupConfigBtn.addEventListener("click", async () => {
        backupConfigBtn.disabled = true;
        try {
          const res = await fetch("/api/config/export");
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || "Failed to back up config.json.");
            return;
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `refrain-config-backup-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } finally {
          backupConfigBtn.disabled = false;
        }
      });
    }

    document.querySelectorAll(".config-arrangement-suggestion").forEach((chip) => {
      chip.addEventListener("click", () => {
        const input = document.getElementById("config-preferred-arrangements");
        const current = input.value.split(",").map((n) => n.trim()).filter(Boolean);
        const name = chip.dataset.name;
        // Appending (not inserting) keeps the admin's priority order intact.
        if (!current.some((n) => n.toLowerCase() === name.toLowerCase())) current.push(name);
        input.value = current.join(", ");
      });
    });

    // Each settings section saves only its own fields. POST /api/config treats
    // an absent key as "leave alone", so a section can post its subset without
    // resubmitting every setting on the page — which is what made one giant
    // Save button feel risky to press.
    const SCOPE_FIELDS = {
      propresenter: () => ({
        role: document.getElementById("config-role").value,
        propresenterHost: document.getElementById("config-host").value,
        propresenterPort: document.getElementById("config-port").value,
      }),
      indexing: () => ({
        crawlPlaylists: document.getElementById("config-crawl-playlists").checked,
        preferredArrangements: document
          .getElementById("config-preferred-arrangements")
          .value.split(",")
          .map((n) => n.trim())
          .filter(Boolean),
      }),
      lyrics: () => ({
        slideSplitter: document.getElementById("config-slide-splitter").value,
        lyricsSites: Array.from(document.querySelectorAll(".config-lyrics-site-checkbox:checked")).map((el) => el.value),
      }),
      qr: () => ({
        qrDefaultBaseUrl: document.getElementById("config-qr-base-url").value,
        qrDefaultLogoUrl: document.getElementById("config-qr-logo-url").value,
        qrRecentLimit: Number(document.getElementById("config-qr-recent-limit").value),
        qrDefaultSize: document.getElementById("config-qr-default-size").value,
      }),
      arrangement: () => ({
        arrangementEnabled: document.getElementById("config-arrangement-enabled").checked,
        arrangementProvider: document.getElementById("config-arrangement-provider").value,
        arrangementStorageBackend: document.getElementById("config-arrangement-storage").value,
        arrangementLocalFolderPath: document.getElementById("config-storage-path").value,
        planningCenterServiceTypeId: document.getElementById("config-planning-center-service-type").value,
      }),
    };

    document.querySelectorAll(".config-save").forEach((btn) => {
      const scope = btn.dataset.scope;
      const statusEl = document.querySelector(`.config-save-status[data-scope="${scope}"]`);
      btn.addEventListener("click", async () => {
        const collect = SCOPE_FIELDS[scope];
        if (!collect) return;
        btn.disabled = true;
        btn.textContent = "Saving...";
        statusEl.textContent = "";
        let saved = false;
        try {
          const res = await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(collect()),
          });
          const data = await res.json();
          if (!res.ok) {
            statusEl.textContent = data.error;
            statusEl.className = "text-sm config-save-status text-error";
            return;
          }
          saved = true;
        } finally {
          if (btn.isConnected) {
            btn.disabled = false;
            btn.textContent = "Save";
          }
        }
        // Not awaited — see save-library-folders-btn's handler for why.
        if (saved) render();
      });
    });

    const openEnvBtn = document.getElementById("open-env-btn");
    if (openEnvBtn) {
      openEnvBtn.addEventListener("click", async () => {
        const statusEl = document.getElementById("open-env-status");
        openEnvBtn.disabled = true;
        statusEl.textContent = "";
        try {
          const res = await fetch("/api/env/open", { method: "POST" });
          const data = await res.json();
          if (!res.ok) {
            statusEl.textContent = data.error;
            statusEl.className = "text-sm text-warning mt-2";
          }
        } finally {
          openEnvBtn.disabled = false;
        }
      });
    }
  }

  return { render };
}

// Default position is top-centered (DaisyUI's plain .tooltip, no
// direction class) — the tooltip's horizontal center matches the
// icon's, so it only risks overflowing the viewport if the icon itself
// is within ~half the tooltip's max-width of an edge. tooltip-right
// (the previous default) shifts the entire wide box rightward from the
// icon, guaranteeing overflow for anything already close to the right
// edge — confirmed live: the Port field's tooltip clipped with no way
// to scroll to the rest of it. Pass "left" for fields known to sit in
// a layout's right-hand column (Port, Storage backend), so their
// tooltip opens toward the open space instead of off the edge.
function infoIcon(tip, direction = "top") {
  const directionClass = { top: "", left: "tooltip-left", right: "tooltip-right", bottom: "tooltip-bottom" }[direction] ?? "";
  return `<span class="tooltip ${directionClass} tooltip-info-wide" data-tip="${escapeHtml(tip)}"><i data-lucide="info" class="w-3.5 h-3.5 opacity-50 cursor-help align-text-top"></i></span>`;
}

function renderLibraryCard({ folders, selected, error }, arrangementFolders) {
  if (error) {
    return `
      <details id="library-sync-details" class="collapse collapse-arrow bg-base-200">
        <summary class="collapse-title text-base font-semibold flex items-center gap-2"><i data-lucide="folder-sync" class="w-4 h-4 opacity-70"></i> Library Sync</summary>
        <div class="collapse-content">
          <div class="text-sm opacity-70">Can't reach ProPresenter to list Library folders right now.</div>
        </div>
      </details>
    `;
  }

  const allSelected = selected === null;
  return `
    <details id="library-sync-details" class="collapse collapse-arrow bg-base-200">
      <summary class="collapse-title text-base font-semibold">Library Sync</summary>
      <div class="collapse-content">
        <div class="text-sm font-semibold mt-1">Searchable</div>
        <div class="text-sm opacity-70 mb-1">Which Library folders to index and search — a smaller scope indexes much faster. Includes anything you want to find slides in, songs or otherwise (e.g. sermons).</div>
        <label class="label cursor-pointer justify-start gap-2 w-fit">
          <input type="checkbox" id="library-folder-all" class="checkbox checkbox-sm" ${allSelected ? "checked" : ""} />
          <span class="label-text">All libraries</span>
        </label>
        <div class="flex flex-col gap-1 ml-1">
          ${folders
            .map(
              (name) => `
            <label class="label cursor-pointer justify-start gap-2 w-fit">
              <input type="checkbox" class="checkbox checkbox-sm library-folder-checkbox" value="${escapeHtml(name)}"
                ${allSelected || selected.includes(name) ? "checked" : ""}
                ${allSelected ? "disabled" : ""} />
              <span class="label-text">${escapeHtml(name)}</span>
            </label>
          `
            )
            .join("")}
        </div>
        <div class="alert alert-warning py-2 text-sm mt-2 items-start">
          <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
          <span><strong>Saving here starts a full rebuild.</strong> That makes ProPresenter sluggish or
          unresponsive for as long as it runs, which can be an hour or more. Only save this when nothing
          important is happening for the next hour or two.</span>
        </div>
        <button id="save-library-folders-btn" class="btn btn-sm btn-outline mt-1 w-fit">Save &amp; Rebuild</button>

        ${arrangementFolders ? renderArrangementFoldersSection(arrangementFolders) : ""}
      </div>
    </details>
  `;
}

// A church's real song-library folder is rarely named exactly "Songs" —
// matches the common conventions so a fresh install gets a sensible
// drift-tracking scope pre-checked instead of either "everything" or
// "nothing." Deliberately narrow (not "import" or other generic catch-all
// folder names) since those don't reliably mean "this holds songs."
const SONG_FOLDER_NAME_HINT = /song|worship|music/i;

function renderArrangementFoldersSection({ folders, selected, error }) {
  const suggested = selected === null ? folders.filter((name) => SONG_FOLDER_NAME_HINT.test(name)) : null;
  // Only auto-narrow to the suggestion when it's an unambiguous, partial
  // match — an empty or all-folders match can't express a preference,
  // so fall back to the old safe default of tracking everything.
  const useSuggestion = suggested !== null && suggested.length > 0 && suggested.length < folders.length;
  const allSelected = selected === null && !useSuggestion;
  const isChecked = (name) => allSelected || (useSuggestion ? suggested.includes(name) : selected?.includes(name));

  return `
    <div class="divider my-1"></div>
    <div class="text-sm font-semibold">Arrangement drift tracking</div>
    ${
      error
        ? `<div class="text-sm opacity-70">Can't reach ProPresenter to list Library folders right now.</div>`
        : folders.length === 0
          ? `<div class="text-sm opacity-70">No Library folders found.</div>`
          : `
      <div class="text-sm opacity-70 mb-1">
        Which Library folders are actually songs, for the drift-tracking module — independent of what's
        searchable above, so e.g. a sermons folder can stay searchable without being treated as a "song"
        with an "arrangement" to track. ${useSuggestion ? `Pre-selected by name below — check this looks right.` : ""}
      </div>
      <label class="label cursor-pointer justify-start gap-2 w-fit">
        <input type="checkbox" id="arrangement-folder-all" class="checkbox checkbox-sm" ${allSelected ? "checked" : ""} />
        <span class="label-text">All libraries</span>
      </label>
      <div class="flex flex-col gap-1 ml-1">
        ${folders
          .map(
            (name) => `
          <label class="label cursor-pointer justify-start gap-2 w-fit">
            <input type="checkbox" class="checkbox checkbox-sm arrangement-folder-checkbox" value="${escapeHtml(name)}"
              ${isChecked(name) ? "checked" : ""}
              ${allSelected ? "disabled" : ""} />
            <span class="label-text">${escapeHtml(name)}</span>
          </label>
        `
          )
          .join("")}
      </div>
      <button id="save-arrangement-folders-btn" class="btn btn-sm btn-outline mt-2 w-fit">Save</button>
    `
    }
  `;
}

// Not DOM-based (div.textContent -> innerHTML) because that only escapes
// what's needed for text-node context (&, <, >) and leaves quote
// characters untouched — safe for text, but this app also interpolates
// escapeHtml() output straight into attribute values (data-tip="...",
// value="...", etc.), where an unescaped `"` in the source string closes
// the attribute early and corrupts the rest of the tag.
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "under a second";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// Accepts either plain id strings (slide splitters — no vendor-friendly
// name needed) or {id, displayName} pairs (providers/storage backends —
// see Section 17.2/17.3) so the visible label is never just a raw id.
function selectOptions(options, current) {
  return options
    .map((opt) => {
      const id = typeof opt === "string" ? opt : opt.id;
      const label = typeof opt === "string" ? opt : opt.displayName;
      return `<option value="${escapeHtml(id)}" ${id === current ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function renderHealth(health, configOptions, versionInfo) {
  const { propresenter, index, arrangementModule, role, version, config, envRequirements } = health;

  const propresenterCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3">
        <h2 class="card-title text-base"><i data-lucide="cast" class="w-4 h-4 opacity-70"></i> ProPresenter Connection</h2>
        <div class="flex items-center gap-2 mt-1">
          <button type="button" id="pp-diagnose-btn" class="btn btn-outline btn-xs">
            <i data-lucide="stethoscope" class="w-3.5 h-3.5"></i> Diagnose
          </button>
          <span id="pp-diagnose-status" class="text-xs opacity-60"></span>
        </div>
        <div id="pp-diagnose-results" class="flex flex-col gap-2"></div>
        ${
          // Connected state lives in the status strip above; repeating it here was
          // the main thing that made this screen read as two copies of itself.
          // What belongs here is only what the strip can't say: how to fix it.
          propresenter.connected
            ? `<div class="text-sm opacity-60">Last checked ${new Date(propresenter.lastCheckIn ?? Date.now()).toLocaleTimeString()}. Run Diagnose if ProPresenter is behaving oddly.</div>`
            : `<div class="text-sm">Check ProPresenter is running with its Network API enabled (Preferences &gt; Network), and that the host and port under Settings are correct.</div>`
        }
      </div>
    </div>
  `;

  const indexCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3">
        <h2 class="card-title text-base"><i data-lucide="database" class="w-4 h-4 opacity-70"></i> Search Index</h2>
        ${
          index.builtAt
            ? `<div class="text-sm opacity-70">
                ${
                  index.buildDurationMs == null
                    ? "Duration unknown — built before this was tracked; rebuild once to see it."
                    : `Last ${index.buildMode === "incremental" ? "reindex" : "full rebuild"} took ${formatDuration(index.buildDurationMs)}${
                        index.buildMode === "incremental" && index.reindexCounts
                          ? ` — re-read ${
                              index.reindexCounts.changed + index.reindexCounts.added + index.reindexCounts.unverifiable
                            }, reused ${index.reindexCounts.carriedOver}`
                          : index.crawledPlaylists
                            ? " (included a playlist crawl)"
                            : " (playlist crawl was off)"
                      }`
                } ${infoIcon("How long the last index rebuild took, so you know whether it's safe to kick off another one — e.g. right before a service — without the risk of it still running when you need ProPresenter free.")}
              </div>`
            : ""
        }
        ${
          index.autoRebuildDeferred
            ? `<div class="alert alert-info py-2 text-sm mt-2 items-start">
                 <i data-lucide="pause-circle" class="w-4 h-4 shrink-0 mt-0.5"></i>
                 <span><strong>${index.builtAt ? "This index is out of date" : "No index has been built yet"}, and Refrain did not rebuild it automatically because it is a Saturday or Sunday.</strong>
                 ${index.builtAt ? "Search still works from the existing index." : "Search will stay empty until you build it."}
                 ${
                   index.builtAt
                     ? "Reindexing changed presentations below is quick and safe to run now. A full rebuild is the one to leave until after the weekend."
                     : "There is nothing to reindex against yet, so the first build has to be a full one — leave it until you have a clear hour or two."
                 }</span>
               </div>`
            : ""
        }
        ${
          index.rebuild.inProgress
            ? `<div class="text-sm mt-1">Rebuilding (${index.rebuild.stage}): ${index.rebuild.current}/${index.rebuild.total || "?"}</div>
               <div class="alert alert-warning py-2 text-sm mt-2 items-start">
                 <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
                 <span><strong>A rebuild is running, so ProPresenter will be sluggish until it finishes.</strong>
                 Go Live, Clear, and macros may be slow or not respond. It can take an hour or more on a large
                 library. If a service is about to start, quit Refrain to stop it and rebuild later.</span>
               </div>`
            : (() => {
                // The scary warning belongs to whichever button is actually
                // going to run an hour-long crawl. With no index yet there is
                // nothing to compare files against, so the only thing on offer
                // IS the full crawl — offering a "quick and safe" reindex
                // button that silently becomes one would be a trap.
                const fullRebuildWarning = `
                  <div class="alert alert-warning py-2 text-sm mt-2 items-start">
                    <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
                    <span>
                      <strong>Do not rebuild anywhere near a service.</strong>
                      A full rebuild reads every presentation in your library one at a time and can run for
                      an hour or more. While it does, ProPresenter itself goes sluggish and can stop
                      responding to Go Live, Clear, and macros. Only start one when you are certain
                      nothing important is happening for the next hour or two, and let it finish.
                    </span>
                  </div>`;
                const fullRebuildButton = `
                  <div class="flex items-center gap-2 mt-1">
                    <button id="health-rebuild-btn" class="btn btn-sm ${index.builtAt ? "btn-outline" : "btn-brand"} w-fit"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> <span id="health-rebuild-btn-label">${index.builtAt ? "Rebuild Everything" : "Build Index"}</span></button>
                    ${infoIcon("Reads every presentation in your library from scratch. Needed for the first build, and after that only if the index looks wrong in a way reindexing does not fix. Never run it before or during a service.")}
                  </div>`;

                if (!index.builtAt) {
                  return `<div class="flex flex-col gap-2 mt-2">
                    <div class="text-sm opacity-70">
                      The first build has to read everything once. After that, reindexing only
                      re-reads the presentations whose file changed.
                    </div>
                    ${fullRebuildWarning}
                    ${fullRebuildButton}
                  </div>`;
                }

                return `<div class="flex flex-col gap-2 mt-2">
                  <div class="flex items-center gap-2">
                    <button id="health-reindex-btn" class="btn btn-sm btn-brand w-fit"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> <span id="health-reindex-btn-label">Reindex changed only</span></button>
                    ${infoIcon("Checks every presentation file on this machine and re-reads only the ones that changed since the last build. Fingerprinting the whole library takes under a second, so a normal week's worth of edits reindexes in seconds instead of an hour.")}
                  </div>
                  <div id="health-reindex-status" class="text-sm"></div>
                  ${
                    index.crawledPlaylists
                      ? `<div class="alert alert-warning py-2 text-sm items-start">
                           <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
                           <span><strong>Playlist crawling is on, so reindexing is not quick.</strong>
                           Which playlists a presentation appears in isn't stored in the presentation's own
                           file, so it can only be found by crawling every playlist again — that part runs
                           in full every time and is the slowest, hardest part on ProPresenter. Turn playlist
                           crawling off under Search &amp; indexing if you don't need it, and reindexing drops
                           back to seconds.</span>
                         </div>`
                      : `<div class="text-sm opacity-60">
                           Changing your preferred arrangements or turning on playlist crawling changes what
                           every entry means, so those still need a full rebuild. Refrain switches to one
                           automatically when that happens, and says so.
                         </div>`
                  }
                  <details class="mt-1">
                    <summary class="text-sm cursor-pointer opacity-70 w-fit">Rebuild everything instead</summary>
                    ${fullRebuildWarning}
                    ${fullRebuildButton}
                  </details>
                </div>`;
              })()
        }
      </div>
    </div>
  `;

  const arrangementCard =
    arrangementModule.status === "off"
      ? ""
      : `
    <div class="card bg-base-200">
      <div class="card-body p-3">
        <h2 class="card-title text-base"><i data-lucide="git-compare" class="w-4 h-4 opacity-70"></i> Arrangement Module</h2>
        <div class="badge ${arrangementModule.status === "active" ? "badge-success" : "badge-warning"} gap-1">
          <i data-lucide="${arrangementModule.status === "active" ? "check-circle-2" : "alert-triangle"}" class="w-3 h-3"></i>
          ${ARRANGEMENT_STATUS_LABEL[arrangementModule.status]}
        </div>
        <div class="text-sm opacity-70">
          Provider: ${escapeHtml(arrangementModule.providerDisplayName ?? "Manual")} &middot; Storage: ${escapeHtml(arrangementModule.storageBackendDisplayName ?? "—")}
        </div>
        ${
          arrangementModule.status === "misconfigured"
            ? `<div class="text-sm mt-1">Enabled in config.json, but required credentials are missing from .env for the selected storage backend/provider. See .env.example.</div>`
            : ""
        }
        ${
          arrangementModule.pendingUploads > 0
            ? `<div class="alert alert-warning mt-2 py-2 text-sm">${arrangementModule.pendingUploads} pending upload(s) — the storage backend was unreachable on last write. Will retry automatically.</div>`
            : ""
        }
      </div>
    </div>
  `;

  const configCard = `
      <div class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between gap-2">
          <h2 class="text-base font-semibold">Settings</h2>
          <button id="backup-config-btn" class="btn btn-ghost btn-xs">
            <i data-lucide="download" class="w-3.5 h-3.5"></i> Back up config
          </button>
        </div>
        <div class="text-xs opacity-60">
          Saved straight to <code>config.json</code>. No secrets live here, and every field is validated,
          so it is safe to change. Each section saves on its own.
        </div>
        <details class="collapse collapse-arrow bg-base-200 rounded" >
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium">
              <i data-lucide="cast" class="w-4 h-4 opacity-70 shrink-0"></i> ProPresenter
              <span class="text-xs opacity-50 font-normal">host, port, role</span>
            </span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
            <div class="label py-1">
              <span class="label-text">Role ${infoIcon('"Logger" runs comparisons and writes drift-tracking data; "reader" is read-only and just displays what the logger machine recorded. Most churches only need one logger, on whichever machine runs during service.')}</span>
            </div>
            <select id="config-role" class="select select-bordered select-sm">
              <option value="reader" ${role === "reader" ? "selected" : ""}>reader</option>
              <option value="logger" ${role === "logger" ? "selected" : ""}>logger</option>
            </select>
          </label>

          <div class="flex flex-wrap gap-3">
            <label class="form-control w-full max-w-xs">
              <div class="label py-1">
                <span class="label-text">ProPresenter host ${infoIcon("The hostname or IP address of the machine running ProPresenter. \"localhost\" if Refrain runs on the same machine.")}</span>
              </div>
              <input id="config-host" type="text" class="input input-bordered input-sm" value="${escapeHtml(propresenter.host)}" />
            </label>
            <label class="form-control w-full max-w-[10rem]">
              <div class="label py-1">
                <span class="label-text">Port ${infoIcon("ProPresenter's Network API port, set in ProPresenter's own Preferences > Network pane.", "left")}</span>
              </div>
              <input id="config-port" type="number" min="1" max="65535" class="input input-bordered input-sm" value="${propresenter.port}" />
            </label>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" id="config-detect-btn" class="btn btn-outline btn-sm">Detect ProPresenter</button>
            <span id="config-detect-result" class="text-sm"></span>
          </div>
          <div class="text-xs opacity-60">Looks for ProPresenter's API <strong>on this machine only</strong> and fills in the host and port above. Save to apply.</div>

          <div id="config-network-scan-offer" class="alert alert-warning py-2 text-sm items-start hidden">
            <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
            <span>
              <strong>Searching the rest of the network is a bigger deal.</strong>
              It contacts every address on your local network looking for ProPresenter. Any
              ProPresenter it finds belongs to another machine that may be mid-service, and
              some networks treat a sweep like this as suspicious. Only do it if you know
              ProPresenter is running on a different computer.
              <button type="button" id="config-network-scan-btn" class="btn btn-warning btn-xs mt-2 block">Search the network anyway</button>
            </span>
          </div>
            <div class="flex items-center gap-2 pt-1">
              <button type="button" class="btn btn-brand btn-sm config-save" data-scope="propresenter">Save</button>
              <span class="text-sm config-save-status" data-scope="propresenter"></span>
            </div>
          </div>
        </details>
        <details class="collapse collapse-arrow bg-base-200 rounded" >
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium">
              <i data-lucide="database" class="w-4 h-4 opacity-70 shrink-0"></i> Search &amp; indexing
              <span class="text-xs opacity-50 font-normal">scope, arrangements</span>
            </span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
          <label class="label cursor-pointer justify-start gap-2 w-fit">
            <input type="checkbox" id="config-crawl-playlists" class="checkbox checkbox-sm" ${config.librarySync.crawlPlaylists ? "checked" : ""} />
            <span class="label-text">Crawl playlists (not recommended) ${infoIcon('Also scans every ProPresenter playlist to record "which playlist(s) is this in" for search results. Off by default because it\'s the slowest part of an index rebuild on large libraries.')}</span>
          </label>
          <div>
            <label class="form-control w-full max-w-xs">
              <div class="label py-1 px-0">
                <span class="label-text">Preferred arrangements ${infoIcon("A song can hold several arrangements, and the one the library happens to have selected is arbitrary. Name the ones you actually run, most important first, and search will index those. Order is the priority: \"FS, T\" means FS wins when a song has both. Leave empty to just follow whatever ProPresenter has selected. Changing this only takes effect on the next index rebuild, so save it well before a service, never during one.")}</span>
              </div>
              <input id="config-preferred-arrangements" type="text" placeholder="FS, T" class="input input-bordered input-sm"
                value="${escapeHtml((config.preferredArrangements ?? []).join(", "))}" />
            </label>
            ${
              (configOptions.arrangementNameCandidates ?? []).length
                ? `<div class="text-xs opacity-60 mt-1">
                     Found in your library (click to add):
                     <span class="inline-flex flex-wrap gap-1 ml-1">
                       ${configOptions.arrangementNameCandidates
                         .map(
                           (n) =>
                             `<button type="button" class="badge badge-ghost badge-sm config-arrangement-suggestion" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`
                         )
                         .join("")}
                     </span>
                   </div>`
                : `<div class="text-xs opacity-60 mt-1">Build the search index to see the arrangement names your library uses.</div>`
            }
            <div class="flex items-center gap-2 pt-1">
              <button type="button" class="btn btn-brand btn-sm config-save" data-scope="indexing">Save</button>
              <span class="text-sm config-save-status" data-scope="indexing"></span>
            </div>
          </div>
        </details>
        <details class="collapse collapse-arrow bg-base-200 rounded" >
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium">
              <i data-lucide="music" class="w-4 h-4 opacity-70 shrink-0"></i> Lyrics
              <span class="text-xs opacity-50 font-normal">splitter, search sites</span>
            </span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
          <label class="form-control w-full max-w-xs">
            <div class="label py-1">
              <span class="label-text">Lyrics slide splitter ${infoIcon("How pasted lyrics get divided into individual slides on the Lyrics screen. Blank-line-delimited splits on empty lines; section-label-aware also recognizes labels like [Verse] or [Chorus].")}</span>
            </div>
            <select id="config-slide-splitter" class="select select-bordered select-sm">
              ${selectOptions(configOptions.slideSplitters, config.slideSplitter)}
            </select>
          </label>

          <div>
            <div class="label py-1 px-0">
              <span class="label-text">Lyrics search domains ${infoIcon(`Which sites the Lyrics screen's "Search Lyrics" button scopes its search to. Pick up to ${configOptions.maxLyricsSites} — too many makes the scoped search less reliable.`)}</span>
            </div>
            <div class="flex flex-col gap-1 ml-1" id="config-lyrics-sites-list">
              ${configOptions.lyricsSiteCandidates
                .map(
                  (site) => `
                <label class="label cursor-pointer justify-start gap-2 w-fit">
                  <input type="checkbox" class="checkbox checkbox-sm config-lyrics-site-checkbox" value="${escapeHtml(site)}" ${config.lyricsSites.includes(site) ? "checked" : ""} />
                  <span class="label-text">${escapeHtml(site)}</span>
                </label>
              `
                )
                .join("")}
            </div>
            <div id="config-lyrics-sites-hint" class="text-xs text-warning mt-1 hidden" data-max="${configOptions.maxLyricsSites}">
              You can pick at most ${configOptions.maxLyricsSites}.
            </div>
          </div>
            <div class="flex items-center gap-2 pt-1">
              <button type="button" class="btn btn-brand btn-sm config-save" data-scope="lyrics">Save</button>
              <span class="text-sm config-save-status" data-scope="lyrics"></span>
            </div>
          </div>
        </details>
        <details class="collapse collapse-arrow bg-base-200 rounded" >
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium">
              <i data-lucide="qr-code" class="w-4 h-4 opacity-70 shrink-0"></i> QR codes
              <span class="text-xs opacity-50 font-normal">defaults</span>
            </span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
          <div class="text-sm font-semibold">QR Codes</div>
          <div class="flex flex-wrap gap-3">
            <label class="form-control w-full max-w-xs">
              <div class="label py-1">
                <span class="label-text">Default base URL ${infoIcon("Pre-fills the URL field on the QR Codes screen (and the Website field on the vCard type) so you're not retyping your church's site every time. Leave blank for no default.")}</span>
              </div>
              <input id="config-qr-base-url" type="text" class="input input-bordered input-sm" placeholder="https://yourchurch.org" value="${escapeHtml(config.qrCodeModule?.defaultBaseUrl ?? "")}" />
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label py-1">
                <span class="label-text">Default logo ${infoIcon("Pre-loads this image as the QR Codes screen's center logo, so you don't have to re-upload your church's logo every time. Accepts a local path served by Refrain (e.g. img/mylogo.png) or a full URL. Still replaceable/clearable per code.", "left")}</span>
              </div>
              <input id="config-qr-logo-url" type="text" class="input input-bordered input-sm" placeholder="img/mylogo.png" value="${escapeHtml(config.qrCodeModule?.defaultLogoUrl ?? "")}" />
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label py-1">
                <span class="label-text">Recent codes to keep ${infoIcon("How many recently-downloaded codes the QR Codes screen keeps for one-click restore. 0 turns the recent list off; max 100.", "left")}</span>
              </div>
              <input id="config-qr-recent-limit" type="number" min="0" max="100" step="1" class="input input-bordered input-sm w-28" value="${config.qrCodeModule?.recentLimit ?? 20}" />
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label py-1">
                <span class="label-text">Default QR size (px) ${infoIcon("The QR Codes screen starts at this pixel size, so a code you make drops onto your screen layout at the right size with no resizing. Leave blank for the built-in default (512). Still adjustable per code.", "left")}</span>
              </div>
              <input id="config-qr-default-size" type="number" min="64" max="2000" step="1" class="input input-bordered input-sm w-28" placeholder="512" value="${config.qrCodeModule?.defaultSize ?? ""}" />
            </label>
          </div>
            <div class="flex items-center gap-2 pt-1">
              <button type="button" class="btn btn-brand btn-sm config-save" data-scope="qr">Save</button>
              <span class="text-sm config-save-status" data-scope="qr"></span>
            </div>
          </div>
        </details>
        <details class="collapse collapse-arrow bg-base-200 rounded" >
          <summary class="collapse-title min-h-0 py-2">
            <span class="flex items-center gap-2 text-sm font-medium">
              <i data-lucide="git-compare" class="w-4 h-4 opacity-70 shrink-0"></i> Arrangement tracking
              <span class="text-xs opacity-50 font-normal">provider, storage</span>
            </span>
          </summary>
          <div class="collapse-content flex flex-col gap-3">
          <label class="label cursor-pointer justify-start gap-2 w-fit">
            <input type="checkbox" id="config-arrangement-enabled" class="checkbox checkbox-sm" ${arrangementModule.enabled ? "checked" : ""} />
            <span class="label-text">Enable arrangement drift tracking ${infoIcon("Turns on the Arrangement screen, which compares what a song's arrangement was planned to be against what ProPresenter actually played through during service.")}</span>
          </label>

          <div class="flex flex-wrap gap-3">
            <label class="form-control w-full max-w-xs">
              <div class="label py-1">
                <span class="label-text">Provider ${infoIcon('Where the "planned" arrangement comes from. "manual" means you type it in yourself on the Arrangement screen; other providers pull it from a church-management system automatically.')}</span>
              </div>
              <select id="config-arrangement-provider" class="select select-bordered select-sm">
                ${selectOptions(configOptions.providers, arrangementModule.provider ?? "manual")}
              </select>
            </label>
            <label class="form-control w-full max-w-xs">
              <div class="label py-1">
                <span class="label-text">Storage backend ${infoIcon('Where drift-tracking history is saved. "local-folder" keeps it on this machine only; the others share it between a logger and reader machines and need matching .env credentials below.', "left")}</span>
              </div>
              <select id="config-arrangement-storage" class="select select-bordered select-sm">
                ${selectOptions(configOptions.storageBackends, arrangementModule.storageBackend ?? "local-folder")}
              </select>
            </label>
          </div>

          <div id="config-planning-center-service-type-wrap" class="${arrangementModule.provider === "planning-center" ? "" : "hidden"}">
            <label class="form-control w-full max-w-xs">
              <div class="label py-1">
                <span class="label-text">Planning Center Service Type ID ${infoIcon("Which Planning Center Services service type to pull plans from (e.g. your main Sunday service). Refrain always uses that service type's most recent already-happened plan — no need to update this weekly. Paste the service type's full URL or just the trailing number (e.g. 574087) — either works.")}</span>
              </div>
              <input id="config-planning-center-service-type" type="text" class="input input-bordered input-sm" placeholder="574087 or https://services.planningcenteronline.com/service_types/574087" value="${escapeHtml(arrangementModule.planningCenterServiceTypeId ?? "")}" />
            </label>
          </div>

          <div id="config-storage-path-wrap" class="${["local-folder", "synced-folder"].includes(arrangementModule.storageBackend ?? "local-folder") ? "" : "hidden"}">
            <label class="form-control w-full max-w-md">
              <div class="label py-1">
                <span class="label-text">Folder path ${infoIcon("Where drift-tracking history gets saved on disk. Leave blank for the default (a folder inside this app). For \"synced-folder\", point this at your Google Drive/Dropbox/OneDrive folder so a reader machine sees the same files once it syncs.")}</span>
              </div>
              <div class="flex gap-2">
                <input id="config-storage-path" type="text" class="input input-bordered input-sm flex-1" placeholder="./data/arrangements" value="${escapeHtml(arrangementModule.localFolderPath ?? "")}" />
                <button type="button" id="detect-storage-path-btn" class="btn btn-outline btn-sm ${arrangementModule.storageBackend === "synced-folder" ? "" : "hidden"}">Auto-detect</button>
              </div>
              <div id="detect-storage-path-result" class="text-xs mt-1"></div>
            </label>
          </div>
        </div>

            <div class="flex items-center gap-2 pt-1">
              <button type="button" class="btn btn-brand btn-sm config-save" data-scope="arrangement">Save</button>
              <span class="text-sm config-save-status" data-scope="arrangement"></span>
            </div>
          </div>
        </details>
      </div>
  `;

  const envCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3">
        <h2 class="card-title text-base"><i data-lucide="key-round" class="w-4 h-4 opacity-70"></i> Environment Variables (.env)</h2>
        <div class="text-sm opacity-70">
          <code>.env</code> is only for secrets — API keys, credentials — that shouldn't live in
          <code>config.json</code>. It's read once at startup, so <strong>restart the server after editing it</strong>
          for changes to take effect. It's a dotfile, so Finder/Explorer often hide it by default — use the
          button below instead of hunting for it.
        </div>
        <div class="flex items-center gap-3 mt-2">
          <button id="open-env-btn" class="btn btn-sm btn-outline w-fit"><i data-lucide="file-cog" class="w-3.5 h-3.5"></i> Open .env in Editor</button>
          <span id="open-env-status" class="text-sm"></span>
        </div>
        ${
          envRequirements.length === 0
            ? `<div class="text-sm mt-2 opacity-70">Nothing you've enabled needs a .env value right now.</div>`
            : `<div class="flex flex-col gap-2 mt-2">
                ${envRequirements
                  .map(
                    (r) => `
                  <div class="flex items-start gap-2">
                    <div class="badge badge-sm ${r.set ? "badge-success" : "badge-error"} mt-0.5 shrink-0">${r.set ? "Set" : "Missing"}</div>
                    <div class="text-sm">
                      <span class="font-mono">${escapeHtml(r.name)}</span>
                      <div class="opacity-60">${escapeHtml(r.note)}</div>
                    </div>
                  </div>
                `
                  )
                  .join("")}
              </div>`
        }
      </div>
    </div>
  `;

    const latest = versionInfo?.latestVersion;
  const updatesCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3">
        <h2 class="card-title text-base"><i data-lucide="refresh-cw" class="w-4 h-4 opacity-70"></i> Updates</h2>
        <div class="text-sm opacity-70">
          Installed: <span class="font-mono">v${escapeHtml(version)}</span>
          &middot; Latest: <span class="font-mono">${latest ? "v" + escapeHtml(latest) : "couldn't check"}</span>
        </div>
        ${
          versionInfo?.updateAvailable
            ? `<div class="badge badge-info gap-1"><i data-lucide="arrow-up-circle" class="w-3 h-3"></i> Update available</div>`
            : latest
              ? `<div class="badge badge-success gap-1"><i data-lucide="check-circle-2" class="w-3 h-3"></i> Up to date</div>`
              : ""
        }
        ${
          versionInfo?.gitInstall
            ? `<div class="flex flex-wrap items-center gap-2 mt-1">
                 <button id="update-now-btn" class="btn btn-brand btn-sm">Update now</button>
                 <button id="update-recheck-btn" class="btn btn-ghost btn-sm">Check again</button>
                 <span id="update-status" class="text-sm"></span>
               </div>
               <div class="text-xs opacity-60">Or double-click <span class="font-mono">scripts/update.command</span>. Either way, restart Refrain afterward to finish.</div>`
            : `<div class="text-sm mt-1">This copy wasn't installed with Git, so download the latest ZIP from <a href="${escapeHtml(versionInfo?.repoUrl ?? "")}" target="_blank" rel="noopener" class="link">GitHub</a> and copy your <span class="font-mono">config.json</span> and <span class="font-mono">.env</span> into it. Your settings are never overwritten.</div>`
        }
      </div>
    </div>
  `;

  // Status is scanned, not read: three tiles answer "is it working" at a glance,
  // and the detail that used to fill three full cards now hangs off them.
  const statusStrip = `
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <div class="bg-base-200 rounded p-3 flex flex-col gap-1">
        <div class="text-xs uppercase tracking-wide opacity-50">ProPresenter</div>
        <div class="text-sm font-medium flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full ${propresenter.connected ? "bg-success" : "bg-error"}"></span>
          ${propresenter.connected ? "Connected" : "Not answering"}
        </div>
        <div class="text-xs opacity-60 break-all">${escapeHtml(propresenter.host ?? "")}:${propresenter.port ?? ""}</div>
      </div>
      <div class="bg-base-200 rounded p-3 flex flex-col gap-1">
        <div class="text-xs uppercase tracking-wide opacity-50">Search index</div>
        <div class="text-sm font-medium">${index.builtAt ? `${index.presentationCount} presentations` : "Not built yet"}</div>
        <div class="text-xs opacity-60">${index.builtAt ? `built ${new Date(index.builtAt).toLocaleString()}` : "search is empty until this runs"}</div>
      </div>
      <div class="bg-base-200 rounded p-3 flex flex-col gap-1">
        <div class="text-xs uppercase tracking-wide opacity-50">Version</div>
        <div class="text-sm font-medium flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full ${versionInfo?.updateAvailable ? "bg-info" : "bg-success"}"></span>
          v${version}
        </div>
        <div class="text-xs opacity-60">${
          versionInfo?.updateAvailable ? `v${escapeHtml(versionInfo.latestVersion)} available` : "up to date"
        }</div>
      </div>
    </div>
  `;

  return `
    <div class="flex flex-col gap-4">
      ${statusStrip}
      ${propresenterCard}
      ${indexCard}
      ${arrangementCard}
      ${configCard}
      ${updatesCard}
      ${envCard}
      <div class="text-xs opacity-50 text-center mt-2 flex flex-col items-center gap-1">
        <div>
          Refrain v${version} &middot; role: ${role ?? "unset"}
          ${
            versionInfo?.repoUrl
              ? ` &middot; <a href="${escapeHtml(versionInfo.repoUrl)}" target="_blank" rel="noopener" class="link inline-flex items-center gap-1"><i data-lucide="github" class="w-3 h-3"></i>GitHub</a>`
              : ""
          }
        </div>
        ${
          versionInfo?.updateAvailable
            ? `<a href="${escapeHtml(versionInfo.repoUrl)}" target="_blank" rel="noopener" class="badge badge-info badge-sm gap-1">
                <i data-lucide="arrow-up-circle" class="w-3 h-3"></i> v${escapeHtml(versionInfo.latestVersion)} available
              </a>`
            : ""
        }
      </div>
    </div>
  `;
}
