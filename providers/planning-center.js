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
 *
 * Verified live against a real PCO account on 2026-07-08. Rather than
 * naming specific Plan IDs (which need updating by hand every week —
 * the previous design), the admin names one Service Type ID in
 * config.json's arrangementModule.planningCenterServiceTypeId (Health
 * screen has a UI for this). Every lookup resolves "the plan" fresh at
 * call time as the most recent PAST plan for that service type —
 * `GET /service_types/{id}/plans?filter=past&order=-sort_date&per_page=1`,
 * confirmed live to return exactly the last-run weekend's plan. This
 * also sidesteps a real wrinkle: one Plan can cover multiple service
 * times across two calendar dates (e.g. a combined Sat 5pm + Sun 9am +
 * Sun 11:15am plan) — there is no clean single "date" to filter by, so
 * we don't try to match an exact serviceDate at all, just "most recent
 * past."
 *
 * Song matching is by normalized title text (PCO's Item.title vs.
 * Refrain's ProPresenter presentation name) since there's no shared
 * stable ID between the two systems — this is a known soft spot, not a
 * stable mapping, and can misfire on generic/duplicate titles.
 *
 * Section sequence resolution, per PCO's real data shape: a plan's Item
 * has `custom_arrangement_sequence` — a per-occurrence override array of
 * plain section-label strings (confirmed live: e.g. ["Intro", "Chorus",
 * "Chorus", "Verse 1", ...]). Prefer that; only if it's empty/absent
 * fall back to fetching the Song's linked Arrangement resource and using
 * its own `sequence` attribute (also a plain string array — this is the
 * field name the church itself uses for arrangements in PCO Songs).
 */

const API_BASE = "https://api.planningcenteronline.com/services/v2";

/**
 * PCO item titles and ProPresenter presentation names are free text
 * from two different systems — strip bracketed/parenthetical suffixes
 * ProPresenter commonly adds (e.g. "(FS) - [ Ver 1 ]") and punctuation
 * so "Alleluia" and "Alleluia (FS) - [ Ver 1 ]" normalize the same.
 */
export function normalizeSongTitle(title) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[([].*?[)\]]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export class PlanningCenterProvider extends ArrangementProvider {
  static providerId = "planning-center";

  constructor({ appId, secret, serviceTypeId = null } = {}) {
    super();
    this.appId = appId;
    this.secret = secret;
    this.serviceTypeId = serviceTypeId;
  }

  #authHeader() {
    const token = Buffer.from(`${this.appId}:${this.secret}`).toString("base64");
    return { Authorization: `Basic ${token}` };
  }

  async #get(path) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: this.#authHeader(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(`Planning Center API ${path} responded ${res.status}`);
    }
    return res.json();
  }

  async testConnection() {
    await this.#get("/me");
    return true;
  }

  /** The most recent `count` already-happened plans for the configured service type, newest first. */
  async getRecentPlans(count = 5) {
    if (!this.serviceTypeId) return [];
    const res = await this.#get(
      `/service_types/${this.serviceTypeId}/plans?filter=past&order=-sort_date&per_page=${count}`
    );
    return res.data.map((plan) => ({ id: plan.id, dates: plan.attributes.dates, sortDate: plan.attributes.sort_date }));
  }

  /** The single most recent already-happened plan, or null if unconfigured/none found. */
  async getRecentPlan() {
    const [plan] = await this.getRecentPlans(1);
    return plan ?? null;
  }

  /** A plan's song items, each with whatever section sequence PCO has for it (see module doc for resolution order). */
  async getPlanSongs(planId) {
    const items = await this.#get(`/plans/${planId}/items?per_page=200`);
    const songItems = items.data.filter((item) => item.attributes.item_type === "song");

    return Promise.all(
      songItems.map(async (item) => {
        if (item.attributes.custom_arrangement_sequence?.length) {
          return { title: item.attributes.title, sectionSequence: item.attributes.custom_arrangement_sequence };
        }
        const songRel = item.relationships.song?.data;
        const arrangementRel = item.relationships.arrangement?.data;
        if (songRel && arrangementRel) {
          try {
            const arrangement = await this.#get(`/songs/${songRel.id}/arrangements/${arrangementRel.id}`);
            return { title: item.attributes.title, sectionSequence: arrangement.data.attributes.sequence ?? [] };
          } catch {
            // Fall through to the empty-sequence case below.
          }
        }
        return { title: item.attributes.title, sectionSequence: [] };
      })
    );
  }

  async getPlannedArrangement(_songId, _serviceDate, songName, planId = null) {
    const targetTitle = normalizeSongTitle(songName);
    if (!targetTitle) return { sectionSequence: [] };

    const resolvedPlanId = planId ?? (await this.getRecentPlan())?.id;
    if (!resolvedPlanId) return { sectionSequence: [] };

    const songs = await this.getPlanSongs(resolvedPlanId);
    const match = songs.find((s) => normalizeSongTitle(s.title) === targetTitle);
    return { sectionSequence: match?.sectionSequence ?? [] };
  }
}

export default PlanningCenterProvider;
