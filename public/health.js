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

    const [health, libraryFolders, configOptions, versionInfo, moduleList] = await Promise.all([
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/library-folders").then((r) => (r.ok ? r.json() : { folders: [], selected: null, error: true })),
      fetch("/api/config-options").then((r) => r.json()),
      fetchVersionCheck(),
      fetch("/api/modules").then((r) => r.json()).catch(() => ({ modules: [] })),
    ]);
    const trackArrangement = health.arrangementModule.status !== "off";
    const arrangementFolders = trackArrangement
      ? await fetch("/api/arrangement/folders").then((r) => (r.ok ? r.json() : { folders: [], selected: null, error: true }))
      : null;
    container.innerHTML =
      renderHealth(health, configOptions, versionInfo, moduleList.modules ?? []) + renderLibraryCard(libraryFolders, arrangementFolders);

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

    const configDetectBtn = document.getElementById("config-detect-btn");
    if (configDetectBtn) {
      const detectResult = document.getElementById("config-detect-result");
      configDetectBtn.addEventListener("click", async () => {
        configDetectBtn.disabled = true;
        detectResult.textContent = "Scanning...";
        detectResult.className = "text-sm opacity-70";
        try {
          const res = await fetch("/api/setup/scan", { method: "POST" });
          const data = await res.json();
          const found = data.candidates?.[0];
          if (found) {
            document.getElementById("config-host").value = found.host;
            document.getElementById("config-port").value = found.port;
            const extra = data.candidates.length > 1 ? ` (+${data.candidates.length - 1} more)` : "";
            detectResult.textContent = `Found ${found.name} at ${found.host}:${found.port}${extra} — Save to apply.`;
            detectResult.className = "text-sm text-success";
          } else {
            detectResult.textContent = "No ProPresenter found. Make sure its Network API is on, or type the host and port above.";
            detectResult.className = "text-sm text-warning";
          }
        } catch (err) {
          detectResult.textContent = `Scan failed: ${err.message}`;
          detectResult.className = "text-sm text-error";
        } finally {
          configDetectBtn.disabled = false;
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
            btnLabel.textContent = "Rebuild Now";
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

    const saveConfigBtn = document.getElementById("save-config-btn");
    if (saveConfigBtn) {
      saveConfigBtn.addEventListener("click", async () => {
        const body = {
          role: document.getElementById("config-role").value,
          propresenterHost: document.getElementById("config-host").value,
          propresenterPort: document.getElementById("config-port").value,
          crawlPlaylists: document.getElementById("config-crawl-playlists").checked,
          slideSplitter: document.getElementById("config-slide-splitter").value,
          lyricsSites: Array.from(document.querySelectorAll(".config-lyrics-site-checkbox:checked")).map((el) => el.value),
          qrDefaultBaseUrl: document.getElementById("config-qr-base-url").value,
          qrDefaultLogoUrl: document.getElementById("config-qr-logo-url").value,
          qrRecentLimit: Number(document.getElementById("config-qr-recent-limit").value),
          qrDefaultSize: document.getElementById("config-qr-default-size").value,
          arrangementEnabled: document.getElementById("config-arrangement-enabled").checked,
          arrangementProvider: document.getElementById("config-arrangement-provider").value,
          arrangementStorageBackend: document.getElementById("config-arrangement-storage").value,
          arrangementLocalFolderPath: document.getElementById("config-storage-path").value,
          planningCenterServiceTypeId: document.getElementById("config-planning-center-service-type").value,
        };

        const statusEl = document.getElementById("config-save-status");
        saveConfigBtn.disabled = true;
        saveConfigBtn.textContent = "Saving...";
        statusEl.textContent = "";
        let saved = false;
        try {
          const res = await fetch("/api/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await res.json();
          if (!res.ok) {
            statusEl.textContent = data.error;
            statusEl.className = "text-sm text-error";
            return;
          }
          saved = true;
        } finally {
          if (saveConfigBtn.isConnected) {
            saveConfigBtn.disabled = false;
            saveConfigBtn.textContent = "Save Configuration";
          }
        }
        // Not awaited — see save-library-folders-btn's handler for why.
        if (saved) render();
      });
    }

    document.querySelectorAll(".config-module-toggle").forEach((cb) => {
      cb.addEventListener("change", async () => {
        const id = cb.dataset.id;
        const supported = cb.dataset.supported === "true";
        cb.disabled = true;
        try {
          await fetch(`/api/modules/${id}/enabled`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: cb.checked }),
          });
        } catch {
          // Non-fatal — the reload/re-render below reflects the real state.
        }
        // On a supported platform this adds/removes the module's sidebar
        // entry and screen, so reload to reflect it cleanly. On an
        // unsupported platform enabling is inert — just re-render to keep
        // the "not supported" note visible.
        if (supported) location.reload();
        else render();
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
        <button id="save-library-folders-btn" class="btn btn-sm btn-outline mt-2 w-fit">Save &amp; Rebuild</button>

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

// Enable toggles for opt-in modules that expose a `configToggle` (see
// each module's module.js). Generic — this never names a specific module.
// An experimental module reports platformSupported:false where it can't
// run (e.g. Whisper-on-MLX off Apple Silicon); there the toggle still
// shows but is annotated as unsupported, since enabling it does nothing.
function renderExperimentalModules(modules) {
  const items = (modules ?? []).filter((m) => m.configToggle);
  if (!items.length) return "";
  return `
    <div class="divider my-0"></div>
    <div class="text-sm font-semibold">Experimental modules</div>
    <div class="text-xs opacity-60">Opt-in features that aren't part of the core app, off by default. Turning one on adds it to the sidebar.</div>
    ${items
      .map(
        (m) => `
      <label class="label cursor-pointer justify-start gap-2 w-fit">
        <input type="checkbox" class="checkbox checkbox-sm config-module-toggle" data-id="${escapeHtml(m.id)}" data-supported="${m.platformSupported ? "true" : "false"}" ${m.enabled ? "checked" : ""} />
        <span class="label-text">${escapeHtml(m.configToggle.label)} ${infoIcon(m.configToggle.help)}</span>
      </label>
      ${
        !m.platformSupported && m.platformMessage
          ? `<div class="text-xs text-warning ml-6 -mt-1">${escapeHtml(m.platformMessage)}</div>`
          : ""
      }
    `
      )
      .join("")}
  `;
}

function renderHealth(health, configOptions, versionInfo, modules = []) {
  const { propresenter, index, arrangementModule, role, version, config, envRequirements } = health;

  const propresenterCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3">
        <h2 class="card-title text-base"><i data-lucide="cast" class="w-4 h-4 opacity-70"></i> ProPresenter Connection</h2>
        ${
          propresenter.connected
            ? `<div class="badge badge-success gap-1"><i data-lucide="check-circle-2" class="w-3 h-3"></i> Connected</div>
               <div class="text-sm opacity-70">${propresenter.host}:${propresenter.port} &middot; last checked ${new Date(propresenter.lastCheckIn ?? Date.now()).toLocaleTimeString()}</div>`
            : `<div class="badge badge-error gap-1"><i data-lucide="x-circle" class="w-3 h-3"></i> Disconnected</div>
               <div class="text-sm opacity-70">${propresenter.host}:${propresenter.port}</div>
               <div class="text-sm mt-1">Check ProPresenter is running with its Network API enabled (Preferences &gt; Network), and that the host/port are correct.</div>`
        }
      </div>
    </div>
  `;

  const indexCard = `
    <div class="card bg-base-200">
      <div class="card-body p-3">
        <h2 class="card-title text-base"><i data-lucide="database" class="w-4 h-4 opacity-70"></i> Search Index</h2>
        <div class="text-sm opacity-70">
          ${
            index.builtAt
              ? `${index.presentationCount} presentations &middot; built ${new Date(index.builtAt).toLocaleString()}`
              : "Not built yet"
          }
        </div>
        ${
          index.builtAt
            ? `<div class="text-sm opacity-70">
                ${
                  index.buildDurationMs == null
                    ? "Duration unknown — built before this was tracked; rebuild once to see it."
                    : `Last run took ${formatDuration(index.buildDurationMs)}${
                        index.crawledPlaylists ? " (included a playlist crawl)" : " (playlist crawl was off)"
                      }`
                } ${infoIcon("How long the last index rebuild took, so you know whether it's safe to kick off another one — e.g. right before a service — without the risk of it still running when you need ProPresenter free.")}
              </div>`
            : ""
        }
        ${
          index.rebuild.inProgress
            ? `<div class="text-sm mt-1">Rebuilding (${index.rebuild.stage}): ${index.rebuild.current}/${index.rebuild.total || "?"}</div>`
            : `<div class="flex items-center gap-2 mt-2">
                <button id="health-rebuild-btn" class="btn btn-sm btn-outline w-fit"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> <span id="health-rebuild-btn-label">Rebuild Now</span></button>
                ${infoIcon("Expect this to take 10 minutes or more on a real library — ProPresenter may become slow or unresponsive while it's crawling. That's normal; just leave it running and avoid closing ProPresenter until it finishes.")}
              </div>`
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
    <div class="card bg-base-200">
      <div class="card-body p-3">
        <h2 class="card-title text-base"><i data-lucide="sliders-horizontal" class="w-4 h-4 opacity-70"></i> Configuration</h2>
        <div class="text-sm opacity-70">
          Everything below is saved straight to <code>config.json</code> — no secrets live here, so it's safe to
          change freely. Each field is a dropdown, checkbox, or validated input so you can't save something
          that would break the app; hover the <i data-lucide="info" class="w-3.5 h-3.5 inline align-text-top"></i>
          next to a setting for what it does.
        </div>

        <div class="flex flex-col gap-3 mt-3">
          <label class="form-control w-full max-w-xs">
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
          <div class="text-xs opacity-60">Scans the network for ProPresenter's API and fills in the host and port above. Save to apply.</div>

          <label class="label cursor-pointer justify-start gap-2 w-fit">
            <input type="checkbox" id="config-crawl-playlists" class="checkbox checkbox-sm" ${config.librarySync.crawlPlaylists ? "checked" : ""} />
            <span class="label-text">Crawl playlists (not recommended) ${infoIcon('Also scans every ProPresenter playlist to record "which playlist(s) is this in" for search results. Off by default because it\'s the slowest part of an index rebuild on large libraries.')}</span>
          </label>

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

          <div class="divider my-0"></div>

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

          <div class="divider my-0"></div>

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

          ${renderExperimentalModules(modules)}
        </div>

        <div class="flex items-center gap-3 mt-3">
          <button id="backup-config-btn" class="btn btn-sm btn-outline w-fit">
            <i data-lucide="download" class="w-4 h-4"></i> Backup Config
          </button>
          <button id="save-config-btn" class="btn btn-sm btn-brand w-fit">Save Configuration</button>
          <span id="config-save-status" class="text-sm"></span>
        </div>
      </div>
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

  return `
    <div class="flex flex-col gap-4">
      ${propresenterCard}
      ${updatesCard}
      ${indexCard}
      ${arrangementCard}
      ${configCard}
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
