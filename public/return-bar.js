/**
 * App-wide "Return" bar. When the operator uses the app to jump to a slide
 * during a service, the server pins the slide that was live just before the
 * jump (see /api/trigger and the returnPin in server/index.js). This bar
 * surfaces that pin on every screen so they can snap back to where the plan
 * was in one click, then hides once they do.
 *
 * It polls the pin on a light interval (to catch a jump made from another
 * device or screen) and also refreshes immediately when this page triggers a
 * Go Live, via window.refreshReturnBar() which the Go Live handlers call.
 */
export function initReturnBar() {
  const bar = document.getElementById("return-bar");
  const label = document.getElementById("return-bar-label");
  const btn = document.getElementById("return-bar-btn");
  if (!bar || !label || !btn) return;

  let current = null; // the pin last shown, so we only re-render on change

  function paint(pin) {
    if (!pin) {
      bar.classList.add("hidden");
      current = null;
      return;
    }
    // Only rewrite the DOM when the pin actually changed, so repeated polls
    // don't thrash the label or re-run the icon renderer.
    const key = `${pin.presentationId}:${pin.slideIndex}`;
    if (current === key) return;
    current = key;
    const name = pin.name ? `“${escapeHtml(pin.name)}”` : "the previous slide";
    label.innerHTML = `Jumped away from ${name} (slide ${pin.slideIndex + 1}). <span class="opacity-70">Return puts it back live.</span>`;
    bar.classList.remove("hidden");
    if (window.lucide) window.lucide.createIcons();
  }

  async function load() {
    try {
      const { pin } = await fetch("/api/return-pin").then((r) => r.json());
      paint(pin);
    } catch {
      // if we can't reach the server, just leave the bar as-is
    }
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const res = await fetch("/api/return", { method: "POST" });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({}));
        alert(`Couldn't return: ${error ?? res.statusText}`);
        return;
      }
      paint(null); // pin was consumed server-side; hide immediately
    } finally {
      btn.disabled = false;
    }
  });

  // Let Go Live handlers ask for an immediate refresh instead of waiting on
  // the poll, so the bar appears the moment they jump.
  window.refreshReturnBar = load;

  load();
  setInterval(load, 3000);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
