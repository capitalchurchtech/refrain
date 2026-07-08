const ARRANGEMENT_STATUS_LABEL = {
  off: null, // hidden entirely per Section 4.1
  misconfigured: "Misconfigured",
  active: "Active",
};

export function initHealth() {
  const container = document.getElementById("view-health");

  async function render() {
    const [health, libraryFolders] = await Promise.all([
      fetch("/api/health").then((r) => r.json()),
      fetch("/api/library-folders").then((r) => (r.ok ? r.json() : { folders: [], selected: null, error: true })),
    ]);
    container.innerHTML = renderHealth(health) + renderLibraryCard(libraryFolders);

    const btn = document.getElementById("health-rebuild-btn");
    if (btn) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Rebuilding...";
        try {
          await fetch("/api/index/rebuild", { method: "POST" });
          await render();
        } finally {
          if (btn.isConnected) {
            btn.disabled = false;
            btn.textContent = "Rebuild Now";
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
          await render();
        } finally {
          if (saveFoldersBtn.isConnected) {
            saveFoldersBtn.disabled = false;
            saveFoldersBtn.textContent = "Save & Rebuild";
          }
        }
      });

      const allCheckbox = document.getElementById("library-folder-all");
      const folderCheckboxes = document.querySelectorAll(".library-folder-checkbox");
      allCheckbox.addEventListener("change", () => {
        folderCheckboxes.forEach((cb) => (cb.disabled = allCheckbox.checked));
      });
    }
  }

  return { render };
}

function renderLibraryCard({ folders, selected, error }) {
  if (error) {
    return `
      <div class="card bg-base-200">
        <div class="card-body">
          <h2 class="card-title text-base">Library Sync</h2>
          <div class="text-sm opacity-70">Can't reach ProPresenter to list Library folders right now.</div>
        </div>
      </div>
    `;
  }

  const allSelected = selected === null;
  return `
    <div class="card bg-base-200">
      <div class="card-body">
        <h2 class="card-title text-base">Library Sync</h2>
        <div class="text-sm opacity-70 mb-1">Which Library folders to index and search — a smaller scope indexes much faster.</div>
        <label class="label cursor-pointer justify-start gap-2 w-fit">
          <input type="checkbox" id="library-folder-all" class="checkbox checkbox-sm" ${allSelected ? "checked" : ""} />
          <span class="label-text">All folders</span>
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
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderHealth(health) {
  const { propresenter, index, arrangementModule, role, version } = health;

  const propresenterCard = `
    <div class="card bg-base-200">
      <div class="card-body">
        <h2 class="card-title text-base">ProPresenter Connection</h2>
        ${
          propresenter.connected
            ? `<div class="badge badge-success gap-1">Connected</div>
               <div class="text-sm opacity-70">${propresenter.host}:${propresenter.port} &middot; last checked ${new Date(propresenter.lastCheckIn ?? Date.now()).toLocaleTimeString()}</div>`
            : `<div class="badge badge-error gap-1">Disconnected</div>
               <div class="text-sm opacity-70">${propresenter.host}:${propresenter.port}</div>
               <div class="text-sm mt-1">Check ProPresenter is running with its Network API enabled (Preferences &gt; Network), and that the host/port are correct.</div>`
        }
      </div>
    </div>
  `;

  const indexCard = `
    <div class="card bg-base-200">
      <div class="card-body">
        <h2 class="card-title text-base">Search Index</h2>
        <div class="text-sm opacity-70">
          ${
            index.builtAt
              ? `${index.presentationCount} presentations &middot; built ${new Date(index.builtAt).toLocaleString()}`
              : "Not built yet"
          }
        </div>
        ${
          index.rebuild.inProgress
            ? `<div class="text-sm mt-1">Rebuilding (${index.rebuild.stage}): ${index.rebuild.current}/${index.rebuild.total || "?"}</div>`
            : `<button id="health-rebuild-btn" class="btn btn-sm btn-outline mt-2 w-fit">Rebuild Now</button>`
        }
      </div>
    </div>
  `;

  const arrangementCard =
    arrangementModule.status === "off"
      ? ""
      : `
    <div class="card bg-base-200">
      <div class="card-body">
        <h2 class="card-title text-base">Arrangement Module</h2>
        <div class="badge ${arrangementModule.status === "active" ? "badge-success" : "badge-warning"} gap-1">
          ${ARRANGEMENT_STATUS_LABEL[arrangementModule.status]}
        </div>
        <div class="text-sm opacity-70">
          Provider: ${arrangementModule.provider ?? "manual"} &middot; Storage: ${arrangementModule.storageBackend ?? "—"}
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

  return `
    <div class="flex flex-col gap-4">
      ${propresenterCard}
      ${indexCard}
      ${arrangementCard}
      <div class="text-xs opacity-50 text-center mt-2">
        Refrain v${version} &middot; role: ${role ?? "unset"}
      </div>
    </div>
  `;
}
