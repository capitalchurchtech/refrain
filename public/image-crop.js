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

  async function render() {
    const data = await fetch("/api/image-crop/status").then((r) => r.json());
    const cfg = data.config ?? {};
    workingPresets = (cfg.presets ?? []).map((p) => ({ ...p }));

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

          <div>
            <div class="text-sm font-semibold mb-1">Output presets</div>
            <div class="flex flex-col gap-1" id="crop-presets-list"></div>
            <button type="button" id="crop-add-preset-btn" class="btn btn-ghost btn-xs mt-2">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add preset
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button id="crop-save-btn" class="btn btn-brand btn-sm w-fit">Save</button>
          <span id="crop-save-status" class="text-sm"></span>
        </div>

        <div class="divider my-0"></div>

        <div class="flex items-center gap-2 text-sm">
          <div class="badge ${data.watching ? "badge-success" : "badge-ghost"} gap-1">
            <i data-lucide="${data.watching ? "eye" : "eye-off"}" class="w-3 h-3"></i>
            ${data.watching ? "Watching" : "Not watching"}
          </div>
          ${data.processing ? `<span class="opacity-70">Processing...</span>` : ""}
        </div>

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
        <button type="button" class="btn btn-ghost btn-xs crop-remove-preset-btn" data-index="${i}"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
      </div>
    `
      )
      .join("");

    listEl.querySelectorAll(".crop-preset-name").forEach((el) => {
      el.addEventListener("input", (e) => (workingPresets[e.target.dataset.index].name = e.target.value));
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

    if (window.lucide) window.lucide.createIcons();
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

  return { render };
}
