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
let pin = store.get("refrain.remote.pin", "");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
const dur = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = String(t % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`; };

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(pin ? { "x-refrain-pin": pin } : {}) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    const entered = prompt("This Refrain needs a PIN. Ask the booth for it.");
    if (entered) { pin = entered.trim(); store.set("refrain.remote.pin", pin); return api(path, opts); }
  }
  if (!res.ok) { const e = new Error(data.error || res.statusText); e.status = res.status; throw e; }
  return data;
}

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
const queued = () => store.get("refrain.remote.queue", []);
async function flush() {
  const q = queued();
  if (!q.length) return;
  const left = [];
  for (const item of q) {
    try {
      await api("/api/flag", { method: "POST", body: JSON.stringify(item) });
    } catch (err) {
      // Refused for good (the slide aged out, bad type): say so and drop it.
      // Network trouble: keep it for the next try.
      if (err.status && err.status < 500 && err.status !== 429) say(`A waiting flag couldn't be sent: ${err.message}`, true);
      else left.push(item);
    }
  }
  store.set("refrain.remote.queue", left);
  if (!left.length && q.length) say("Waiting flags sent.");
  else if (left.length) say(`${left.length} flag${left.length === 1 ? "" : "s"} waiting to send. Refrain will keep trying.`, true);
}

$("send").addEventListener("click", async () => {
  const item = { ref: chosenRef, type: chosenType, note: $("note").value, name: $("name").value };
  store.set("refrain.remote.name", item.name);
  $("send").disabled = true;
  try {
    await api("/api/flag", { method: "POST", body: JSON.stringify(item) });
    say("Sent to the booth. Thank you.");
    $("note").value = "";
    chosenType = null;
    paintTypes();
  } catch (err) {
    if (!err.status || err.status >= 500) {
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
  } catch {
    $("progress").textContent = "Can't reach the booth right now. Retrying.";
  }
}

$("name").value = store.get("refrain.remote.name", "");
refresh();
setInterval(refresh, 3000);
