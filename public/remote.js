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
    const res = await fetch("/api/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: $("pin").value, trust: $("trust").checked }) });
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
  } catch (err) {
    if (err.status !== 401) $("progress").textContent = "Can't reach the booth right now. Retrying.";
  }
}

$("name").value = store.get("refrain.remote.name", "");
refresh();
setInterval(refresh, 3000);
