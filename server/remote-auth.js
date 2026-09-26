/**
 * The phone page's PIN (owner request): a daily PIN, where to find it, and
 * "trust this phone".
 *
 * - **Daily PIN.** Four digits derived from a secret kept on this machine and
 *   today's date, so it changes at midnight with nothing to schedule and
 *   nothing to write down. The booth sees today's PIN on the Flags screen and
 *   on Health, and the phone page says where to find it (`pinHint`).
 * - **A fixed PIN** still works, for a church that would rather print one.
 * - **Trusted phones.** A correct PIN earns a signed token: until midnight
 *   by default, or 30 days if the person ticks "Trust this phone". Tokens
 *   are checked by signature, so nothing per phone is stored, and a trusted
 *   phone isn't asked again when the daily PIN changes.
 * - **Forget all phones** replaces the secret: every token stops working and
 *   the daily PIN changes with it.
 *
 * Four digits is deliberate: it's read aloud across a room. Guessing is held
 * back by a per-device limit on attempts (see server/remote.js).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TRUST_DAYS = 30;

const hmac = (secret, text) => createHmac("sha256", secret).update(text).digest();

/** Today's PIN for this secret: four digits, the same all day, different tomorrow. */
export function dailyPin(secret, day) {
  const n = hmac(secret, `pin:${day}`).readUInt32BE(0) % 10_000;
  return String(n).padStart(4, "0");
}

/** Whether a typed PIN matches, compared in constant time. */
export function pinMatches(typed, expected) {
  const a = Buffer.from(String(typed ?? "").trim());
  const b = Buffer.from(String(expected ?? ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** The end of the local day containing `now`, as ms. */
export function endOfDay(now = Date.now()) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

/**
 * A signed token for one phone: until midnight, or TRUST_DAYS if trusted.
 * Its middle part is the phone's own id, which the booth uses to approve a
 * phone for control or to remove it (see server/remote-devices.js).
 */
export function issueToken(secret, { trust = false, now = Date.now(), deviceId = newDeviceId() } = {}) {
  const expires = trust ? now + TRUST_DAYS * 86_400_000 : endOfDay(now);
  const body = `${expires}.${deviceId}`;
  return { token: `${body}.${hmac(secret, body).toString("base64url")}`, expires, deviceId };
}

export function newDeviceId() {
  return randomBytes(9).toString("base64url");
}

/** The phone id in a token signed with this secret and not expired, or null. */
export function tokenDevice(secret, token, now = Date.now()) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [expires, deviceId, sig] = parts;
  if (!/^\d+$/.test(expires) || Number(expires) < now || !/^[A-Za-z0-9_-]{6,32}$/.test(deviceId)) return null;
  const expected = hmac(secret, `${expires}.${deviceId}`);
  const given = Buffer.from(sig, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected) ? deviceId : null;
}

/** Whether a token was signed with this secret and hasn't expired. */
export function tokenValid(secret, token, now = Date.now()) {
  return tokenDevice(secret, token, now) !== null;
}

export function newSecret() {
  return randomBytes(32).toString("hex");
}
