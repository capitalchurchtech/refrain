/**
 * Settings > Status, as a health check (owner, 2026-10-07): the readout of what
 * is on the screens, then one row for each thing worth looking at when something
 * seems wrong: is ProPresenter answering, is the status feed getting through,
 * is performance mode holding still, how old is the search index. Each row is an
 * icon, what it is, one plain line, and at most one thing to press.
 *
 * Pure markup here (for tests); the polling and presses are wired in health.js.
 */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ICON = {
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  feed: '<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01"/>',
  perf: '<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/>',
  index: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  modules: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
};

/** "2 min ago" style age for the index line, or the date once it is a day or more. */
export function indexAge(iso, now = Date.now()) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * The rows for the current state.
 * @param {{ connected: boolean, host?: string, port?: number|string, feed?: string, armed: boolean,
 *   indexBuiltAt?: string|null, indexCount?: number, modules?: {attention: boolean, headline: string, detail: string} }} s
 */
export function healthCheckHtml(s, now = Date.now()) {
  const row = ({ id, icon, tone, name, line, right }) => `
    <div class="rf-hc-row" data-hc-row="${id}">
      <span class="rf-hc-icon" data-tone="${tone}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[icon]}</svg></span>
      <div class="rf-hc-text"><b>${esc(name)}</b><span>${esc(line)}</span></div>
      ${right}
    </div>`;
  const state = (text, tone) => `<span class="rf-hc-state" data-tone="${tone}">${esc(text)}</span>`;
  const button = (id, text, title) => `<button type="button" class="rf-hc-btn" data-hc="${id}" title="${esc(title)}">${esc(text)}</button>`;

  const feedLine = { ok: "Reporting to your announcement server.", idle: "Waiting for the send window.", fault: "Not getting through. See Settings › Telemetry.", off: "Switched off. Settings › Telemetry turns it on." };
  const feedState = { ok: ["Flowing", "ok"], idle: ["Waiting", "dim"], fault: ["Check it", "fault"], off: ["Off", "dim"] };
  const feed = s.feed in feedLine ? s.feed : "off";

  const rows = [
    row({
      id: "link",
      icon: "link",
      tone: s.connected ? "ok" : "fault",
      name: "ProPresenter",
      line: `${s.connected ? "Answering" : "Not answering"} at ${s.host ?? "localhost"}:${s.port ?? ""}`,
      right: state(s.connected ? "Linked" : "No link", s.connected ? "ok" : "fault"),
    }),
    row({ id: "feed", icon: "feed", tone: feed === "fault" ? "fault" : feed === "ok" ? "ok" : "dim", name: "Status feed", line: feedLine[feed], right: state(...feedState[feed]) }),
    row({
      id: "perf",
      icon: "perf",
      tone: s.armed ? "plum" : "dim",
      name: "Performance mode",
      line: s.armed ? "Holding still. Nothing runs on its own." : "Background work allowed.",
      right: button("perf", s.armed ? "Turn off" : "Turn on", s.armed ? "Let Refrain do background work again" : "Hold still until turned off"),
    }),
    row({
      id: "index",
      icon: "index",
      tone: s.indexBuiltAt ? "ok" : "fault",
      name: "Search index",
      line: s.indexBuiltAt ? `${s.indexCount ?? 0} songs, updated ${indexAge(s.indexBuiltAt, now)}` : "Not built yet. Search is empty until it is.",
      right: button("refresh", "Refresh", "Read the songs that changed since the last refresh"),
    }),
  ];
  if (s.modules?.attention) {
    rows.push(row({ id: "modules", icon: "modules", tone: "fault", name: "Modules", line: s.modules.detail || s.modules.headline, right: state("Look", "fault") }));
  }
  return rows.join("");
}
