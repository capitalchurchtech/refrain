// The phone page for flagging a slide (issue #8). See server/remote.js for
// the boundary: this page can read what's live and add a flag, nothing more.
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
};

let state = null;
let chosenRef = null;
let chosenType = null;
let token = store.get("refrain.remote.token", "");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
const dur = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = String(t % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`; };

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(token ? { "x-refrain-device": token } : {}) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.locked) showLock();
  if (!res.ok) { const e = new Error(data.error || res.statusText); e.status = res.status; throw e; }
  return data;
}

// --- the PIN -----------------------------------------------------------------
// Where to find it comes from the booth (networkModule.pinHint). A correct
// PIN earns this phone a token: until midnight, or 30 days if trusted.
async function showLock() {
  if (!$("lock").hidden) return; // already asking; don't steal the cursor every refresh
  $("main").hidden = true;
  $("lock").hidden = false;
  try {
    const lock = await (await fetch("/api/lock")).json();
    $("lock-hint").textContent = lock.hint ?? "";
    $("pin").previousElementSibling.textContent = lock.daily ? "Today's PIN" : "PIN";
  } catch { /* the hint is a courtesy */ }
  $("pin").focus();
}

$("unlock").addEventListener("click", async () => {
  $("unlock").disabled = true;
  try {
    store.set("refrain.remote.name", $("lock-name").value);
    $("name").value = $("lock-name").value;
    const res = await fetch("/api/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: $("pin").value, trust: $("trust").checked, name: $("lock-name").value }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    token = data.token ?? "";
    store.set("refrain.remote.token", token);
    $("lock").hidden = true;
    $("main").hidden = false;
    $("pin").value = "";
    refresh();
  } catch (err) {
    $("lock-status").textContent = err.message;
    $("lock-status").className = "status fault";
  } finally {
    $("unlock").disabled = false;
  }
});
$("pin").addEventListener("keydown", (e) => { if (e.key === "Enter") $("unlock").click(); });

function paintProgress(p) {
  const el = $("progress");
  if (!state.connected) { el.textContent = "The booth can't see ProPresenter right now."; return; }
  if (!p?.item) { el.textContent = "Nothing is on the screens."; return; }
  el.innerHTML = [
    `<span><b>${esc(p.item.name)}</b></span>`,
    p.item.position ? `<span>${p.item.position} of ${p.item.of}</span>` : "",
    `<span>up ${dur(p.item.upForMs)}</span>`,
    p.service ? `<span class="muted">${esc(p.service.name)} · ${dur(p.service.runningMs)}</span>` : "",
  ].join("");
}

function paintSlides() {
  const recent = state.recent ?? [];
  if (!recent.find((r) => r.ref === chosenRef)) chosenRef = recent[0]?.ref ?? null;
  $("slides").innerHTML = recent.length
    ? recent
        .map((r, i) => `<button class="slide" data-ref="${esc(r.ref)}" aria-pressed="${r.ref === chosenRef}"><small>${i === 0 && state.live ? "On screen now" : `Up at ${clock(r.at)}`} · ${esc(r.presentationName ?? "")}, slide ${r.slideNumber}</small>${esc((r.text ?? "").slice(0, 140)) || "<i>No text on this slide</i>"}</button>`)
        .join("")
    : `<div class="muted">Nothing has been on the screens yet.</div>`;
  $("slides").querySelectorAll(".slide").forEach((b) => b.addEventListener("click", () => { chosenRef = b.dataset.ref; paintSlides(); ready(); }));
}

function paintTypes() {
  $("types").innerHTML = (state.types ?? []).map((t) => `<button class="type" data-type="${esc(t)}" aria-pressed="${t === chosenType}">${esc(t)}</button>`).join("");
  $("types").querySelectorAll(".type").forEach((b) => b.addEventListener("click", () => { chosenType = chosenType === b.dataset.type ? null : b.dataset.type; paintTypes(); ready(); }));
}

function ready() {
  $("send").disabled = !chosenRef;
}

function say(text, fault = false) {
  $("status").textContent = text;
  $("status").className = `status${fault ? " fault" : ""}`;
}

// --- the queue ---------------------------------------------------------------
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
        await api("/api/flag", { method: "POST", body: JSON.stringify(item) });
        dropFromQueue(item.id);
        sent++;
      } catch (err) {
        // Refused for good (not in the index any more, say): say so, with
        // the note, so it isn't lost silently. Network trouble or a lock:
        // keep it for the next try.
        if (err.status && err.status < 500 && err.status !== 429 && err.status !== 401) {
          dropFromQueue(item.id);
          say(`A waiting flag couldn't be sent (${err.message})${item.note ? `. Its note was: "${item.note}"` : ""}`, true);
        } else break;
      }
    }
  } finally {
    flushing = false;
  }
  const left = queued().length;
  if (left) say(`${left} flag${left === 1 ? "" : "s"} waiting to send. Refrain will keep trying.`, true);
  else if (sent) say("Waiting flags sent.");
}

$("send").addEventListener("click", async () => {
  const r = (state?.recent ?? []).find((x) => x.ref === chosenRef);
  // The slide it means travels with it, so a flag that waits (no signal)
  // still lands on the right slide after its entry has left the list.
  const item = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    ref: chosenRef,
    slide: r ? { presentationId: r.presentationId, slideIndex: r.slideIndex, at: r.at } : null,
    type: chosenType,
    note: $("note").value,
    name: $("name").value,
  };
  store.set("refrain.remote.name", item.name);
  $("send").disabled = true;
  try {
    await api("/api/flag", { method: "POST", body: JSON.stringify(item) });
    say("Sent to the booth. Thank you.");
    $("note").value = "";
    chosenType = null;
    paintTypes();
  } catch (err) {
    if (!err.status || err.status >= 500 || err.status === 401) {
      store.set("refrain.remote.queue", [...queued(), item]);
      say("No connection. The flag is saved on this phone and will send when it can.", true);
    } else {
      say(err.message, true);
    }
  } finally {
    ready();
  }
});

async function refresh() {
  try {
    state = await api("/api/state");
    paintProgress(state.progress);
    paintSlides();
    if (!$("types").childElementCount) paintTypes();
    ready();
    flush();
    paintPreview();
    paintControl();
  } catch (err) {
    if (err.status !== 401) $("progress").textContent = "Can't reach the booth right now. Retrying.";
  }
}

// --- preview: the current slide and the next -------------------------------
let previewKey = "";
async function paintPreview() {
  try {
    const p = await api("/api/preview");
    const key = JSON.stringify([p.current?.image, p.next?.image, p.atEnd]);
    if (key === previewKey) return;
    previewKey = key;
    const pane = (s, empty) => (s?.image ? `<img src="${esc(s.image)}" alt="${esc(s.text ?? "")}" />` : esc(empty));
    // Images go through fetch so they carry this phone's sign-in.
    $("pv-now").innerHTML = pane(p.current, "Nothing on screen");
    $("pv-next").innerHTML = pane(p.next, p.atEnd ? "End of this presentation" : "");
    for (const img of document.querySelectorAll(".pv img")) loadImage(img);
  } catch { /* the readout says if the booth is away */ }
}
async function loadImage(img) {
  const src = img.getAttribute("src");
  img.removeAttribute("src");
  try {
    const res = await fetch(src, { headers: token ? { "x-refrain-device": token } : {} });
    if (res.ok) img.src = URL.createObjectURL(await res.blob());
  } catch { /* leave it blank */ }
}

// --- tabs ---------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    for (const name of ["flag", "search", "control"]) $(`tab-${name}`).hidden = name !== t.dataset.tab;
    if (t.dataset.tab === "search") $("q").focus();
  })
);

// --- search: read-only --------------------------------------------------------
let searchTimer = null;
$("q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = $("q").value.trim();
    if (!q) return ($("search-results").innerHTML = "");
    try {
      const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
      $("search-results").innerHTML = results.length
        ? results.map((r) => `<div class="slide"><small>${esc(r.presentationName)}, slide ${r.slideNumber}</small>${esc((r.text ?? "").slice(0, 160))}</div>`).join("")
        : `<div class="muted">No matches.</div>`;
    } catch (err) {
      $("search-results").innerHTML = `<div class="muted">${esc(err.message)}</div>`;
    }
  }, 250);
});

// --- control: approved phones, two presses ------------------------------------
// The first tap asks the booth's Refrain what it will do and gets a one-time
// id; the second tap, within a few seconds, confirms it. The server enforces
// both steps, so no single tap (or request) can take over ProPresenter.
let armed = null; // { el, confirmId, label, timer }
function disarm() {
  if (!armed) return;
  clearTimeout(armed.timer);
  armed.el.classList.remove("armed");
  armed.el.textContent = armed.idle;
  armed = null;
}
async function press(el, body) {
  const status = $("control-status");
  if (armed && armed.el === el) {
    const { confirmId, label } = armed;
    disarm();
    try {
      await api("/api/control/confirm", { method: "POST", body: JSON.stringify({ confirmId }) });
      status.textContent = `Done: ${label}.`;
      status.className = "status";
      previewKey = "";
      setTimeout(paintPreview, 600);
    } catch (err) {
      status.textContent = err.message;
      status.className = "status fault";
    }
    return;
  }
  disarm();
  try {
    const { confirmId, label } = await api("/api/control/prepare", { method: "POST", body: JSON.stringify(body) });
    armed = { el, confirmId, label, idle: el.textContent, timer: setTimeout(disarm, 5000) };
    el.classList.add("armed");
    el.textContent = `Tap again: ${label}`;
  } catch (err) {
    status.textContent = err.message;
    status.className = "status fault";
  }
}
document.querySelectorAll(".ctl").forEach((b) => b.addEventListener("click", () => press(b, { kind: b.dataset.kind })));

let safeKey = "";
async function paintControl() {
  const can = Boolean(state?.phone?.canControl);
  $("control").hidden = !can;
  $("control-locked").textContent = can
    ? ""
    : state?.pinRequired
      ? `Control isn't on for this phone. Ask the booth to press "Allow control" beside ${state?.phone?.name ? `"${state.phone.name}"` : "this phone"} in the Phone panel.`
      : "Control from a phone needs phone PINs turned on in the booth.";
  if (!can) return;
  try {
    const { safeSlides } = await api("/api/safe-slides");
    const key = JSON.stringify(safeSlides);
    if (key === safeKey) return;
    safeKey = key;
    $("safe").innerHTML = safeSlides.length
      ? safeSlides.map((sl) => `<button class="slide" data-safe="${esc(sl.id)}">${esc(sl.label)}</button>`).join("")
      : `<div class="muted">No safe slides yet. The booth adds them from Search.</div>`;
    $("safe").querySelectorAll("[data-safe]").forEach((b) => b.addEventListener("click", () => press(b, { kind: "safe", safeId: b.dataset.safe })));
  } catch { /* keep the last list */ }
}

$("lock-name").value = store.get("refrain.remote.name", "");
$("name").value = store.get("refrain.remote.name", "");
refresh();
setInterval(refresh, 3000);
