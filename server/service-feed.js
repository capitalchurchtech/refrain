/**
 * Service feed: this console tells the church's own announcement server what
 * it is showing, and hands over its diagnostics log when a person presses Send
 * log on the Service screen, so a person in
 * another room can follow a service and review it later. Contract and the other
 * side's brief: docs/service-feed.md.
 *
 * **Off until a church turns it on, and it only ever talks to the one URL the
 * church typed in.** There is no default address and nothing is sent anywhere
 * the project controls: the README's "no telemetry" promise is about exactly
 * this, so the rule it keeps is that the destination is the operator's own.
 *
 * Core search does not import this. Nothing here reads ProPresenter; it reads
 * the heartbeat's cache and the diagnostics files Refrain already writes.
 *
 * **Status is latest-wins, so a failed push is simply dropped.** Logs are the
 * thing worth not losing: they are copied, never moved, and a day is only
 * marked sent once the server accepted exactly the bytes on disk, so a network
 * blip leaves it to be retried (CLAUDE.md, "never lose data silently").
 *
 * **Status only goes inside a window** (default Sunday 09:00 to 14:00, local
 * time), so a console left on all week is silent. Logs never go on their own.
 *
 * Pure functions are exported for tests; `createServiceFeed` is the one piece
 * with timers' worth of state, and takes its fetch and its clock as arguments.
 */

import { createHash } from "node:crypto";

export const FEED_PROTOCOL_VERSION = 1;
export const TOKEN_ENV = "SERVICE_FEED_TOKEN";
/** Beyond this a day's log is skipped, not truncated: half a log misleads. */
export const MAX_LOG_BYTES = 10 * 1024 * 1024;

const KEEPALIVE_MS = 30_000;
const MIN_GAP_MS = 2_000;
const BACKOFF_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

export const DEFAULT_WINDOWS = [{ days: ["sun"], from: "09:00", until: "14:00" }];
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ""));
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
};
const validWindow = (w) =>
  w && Array.isArray(w.days) && w.days.length && w.days.every((d) => DAYS.includes(String(d).toLowerCase())) &&
  toMinutes(w.from) !== null && toMinutes(w.until) !== null && toMinutes(w.from) < toMinutes(w.until);

/** The windows in force: the church's, or Sunday 9 to 2 when none are readable. */
export function effectiveWindows(mod) {
  const ok = Array.isArray(mod?.windows) ? mod.windows.filter(validWindow) : null;
  return ok?.length ? ok : DEFAULT_WINDOWS;
}

/**
 * Whether the feed may talk at all right now, in this machine's local time.
 * Outside every window nothing is sent: no status, no logs. A church that
 * clears the windows gets the default, never "always".
 */
export function inWindow(mod, date) {
  const t = date.getHours() * 60 + date.getMinutes();
  return effectiveWindows(mod).some(
    (w) => w.days.map((d) => String(d).toLowerCase()).includes(DAYS[date.getDay()]) && t >= toMinutes(w.from) && t < toMinutes(w.until)
  );
}

/**
 * Settings from the Telemetry tab, checked and tidied. Returns
 * { ok: true, value } or { ok: false, error } with a sentence for the person.
 * Only the fields the tab owns; consoleId and anything else is the caller's.
 */
export function cleanServiceFeedSettings(body) {
  const b = body ?? {};
  if (typeof b.enabled !== "boolean") return { ok: false, error: "enabled must be true or false" };
  const name = String(b.name ?? "").trim().slice(0, 60);
  const url = String(b.url ?? "").trim().slice(0, 300);
  const windows = Array.isArray(b.windows) ? b.windows : [];
  for (const w of windows) {
    if (!validWindow(w)) return { ok: false, error: "Each window needs at least one day and a start earlier than its end." };
  }
  return {
    ok: true,
    value: {
      enabled: b.enabled,
      name: name || null,
      url: url || null,
      includeSlideText: b.includeSlideText === true,
      windows: windows.map((w) => ({ days: DAYS.filter((d) => w.days.map((x) => String(x).toLowerCase()).includes(d)), from: w.from, until: w.until })),
    },
  };
}

/**
 * The config with the Telemetry tab's checked settings applied. Keeps whatever
 * else is in serviceFeedModule, and mints a console id the first time it is
 * turned on (null while it has never been on).
 */
export function applyServiceFeedSettings(config, value, makeId) {
  const prior = config.serviceFeedModule ?? {};
  return { ...config, serviceFeedModule: { ...prior, ...value, consoleId: prior.consoleId ?? (value.enabled ? makeId() : null) } };
}

/** Problems with the settings, as sentences. Empty means ready. */
export function serviceFeedProblems(mod, env = process.env) {
  const problems = [];
  const url = String(mod?.url ?? "").trim();
  if (!url) problems.push("No address set. Paste the announcement server's console address from its admin page.");
  else {
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch {
      problems.push("The address is not a web address.");
    }
    if (parsed && parsed.protocol !== "https:" && !isLoopback(parsed.hostname)) {
      problems.push("The address must start with https:// so the key is not sent in the clear.");
    }
  }
  if (!String(mod?.name ?? "").trim()) problems.push("This console needs a name (for example Main Campus FOH).");
  if (!env?.[TOKEN_ENV]) problems.push(`${TOKEN_ENV} is not set in .env. The announcement server issues one key per console.`);
  return problems;
}

function isLoopback(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

/** The status body. Slide text only goes if the church asked for it. */
export function buildStatus({ live, mod, consoleId, appVersion, seq, now }) {
  const slide = live?.slide
    ? {
        presentationName: live.slide.presentationName ?? null,
        arrangementName: live.slide.arrangementName ?? null,
        slideIndex: live.slide.slideIndex ?? null,
        slideCount: live.slide.slideCount ?? null,
        ...(mod?.includeSlideText ? { text: live.slide.text ?? null } : {}),
      }
    : null;
  return {
    v: FEED_PROTOCOL_VERSION,
    consoleId,
    name: String(mod?.name ?? "").trim(),
    appVersion,
    seq,
    sentAt: new Date(now).toISOString(),
    connected: Boolean(live?.connected),
    live: Boolean(live?.live),
    liveSince: live?.liveSince ?? null,
    performanceMode: Boolean(live?.performanceMode?.armed),
    slide,
  };
}

/** What changed matters, what ticked does not: a fingerprint without timestamps. */
export function statusFingerprint(status) {
  const rest = { ...status, seq: null, sentAt: null };
  return createHash("sha1").update(JSON.stringify(rest)).digest("hex");
}

/**
 * Day files to send: those whose size is not what the server last accepted,
 * oldest first. `files` is [{ name, size }], `sent` is { name: size }.
 */
export function logsToSend(files, sent = {}) {
  return files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f.name) && f.size > 0 && f.size !== sent[f.name])
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A failure the church has to fix, not wait out: wrong key, wrong address, a fifth console. */
export function isConfigFailure(status) {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export function failureSentence(status) {
  if (status === 401) return "The announcement server did not accept this console's key.";
  if (status === 400) return "The announcement server didn't understand this station's status. Refrain may be out of date with it.";
  if (status === 403) return "This key belongs to a different console id. After reinstalling Refrain, an admin must press Reset key on the announcement server and issue a new key.";
  if (status === 404) return "The announcement server has no such address. Check the console address.";
  if (status === 413) return "The announcement server said that was too large.";
  return `The announcement server answered ${status}.`;
}

export function createServiceFeed({
  getModule,
  getLive,
  isFrozen = () => false,
  appVersion,
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
  listLogs,
  readLog,
  loadSent,
  saveSent,
}) {
  let seq = 0;
  let lastFingerprint = null;
  let lastPushAt = 0;
  let holdUntil = 0;
  const state = { lastOkAt: null, lastError: null, lastLogOkAt: null };

  // Set up well enough to talk to the server, whether or not it is switched on.
  const usable = () => {
    const mod = getModule();
    return mod?.consoleId && !serviceFeedProblems(mod, env).length ? mod : null;
  };
  const ready = () => {
    const mod = usable();
    return mod?.enabled && inWindow(mod, new Date(now())) ? mod : null;
  };
  let goodbyeTries = 0;
  // Whether the last status the server heard said something was live. The
  // server only raises a problem for a console that was live and then went
  // quiet, so a window that closes mid-service must say "not live" on the way out.
  let lastPushedLive = false;

  // `status` is whether a refusal should be remembered and back status off.
  // A log upload's refusal is reported to the person who pressed the button and
  // must not silence live status.
  async function send(mod, path, init, { status = true } = {}) {
    const res = await fetchImpl(`${mod.url.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${env[TOKEN_ENV]}`, "x-console-id": mod.consoleId },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return;
    const sentence = isConfigFailure(res.status) ? failureSentence(res.status) : `The announcement server answered ${res.status}. Trying again shortly.`;
    if (status) {
      state.lastError = sentence;
      if (isConfigFailure(res.status)) holdUntil = now() + BACKOFF_MS;
    }
    throw new Error(sentence);
  }

  /** Called every couple of seconds. Pushes on change, and every 30s as proof of life. */
  async function tickStatus() {
    const mod = ready();
    if (!mod && lastPushedLive && usable() && goodbyeTries < 3 && now() >= holdUntil && now() - lastPushAt >= KEEPALIVE_MS) return sayGoodbye(usable());
    if (!mod || now() < holdUntil) return false;
    const status = buildStatus({ live: getLive(), mod, consoleId: mod.consoleId, appVersion, seq: seq + 1, now: now() });
    const fp = statusFingerprint(status);
    const changed = fp !== lastFingerprint;
    const due = now() - lastPushAt >= (changed ? MIN_GAP_MS : KEEPALIVE_MS);
    if (!due) return false;
    try {
      await send(mod, "/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(status) });
      seq += 1;
      lastFingerprint = fp;
      lastPushedLive = status.live;
      goodbyeTries = 0;
      lastPushAt = now();
      state.lastOkAt = lastPushAt;
      state.lastError = null;
      return true;
    } catch (err) {
      // Dropped on purpose: the next beat carries newer truth than this one did.
      state.lastError ??= err.message;
      lastPushAt = now();
      return false;
    }
  }

  /** One last status as a window closes on a live console, so the server reads it as ended, not lost. */
  async function sayGoodbye(mod) {
    const status = buildStatus({ live: { ...getLive(), live: false, slide: null }, mod, consoleId: mod.consoleId, appVersion, seq: seq + 1, now: now() });
    try {
      await send(mod, "/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(status) });
      seq += 1;
      lastPushedLive = false;
      lastFingerprint = null;
      goodbyeTries = 0;
      return true;
    } catch {
      // Tried again in 30 seconds, three times at most, then left: the window is closed.
      goodbyeTries += 1;
      lastPushAt = now();
      return false;
    }
  }

  /**
   * Sends every day's log the server has not already accepted. Only ever run
   * by a person pressing the button on the Service screen: nothing about logs
   * is automatic, because the log is for review afterwards, not for watching.
   * Not limited to the send windows (a person pressing it is the authority),
   * but refused during performance mode, and each file only goes if its size
   * changed since the server last accepted it.
   * @returns {Promise<{ ok: boolean, sent: number, failed: number, tooBig: number, error?: string }>}
   */
  async function sendLogs() {
    const mod = getModule();
    if (!mod?.enabled || !mod.consoleId || serviceFeedProblems(mod, env).length) {
      return { ok: false, sent: 0, failed: 0, tooBig: 0, error: "Telemetry isn't set up. Check Settings > Telemetry." };
    }
    if (isFrozen()) return { ok: false, sent: 0, failed: 0, tooBig: 0, error: "Performance mode is on. Send the log once the service is over." };
    // What the server accepted is remembered per address and console id, so
    // pointing Refrain at a different server starts that server from nothing.
    const target = `${mod.url}|${mod.consoleId}`;
    const saved = await loadSent();
    let sent = saved?.target === target ? saved.days ?? {} : {};
    const todo = logsToSend(await listLogs(), sent);
    const out = { ok: true, sent: 0, failed: 0, tooBig: todo.filter((f) => f.size > MAX_LOG_BYTES).length };
    for (const file of todo.filter((f) => f.size <= MAX_LOG_BYTES)) {
      const body = await readLog(file.name);
      try {
        await send(mod, `/logs/${file.name}`, { method: "PUT", headers: { "content-type": "application/x-ndjson" }, body }, { status: false });
      } catch (err) {
        out.failed += 1;
        out.error = err.message;
        break; // the same answer would come back for the rest
      }
      // Marked by the size it had on disk when listed (the number logsToSend
      // compares), so a line appended meanwhile goes next time.
      sent = { ...sent, [file.name]: file.size };
      await saveSent({ target, days: sent });
      out.sent += 1;
      state.lastLogOkAt = now();
    }
    out.ok = out.failed === 0;
    return out;
  }

  return {
    tickStatus,
    sendLogs,
    state: () => ({ ...state, ready: Boolean(ready()), inWindow: inWindow(getModule(), new Date(now())) }),
  };
}
