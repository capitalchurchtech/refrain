/**
 * Library Sync screen — keeps one ProPresenter library in step with another
 * machine or account through a shared folder, one direction at a time.
 *
 * Deliberately shows what a sync WOULD do before you run one, because this
 * writes into a library that represents years of work. Nothing here can delete
 * a presentation: the worst it does is add files and replace changed ones, and
 * it keeps the previous version of anything it replaces.
 */
export function initLibrarySync() {
  const container = document.getElementById("view-library-sync");

  async function render() {
    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        <div>
          <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="folder-sync" class="w-5 h-5"></i> Library Sync</h1>
          <p class="text-sm opacity-70">
            Copies one library between two machines or macOS accounts through a shared folder.
            It only ever adds and updates, never deletes, and keeps dated snapshots you can restore from.
          </p>
        </div>
        <div id="library-sync-body" class="text-sm opacity-70">Loading...</div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    await load();
  }

  async function load() {
    const body = document.getElementById("library-sync-body");
    let data;
    try {
      data = await fetch("/api/library-sync/status").then((r) => r.json());
    } catch (err) {
      body.textContent = `Couldn't load Library Sync: ${err.message}`;
      return;
    }
    body.innerHTML = renderBody(data);
    if (window.lucide) window.lucide.createIcons();
    wire(data);
  }

  function renderBody(data) {
    const s = data.settings ?? {};
    const sending = s.direction === "send";
    return `
      ${
        data.status === "misconfigured"
          ? `<div class="alert alert-warning py-2 text-sm mb-3"><i data-lucide="alert-triangle" class="w-4 h-4 shrink-0"></i>
               <span>Switched on but not finished: pick a library, a direction, and a shared folder below.</span></div>`
          : ""
      }
      ${data.error ? `<div class="alert alert-warning py-2 text-sm mb-3"><span>${escapeHtml(data.error)}</span></div>` : ""}

      <div class="card bg-base-200 mb-3">
        <div class="card-body p-3 gap-3">
          <h2 class="card-title text-base">Settings</h2>
          <label class="label cursor-pointer justify-start gap-2 py-0">
            <input type="checkbox" id="ls-enabled" class="checkbox checkbox-sm" ${s.enabled ? "checked" : ""} />
            <span class="label-text">Turn Library Sync on for this machine</span>
          </label>
          <div class="flex flex-wrap gap-3">
            <label class="form-control">
              <div class="label py-1"><span class="label-text">Library</span></div>
              <input id="ls-library" class="input input-bordered input-sm" value="${escapeHtml(s.libraryName ?? "")}" placeholder="Songs" />
            </label>
            <label class="form-control">
              <div class="label py-1"><span class="label-text">This machine</span></div>
              <select id="ls-direction" class="select select-bordered select-sm">
                <option value="send" ${sending ? "selected" : ""}>Sends (owns the library)</option>
                <option value="receive" ${!sending ? "selected" : ""}>Receives (gets a copy)</option>
              </select>
            </label>
          </div>
          <label class="form-control">
            <div class="label py-1"><span class="label-text">Shared folder both sides can reach</span></div>
            <input id="ls-shared" class="input input-bordered input-sm" value="${escapeHtml(s.sharedFolder ?? "")}"
              placeholder="/Users/Shared/ProPresenter-Songs-Sync-DO-NOT-DELETE" />
          </label>
          <div class="flex flex-wrap gap-3">
            <label class="form-control">
              <div class="label py-1"><span class="label-text">Refuse below this many files</span></div>
              <input id="ls-minimum" type="number" min="1" class="input input-bordered input-sm w-32" value="${s.minimumFiles ?? 25}" />
            </label>
            <label class="form-control">
              <div class="label py-1"><span class="label-text">Snapshots to keep</span></div>
              <input id="ls-snapshots" type="number" min="0" class="input input-bordered input-sm w-32" value="${s.snapshotsToKeep ?? 30}" />
            </label>
          </div>
          <p class="text-xs opacity-60">
            The file floor is the safety net: if the library it reads from has fewer presentations than
            this, the sync refuses to run rather than copying an empty or half-moved folder over a good one.
          </p>
          <div class="flex items-center gap-2">
            <button id="ls-save" class="btn btn-outline btn-sm">Save settings</button>
            <span id="ls-save-status" class="text-sm"></span>
          </div>
        </div>
      </div>

      ${data.status !== "active" ? "" : renderRunCard(data)}
      ${data.lastRun ? renderLastRun(data.lastRun) : ""}
    `;
  }

  function renderRunCard(data) {
    const p = data.preview;
    return `
      <div class="card bg-base-200 mb-3">
        <div class="card-body p-3 gap-2">
          <h2 class="card-title text-base">Run a sync</h2>
          <div class="text-sm opacity-70">
            ${escapeHtml(data.settings.direction === "send" ? "ProPresenter to shared folder" : "Shared folder to ProPresenter")}
          </div>
          <div class="text-xs opacity-60 break-all">
            from ${escapeHtml(data.from ?? "?")}<br />to ${escapeHtml(data.to ?? "?")}
          </div>
          ${
            p
              ? `<div class="text-sm mt-1">
                   What this would do now:
                   <strong>${p.toCopy}</strong> to add,
                   <strong>${p.toReplace}</strong> to update,
                   ${p.unchanged} already identical${p.extra ? `, ${p.extra} only on the receiving side (left alone)` : ""}.
                 </div>
                 <div class="text-xs opacity-60">source has ${p.sourceCount}, destination has ${p.destCount}</div>`
              : ""
          }
          <div class="flex items-center gap-2 mt-1">
            <button id="ls-run" class="btn btn-brand btn-sm">Sync now</button>
            <span id="ls-run-status" class="text-sm"></span>
          </div>
          ${
            data.snapshots?.length
              ? `<div class="text-xs opacity-60 mt-1">Recent snapshots: ${data.snapshots.map(escapeHtml).join(", ")}</div>`
              : `<div class="text-xs opacity-60 mt-1">No snapshots yet. One is taken automatically before each sync.</div>`
          }
        </div>
      </div>
    `;
  }

  function renderLastRun(r) {
    const failed = r.ok === false;
    return `
      <div class="card bg-base-200">
        <div class="card-body p-3 gap-1">
          <h2 class="card-title text-base">Last run</h2>
          <div class="text-sm ${failed ? "text-warning" : "opacity-70"}">
            ${new Date(r.at).toLocaleString()} &middot; ${escapeHtml(r.label ?? "")}
            ${failed ? `&middot; refused` : ""}
          </div>
          ${failed ? `<div class="text-sm text-warning">${escapeHtml(r.reason ?? "")}</div>` : ""}
          ${
            failed
              ? ""
              : `<div class="text-sm">Added ${r.copied?.length ?? 0}, updated ${r.replaced?.length ?? 0}, unchanged ${r.unchanged ?? 0}.
                 ${r.backedUp?.length ? `Previous versions of ${r.backedUp.length} kept.` : ""}</div>
                 <div class="text-xs opacity-60">snapshot ${escapeHtml(r.snapshot ?? "")}${r.snapshotLinked ? ` (${r.snapshotLinked} files hard-linked, so it cost almost nothing)` : ""}</div>`
          }
        </div>
      </div>
    `;
  }

  function wire(data) {
    document.getElementById("ls-save")?.addEventListener("click", async () => {
      const status = document.getElementById("ls-save-status");
      status.textContent = "Saving...";
      status.className = "text-sm opacity-70";
      const body = {
        enabled: document.getElementById("ls-enabled").checked,
        libraryName: document.getElementById("ls-library").value,
        direction: document.getElementById("ls-direction").value,
        sharedFolder: document.getElementById("ls-shared").value,
        minimumFiles: Number(document.getElementById("ls-minimum").value),
        snapshotsToKeep: Number(document.getElementById("ls-snapshots").value),
      };
      try {
        const res = await fetch("/api/library-sync/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const out = await res.json();
        if (!res.ok) {
          status.textContent = out.error;
          status.className = "text-sm text-error";
          return;
        }
        await load();
      } catch (err) {
        status.textContent = err.message;
        status.className = "text-sm text-error";
      }
    });

    document.getElementById("ls-run")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const status = document.getElementById("ls-run-status");
      btn.disabled = true;
      status.textContent = "Syncing...";
      status.className = "text-sm opacity-70";
      try {
        const res = await fetch("/api/library-sync/run", { method: "POST" });
        const out = await res.json();
        if (!res.ok && out.error) {
          status.textContent = out.error;
          status.className = "text-sm text-error";
          return;
        }
        // A refusal comes back as a normal record with ok:false and a reason,
        // which the Last run card explains, so just re-render.
        await load();
      } catch (err) {
        status.textContent = err.message;
        status.className = "text-sm text-error";
      } finally {
        btn.disabled = false;
      }
    });
    void data;
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
