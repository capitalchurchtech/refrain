import { escapeHtml } from "./slide-tools.js";

/**
 * Bundles › Slides: every slide of the open file, drawn, in a grid; one slide
 * large with its layers, its media and macros, its notes, and anything Check
 * found on it. The drawing is the propresenter-bundle package's (server-side
 * HTML, laid out here by its draw-layout.js with the fonts' real metrics).
 *
 * Each slide sits in its own shadow root, so neither this app's stylesheet nor
 * the Tailwind JIT touches it, and the slide's own CSS touches nothing else.
 * Slides are fetched a batch at a time as they scroll into view.
 */

const BATCH = 24;
const SLIDE_W = 1920;
const prefs = {
  get(k, d) { try { return localStorage.getItem(`pb-${k}`) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`pb-${k}`, v); } catch { /* private window: not kept */ } },
};

let layoutModule = null;
const layout = () => (layoutModule ??= import("/api/probundle/draw-layout.js").catch(() => null));

// @font-face only works in the page itself, not inside a shadow root.
function addFontCss(css) {
  if (!css) return;
  let el = document.getElementById("pb-slide-fonts");
  if (!el) {
    el = document.createElement("style");
    el.id = "pb-slide-fonts";
    document.head.appendChild(el);
  }
  const have = new Set(el.textContent.split("\n"));
  const add = css.split("\n").filter((l) => l && !have.has(l));
  if (add.length) el.textContent += (el.textContent ? "\n" : "") + add.join("\n");
}

/** The slides of the open file, numbered from 1 in drawing order, each with its group. */
function slidesOf(o) {
  let n = 0;
  return o.model.groups.flatMap((g) => g.slides.map((s) => ({ ...s, n: ++n, group: g })));
}

/** The Slides tab's markup. `mount` brings it to life once it is in the page. */
export function slidesView(o) {
  if (!o.drawnCount) return `<p class="text-sm">This file was opened before Refrain could draw slides. Open it again to see them.</p>`;
  const cols = Number(prefs.get("cols", "4"));
  let n = 0;
  return `
    <div class="pb-slides" style="--pb-cols:${cols}">
      <div class="pb-bar">
        <label class="pb-size" for="pb-size">Size <input id="pb-size" type="range" min="2" max="8" step="1" value="${cols}" aria-label="Slides per row"></label>
        <button type="button" class="btn btn-chip" id="pb-rough" aria-pressed="${prefs.get("rough", "0") === "1"}">Rough out</button>
        <span class="pb-note">Drawn in this computer's fonts. ProPresenter can break a line differently.</span>
      </div>
      ${o.model.groups
        .map(
          (g) => `
        <h4 class="pb-group">${g.color ? `<i style="background:${escapeHtml(g.color)}"></i>` : ""}${escapeHtml(g.name)}</h4>
        <div class="pb-grid">${g.slides
          .map((s) => {
            n += 1;
            return `<button type="button" class="pb-card${s.enabled ? "" : " pb-off"}" data-n="${n}" aria-label="Slide ${n}${s.label ? `, ${escapeHtml(s.label)}` : ""}${s.enabled ? "" : ", turned off"}">
              <span class="pb-frame"><span class="pb-host" data-n="${n}"></span></span>
              <span class="pb-cap"><span class="pb-num">${n}</span><span class="pb-lbl">${escapeHtml(s.label || "No label")}</span>${s.enabled ? "" : `<span class="pb-offtag">Off</span>`}</span>
            </button>`;
          })
          .join("")}</div>`
        )
        .join("")}
    </div>
    <div class="pb-viewer" id="pb-viewer" hidden></div>`;
}

/**
 * Draw the slides as they come into view, and open one large on a click.
 * Returns a function that stops watching (call it before the tab is redrawn).
 */
export function mountSlides(root, o, findings) {
  const wrap = root.querySelector(".pb-slides");
  if (!wrap) return () => {};
  const slides = slidesOf(o);
  const cache = new Map(); // n -> drawn slide
  const loading = new Map(); // batch start -> promise
  let rough = prefs.get("rough", "0") === "1";
  let css = "";

  // Each slide's scale follows its own frame's width (the size slider, the window, the large view).
  const sized = new ResizeObserver((entries) => {
    for (const e of entries) if (e.target.clientWidth) e.target.style.setProperty("--k", String(e.target.clientWidth / SLIDE_W));
  });

  const fetchBatch = (from) => {
    if (!loading.has(from)) {
      loading.set(from, fetch(`/api/probundle/slides/${encodeURIComponent(o.sourceId)}?from=${from}&count=${BATCH}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
        .then((d) => { css = d.css; addFontCss(d.fontCss); for (const s of d.slides) cache.set(s.n, s); })
        .catch(() => loading.delete(from)));
    }
    return loading.get(from);
  };
  const drawn = async (n) => {
    if (!cache.has(n)) await fetchBatch(Math.floor((n - 1) / BATCH) * BATCH);
    return cache.get(n) ?? null;
  };

  // A slide into a host element, scaled to its width, laid out once its fonts are in.
  async function paintInto(host, n) {
    const d = await drawn(n);
    if (!d || !host.isConnected) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${css}
      :host{display:block;position:absolute;inset:0;overflow:hidden}
      .wrap{position:absolute;inset:0}
      .wrap>.slide{transform:scale(var(--k,0.2))}</style><div class="wrap${rough ? " rough" : ""}">${d.html}</div>`;
    host.style.setProperty("--k", String(host.clientWidth / SLIDE_W));
    host.dataset.drawn = "1";
    sized.observe(host);
    const mod = await layout();
    await document.fonts.ready;
    if (mod && host.isConnected) mod.layoutSlide(shadow);
  }

  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      paintInto(e.target, Number(e.target.dataset.n));
    }
  }, { rootMargin: "400px 0px" });
  for (const h of wrap.querySelectorAll(".pb-host")) seen.observe(h);


  const size = root.querySelector("#pb-size");
  size?.addEventListener("input", () => {
    wrap.style.setProperty("--pb-cols", size.value);
    prefs.set("cols", size.value);
  });
  const roughBtn = root.querySelector("#pb-rough");
  roughBtn?.addEventListener("click", () => {
    rough = !rough;
    prefs.set("rough", rough ? "1" : "0");
    for (const b of root.querySelectorAll("#pb-rough, #pb-vrough")) b.setAttribute("aria-pressed", String(rough));
    for (const h of root.querySelectorAll(".pb-host")) h.shadowRoot?.querySelector(".wrap")?.classList.toggle("rough", rough);
  });

  // --- One slide, large -----------------------------------------------------------
  const viewer = root.querySelector("#pb-viewer");
  let current = null;
  const where = (s) => `${s.group.name} / ${s.label}`;

  function layersOf(s) {
    // Front to back, as ProPresenter's object list shows them.
    return s.elements.map((e) => `<li><span class="pb-lname">${escapeHtml(e.name || "(no name)")}</span><span class="pb-lrole">${escapeHtml(e.role ?? "")}</span><span class="pb-lwhat">${escapeHtml(e.text || e.media || "")}</span></li>`).join("");
  }

  async function show(n) {
    const s = slides[n - 1];
    if (!s) return;
    current = n;
    const d = await drawn(n);
    const found = findings.filter((f) => f.slide === where(s));
    const acts = [
      ...s.media.map((m) => `Media: ${escapeHtml(m.file ?? "?")}${m.layer === 1 ? ", foreground" : ""}`),
      ...s.macros.map((m) => `Macro: ${escapeHtml(m.name ?? "?")}`),
    ];
    viewer.innerHTML = `
      <div class="pb-vmain">
        <div class="pb-vtop">
          <span class="pb-vwhere">${escapeHtml(s.group.name)} · ${n} of ${slides.length}</span>
          <span class="pb-vname">${escapeHtml(s.label || "No label")}</span>
          <span class="pb-grow"></span>
          <button type="button" class="btn btn-chip" id="pb-vrough" aria-pressed="${rough}">Rough out</button>
          <button type="button" class="btn btn-chip" id="pb-prev" ${n === 1 ? "disabled" : ""}>Previous</button>
          <button type="button" class="btn btn-chip" id="pb-next" ${n === slides.length ? "disabled" : ""}>Next</button>
          <button type="button" class="btn btn-chip" id="pb-back">Back to all</button>
        </div>
        <div class="pb-vframe"><span class="pb-host" data-n="${n}"></span></div>
      </div>
      <aside class="pb-vside">
        ${found.length ? `<section><h5 class="rf-subhead">To look at</h5><ul class="pb-vlist">${found.map((f) => `<li><span class="pb-sev">${escapeHtml(f.severity)}</span>${f.box ? `${escapeHtml(f.box)}: ` : ""}${escapeHtml(f.message)}</li>`).join("")}</ul></section>` : ""}
        <section><h5 class="rf-subhead">Layers, front to back</h5>${s.elements.length ? `<ul class="pb-vlist pb-layers">${layersOf(s)}</ul>` : `<p class="pb-none">Nothing on this slide.</p>`}</section>
        <section><h5 class="rf-subhead">On this slide</h5>${acts.length ? `<ul class="pb-vlist">${acts.map((a) => `<li>${a}</li>`).join("")}</ul>` : `<p class="pb-none">No media or macros.</p>`}</section>
        <section><h5 class="rf-subhead">Slide notes</h5>${d?.notes ? `<p class="pb-notes">${escapeHtml(d.notes)}</p>` : `<p class="pb-none">No notes.</p>`}</section>
      </aside>`;
    wrap.hidden = true;
    viewer.hidden = false;
    paintInto(viewer.querySelector(".pb-host"), n);
    viewer.querySelector("#pb-prev").addEventListener("click", () => show(n - 1));
    viewer.querySelector("#pb-next").addEventListener("click", () => show(n + 1));
    viewer.querySelector("#pb-back").addEventListener("click", close);
    viewer.querySelector("#pb-vrough").addEventListener("click", () => roughBtn?.click());
    viewer.querySelector("#pb-back").focus({ preventScroll: true });
  }

  // Back to the grid, at the slide last looked at.
  function close() {
    const last = wrap.querySelector(`.pb-card[data-n="${current}"]`);
    current = null;
    viewer.hidden = true;
    viewer.innerHTML = "";
    wrap.hidden = false;
    last?.focus({ preventScroll: true });
    last?.scrollIntoView({ block: "nearest" });
  }

  wrap.addEventListener("click", (e) => {
    const card = e.target.closest(".pb-card");
    if (card) show(Number(card.dataset.n));
  });
  const keys = (e) => {
    if (current === null || (e.target instanceof Element && e.target.closest("input, textarea, select"))) return;
    if (e.key === "ArrowRight" && current < slides.length) { e.preventDefault(); show(current + 1); }
    else if (e.key === "ArrowLeft" && current > 1) { e.preventDefault(); show(current - 1); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };
  document.addEventListener("keydown", keys);

  return () => {
    seen.disconnect();
    sized.disconnect();
    document.removeEventListener("keydown", keys);
  };
}
