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
let chosenType = null;
let token = store.get("refrain.remote.token", "");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
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
  // No automatic focus: on a phone it opens the keyboard and Safari zooms in
  // on the box before anyone has read the page.
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
  if (!state.connected) { el.textContent = "The booth has lost ProPresenter."; return; }
  if (!p?.item) { el.textContent = "Nothing is on the screens."; return; }
  el.innerHTML = [
    `<span><b>${esc(p.item.name)}</b></span>`,
    p.item.position ? `<span>${p.item.position} of ${p.item.of}</span>` : "",
    `<span>up ${dur(p.item.upForMs)}</span>`,
    p.service ? `<span class="muted">${esc(p.service.name)} · ${dur(p.service.runningMs)}</span>` : "",
  ].join("");
}

// The Flag tab's slides: previous, current and next of the presentation on
// screen, and every slide in a tray (owner request). What's chosen is a slide
// of that presentation, sent with the flag; the server checks it against the
// index before saving.
let flagSlides = null;
let chosenSlide = null; // { presentationId, slideIndex }
let slidesKey = "";
// A picture only where the booth has opened pictures for phones; otherwise words only.
const pvHtml = (sl) => (sl.image ? `<div class="pv"><img data-src="${esc(sl.image)}" alt="" /></div>` : "");
const slideCard = (sl, caption) => `
  <button class="slide${chosenSlide && chosenSlide.slideIndex === sl.slideIndex ? " picked" : ""}" data-idx="${sl.slideIndex}" aria-pressed="${Boolean(chosenSlide && chosenSlide.slideIndex === sl.slideIndex)}">
    <div class="thumb${sl.image ? "" : " nopic"}">${pvHtml(sl)}
    <div><small>${esc(caption)} · slide ${sl.slideNumber}</small>${esc((sl.text ?? "").slice(0, 90)) || "<i>No words on this slide</i>"}</div></div>
  </button>`;

async function paintSlides() {
  try {
    flagSlides = await api("/api/flag-slides");
  } catch {
    return;
  }
  const d = flagSlides;
  if (!d.presentationId) {
    chosenSlide = null;
    slidesKey = "";
    $("slides").innerHTML = `<div class="muted">Nothing is on the screens.</div>`;
    $("open-tray").hidden = true;
    return ready();
  }
  // A new slide on screen moves the pick to it, unless the person already
  // chose one in this presentation.
  if (!chosenSlide || chosenSlide.presentationId !== d.presentationId) chosenSlide = { presentationId: d.presentationId, slideIndex: d.currentIndex };
  const key = JSON.stringify([d.presentationId, d.currentIndex, chosenSlide.slideIndex]);
  if (key === slidesKey) return;
  slidesKey = key;
  const at = (i) => d.slides.find((x) => x.slideIndex === i);
  const cards = [
    [at(d.currentIndex - 1), "Previous"],
    [at(d.currentIndex), "On screen"],
    [at(d.currentIndex + 1), "Next"],
  ].filter(([sl]) => sl);
  // A pick from the tray that isn't one of the three is shown too, so it's
  // clear what will be flagged.
  if (![d.currentIndex - 1, d.currentIndex, d.currentIndex + 1].includes(chosenSlide.slideIndex) && at(chosenSlide.slideIndex)) {
    cards.unshift([at(chosenSlide.slideIndex), "Chosen"]);
  }
  $("slides").innerHTML = cards.map(([sl, cap]) => slideCard(sl, cap)).join("");
  $("slides").querySelectorAll("[data-idx]").forEach((b) => b.addEventListener("click", () => pick(Number(b.dataset.idx))));
  for (const img of $("slides").querySelectorAll("img")) loadImage(img);
  $("open-tray").hidden = false;
  $("open-tray").textContent = `Show all ${d.slides.length} previews`;
  ready();
}

function pick(idx) {
  chosenSlide = { presentationId: flagSlides.presentationId, slideIndex: idx };
  slidesKey = "";
  paintSlides();
  // Next step is what's wrong with it.
  $("types").scrollIntoView({ behavior: "smooth", block: "center" });
}

// The tray: every slide's picture, loaded as it scrolls into view so opening
// it doesn't ask ProPresenter for thirty pictures at once.
let trayObserver = null;
$("open-tray").addEventListener("click", () => {
  const d = flagSlides;
  if (!d?.presentationId) return;
  $("tray-title").textContent = d.presentationName ?? "All slides";
  $("tray-grid").innerHTML = d.slides
    .map((sl) => `<button class="slide" data-idx="${sl.slideIndex}">${pvHtml(sl)}<small>Slide ${sl.slideNumber}${sl.slideIndex === d.currentIndex ? " · on screen" : ""}</small>${sl.image ? "" : esc((sl.text ?? "").slice(0, 90)) || "<i>No words on this slide</i>"}</button>`)
    .join("");
  trayObserver?.disconnect();
  trayObserver = new IntersectionObserver((entries) => {
    // Stop watching a picture only once it's in: one the booth refused
    // (busy, or too many at once) is tried again when it scrolls back.
    for (const e of entries) {
      if (!e.isIntersecting || e.target.dataset.loading) continue;
      e.target.dataset.loading = "1";
      loadImage(e.target).then((ok) => {
        delete e.target.dataset.loading;
        if (ok) trayObserver?.unobserve(e.target);
      });
    }
  }, { root: $("tray-grid"), rootMargin: "200px" });
  $("tray-grid").querySelectorAll("img").forEach((img) => trayObserver.observe(img));
  $("tray-grid").querySelectorAll("[data-idx]").forEach((b) =>
    b.addEventListener("click", () => {
      pick(Number(b.dataset.idx));
      $("tray").hidden = true;
    })
  );
  $("tray").hidden = false;
});
$("close-tray").addEventListener("click", () => ($("tray").hidden = true));

function paintTypes() {
  $("types").innerHTML = (state.types ?? []).map((t) => `<button class="type" data-type="${esc(t)}" aria-pressed="${t === chosenType}">${esc(t)}</button>`).join("");
  $("types").querySelectorAll(".type").forEach((b) => b.addEventListener("click", () => { chosenType = chosenType === b.dataset.type ? null : b.dataset.type; paintTypes(); ready(); }));
}

function ready() {
  $("send").disabled = !chosenSlide;
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
  if (left) say(`${left} flag${left === 1 ? "" : "s"} waiting to send. Retrying.`, true);
  else if (sent) say("Waiting flags sent.");
}

$("send").addEventListener("click", async () => {
  // The slide it means travels with it, so a flag that waits (no signal)
  // still lands on the right slide; the server checks it against the index.
  const item = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    ref: null,
    slide: chosenSlide ? { ...chosenSlide, at: new Date().toISOString() } : null,
    type: chosenType,
    note: $("note").value,
    name: $("name").value,
  };
  store.set("refrain.remote.name", item.name);
  $("send").disabled = true;
  try {
    await api("/api/flag", { method: "POST", body: JSON.stringify(item) });
    // The slide that was flagged, not only a sentence, so it's plain which one.
    const sl = flagSlides?.slides?.find((x) => x.slideIndex === item.slide?.slideIndex);
    $("status").className = "status";
    $("status").innerHTML = sl
      ? `<div class="sent">${pvHtml(sl)}<div>Sent to the booth: slide ${sl.slideNumber}.</div></div>`
      : "Sent to the booth.";
    $("status").querySelectorAll("img").forEach((img) => loadImage(img));
    $("note").value = "";
    chosenType = null;
    paintTypes();
  } catch (err) {
    if (!err.status || err.status >= 500 || err.status === 401) {
      store.set("refrain.remote.queue", [...queued(), item]);
      say("No connection. Saved on this phone; it will send when it can.", true);
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
    paintTabs(state.features);
    paintProgress(state.progress);
    paintSlides();
    if (!$("types").childElementCount) paintTypes();
    ready();
    // Flags switched off at the booth: queued flags wait on the phone for it
    // to come back on, rather than being refused and dropped.
    if (state.features?.flags !== false) flush();
    paintControl();
  } catch (err) {
    if (err.status !== 401) $("progress").textContent = "Can't reach the booth. Retrying.";
  }
}

/** True once the picture is in; false leaves it blank for a later try. */
async function loadImage(img) {
  const src = img.dataset.src;
  try {
    const res = await fetch(src, { headers: token ? { "x-refrain-device": token } : {} });
    if (!res.ok) return false;
    img.src = URL.createObjectURL(await res.blob());
    return true;
  } catch {
    return false;
  }
}

// The banner confirms too: it's the biggest target on the screen.
$("confirm").addEventListener("click", () => armed?.el.click());

// --- which tabs: what the booth has switched on (Settings › Features) -----
// Flag needs Flags; Alert needs Messages. A tab that's off isn't shown; if
// the shown tab goes, the other is shown; with neither, the page says so.
function paintTabs(f) {
  const on = { flag: f?.flags !== false, alert: f?.messages !== false };
  const tabs = [...document.querySelectorAll(".tab")];
  tabs.forEach((t) => (t.hidden = !on[t.dataset.tab]));
  const shown = tabs.find((t) => t.getAttribute("aria-selected") === "true");
  if (shown && !on[shown.dataset.tab]) {
    const other = tabs.find((t) => on[t.dataset.tab]);
    if (other) other.click();
  }
  // Every refresh says which panel shows, so one switched back on at the
  // booth reappears without a reload.
  const selected = tabs.find((t) => t.getAttribute("aria-selected") === "true")?.dataset.tab;
  for (const name of ["flag", "alert"]) $(`tab-${name}`).hidden = !(on[name] && name === selected);
  document.querySelector(".tabs").hidden = !(on.flag && on.alert);
  $("nothing-here").hidden = on.flag || on.alert;
}

// --- tabs ---------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    for (const name of ["flag", "alert"]) $(`tab-${name}`).hidden = name !== t.dataset.tab;
    disarm(); // nothing stays armed on a tab you can't see
  })
);

// --- alerts: approved phones, two presses ---------------------------------------
// The first tap asks the booth's Refrain what it will do and gets a one-time
// id; the second tap, within a few seconds, confirms it. The server enforces
// both steps, so no single tap (or request) can reach ProPresenter.
let armed = null; // { el, confirmId, label, idle, timer }
function disarm() {
  if (!armed) return;
  clearTimeout(armed.timer);
  armed.el.classList.remove("armed");
  armed.el.textContent = armed.idle;
  armed = null;
  $("confirm").hidden = true;
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
      stageKey = "";
      paintStage();
      if ($("msgs").open && el.closest("#msgs")) setTimeout(paintMessages, 800);
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
    $("confirm-text").textContent = `Tap again: ${label}`;
    $("confirm").hidden = false;
  } catch (err) {
    status.textContent = err.message;
    status.className = "status fault";
  }
}
// The banner confirms too: it's the biggest target on the screen.
$("confirm").addEventListener("click", () => armed?.el.click());

function paintControl() {
  const can = Boolean(state?.phone?.canControl);
  $("control").hidden = !can;
  $("control-locked").textContent = can
    ? ""
    : state?.pinRequired
      ? `Alerts are off for this phone. Ask the booth to allow ${state?.phone?.name ? `"${state.phone.name}"` : "this phone"} in the Phone panel.`
      : "Alerts from a phone need phone PINs turned on in the booth.";
  if (can) paintStage();
}

// --- stage message (handoff section 44) ---------------------------------------
// Presets only, two taps. What the booth last saw on stage is shown, latched.
// Take down is always there: the booth may not know about a message put up
// in ProPresenter itself, and taking down nothing is harmless.
let stageKey = "";
async function paintStage() {
  let data;
  try {
    data = await api("/api/stage");
  } catch {
    return; // keep what's shown
  }
  const key = JSON.stringify(data);
  if (key === stageKey || armed?.el?.closest?.("#stage")) return;
  stageKey = key;
  const { presets = [], current = "" } = data;
  $("stage-now").textContent = current ? `On stage now: "${current}"` : "Nothing on stage.";
  $("stage-keys").innerHTML = presets
    .map((p) => `<button class="ctl${p.text === current ? " on" : ""}" data-preset="${esc(p.id)}" aria-pressed="${p.text === current}">${esc(p.text)}</button>`)
    .join("");
  $("stage-keys").querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => press(b, { kind: "stage", presetId: b.dataset.preset })));
}
$("stage-clear").addEventListener("click", () => press($("stage-clear"), { kind: "stage-clear" }));

// --- messages with a field to fill (a pager code) ------------------------------
// Loaded when the section is opened, and again after a press. Values are
// upper-cased; the last few used are taps that fill the field, never post.
// What's been typed survives a repaint, so taking down one message doesn't
// wipe a code half-typed into another.
async function paintMessages() {
  const list = $("msg-list");
  const typed = new Map([...list.querySelectorAll("[data-msg] input[data-field]")].map((i) => [`${i.closest("[data-msg]").dataset.msg}\u0000${i.dataset.field}`, i.value]));
  let messages;
  try {
    ({ messages } = await api("/api/messages"));
  } catch (err) {
    list.innerHTML = `<div class="status fault">${esc(err.message)}</div>`;
    return;
  }
  if (!messages.length) {
    list.innerHTML = `<div class="muted">No message here has a field to fill in. Add a Text token to the message in ProPresenter.</div>`;
    return;
  }
  list.innerHTML = messages
    .map(
      (m) => `<div class="msg" data-msg="${esc(m.id)}">
        <div class="msg-name">${esc(m.name)}${m.active ? ` <span class="muted">(on screen)</span>` : ""}</div>
        ${m.fields
          .map(
            (f) => `<label>${esc(f)}</label><input data-field="${esc(f)}" maxlength="60" autocapitalize="characters" autocomplete="off" value="${esc(typed.get(`${m.id}\u0000${f}`) ?? "")}" />`
          )
          .join("")}
        <div class="msg-keys">
          <button class="ctl" data-post>Show</button>
          <button class="ctl" data-take ${m.active ? "" : "disabled"}>Take down</button>
        </div>
      </div>`
    )
    .join("");
  list.querySelectorAll("[data-msg]").forEach((box) => {
    const id = box.dataset.msg;
    box.querySelectorAll("input").forEach((i) => i.addEventListener("input", () => (i.value = i.value.toUpperCase())));
    const values = () => [...box.querySelectorAll("input[data-field]")].map((i) => ({ name: i.dataset.field, text: i.value }));
    box.querySelector("[data-post]").addEventListener("click", (e) => press(e.currentTarget, { kind: "message", messageId: id, values: values() }));
    box.querySelector("[data-take]").addEventListener("click", (e) => press(e.currentTarget, { kind: "message-clear", messageId: id }));
  });
}
$("msgs").addEventListener("toggle", () => {
  if ($("msgs").open) paintMessages();
});

$("lock-name").value = store.get("refrain.remote.name", "");
$("name").value = store.get("refrain.remote.name", "");
refresh();
setInterval(refresh, 3000);
