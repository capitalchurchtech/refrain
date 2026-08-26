/**
 * A segmented LED meter, for index progress and nothing else.
 *
 * A meter earns its place because something is actually moving. Index progress
 * moves because the work moves, and the meter stops existing when the work
 * stops. Refrain's other statuses are discrete -- linked or lost, standing by
 * or live, index fresh or stale -- and a meter that never moves is decoration
 * wearing an instrument's clothes, the same lie as a raised element that does
 * nothing.
 *
 * So: do not reuse this for anything binary. On a connection state or a module
 * toggle it stops being an instrument.
 *
 * A ladder rather than a continuous fill, because that is how a rack meter is
 * built: discrete cells with hairline gaps, recessed when unlit so the empty
 * ladder reads as a real object before anything starts. The cells light as they
 * fill and that is the whole motion. No shimmer, no travelling highlight, no
 * pulse on the leading cell -- emitters do not breathe.
 */

const DEFAULT_CELLS = 24;

/**
 * Builds the ladder once. Kept separate from update() so a poll loop is not
 * rebuilding 24 elements every 500ms, which is also what would make the cells
 * flicker rather than light.
 */
export function createMeter(el, cells = DEFAULT_CELLS) {
  if (!el) return;
  if (el.dataset.rfMeter === String(cells)) return; // already built at this size
  el.dataset.rfMeter = String(cells);
  el.classList.add("rf-meter");
  el.setAttribute("role", "progressbar");
  el.innerHTML = Array.from({ length: cells }, () => `<span class="rf-meter-cell"></span>`).join("");
}

/**
 * Lights the first n cells for current/total.
 *
 * `total` of 0 or null means the work has started but its size is not known
 * yet, which happens while the library listing is still being fetched. An
 * empty ladder is the honest reading there: something is happening, and we
 * cannot yet say how much of it.
 */
export function updateMeter(el, current, total) {
  if (!el) return;
  const cells = [...el.querySelectorAll(".rf-meter-cell")];
  if (cells.length === 0) return;
  const known = Number.isFinite(total) && total > 0;
  const ratio = known ? Math.min(1, Math.max(0, current / total)) : 0;
  const lit = Math.round(ratio * cells.length);
  cells.forEach((cell, i) => cell.classList.toggle("lit", i < lit));

  el.setAttribute("aria-valuemin", "0");
  if (known) {
    el.setAttribute("aria-valuemax", String(total));
    el.setAttribute("aria-valuenow", String(current));
    el.setAttribute("aria-valuetext", `${current} of ${total}`);
  } else {
    el.removeAttribute("aria-valuemax");
    el.removeAttribute("aria-valuenow");
    el.setAttribute("aria-valuetext", "Starting");
  }
}

/**
 * The count that sits beside the ladder. Genuinely data, so it is monospace
 * with tabular figures, and it does not jitter as the numbers grow.
 */
export function meterCount(current, total) {
  return Number.isFinite(total) && total > 0 ? `${current} / ${total}` : `${current}`;
}
