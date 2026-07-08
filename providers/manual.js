import { ArrangementProvider } from "./base.js";

/**
 * The zero-integration provider: the user types in the planned
 * arrangement by hand instead of pulling it from a church-management
 * system. This is what makes the arrangement module usable by a church
 * with no ChMS at all.
 *
 * The planned arrangement lives inside the same per-song storage file
 * as everything else (Section 8.5's schema, under
 * `manualPlannedArrangement`) rather than a separate data source — so
 * it needs the storage backend, not a network client.
 */
export class ManualProvider extends ArrangementProvider {
  static providerId = "manual";

  constructor({ storage } = {}) {
    super();
    this.storage = storage;
  }

  async getPlannedArrangement(songId, _serviceDate) {
    const record = await this.storage.readSongFile(songId);
    return { sectionSequence: record?.manualPlannedArrangement ?? [] };
  }

  async testConnection() {
    return true; // no external connection to test
  }
}

export default ManualProvider;
