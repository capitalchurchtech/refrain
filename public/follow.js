/**
 * Follow screen (Phase 1) — the transcription harness.
 *
 * Goal of this phase: prove on-device Whisper produces usable text from a
 * sung, band-backed vocal feed before building song matching / slide
 * following. So it's a harness — pick an input, Start, and watch two
 * columns side by side:
 *   • the live transcript (from Whisper), and
 *   • what ProPresenter currently has live (from /api/live-state).
 * Reading them together is how you judge whether the transcription is
 * actually tracking the song. It advances no slides yet.
 */
export function initFollow() {
  const container = document.getElementById("view-follow");
  let stream = null; // EventSource
  let liveTimer = null;
  let statusData = null;

  async function render() {
    statusData = await fetch("/api/follow/status")
      .then((r) => r.json())
      .catch(() => ({ status: "off", error: "Couldn't reach the Follow backend." }));

    const s = statusData ?? {};
    const settings = s.settings ?? {};
    const deps = s.deps ?? {};
    const models = s.models ?? ["small"];
    const running = Boolean(s.runtime?.running);

    // Non-Apple-Silicon (or otherwise unrunnable): explain and stop here.
    if (s.status === "misconfigured" || s.supported === false) {
      container.innerHTML = `
        <div class="flex flex-col gap-4 max-w-2xl">
          ${header()}
          <div class="alert alert-warning py-2 text-sm">${esc(s.platformMessage ?? "Follow can't run on this machine.")}</div>
        </div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        ${header()}
        <p class="text-sm opacity-70">
          Listens to a live vocal feed and transcribes it on-device with Whisper (Apple&nbsp;Silicon / MLX).
          This is the Phase&nbsp;1 harness: watch the transcript against what ProPresenter has live to judge
          whether the text is good enough to drive slide-following later. It does <strong>not</strong> advance slides yet.
        </p>

        ${depsBanner(deps)}

        <div class="flex flex-col gap-3 ${deps.ready ? "" : "opacity-60"}">
          <div class="flex flex-wrap items-end gap-3">
            <label class="form-control">
              <div class="label py-1"><span class="label-text">Source</span></div>
              <select id="follow-mode" class="select select-bordered select-sm">
                <option value="live" ${settings.mode !== "wav" ? "selected" : ""}>Live input device</option>
                <option value="wav" ${settings.mode === "wav" ? "selected" : ""}>Recorded WAV file (offline)</option>
              </select>
            </label>
            <label class="form-control">
              <div class="label py-1"><span class="label-text">Model</span></div>
              <select id="follow-model" class="select select-bordered select-sm">
                ${models.map((m) => `<option value="${esc(m)}" ${settings.model === m ? "selected" : ""}>${esc(m)}</option>`).join("")}
              </select>
            </label>
          </div>

          <div id="follow-live-fields" class="${settings.mode === "wav" ? "hidden" : ""} flex flex-wrap items-end gap-3">
            <label class="form-control flex-1 min-w-[16rem]">
              <div class="label py-1"><span class="label-text">Input device</span></div>
              <div class="flex gap-2">
                <select id="follow-device" class="select select-bordered select-sm flex-1"><option value="">Loading devices…</option></select>
                <button type="button" id="follow-refresh-devices" class="btn btn-outline btn-sm" title="Rescan devices"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i></button>
              </div>
            </label>
            <label class="form-control w-40">
              <div class="label py-1"><span class="label-text">Channel</span></div>
              <input id="follow-channel" type="number" min="0" class="input input-bordered input-sm" placeholder="mono mix" value="${settings.channel ?? ""}" />
            </label>
          </div>

          <div id="follow-wav-fields" class="${settings.mode === "wav" ? "" : "hidden"}">
            <label class="form-control">
              <div class="label py-1"><span class="label-text">WAV file path</span></div>
              <input id="follow-wav-path" type="text" class="input input-bordered input-sm w-full" placeholder="/path/to/recorded-service.wav" value="${esc(settings.wavPath ?? "")}" />
            </label>
            <div class="text-xs opacity-60 mt-1">Replays a recorded service at real time so you can iterate without being at church. Channel selection above still applies.</div>
          </div>

          <div class="flex items-center gap-3">
            <button id="follow-start" class="btn btn-brand btn-sm ${running ? "hidden" : ""}" ${deps.ready ? "" : "disabled"}><i data-lucide="play" class="w-4 h-4"></i> Start</button>
            <button id="follow-stop" class="btn btn-error btn-sm ${running ? "" : "hidden"}"><i data-lucide="square" class="w-4 h-4"></i> Stop</button>
            <span id="follow-run-status" class="text-sm opacity-70">${running ? "Listening…" : "Stopped"}</span>
          </div>

          <div>
            <div class="flex items-center justify-between">
              <span class="text-xs opacity-60">Input level</span>
              <span class="text-xs opacity-40">confirms audio is arriving</span>
            </div>
            <div class="w-full h-3 bg-base-300 rounded overflow-hidden">
              <div id="follow-level" class="h-full bg-success transition-[width] duration-100" style="width:0%"></div>
            </div>
          </div>

          <div class="flex flex-col md:flex-row gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between">
                <span class="text-sm font-semibold">Live transcript <span class="opacity-50 font-normal">(Whisper)</span></span>
                <a id="follow-export" href="/api/follow/session" class="btn btn-ghost btn-xs"><i data-lucide="download" class="w-3.5 h-3.5"></i> Export</a>
              </div>
              <div id="follow-transcript" class="bg-base-200 rounded p-2 h-72 overflow-y-auto font-mono text-sm flex flex-col gap-1">
                <div class="opacity-50" id="follow-transcript-empty">Nothing yet — start capture to see the transcript here.</div>
              </div>
            </div>
            <div class="md:w-72 shrink-0">
              <span class="text-sm font-semibold">Live in ProPresenter</span>
              <div id="follow-livestate" class="bg-base-200 rounded p-2 h-72 overflow-y-auto text-sm">
                <div class="opacity-50">Checking…</div>
              </div>
            </div>
          </div>
          <div id="follow-error" class="alert alert-warning py-2 text-sm hidden"></div>
        </div>
      </div>
    `;

    wire();
    if (window.lucide) window.lucide.createIcons();
    if (settings.mode !== "wav" && deps.ffmpeg) loadDevices();
    ensureStream();
    startLivePoll();
  }

  function header() {
    return `<h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="radio" class="w-5 h-5"></i> Follow <span class="badge badge-warning badge-sm">Experimental</span></h1>`;
  }

  function wire() {
    const modeSel = byId("follow-mode");
    modeSel?.addEventListener("change", async () => {
      const mode = modeSel.value;
      byId("follow-live-fields")?.classList.toggle("hidden", mode === "wav");
      byId("follow-wav-fields")?.classList.toggle("hidden", mode !== "wav");
      await saveSettings({ mode });
      if (mode === "live") loadDevices();
    });
    byId("follow-model")?.addEventListener("change", (e) => saveSettings({ model: e.target.value }));
    byId("follow-device")?.addEventListener("change", (e) => saveSettings({ deviceIndex: e.target.value === "" ? null : Number(e.target.value) }));
    byId("follow-channel")?.addEventListener("change", (e) => saveSettings({ channel: e.target.value === "" ? null : Number(e.target.value) }));
    byId("follow-wav-path")?.addEventListener("change", (e) => saveSettings({ wavPath: e.target.value }));
    byId("follow-refresh-devices")?.addEventListener("click", loadDevices);
    byId("follow-start")?.addEventListener("click", startCapture);
    byId("follow-stop")?.addEventListener("click", stopCapture);
  }

  async function saveSettings(patch) {
    await fetch("/api/follow/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }

  async function loadDevices() {
    const sel = byId("follow-device");
    if (!sel) return;
    try {
      const data = await fetch("/api/follow/devices").then((r) => r.json());
      if (!data.devices) {
        sel.innerHTML = `<option value="">${esc(data.error ?? "No devices")}</option>`;
        return;
      }
      const current = statusData?.settings?.deviceIndex;
      sel.innerHTML = [`<option value="">Select a device…</option>`]
        .concat(data.devices.map((d) => `<option value="${d.index}" ${d.index === current ? "selected" : ""}>[${d.index}] ${esc(d.name)}</option>`))
        .join("");
    } catch {
      sel.innerHTML = `<option value="">Couldn't list devices</option>`;
    }
  }

  async function startCapture() {
    showError(null);
    const body = {
      mode: byId("follow-mode")?.value,
      model: byId("follow-model")?.value,
      deviceIndex: byId("follow-device")?.value === "" ? null : Number(byId("follow-device")?.value),
      channel: byId("follow-channel")?.value === "" ? null : Number(byId("follow-channel")?.value),
      wavPath: byId("follow-wav-path")?.value,
    };
    const res = await fetch("/api/follow/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showError(data.error ?? "Failed to start."); return; }
    setRunning(true);
  }

  async function stopCapture() {
    await fetch("/api/follow/stop", { method: "POST" }).catch(() => {});
    setRunning(false);
  }

  function setRunning(running) {
    byId("follow-start")?.classList.toggle("hidden", running);
    byId("follow-stop")?.classList.toggle("hidden", !running);
    const st = byId("follow-run-status");
    if (st) st.textContent = running ? "Listening…" : "Stopped";
    if (running) byId("follow-transcript-empty")?.remove();
  }

  // One EventSource for the life of the page; handlers look the DOM up
  // fresh each event, so a re-render (new nav visit) just reuses it.
  function ensureStream() {
    if (stream) return;
    stream = new EventSource("/api/follow/stream");
    stream.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "level") setLevel(msg.value);
      else if (msg.type === "transcript") appendTranscript(msg.chunk);
      else if (msg.type === "started") setRunning(true);
      else if (msg.type === "stopped") setRunning(false);
      else if (msg.type === "hello") setRunning(msg.running);
      else if (msg.type === "error") showError(msg.message);
    };
    stream.onerror = () => { stream?.close(); stream = null; };
  }

  // Poll ProPresenter's live state so the operator can eyeball the
  // transcript against the song that's actually on the screens.
  function startLivePoll() {
    clearInterval(liveTimer);
    const paint = async () => {
      const box = byId("follow-livestate");
      if (!box) { clearInterval(liveTimer); return; }
      try {
        const ls = await fetch("/api/live-state").then((r) => r.json());
        box.innerHTML = renderLiveState(ls);
      } catch {
        box.innerHTML = `<div class="opacity-50">Can't reach ProPresenter.</div>`;
      }
    };
    paint();
    liveTimer = setInterval(paint, 2000);
  }

  function setLevel(v) {
    const bar = byId("follow-level");
    if (bar) bar.style.width = `${Math.min(100, Math.round((v ?? 0) * 140))}%`;
  }

  function appendTranscript(chunk) {
    const box = byId("follow-transcript");
    if (!box || !chunk?.text) return;
    byId("follow-transcript-empty")?.remove();
    const line = document.createElement("div");
    const ts = new Date(chunk.t ?? Date.now()).toLocaleTimeString();
    const conf = chunk.conf == null ? "" : ` <span class="opacity-40">(${Math.round(chunk.conf * 100)}%)</span>`;
    line.innerHTML = `<span class="opacity-40">[${ts}]</span> ${esc(chunk.text)}${conf}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function showError(message) {
    const el = byId("follow-error");
    if (!el) return;
    el.classList.toggle("hidden", !message);
    el.textContent = message ?? "";
  }

  function byId(id) {
    return document.getElementById(id);
  }

  return { render };
}

function renderLiveState(ls) {
  if (!ls?.connected) return `<div class="opacity-50">ProPresenter not connected.</div>`;
  const slide = ls.slide;
  if (!ls.live || !slide) return `<div class="opacity-50">Nothing live right now.</div>`;
  const pos = slide.slideCount ? `slide ${Number(slide.slideIndex) + 1} of ${slide.slideCount}` : `slide ${Number(slide.slideIndex) + 1}`;
  return `
    <div class="flex flex-col gap-1">
      <div class="font-semibold">${esc(slide.presentationName ?? "—")}</div>
      ${slide.arrangementName ? `<div class="text-xs opacity-60">${esc(slide.arrangementName)}</div>` : ""}
      <div class="text-xs opacity-60">${esc(pos)}</div>
      ${slide.text ? `<div class="mt-1 whitespace-pre-wrap opacity-90">${esc(slide.text)}</div>` : ""}
    </div>`;
}

function depsBanner(deps) {
  if (!deps || deps.ready) return "";
  const rows = [
    ["ffmpeg", deps.ffmpeg, "Homebrew: brew install ffmpeg"],
    ["python3", deps.python, "Homebrew: brew install python (or the system python3)"],
    ["mlx-whisper", deps.mlxWhisper, "pip3 install mlx-whisper numpy"],
  ];
  const modelNote =
    deps.python && deps.mlxWhisper
      ? `<div class="mt-2">The Whisper model loads fully offline, so download it once first, e.g.:
           <div class="font-mono text-xs bg-base-100 rounded p-1 mt-1">huggingface-cli download mlx-community/whisper-small-mlx</div></div>`
      : "";
  return `
    <div class="alert alert-warning py-2 text-sm flex-col items-start">
      <div class="font-medium flex items-center gap-2"><i data-lucide="alert-triangle" class="w-4 h-4"></i> Follow needs a few tools installed on this machine</div>
      <div class="mt-1 flex flex-col gap-1 w-full">
        ${rows
          .map(
            ([name, ok, how]) => `
          <div class="flex items-center gap-2">
            <span class="badge badge-sm ${ok ? "badge-success" : "badge-error"}">${ok ? "found" : "missing"}</span>
            <span class="font-mono">${esc(name)}</span>
            ${ok ? "" : `<span class="opacity-70 text-xs">— ${esc(how)}</span>`}
          </div>`
          )
          .join("")}
      </div>
      ${deps.mlxError ? `<div class="text-xs opacity-60 mt-1">Python error: ${esc(deps.mlxError)}</div>` : ""}
      ${modelNote}
      <div class="text-xs opacity-60 mt-2">These are dependencies of the Follow module only — Refrain's core search never needs them.</div>
    </div>`;
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
