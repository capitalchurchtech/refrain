/**
 * Base interface for church-management "planned arrangement" providers.
 * See CONTRIBUTING.md for how to add a new one.
 */
export class ArrangementProvider {
  /**
   * Human-readable name for UI copy ("Push to {displayName}", the
   * provider picker, etc.) — every generic screen reads this instead of
   * hardcoding a vendor name, so the UI never assumes Planning Center is
   * the only possible integration. Defaults to a title-cased providerId
   * so a new provider gets a reasonable label for free.
   */
  static get displayName() {
    return this.providerId
      .split("-")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
  }

  /** Whether this provider can push an updated arrangement back to the church-management system. */
  static supportsPush = false;

  /**
   * Whether this provider has a "plan" concept (a named, dated set of
   * songs for an upcoming/past service) that can be listed and browsed —
   * powers the "this weekend's plan" one-button workflow. A provider
   * without this concept (e.g. a bare spreadsheet or the manual
   * zero-integration option) simply won't offer that screen.
   */
  static supportsPlanBrowsing = false;

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

  // --- Optional capabilities below — only implement these if the matching static flag above is true ---

  /** @returns {Promise<{id: string, dates: string}[]>} — only if supportsPlanBrowsing */
  async getRecentPlans(count) {
    throw new Error("Not implemented");
  }

  /** @returns {Promise<string[]>} — the sequence currently live in the base arrangement, only if supportsPush */
  async getArrangementSequence(songId, arrangementId) {
    throw new Error("Not implemented");
  }

  /** Overwrites the base arrangement's sequence — only if supportsPush */
  async updateArrangementSequence(songId, arrangementId, sequence) {
    throw new Error("Not implemented");
  }
}
