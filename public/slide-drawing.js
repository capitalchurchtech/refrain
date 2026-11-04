/**
 * Drawn slides in the page: the client half shared by Bundles' Slides tab and
 * the desktop previews (Quality Control, Live's safe-slide keys). A drawing is
 * the propresenter-bundle package's HTML, laid out here by its draw-layout.js
 * with the fonts' real metrics.
 *
 * Each slide sits in its own shadow root, so neither this app's stylesheet nor
 * the Tailwind JIT touches it, and the slide's own CSS touches nothing else.
 * Its scale follows its host's width, whatever resizes it.
 */

let layoutModule = null;
const layout = () => (layoutModule ??= import("/api/preview/draw-layout.js").catch(() => null));

// @font-face only works in the page itself, not inside a shadow root.
export function addFontCss(css) {
  if (!css) return;
  let el = document.getElementById("slide-fonts");
  if (!el) {
    el = document.createElement("style");
    el.id = "slide-fonts";
    document.head.appendChild(el);
  }
  const have = new Set(el.textContent.split("\n"));
  const add = css.split("\n").filter((l) => l && !have.has(l));
  if (add.length) el.textContent += (el.textContent ? "\n" : "") + add.join("\n");
}

// Made on first use: the screens' modules are also loaded by tests in Node, which has no ResizeObserver.
let sizer = null;
const sized = () =>
  (sizer ??= new ResizeObserver((entries) => {
    for (const e of entries) {
      // A host taken out of the page (a screen redrawn) is let go, or this would keep every one.
      if (!e.target.isConnected) sizer.unobserve(e.target);
      else if (e.target.clientWidth) e.target.style.setProperty("--k", String(e.target.clientWidth / (Number(e.target.dataset.w) || 1920)));
    }
  }));

/**
 * A drawn slide `d` ({ html, width }) into `host`, scaled to its width, laid
 * out once its fonts are in. `css` is the drawing's stylesheet. Resolves when
 * it is laid out.
 */
export async function paintSlide(host, d, css, { rough = false } = {}) {
  if (!host.isConnected) return;
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${css}
    :host{display:block;position:absolute;inset:0;overflow:hidden}
    .wrap{position:absolute;inset:0}
    .wrap>.slide{transform:scale(var(--k,0.2))}</style><div class="wrap${rough ? " rough" : ""}">${d.html}</div>`;
  host.dataset.w = String(d.width || 1920);
  host.style.setProperty("--k", String(host.clientWidth / (d.width || 1920)));
  host.dataset.drawn = "1";
  sized().observe(host);
  const mod = await layout();
  await document.fonts.ready;
  if (mod && host.isConnected) mod.layoutSlide(shadow);
}

/** Stop resizing a host that is going away. */
export const unwatch = (host) => sizer?.unobserve(host);

/**
 * Fetch one drawn slide from `url` and paint it into `host`. Resolves to the
 * drawing ({ html, fonts, width, height }), or null when there is none (then
 * the caller shows what it showed before drawings).
 */
export async function drawInto(host, url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    addFontCss(d.fontCss);
    await paintSlide(host, d, d.css);
    return d;
  } catch {
    return null;
  }
}

const fontChecks = new Map();
/** Which of these fonts (PostScript names) this computer does not have. */
export async function missingFonts(names) {
  const check = (name) => {
    if (!fontChecks.has(name)) {
      let probe;
      try {
        probe = new FontFace(`probe-${name}`, `local("${name.replace(/["\\]/g, "")}")`).load();
      } catch {
        probe = Promise.reject(new Error("not a font name"));
      }
      fontChecks.set(name, probe.then(() => false, () => true));
    }
    return fontChecks.get(name);
  };
  const unique = [...new Set(names ?? [])];
  const missing = await Promise.all(unique.map(check));
  return unique.filter((_, i) => missing[i]);
}
