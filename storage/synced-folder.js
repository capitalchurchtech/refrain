import { LocalFolderStorage } from "./local-folder.js";

/**
 * Storage backend for Google Drive / Dropbox / OneDrive: identical
 * logic to local-folder.js, just pointed at a path that happens to be
 * synced by a desktop client already running on the machine.
 *
 * Deliberately NOT a Drive/Dropbox API integration — see
 * docs/refrain-architecture.md Section 17.3 for why. No OAuth, no
 * credentials, no Cloud project. The sync client handles all of that
 * invisibly; this just needs the right local path.
 *
 * Common default paths to offer in the setup UI (auto-detect, fall
 * back to manual entry):
 *   Windows (Google Drive): G:\My Drive\...
 *   macOS (Google Drive):   ~/Library/CloudStorage/GoogleDrive-{account}/My Drive/...
 *   Windows/macOS (Dropbox): ~/Dropbox/...
 */
export class SyncedFolderStorage extends LocalFolderStorage {
  static backendId = "synced-folder";
}

export default SyncedFolderStorage;
