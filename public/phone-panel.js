/**
 * The Phone panel, from the rail on any screen: how to start a phone session,
 * and which phones may send alerts (owner request, 2026-09-26).
 *
 * Steps first, because "I can't tell how to start my phone session" is why
 * this exists. Then the phones that have signed in: each can flag with
 * today's PIN; alerts (a stage message, a pager code) are for the ones
 * approved here, by name, and every alert still needs a second tap to
 * confirm it. No phone moves slides (owner, 2026-10-04: the phone is an
 * alert tool and a flag tool).
 */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The panel's contents for one state of /api/network/setup. Pure, for tests. */
export function phonePanelHtml(d) {
  if (!d) return `<div>Couldn't load phone settings.</div>`;
  if (d.status === "off") {
    return `
      <p>Use a phone to flag a slide that needs fixing, from anywhere in the room. Phones you approve here can also send a stage message or a pager code.</p>
      <p class="opacity-70">Turning this on lets phones on the same Wi-Fi as this Mac open Refrain's phone page. A phone never moves slides.</p>
      <button type="button" id="phone-enable" class="btn btn-brand btn-sm w-fit">Turn on phones</button>`;
  }
  if (d.status === "misconfigured") {
    return `<p>Phones aren't set up correctly: ${esc((d.problems ?? []).join(" "))}</p>`;
  }
  const url = d.urls?.[0] ?? "";
  const steps = `
    <ol class="list-decimal pl-5 flex flex-col gap-2">
      <li>Connect the phone to the same Wi-Fi as this Mac.</li>
      <li>${d.qrSvg ? "Point the phone's camera at this code, or open" : "Open"} <strong class="font-mono break-all">${esc(url)}</strong> in its browser.
        ${d.qrSvg ? `<div class="mt-2 w-40 h-40 bg-white p-1 rounded phone-qr">${d.qrSvg}</div>` : ""}
      </li>
      ${
        d.pinMode === "none"
          ? `<li>No PIN is set: phones can flag, but no phone can send alerts.</li>`
          : `<li>Enter ${d.pinMode === "daily" ? "today's PIN" : "the PIN"}: <strong class="font-mono text-lg">${esc(d.pin ?? "")}</strong>${
              d.pinMode === "daily" ? ` <span class="opacity-60">(changes at midnight)</span>` : ""
            }. Tick <em>Trust this phone</em> to skip this for 30 days.</li>`
      }
      <li>To let it send stage messages and pager codes, press <em>Allow alerts</em> beside its name below.</li>
    </ol>
    ${d.loopbackOnly ? `<p class="opacity-80">This address only works on this Mac. For phones, set networkModule.host to 0.0.0.0.</p>` : ""}
    ${d.wrongToday ? `<p class="opacity-80">${d.wrongToday} wrong PIN${d.wrongToday === 1 ? "" : "s"} today.</p>` : ""}`;

  const phones = (d.phones ?? []).length
    ? (d.phones ?? [])
        .map(
          (p) => `
      <div class="flex items-center justify-between gap-2" data-phone="${esc(p.id)}">
        <div class="min-w-0">
          <div class="font-medium truncate">${esc(p.name)}</div>
          <div class="text-xs opacity-70">${p.approved ? "Can send alerts" : "Flags only"} · seen ${esc(clock(p.lastSeen))}</div>
        </div>
        <div class="flex gap-1 shrink-0">
          ${
            p.approved
              ? `<button type="button" class="btn btn-chip phone-act" data-action="unapprove">Stop alerts</button>`
              : d.pinMode === "none"
                ? ""
                : `<button type="button" class="btn btn-outline btn-xs phone-act" data-action="approve">Allow alerts</button>`
          }
          <button type="button" class="btn btn-chip phone-act" data-action="remove">Remove</button>
        </div>
      </div>`
        )
        .join("")
    : `<div class="opacity-70">No phones yet.</div>`;

  const activity = (d.activity ?? []).length
    ? `<div class="flex flex-col gap-1">${(d.activity ?? [])
        .slice(0, 5)
        .map((a) => `<div class="text-xs">${esc(clock(a.at))} · ${esc(a.phone)}: ${esc(a.label)}${a.ok ? "" : ` <span class="opacity-80">(didn't work: ${esc(a.error)})</span>`}</div>`)
        .join("")}</div>`
    : `<div class="text-xs opacity-70">No phone has sent an alert yet.</div>`;

  return `
    ${steps}
    <h3 class="rf-subhead">Phones</h3>
    <div class="flex flex-col gap-2">${phones}</div>
    <h3 class="rf-subhead">Recent phone presses</h3>
    ${activity}
    <div class="flex gap-2 flex-wrap mt-1">
      ${d.pinMode === "none" ? "" : `<button type="button" id="phone-forget" class="btn btn-chip" title="Signs every phone out and changes today's PIN">Sign out all phones</button>`}
      <button type="button" id="phone-disable" class="btn btn-chip">Turn off phones</button>
    </div>`;
}

export function initPhonePanel() {
  const modal = document.getElementById("phone-modal");
  const body = document.getElementById("phone-panel-body");
  const button = document.getElementById("nav-phone-toggle");
  if (!modal || !body || !button) return;
  let timer = null;
  let returnFocus = null;
  // The last action's failure, kept across the 5s refresh until the next
  // action, so a "couldn't save" isn't gone before anyone reads it.
  let lastError = "";

  const post = async (url, data) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data ?? {}) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || res.statusText);
    return out;
  };

  async function load() {
    try {
      const data = await fetch("/api/network/setup").then((r) => r.json());
      body.innerHTML = phonePanelHtml(data);
    } catch {
      body.innerHTML = phonePanelHtml(null);
    }
    if (lastError) body.insertAdjacentHTML("afterbegin", `<p class="font-medium" role="alert">${esc(lastError)}</p>`);
    wire();
  }

  function wire() {
    const act = (el, fn) =>
      el?.addEventListener("click", async () => {
        el.disabled = true;
        try {
          await fn();
          lastError = "";
        } catch (err) {
          lastError = err.message;
        }
        await load();
      });
    act(document.getElementById("phone-enable"), () => post("/api/network/enable"));
    act(document.getElementById("phone-disable"), () => post("/api/network/disable"));
    act(document.getElementById("phone-forget"), () => post("/api/network/forget-phones"));
    body.querySelectorAll(".phone-act").forEach((b) =>
      act(b, () => post(`/api/network/phones/${encodeURIComponent(b.closest("[data-phone]").dataset.phone)}`, { action: b.dataset.action }))
    );
  }

  function open() {
    returnFocus = document.activeElement;
    modal.classList.remove("hidden");
    body.innerHTML = "Loading...";
    load().then(() => document.getElementById("phone-close")?.focus());
    // New phones appear while the panel is open, without closing it.
    clearInterval(timer);
    timer = setInterval(() => {
      if (!modal.classList.contains("hidden") && !body.contains(document.activeElement)) load();
    }, 5000);
  }
  function close() {
    modal.classList.add("hidden");
    clearInterval(timer);
    returnFocus?.focus?.();
  }

  button.addEventListener("click", open);
  document.getElementById("phone-close")?.addEventListener("click", close);
  modal.addEventListener("click", (e) => e.target === modal && close());
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  });
}
