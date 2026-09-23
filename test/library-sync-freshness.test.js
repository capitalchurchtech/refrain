import test from "node:test";
import assert from "node:assert/strict";
import { formatAge, describeBackupStatus, STALE_AFTER_MS } from "../public/library-sync.js";
import { renderShareLibraryFreshness } from "../public/health.js";

// --- formatAge ---------------------------------------------------------

test("formatAge scales from moments to weeks in the words a volunteer would use", () => {
  assert.equal(formatAge(0), "moments ago");
  assert.equal(formatAge(30_000), "moments ago");
  assert.equal(formatAge(60_000), "1 minute ago");
  assert.equal(formatAge(5 * 60_000), "5 minutes ago");
  assert.equal(formatAge(60 * 60_000), "1 hour ago");
  assert.equal(formatAge(3 * 60 * 60_000), "3 hours ago");
  assert.equal(formatAge(24 * 60 * 60_000), "1 day ago");
  assert.equal(formatAge(4 * 24 * 60 * 60_000), "4 days ago");
  assert.equal(formatAge(21 * 24 * 60 * 60_000), "3 weeks ago");
});

test("formatAge never returns a negative or garbage age", () => {
  assert.equal(formatAge(-500), "just now");
  assert.equal(formatAge(NaN), "just now");
  assert.equal(formatAge(undefined), "just now");
});

// --- describeBackupStatus ------------------------------------------------

const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 60 * 60_000).toISOString();
const MATCHED = { toCopy: 0, toReplace: 0, sourceCount: 40, destCount: 40, unchanged: 40, extra: 0 };
const DRIFTED = { toCopy: 1, toReplace: 2, sourceCount: 40, destCount: 39, unchanged: 37, extra: 0 };

test("never synced at all", () => {
  const r = describeBackupStatus({ lastRun: null, preview: null });
  assert.match(r.text, /never synced/i);
  assert.equal(r.stale, false, "nothing to flag as stale when there is no baseline yet");
});

test("current and confirmed matching the live library", () => {
  const r = describeBackupStatus({ lastRun: { at: hoursAgo(1), ok: true }, preview: MATCHED });
  assert.equal(r.stale, false);
  assert.match(r.text, /current/i);
  assert.match(r.text, /matches the live library/i);
});

test("current by the clock, but drifted since — the case this feature exists for", () => {
  // A sync an hour ago is not stale, but three files have already changed
  // since, so "current" alone would be a false all-clear.
  const r = describeBackupStatus({ lastRun: { at: hoursAgo(1), ok: true }, preview: DRIFTED });
  assert.equal(r.stale, false);
  assert.match(r.text, /missing 3 files/);
});

test("past the staleness threshold, flagged even if it once matched", () => {
  const r = describeBackupStatus({ lastRun: { at: hoursAgo(50), ok: true }, preview: MATCHED });
  assert.equal(STALE_AFTER_MS, 48 * 60 * 60_000, "sanity: the test's 50h is past the real threshold");
  assert.equal(r.stale, true);
  assert.match(r.text, /stale/i);
});

test("no live comparison available — ProPresenter closed, so only the age is known", () => {
  const r = describeBackupStatus({ lastRun: { at: hoursAgo(2), ok: true }, preview: null });
  assert.equal(r.stale, false);
  assert.match(r.text, /current/i);
  assert.doesNotMatch(r.text, /matches|missing/i, "no preview means no claim about matching");
});

test("a refused attempt is reported honestly, not as a successful sync", () => {
  const r = describeBackupStatus({
    lastRun: { at: hoursAgo(3), ok: false, reason: "ProPresenter is running." },
    preview: null,
  });
  assert.equal(r.stale, true, "a refusal is never good news, whatever the clock says");
  assert.match(r.text, /refused/i);
  assert.match(r.text, /ProPresenter is running/);
  assert.doesNotMatch(r.text, /\.\./, "the reason already ends in a period — a second one reads as a typo");
});

// --- renderShareLibraryFreshness (Health's compact card) ------------------
//
// A caught bug, found by code review: this card used to compute "stale"
// straight from the clock, so a refusal from a minute ago rendered dim and
// unflagged (opacity-70) while the dedicated Library Sync screen -- built on
// the same data, via describeBackupStatus -- correctly showed it as urgent.
// These pin the fix: one shared function decides "is this backup okay",
// Health only renders whatever it says.

test("a very recent refusal is still flagged, not shown as merely dim", () => {
  const html = renderShareLibraryFreshness({
    status: "active",
    lastRun: { at: new Date(Date.now() - 60_000).toISOString(), ok: false, reason: "ProPresenter is running." },
  });
  assert.match(html, /rf-flag/, "a live failure must be visually flagged regardless of how recent it is");
  assert.doesNotMatch(html, /opacity-70/, "must not also render as the calm, unflagged state");
});

test("a healthy recent sync stays calm, not flagged", () => {
  const html = renderShareLibraryFreshness({
    status: "active",
    lastRun: { at: new Date(Date.now() - 60_000).toISOString(), ok: true },
  });
  assert.match(html, /opacity-70/);
  assert.doesNotMatch(html, /rf-flag/);
});

test("nothing renders when Share Library is not active", () => {
  assert.equal(renderShareLibraryFreshness({ status: "off" }), "");
  assert.equal(renderShareLibraryFreshness(null), "");
});
