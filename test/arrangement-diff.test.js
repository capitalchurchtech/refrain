import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSequences, applyMapping, suggestMapping } from "../server/arrangement-diff.js";

test("diffSequences reports no drift for identical sequences", () => {
  const d = diffSequences(["V1", "C", "V2", "C"], ["V1", "C", "V2", "C"]);
  assert.deepEqual(d, { skipped: [], added: [], reordered: [] });
});

test("diffSequences reports a skipped section", () => {
  const d = diffSequences(["V1", "Bridge", "C"], ["V1", "C"]);
  assert.deepEqual(d.skipped, ["Bridge"]);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.reordered, [], "the shared sections still ran in planned order");
});

test("diffSequences reports an added section", () => {
  const d = diffSequences(["V1", "C"], ["V1", "C", "Tag"]);
  assert.deepEqual(d.added, ["Tag"]);
  assert.deepEqual(d.skipped, []);
});

test("diffSequences reports reordered shared sections in actual order", () => {
  const d = diffSequences(["A", "B"], ["B", "A"]);
  assert.deepEqual(d.skipped, []);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.reordered, ["B", "A"]);
});

test("diffSequences counts repeats: an extra chorus is 'added'", () => {
  const d = diffSequences(["V1", "C"], ["V1", "C", "C"]);
  assert.deepEqual(d.added, ["C"]);
});

test("applyMapping flags unmapped groups rather than dropping them", () => {
  const mapped = applyMapping(["Verse 1", "Weird"], { "Verse 1": "Verse", Chorus: "Chorus" });
  assert.deepEqual(mapped, ["Verse", "[unmapped] Weird"]);
});

test("suggestMapping matches on normalized section names", () => {
  const s = suggestMapping(["Verse 1", "Chorus"], ["Verse", "Chorus"]);
  assert.equal(s["Verse 1"], "Verse");
  assert.equal(s["Chorus"], "Chorus");
});

test("suggestMapping falls back to the group name when no vocab matches", () => {
  const s = suggestMapping(["Bridge"], []);
  assert.equal(s["Bridge"], "Bridge");
});
