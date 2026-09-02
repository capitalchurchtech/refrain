import test from "node:test";
import assert from "node:assert/strict";
import { anchorsAvailable, indexAccuracyNotice } from "../server/search-index.js";

// The schema an index must be at for its slides to carry (groupId, groupOffset).
// Read off a current-shaped index rather than importing the constant, so this
// test fails if the constant moves rather than silently agreeing with itself.
const current = { builtAt: "2026-09-01T00:00:00.000Z", schemaVersion: 3, presentations: {} };
const older = { builtAt: "2026-09-01T00:00:00.000Z", schemaVersion: 2, presentations: {} };
const unversioned = { builtAt: "2026-09-01T00:00:00.000Z", presentations: {} };

test("a current-schema index has anchors and no notice", () => {
  assert.equal(anchorsAvailable(current), true);
  assert.equal(indexAccuracyNotice(current), null);
});

test("an older-schema index is flagged — this is the bug that was invisible", () => {
  // It still loads and still searches, so nothing looked wrong. What it lacks
  // is the anchor Go Live uses to correct for an arrangement change.
  assert.equal(anchorsAvailable(older), false);
  const n = indexAccuracyNotice(older);
  assert.ok(n, "an older-schema index must be reported");
  assert.equal(n.reason, "schema");
});

test("a cache with no schemaVersion at all is flagged, not assumed current", () => {
  // The field was added after the cache format existed, so absent is the
  // realistic upgrade case and must not read as fine.
  assert.equal(anchorsAvailable(unversioned), false);
  assert.ok(indexAccuracyNotice(unversioned));
});

test("the notice says what Go Live will do, not what version the file is", () => {
  // An operator cannot act on "schema 2 of 3". They can act on "the slide you
  // click might not be the slide that fires, and Refresh fixes it".
  const { message } = indexAccuracyNotice(older);
  assert.match(message, /wrong slide/i, "names the consequence");
  assert.match(message, /refresh/i, "carries its own remedy");
  assert.doesNotMatch(message, /schemaVersion|schema \d/i, "no version numbers at the operator");
});

test("no index at all produces no accuracy notice", () => {
  // "Not built yet" is already reported by its own state; claiming an accuracy
  // problem on top of it would be two messages for one situation.
  assert.equal(indexAccuracyNotice({ presentations: {} }), null);
  assert.equal(indexAccuracyNotice(null), null);
  assert.equal(indexAccuracyNotice(undefined), null);
});

test("junk is treated as missing anchors rather than throwing", () => {
  for (const bad of [null, undefined, {}, { schemaVersion: "3" }, { schemaVersion: null }]) {
    assert.equal(anchorsAvailable(bad), false, JSON.stringify(bad));
  }
});
