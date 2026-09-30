/**
 * Settings' tabs, in order. The first is where Settings always opens.
 */
export const SETTINGS_TABS = [
  ["status", "Status", "activity"],
  ["search", "Search", "search"],
  ["features", "Features", "toggle-right"],
  ["phones", "Phones", "smartphone"],
  ["this-mac", "This Mac", "monitor-cog"],
  // Last: the least used (owner, 2026-09-30).
  ["audit", "Audit", "clipboard-check"],
];

// Tabs that were renamed, so an old link still lands somewhere sensible.
const RENAMED = { library: "search" };

/** Which tab a fragment asks for: `#settings/search`, else the first. */
export function settingsTabFromHash(hash) {
  const m = String(hash ?? "").match(/^#settings\/([a-z-]+)$/);
  const id = m ? (RENAMED[m[1]] ?? m[1]) : null;
  return id && SETTINGS_TABS.some(([t]) => t === id) ? id : SETTINGS_TABS[0][0];
}
