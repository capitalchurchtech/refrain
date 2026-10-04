/**
 * The keyboard half of a tab row (Prep and Settings, handoff section 40).
 *
 * `role="tab"` tells a screen reader "tab 2 of 5", which promises the usual
 * behaviour: one Tab stop for the whole row, the arrow keys move between tabs,
 * Home and End go to the ends. Without this every tab was its own Tab stop and
 * the arrows did nothing.
 *
 * Tabs select as focus moves (automatic activation): each panel is already
 * rendered, so switching costs nothing.
 *
 * @param {HTMLElement} row      the role="tablist" element
 * @param {(tab: HTMLElement) => void} select  called with the tab to show
 */
export function wireTabKeys(row, select) {
  const tabs = () => [...row.querySelectorAll('[role="tab"]')];
  // Roving tabindex: only the selected tab is in the Tab order.
  for (const t of tabs()) t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1;
  row.addEventListener("keydown", (e) => {
    const list = tabs();
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const to =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i + 1) % list.length
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i - 1 + list.length) % list.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? list.length - 1
              : null;
    if (to == null) return;
    e.preventDefault();
    select(list[to]);
    // The row may have been redrawn by select(); find the tab again.
    const again = tabs()[to];
    for (const t of tabs()) t.tabIndex = t === again ? 0 : -1;
    again?.focus();
  });
}

/**
 * Icons only when the row would wrap (owner, 2026-09-30: "at small widths,
 * collapse the tabs into icons so they don't flow to two lines"). Measured,
 * not a breakpoint: it depends on how many tabs there are and how long their
 * names are, which differ between Prep and Settings and from church to church.
 *
 * The name stays for screen readers (visually hidden, not display:none) and
 * shows as the tab's tooltip. Re-checked whenever the row's width changes;
 * the class is set on the next frame, outside the observer, so changing the
 * row's height can't feed back into the observer.
 */
const fitted = new Set();
const measure = (row) => {
  row.classList.remove("rf-tabs-icons");
  const tabs = [...row.querySelectorAll('[role="tab"]')];
  const wraps = new Set(tabs.map((t) => t.offsetTop)).size > 1;
  row.classList.toggle("rf-tabs-icons", wraps);
};
const widths = new WeakMap();
const observer =
  typeof ResizeObserver === "function"
    ? new ResizeObserver((entries) => {
        for (const { target, contentRect } of entries) {
          if (widths.get(target) === Math.round(contentRect.width)) continue;
          widths.set(target, Math.round(contentRect.width));
          requestAnimationFrame(() => measure(target));
        }
      })
    : null;

export function fitTabs(row) {
  if (!row || !observer) return;
  // Rows redrawn by a re-render leave the page; stop watching those.
  for (const r of fitted) if (!r.isConnected) {
    observer.unobserve(r);
    fitted.delete(r);
  }
  for (const t of row.querySelectorAll('[role="tab"]')) if (!t.title) t.title = t.textContent.trim().replace(/\s*\d$/, "");
  if (!fitted.has(row)) {
    fitted.add(row);
    observer.observe(row);
  }
  requestAnimationFrame(() => measure(row));
}
