/**
 * "Fix this song" from wherever it's shown (handoff section 40.5).
 *
 * Between services, a flag says a song has a typo. Before this, fixing it
 * meant opening Spell Check and choosing the playlist again, or opening
 * Arrangement and finding the song again. Now a Flags or Service row opens the
 * tool with that song already chosen.
 *
 * The song travels as a pending note the tool picks up the next time it
 * renders, not in the URL: a link that re-runs a scan every time it's opened
 * would be worse than no link.
 */

let pending = null;
let available = new Set();

/** Set by the menu: which of these tools are switched on. */
export function setAvailableTools(ids) {
  available = new Set(ids);
}

/** Opens a tool with one presentation chosen. */
export function openWith(tool, { presentationId, name }) {
  if (!available.has(tool) || !presentationId) return;
  pending = { tool, presentationId, name: name ?? null };
  // Spell Check has its own key; the rest are Prep tabs.
  location.hash = tool === "spellcheck" ? "spellcheck" : `prep/${tool}`;
}

/** The presentation a tool was opened with, once; null otherwise. */
export function takeOpenWith(tool) {
  if (pending?.tool !== tool) return null;
  const p = pending;
  pending = null;
  return p;
}

const TOOLS = [
  ["spellcheck", "Check this"],
  ["arrangement", "Arrangement"],
];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Buttons for the tools that are on, for a row showing one presentation. */
export function songActionsHtml(presentationId, name) {
  if (!presentationId) return "";
  return TOOLS.filter(([id]) => available.has(id))
    .map(
      ([id, label]) =>
        `<button type="button" class="btn btn-chip shrink-0 open-with-btn" data-tool="${id}" data-presentation-id="${esc(presentationId)}" data-name="${esc(name)}">${label}</button>`
    )
    .join("");
}

/** Wires the buttons songActionsHtml made, inside `root`. */
export function wireOpenWith(root) {
  root?.querySelectorAll(".open-with-btn").forEach((b) =>
    b.addEventListener("click", () => openWith(b.dataset.tool, { presentationId: b.dataset.presentationId, name: b.dataset.name }))
  );
}
