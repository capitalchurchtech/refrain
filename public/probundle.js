import { showFailure } from "./notice.js";
import { escapeHtml } from "./slide-tools.js";

/**
 * Bundles screen: open a ProPresenter presentation or bundle, read what is on
 * every slide, check it, and compare two versions. Read only: nothing here
 * writes a file or talks to ProPresenter (server/probundle.js).
 *
 * The hero is the open file, since that is the work; opening is the entry.
 * Names from ProPresenter (presentations, groups, labels, box names) are shown
 * as written: no case transform.
 */
export function initProbundle() {
  const container = document.getElementById("view-probundle");
  const state = {
    status: null,
    opened: [], // { sourceId, name, from, kind, model, findings, predicted, media }
    current: null, // sourceId shown in the hero
    tab: "inspect", // inspect | check | compare
    diff: null,
    compare: { before: null, after: null },
    busy: false,
    library: { q: "", items: [], total: 0 },
  };

  const byId = (id) => state.opened.find((o) => o.sourceId === id) ?? null;

  async function render() {
    try {
      state.status = await fetch("/api/probundle/status").then((r) => r.json());
    } catch {
      container.innerHTML = `<p class="text-sm">Couldn't reach Refrain. Is it still running?</p>`;
      return;
    }
    paint();
  }

  function paint() {
    const s = state.status ?? {};
    const ready = s.status === "active";
    container.innerHTML = `
      <div class="flex flex-col gap-6 max-w-5xl">
        <div class="flex flex-col gap-1">
          <h2 class="rf-page-sub">Bundles</h2>
          <p class="text-sm opacity-70">Open a presentation or bundle to read every slide, check it before import, or compare two versions. Nothing is written.</p>
        </div>
        ${ready ? openSection(s) + heroSection() : setupSection(s)}
      </div>`;
    wire();
    window.lucide?.createIcons?.();
  }

  // --- Setup: the packs folder ------------------------------------------------
  function setupSection(s) {
    return `
      <div class="card bg-base-200 rf-hero">
        <div class="card-body p-3 gap-3">
          ${(s.problems ?? []).map((p) => `<p class="text-sm"><span class="rf-led mr-2"></span>${escapeHtml(p)}</p>`).join("")}
          <div class="rf-field">
            <label for="pb-packs-dir">Packs folder</label>
            <div class="flex gap-2">
              <input id="pb-packs-dir" type="text" class="input input-bordered flex-1" value="${escapeHtml(s.packsDir ?? s.defaultPacksDir ?? "")}" />
              <button id="pb-save-dir" class="btn btn-brand btn-sm self-center">Save</button>
            </div>
          </div>
          <p class="text-xs opacity-70">Your church's templates will live here, on this computer, never in Refrain's code.</p>
        </div>
      </div>`;
  }

  // --- Opening ------------------------------------------------------------------
  function openSection(s) {
    const lib = state.library;
    return `
      <div class="flex flex-col gap-3">
        <h3 class="rf-subhead">Open</h3>
        ${s.busy ? `<p class="text-sm"><span class="rf-led mr-2"></span>${escapeHtml(s.busy)}</p>` : ""}
        <div class="grid gap-4 md:grid-cols-2">
          <div class="rf-field">
            <label for="pb-lib-q">From the library</label>
            <input id="pb-lib-q" type="search" class="input input-bordered" placeholder="Presentation name" value="${escapeHtml(lib.q)}" ${s.busy ? "disabled" : ""} />
            <div id="pb-lib-list" class="flex flex-col mt-1 max-h-56 overflow-auto">${libraryList()}</div>
          </div>
          <div class="rf-field">
            <label for="pb-file">From a file</label>
            <input id="pb-file" type="file" accept=".pro,.probundle" class="file-input file-input-bordered file-input-sm w-full" ${s.busy ? "disabled" : ""} />
            <p class="text-xs opacity-70 mt-1">A .pro or a .probundle, up to ${escapeHtml(String(s.limits?.uploadMB ?? 300))} MB.</p>
          </div>
        </div>
        ${state.busy ? `<p class="text-sm opacity-70">Reading…</p>` : ""}
        ${state.opened.length ? openedRow() : ""}
      </div>`;
  }

  function libraryList() {
    const { items, total, q } = state.library;
    if (!q) return `<p class="text-xs opacity-70">Type to find a presentation Refrain has indexed.</p>`;
    if (!items.length) return `<p class="text-xs opacity-70">Nothing indexed matches.</p>`;
    return (
      items
        .map((p) => `<button type="button" class="btn btn-ghost btn-sm justify-start normal-case font-normal pb-lib-item" data-id="${escapeHtml(p.id)}">
            <span class="truncate" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>${p.folder ? `<span class="text-xs opacity-60 ml-2 shrink-0">${escapeHtml(p.folder)}</span>` : ""}
          </button>`)
        .join("") + (total > items.length ? `<p class="text-xs opacity-70 px-3">${total - items.length} more; narrow the search.</p>` : "")
    );
  }

  // Tiles, not chips: these are file names the church chose, shown as written.
  function openedRow() {
    return `
      <div class="flex flex-wrap gap-2 items-center">
        ${state.opened
          .map((o) => `<button type="button" class="btn btn-sm rf-tile pb-show ${o.sourceId === state.current ? "rf-tile-current" : ""}" aria-pressed="${o.sourceId === state.current}" data-id="${escapeHtml(o.sourceId)}" title="${escapeHtml(o.from)}">${escapeHtml(o.name)}</button>`)
          .join("")}
      </div>`;
  }

  // --- The hero: the open file ----------------------------------------------------
  function heroSection() {
    const o = byId(state.current);
    if (!o) return "";
    const counts = { problem: 0, warning: 0, note: 0 };
    for (const f of o.findings) counts[f.severity]++;
    const tabs = [
      ["inspect", `Inspect · ${o.model.slideCount} slide${o.model.slideCount === 1 ? "" : "s"}`],
      ["check", `Check · ${counts.problem + counts.warning} to look at`],
      ["compare", "Compare"],
    ];
    return `
      <div class="card bg-base-200 rf-hero">
        <div class="card-body p-3 gap-4">
          <div class="flex flex-col gap-1">
            <div class="text-base font-medium">${escapeHtml(o.model.name || o.name)}</div>
            <div class="text-xs opacity-70">${escapeHtml(o.from)} · ${o.kind === "probundle" ? `bundle, ${o.media.length} media file${o.media.length === 1 ? "" : "s"}` : "presentation"}</div>
          </div>
          <div role="tablist" class="tabs tabs-bordered">
            ${tabs.map(([id, label]) => `<button role="tab" type="button" class="tab pb-tab ${state.tab === id ? "tab-active" : ""}" data-tab="${id}">${escapeHtml(label)}</button>`).join("")}
          </div>
          <div>${state.tab === "inspect" ? inspectView(o) : state.tab === "check" ? checkView(o) : compareView()}</div>
        </div>
      </div>`;
  }

  function inspectView(o) {
    const m = o.model;
    const arrangements = m.arrangements.length
      ? `<p class="text-xs opacity-70">Arrangements: ${m.arrangements.map((a) => `${escapeHtml(a.name)} (${a.groups.map(escapeHtml).join(", ")})`).join(" · ")}</p>`
      : "";
    return `
      <div class="flex flex-col gap-6">
        ${arrangements}
        ${m.groups
          .map(
            (g) => `
          <section class="flex flex-col gap-2">
            <h4 class="text-sm font-medium flex items-center gap-2">${g.color ? `<span class="inline-block w-3 h-3 rounded-sm" style="background:${escapeHtml(g.color)}"></span>` : ""}${escapeHtml(g.name)}</h4>
            ${g.slides.map((s, i) => slideCard(s, i)).join("") || `<p class="text-xs opacity-70">No slides.</p>`}
          </section>`
          )
          .join("")}
      </div>`;
  }

  function slideCard(s, i) {
    const extras = [
      ...s.media.map((x) => `media ${escapeHtml(x.file ?? "?")}${x.layer != null ? ` (layer ${x.layer})` : ""}`),
      ...s.macros.map((x) => `macro ${escapeHtml(x.collection ?? "?")} › ${escapeHtml(x.name ?? "?")}`),
    ];
    return `
      <details class="bg-base-100 rounded p-2">
        <summary class="cursor-pointer text-sm flex gap-3 items-baseline">
          <span class="opacity-60 tabular-nums w-6 text-right shrink-0">${i + 1}</span>
          <span class="font-medium shrink-0">${escapeHtml(s.label || "(no label)")}</span>
          <span class="opacity-70 truncate">${escapeHtml(s.text.join(" / ").replace(/\n/g, " "))}</span>
          ${s.enabled ? "" : `<span class="text-xs opacity-70 shrink-0">disabled</span>`}
        </summary>
        <div class="mt-2 flex flex-col gap-2 text-sm">
          ${s.elements.length ? `<table class="table table-xs">
            <thead><tr><th>Box</th><th>Job</th><th>Where</th><th>Words or picture</th></tr></thead>
            <tbody>${s.elements
              .map(
                (e) => `<tr>
                  <td>${escapeHtml(e.name || "(unnamed)")}</td>
                  <td class="opacity-70">${escapeHtml(e.role)}</td>
                  <td class="tabular-nums opacity-70">${e.bounds.x},${e.bounds.y} · ${e.bounds.w}×${e.bounds.h}</td>
                  <td class="whitespace-pre-line">${escapeHtml(e.text || e.media || "")}${e.caps ? ` <span class="text-xs opacity-60">caps</span>` : ""}${e.fontSize ? ` <span class="text-xs opacity-60">${e.fontSize}pt</span>` : ""}</td>
                </tr>`
              )
              .join("")}</tbody></table>` : `<p class="text-xs opacity-70">Nothing on this slide.</p>`}
          ${extras.length ? `<p class="text-xs opacity-70">${extras.join(" · ")}</p>` : ""}
        </div>
      </details>`;
  }

  function checkView(o) {
    const order = { problem: 0, warning: 1, note: 2 };
    const list = [...o.findings].sort((a, b) => order[a.severity] - order[b.severity]);
    const rough = o.predicted === "rough";
    return `
      <div class="flex flex-col gap-2">
        ${rough ? `<p class="text-xs opacity-70">Line and fit checks are a rough guess until this church has a font table.</p>` : ""}
        ${
          list.length
            ? list
                .map(
                  (f) => `<div class="flex gap-3 text-sm items-baseline">
                    <span class="rf-led ${f.severity === "note" ? "" : "lit"} shrink-0" title="${escapeHtml(f.severity)}"></span>
                    <span class="w-16 shrink-0 text-xs opacity-70">${escapeHtml(f.severity)}</span>
                    <span>${f.slide ? `<span class="font-medium">${escapeHtml(f.slide)}</span>${f.box ? ` · ${escapeHtml(f.box)}` : ""}: ` : ""}${escapeHtml(rough ? f.message.replace(/ \(a rough guess[^)]*\)/, "") : f.message)}</span>
                  </div>`
                )
                .join("")
            : `<p class="text-sm">Nothing found.</p>`
        }
      </div>`;
  }

  function compareView() {
    if (state.opened.length < 2) return `<p class="text-sm">Open a second version of this presentation to compare them: the file as imported, say, and the same file after hand fixes.</p>`;
    const options = (sel) => state.opened.map((o) => `<option value="${escapeHtml(o.sourceId)}" ${o.sourceId === sel ? "selected" : ""}>${escapeHtml(o.name)} (${escapeHtml(o.from)})</option>`).join("");
    // By default the two most recently opened: the older one as before.
    const before = state.compare.before ?? state.opened.at(-2)?.sourceId;
    const after = state.compare.after ?? state.opened.at(-1)?.sourceId;
    return `
      <div class="flex flex-col gap-4">
        <div class="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end">
          <div class="rf-field"><label for="pb-before">Before</label><select id="pb-before" class="select select-bordered select-sm">${options(before)}</select></div>
          <div class="rf-field"><label for="pb-after">After</label><select id="pb-after" class="select select-bordered select-sm">${options(after)}</select></div>
          <button id="pb-compare" class="btn btn-brand btn-sm">Compare</button>
        </div>
        ${state.diff ? diffView(state.diff) : ""}
      </div>`;
  }

  function diffView(r) {
    const d = r.diff;
    const show = (v) => (v === null || v === undefined || v === "" ? "nothing" : String(v));
    const nothing = !d.added.length && !d.removed.length && !d.changed.length && !d.groups && !d.arrangements;
    if (nothing) return `<p class="text-sm">No differences.</p>`;
    return `
      <div class="flex flex-col gap-3 text-sm">
        ${d.groups ? `<p>Groups: ${escapeHtml(d.groups.before.join(", "))} → ${escapeHtml(d.groups.after.join(", "))}</p>` : ""}
        ${d.arrangements ? `<p>Arrangements changed: ${escapeHtml(d.arrangements.after.join(" · "))}</p>` : ""}
        ${d.added.length ? `<p><span class="font-medium">Added:</span> ${d.added.map(escapeHtml).join(" · ")}</p>` : ""}
        ${d.removed.length ? `<p><span class="font-medium">Removed:</span> ${d.removed.map(escapeHtml).join(" · ")}</p>` : ""}
        ${d.changed
          .map(
            (c) => `<div class="bg-base-100 rounded p-2">
              <div class="font-medium">${escapeHtml(c.slide)}</div>
              <ul class="mt-1 flex flex-col gap-1">${c.changes
                .map((x) => `<li><span class="opacity-70">${escapeHtml(x.what)}${x.box ? ` · ${escapeHtml(x.box)}` : ""}:</span> <span class="whitespace-pre-line">${escapeHtml(show(x.before))}</span> → <span class="whitespace-pre-line">${escapeHtml(show(x.after))}</span></li>`)
                .join("")}</ul>
            </div>`
          )
          .join("")}
      </div>`;
  }

  // --- Actions -------------------------------------------------------------------
  async function post(url, body, headers = { "Content-Type": "application/json" }) {
    const res = await fetch(url, { method: "POST", headers, body: headers["Content-Type"] === "application/json" ? JSON.stringify(body) : body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? res.statusText);
    return data;
  }

  async function open(promise) {
    state.busy = true;
    paint();
    try {
      const r = await promise;
      state.opened = [...state.opened.filter((o) => o.sourceId !== r.sourceId), r].slice(-6);
      state.current = r.sourceId;
      state.tab = r.findings.some((f) => f.severity === "problem") ? "check" : "inspect";
      state.diff = null;
    } catch (err) {
      showFailure(`Couldn't open that file: ${err.message}`);
    } finally {
      state.busy = false;
      paint();
    }
  }

  let searchTimer = null;
  function wire() {
    container.querySelector("#pb-save-dir")?.addEventListener("click", async () => {
      try {
        await post("/api/probundle/config", { packsDir: container.querySelector("#pb-packs-dir").value });
        await render();
      } catch (err) {
        showFailure(`Couldn't save the packs folder: ${err.message}`);
      }
    });
    const q = container.querySelector("#pb-lib-q");
    q?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        state.library.q = q.value.trim();
        if (state.library.q) {
          const r = await fetch(`/api/probundle/library?q=${encodeURIComponent(state.library.q)}`).then((x) => x.json()).catch(() => ({ presentations: [], total: 0 }));
          state.library.items = r.presentations ?? [];
          state.library.total = r.total ?? 0;
        } else state.library.items = [];
        container.querySelector("#pb-lib-list").innerHTML = libraryList();
        wireLibrary();
      }, 200);
    });
    wireLibrary();
    container.querySelector("#pb-file")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      open(file.arrayBuffer().then((buf) => post("/api/probundle/open/upload", buf, { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) })));
    });
    for (const b of container.querySelectorAll(".pb-show")) b.addEventListener("click", () => { state.current = b.dataset.id; state.diff = null; paint(); });
    for (const b of container.querySelectorAll(".pb-tab")) b.addEventListener("click", () => { state.tab = b.dataset.tab; paint(); });
    container.querySelector("#pb-before")?.addEventListener("change", (e) => (state.compare.before = e.target.value));
    container.querySelector("#pb-after")?.addEventListener("change", (e) => (state.compare.after = e.target.value));
    container.querySelector("#pb-compare")?.addEventListener("click", async () => {
      const before = container.querySelector("#pb-before").value, after = container.querySelector("#pb-after").value;
      state.compare = { before, after };
      try {
        state.diff = await post("/api/probundle/diff", { before, after });
      } catch (err) {
        showFailure(`Couldn't compare: ${err.message}`);
      }
      paint();
    });
  }

  function wireLibrary() {
    for (const b of container.querySelectorAll(".pb-lib-item")) {
      b.addEventListener("click", () => open(post("/api/probundle/open/library", { presentationId: b.dataset.id })));
    }
  }

  return { render };
}
