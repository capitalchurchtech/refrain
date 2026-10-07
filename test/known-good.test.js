import { test } from "node:test";
import assert from "node:assert/strict";
import { diffChips, compareToKnownGood, splitByService, recordOf, sameSequence } from "../server/known-good.js";

const names = (chips) => chips.map((c) => `${c.name}:${c.state}`);

test("diffChips marks only what moved or was added or removed", () => {
  const d = diffChips(["V1", "C", "V2", "C", "B", "C"], ["V1", "C", "V2", "C", "Tag", "B", "C"]);
  assert.deepEqual(names(d.after), ["V1:same", "C:same", "V2:same", "C:same", "Tag:new", "B:same", "C:same"]);
  assert.deepEqual(names(d.before), ["V1:same", "C:same", "V2:same", "C:same", "B:same", "C:same"], "nothing was removed");
  const gone = diffChips(["V1", "C", "B"], ["V1", "C"]);
  assert.deepEqual(names(gone.before), ["V1:same", "C:same", "B:gone"]);
  assert.deepEqual(names(gone.after), ["V1:same", "C:same"]);
  const moved = diffChips(["A", "B", "C"], ["A", "C", "B"]);
  assert.equal(moved.before.filter((c) => c.state === "gone").length, 1);
  assert.equal(moved.after.filter((c) => c.state === "new").length, 1);
  assert.deepEqual(diffChips([], []), { before: [], after: [] });
});

const entry = (name, seq, extra = {}) => ({ name, arrangementName: "FS", groupSequence: seq, modifiedDate: "2026-10-11T09:00:00Z", ...extra });

test("a song seen for the first time is learned, not reported", () => {
  const r = compareToKnownGood({}, { a: entry("Oceans", ["V1", "C"]) });
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.learn.a, { name: "Oceans", arrangement: "FS", sequence: ["V1", "C"] });
});

test("a different order is a change, the same order is quiet, and a new arrangement is re-learned", () => {
  const known = {
    a: { name: "Oceans", arrangement: "FS", sequence: ["V1", "C", "B"] },
    b: { name: "Grace", arrangement: "FS", sequence: ["V1", "C"] },
    c: { name: "Well", arrangement: "FS", sequence: ["V1", "C"] },
  };
  const r = compareToKnownGood(known, {
    a: entry("Oceans", ["V1", "C", "Tag", "B"], { modifiedDate: "2026-10-11T10:12:00Z" }),
    b: entry("Grace", ["V1", "C"]),
    c: entry("Well", ["Intro", "V1"], { arrangementName: "T" }),
  });
  assert.deepEqual(r.changes.map((c) => c.presentationId), ["a"]);
  assert.equal(r.changes[0].modifiedDate, "2026-10-11T10:12:00Z");
  assert.deepEqual(Object.keys(r.learn), ["c"], "the song that moved to another arrangement is re-learned, not flagged");
});

test("changes list the newest save first, and entries with no group order are ignored", () => {
  const known = { a: { name: "A", arrangement: "FS", sequence: ["x"] }, b: { name: "B", arrangement: "FS", sequence: ["x"] } };
  const r = compareToKnownGood(known, {
    a: entry("A", ["y"], { modifiedDate: "2026-10-11T08:00:00Z" }),
    b: entry("B", ["y"], { modifiedDate: "2026-10-11T10:00:00Z" }),
    c: { name: "No order", arrangementName: "FS" },
  });
  assert.deepEqual(r.changes.map((c) => c.presentationId), ["b", "a"]);
  assert.equal(recordOf({ name: "x", groupSequence: [] }), null);
  assert.equal(sameSequence(["a"], ["a", "b"]), false);
});

test("a rename alone is not a change, but the new name is kept", () => {
  const r = compareToKnownGood({ a: { name: "Old", arrangement: "FS", sequence: ["x"] } }, { a: entry("New", ["x"]) });
  assert.deepEqual(r.changes, []);
  assert.equal(r.learn.a.name, "New");
});

test("splitByService puts a save at or after the start under during, earlier ones under before", () => {
  const start = Date.parse("2026-10-11T09:00:00Z");
  const c = (id, iso) => ({ presentationId: id, modifiedDate: iso });
  const s = splitByService([c("late", "2026-10-11T10:12:00Z"), c("at", "2026-10-11T09:00:00Z"), c("early", "2026-10-10T16:20:00Z"), c("none", null)], start);
  assert.deepEqual(s.during.map((x) => x.presentationId), ["late", "at", "none"], "no known time is shown where it will be looked at");
  assert.deepEqual(s.before.map((x) => x.presentationId), ["early"]);
  const none = splitByService([c("a", "2026-10-11T10:12:00Z")], null);
  assert.equal(none.since.length, 1);
  assert.deepEqual([none.during, none.before], [[], []]);
});

import { savedText, changedSongsHtml } from "../public/service.js";

test("savedText says when, how far into the service, and the weekday when it was not today", () => {
  const now = new Date(2026, 9, 11, 12, 0).getTime();
  const at = (h, m, d = 11) => new Date(2026, 9, d, h, m).toISOString();
  assert.match(savedText(at(10, 12), at(9, 58), now), /^Saved .*10:12.*, 14 min into the service$/);
  assert.doesNotMatch(savedText(at(8, 0), at(9, 0), now), /into the service/, "before the start there is no 'into'");
  assert.match(savedText(at(16, 20, 10), null, now), /^Saved \w+ .*4:20/, "yesterday names its weekday");
  assert.equal(savedText(null, null, now), "Saved at an unknown time");
  assert.equal(savedText("nonsense", null, now), "Saved at an unknown time");
});

test("changedSongsHtml shows During before Before, escapes names, and says so when nothing changed", () => {
  const chip = (name, state = "same") => ({ name, state });
  const song = (id, name, iso) => ({ presentationId: id, name, arrangement: "FS", modifiedDate: iso, before: [chip("V1"), chip("C")], after: [chip("V1"), chip("Tag", "new"), chip("C")] });
  const html = changedSongsHtml({ during: [song("a", "Oceans <b>", "2026-10-11T10:12:00Z")], before: [song("b", "Grace", "2026-10-10T16:00:00Z")], since: [], serviceStart: "2026-10-11T09:58:00Z" });
  assert.ok(html.indexOf("During the service") < html.indexOf("Before the service"));
  assert.match(html, /Oceans &lt;b&gt;/, "a name is escaped");
  assert.match(html, /<span class="new">Tag<\/span>/, "the added group is marked");
  assert.match(html, /data-changed="dismiss-before"/, "the quiet section can be dismissed together");
  assert.equal((html.match(/data-changed="open"/g) ?? []).length, 2);
  assert.match(changedSongsHtml({ during: [], before: [], since: [] }), /No arrangement has changed/);
});
