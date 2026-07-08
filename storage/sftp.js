import { StorageBackend } from "./base.js";

/**
 * Self-hosted alternate for churches with their own server
 * infrastructure who want everything to stay off third-party cloud
 * services. See docs/refrain-architecture.md Section 9.6 for the full
 * hardening setup (chrooted accounts, per-machine reader keys, host
 * key pinning).
 *
 * Required .env variables:
 *   SFTP_HOST
 *   SFTP_USERNAME
 *   SFTP_PRIVATE_KEY_PATH
 *   SFTP_KNOWN_HOST_FINGERPRINT   (verify on every connection — never
 *                                  blindly accept an unknown host key)
 */
export class SftpStorage extends StorageBackend {
  static backendId = "sftp";
  static displayName = "SFTP";

  constructor({ host, username, privateKeyPath, knownHostFingerprint, remotePath = "/data" } = {}) {
    super();
    this.host = host;
    this.username = username;
    this.privateKeyPath = privateKeyPath;
    this.knownHostFingerprint = knownHostFingerprint;
    this.remotePath = remotePath;
  }

  async readSongFile(songId) {
    // TODO: SFTP get() on `${this.remotePath}/${songId}.json`
    throw new Error("Not implemented");
  }

  async writeSongFile(songId, data) {
    // TODO: stage locally first (Section 8.4), then SFTP put(), retry
    // on failure, only clear local staging copy on confirmed success.
    throw new Error("Not implemented");
  }

  async listSongFiles() {
    // TODO: SFTP list() on this.remotePath
    throw new Error("Not implemented");
  }
}

export default SftpStorage;
