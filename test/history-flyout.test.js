import { test } from "node:test";
import assert from "node:assert/strict";
import { agoText, historyView, durationText, placeTimes } from "../public/history-flyout.js";

const NOW = Date.parse("2026-10-11T10:30:00Z");
const at = (minAgo) => new Date(NOW - minAgo * 60_000).toISOString();
const list = [
  { presentationId: "a", slideIndex: 4, name: "Oceans", leftAt: at(0.2) },
  { presentationId: "b", slideIndex: 0, name: "Amazing Grace", leftAt: at(6) },
  { presentationId: "c", slideIndex: 2, name: "It Is Well", leftAt: at(95) },
];

test("agoText says now, minutes, then hours, and nothing for a bad time", () => {
  assert.equal(agoText(at(0.2), NOW), "now");
  assert.equal(agoText(at(6), NOW), "6 min ago");
  assert.equal(agoText(at(95), NOW), "2 h ago");
  assert.equal(agoText("nonsense", NOW), "");
  assert.equal(agoText(null, NOW), "");
});

test("Back goes to the next older place, Forward to the next newer, and each stops at the end", () => {
  let v = historyView(list, 0, NOW);
  assert.equal(v.back.name, "Amazing Grace");
  assert.equal(v.forward, null, "nothing newer than the newest");
  v = historyView(list, 1, NOW);
  assert.equal(v.back.name, "It Is Well");
  assert.equal(v.forward.name, "Oceans");
  v = historyView(list, 2, NOW);
  assert.equal(v.back, null, "the oldest place kept");
  assert.equal(v.rows.filter((r) => r.current).length, 1);
  assert.equal(v.rows[2].current, true);
});

test("a cursor out of range, or an empty history, is made safe", () => {
  assert.equal(historyView(list, 99, NOW).cursor, 2);
  assert.equal(historyView(list, -3, NOW).cursor, 0);
  assert.equal(historyView(list, undefined, NOW).cursor, 0);
  const none = historyView([], 0, NOW);
  assert.deepEqual([none.rows.length, none.back, none.forward, none.cursor], [0, null, null, 0]);
  assert.equal(historyView(null, 0, NOW).rows.length, 0);
});

test("durations read as m:ss, and h:mm:ss past an hour", () => {
  assert.equal(durationText(0), "0:00");
  assert.equal(durationText(65_000), "1:05");
  assert.equal(durationText(3_725_000), "1:02:05");
  assert.equal(durationText(-5), "0:00");
});

test("a place's times come from its latest stay, and the running one keeps counting from when it was heard", () => {
  const splits = [
    { presentationId: "a", startedAt: "2026-10-11T16:47:00Z", endedAt: null, elapsedMs: 60_000, current: true },
    { presentationId: "b", startedAt: "2026-10-11T16:30:00Z", endedAt: "2026-10-11T16:41:00Z", elapsedMs: 660_000, current: false },
  ];
  const running = placeTimes(splits, { presentationId: "a" }, 1000, 31_000);
  assert.deepEqual([running.live, running.elapsed, running.left], [true, "1:30", ""]);
  const done = placeTimes(splits, { presentationId: "b" }, 1000, 999_999);
  assert.deepEqual([done.live, done.elapsed], [false, "11:00"], "a finished stay does not count on");
  assert.notEqual(done.left, "");
  assert.equal(placeTimes(splits, { presentationId: "zzz" }, 0), null, "a place the server never counted has no times line");
  assert.equal(placeTimes(undefined, { presentationId: "a" }, 0), null);
});

test("an item whose screens are blank for a moment is not called live", () => {
  const splits = [{ presentationId: "a", startedAt: "2026-10-11T16:47:00Z", endedAt: null, elapsedMs: 60_000, current: true, blank: true }];
  const t = placeTimes(splits, { presentationId: "a" }, 0, 0);
  assert.deepEqual([t.live, t.cleared, t.left], [false, true, ""]);
});
