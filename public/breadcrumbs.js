/**
 * The last few things the operator did, for a crash report.
 *
 * **Breadcrumbs record what was pressed, never what was found.** That is the
 * whole rule and it is not a style preference: a crash on Search would
 * otherwise carry slide text, a search query, or presentation names into a
 * report the operator pastes into an email. CLAUDE.md forbids committing real
 * church data; putting it in a bug report is the same thing with more steps.
 *
 *   Never   slide text, query strings, presentation or song names, lyrics,
 *           scripture, macro names (the operator wrote those), file paths.
 *   Yes     route, Refrain's own control ids and labels, HTTP method + path +
 *           status, timings, counts.
 *
 * So a search breadcrumb reads `search → 117 results`, never the query. A
 * presentation UUID is safe; its name is not.
 *
 * Memory only, never persisted. A ring buffer of twenty-five, which is roughly
 * a minute of real use and enough to see the shape of what led to a crash
 * without becoming a log.
 *
 * The redaction here is a second line of defence rather than the only one --
 * the operator sees the whole report before it goes anywhere, which is better
 * consent than any scrubbing rule. It exists because someone will paste
 * without reading.
 */

const MAX_CRUMBS = 25;

const crumbs = [];

/**
 * Values that are safe to record, by construction.
 *
 * Anything not a number, boolean, or short identifier-shaped string is dropped
 * rather than truncated. Truncating a lyric still leaves a lyric.
 */
const SAFE_KEY = /^[a-z][a-z0-9-]{0,31}$/i;

function safeValue(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    // UUIDs are safe (they name nothing); other free text is not.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return v;
    if (SAFE_KEY.test(v)) return v;
    return null;
  }
  return null;
}

/**
 * Records something the operator did.
 *
 * `detail` is filtered rather than trusted: every value has to survive
 * `safeValue`, so a caller that passes a song name gets it dropped instead of
 * recorded. Callers should not be relying on that, but the one time someone
 * does, the church's data stays on their machine.
 */
export function crumb(action, detail = {}) {
  if (!SAFE_KEY.test(String(action ?? ""))) return;
  const clean = {};
  for (const [k, v] of Object.entries(detail)) {
    if (!SAFE_KEY.test(k)) continue;
    const sv = safeValue(v);
    if (sv !== null) clean[k] = sv;
  }
  crumbs.push({ t: Date.now(), action, ...clean });
  if (crumbs.length > MAX_CRUMBS) crumbs.shift();
}

/** The trail, oldest first, with times relative to now so they read at a glance. */
export function readCrumbs(now = Date.now()) {
  return crumbs.map((c) => {
    const { t, action, ...rest } = c;
    return { ago: Math.round((now - t) / 100) / 10, action, ...rest };
  });
}

/** Exported for tests; there is no reason to call this from the app. */
export function resetCrumbs() {
  crumbs.length = 0;
}

export { MAX_CRUMBS };
