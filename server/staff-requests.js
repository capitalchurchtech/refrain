/**
 * Staff requests: a message another person wants on the screens, sent from the
 * church's own announcement app, that someone at this console has to approve.
 *
 * The flow, and why it is shaped this way:
 *
 * - **Refrain asks; nothing connects in.** This console polls the announcement
 *   server (the same address and key as the status feed in Settings >
 *   Telemetry) for requests waiting for it. Nothing listens on a port for the
 *   announcement app to reach, so a church needs no router setting and the
 *   console exposes nothing new.
 * - **Nothing displays without a press.** A request only ever becomes a card
 *   on Now. Approving posts it through the same message poster the operator
 *   uses; declining, or letting it expire, posts nothing.
 * - **It cannot go off late.** A request is good for eight minutes from when it
 *   was made, and an old one is dropped on arrival, so a pager code from before
 *   a service is never posted during one.
 * - **Safe to run twice.** Each request has the announcement server's own id.
 *   Once handled (shown, declined, expired) it is remembered, on disk, so a
 *   restart or a second poll never shows it again, and a second press on
 *   Approve is refused rather than posting twice.
 * - **The text is private.** A request can carry a child's code or a name. It is
 *   never written to a log, a diagnostic or the status feed; logs carry counts.
 *
 * Contract with the announcement server (version 1), all under the console
 * address, with the feed's `Authorization: Bearer <key>` and `X-Console-Id`:
 *   GET  /requests                    -> { requests: [{ id, text, from?, createdAt? }] }
 *   POST /requests/<id>/result        <- { status: "shown" | "declined" | "expired" }
 *
 * `createStaffRequests` takes everything it touches (fetch, the clock, the
 * message post, the saved list) so the tests run it with none of them real.
 */
import { serviceFeedProblems, TOKEN_ENV } from "./service-feed.js";

/** How long a request stays good for, from when it was made. */
export const REQUEST_TTL_MS = 8 * 60_000;
/** The longest message accepted: the same limit as a stage message. */
export const MAX_REQUEST_TEXT = 80;
/** More than this waiting at once is a flood, not a queue; the rest wait on the server. */
export const MAX_WAITING = 5;
const MAX_FETCHED = 20;
const MAX_HANDLED_KEPT = 200;
const POLL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * One request from the server, checked and tidied, or the reason it was not
 * accepted. `now` is the clock; a request made in the future (a clock that is
 * off) counts as made now, so it cannot live longer than eight minutes.
 * @returns {{ ok: true, request: object } | { ok: false, reason: string }}
 */
export function cleanRequest(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!ID.test(id)) return { ok: false, reason: "bad id" };
  // One line, no control characters: it goes into a ProPresenter message field.
  const plain = typeof raw.text === "string" ? [...raw.text].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("") : "";
  const text = plain.replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MAX_REQUEST_TEXT) return { ok: false, reason: "too long" };
  const made = raw.createdAt ? new Date(raw.createdAt).getTime() : NaN;
  const createdAt = Number.isFinite(made) ? Math.min(made, now) : now;
  const from = typeof raw.from === "string" ? raw.from.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  return { ok: true, request: { id, text, from: from || "Staff", createdAt, expiresAt: createdAt + REQUEST_TTL_MS } };
}

export function createStaffRequests({
  getModule,
  isOn,
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
  post,
  loadHandled,
  saveHandled,
  log = (...a) => console.log(...a),
}) {
  const waiting = new Map();
  let handled = new Set();
  let handledLoaded = false;
  const unreported = new Map(); // id -> status, for results the server has not heard yet
  const state = { lastOkAt: null, lastError: null };
  let polling = false;

  async function ensureLoaded() {
    if (handledLoaded) return;
    handledLoaded = true;
    try {
      const list = await loadHandled();
      handled = new Set(Array.isArray(list) ? list.filter((x) => typeof x === "string") : []);
    } catch {
      handled = new Set();
    }
  }

  async function remember(id) {
    handled.add(id);
    const kept = [...handled].slice(-MAX_HANDLED_KEPT);
    handled = new Set(kept);
    try {
      await saveHandled(kept);
    } catch (err) {
      // Kept in memory; a restart could show it once more, which is a repeat
      // and not a loss. Said, with no request text.
      log(`Couldn't save the handled staff requests (${err.message}).`);
    }
  }

  const usable = () => {
    const mod = getModule();
    if (!mod?.consoleId) return null;
    return serviceFeedProblems(mod, env).length ? null : mod;
  };

  /**
   * Why nothing will arrive, as a sentence for the person, or null. Switched on
   * without Telemetry set up is the likely one: the console id is only made when
   * the feed is switched on, and without it Refrain cannot ask for anything.
   */
  function problem() {
    if (!isOn()) return null;
    const mod = getModule();
    if (!mod?.consoleId) return "This console has no id yet. Switch Telemetry on once in Settings so Staff requests can ask the announcement server for requests.";
    return serviceFeedProblems(mod, env)[0] ?? null;
  }

  async function call(mod, path, init) {
    const res = await fetchImpl(`${mod.url.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), authorization: `Bearer ${env[TOKEN_ENV]}`, "x-console-id": mod.consoleId },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`The announcement server answered ${res.status}.`);
    return res;
  }

  async function report(mod, id, status) {
    try {
      await call(mod, `/requests/${encodeURIComponent(id)}/result`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      unreported.delete(id);
    } catch {
      // Not lost: told again on the next tick.
      unreported.set(id, status);
    }
  }

  /** Drops what has run out, remembering it so it never comes back. */
  async function expireOld(mod) {
    const t = now();
    for (const [id, r] of [...waiting]) {
      if (r.expiresAt > t) continue;
      waiting.delete(id);
      await remember(id);
      if (mod) await report(mod, id, "expired");
    }
  }

  /** One poll. Safe to call on a timer: a slow one is not stacked on. */
  async function tick() {
    if (polling) return;
    polling = true;
    try {
      await ensureLoaded();
      const mod = usable();
      await expireOld(mod);
      if (!isOn() || !mod) return;
      for (const [id, status] of [...unreported]) await report(mod, id, status);
      let body;
      try {
        body = await (await call(mod, "/requests", { method: "GET" })).json();
      } catch (err) {
        state.lastError = err.message;
        return;
      }
      state.lastOkAt = now();
      state.lastError = null;
      const list = Array.isArray(body?.requests) ? body.requests.slice(0, MAX_FETCHED) : [];
      for (const raw of list) {
        const c = cleanRequest(raw, now());
        if (!c.ok) continue;
        const r = c.request;
        if (handled.has(r.id) || waiting.has(r.id)) continue;
        if (r.expiresAt <= now()) {
          await remember(r.id);
          await report(mod, r.id, "expired");
          continue;
        }
        if (waiting.size >= MAX_WAITING) break;
        waiting.set(r.id, r);
      }
    } finally {
      polling = false;
    }
  }

  /** What is waiting now, oldest first. Only while the feature is on. */
  function list() {
    if (!isOn()) return [];
    const t = now();
    return [...waiting.values()].filter((r) => r.expiresAt > t).sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Post a waiting request. Refused if it is gone (answered, expired, or never
   * existed), so a second press cannot post twice. If ProPresenter refuses, the
   * request stays waiting and the error goes back to the person.
   */
  async function approve(id) {
    await ensureLoaded();
    const r = waiting.get(id);
    if (!r || r.expiresAt <= now()) return { ok: false, status: 409, error: "That request is no longer waiting." };
    // Taken out before the post so two presses at once cannot both post it.
    waiting.delete(id);
    try {
      await post(r.text, r);
    } catch (err) {
      waiting.set(id, r);
      return { ok: false, status: 502, error: err.message };
    }
    await remember(id);
    const mod = usable();
    if (mod) await report(mod, id, "shown");
    return { ok: true };
  }

  async function decline(id) {
    await ensureLoaded();
    if (!waiting.has(id)) return { ok: false, status: 409, error: "That request is no longer waiting." };
    waiting.delete(id);
    await remember(id);
    const mod = usable();
    if (mod) await report(mod, id, "declined");
    return { ok: true };
  }

  return { tick, list, approve, decline, state: () => ({ ...state, waiting: waiting.size, problem: problem() }), POLL_MS };
}
