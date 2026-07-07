import { StorageBackend } from "./base.js";

/**
 * Default backend for cross-machine shared storage. See
 * docs/refrain-architecture.md Section 9 for full reasoning.
 *
 * Required .env variables:
 *   FIRESTORE_PROJECT_ID            (all machines)
 *   FIRESTORE_SERVICE_ACCOUNT_KEY_PATH   (logger machine ONLY)
 *
 * Readers use the public client SDK with just the project ID — no
 * service account, no secret. Access control is enforced by Firestore
 * security rules (public read, write only via Admin SDK), not by
 * hiding configuration. See Section 9.3 for the exact rules to set.
 *
 * If FIRESTORE_PROJECT_ID (or, for the logger,
 * FIRESTORE_SERVICE_ACCOUNT_KEY_PATH) is missing, this backend should
 * fail to initialize gracefully — the arrangement module then shows as
 * "misconfigured" (Section 4.1), not a crash, and core search/lyrics
 * features must keep working regardless.
 */
export class FirestoreStorage extends StorageBackend {
  static backendId = "firestore";

  constructor({ projectId, serviceAccountKeyPath, role } = {}) {
    super();
    this.projectId = projectId;
    this.serviceAccountKeyPath = serviceAccountKeyPath;
    this.role = role;
    // TODO: initialize firebase-admin (logger, using serviceAccountKeyPath)
    // or the client SDK (reader, using only projectId) here.
  }

  async readSongFile(songId) {
    // TODO: this.db.collection("songs").doc(songId).get()
    throw new Error("Not implemented");
  }

  async writeSongFile(songId, data) {
    // TODO: Admin SDK only — this.db.collection("songs").doc(songId).set(data)
    // Should throw/refuse if this.role !== "logger".
    throw new Error("Not implemented");
  }

  async listSongFiles() {
    // TODO: this.db.collection("songs").listDocuments()
    throw new Error("Not implemented");
  }
}

export default FirestoreStorage;
