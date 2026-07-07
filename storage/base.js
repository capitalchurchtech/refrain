/**
 * Base interface for arrangement-history storage backends.
 * See CONTRIBUTING.md for how to add a new one.
 */
export class StorageBackend {
  /** @param {string} songId @returns {Promise<object|null>} */
  async readSongFile(songId) {
    throw new Error("Not implemented");
  }

  /** @param {string} songId @param {object} data */
  async writeSongFile(songId, data) {
    throw new Error("Not implemented");
  }

  /** @returns {Promise<string[]>} list of songIds */
  async listSongFiles() {
    throw new Error("Not implemented");
  }
}
