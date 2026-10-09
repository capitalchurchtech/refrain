// The phone page (issues #7 and #8, redesigned 2026-10-09). See server/remote.js
// for the boundary: this page can read what's live, search the index, add a
// flag, send a stage message or a pager code (approved phones, two taps), and,
// only if the booth has switched it on, put one searched slide on the screens
// (a device code once a month, a request code every time, then a confirm).
//
// Flags that can't be sent right away (a phone dropping to cellular, a Wi-Fi
// blackspot) are queued in this browser and retried, and the page says so.
// A note that silently vanished would be worse than not having the feature.

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) {
    try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: nothing kept */ }
  },
  del(k) {
    try { localStorage.removeItem(k); } catch { /* nothing to remove */ }
  },
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mmss = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = String(t % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`; };
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");
const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)); return m < 1 ? "now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const monthName = () => new Date().toLocaleDateString([], { month: "long" });

let token = store.get("refrain.remote.token", "");
let state = null; // /api/state
let glive = { enabled: false, allowed: false }; // /api/golive/status
let openFlagCount = null;
let page = "service";
let sheet = null;
let armed = null; // { key, confirmId, label, timer }
let search = { q: "", results: [], more: false, done: false, busy: false, err: "" };
let history = { items: [], at: 0, loaded: false };

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(token ? { "x-refrain-device": token } : {}) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.locked) showLock();
  if (!res.ok) { const e = new Error(data.error || res.statusText); e.status = res.status; e.data = data; throw e; }
  return data;
}
const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body ?? {}) });

// --- the PIN -----------------------------------------------------------------
// Where to find it comes from the booth (networkModule.pinHint). A correct
// PIN earns this phone a token: until midnight, or 30 days if trusted.
async function showLock() {
  if (!$("lock").hidden) return; // already asking; don't steal the cursor every refresh
  $("app").hidden = true;
  $("lock").hidden = false;
  $("lock-name").value = store.get("refrain.remote.name", "");
  try {
    const lock = await (await fetch("/api/lock")).json();
    $("lock-hint").textContent = lock.hint ?? "";
    $("pin-label").textContent = lock.daily ? "Today's PIN" : "PIN";
  } catch { /* the hint is a courtesy */ }
  // No automatic focus: on a phone it opens the keyboard and Safari zooms in
  // on the box before anyone has read the page.
}
$("unlock").addEventListener("click", async () => {
  $("unlock").disabled = true;
  try {
    store.set("refrain.remote.name", $("lock-name").value);
    const res = await fetch("/api/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: $("pin").value, trust: $("trust").checked, name: $("lock-name").value }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    token = data.token ?? "";
    store.set("refrain.remote.token", token);
    $("lock").hidden = true;
    $("app").hidden = false;
    $("pin").value = "";
    start();
  } catch (err) {
    $("lock-status").textContent = err.message;
  } finally {
    $("unlock").disabled = false;
  }
});
$("pin").addEventListener("keydown", (e) => { if (e.key === "Enter") $("unlock").click(); });

// --- the bottom banner: a toast, or the confirm for an armed press -------------
let toastTimer = null;
function toast(text, kind = "") {
  if (armed) return;
  clearTimeout(toastTimer);
  const b = $("banner");
  b.className = `banner toast ${kind}`;
  b.textContent = text;
  b.hidden = false;
  toastTimer = setTimeout(() => { if (!armed) b.hidden = true; }, 3500);
}
function showArmed(label) {
  const b = $("banner");
  b.className = "banner";
  b.innerHTML = `<div>${esc(label)}</div><small>Tap to confirm · tap elsewhere to cancel</small>`;
  b.hidden = false;
}
function disarm() {
  if (!armed) return;
  clearTimeout(armed.timer);
  armed = null;
  $("banner").hidden = true;
  if (sheet?.kind === "alert") renderSheet();
}
$("banner").addEventListener("click", () => { if (armed) confirmArmed(); });

// --- navigation ------------------------------------------------------------------
const ICONS = {
  service: '<path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M12 14v3l2 1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  alert: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
};
const NAV = [["service", "Service"], ["search", "Search"], ["alert", "Alert"], ["history", "History"], ["phone", "Phone"]];
const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
function paintNav() {
  $("nav").innerHTML = NAV.map(([id, label]) =>
    id === "alert"
      ? `<button class="alertkey" data-nav="alert" aria-label="Alert"><span class="cap">${svg("alert")}</span>Alert</button>`
      : `<button data-nav="${id}"${page === id && !sheet ? ' aria-current="page"' : ""}>${svg(id)}${label}</button>`
  ).join("");
}
$("nav").addEventListener("click", (e) => {
  const b = e.target.closest("[data-nav]");
  if (!b) return;
  disarm();
  if (b.dataset.nav === "alert") return openAlert();
  closeSheet();
  page = b.dataset.nav;
  paintPage();
  if (page === "history") refresh();
});
$("link-lamp").addEventListener("click", () => { disarm(); closeSheet(); page = "phone"; paintPage(); });

function paintLamp() {
  const up = Boolean(state?.connected);
  $("link-lamp").className = `lamp${up ? "" : " off"}`;
}

// --- the pages -----------------------------------------------------------------------
const featureOn = (name) => state?.features?.[name] !== false;

function readoutHtml() {
  if (!state) return `<div class="glass"><div class="ph off">Loading…</div></div>`;
  const p = state.progress;
  if (!state.connected) return `<div class="glass"><div class="ph off">No link</div><div class="ph-sub">The booth has lost ProPresenter</div></div>`;
  if (!p?.item) return `<div class="glass"><div class="ph off">Nothing up</div><div class="ph-sub">Nothing is on the screens</div></div>`;
  const slide = state.recent?.[0];
  const slideNo = slide && state.live ? ` · slide ${slide.slideNumber}` : "";
  return `<div class="glass"><div class="ph-sub" style="margin:0 0 6px">On screen${p.item.position ? ` · item ${p.item.position} of ${p.item.of}` : ""} · up ${mmss(p.item.upForMs)}</div><div class="ph">${esc(p.item.name)}</div>${slideNo ? `<div class="ph-sub">${slideNo.slice(3)}</div>` : ""}</div>`;
}
function paintReadout() {
  const el = $("readout");
  if (el) el.innerHTML = readoutHtml();
}

function paintPage() {
  paintNav();
  const main = $("page");
  main.scrollTop = 0;
  if (page === "service") {
    const flags = featureOn("flags");
    main.innerHTML = `<h1>Service</h1>
      <div class="sect"><span>Now</span></div>
      <div class="readout" id="readout">${readoutHtml()}</div>
      ${flags ? `<div class="twin"><button class="send" data-act="add-flag">Add flag</button><button class="send quiet" data-act="view-flags" id="view-flags">${viewFlagsLabel()}</button></div>` : `<p class="note">Flagging is switched off at the booth.</p>`}`;
  } else if (page === "search") {
    paintSearchPage();
  } else if (page === "history") {
    paintHistoryPage();
  } else {
    paintPhonePage();
  }
}
const viewFlagsLabel = () => `View flags${openFlagCount ? ` · ${openFlagCount}` : ""}`;

// --- Search -----------------------------------------------------------------------------
function paintSearchPage() {
  $("page").innerHTML = `<h1>Search</h1>
    <div class="rf-sf${search.done && !search.results.length ? " quiet" : ""}" id="ring"><div class="rf-sf-glow"><i></i></div><div class="rf-sf-ring"><i></i></div>
      <input id="q" class="f" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Words from a slide" aria-label="Search slides" value="${esc(search.q)}" /></div>
    <div id="live-bar"></div>
    <div id="results"></div>`;
  paintLiveBar();
  paintResults();
}
function paintLiveBar() {
  const el = $("live-bar");
  if (!el) return;
  if (!glive.enabled) el.innerHTML = `<p class="note">Going live from phones is off at the booth.</p>`;
  else if (!glive.allowed) el.innerHTML = `<div class="lockbar"><span>Live is locked on this phone</span><button class="key chip" data-act="allow">Allow</button></div>`;
  else el.innerHTML = `<div class="lockbar open"><span>Live allowed on this phone</span><span>while signed in · to ${esc(new Date(new Date(glive.until).getTime() - 1).toLocaleDateString([], { month: "short", day: "numeric" }))}</span></div>`;
}
function paintResults() {
  const el = $("results");
  if (!el) return;
  if (search.err) return void (el.innerHTML = `<div class="err">${esc(search.err)}</div>`);
  if (search.q.trim().length < 2) return void (el.innerHTML = `<p class="note">Type two or more letters. You can flag a result${glive.enabled ? " or, once allowed, put it on the screens" : ""}.</p>`);
  if (!search.done) return void (el.innerHTML = `<p class="note">Searching…</p>`);
  if (!search.results.length) return void (el.innerHTML = `<div class="box" style="margin-top:12px"><b>No slide says “${esc(search.q.trim())}”.</b>Check the spelling, or try fewer words.</div>`);
  const up = state?.recent?.[0];
  const flags = featureOn("flags");
  el.innerHTML = `<div class="rows" style="margin-top:12px">${search.results
    .map((r, i) => {
      const here = state?.live && up && up.presentationId === r.presentationId && up.slideIndex === r.slideIndex;
      return `<div class="row"><div class="t">${esc(r.presentationName ?? "Untitled")}</div><div class="a">Slide ${r.slideNumber}</div>
        <div class="s">“${esc(r.text)}”</div>
        <div class="acts">${flags ? `<button class="key chip" data-act="flag-result" data-i="${i}">Flag this</button>` : ""}${here ? `<span class="ph-sub" style="margin:0;color:var(--phosphor)">On screen now</span>` : glive.enabled && glive.allowed ? `<button class="gokey" data-act="go-live" data-i="${i}">Go live</button>` : ""}</div></div>`;
    })
    .join("")}</div>${search.more ? `<p class="note">There are more than 20. Add a word to narrow it.</p>` : ""}`;
}
let searchTimer = null;
let searchSeq = 0;
document.addEventListener("input", (e) => {
  if (e.target.id !== "q") return;
  search.q = e.target.value;
  search.done = false;
  search.err = "";
  clearTimeout(searchTimer);
  paintResults();
  const q = search.q.trim();
  if (q.length < 2) return;
  const seq = ++searchSeq;
  searchTimer = setTimeout(async () => {
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (seq !== searchSeq) return; // a newer search is already on its way
      search = { ...search, results: r.results, more: r.more, done: true, err: "" };
    } catch (err) {
      if (seq !== searchSeq) return;
      search = { ...search, results: [], done: true, err: err.status ? err.message : "Can't reach the booth. Check the Wi-Fi." };
    }
    $("ring")?.classList.toggle("quiet", !search.results.length);
    syncRing();
    paintResults();
  }, 250);
});
// As on the booth's Search: the band travels the whole time the field has focus, and holds still on a miss.
function syncRing() {
  const ring = $("ring");
  if (ring) ring.classList.toggle("typing", document.activeElement?.id === "q" && !ring.classList.contains("quiet"));
}
document.addEventListener("focusin", (e) => { if (e.target.id === "q") syncRing(); });
document.addEventListener("focusout", (e) => { if (e.target.id === "q") $("ring")?.classList.remove("typing"); });

// --- History: how long each item was up -----------------------------------------------------
function paintHistoryPage() {
  const items = history.items;
  if (!history.loaded) return void ($("page").innerHTML = `<h1>History</h1><p class="note">Loading…</p>`);
  $("page").innerHTML = `<h1>History</h1><p class="note" style="margin:0 0 4px">Newest first. Looking only: nothing here goes on the screens.</p>
    <div class="rows" id="hist" style="margin-top:10px;border:0">${
      items.length
        ? items.map((r, i) => (r.current ? currentRowHtml(r, i) : `<div class="hx"><div class="nm">${esc(r.name)}</div><div class="tm"><div><span>Started</span><b>${clock(r.startedAt)}</b></div><div><span>Elapsed</span><b>${mmss(r.elapsedMs)}</b></div><div><span>Left</span><b>${clock(r.endedAt)}</b></div></div></div>`)).join("")
        : `<div class="box"><b>Nothing has been on the screens yet.</b>Each item shows here with how long it was up.</div>`
    }</div>`;
}
// The bar is this stay against the longest earlier one (ten minutes if there is none yet).
const currentRowHtml = (r) => {
  const longest = Math.max(600_000, ...history.items.filter((x) => !x.current).map((x) => x.elapsedMs));
  return `<div class="hx cur" aria-current="true"><div class="nm">${esc(r.name)}</div><div class="tm"><div><span>Started</span><b>${clock(r.startedAt)}</b></div><div><span>Elapsed</span><b class="big" data-tick>${mmss(r.elapsedMs)}</b></div><div><span>Left</span><b>—</b></div></div><div class="bar" style="--p:${Math.min(100, Math.round((r.elapsedMs / longest) * 100))}%"></div></div>`;
};
// The open row counts on between refreshes, from when the phone last heard.
setInterval(() => {
  const cur = history.items.find((r) => r.current);
  const el = document.querySelector("[data-tick]");
  if (cur && el) el.textContent = mmss(cur.elapsedMs + (Date.now() - history.at));
}, 1000);

// --- Phone ---------------------------------------------------------------------------------------
function paintPhonePage() {
  const name = state?.phone?.name;
  $("page").innerHTML = `<h1>Phone</h1>
    <div class="sect"><span>Link</span></div>
    <div class="box"><b>${state?.connected ? "Link active" : "No link"}</b>${state?.connected ? "This phone can reach the booth, and the booth can see ProPresenter." : "The booth has lost ProPresenter. Flags and alerts may not work until it's back."}</div>
    <div class="sect"><span>This phone</span></div>
    <div class="box"><b>${esc(name ?? "A phone")}</b>${state?.phone?.canControl ? "Can send alerts." : "Flags and search only. Ask the booth to allow alerts."}${glive.enabled ? ` ${glive.allowed ? `Can go live while it stays signed in, to the end of ${esc(monthName())} at most.` : "Needs this month's device code to go live."}` : ""}</div>
    <div class="sect"><span>Sign-in</span></div>
    <button class="key chip" style="width:100%" data-act="forget">Forget this phone</button>
    <p class="note">You'll need the PIN again next time.</p>`;
}

// --- sheets -----------------------------------------------------------------------------------------
function openSheet(s) {
  disarm();
  sheet = s;
  renderSheet();
  paintNav();
}
function closeSheet() {
  if (!sheet) return;
  disarm();
  sheet = null;
  $("sheet").hidden = true;
  $("sheet").innerHTML = "";
  paintNav();
}
function renderSheet() {
  if (!sheet) return;
  const { title, body } = sheetContent();
  $("sheet").hidden = false;
  $("sheet").innerHTML = `<div class="scrim" data-act="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-head"><span class="wordmark">${esc(title)}</span><button class="key chip" data-act="close-sheet">${sheet.kind === "live" && sheet.step === "confirm" ? "Cancel" : "Close"}</button></div><div class="sheet-body">${body}</div></div>`;
  if (sheet.kind === "flags") loadFlagPictures();
}
function sheetContent() {
  if (sheet.kind === "flag") return { title: "Add flag", body: flagBody() };
  if (sheet.kind === "flags") return { title: "Flags", body: flagsBody() };
  if (sheet.kind === "alert") return { title: "Alert", body: alertBody() };
  if (sheet.kind === "allow") return { title: "Allow live", body: allowBody() };
  return { title: sheet.step === "confirm" ? "Confirm" : "Go live", body: liveBody() };
}
$("sheet").addEventListener("click", (e) => {
  if (e.target.closest("[data-act='close-sheet']")) closeSheet();
});

// --- Add flag ------------------------------------------------------------------------------------------
async function openFlag(pick = null) {
  openSheet({ kind: "flag", pick, all: false, type: null, note: "", slides: null, sel: null, busy: false, err: "" });
  if (pick) return;
  try {
    const d = await api("/api/flag-slides");
    if (sheet?.kind !== "flag") return;
    sheet.slides = d;
    sheet.sel = d.presentationId ? { presentationId: d.presentationId, slideIndex: d.currentIndex } : null;
  } catch (err) {
    if (sheet?.kind === "flag") sheet.err = err.status ? err.message : "Can't reach the booth. Check the Wi-Fi.";
  }
  if (sheet?.kind === "flag") renderSheet();
}
// Back from a Search pick to the slide on screen, keeping the type and note already chosen.
async function backToScreen() {
  const s = sheet;
  s.pick = null;
  try {
    const d = s.slides ?? (await api("/api/flag-slides"));
    if (sheet !== s) return;
    s.slides = d;
    s.sel = d.presentationId ? { presentationId: d.presentationId, slideIndex: d.currentIndex } : null;
  } catch (err) {
    s.err = err.status ? err.message : "Can't reach the booth. Check the Wi-Fi.";
  }
  renderSheet();
}
const noteNeeded = (s) => s.type === "Note" && !s.note.trim();
function flagBody() {
  const s = sheet;
  let which;
  if (s.pick) {
    which = `<div class="box" style="color:var(--text)">${esc(s.pick.presentationName ?? "Untitled")} · slide ${s.pick.slideNumber}<br><span style="color:var(--muted)">“${esc(s.pick.text)}”</span></div>
      <button class="key chip" style="width:100%;margin-top:8px" data-act="flag-screen">Back to the slide on screen</button>`;
  } else if (s.err) {
    which = `<div class="err">${esc(s.err)}</div>`;
  } else if (!s.slides) {
    which = `<p class="note">Loading the slides…</p>`;
  } else if (!s.slides.presentationId) {
    which = `<div class="box"><b>Nothing is on the screens.</b>To flag a slide that isn't up, find it in Search and press Flag this.</div>`;
  } else {
    const cur = s.slides.currentIndex;
    const shown = s.all ? s.slides.slides : s.slides.slides.filter((x) => Math.abs(x.slideIndex - cur) <= 2);
    which = `<div class="sect" style="margin-top:0"><span>${esc(s.slides.presentationName ?? "On screen")}</span></div>
      <div class="bank">${shown
        .map((x) => {
          const rel = x.slideIndex === cur ? "On screen" : x.slideIndex < cur ? `${cur - x.slideIndex} back` : `${x.slideIndex - cur} ahead`;
          const sel = s.sel?.slideIndex === x.slideIndex;
          return `<button class="key${sel ? " on" : ""}" data-act="pick-slide" data-idx="${x.slideIndex}" aria-pressed="${sel}"><span><small>Slide ${x.slideNumber} · ${rel}</small><span class="words">${x.text ? esc(x.text.slice(0, 90)) : "<i>No words on this slide</i>"}</span></span></button>`;
        })
        .join("")}</div>
      ${s.slides.slides.length > shown.length || s.all ? `<button class="key chip" style="width:100%;margin-top:8px" data-act="all-slides">${s.all ? "Show fewer" : `All ${s.slides.slides.length} slides`}</button>` : ""}`;
  }
  const types = (state?.types ?? []).map((t) => `<button class="key" data-act="pick-type" data-type="${esc(t)}" aria-pressed="${s.type === t}">${esc(t)}</button>`).join("");
  const hint = !s.type ? "Pick what's wrong." : noteNeeded(s) ? "Write the note for the team." : "A picture of this slide is saved with the flag.";
  const ready = (s.pick || s.sel) && s.type && !noteNeeded(s);
  return `${which}
    <div class="sect"><span>What's wrong</span></div><div class="bank types">${types}</div>
    <div class="sect"><span>${s.type === "Note" ? "Note for the team" : "Note (optional)"}</span></div>
    <textarea class="f" id="flag-note" maxlength="500" aria-label="Note" placeholder="${s.type === "Note" ? "What should the team know?" : "e.g. second line should say “grace”"}">${esc(s.note)}</textarea>
    <button class="send" data-act="add-flag-now" ${ready && !s.busy ? "" : "disabled"}>${s.busy ? "Adding…" : "Add flag"}</button>
    <p class="note" id="flag-hint">${esc(hint)}</p>${s.fault ? `<div class="err">${esc(s.fault)}</div>` : ""}`;
}
document.addEventListener("input", (e) => {
  if (e.target.id !== "flag-note" || sheet?.kind !== "flag") return;
  sheet.note = e.target.value;
  const ready = (sheet.pick || sheet.sel) && sheet.type && !noteNeeded(sheet);
  const b = document.querySelector("[data-act='add-flag-now']");
  if (b) b.disabled = !ready || sheet.busy;
  $("flag-hint").textContent = !sheet.type ? "Pick what's wrong." : noteNeeded(sheet) ? "Write the note for the team." : "A picture of this slide is saved with the flag.";
});

// One retry at a time, and each flag has its own id, so a retry only ever
// removes what it actually sent: a flag queued while a retry is running is
// never erased, and a slow retry can't overlap the next and send twice.
const queued = () => store.get("refrain.remote.queue", []);
const dropFromQueue = (id) => store.set("refrain.remote.queue", queued().filter((q) => q.id !== id));
let flushing = false;
async function flush() {
  if (flushing || !queued().length) return;
  flushing = true;
  let sent = 0;
  try {
    for (const item of queued()) {
      try {
        await post("/api/flag", item);
        dropFromQueue(item.id);
        sent++;
      } catch (err) {
        // Refused for good (not in the index any more, say): say so, with the
        // note, so it isn't lost silently. Network trouble or a lock: keep it.
        if (err.status && err.status < 500 && err.status !== 429 && err.status !== 401) {
          dropFromQueue(item.id);
          toast(`A waiting flag couldn't be sent (${err.message})${item.note ? `. Its note was: "${item.note}"` : ""}`, "fault");
        } else break;
      }
    }
  } finally {
    flushing = false;
  }
  const left = queued().length;
  if (left) toast(`${left} flag${left === 1 ? "" : "s"} waiting to send. Retrying.`, "fault");
  else if (sent) toast("Waiting flags sent.");
}

async function addFlagNow() {
  const s = sheet;
  const target = s.pick ?? s.sel;
  if (!target || !s.type || noteNeeded(s) || s.busy) return;
  const name = store.get("refrain.remote.name", "");
  // The slide it means travels with it, so a flag that waits (no signal) still
  // lands on the right slide; the server checks it against the index.
  const item = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, ref: null, slide: { presentationId: target.presentationId, slideIndex: target.slideIndex, at: new Date().toISOString() }, type: s.type, note: s.note, name };
  s.busy = true;
  s.fault = "";
  renderSheet();
  try {
    const r = await post("/api/flag", item);
    closeSheet();
    toast(r.picture ? "Flag added, with a picture of the slide." : "Flag added. No picture could be taken.");
    openFlagCount = (openFlagCount ?? 0) + 1;
    openFlagsList();
  } catch (err) {
    if (!err.status || err.status >= 500 || err.status === 401) {
      store.set("refrain.remote.queue", [...queued(), item]);
      closeSheet();
      toast("No connection. The flag is saved on this phone and will be added when it can.", "fault");
    } else {
      s.busy = false;
      s.fault = err.message;
      renderSheet();
    }
  }
}

// --- View flags --------------------------------------------------------------------------------------------
async function openFlagsList() {
  openSheet({ kind: "flags", list: null, err: "" });
  try {
    const d = await api("/api/flags");
    openFlagCount = d.flags.length;
    if (sheet?.kind === "flags") sheet.list = d.flags;
  } catch (err) {
    if (sheet?.kind === "flags") sheet.err = err.status ? err.message : "Can't reach the booth. Check the Wi-Fi.";
  }
  if (sheet?.kind === "flags") renderSheet();
  if (page === "service") $("view-flags") && ($("view-flags").textContent = viewFlagsLabel());
}
function flagsBody() {
  const s = sheet;
  const add = `<button class="send" data-act="add-flag" style="margin:0 0 4px;min-height:48px">Add flag</button>`;
  if (s.err) return `${add}<div class="err">${esc(s.err)}</div>`;
  if (!s.list) return `${add}<p class="note">Loading…</p>`;
  if (!s.list.length) return `${add}<div class="box" style="margin-top:12px"><b>No open flags.</b>Flags and notes added from any phone show here until they're resolved at the booth.</div>`;
  return `${add}<div class="sect"><span>Open · ${s.list.length}</span></div>${s.list
    .map(
      (f) => `<div class="fcard">
        ${f.picture ? `<div class="pic"><img data-flag-pic="${esc(f.id)}" alt="Picture of the flagged slide" /></div>` : `<div class="pic">No picture taken</div>`}
        <div style="margin-top:8px"><span class="tagc${f.type === "Note" ? " note" : ""}">${esc(f.type ?? "Flag")}</span><b>${esc(f.presentationName ?? "Untitled")}${f.slideNumber ? ` · slide ${f.slideNumber}` : ""}</b></div>
        ${f.note ? `<div style="margin-top:4px">${esc(f.note)}</div>` : ""}
        <div class="muted" style="margin-top:4px">${esc(f.by ?? "Someone")} · ${esc(ago(f.at))}</div></div>`
    )
    .join("")}`;
}
// Pictures need the phone's token, so they're fetched and shown from memory.
async function loadFlagPictures() {
  for (const img of document.querySelectorAll("[data-flag-pic]")) {
    if (img.src) continue;
    try {
      const res = await fetch(`/api/flag-picture/${encodeURIComponent(img.dataset.flagPic)}`, { headers: token ? { "x-refrain-device": token } : {} });
      if (res.ok) img.src = URL.createObjectURL(await res.blob());
      else img.parentElement.textContent = "No picture available";
    } catch {
      img.parentElement.textContent = "No picture available";
    }
  }
}

// --- Alert: a stage message, and messages with a blank to fill ----------------------------------------------------
async function openAlert() {
  openSheet({ kind: "alert", tab: sheet?.kind === "alert" ? sheet.tab : "stage", custom: "", vals: {}, stage: null, messages: null, err: "" });
  await loadAlertData();
}
async function loadAlertData() {
  if (!state?.phone?.canControl || sheet?.kind !== "alert") return;
  try {
    const [stage, msgs] = await Promise.all([api("/api/stage"), api("/api/messages").catch((err) => ({ messages: [], error: err.message }))]);
    if (sheet?.kind !== "alert") return;
    sheet.stage = stage;
    sheet.messages = msgs.messages;
    sheet.msgError = msgs.error ?? "";
  } catch (err) {
    if (sheet?.kind === "alert") sheet.err = err.status ? err.message : "Can't reach the booth. Check the Wi-Fi.";
  }
  // Not while someone is typing in the sheet: a repaint would take the cursor away.
  const typing = document.activeElement?.matches?.("textarea,input") && document.activeElement.closest(".sheet");
  if (sheet?.kind === "alert" && !typing) renderSheet();
}
function alertBody() {
  const s = sheet;
  if (!state) return `<p class="note">Loading…</p>`;
  if (!featureOn("messages")) return `<div class="box"><b>Alerts are switched off at the booth.</b></div>`;
  if (!state?.phone?.canControl) {
    return `<div class="box"><b>This phone can't send alerts yet.</b>${state?.pinRequired ? `Ask the person at the booth to press Allow alerts beside ${state?.phone?.name ? `“${esc(state.phone.name)}”` : "this phone"} in the Phone panel.` : "Alerts from a phone need phone PINs turned on at the booth."}</div>`;
  }
  const tabs = `<div class="seg" role="tablist"><button role="tab" data-act="alert-tab" data-tab="stage" aria-selected="${s.tab === "stage"}">Stage message</button><button role="tab" data-act="alert-tab" data-tab="vars" aria-selected="${s.tab === "vars"}">Variables</button></div>`;
  if (s.err) return `${tabs}<div class="err">${esc(s.err)}</div>`;
  if (s.tab === "stage") {
    const cur = s.stage?.current ?? "";
    const presets = s.stage?.presets ?? [];
    return `${tabs}
      <div class="sect"><span>Stage message</span></div>
      <p class="note" style="margin:0 0 8px">${cur ? `On stage now: <b style="color:var(--text)">${esc(cur)}</b>` : "Nothing on stage."}</p>
      <textarea class="f" id="custom-stage" maxlength="80" aria-label="Message for the stage" placeholder="Type a message for the stage" style="min-height:56px">${esc(s.custom)}</textarea>
      <button class="send ${armed?.key === "custom" ? "" : ""}" data-act="press" data-key="custom" ${s.custom.trim() ? "" : "disabled"} style="min-height:48px;margin-top:8px">${armed?.key === "custom" ? "Tap the banner to confirm" : "Send to stage"}</button>
      ${presets.length ? `<div class="sect"><span>Or a preset</span></div><div class="bank">${presets.map((p) => `<button class="key${armed?.key === `preset:${p.id}` ? " armed" : ""}${p.text === cur ? " on" : ""}" data-act="press" data-key="preset:${esc(p.id)}">${esc(p.text)}</button>`).join("")}</div>` : ""}
      <button class="key chip" style="width:100%;margin-top:8px" data-act="press" data-key="clear">Take down</button>
      <p class="note">Every press needs a second tap.</p>`;
  }
  if (s.msgError) return `${tabs}<div class="err">${esc(s.msgError)}</div>`;
  if (!s.messages) return `${tabs}<p class="note">Loading…</p>`;
  if (!s.messages.length) return `${tabs}<div class="box" style="margin-top:12px"><b>No message here has a blank to fill in.</b>Add a Text token to the message in ProPresenter, and it will show here with its name.</div>`;
  return `${tabs}${s.messages
    .map(
      (m) => `<div class="fcard" style="margin-top:12px"><b>${esc(m.name)}</b>${m.active ? ` <span class="muted">(on screen)</span>` : ""}
        ${m.fields.map((f) => `<div class="sect" style="margin:10px 0 4px"><span>${esc(f)}</span></div><input class="f" data-var-msg="${esc(m.id)}" data-var-field="${esc(f)}" maxlength="60" autocapitalize="characters" autocomplete="off" aria-label="${esc(m.name)}: ${esc(f)}" value="${esc(s.vals[m.id]?.[f] ?? "")}" style="text-transform:uppercase" />`).join("")}
        <div class="twin"><button class="send" data-act="press" data-key="msg:${esc(m.id)}" style="min-height:48px" ${m.fields.every((f) => (s.vals[m.id]?.[f] ?? "").trim()) ? "" : "disabled"}>${armed?.key === `msg:${m.id}` ? "Tap the banner" : "Show"}</button><button class="send quiet" data-act="press" data-key="msgclear:${esc(m.id)}" style="min-height:48px" ${m.active ? "" : "disabled"}>Take down</button></div></div>`
    )
    .join("")}<p class="note">Every press needs a second tap. These messages and their names are set at the booth.</p>`;
}
document.addEventListener("input", (e) => {
  if (sheet?.kind !== "alert") return;
  if (e.target.id === "custom-stage") {
    sheet.custom = e.target.value;
    const b = document.querySelector("[data-key='custom']");
    if (b) b.disabled = !sheet.custom.trim();
  } else if (e.target.dataset.varMsg) {
    const id = e.target.dataset.varMsg;
    e.target.value = e.target.value.toUpperCase();
    (sheet.vals[id] ??= {})[e.target.dataset.varField] = e.target.value;
    const box = e.target.closest(".fcard");
    const show = box?.querySelector("[data-act='press']");
    if (show) show.disabled = ![...box.querySelectorAll("[data-var-field]")].every((i) => i.value.trim());
  }
});
// The first tap asks the booth's Refrain what it will do and gets a one-time
// id; the second tap, within a few seconds, confirms it. The server enforces
// both steps, so no single tap (or request) can reach ProPresenter.
function bodyFor(key) {
  if (key === "custom") return { kind: "stage-custom", text: sheet.custom };
  if (key === "clear") return { kind: "stage-clear" };
  if (key.startsWith("preset:")) return { kind: "stage", presetId: key.slice(7) };
  if (key.startsWith("msgclear:")) return { kind: "message-clear", messageId: key.slice(9) };
  const id = key.slice(4);
  const m = sheet.messages?.find((x) => x.id === id);
  return { kind: "message", messageId: id, values: (m?.fields ?? []).map((f) => ({ name: f, text: sheet.vals[id]?.[f] ?? "" })) };
}
async function press(key) {
  if (armed?.key === key) return confirmArmed();
  disarm();
  try {
    const { confirmId, label } = await post("/api/control/prepare", bodyFor(key));
    armed = { key, confirmId, label, timer: setTimeout(disarm, 6000) };
    showArmed(`Tap to send: ${label}`);
    renderSheet();
  } catch (err) {
    toast(err.status ? err.message : "Can't reach the booth. Check the Wi-Fi.", "fault");
  }
}
async function confirmArmed() {
  const { confirmId, label, key } = armed;
  disarm();
  try {
    await post("/api/control/confirm", { confirmId });
    toast(`Done: ${label}.`);
    if (sheet?.kind === "alert") {
      if (key === "custom") sheet.custom = ""; // sent, so the box is empty for the next one
      await loadAlertData();
      renderSheet();
    }
  } catch (err) {
    toast(err.status ? err.message : "Can't reach the booth. Check the Wi-Fi.", "fault");
  }
}

// --- Going live: allow once a month, a request code, then a confirm ------------------------------------------------------
const FAIL_NET = "Can't reach the booth. Check the Wi-Fi.";
function allowBody() {
  const s = sheet;
  return `<p class="muted" style="margin:0 0 10px">Type this month's device code from the booth, in Settings › Phones. This phone can then go live until the end of ${esc(monthName())}, or until it signs in again.</p>
    <input class="f code-in" id="code" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="4" placeholder="Device code" aria-label="Device code" value="${esc(s.code ?? "")}" />
    ${s.err ? `<div class="err">${esc(s.err)}</div>` : ""}
    <button class="send" data-act="submit-allow" ${(s.code ?? "").length === 4 && !s.busy ? "" : "disabled"}>${s.busy ? "Checking…" : "Allow this phone"}</button>`;
}
function liveBody() {
  const s = sheet;
  const slide = `<div class="box" style="color:var(--text)">${esc(s.label)}<br><span style="color:var(--muted)">“${esc(s.text)}”</span></div>`;
  if (s.step === "confirm") {
    return `${s.replaces ? `<div class="sect"><span>On screen now</span></div><div class="box">${esc(s.replaces)}</div>` : ""}
      <div class="sect"><span>Replacing it with</span></div>${slide}
      <div class="warn"><b>Nothing has been sent yet.</b> Pressing the key below takes the screens and logs <b>${esc(state?.phone?.name ?? "this phone")}</b> at ${esc(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}.</div>
      ${s.err ? `<div class="err">${esc(s.err)}</div>` : ""}
      <button class="send go" data-act="live-confirm" ${s.busy ? "disabled" : ""}>${s.busy ? "Taking over…" : "Take over the screen"}</button>
      <button class="send quiet" data-act="close-sheet">Not now</button>`;
  }
  return `${slide}
    <div class="warn"><b>This takes over the screens.</b> It replaces <b>${esc(s.replaces ?? "what is up now")}</b> straight away, even if someone at the booth is using it. The booth is told, and the log records <b>${esc(state?.phone?.name ?? "this phone")}</b>.</div>
    <div class="sect"><span>Type this code to approve</span></div><div class="big-code" aria-label="Request code">${esc(s.code)}</div>
    <input class="f code-in" id="typed" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="4" placeholder="Type the code above" aria-label="Type the code above" value="${esc(s.typed ?? "")}" ${s.locked ? "disabled" : ""} />
    ${s.err ? `<div class="err">${esc(s.err)}</div>` : ""}
    <button class="send" data-act="live-approve" ${(s.typed ?? "").length === 4 && !s.busy && !s.locked && !s.expired ? "" : "disabled"}>${s.busy ? "Checking…" : "Approve"}</button>`;
}
document.addEventListener("input", (e) => {
  if (e.target.id === "code" && sheet?.kind === "allow") {
    sheet.code = e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
    sheet.err = "";
    document.querySelector("[data-act='submit-allow']").disabled = sheet.code.length !== 4;
  } else if (e.target.id === "typed" && sheet?.kind === "live") {
    sheet.typed = e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
    sheet.err = "";
    document.querySelector("[data-act='live-approve']").disabled = sheet.typed.length !== 4 || sheet.locked || sheet.expired;
  }
});
async function submitAllow() {
  const s = sheet;
  s.busy = true;
  renderSheet();
  try {
    const r = await post("/api/golive/allow", { code: s.code });
    glive = { ...glive, enabled: true, allowed: true, until: r.until };
    closeSheet();
    paintPage();
    toast(`This phone can go live until the end of ${monthName()}, or until it signs in again.`);
  } catch (err) {
    s.busy = false;
    s.code = "";
    s.err = err.status ? err.message : FAIL_NET;
    renderSheet();
  }
}
async function startLive(r) {
  openSheet({ kind: "live", step: "code", label: `${r.presentationName ?? "Untitled"}, slide ${r.slideNumber}`, text: r.text, code: "…", typed: "", busy: true, err: "" });
  try {
    const out = await post("/api/golive/request", { presentationId: r.presentationId, slideIndex: r.slideIndex });
    if (sheet?.kind !== "live") return;
    Object.assign(sheet, { requestId: out.requestId, code: out.code, replaces: out.replaces, label: out.label, busy: false });
  } catch (err) {
    if (sheet?.kind !== "live") return;
    Object.assign(sheet, { busy: false, expired: true, code: "—", err: err.status ? err.message : FAIL_NET });
    if (err.data?.needsCode) { glive.allowed = false; }
  }
  renderSheet();
}
async function liveApprove() {
  const s = sheet;
  s.busy = true;
  renderSheet();
  try {
    const out = await post("/api/golive/approve", { requestId: s.requestId, code: s.typed });
    Object.assign(s, { step: "confirm", confirmId: out.confirmId, replaces: out.replaces, label: out.label, busy: false, err: "" });
  } catch (err) {
    s.busy = false;
    s.typed = "";
    s.err = err.status ? err.message : FAIL_NET;
    if (err.data?.code) s.code = err.data.code; // a wrong code gets a fresh one
    if (err.status === 429) s.locked = true;
    if (err.status === 409) s.expired = true;
  }
  renderSheet();
}
async function liveConfirm() {
  const s = sheet;
  s.busy = true;
  s.err = "";
  renderSheet();
  try {
    await post("/api/golive/confirm", { confirmId: s.confirmId });
    closeSheet();
    toast(`Live. The booth has been told: ${state?.phone?.name ?? "this phone"}.`);
    refresh();
  } catch (err) {
    s.busy = false;
    s.err = err.status ? err.message : FAIL_NET;
    renderSheet();
  }
}

// --- one place for taps -------------------------------------------------------------------------------------
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) {
    if (armed && !e.target.closest("#banner")) disarm();
    return;
  }
  const act = el.dataset.act;
  if (act === "add-flag") openFlag();
  else if (act === "view-flags") openFlagsList();
  else if (act === "flag-result") { const r = search.results[Number(el.dataset.i)]; if (r) openFlag(r); }
  else if (act === "flag-screen") backToScreen();
  else if (act === "pick-slide") { sheet.sel = { presentationId: sheet.slides.presentationId, slideIndex: Number(el.dataset.idx) }; renderSheet(); }
  else if (act === "all-slides") { sheet.all = !sheet.all; renderSheet(); }
  else if (act === "pick-type") { sheet.type = sheet.type === el.dataset.type ? null : el.dataset.type; renderSheet(); }
  else if (act === "add-flag-now") addFlagNow();
  else if (act === "alert-tab") { disarm(); sheet.tab = el.dataset.tab; renderSheet(); }
  else if (act === "press") press(el.dataset.key);
  else if (act === "allow") openSheet({ kind: "allow", code: "", busy: false, err: "" });
  else if (act === "submit-allow") submitAllow();
  else if (act === "go-live") { const r = search.results[Number(el.dataset.i)]; if (r) startLive(r); }
  else if (act === "live-approve") liveApprove();
  else if (act === "live-confirm") liveConfirm();
  else if (act === "forget") { store.del("refrain.remote.token"); token = ""; location.reload(); }
});

// --- keeping up -------------------------------------------------------------------------------------------------------
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    state = await api("/api/state");
    paintLamp();
    if (page === "service") paintReadout();
    try { glive = await api("/api/golive/status"); } catch { /* keep what was shown */ }
    if (page === "search") { paintLiveBar(); if (search.done) paintResults(); }
    if (page === "history") {
      try { history = { items: (await api("/api/history")).items, at: Date.now(), loaded: true }; if (!sheet) paintHistoryPage(); } catch { /* keep what was shown */ }
    }
    if (page === "service" && featureOn("flags") && !sheet) {
      try { openFlagCount = (await api("/api/flags")).flags.length; $("view-flags") && ($("view-flags").textContent = viewFlagsLabel()); } catch { /* keep the count */ }
    }
    // Flags switched off at the booth: queued flags wait on the phone for it to
    // come back on, rather than being refused and dropped.
    if (featureOn("flags")) flush();
  } catch (err) {
    if (err.status !== 401) { $("link-lamp").className = "lamp off"; if (page === "service") $("readout") && ($("readout").innerHTML = `<div class="glass"><div class="ph off">No link</div><div class="ph-sub">Can't reach the booth. Retrying</div></div>`); }
  } finally {
    refreshing = false;
  }
}
let timer = null;
function start() {
  paintPage();
  refresh().then(() => { if (page === "service") paintPage(); });
  clearInterval(timer);
  timer = setInterval(refresh, 3000);
}
$("app").hidden = false;
start();
