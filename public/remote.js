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
const slideCard = (sl, caption) => `
  <button class="slide${chosenSlide && chosenSlide.slideIndex === sl.slideIndex ? " picked" : ""}" data-idx="${sl.slideIndex}" aria-pressed="${Boolean(chosenSlide && chosenSlide.slideIndex === sl.slideIndex)}">
    <div class="thumb"><div class="pv"><img data-src="${esc(sl.image)}" alt="" /></div>
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
    .map((sl) => `<button class="slide" data-idx="${sl.slideIndex}"><div class="pv"><img data-src="${esc(sl.image)}" alt="" /></div><small>Slide ${sl.slideNumber}${sl.slideIndex === d.currentIndex ? " · on screen" : ""}</small></button>`)
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
      ? `<div class="sent"><div class="pv"><img data-src="${esc(sl.image)}" alt="" /></div><div>Sent to the booth: slide ${sl.slideNumber}.</div></div>`
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
    paintProgress(state.progress);
    paintSlides();
    if (!$("types").childElementCount) paintTypes();
    ready();
    flush();
    paintPreview();
    paintControl();
  } catch (err) {
    if (err.status !== 401) $("progress").textContent = "Can't reach the booth. Retrying.";
  }
}

// --- preview: the current slide and the next -------------------------------
let previewKey = "";
let nextImage = null; // the Next preview's picture, for the confirm step
async function paintPreview() {
  try {
    const p = await api("/api/preview");
    const key = JSON.stringify([p.current?.image, p.next?.image, p.atEnd]);
    if (key === previewKey) return;
    previewKey = key;
    // data-src, not src: a src in the markup would start a request without
    // this phone's sign-in before loadImage could take it back.
    const pane = (s, empty) => (s?.image ? `<img data-src="${esc(s.image)}" alt="${esc(s.text ?? "")}" />` : esc(empty));
    // Images go through fetch so they carry this phone's sign-in.
    $("pv-now").innerHTML = pane(p.current, "Nothing on screen");
    $("pv-next").innerHTML = pane(p.next, p.atEnd ? "End of this presentation" : "");
    for (const img of document.querySelectorAll(".pv img")) loadImage(img);
    $("pv-next").classList.toggle("can-step", Boolean(state?.phone?.canControl && p.next));
  } catch { /* the readout says if the booth is away */ }
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

// After a press, check every 0.4s for a few seconds instead of waiting for
// the next 3s refresh, so the preview shows the new slide almost at once.
function refreshSoon() {
  let n = 0;
  const t = setInterval(() => {
    previewKey = "";
    paintPreview();
    if (++n >= 8) clearInterval(t);
  }, 400);
}

// Tapping the Next preview shows the next slide: an approved phone only, and
// like every control press it arms first and confirms second. The prompt
// goes in the caption, so the picture stays visible.
$("pv-next").addEventListener("click", () => {
  if (state?.phone?.canControl) press($("pv-next"), { kind: "next" }, $("pv-next-cap"), nextImage);
});

// The banner confirms too: it's the biggest target on the screen.
$("confirm").addEventListener("click", () => armed?.el.click());

// Emergency: the booth's safe slides, one tap to open, then the usual
// arm-and-confirm on the one to put up.
$("emergency").addEventListener("click", () => {
  const open = $("emergency-pick").hidden;
  $("emergency-pick").hidden = !open;
  $("emergency").setAttribute("aria-expanded", String(open));
  $("emergency").textContent = open ? "Close emergency slides" : "Emergency slide";
  if (!open) disarm();
});

// --- tabs ---------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    for (const name of ["flag", "search", "control"]) $(`tab-${name}`).hidden = name !== t.dataset.tab;
    disarm(); // nothing stays armed on a tab you can't see
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
        ? results
            .map(
              (r) => `<div class="slide"><small>${esc(r.presentationName)}, slide ${r.slideNumber}</small>${esc((r.text ?? "").slice(0, 160))}${
                state?.phone?.canControl ? `<button class="ctl" style="min-height:44px;margin-top:8px;width:100%" data-focus="${esc(r.presentationId)}">Show in editor</button>` : ""
              }</div>`
            )
            .join("")
        : `<div class="muted">No matches.</div>`;
      // Opens it in ProPresenter's editor, not on the screens; confirmed like every control press.
      $("search-results").querySelectorAll("[data-focus]").forEach((b) => b.addEventListener("click", () => press(b, { kind: "focus", presentationId: b.dataset.focus })));
    } catch (err) {
      $("search-results").innerHTML = `<div class="muted">${esc(err.message)}</div>`;
    }
  }, 250);
});

// --- control: approved phones, two presses ------------------------------------
// The first tap asks the booth's Refrain what it will do and gets a one-time
// id; the second tap, within a few seconds, confirms it. The server enforces
// both steps, so no single tap (or request) can take over ProPresenter.
let armed = null; // { el, labelEl, confirmId, label, idle, timer }
function disarm() {
  if (!armed) return;
  clearTimeout(armed.timer);
  armed.el.classList.remove("armed");
  armed.labelEl.textContent = armed.idle;
  armed = null;
  $("confirm").hidden = true;
}
function showConfirm(image, label) {
  $("confirm-text").textContent = `Tap again: ${label}`;
  $("confirm-img").removeAttribute("src");
  $("confirm-img").parentElement.hidden = !image;
  if (image) {
    $("confirm-img").dataset.src = image;
    loadImage($("confirm-img"));
  }
  $("confirm").hidden = false;
}
// `labelEl` is where "Tap again" is written: the button itself, or a
// caption when the pressed thing is a picture. `image` is the slide it will
// put up, shown large while armed instead of a line of text.
async function press(el, body, labelEl = el, image = null) {
  const status = $("control-status");
  if (armed && armed.el === el) {
    const { confirmId, label } = armed;
    disarm();
    try {
      await api("/api/control/confirm", { method: "POST", body: JSON.stringify({ confirmId }) });
      status.textContent = `Done: ${label}.`;
      status.className = "status";
      refreshSoon();
    } catch (err) {
      status.textContent = err.message;
      status.className = "status fault";
    }
    return;
  }
  disarm();
  try {
    const { confirmId, label } = await api("/api/control/prepare", { method: "POST", body: JSON.stringify(body) });
    armed = { el, labelEl, confirmId, label, idle: labelEl.textContent, timer: setTimeout(disarm, 5000) };
    el.classList.add("armed");
    labelEl.textContent = `Tap again: ${label}`;
    showConfirm(image, label);
  } catch (err) {
    status.textContent = err.message;
    status.className = "status fault";
  }
}
document.querySelectorAll(".ctl[data-kind]").forEach((b) => b.addEventListener("click", () => press(b, { kind: b.dataset.kind }, b, b.dataset.kind === "next" ? nextImage : null)));

let safeKey = "";
async function paintControl() {
  const can = Boolean(state?.phone?.canControl);
  $("control").hidden = !can;
  $("control-locked").textContent = can
    ? ""
    : state?.pinRequired
      ? `Control is off for this phone. Ask the booth to allow ${state?.phone?.name ? `"${state.phone.name}"` : "this phone"} in the Phone panel.`
      : "Control from a phone needs phone PINs turned on in the booth.";
  if (!can) return;
  try {
    const { safeSlides } = await api("/api/safe-slides");
    const key = JSON.stringify(safeSlides);
    if (key === safeKey) return;
    safeKey = key;
    $("emergency").hidden = !safeSlides.length;
    $("safe").innerHTML = safeSlides.length
      ? safeSlides.map((sl) => `<button class="slide" data-safe="${esc(sl.id)}" data-image="${esc(sl.image)}"><div class="pv"><img data-src="${esc(sl.image)}" alt="" /></div><small class="safe-label">${esc(sl.label)}</small></button>`).join("")
      : `<div class="muted">No safe slides yet. The booth adds them from Search.</div>`;
    $("safe").querySelectorAll("img").forEach((img) => loadImage(img));
    $("safe").querySelectorAll("[data-safe]").forEach((b) =>
      b.addEventListener("click", () => press(b, { kind: "safe", safeId: b.dataset.safe }, b.querySelector(".safe-label"), b.dataset.image))
    );
  } catch { /* keep the last list */ }
}

$("lock-name").value = store.get("refrain.remote.name", "");
$("name").value = store.get("refrain.remote.name", "");
refresh();
setInterval(refresh, 3000);
