/**
 * QR Codes screen — fully local generation. The frontend builds the
 * final encoded string per content type (URL, WiFi, vCard, ...) and
 * asks the server to render it; nothing goes to any third party.
 */
export function initQrCode() {
  const container = document.getElementById("view-qr-code");

  const TYPES = [
    { id: "url", label: "Website / URL" },
    { id: "text", label: "Plain text" },
    { id: "wifi", label: "WiFi network" },
    { id: "vcard", label: "Contact card (vCard)" },
    { id: "email", label: "Email" },
    { id: "phone", label: "Phone number" },
    { id: "sms", label: "SMS" },
  ];

  let state = {
    type: "url",
    fields: {},
    size: 512,
    margin: 2,
    ecLevel: "M",
    dark: "#000000",
    light: "#ffffff",
    logoDataUrl: null,
    format: "png", // preview is always png; svg is a download option
  };
  let lastPngDataUrl = null;
  let debounceTimer = null;

  function render() {
    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="qr-code" class="w-5 h-5"></i> QR Codes</h1>
        <p class="text-sm opacity-70">
          Generated entirely on this machine — the code encodes your content directly, with no third-party link shortener or
          tracker in the middle that could expire it or start charging later.
        </p>

        <div class="flex flex-col lg:flex-row gap-4">
          <div class="flex flex-col gap-3 flex-1 min-w-0">
            <label class="form-control">
              <div class="label py-1"><span class="label-text">Type</span></div>
              <select id="qr-type" class="select select-bordered select-sm">
                ${TYPES.map((t) => `<option value="${t.id}" ${state.type === t.id ? "selected" : ""}>${t.label}</option>`).join("")}
              </select>
            </label>

            <div id="qr-fields" class="flex flex-col gap-2"></div>

            <details class="text-sm bg-base-200 rounded p-2">
              <summary class="cursor-pointer font-medium flex items-center gap-2"><i data-lucide="sliders-horizontal" class="w-3.5 h-3.5"></i> Appearance</summary>
              <div class="mt-2 flex flex-col gap-2">
                <div class="flex flex-wrap gap-3">
                  <label class="form-control">
                    <div class="label py-1"><span class="label-text text-xs">Size (px)</span></div>
                    <input type="number" id="qr-size" min="64" max="2000" step="1" class="input input-bordered input-xs w-24" value="${state.size}" />
                  </label>
                  <label class="form-control">
                    <div class="label py-1"><span class="label-text text-xs">Quiet zone</span></div>
                    <input type="number" id="qr-margin" min="0" max="20" step="1" class="input input-bordered input-xs w-20" value="${state.margin}" />
                  </label>
                  <label class="form-control">
                    <div class="label py-1"><span class="label-text text-xs">Error correction ${infoIcon("Higher levels stay scannable when the code is dirty, printed small, or has a logo. H is highest.")}</span></div>
                    <select id="qr-ec" class="select select-bordered select-xs w-20">
                      ${["L", "M", "Q", "H"].map((l) => `<option ${state.ecLevel === l ? "selected" : ""}>${l}</option>`).join("")}
                    </select>
                  </label>
                </div>
                <div class="flex flex-wrap gap-3 items-center">
                  <label class="flex items-center gap-2 text-xs">Foreground <input type="color" id="qr-dark" value="${state.dark}" class="w-8 h-6 rounded" /></label>
                  <label class="flex items-center gap-2 text-xs">Background <input type="color" id="qr-light" value="${state.light}" class="w-8 h-6 rounded" /></label>
                </div>
                <label class="form-control">
                  <div class="label py-1"><span class="label-text text-xs">Center logo (PNG output only) ${infoIcon("Adds your logo to the middle. Error correction is bumped to H automatically so it still scans.")}</span></div>
                  <div class="flex items-center gap-2">
                    <input type="file" id="qr-logo" accept="image/*" class="file-input file-input-bordered file-input-xs flex-1" />
                    <button type="button" id="qr-logo-clear" class="btn btn-ghost btn-xs ${state.logoDataUrl ? "" : "hidden"}">Clear</button>
                  </div>
                </label>
              </div>
            </details>
          </div>

          <div class="flex flex-col items-center gap-3 w-full lg:w-72 shrink-0">
            <div class="bg-base-200 rounded p-3 w-full flex items-center justify-center min-h-[16rem]">
              <img id="qr-preview" alt="QR preview" class="max-w-full h-auto hidden" />
              <div id="qr-preview-empty" class="text-sm opacity-50 text-center">Fill in the fields to see your code.</div>
            </div>
            <div id="qr-error" class="text-sm text-warning text-center hidden"></div>
            <div class="flex gap-2 w-full">
              <button id="qr-download-png" class="btn btn-brand btn-sm flex-1" disabled><i data-lucide="download" class="w-4 h-4"></i> PNG</button>
              <button id="qr-download-svg" class="btn btn-outline btn-sm flex-1" disabled><i data-lucide="download" class="w-4 h-4"></i> SVG</button>
            </div>
            <div class="text-xs opacity-50 text-center">SVG is best for print (scales with no blur). Logos apply to PNG only.</div>
          </div>
        </div>
      </div>
    `;

    document.getElementById("qr-type").addEventListener("change", (e) => {
      state.type = e.target.value;
      state.fields = {};
      renderFields();
      schedulePreview();
    });

    const bind = (id, key, transform = (v) => v) =>
      document.getElementById(id).addEventListener("input", (e) => {
        state[key] = transform(e.target.value);
        schedulePreview();
      });
    bind("qr-size", "size", (v) => Number(v));
    bind("qr-margin", "margin", (v) => Number(v));
    bind("qr-ec", "ecLevel");
    bind("qr-dark", "dark");
    bind("qr-light", "light");

    document.getElementById("qr-logo").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      state.logoDataUrl = await fileToDataUrl(file);
      document.getElementById("qr-logo-clear").classList.remove("hidden");
      schedulePreview();
    });
    document.getElementById("qr-logo-clear").addEventListener("click", () => {
      state.logoDataUrl = null;
      document.getElementById("qr-logo").value = "";
      document.getElementById("qr-logo-clear").classList.add("hidden");
      schedulePreview();
    });

    document.getElementById("qr-download-png").addEventListener("click", () => downloadCurrent("png"));
    document.getElementById("qr-download-svg").addEventListener("click", () => downloadCurrent("svg"));

    renderFields();
    if (window.lucide) window.lucide.createIcons();
  }

  const FIELDS = {
    url: [{ key: "url", label: "URL", placeholder: "https://yourchurch.org", type: "url" }],
    text: [{ key: "text", label: "Text", placeholder: "Anything you like", type: "textarea" }],
    wifi: [
      { key: "ssid", label: "Network name (SSID)", placeholder: "Guest WiFi" },
      { key: "password", label: "Password", placeholder: "" },
      { key: "encryption", label: "Security", type: "select", options: [["WPA", "WPA/WPA2"], ["WEP", "WEP"], ["nopass", "None (open)"]] },
    ],
    vcard: [
      { key: "firstName", label: "First name", placeholder: "Jane" },
      { key: "lastName", label: "Last name", placeholder: "Doe" },
      { key: "org", label: "Organization", placeholder: "Your Church" },
      { key: "phone", label: "Phone", placeholder: "+15551234567" },
      { key: "email", label: "Email", placeholder: "jane@yourchurch.org" },
      { key: "url", label: "Website", placeholder: "https://yourchurch.org" },
    ],
    email: [
      { key: "to", label: "To", placeholder: "info@yourchurch.org" },
      { key: "subject", label: "Subject", placeholder: "" },
      { key: "body", label: "Body", type: "textarea", placeholder: "" },
    ],
    phone: [{ key: "number", label: "Phone number", placeholder: "+15551234567" }],
    sms: [
      { key: "number", label: "Phone number", placeholder: "+15551234567" },
      { key: "message", label: "Message", type: "textarea", placeholder: "" },
    ],
  };

  function renderFields() {
    const el = document.getElementById("qr-fields");
    const defs = FIELDS[state.type] ?? [];
    el.innerHTML = defs
      .map((f) => {
        const val = escapeHtml(state.fields[f.key] ?? "");
        if (f.type === "textarea") {
          return `<label class="form-control"><div class="label py-1"><span class="label-text text-sm">${f.label}</span></div>
            <textarea data-key="${f.key}" rows="2" class="textarea textarea-bordered textarea-sm qr-field" placeholder="${escapeHtml(f.placeholder ?? "")}">${val}</textarea></label>`;
        }
        if (f.type === "select") {
          return `<label class="form-control"><div class="label py-1"><span class="label-text text-sm">${f.label}</span></div>
            <select data-key="${f.key}" class="select select-bordered select-sm qr-field">
              ${f.options.map(([v, lbl]) => `<option value="${v}" ${state.fields[f.key] === v ? "selected" : ""}>${lbl}</option>`).join("")}
            </select></label>`;
        }
        return `<label class="form-control"><div class="label py-1"><span class="label-text text-sm">${f.label}</span></div>
          <input type="${f.type ?? "text"}" data-key="${f.key}" class="input input-bordered input-sm qr-field" placeholder="${escapeHtml(f.placeholder ?? "")}" value="${val}" /></label>`;
      })
      .join("");

    // Seed defaults (e.g. the WiFi encryption select's initial value).
    defs.forEach((f) => {
      if (f.type === "select" && state.fields[f.key] === undefined) state.fields[f.key] = f.options[0][0];
    });

    el.querySelectorAll(".qr-field").forEach((input) => {
      input.addEventListener("input", (e) => {
        state.fields[e.target.dataset.key] = e.target.value;
        schedulePreview();
      });
    });
    schedulePreview();
  }

  // --- Encoding: build the raw string that goes into the QR ---
  function buildContent() {
    const f = state.fields;
    switch (state.type) {
      case "url":
        return (f.url ?? "").trim();
      case "text":
        return f.text ?? "";
      case "wifi": {
        if (!f.ssid) return "";
        const enc = f.encryption ?? "WPA";
        if (enc === "nopass") return `WIFI:T:nopass;S:${escapeWifi(f.ssid)};;`;
        return `WIFI:T:${enc};S:${escapeWifi(f.ssid)};P:${escapeWifi(f.password ?? "")};;`;
      }
      case "vcard": {
        if (!f.firstName && !f.lastName && !f.org) return "";
        const lines = [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `N:${f.lastName ?? ""};${f.firstName ?? ""}`,
          `FN:${[f.firstName, f.lastName].filter(Boolean).join(" ")}`,
        ];
        if (f.org) lines.push(`ORG:${f.org}`);
        if (f.phone) lines.push(`TEL;TYPE=CELL:${f.phone}`);
        if (f.email) lines.push(`EMAIL:${f.email}`);
        if (f.url) lines.push(`URL:${f.url}`);
        lines.push("END:VCARD");
        return lines.join("\n");
      }
      case "email": {
        if (!f.to) return "";
        const params = [];
        if (f.subject) params.push(`subject=${encodeURIComponent(f.subject)}`);
        if (f.body) params.push(`body=${encodeURIComponent(f.body)}`);
        return `mailto:${f.to}${params.length ? "?" + params.join("&") : ""}`;
      }
      case "phone":
        return f.number ? `tel:${f.number}` : "";
      case "sms":
        return f.number ? `smsto:${f.number}:${f.message ?? ""}` : "";
      default:
        return "";
    }
  }

  function escapeWifi(s) {
    return String(s).replace(/([\\;,:"])/g, "\\$1");
  }

  function schedulePreview() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updatePreview, 250);
  }

  async function updatePreview() {
    const content = buildContent();
    const img = document.getElementById("qr-preview");
    const empty = document.getElementById("qr-preview-empty");
    const errEl = document.getElementById("qr-error");
    const pngBtn = document.getElementById("qr-download-png");
    const svgBtn = document.getElementById("qr-download-svg");
    if (!img) return; // navigated away

    if (!content.trim()) {
      img.classList.add("hidden");
      empty.classList.remove("hidden");
      errEl.classList.add("hidden");
      pngBtn.disabled = true;
      svgBtn.disabled = true;
      lastPngDataUrl = null;
      return;
    }

    try {
      const data = await postGenerate({ ...currentOptions(), content, format: "png" });
      lastPngDataUrl = data.dataUrl;
      img.src = data.dataUrl;
      img.classList.remove("hidden");
      empty.classList.add("hidden");
      errEl.classList.add("hidden");
      pngBtn.disabled = false;
      // SVG can't carry a raster logo, so only offer it when no logo is set.
      svgBtn.disabled = Boolean(state.logoDataUrl);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
      pngBtn.disabled = true;
      svgBtn.disabled = true;
    }
  }

  function currentOptions() {
    return {
      size: state.size,
      margin: state.margin,
      ecLevel: state.ecLevel,
      dark: state.dark,
      light: state.light,
      logoDataUrl: state.logoDataUrl,
    };
  }

  async function postGenerate(body) {
    const res = await fetch("/api/qr/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to generate QR code.");
    return data;
  }

  async function downloadCurrent(format) {
    const content = buildContent();
    if (!content.trim()) return;
    try {
      if (format === "png") {
        const dataUrl = lastPngDataUrl ?? (await postGenerate({ ...currentOptions(), content, format: "png" })).dataUrl;
        triggerDownload(dataUrl, `qr-${state.type}.png`);
      } else {
        const { svg } = await postGenerate({ ...currentOptions(), content, format: "svg", logoDataUrl: null });
        triggerDownload(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, `qr-${state.type}.svg`);
      }
    } catch (err) {
      const errEl = document.getElementById("qr-error");
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    }
  }

  function triggerDownload(href, filename) {
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function infoIcon(tip) {
    return `<span class="tooltip tooltip-info-wide" data-tip="${escapeHtml(tip)}"><i data-lucide="info" class="w-3.5 h-3.5 opacity-50 cursor-help align-text-top"></i></span>`;
  }

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
