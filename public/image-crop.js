/**
 * Image Crop screen — watched-folder smart cropping. Fully
 * self-contained (no external credentials needed), so unlike the
 * arrangement module this screen owns its own enable/configure flow
 * instead of routing the admin through Health.
 */
export function initImageCrop() {
  const container = document.getElementById("view-image-crop");
  let pollTimer = null;
  let workingPresets = [];
  let catalog = []; // known standard sizes, from the server, for the "add a common size" picker

  async function render() {
    const data = await fetch("/api/image-crop/status").then((r) => r.json());
    const cfg = data.config ?? {};
    const defaults = data.defaults ?? {};
    workingPresets = (cfg.presets ?? []).map((p) => ({ ...p }));
    catalog = data.catalog ?? [];
    // Pre-fill the folder fields with the ready-made default folders (which
    // already exist on disk to alias), while still letting the user change them.
    const inputFolderValue = cfg.inputFolder ?? defaults.inputFolder ?? "";
    const outputFolderValue = cfg.outputFolder ?? defaults.outputFolder ?? "";

    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        <h1>Image Crop</h1>

        <!-- One line. The paragraph this replaces had a sentence fragment that
             had been shipping for a while: "...every preset below.
             smart-cropped so the important part of the image stays in frame". -->
        <p class="text-sm opacity-70">
          Drop an image in the input folder and it is cropped to every preset below, smart-cropped so the
          subject stays in frame rather than blind-centred.
        </p>

        <label class="rf-check w-fit">
          <input type="checkbox" id="crop-enabled" class="checkbox checkbox-xs" ${cfg.enabled ? "checked" : ""} />
          Watch the input folder
        </label>

        <!-- E2, the hero: the folders and the presets are what the Installer
             came here to set, and Save is their commit. -->
        <div id="crop-config-fields" class="card bg-base-200 rf-hero ${cfg.enabled ? "" : "opacity-50 pointer-events-none"}">
          <div class="card-body p-3 gap-4">
            <div class="flex flex-col gap-3">
              <div class="rf-field">
                <label for="crop-input-folder">Input folder</label>
                <div class="flex gap-2">
                  <input id="crop-input-folder" type="text" class="input input-bordered flex-1" placeholder="${escapeHtml(defaults.inputFolder ?? "")}" value="${escapeHtml(inputFolderValue)}" />
                  <button type="button" class="btn btn-chip crop-open-folder-btn" data-which="input">Open</button>
                </div>
              </div>
              <div class="rf-field">
                <label for="crop-output-folder">Output folder</label>
                <div class="flex gap-2">
                  <input id="crop-output-folder" type="text" class="input input-bordered flex-1" placeholder="${escapeHtml(defaults.outputFolder ?? "")}" value="${escapeHtml(outputFolderValue)}" />
                  <button type="button" class="btn btn-chip crop-open-folder-btn" data-which="output">Open</button>
                </div>
              </div>
            </div>

          <details class="text-sm bg-base-200 rounded p-2">
            <summary class="cursor-pointer font-medium flex items-center gap-2"><i data-lucide="mouse-pointer-click" class="w-3.5 h-3.5"></i> Make dropping images in one-drag easy</summary>
            <div class="mt-2 opacity-80 flex flex-col gap-2">
              <p>Click <strong>Open</strong> next to the input folder, then create a shortcut to it so you never have to dig for it again:</p>
              <p><strong>macOS.</strong> Drag the input folder into the Finder sidebar (under Favorites) for a permanent drop target; or right-click it → <em>Make Alias</em> and move the alias to your Desktop. Drop images onto either and they're processed automatically.</p>
              <p><strong>Windows.</strong> Drag the input folder into <em>Quick access</em> in File Explorer's sidebar; or right-click it → <em>Send to → Desktop (create shortcut)</em>. Drop images onto the shortcut.</p>
              <p class="opacity-70">Leave Refrain running (minimized is fine) and the moment an image lands in that folder, the cropped versions appear in the output folder. No need to open this screen.</p>
            </div>
          </details>

          <div>
            <div class="rf-subhead">Output presets</div>
            <div class="text-xs opacity-60 mb-1">Every dropped image is cropped to all of these, named like <span class="font-mono">photo_thirds-sq.jpg</span>.</div>
            <div class="flex flex-col gap-1" id="crop-presets-list"></div>
            <div class="flex flex-wrap items-center gap-2 mt-2">
              <select id="crop-catalog-select" class="select select-bordered select-xs"></select>
              <button type="button" id="crop-add-catalog-btn" class="btn btn-chip">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add common size
              </button>
              <span class="opacity-40 text-xs">or</span>
              <button type="button" id="crop-add-preset-btn" class="btn btn-chip">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add custom
              </button>
            </div>
          </div>

            <div class="flex items-center gap-2">
              <button id="crop-save-btn" class="btn btn-brand btn-sm w-fit">Save</button>
              <span id="crop-save-status" class="text-sm"></span>
            </div>
          </div>
        </div>

        ${
          data.watching
            ? `<div class="flex items-start gap-2 text-sm">
                 <span class="rf-led lit mt-1.5"></span>
                 <div class="min-w-0">
                   <div class="font-medium">Ready. Drop images into the input folder.${data.processing ? " Processing…" : ""}</div>
                   <div class="text-xs opacity-80">${(cfg.presets ?? []).length} preset${(cfg.presets ?? []).length === 1 ? "" : "s"}, cropped into the output folder.</div>
                 </div>
               </div>`
            : `<div class="flex items-center gap-2 text-sm opacity-60">
                 <span class="rf-led"></span>
                 Not watching. Tick <strong class="font-medium">Watch the input folder</strong> above and Save to start.
               </div>`
        }

        <div>
          <div class="rf-subhead">Recent activity</div>
          <div class="flex flex-col gap-1" id="crop-activity-list">
            ${renderActivity(data.recentActivity)}
          </div>
        </div>
      </div>
    `;

    renderPresetRows();

    document.getElementById("crop-enabled").addEventListener("change", (e) => {
      document.getElementById("crop-config-fields").classList.toggle("opacity-50", !e.target.checked);
      document.getElementById("crop-config-fields").classList.toggle("pointer-events-none", !e.target.checked);
    });

    document.getElementById("crop-add-preset-btn").addEventListener("click", () => {
      workingPresets.push({ name: "", width: 1080, height: 1080 });
      renderPresetRows();
    });

    document.getElementById("crop-add-catalog-btn").addEventListener("click", () => {
      const sel = document.getElementById("crop-catalog-select");
      const preset = catalog.find((c) => c.name === sel.value);
      if (preset && !workingPresets.some((p) => p.name === preset.name)) {
        workingPresets.push({ ...preset });
        renderPresetRows();
      }
    });

    document.getElementById("crop-save-btn").addEventListener("click", saveConfig);

    container.querySelectorAll(".crop-open-folder-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const res = await fetch("/api/image-crop/open-folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ which: btn.dataset.which }),
          });
          if (!res.ok) {
            const { error } = await res.json();
            alert(error);
          }
        } finally {
          btn.disabled = false;
        }
      });
    });

    if (window.lucide) window.lucide.createIcons();

    clearInterval(pollTimer);
    pollTimer = setInterval(refreshActivity, 3000);
  }

  function renderPresetRows() {
    const listEl = document.getElementById("crop-presets-list");
    listEl.innerHTML = workingPresets
      .map(
        // Two lines per preset, not one. Six controls in a single flex row
        // needed roughly 340px before the name field even started, so at
        // docked width the height and filename boxes were pushed off the
        // right edge. Name and delete on top, dimensions and filename label
        // beneath, grouped by a rule so the pair still reads as one item.
        (p, i) => `
      <div class="rf-preset">
        <div class="flex items-center gap-2">
          <input type="text" class="input input-bordered input-xs flex-1 min-w-0 crop-preset-name" placeholder="Name (e.g. 16:9 1080p)" value="${escapeHtml(p.name)}" data-index="${i}" aria-label="Preset name" />
          <button type="button" class="btn btn-chip crop-remove-preset-btn" data-index="${i}" aria-label="Remove the ${escapeHtml(p.name || "unnamed")} preset"><i data-lucide="x" class="w-3 h-3"></i></button>
        </div>
        <div class="flex items-center gap-2">
          <input type="number" min="1" class="input input-bordered input-xs w-20 crop-preset-width" placeholder="W" value="${p.width}" data-index="${i}" aria-label="Width in pixels" />
          <span class="opacity-50 text-xs">&times;</span>
          <input type="number" min="1" class="input input-bordered input-xs w-20 crop-preset-height" placeholder="H" value="${p.height}" data-index="${i}" aria-label="Height in pixels" />
          <span class="opacity-40 text-xs font-mono ml-1">_</span>
          <input type="text" class="input input-bordered input-xs flex-1 min-w-0 font-mono crop-preset-abbr" placeholder="${escapeHtml(websafeToken(p.name))}" value="${escapeHtml(p.abbr ?? "")}" data-index="${i}" aria-label="Filename label" title="Filename label (leave blank to derive from the name)" />
        </div>
      </div>
    `
      )
      .join("");

    listEl.querySelectorAll(".crop-preset-name").forEach((el) => {
      el.addEventListener("input", (e) => {
        const p = workingPresets[e.target.dataset.index];
        p.name = e.target.value;
        // With no explicit label, the filename tag derives from the name —
        // keep the label field's placeholder in step as they type.
        if (!p.abbr) {
          const abbrInput = e.target.closest(".flex").querySelector(".crop-preset-abbr");
          if (abbrInput) abbrInput.placeholder = websafeToken(p.name);
        }
      });
    });
    listEl.querySelectorAll(".crop-preset-abbr").forEach((el) => {
      el.addEventListener("input", (e) => {
        // Blank means "derive from the name", so store it as no abbr.
        workingPresets[e.target.dataset.index].abbr = e.target.value.trim() || undefined;
      });
    });
    listEl.querySelectorAll(".crop-preset-width").forEach((el) => {
      el.addEventListener("input", (e) => (workingPresets[e.target.dataset.index].width = Number(e.target.value)));
    });
    listEl.querySelectorAll(".crop-preset-height").forEach((el) => {
      el.addEventListener("input", (e) => (workingPresets[e.target.dataset.index].height = Number(e.target.value)));
    });
    listEl.querySelectorAll(".crop-remove-preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        workingPresets.splice(Number(btn.dataset.index), 1);
        renderPresetRows();
      });
    });

    renderCatalogOptions();
    if (window.lucide) window.lucide.createIcons();
  }

  // Offer only catalog sizes not already in the list; disable the picker
  // entirely once every known size has been added.
  function renderCatalogOptions() {
    const sel = document.getElementById("crop-catalog-select");
    const addBtn = document.getElementById("crop-add-catalog-btn");
    if (!sel) return;
    const available = catalog.filter((c) => !workingPresets.some((p) => p.name === c.name));
    if (available.length === 0) {
      sel.innerHTML = `<option>All common sizes added</option>`;
      sel.disabled = true;
      if (addBtn) addBtn.disabled = true;
      return;
    }
    sel.disabled = false;
    if (addBtn) addBtn.disabled = false;
    sel.innerHTML = available
      .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${c.width}×${c.height})</option>`)
      .join("");
  }

  async function saveConfig() {
    const statusEl = document.getElementById("crop-save-status");
    const saveBtn = document.getElementById("crop-save-btn");
    saveBtn.disabled = true;
    statusEl.textContent = "Saving...";
    try {
      const res = await fetch("/api/image-crop/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: document.getElementById("crop-enabled").checked,
          inputFolder: document.getElementById("crop-input-folder").value,
          outputFolder: document.getElementById("crop-output-folder").value,
          presets: workingPresets.filter((p) => p.name.trim() && p.width > 0 && p.height > 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        statusEl.textContent = `Error: ${data.error}`;
        return;
      }
      statusEl.textContent = "Saved.";
      await render();
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function refreshActivity() {
    const activityEl = document.getElementById("crop-activity-list");
    if (!activityEl) {
      clearInterval(pollTimer);
      return;
    }
    const data = await fetch("/api/image-crop/status").then((r) => r.json());
    activityEl.innerHTML = renderActivity(data.recentActivity);
    if (window.lucide) window.lucide.createIcons();
  }

  function renderActivity(entries) {
    if (!entries?.length) return `<div class="text-sm opacity-60">Nothing processed yet. Drop an image into the input folder.</div>`;
    return entries
      .map(
        (e) => `
      <div class="text-sm bg-base-100 rounded p-2 flex items-center gap-2">
        <i data-lucide="${e.status === "ok" ? "check" : "alert-triangle"}" class="w-3.5 h-3.5 shrink-0 ${e.status === "ok" ? "rf-nominal" : "rf-flag"}"></i>
        <span class="flex-1 min-w-0 truncate">${escapeHtml(e.filename ?? "(watcher)")}</span>
        <span class="opacity-60 text-xs">${e.status === "ok" ? e.outputs.join(", ") : escapeHtml(e.error)}</span>
      </div>
    `
      )
      .join("");
  }

  // String-based (not DOM textContent->innerHTML) so quote characters
  // are escaped too — needed since this is interpolated into attribute
  // values (value="...") where an unescaped `"` would corrupt the tag.
  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Mirrors server/image-crop.js's websafeToken so the label field's
  // placeholder matches the tag the server would derive from the name.
  function websafeToken(s) {
    return String(s ?? "")
      .toLowerCase()
      .replace(/[:.]/g, "-")
      .replace(/[^a-z0-9-]+/g, "_")
      .replace(/-{2,}/g, "-")
      .replace(/_{2,}/g, "_")
      .replace(/^[_-]+|[_-]+$/g, "");
  }

  return { render };
}
