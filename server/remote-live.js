/**
 * Going live from a phone (owner decision, 2026-10-09; it reverses "a phone
 * never moves slides" of 2026-10-04).
 *
 * Three gates, none of which is skippable by sending a request by hand:
 *
 *  1. **The booth's switch** (`networkModule.phoneGoLive`). Off unless a person
 *     at this Mac turns it on, and turning it off stops every phone at once,
 *     because the switch is read on every request.
 *  2. **The device code**, once a month per phone. It is the phone's permission
 *     for the things beyond flagging and reading: Search, Alerts (which also need
 *     the booth's approval by name) and going live (owner, 2026-10-11: any phone
 *     with the PIN could otherwise fill the stage or keep the booth's search
 *     busy). Four digits derived from the
 *     phone secret and the calendar month, shown only at the booth. A phone
 *     that has typed it is allowed until the month ends; a new month, Forget
 *     all phones, or removing the phone locks it again.
 *  3. **A request code**, every go-live. The server makes a random four digits
 *     for one slide on one phone, the phone shows it, and the person types it
 *     back. It is there to stop a pocket press, not to prove who holds the
 *     phone (the device code does that). Then a separate confirm press sends it.
 *
 * Wrong codes of either kind are counted per phone: three wrong in a row locks
 * that phone out for five minutes. The device code also has a daily cap across
 * every phone (pinFailureGuard), as the sign-in PIN does.
 *
 * Pure, so the rules are tested without a network or ProPresenter.
 */

import { createHmac, randomInt } from "node:crypto";
import { pinMatches } from "./remote-auth.js";

export const REQUEST_TTL_MS = 60_000;
export const MAX_WRONG = 3;
export const LOCK_MS = 5 * 60_000;

/** "2026-10": the calendar month, in local time, that a device code belongs to. */
export function monthKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The first moment of next month, local time: when a phone's permission ends. */
export function endOfMonth(now = Date.now()) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
}

/** This month's device code: four digits, the same all month, different next month. */
export function deviceCode(secret, month) {
  const n = createHmac("sha256", secret).update(`golive:${month}`).digest().readUInt32BE(0) % 10_000;
  return String(n).padStart(4, "0");
}

export const deviceCodeMatches = pinMatches;

const fourDigits = () => String(randomInt(0, 10_000)).padStart(4, "0");

/**
 * Wrong-code counting and the request codes, in memory (a restart clears
 * both, which only ever makes a phone start again, never go live).
 */
export function createLiveGate({ ttlMs = REQUEST_TTL_MS, maxWrong = MAX_WRONG, lockMs = LOCK_MS, codeOf = fourDigits, idOf = () => Math.random().toString(36).slice(2, 12) } = {}) {
  const wrong = new Map(); // deviceId -> consecutive wrong codes
  const lockedUntil = new Map(); // deviceId -> ms
  const pending = new Map(); // requestId -> { deviceId, action, code, expires }

  const lockedMs = (deviceId, now) => Math.max(0, (lockedUntil.get(deviceId) ?? 0) - now);
  const sweep = (now) => {
    for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  };
  /** Counts a wrong code. Returns how many tries are left, 0 meaning the phone just got locked. */
  const fail = (deviceId, now) => {
    const n = (wrong.get(deviceId) ?? 0) + 1;
    if (n >= maxWrong) {
      wrong.delete(deviceId);
      lockedUntil.set(deviceId, now + lockMs);
      for (const [k, v] of pending) if (v.deviceId === deviceId) pending.delete(k);
      return 0;
    }
    wrong.set(deviceId, n);
    return maxWrong - n;
  };

  return {
    lockedMs,
    /** A wrong device code. */
    failDevice: fail,
    /** A right one clears the count. */
    succeed(deviceId) {
      wrong.delete(deviceId);
    },
    /**
     * A phone asks to put one slide up: the server makes the code. One open
     * request per phone, so asking again replaces the last.
     */
    request(deviceId, action, now = Date.now()) {
      if (lockedMs(deviceId, now)) return { ok: false, lockedMs: lockedMs(deviceId, now) };
      sweep(now);
      for (const [k, v] of pending) if (v.deviceId === deviceId) pending.delete(k);
      const requestId = idOf();
      const code = codeOf();
      pending.set(requestId, { deviceId, action, code, expires: now + ttlMs });
      return { ok: true, requestId, code };
    },
    /**
     * The typed code. Right: the request is used up and its action returned.
     * Wrong: counted, and the phone gets a fresh code for the same slide.
     */
    approve(deviceId, requestId, typed, now = Date.now()) {
      if (lockedMs(deviceId, now)) return { ok: false, lockedMs: lockedMs(deviceId, now) };
      const p = pending.get(String(requestId ?? ""));
      if (!p || p.deviceId !== deviceId || p.expires < now) {
        pending.delete(String(requestId ?? ""));
        return { ok: false, expired: true };
      }
      if (!pinMatches(typed, p.code)) {
        const left = fail(deviceId, now);
        if (!left) return { ok: false, lockedMs: lockedMs(deviceId, now) };
        p.code = codeOf();
        p.expires = now + ttlMs;
        return { ok: false, wrong: true, left, code: p.code };
      }
      pending.delete(String(requestId));
      wrong.delete(deviceId);
      return { ok: true, action: p.action };
    },
  };
}

/** The booth's log of phone take-overs, newest first, capped. A line never holds a code. */
export function appendTakeover(log, entry, { max = 200 } = {}) {
  const line = {
    at: entry.at ?? new Date().toISOString(),
    phone: String(entry.phone ?? "A phone").slice(0, 40),
    slide: String(entry.slide ?? "").slice(0, 120),
    replaced: entry.replaced == null ? null : String(entry.replaced).slice(0, 120),
    ok: entry.ok !== false,
    ...(entry.ok === false && entry.error ? { error: String(entry.error).slice(0, 160) } : {}),
  };
  return [line, ...(Array.isArray(log) ? log : [])].slice(0, max);
}
