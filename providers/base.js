/**
 * Base interface for church-management "planned arrangement" providers.
 * See CONTRIBUTING.md for how to add a new one.
 */
export class ArrangementProvider {
  /**
   * @param {string} songId - the ProPresenter presentationId
   * @param {string} serviceDate - ISO date string
   * @param {string} songName - the ProPresenter presentation's display
   *   name, for providers (e.g. Planning Center) with no shared stable
   *   ID between the two systems and that must match by title instead
   * @param {string|null} [planId] - an explicit plan to look in, for
   *   providers that support browsing multiple recent plans; falls back
   *   to the provider's own "most recent" resolution when omitted
   * @returns {Promise<{ sectionSequence: string[] }>}
   */
  async getPlannedArrangement(songId, serviceDate, songName, planId = null) {
    throw new Error("Not implemented");
  }

  /** @returns {Promise<boolean>} */
  async testConnection() {
    throw new Error("Not implemented");
  }
}
