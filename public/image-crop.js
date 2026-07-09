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
    workingPresets = (cfg.presets ?? []).map((p) => ({ ...p }));
    catalog = data.catalog ?? [];

    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-2xl">
        <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="crop" class="w-5 h-5"></i> Image Crop</h1>
        <p class="text-sm opacity-70">
          Drop an image into the input folder and it's automatically cropped and resized to every preset below —
          smart-cropped so the important part of the image stays in frame, not just a blind center-crop.
        </p>

        <label class="label cursor-pointer justify-start gap-2 w-fit">
          <input type="checkbox" id="crop-enabled" class="checkbox checkbox-sm" ${cfg.enabled ? "checked" : ""} />
          <span class="label-text">Enable watched-folder image cropping</span>
        </label>

        <div id="crop-config-fields" class="flex flex-col gap-4 ${cfg.enabled ? "" : "opacity-50 pointer-events-none"}">
          <div class="flex flex-wrap gap-3">
            <label class="form-control flex-1 min-w-[16rem]">
              <div class="label py-1"><span class="label-text">Input folder</span></div>
              <div class="flex gap-2">
                <input id="crop-input-folder" type="text" class="input input-bordered input-sm flex-1" placeholder="./data/image-crop/input" value="${escapeHtml(cfg.inputFolder ?? "")}" />
                <button type="button" class="btn btn-outline btn-sm crop-open-folder-btn" data-which="input">Open</button>
              </div>
            </label>
            <label class="form-control flex-1 min-w-[16rem]">
              <div class="label py-1"><span class="label-text">Output folder</span></div>
              <div class="flex gap-2">
                <input id="crop-output-folder" type="text" class="input input-bordered input-sm flex-1" placeholder="./data/image-crop/output" value="${escapeHtml(cfg.outputFolder ?? "")}" />
                <button type="button" class="btn btn-outline btn-sm crop-open-folder-btn" data-which="output">Open</button>
              </div>
            </label>
          </div>

          <details class="text-sm bg-base-200 rounded p-2">
            <summary class="cursor-pointer font-medium flex items-center gap-2"><i data-lucide="mouse-pointer-click" class="w-3.5 h-3.5"></i> Make dropping images in one-drag easy</summary>
            <div class="mt-2 opacity-80 flex flex-col gap-2">
              <p>Click <strong>Open</strong> next to the input folder, then create a shortcut to it so you never have to dig for it again:</p>
              <p><strong>macOS</strong> — drag the input folder into the Finder sidebar (under Favorites) for a permanent drop target; or right-click it → <em>Make Alias</em> and move the alias to your Desktop. Drop images onto either and they're processed automatically.</p>
              <p><strong>Windows</strong> — drag the input folder into <em>Quick access</em> in File Explorer's sidebar; or right-click it → <em>Send to → Desktop (create shortcut)</em>. Drop images onto the shortcut.</p>
              <p class="opacity-70">Leave Refrain running (minimized is fine) and the moment an image lands in that folder, the cropped versions appear in the output folder — no need to open this screen.</p>
            </div>
          </details>

          <div>
            <div class="text-sm font-semibold mb-1">Output presets</div>
            <div class="text-xs opacity-60 mb-1">Every image dropped in the input folder is cropped to <em>each</em> of these. Delete any you don't need. Outputs keep the original name plus a short suffix (shown at the end of each row) — e.g. <span class="font-mono">photo_yt.jpg</span>, <span class="font-mono">photo_in_sq.jpg</span>.</div>
            <div class="flex flex-col gap-1" id="crop-presets-list"></div>
            <div class="flex flex-wrap items-center gap-2 mt-2">
              <select id="crop-catalog-select" class="select select-bordered select-xs"></select>
              <button type="button" id="crop-add-catalog-btn" class="btn btn-ghost btn-xs">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add common size
              </button>
              <span class="opacity-40 text-xs">or</span>
              <button type="button" id="crop-add-preset-btn" class="btn btn-ghost btn-xs">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add custom
              </button>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button id="crop-save-btn" class="btn btn-brand btn-sm w-fit">Save</button>
          <span id="crop-save-status" class="text-sm"></span>
        </div>

        <div class="divider my-0"></div>

        ${
          data.watching
            ? `<div class="alert alert-success py-2 text-sm">
                 <i data-lucide="check-circle-2" class="w-4 h-4 shrink-0"></i>
                 <div class="min-w-0">
                   <div class="font-medium">Ready — drop images into the input folder.${data.processing ? " Processing…" : ""}</div>
                   <div class="text-xs opacity-80 truncate">Watching <span class="font-mono">${escapeHtml(cfg.inputFolder ?? "")}</span> · output to <span class="font-mono">${escapeHtml(cfg.outputFolder ?? "")}</span> · ${(cfg.presets ?? []).length} preset${(cfg.presets ?? []).length === 1 ? "" : "s"}</div>
                 </div>
               </div>`
            : `<div class="text-sm opacity-60 flex items-center gap-2"><i data-lucide="eye-off" class="w-3.5 h-3.5"></i> Not watching — tick <strong class="font-medium">Enable</strong> above and Save to start.</div>`
        }

        <div>
          <div class="text-sm font-semibold mb-1">Recent activity</div>
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
        (p, i) => `
      <div class="flex items-center gap-2">
        <input type="text" class="input input-bordered input-xs flex-1 crop-preset-name" placeholder="Name (e.g. 16:9 1080p)" value="${escapeHtml(p.name)}" data-index="${i}" />
        <input type="number" min="1" class="input input-bordered input-xs w-20 crop-preset-width" placeholder="W" value="${p.width}" data-index="${i}" />
        <span class="opacity-50 text-xs">x</span>
        <input type="number" min="1" class="input input-bordered input-xs w-20 crop-preset-height" placeholder="H" value="${p.height}" data-index="${i}" />
        <span class="text-xs opacity-50 font-mono w-24 truncate text-right" title="Filename suffix">_${escapeHtml(presetSuffix(p))}</span>
        <button type="button" class="btn btn-ghost btn-xs crop-remove-preset-btn" data-index="${i}"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
      </div>
    `
      )
      .join("");

    listEl.querySelectorAll(".crop-preset-name").forEach((el) => {
      el.addEventListener("input", (e) => {
        const p = workingPresets[e.target.dataset.index];
        p.name = e.target.value;
        // A typed custom name has no abbr, so its suffix derives from the
        // name — keep the shown suffix in sync as they type.
        if (!p.abbr) {
          const hint = e.target.closest(".flex").querySelector(".font-mono");
          if (hint) hint.textContent = `_${presetSuffix(p)}`;
        }
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
      .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} — ${c.width}×${c.height}</option>`)
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
    if (!entries?.length) return `<div class="text-sm opacity-60">Nothing processed yet — drop an image into the input folder.</div>`;
    return entries
      .map(
        (e) => `
      <div class="text-sm bg-base-100 rounded p-2 flex items-center gap-2">
        <i data-lucide="${e.status === "ok" ? "check-circle-2" : "alert-triangle"}" class="w-3.5 h-3.5 shrink-0 ${e.status === "ok" ? "text-success" : "text-warning"}"></i>
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

  // Mirrors server/image-crop.js's websafeToken/presetSuffix so the row
  // hint matches the actual output filename the server will produce.
  function websafeToken(s) {
    return String(s ?? "")
      .toLowerCase()
      .replace(/[:.]/g, "-")
      .replace(/[^a-z0-9-]+/g, "_")
      .replace(/-{2,}/g, "-")
      .replace(/_{2,}/g, "_")
      .replace(/^[_-]+|[_-]+$/g, "");
  }
  function presetSuffix(preset) {
    return (preset.abbr && websafeToken(preset.abbr)) || websafeToken(preset.name) || "preset";
  }

  return { render };
}
