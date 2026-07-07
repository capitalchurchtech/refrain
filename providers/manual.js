import { ArrangementProvider } from "./base.js";

/**
 * The zero-integration provider: the user types in the planned
 * arrangement by hand instead of pulling it from a church-management
 * system. This is what makes the arrangement module usable by a church
 * with no ChMS at all.
 */
export class ManualProvider extends ArrangementProvider {
  static providerId = "manual";

  async getPlannedArrangement(songId, serviceDate) {
    // TODO: read from wherever the user's manually-entered arrangement
    // is stored (likely the same per-song storage file, under a
    // user-editable field, rather than a separate data source).
    return { sectionSequence: [] };
  }

  async testConnection() {
    return true; // no external connection to test
  }
}

export default ManualProvider;
