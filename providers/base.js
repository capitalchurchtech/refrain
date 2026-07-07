/**
 * Base interface for church-management "planned arrangement" providers.
 * See CONTRIBUTING.md for how to add a new one.
 */
export class ArrangementProvider {
  /**
   * @param {string} songId
   * @param {string} serviceDate - ISO date string
   * @returns {Promise<{ sectionSequence: string[] }>}
   */
  async getPlannedArrangement(songId, serviceDate) {
    throw new Error("Not implemented");
  }

  /** @returns {Promise<boolean>} */
  async testConnection() {
    throw new Error("Not implemented");
  }
}
