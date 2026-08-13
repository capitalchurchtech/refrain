/**
 * App-level error boundary. Two layers:
 *
 * 1. safeRender wraps a screen's render() so a thrown render shows a
 *    recoverable "this screen failed, reload" message in that view instead
 *    of leaving a blank page — the previous view is already hidden by the
 *    time a renderer runs, so an unguarded throw is a blank screen.
 * 2. installGlobalErrorBoundary surfaces otherwise-silent uncaught errors
 *    and unhandled promise rejections (a failed fetch in a click handler,
 *    say) as a dismissible banner, so a volunteer notices rather than
 *    wondering why a button did nothing. For a live-service tool, a visible
 *    "something broke, reload" beats a silent no-op.
 */

// Renders a screen, catching a thrown render() and showing a recoverable
// message in its view rather than blanking the page.
export function safeRender(fn, el, id) {
  try {
    fn?.();
  } catch (err) {
    console.error(`Failed to render "${id}":`, err);
    if (!el) return;
    el.innerHTML = `
      <div class="alert alert-error flex items-center justify-between gap-3" role="alert">
        <span class="text-sm">This screen ran into a problem and couldn't load.</span>
        <button class="btn btn-sm shrink-0" data-reload>Reload</button>
      </div>`;
    el.querySelector("[data-reload]")?.addEventListener("click", () => location.reload());
  }
}

// Shows a single dismissible banner for uncaught errors / rejections.
export function installGlobalErrorBoundary() {
  let banner = null;

  const show = (detail) => {
    console.error("Uncaught error:", detail);
    if (banner) return; // one banner at a time; don't stack
    banner = document.createElement("div");
    banner.setAttribute("role", "alert");
    banner.className =
      "fixed bottom-3 left-1/2 -translate-x-1/2 z-[60] alert alert-error shadow-lg w-[calc(100%-1.5rem)] max-w-md flex items-center justify-between gap-2";
    banner.innerHTML = `
      <span class="text-sm">Something went wrong. If a screen looks broken, reload.</span>
      <span class="flex gap-1 shrink-0">
        <button class="btn btn-xs" data-reload>Reload</button>
        <button class="btn btn-ghost btn-xs btn-square" data-dismiss aria-label="Dismiss">✕</button>
      </span>`;
    document.body.appendChild(banner);
    banner.querySelector("[data-reload]").addEventListener("click", () => location.reload());
    banner.querySelector("[data-dismiss]").addEventListener("click", () => {
      banner.remove();
      banner = null;
    });
  };

  // For the error event, ignore resource-load failures (an <img>/CDN hiccup
  // has no e.error and no e.filename) — only surface real script errors.
  window.addEventListener("error", (e) => {
    if (e.error || (e.message && e.filename)) show(e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e) => show(e.reason));
}
