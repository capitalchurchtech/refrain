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

/**
 * One path segment, encoded.
 *
 * Every id below arrives from a request body, and until now went into the URL
 * raw. For a real uuid or layer name this is a no-op -- hex, dashes and
 * underscores all pass through untouched -- so the only thing it changes is
 * the case where the value is not what it should be: an id containing `/` or
 * `..` would otherwise resolve to a different ProPresenter endpoint than the
 * one the method name claims.
 *
 * Not reachable from outside the machine (the server binds 127.0.0.1, only
 * `express.json()` is mounted so a cross-origin simple request cannot fill
 * `req.body`, and no side-effecting GET route exists). Closed anyway, because
 * "unreachable" is a property of three other files staying the way they are.
 */
const seg = (value) => encodeURIComponent(String(value ?? ""));

const DEFAULT_TIMEOUT_MS = 8000;
// Triggering, focusing and reading a presentation make ProPresenter do real
// work (loading a document, pushing to outputs) and it appears to serialize
// API requests, so on a busy machine these measured several seconds each —
// enough for a few back-to-back calls to blow the default budget. Going live
// must not fail on a slow-but-working ProPresenter, so give them more room.
const LIVE_TIMEOUT_MS = 20000;

// Told about every call (path, time taken, whether it worked), for the
// service log (server/service-log.js). One listener; null when nobody asked.
let callObserver = null;
export function onProPresenterCall(fn) {
  callObserver = fn;
}
// Timed through `read`, which consumes the body: a document read can get its
// headers in 200ms and spend seconds streaming the rest, or time out while it
// does, and that's exactly the call the service log exists to catch.
async function timedFetch(path, url, init, read) {
  const started = performance.now();
  let ok = false;
  try {
    const res = await fetch(url, init);
    ok = res.ok;
    const out = await read(res);
    callObserver?.({ path, ms: performance.now() - started, ok, timedOut: false });
    return out;
  } catch (err) {
    callObserver?.({ path, ms: performance.now() - started, ok: false, timedOut: err?.name === "TimeoutError" });
    throw err;
  }
}

export class ProPresenterClient {
  constructor({ host, port }) {
    this.baseUrl = `http://${host}:${port}`;
    this.isLocalHost = LOCAL_HOSTNAMES.includes(host);
  }

  async #get(path, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return timedFetch(path, `${this.baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) }, async (res) => {
      if (!res.ok) {
        throw new Error(`ProPresenter API ${path} responded ${res.status}`);
      }
      return res.status === 204 ? null : res.json();
    });
  }

  // Some endpoints (message triggering) are POST with a JSON body, unlike
  // the GET-based trigger/clear calls used everywhere else.
  async #post(path, body) {
    return timedFetch(
      path,
      `${this.baseUrl}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      },
      async (res) => {
        if (!res.ok) {
          throw new Error(`ProPresenter API ${path} responded ${res.status}`);
        }
        return res.status === 204 ? null : res.json().catch(() => null);
      }
    );
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
    return (await this.getLibraryDetailed(folderNames)).items;
  }

  /**
   * The same crawl, plus what went wrong doing it.
   *
   * Two silent failures used to live here. Folder names were matched with
   * `folderNames.includes(f.name)`, so a config saying "songs" against a
   * ProPresenter folder called "Songs" matched nothing and produced an empty
   * index with no explanation. And a folder that timed out was written to the
   * console and its presentations were simply absent from search -- the crawl
   * circuit breaker catches a total collapse, not one folder quietly missing.
   *
   * Both are now reported. Matching is case- and whitespace-insensitive, and
   * the crawl says which configured names it could not find, which folders
   * threw, and what names were actually available -- because "you typed Songs
   * and this library has Song" is the whole answer, and the operator cannot
   * get to it from an empty result.
   *
   * Iterates ProPresenter's folder order rather than the config's, which keeps
   * the previous ordering and means a duplicated or twice-matching config
   * entry cannot crawl the same folder twice.
   */
  async getLibraryDetailed(folderNames = null) {
    const all = (await this.getLibraryFolders()) ?? [];
    const availableFolders = all.map((f) => f.name);
    let wanted = all;
    let unmatchedNames = [];

    if (folderNames) {
      const want = new Set(folderNames.map(normalizeFolderName));
      wanted = all.filter((f) => want.has(normalizeFolderName(f.name)));
      const found = new Set(wanted.map((f) => normalizeFolderName(f.name)));
      unmatchedNames = folderNames.filter((n) => !found.has(normalizeFolderName(n)));
    }

    const items = [];
    const failedFolders = [];
    for (const folder of wanted) {
      try {
        const folderContents = await this.#get(`/v1/library/${seg(folder.uuid)}`);
        for (const item of folderContents?.items ?? []) {
          items.push({ id: item.uuid, name: item.name, folder: folder.name });
        }
      } catch (err) {
        // One folder failing or timing out shouldn't abort the whole crawl --
        // but it must not vanish either.
        console.log(`  library folder "${folder.name}" failed: ${err.message}`);
        failedFolders.push({ name: folder.name, error: err.message });
      }
    }
    return { items, failedFolders, unmatchedNames, availableFolders };
  }

  /** Recursive playlist tree (folders/groups containing playlists). */
  /**
   * The Look that's on now, by name. ProPresenter reports it with its own
   * id for the live copy, which doesn't match the id in the Looks list, so
   * callers match on the name. Null if it can't say.
   */
  async getCurrentLook() {
    const look = await this.#get("/v1/look/current");
    const name = look?.id?.name;
    return typeof name === "string" && name ? { name } : null;
  }

  /** The theme tree: folders of themes, each with its slide layouts. Read-only. */
  async getThemes() {
    return this.#get("/v1/themes");
  }

  async getPlaylists() {
    return this.#get("/v1/playlists");
  }

  /** A single playlist's items — filters to actual presentations. */
  async getPlaylistItems(playlistId) {
    const playlist = await this.#get(`/v1/playlist/${seg(playlistId)}`);
    const items = (playlist?.items ?? [])
      .filter((item) => item.type === "presentation" && item.presentation_info?.presentation_uuid)
      .map((item) => ({
        id: item.presentation_info.presentation_uuid,
        name: item.id?.name ?? "Untitled",
        // Tells apart one presentation used several times in a playlist (a
        // pre-roll at the start, the intermission and the end).
        arrangementName: item.presentation_info.arrangement_name ?? null,
        // The arrangement the entry points at, by id. A playlist can point at
        // one the presentation no longer has, and ProPresenter falls back
        // silently (issue #5), so this is what the pre-service check compares.
        arrangementUuid: item.presentation_info.arrangement_uuid ?? null,
      }));
    return { items };
  }

  /**
   * Full presentation document, including slide text, for a given id.
   *
   * `timeoutMs` is overridable because this call serves two very different
   * jobs. Indexing can afford to wait out a busy ProPresenter. The Go Live
   * path cannot: there it is optional pre-work ahead of the actual trigger,
   * so it gets a short budget and the caller proceeds without it.
   */
  async getPresentation(presentationId, { timeoutMs = LIVE_TIMEOUT_MS } = {}) {
    return this.#get(`/v1/presentation/${seg(presentationId)}`, { timeoutMs });
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

  /**
   * The next or previous slide of the presentation that's on the screens.
   * Deliberately not /v1/trigger/next: that follows ProPresenter's focused
   * playlist, so with a song put up from Refrain it jumped to the next
   * playlist item (Announcements) instead of the song's next slide. Measured
   * on ProPresenter 21.3. Used by an approved phone, after a confirm press.
   */
  async triggerNext() {
    await this.#get("/v1/presentation/active/next/trigger", { timeoutMs: LIVE_TIMEOUT_MS });
  }

  async triggerPrevious() {
    await this.#get("/v1/presentation/active/previous/trigger", { timeoutMs: LIVE_TIMEOUT_MS });
  }

  /**
   * A small picture of one slide (JPEG), for the current and next previews.
   * About 50ms and 25KB at 400px. Callers cache it: it's asked for only when
   * the live slide changes. Null if ProPresenter can't render it.
   */
  // 240px wide: sharp enough for a phone tile or the Live preview. Each new
  // slide drawn costs ProPresenter memory it keeps until it restarts, measured
  // at ~2.4 MB at 400 and ~0.7 MB at 160 (2026-09-27).
  async getSlideThumbnail(presentationId, slideIndex, { quality = 240 } = {}) {
    const thumbPath = `/v1/presentation/${seg(presentationId)}/thumbnail/${seg(slideIndex)}`;
    return timedFetch(thumbPath, `${this.baseUrl}${thumbPath}?quality=${seg(quality)}`, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) }, async (res) => {
      if (!res.ok) return null;
      return { type: res.headers.get("content-type") || "image/jpeg", bytes: Buffer.from(await res.arrayBuffer()) };
    });
  }

  /** Triggers a slide live by presentation id + 0-based flat slide index. */
  async triggerSlide(presentationId, slideIndex) {
    await this.#get(`/v1/presentation/${seg(presentationId)}/${seg(slideIndex)}/trigger`, { timeoutMs: LIVE_TIMEOUT_MS });
  }

  /**
   * Switches the ProPresenter editor's own UI to show this presentation —
   * separate from triggerSlide, which only changes live output. Without
   * this, "Go Live" changes the screens but leaves the operator's editor
   * window sitting on whatever playlist item they had open.
   */
  async focusPresentation(presentationId) {
    await this.#get(`/v1/presentation/${seg(presentationId)}/focus`, { timeoutMs: LIVE_TIMEOUT_MS });
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
  async getCurrentSlide({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const data = await this.#get("/v1/presentation/slide_index", { timeoutMs });
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
    await this.#get(`/v1/look/${seg(id)}/trigger`);
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
    await this.#get(`/v1/macro/${seg(id)}/trigger`);
  }

  /**
   * Clears one output layer. Valid layers per the API:
   * audio, props, messages, announcements, slide, media, video_input.
   */
  async clearLayer(layer) {
    await this.#get(`/v1/clear/layer/${seg(layer)}`);
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
        // What it says now, and whether it's on the screens: shown beside
        // Show / Take down, so the operator can see which one is up.
        text: typeof m?.message === "string" ? m.message : null,
        active: Boolean(m?.is_active),
      }))
      .filter((m) => m.id);
  }

  /**
   * Shows a message. `values` is [{ name, text }] for its text tokens;
   * they're sent in the token shape ProPresenter's trigger endpoint expects.
   */
  async triggerMessage(id, values) {
    const body = (values ?? []).map((v) => ({ name: v.name, text: { text: v.text ?? "" } }));
    await this.#post(`/v1/message/${seg(id)}/trigger`, body);
  }

  /** Hides a message that's currently showing. */
  async clearMessage(id) {
    await this.#get(`/v1/message/${seg(id)}/clear`);
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
/** Folder names are compared the way a person would read them, not byte-wise. */
function normalizeFolderName(name) {
  return String(name ?? "").trim().toLowerCase();
}

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
