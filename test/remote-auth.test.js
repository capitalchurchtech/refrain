import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyPin, pinMatches, issueToken, tokenValid, endOfDay, newSecret, TRUST_DAYS } from "../server/remote-auth.js";

test("the daily PIN is four digits, steady all day, and changes over the days", () => {
  const s = "church-secret";
  const today = dailyPin(s, "2026-09-27");
  assert.match(today, /^\d{4}$/);
  assert.equal(dailyPin(s, "2026-09-27"), today);
  const week = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"].map((d) => dailyPin(s, d));
  assert.ok(week.some((p) => p !== today), "it rotates");
});

test("PINs compare exactly, spaces around allowed, blank never matches", () => {
  assert.equal(pinMatches(" 0421 ", "0421"), true);
  assert.equal(pinMatches("421", "0421"), false);
  assert.equal(pinMatches("", ""), false);
});

test("a token lasts until midnight, or thirty days when the phone is trusted", () => {
  const now = new Date(2026, 8, 27, 10, 0).getTime();
  const s = newSecret();
  const day = issueToken(s, { now });
  assert.equal(day.expires, endOfDay(now));
  assert.equal(tokenValid(s, day.token, now + 3_600_000), true);
  assert.equal(tokenValid(s, day.token, endOfDay(now) + 1), false, "gone after midnight");
  const trusted = issueToken(s, { trust: true, now });
  assert.equal(tokenValid(s, trusted.token, now + (TRUST_DAYS - 1) * 86_400_000), true);
  assert.equal(tokenValid(s, trusted.token, now + (TRUST_DAYS + 1) * 86_400_000), false);
});

test("forgetting all phones (a new secret) invalidates every token; a forged one never passes", () => {
  const s = newSecret();
  const { token } = issueToken(s, { trust: true });
  assert.equal(tokenValid(newSecret(), token), false);
  const [exp, nonce] = token.split(".");
  assert.equal(tokenValid(s, `${Number(exp) + 999999}.${nonce}.${token.split(".")[2]}`), false, "extending the expiry breaks the signature");
  assert.equal(tokenValid(s, "junk"), false);
});
