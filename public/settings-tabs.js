/**
 * Settings' tabs, in order: one list for the page (health.js) and the menu's
 * sub-items (nav.js), so they can't disagree. The first is where Settings
 * always opens.
 */
export const SETTINGS_TABS = [
  ["status", "Status", "activity"],
  ["library", "Library", "library"],
  ["features", "Features", "toggle-right"],
  ["phones", "Phones", "smartphone"],
  ["this-mac", "This Mac", "monitor-cog"],
];

/** Which tab a fragment asks for: `#settings/library`, else the first. */
export function settingsTabFromHash(hash) {
  const m = String(hash ?? "").match(/^#settings\/([a-z-]+)$/);
  return m && SETTINGS_TABS.some(([id]) => id === m[1]) ? m[1] : SETTINGS_TABS[0][0];
}

/** Said when the tab changes, so the menu's sub-items can follow. */
export const SETTINGS_TAB_EVENT = "refrain:settings-tab";
