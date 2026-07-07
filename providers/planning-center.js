import { ArrangementProvider } from "./base.js";

/**
 * Planning Center Services provider.
 *
 * Required .env variables (logger machine only):
 *   PLANNING_CENTER_APP_ID
 *   PLANNING_CENTER_SECRET
 *
 * Reader machines never need these — they only read the logger's
 * output from the configured storage backend.
 */
export class PlanningCenterProvider extends ArrangementProvider {
  static providerId = "planning-center";

  constructor({ appId, secret } = {}) {
    super();
    this.appId = appId;
    this.secret = secret;
  }

  async getPlannedArrangement(songId, serviceDate) {
    // TODO: call api.planningcenteronline.com to pull the Plan +
    // Arrangement for this song/date. See docs/refrain-architecture.md
    // Section 8.2-8.3.
    throw new Error("Not implemented");
  }

  async testConnection() {
    // TODO: a lightweight authenticated call to confirm the PAT works.
    throw new Error("Not implemented");
  }
}

export default PlanningCenterProvider;
