/**
 * Share Library screen — keeps one ProPresenter library in step with another
 * machine or account through a shared folder, one direction at a time.
 *
 * Deliberately shows what a sync WOULD do before you run one, because this
 * writes into a library that represents years of work. Nothing here can delete
 * a presentation: the worst it does is add files and replace changed ones, and
 * it keeps the previous version of anything it replaces.
 */

/**
 * "3 hours ago", "2 days ago" -- how stale the last sync is, in the words a
 * volunteer would actually use. Exported so the compact card on Health can
 * show the same age in the same words rather than inventing a second phrasing
 * of the same number.
 *
 * Caps out at weeks rather than growing months/years logic nobody needs here:
 * a Library Sync nobody has run in six weeks has a bigger problem than the
 * exact word for how long, and "6 weeks ago" already says that plainly.
 */
export function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "moments ago";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

// Past this, a backup is flagged as stale rather than just timestamped. Two
// days, not one: the auto-sync (see server/library-guard.js) fires on every
// ProPresenter close, so a healthy install re-syncs most days it is used --
// but a day with no service at all is normal and should not read as trouble.
export const STALE_AFTER_MS = 48 * 60 * 60_000;

/**
 * The one sentence this whole feature is for: is the backup here current, and
 * does it actually match what is live right now.
 *
 * Two independent questions, because they can disagree in either direction --
 * a sync from ten minutes ago is current but could still be wrong if
 * something else touched the library since, and a sync from three days ago
 * might still happen to match if nothing has changed. `preview` (today's live
 * diff, by content hash -- see planSync) answers "does it match"; `lastRun.at`
 * answers "how current". Only ever available together while ProPresenter is
 * open, since checking "does it match" means reading the live library.
 */
export function describeBackupStatus({ lastRun, preview }) {
  if (!lastRun) return { text: "Never synced yet.", stale: false };

  const ageMs = Date.now() - new Date(lastRun.at).getTime();
  const age = formatAge(ageMs);
  const stale = ageMs > STALE_AFTER_MS;

  if (!lastRun.ok) {
    // Every real refusal reason already ends with its own sentence (see
    // library-guard.js's messages) -- appending a second period read as a
    // typo, "...syncing..".
    return { text: `Last attempt ${age} was refused: ${lastRun.reason ?? "see below."}`, stale: true };
  }

  const matchPart = preview
    ? preview.toCopy === 0 && preview.toReplace === 0
      ? "It matches the live library right now."
      : `It is missing ${preview.toCopy + preview.toReplace} file${preview.toCopy + preview.toReplace === 1 ? "" : "s"} that changed since.`
    : "";

  return {
    text: stale
      ? `Backup is stale — last synced ${age}. ${matchPart}`.trim()
      : `Backup is current — last synced ${age}. ${matchPart}`.trim(),
    stale,
  };
}

export function initLibrarySync() {
  const container = document.getElementById("view-library-sync");

  async function render() {
    container.innerHTML = `
      <div class="flex flex-col gap-4 max-w-3xl">
        <div>
          <h1 class="text-lg font-semibold flex items-center gap-2"><i data-lucide="folder-sync" class="w-5 h-5"></i> Share Library</h1>
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
      body.textContent = `Couldn't load Share Library: ${err.message}`;
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
            <span class="label-text">Turn Share Library on for this machine</span>
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
          <label class="label cursor-pointer justify-start gap-2 py-0">
            <input type="checkbox" id="ls-auto" class="checkbox checkbox-sm" ${s.autoWhenClosed ? "checked" : ""} />
            <span class="label-text">Sync automatically once ProPresenter is closed</span>
          </label>
          <p class="text-xs opacity-60 -mt-2">
            Checked about once a minute. Runs at most once per close -- quitting ProPresenter for the
            night triggers one sync, not one every minute until it reopens.
          </p>
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

      ${data.status === "active" ? renderBackupStatus(data) : ""}
      ${data.status !== "active" ? "" : renderRunCard(data)}
      ${data.lastRun ? renderLastRun(data.lastRun) : ""}
    `;
  }

  function renderBackupStatus(data) {
    const { text, stale } = describeBackupStatus({ lastRun: data.lastRun, preview: data.preview });
    return `
      <div class="card ${stale ? "bg-warning/10 border border-warning/40" : "bg-base-200"} mb-3">
        <div class="card-body p-3 gap-1 flex-row items-center">
          <i data-lucide="${stale ? "alert-triangle" : "shield-check"}" class="w-4 h-4 shrink-0 ${stale ? "text-warning" : "opacity-70"}"></i>
          <div class="text-sm">${escapeHtml(text)}</div>
        </div>
      </div>
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
            ${r.trigger === "auto" ? `&middot; ran on its own, once ProPresenter closed` : ""}
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
        autoWhenClosed: document.getElementById("ls-auto").checked,
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
          status.className = "text-sm rf-flag";
          return;
        }
        await load();
      } catch (err) {
        status.textContent = err.message;
        status.className = "text-sm rf-flag";
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
          status.className = "text-sm rf-flag";
          return;
        }
        // A refusal comes back as a normal record with ok:false and a reason,
        // which the Last run card explains, so just re-render.
        await load();
      } catch (err) {
        status.textContent = err.message;
        status.className = "text-sm rf-flag";
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
