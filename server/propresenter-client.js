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
 *
 * Date filter (Section 5.1) — resolved: the API exposes no created or
 * modified timestamp anywhere (checked every endpoint), but each
 * presentation includes a real filesystem path (`presentation_path`).
 * When Refrain runs on the same machine as ProPresenter, we stat that
 * file directly for genuine created/modified dates — reliable since
 * ProPresenter only runs on macOS, which has real birthtime support.
 * On a remote reader machine the path isn't reachable, so dates are
 * just left null rather than guessed.
 */
import { stat } from "node:fs/promises";

function normalizeText(text) {
  return String(text ?? "")
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "::1"];

const DEFAULT_TIMEOUT_MS = 8000;
// Triggering, focusing and reading a presentation make ProPresenter do real
// work (loading a document, pushing to outputs) and it appears to serialize
// API requests, so on a busy machine these measured several seconds each —
// enough for a few back-to-back calls to blow the default budget. Going live
// must not fail on a slow-but-working ProPresenter, so give them more room.
const LIVE_TIMEOUT_MS = 20000;

export class ProPresenterClient {
  constructor({ host, port }) {
    this.baseUrl = `http://${host}:${port}`;
    this.isLocalHost = LOCAL_HOSTNAMES.includes(host);
  }

  async #get(path, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      throw new Error(`ProPresenter API ${path} responded ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  }

  // Some endpoints (message triggering) are POST with a JSON body, unlike
  // the GET-based trigger/clear calls used everywhere else.
  async #post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      throw new Error(`ProPresenter API ${path} responded ${res.status}`);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  async testConnection() {
    await this.#get("/v1/status/layers");
    return true;
  }

  /**
   * Which output layers are showing something right now.
   * Performance mode uses this to tell whether a service is actually in
   * progress, which beats guessing from the day of the week.
   */
  async getLayerStatus() {
    return this.#get("/v1/status/layers");
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
          items.push({ id: item.uuid, name: item.name, folder: folder.name });
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
    return this.#get(`/v1/presentation/${presentationId}`, { timeoutMs: LIVE_TIMEOUT_MS });
  }

  /**
   * Real created/modified dates for a presentation, read from its .pro
   * file on disk — only possible when Refrain and ProPresenter are on
   * the same machine. Returns nulls (never throws) otherwise or on any
   * fs error (e.g. the file moved since the API listed it).
   */
  async getFileDates(presentationPath) {
    if (!this.isLocalHost || !presentationPath) {
      return { createdDate: null, modifiedDate: null };
    }
    try {
      const stats = await stat(presentationPath);
      return { createdDate: stats.birthtime.toISOString(), modifiedDate: stats.mtime.toISOString() };
    } catch {
      return { createdDate: null, modifiedDate: null };
    }
  }

  /** Triggers a slide live by presentation id + 0-based flat slide index. */
  async triggerSlide(presentationId, slideIndex) {
    await this.#get(`/v1/presentation/${presentationId}/${slideIndex}/trigger`, { timeoutMs: LIVE_TIMEOUT_MS });
  }

  /**
   * Switches the ProPresenter editor's own UI to show this presentation —
   * separate from triggerSlide, which only changes live output. Without
   * this, "Go Live" changes the screens but leaves the operator's editor
   * window sitting on whatever playlist item they had open.
   */
  async focusPresentation(presentationId) {
    await this.#get(`/v1/presentation/${presentationId}/focus`, { timeoutMs: LIVE_TIMEOUT_MS });
  }

  /**
   * Reads the slide that's live right now: which presentation and its
   * 0-based flat slide index (the same index space triggerSlide uses, so
   * the pair round-trips straight back through triggerSlide). Returns null
   * when nothing is live or the API doesn't report it, so callers can
   * degrade rather than arm a bogus "return" target.
   *
   * Response shape (PP v1):
   *   { presentation_index: { index, presentation_id: { uuid, name } } }
   */
  async getCurrentSlide() {
    const data = await this.#get("/v1/presentation/slide_index");
    const pi = data?.presentation_index;
    const uuid = pi?.presentation_id?.uuid;
    const index = pi?.index;
    if (!uuid || typeof index !== "number" || index < 0) return null;
    return { presentationId: uuid, slideIndex: index, name: pi.presentation_id.name ?? null };
  }

  // --- Live output controls (the "Live" page) ---
  // Looks and Macros are user-defined in ProPresenter, so the church's own
  // "Logo", "Black", "Motion", etc. come through by name rather than being
  // hardcoded here. Each list entry is { id: { uuid, name, index } }.

  /** The display Looks configured in this ProPresenter. */
  async getLooks() {
    return normalizeIdList(await this.#get("/v1/looks"));
  }

  /** Activates a Look by uuid (changes what each screen shows). */
  async triggerLook(id) {
    await this.#get(`/v1/look/${id}/trigger`);
  }

  /** The Macros configured in this ProPresenter. */
  async getMacros() {
    const raw = await this.#get("/v1/macros");
    // Mapped from the raw entries rather than by re-indexing the normalized
    // list: normalizeIdList drops anything without a uuid, so a single
    // malformed macro would shift every icon by one and quietly mislabel the
    // whole bank.
    //
    // The colour comes through now, and the earlier reasoning for dropping it
    // was half right. It was correct that an arbitrary hue cannot *fill* a
    // tile: the palette reserves saturated warm for what is live. It was wrong
    // that this meant discarding the colour, because a macro's colour is the
    // operator's own classification -- the same category as its name, and
    // "Refrain never restyles a name its user wrote".
    //
    // Both hold at once because a flat swatch with no glow and a lit collar
    // with a halo are categorically different objects. Printed ink is not
    // emission, so even a red macro swatch cannot be read as the live signal.
    return (Array.isArray(raw) ? raw : [])
      .map((entry) => ({
        id: entry?.id?.uuid,
        name: entry?.id?.name ?? "Untitled",
        icon: macroIcon(entry?.image_type),
        color: macroColorHex(entry?.color),
      }))
      .filter((entry) => entry.id);
  }

  /** Runs a Macro by uuid. */
  async triggerMacro(id) {
    await this.#get(`/v1/macro/${id}/trigger`);
  }

  /**
   * Clears one output layer. Valid layers per the API:
   * audio, props, messages, announcements, slide, media, video_input.
   */
  async clearLayer(layer) {
    await this.#get(`/v1/clear/layer/${layer}`);
  }

  // --- Messages (the on-screen announcement layer) ---
  // Messages are pre-built in ProPresenter with named tokens (a text field,
  // a timer, etc.). Refrain fills the text tokens and shows the message,
  // which is what makes an urgent "come to childcare" note a type-and-post
  // instead of a dig through ProPresenter's message UI.

  /**
   * The configured messages, each normalized to { id, name, tokens }, where
   * tokens is [{ name, kind: "text"|"timer" }]. Only text tokens are
   * fillable from Refrain; timer tokens are surfaced but not editable here.
   */
  async getMessages() {
    const list = await this.#get("/v1/messages");
    return (Array.isArray(list) ? list : [])
      .map((m) => ({
        id: m?.id?.uuid,
        name: m?.id?.name ?? "Untitled",
        tokens: extractMessageTokens(m),
      }))
      .filter((m) => m.id);
  }

  /**
   * Shows a message. `values` is [{ name, text }] for its text tokens;
   * they're sent in the token shape ProPresenter's trigger endpoint expects.
   */
  async triggerMessage(id, values) {
    const body = (values ?? []).map((v) => ({ name: v.name, text: { text: v.text ?? "" } }));
    await this.#post(`/v1/message/${id}/trigger`, body);
  }

  /** Hides a message that's currently showing. */
  async clearMessage(id) {
    await this.#get(`/v1/message/${id}/clear`);
  }
}

// Pulls token descriptors out of a message. ProPresenter has described
// tokens as entries inside `message_components` (mixed with plain static
// strings) and, in some shapes, as a `tokens` array — accept either, and
// treat a token as a timer only when it clearly is, defaulting to text.
function extractMessageTokens(message) {
  const raw = Array.isArray(message?.message_components)
    ? message.message_components
    : Array.isArray(message?.tokens)
      ? message.tokens
      : [];
  return raw
    .filter((c) => c && typeof c === "object" && (c.name ?? c.id?.name))
    .map((c) => ({
      name: c.name ?? c.id?.name,
      kind: c.timer || c.type === "timer" ? "timer" : "text",
    }));
}

// The list endpoints (looks, macros, and similar) return arrays of
// { id: { uuid, name, index } }. Flatten to the shape the UI needs, dropping
// anything without a usable uuid so a malformed entry can't render a dead button.
function normalizeIdList(list) {
  return (Array.isArray(list) ? list : [])
    .map((entry) => ({ id: entry?.id?.uuid, name: entry?.id?.name ?? "Untitled" }))
    .filter((entry) => entry.id);
}

/**
 * ProPresenter's macro icons, as a Lucide name.
 *
 * A macro carries an `image_type` -- the icon the operator picked for it in
 * ProPresenter -- from a small closed set. Reading it means a church's own
 * Timer, Bell and Megaphone macros arrive on the Live screen looking like
 * themselves, so a bank of 26 mono labels becomes scannable by shape rather
 * than by reading every one under pressure.
 *
 * A closed enum from ProPresenter's own API, so mapping it here is the same
 * kind of thing as reading `presentation_index` -- ProPresenter-specific by
 * nature, and confined to ProPresenter's own client file.
 *
 * Unknown values fall through to null rather than a guess: a wrong icon is
 * worse than none, because it makes the bank look scannable while lying.
 */
const MACRO_ICONS = {
  Sun: "sun",
  Bell: "bell",
  Timer: "timer",
  Megaphone: "megaphone",
  Audio: "volume-2",
  Exclamation: "circle-alert",
};

export function macroIcon(imageType) {
  return MACRO_ICONS[imageType] ?? null;
}

/**
 * A macro's colour, as hex, or null.
 *
 * ProPresenter reports colour as float components rather than a string:
 * `{ red, green, blue, alpha }` on 0..1. Verified across a real rig's 26
 * macros — all four keys present on every one, all alpha 1.
 *
 * **Anything malformed returns null rather than a colour.** The failure that
 * matters is degrading to black: a missing or broken value would otherwise
 * paint a confident black swatch, which is a classification the operator never
 * chose and indistinguishable from one they did. No colour must mean no swatch.
 *
 * Fully transparent counts as no colour for the same reason — a swatch nobody
 * can see is worse than an absent one, because the space still reads as
 * meaningful.
 */
export function macroColorHex(color) {
  if (!color || typeof color !== "object") return null;
  const { red, green, blue, alpha } = color;
  const parts = [red, green, blue];
  if (!parts.every((c) => typeof c === "number" && Number.isFinite(c))) return null;
  if (typeof alpha === "number" && alpha <= 0) return null;
  // Clamp rather than reject: floats round out to 1.0000001 and that is not a
  // malformed colour, it is arithmetic.
  const byte = (c) => Math.round(Math.min(1, Math.max(0, c)) * 255);
  return "#" + parts.map((c) => byte(c).toString(16).padStart(2, "0").toUpperCase()).join("");
}

export { normalizeText };
