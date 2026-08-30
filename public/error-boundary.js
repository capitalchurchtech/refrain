/**
 * App-level error boundary, and the crash report that comes with it.
 *
 * Two surfaces, both of which existed before and both of which now carry a
 * report the operator can copy:
 *
 * 1. safeRender wraps a screen's render() so a thrown render shows a
 *    recoverable message in that view instead of leaving a blank page — the
 *    previous view is already hidden by the time a renderer runs, so an
 *    unguarded throw is a blank screen.
 * 2. installGlobalErrorBoundary surfaces otherwise-silent uncaught errors and
 *    unhandled rejections as a dismissible banner, so a volunteer notices
 *    rather than wondering why a button did nothing.
 *
 * **Nothing is sent anywhere.** The report is shown and one button copies it;
 * the operator pastes it where they like. Showing it *is* the consent
 * mechanism, which is why it is visible rather than hidden behind the button.
 *
 * Two actions, and the volunteer's is the obvious one: Reload is primary and
 * large, because mid-service that is the only thing they should do. Copy report
 * is secondary, for the admin afterwards.
 *
 * On not depending on the app that crashed: the imports here resolve at boot,
 * long before any crash, so they cannot fail at the moment they are needed. The
 * markup uses inline styles rather than the stylesheet, because a crash surface
 * that needs CSS to be legible is one stylesheet failure away from being an
 * invisible error message.
 */

import { buildCrashReport, collectState } from "./crash-report.js";
import { crumb } from "./breadcrumbs.js";

// Fetched once at boot and cached. At crash time the server may be the thing
// that died, so asking for it then would lose the field that matters most.
let build = { version: null, commit: null, branch: null };
fetch("/api/build")
  .then((r) => r.json())
  .then((b) => {
    build = b;
  })
  .catch(() => {
    /* a report without a commit is still worth having */
  });

// How many times each distinct failure has been seen. A crash loop and a
// one-off need different responses, and the count is the only thing that
// distinguishes them.
const occurrences = new Map();
function countFor(err) {
  const key = `${err?.constructor?.name ?? typeof err}:${String(err?.message ?? err).slice(0, 120)}`;
  const n = (occurrences.get(key) ?? 0) + 1;
  occurrences.set(key, n);
  return n;
}

const S = {
  wrap: "border-radius:3px;padding:12px 14px;font-size:13px;line-height:1.5;",
  pre: "margin:10px 0 0;padding:10px;max-height:210px;overflow:auto;border-radius:3px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.35);color:#D8CDE0;",
  row: "display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;",
};

/**
 * Wires the copy button.
 *
 * Deliberately not `mailto:` — practical URL length caps around 2,000
 * characters truncate a report silently, and the formatting arrives mangled.
 * Clipboard plus "paste it into an email" is platform-agnostic and does not
 * lose the end of the stack.
 */
function wireCopy(root, report) {
  const btn = root.querySelector("[data-copy]");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const original = btn.textContent;
    let ok = true;
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      ok = false;
    }
    // If the clipboard is unavailable (an insecure origin will refuse), select
    // the report instead so the operator can copy it by hand rather than
    // pressing a button that silently did nothing.
    if (!ok) {
      const pre = root.querySelector("[data-report]");
      if (pre) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    btn.textContent = ok ? "Copied" : "Select and copy it";
    setTimeout(() => {
      btn.textContent = original;
    }, 2000);
  });
}

function reportFor(err, side) {
  return buildCrashReport({
    error: err,
    side,
    build,
    state: collectState(),
    occurrence: countFor(err),
  });
}

// Renders a screen, catching a thrown render() and showing a recoverable
// message in its view rather than blanking the page.
export function safeRender(fn, el, id) {
  try {
    fn?.();
  } catch (err) {
    console.error(`Failed to render "${id}":`, err);
    crumb("crash", { screen: typeof id === "string" ? id : null });
    if (!el) return;
    const report = reportFor(err, "client");
    el.innerHTML = `
      <div role="alert" style="${S.wrap}background:#241C10;box-shadow:inset 0 0 0 1px #C9922E;">
        <div><strong>This screen stopped working.</strong> Reload to carry on.</div>
        <div style="opacity:.75;margin-top:2px;">If it keeps happening, copy the report and send it to your tech admin.</div>
        <div style="${S.row}">
          <button data-reload class="btn btn-brand btn-sm">Reload</button>
          <button data-copy class="btn btn-outline btn-sm">Copy report</button>
        </div>
        <pre data-report style="${S.pre}"></pre>
      </div>`;
    // Shown, not hidden behind the button: seeing the report before it goes
    // anywhere is the consent, and it is better than any scrubbing rule. The
    // block scrolls rather than the surface growing without limit.
    el.querySelector("[data-report]").textContent = report;
    el.querySelector("[data-reload]")?.addEventListener("click", () => location.reload());
    wireCopy(el, report);
  }
}

// Shows a single dismissible banner for uncaught errors / rejections.
export function installGlobalErrorBoundary() {
  let banner = null;

  const show = (detail) => {
    console.error("Uncaught error:", detail);
    if (banner) return; // one banner at a time; don't stack
    crumb("crash", { side: "client" });
    const report = reportFor(detail, "client");
    banner = document.createElement("div");
    banner.setAttribute("role", "alert");
    banner.style.cssText =
      "position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:70;" +
      "width:calc(100% - 24px);max-width:520px;background:#241C10;color:#EFE8F2;" +
      "box-shadow:inset 0 0 0 1px #C9922E,0 10px 28px rgba(0,0,0,.55);" +
      S.wrap;
    banner.innerHTML = `
      <div><strong>Something went wrong.</strong> If a screen looks broken, reload.</div>
      <div style="opacity:.75;margin-top:2px;">If it keeps happening, copy the report and send it to your tech admin.</div>
      <div style="${S.row}">
        <button data-reload class="btn btn-brand btn-sm">Reload</button>
        <button data-copy class="btn btn-outline btn-sm">Copy report</button>
        <button data-dismiss class="btn btn-chip" aria-label="Dismiss" style="margin-left:auto;">✕</button>
      </div>
      <pre data-report style="${S.pre}"></pre>`;
    document.body.appendChild(banner);
    banner.querySelector("[data-report]").textContent = report;
    banner.querySelector("[data-reload]").addEventListener("click", () => location.reload());
    banner.querySelector("[data-dismiss]").addEventListener("click", () => {
      banner.remove();
      banner = null;
    });
    wireCopy(banner, report);
  };

  // For the error event, ignore resource-load failures (an <img>/CDN hiccup
  // has no e.error and no e.filename) — only surface real script errors.
  window.addEventListener("error", (e) => {
    if (e.error || (e.message && e.filename)) show(e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e) => show(e.reason));
}
