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
  navLabel: "Library Sync",
  icon: "folder-sync",
  route: "/library-sync",
  component: null,
  enabledByDefault: false,
};
