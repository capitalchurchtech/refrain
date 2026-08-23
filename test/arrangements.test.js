import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveArrangement, flattenGroups, findLiveIndex } from "../server/arrangements.js";

// Mirrors the real shape of a song that has several arrangements (the live
// library's "Build My Life" has FS | T | Short, where FS and T differ only in
// their intro group and Short is much shorter). Group uuids are the durable
// part; slides have no id of their own.
const FS_ARR = "arr-fs";
const T_ARR = "arr-t";
const SHORT_ARR = "arr-short";

function doc({ current = FS_ARR, arrangements = true } = {}) {
  const groups = [
    { uuid: "g-v1", name: "Verse 1", slides: [{ text: "verse one a" }, { text: "verse one b" }] },
    { uuid: "g-c1", name: "Chorus 1", slides: [{ text: "chorus a" }, { text: "chorus b" }] },
    { uuid: "g-fsi", name: "(FS) Intro", slides: [{ text: "fs intro" }] },
    { uuid: "g-ti", name: "(T) Intro", slides: [{ text: "t intro" }] },
    { uuid: "g-end", name: "Ending", slides: [{ text: "ending" }] },
  ];
  return {
    presentation: {
      current_arrangement: current,
      groups,
      arrangements: arrangements
        ? [
            { id: { uuid: FS_ARR, name: "FS" }, groups: ["g-fsi", "g-v1", "g-c1", "g-c1", "g-end"] },
            { id: { uuid: T_ARR, name: "T" }, groups: ["g-ti", "g-v1", "g-c1", "g-c1", "g-end"] },
            { id: { uuid: SHORT_ARR, name: "Short" }, groups: ["g-fsi", "g-c1", "g-end"] },
          ]
        : [],
    },
  };
}

const flatOf = (d, preferred) => flattenGroups(resolveArrangement(d, preferred).groups);

test("resolveArrangement prefers a configured arrangement over the selected one", () => {
  const r = resolveArrangement(doc({ current: SHORT_ARR }), ["FS", "T"]);
  assert.equal(r.arrangementName, "FS");
  assert.equal(r.source, "preferred");
});

test("resolveArrangement honors the preferred list's own order", () => {
  assert.equal(resolveArrangement(doc(), ["T", "FS"]).arrangementName, "T");
  assert.equal(resolveArrangement(doc(), ["FS", "T"]).arrangementName, "FS");
});

test("resolveArrangement matches names case- and whitespace-insensitively", () => {
  assert.equal(resolveArrangement(doc(), ["  fs  "]).arrangementName, "FS");
});

test("resolveArrangement falls back to the selected arrangement when no preference matches", () => {
  const r = resolveArrangement(doc({ current: T_ARR }), ["Nope"]);
  assert.equal(r.arrangementName, "T");
  assert.equal(r.source, "current");
});

test("resolveArrangement falls back to raw document order when nothing is selected", () => {
  const r = resolveArrangement(doc({ current: "" }), []);
  assert.equal(r.source, "raw");
  assert.equal(r.arrangementName, null);
  assert.equal(r.groups.length, 5, "raw order is every group once, in document order");
});

test("resolveArrangement falls back to raw when the selected arrangement is gone", () => {
  const r = resolveArrangement(doc({ current: "deleted-uuid" }), []);
  assert.equal(r.source, "raw");
});

test("resolveArrangement counts arrangement refs pointing at missing groups", () => {
  const d = doc();
  d.presentation.arrangements[0].groups = ["g-fsi", "g-ghost", "g-end"];
  const r = resolveArrangement(d, ["FS"]);
  assert.equal(r.droppedGroupRefs, 1);
  assert.equal(r.groups.length, 2, "a dangling ref is skipped, not rendered");
});

test("flattenGroups numbers slides across groups and repeats a repeated group", () => {
  const flat = flatOf(doc(), ["FS"]);
  // FS = (FS) Intro, Verse 1, Chorus 1, Chorus 1, Ending
  assert.deepEqual(
    flat.map((s) => s.index),
    [0, 1, 2, 3, 4, 5, 6, 7]
  );
  assert.equal(flat[0].text, "fs intro");
  // Chorus 1 appears twice: same groupId, offsets restart, new flat indices.
  const chorus = flat.filter((s) => s.groupId === "g-c1");
  assert.deepEqual(
    chorus.map((s) => `${s.index}:${s.groupOffset}`),
    ["3:0", "4:1", "5:0", "6:1"]
  );
});

test("the same flat index is a different slide under a different arrangement", () => {
  // This is the bug being fixed: a bare index is not a durable reference.
  assert.equal(flatOf(doc(), ["FS"])[3].text, "chorus a");
  assert.equal(flatOf(doc(), ["Short"])[3].text, "ending");
});

test("findLiveIndex re-maps an anchor onto the live arrangement", () => {
  const short = flatOf(doc(), ["Short"]);
  // Clicked the first chorus while indexed under FS (flat index 3)...
  const corrected = findLiveIndex(short, { groupId: "g-c1", groupOffset: 0, index: 3, text: "chorus a" });
  assert.equal(corrected, 1, "...which is index 1 under Short");
});

test("findLiveIndex keeps a repeated group on the occurrence you clicked", () => {
  const fs = flatOf(doc(), ["FS"]);
  const anchor = { groupId: "g-c1", groupOffset: 0, text: "chorus a" };
  assert.equal(findLiveIndex(fs, { ...anchor, index: 3 }), 3, "first chorus stays first");
  assert.equal(findLiveIndex(fs, { ...anchor, index: 5 }), 5, "second chorus stays second");
});

test("findLiveIndex falls back to text when the group is gone", () => {
  const fs = flatOf(doc(), ["FS"]);
  const corrected = findLiveIndex(fs, { groupId: "g-deleted", groupOffset: 0, index: 0, text: "ending" });
  assert.equal(corrected, 7);
});

test("findLiveIndex returns null when nothing matches, so callers can fall back", () => {
  const fs = flatOf(doc(), ["FS"]);
  assert.equal(findLiveIndex(fs, { groupId: "g-gone", groupOffset: 9, index: 2, text: "not in this song" }), null);
  assert.equal(findLiveIndex([], { groupId: "g-c1", groupOffset: 0, index: 0, text: "chorus a" }), null);
});

test("findLiveIndex never matches a blank slide on empty anchor text", () => {
  const live = [
    { index: 0, text: "", groupId: "g-x", groupOffset: 0 },
    { index: 1, text: "real", groupId: "g-y", groupOffset: 0 },
  ];
  assert.equal(findLiveIndex(live, { groupId: "g-missing", groupOffset: 0, index: 0, text: "" }), null);
});
