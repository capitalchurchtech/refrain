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
