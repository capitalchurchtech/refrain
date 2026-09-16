/**
 * Keep a wide info tooltip inside a narrow panel.
 *
 * `.tooltip-info-wide` is 20rem of wrapped prose, centred on its icon. Refrain
 * is a permanently narrow docked panel, so any icon within half that width of
 * an edge pushes the box off-screen -- where `body { overflow-x: hidden }`
 * silently clips it and the operator reads a sentence that stops. Measured at
 * 455px: **10 of Health's 20 tooltips ran off the right edge**, the worst by
 * 91px, plus one of the two on QR Codes.
 *
 * That was previously handled by passing a direction per field ("left" for the
 * ones known to sit in a right-hand column). It is the wrong altitude: it needs
 * every call site to know where it will be laid out, and it had already fallen
 * behind the layout in half the cases. One mechanism that measures instead.
 *
 * The shift is a custom property consumed by a `margin-left`, so DaisyUI keeps
 * owning the positioning and this only nudges it. Margin specifically: the
 * obvious `transform: translateX(calc(-50% + shift))` loses the cascade to
 * DaisyUI's own `transform` on `.tooltip:before` even at higher specificity,
 * because the vendored Tailwind JIT injects its sheet at runtime after the
 * page's own. That failure is invisible -- the property is set, ignored, and
 * the tooltips carry on running off the edge while the code reads as correct.
 *
 * Measured on the way in -- widths depend on the text, and the panel is resized
 * constantly -- and read off the ::before itself, so it is the real used width
 * rather than an assumed 20rem.
 */

const EDGE_MARGIN = 12;

/**
 * Where the tooltip box actually is, rather than where the default placement
 * would put it.
 *
 * The first version assumed the box is centred on its icon, which is only true
 * for the default direction -- `tooltip-left` places it entirely to one side
 * (a computed `left` of -324px), so the centred assumption left five of
 * Health's tooltips still off the edge while reporting them fixed. Reading the
 * used values covers every direction without knowing which one is in play.
 */
function boxOf(el) {
  const cs = getComputedStyle(el, "::before");
  const width = parseFloat(cs.width);
  const left = parseFloat(cs.left);
  if (!Number.isFinite(width) || !Number.isFinite(left) || width <= 0) return null;
  // Whatever this function set last time; the correction is relative to it.
  const applied = parseFloat(cs.marginLeft) || 0;
  const matrix = new DOMMatrixReadOnly(cs.transform === "none" ? "" : cs.transform);
  const anchor = el.getBoundingClientRect();
  // Where it is RIGHT NOW, `applied` included -- the correction below is
  // relative to the rendered position, so leaving the margin out here would
  // mix two frames of reference and re-apply a shift that is already there.
  const x = anchor.left + left + applied + matrix.m41;
  return { left: x, right: x + width, applied };
}

function fit(el) {
  const box = boxOf(el);
  if (!box) return;
  const viewport = document.documentElement.clientWidth;

  let delta = 0;
  if (box.right > viewport - EDGE_MARGIN) delta = viewport - EDGE_MARGIN - box.right;
  // Re-check the left edge after nudging: on a panel narrower than the tooltip,
  // pulling it off the right edge can push it off the left.
  if (box.left + delta < EDGE_MARGIN) delta = EDGE_MARGIN - box.left;

  const next = Math.round(box.applied + delta);
  if (next !== Math.round(box.applied)) el.style.setProperty("--rf-tip-shift", `${next}px`);
}

/**
 * Delegated, because every one of these is rendered into innerHTML and
 * re-rendered on a poll -- per-element listeners would be re-attached forever
 * and leak. Hover and focus both, so the keyboard path gets the same treatment.
 */
export function initTooltipFit() {
  const handler = (e) => {
    const el = e.target?.closest?.(".tooltip-info-wide");
    if (el) fit(el);
  };
  document.addEventListener("mouseover", handler, true);
  document.addEventListener("focusin", handler, true);
}
