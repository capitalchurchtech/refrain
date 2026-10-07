/**
 * Every panel Settings has, in order. The first is where Settings always opens.
 * A panel is reached from the top row (SETTINGS_TOP) or, for the less used
 * ones, from the second row inside More.
 */
export const SETTINGS_TABS = [
  ["status", "Status", "activity"],
  ["search", "Search", "search"],
  ["features", "Features", "toggle-right"],
  ["phones", "Phones", "smartphone"],
  ["customize", "Customize", "sliders-horizontal"],
  ["telemetry", "Telemetry", "radio-tower"],
  // Last: the least used (owner, 2026-09-30).
  ["audit", "Audit", "clipboard-check"],
];

/**
 * The top row, four tabs (owner, 2026-10-07: seven did not fit a 260px
 * column). The last, More, holds the rest as a second row, so every old link
 * (`#settings/phones`) still lands on its own panel.
 */
export const SETTINGS_MORE = ["phones", "customize", "telemetry", "audit"];
export const SETTINGS_TOP = [
  ["status", "Status", "activity"],
  ["search", "Search", "search"],
  ["features", "Features", "toggle-right"],
  ["more", "More", "ellipsis"],
];

/** Which top tab a panel belongs under. */
export const settingsTopTab = (panel) => (SETTINGS_MORE.includes(panel) ? "more" : panel);

// Tabs that were renamed, so an old link still lands somewhere sensible.
const RENAMED = { library: "search", "this-mac": "customize" };

/** Which tab a fragment asks for: `#settings/search`, else the first. */
export function settingsTabFromHash(hash) {
  const m = String(hash ?? "").match(/^#settings\/([a-z-]+)$/);
  const id = m ? (RENAMED[m[1]] ?? m[1]) : null;
  return id && SETTINGS_TABS.some(([t]) => t === id) ? id : SETTINGS_TABS[0][0];
}
