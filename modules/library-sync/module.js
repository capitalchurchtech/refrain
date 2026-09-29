/**
 * Library Sync — keeps one ProPresenter library (typically Songs) in step
 * between two machines or two macOS accounts, through a shared folder, one
 * direction at a time.
 *
 * Optional and off until configured, because a single machine setup has no use
 * for it. See server/library-sync.js for the copy and snapshot logic, and
 * docs/cross-account-library-sync.md for how the pieces fit together.
 */
export default {
  id: "library-sync",
  navLabel: "Share Library",
  icon: "folder-sync",
  nav: { group: "prep", order: 8 },
  client: { file: "library-sync.js", init: "initLibrarySync" },
  // Its on/off switch is on the Share Library card, on Settings' Library tab.
  settingsTab: "library",
  route: "/library-sync",
  component: null,
  enabledByDefault: false,
};
