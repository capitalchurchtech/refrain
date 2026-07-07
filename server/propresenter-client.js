/**
 * Talks to ProPresenter's local Network API.
 *
 * Endpoint paths below were verified live against ProPresenter 21.3
 * (API version v1) on 2026-07-07 — `/help` 404s on this version (no
 * discovery doc), so shapes were confirmed by direct experimentation:
 * - Library is two-step: GET /v1/libraries (folders) -> GET
 *   /v1/library/{folderUuid} (items: {uuid, name, index}).
 * - GET /v1/playlists returns a tree of {field_type: "playlist"|"group",
 *   children}; a playlist's actual items come from a second call,
 *   GET /v1/playlist/{uuid} -> {items: [{type: "header"|"presentation",
 *   presentation_info: {presentation_uuid}}]}.
 * - GET /v1/presentation/{uuid} -> {presentation: {groups: [{slides:
 *   [{text}]}]}} — note the top-level key is "groups", not "slides".
 * - Trigger is GET (not POST) /v1/presentation/{uuid}/{flatSlideIndex}/trigger,
 *   where flatSlideIndex is 0-based across all groups in document order.
 * If you're on a different ProPresenter version, re-verify against your
 * own instance before trusting this.
 */

function normalizeText(text) {
  return String(text ?? "")
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class ProPresenterClient {
  constructor({ host, port }) {
    this.baseUrl = `http://${host}:${port}`;
  }

  async #get(path) {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      throw new Error(`ProPresenter API ${path} responded ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async testConnection() {
    await this.#get("/v1/status/layers");
    return true;
  }

  /** Just the list of Library folders ({uuid, name, index}) — cheap, always fetched. */
  async getLibraryFolders() {
    return this.#get("/v1/libraries");
  }

  /**
   * Flat list of every presentation across Library folders.
   * @param {string[]|null} folderNames - if given, only crawl these folders
   *   (by name) instead of every folder — a church's library can be large
   *   and slow to crawl in full; see config.json's librarySync.folders.
   */
  async getLibrary(folderNames = null) {
    const folders = await this.getLibraryFolders();
    const wanted = folderNames
      ? (folders ?? []).filter((f) => folderNames.includes(f.name))
      : folders ?? [];
    const items = [];
    for (const folder of wanted) {
      try {
        const folderContents = await this.#get(`/v1/library/${folder.uuid}`);
        for (const item of folderContents?.items ?? []) {
          items.push({ id: item.uuid, name: item.name });
        }
      } catch (err) {
        console.log(`  library folder "${folder.name}" failed: ${err.message}`);
        // One folder failing/timing out shouldn't abort the whole crawl.
      }
    }
    return items;
  }

  /** Recursive playlist tree (folders/groups containing playlists). */
  async getPlaylists() {
    return this.#get("/v1/playlists");
  }

  /** A single playlist's items — filters to actual presentations. */
  async getPlaylistItems(playlistId) {
    const playlist = await this.#get(`/v1/playlist/${playlistId}`);
    const items = (playlist?.items ?? [])
      .filter((item) => item.type === "presentation" && item.presentation_info?.presentation_uuid)
      .map((item) => ({
        id: item.presentation_info.presentation_uuid,
        name: item.id?.name ?? "Untitled",
      }));
    return { items };
  }

  /** Full presentation document, including slide text, for a given id. */
  async getPresentation(presentationId) {
    return this.#get(`/v1/presentation/${presentationId}`);
  }

  /** Triggers a slide live by presentation id + 0-based flat slide index. */
  async triggerSlide(presentationId, slideIndex) {
    await this.#get(`/v1/presentation/${presentationId}/${slideIndex}/trigger`);
  }

  /**
   * Switches the ProPresenter editor's own UI to show this presentation —
   * separate from triggerSlide, which only changes live output. Without
   * this, "Go Live" changes the screens but leaves the operator's editor
   * window sitting on whatever playlist item they had open.
   */
  async focusPresentation(presentationId) {
    await this.#get(`/v1/presentation/${presentationId}/focus`);
  }
}

export { normalizeText };
