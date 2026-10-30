import { test } from "node:test";
import assert from "node:assert/strict";
import { noteItem, splitsView, MAX_SPLITS, BLANK_GRACE_MS } from "../server/item-splits.js";

const a = { presentationId: "A", name: "Welcome Loop" };
const b = { presentationId: "B", name: "Amazing Grace" };

test("a stay lasts until a different item comes up, and the same item changing slides is one stay", () => {
  let log = noteItem([], a, 1000);
  assert.equal(log.length, 1);
  assert.equal(noteItem(log, a, 5000), log, "nothing changed, so the same list comes back");
  log = noteItem(log, b, 9000);
  assert.deepEqual(log.map((e) => [e.name, e.startMs, e.endMs]), [["Amazing Grace", 9000, null], ["Welcome Loop", 1000, 9000]]);
});

test("a stay that stays blank too long ends when it went blank; coming back is a new row", () => {
  let log = noteItem([], a, 0);
  log = noteItem(log, null, 4000); // went blank at 4s
  assert.equal(log[0].endMs, null, "not over yet: a short blank is forgiven");
  assert.equal(noteItem(log, null, 5000), log, "still blank, nothing new to record");
  log = noteItem(log, null, 4000 + BLANK_GRACE_MS + 1);
  assert.equal(log[0].endMs, 4000, "it left when it went blank, not when we noticed");
  assert.equal("blankSince" in log[0], false);
  assert.equal(noteItem(log, null, 9e9), log, "and nothing is up");
  log = noteItem(log, b, 6e5);
  log = noteItem(log, a, 9e5);
  assert.deepEqual(log.map((e) => e.presentationId), ["A", "B", "A"]);
});

test("a long item that goes blank or unreadable for a while stays one row (the sermon)", () => {
  let log = noteItem([], { presentationId: "S", name: "Sermon" }, 0);
  let t = 0;
  // Thirty minutes of beats every 4s, with an unreadable beat now and then and two blanks of a minute and of two.
  for (t = 4000; t < 30 * 60_000; t += 4000) {
    const blank = t % 97_000 < 4000 || (t > 600_000 && t < 660_000) || (t > 1_200_000 && t < 1_320_000);
    log = noteItem(log, blank ? null : { presentationId: "S", name: "Sermon" }, t);
  }
  assert.equal(log.length, 1, "one item, one row");
  assert.equal(log[0].endMs, null);
  assert.equal(splitsView(log, t)[0].current, true);
});

test("a different item after a short blank ends the first where it went blank", () => {
  let log = noteItem([], a, 0);
  log = noteItem(log, null, 20_000);
  log = noteItem(log, b, 50_000);
  assert.deepEqual(log.map((e) => [e.presentationId, e.startMs, e.endMs]), [["B", 50_000, null], ["A", 0, 20_000]]);
});

test("the same item back after more than the grace is a new row, with the first ended at the blank", () => {
  let log = noteItem([], a, 0);
  log = noteItem(log, null, 10_000);
  log = noteItem(log, a, 10_000 + BLANK_GRACE_MS + 5000);
  assert.deepEqual(log.map((e) => [e.startMs, e.endMs]), [[10_000 + BLANK_GRACE_MS + 5000, null], [0, 10_000]]);
});

test("the view counts the open stay up to now and closed ones exactly", () => {
  let log = noteItem([], a, 0);
  log = noteItem(log, b, 60_000);
  const v = splitsView(log, 90_000);
  assert.deepEqual(v.map((x) => [x.name, x.elapsedMs, x.current]), [["Amazing Grace", 30_000, true], ["Welcome Loop", 60_000, false]]);
  assert.equal(v[0].endedAt, null);
  assert.equal(v[1].startedAt, new Date(0).toISOString());
  assert.equal(splitsView([], 1).length, 0);
});

test("the list is capped, newest kept, and an unnamed item still reads", () => {
  let log = [];
  for (let i = 0; i < MAX_SPLITS + 10; i++) log = noteItem(log, { presentationId: `P${i}`, name: null }, i * 1000);
  assert.equal(log.length, MAX_SPLITS);
  assert.equal(log[0].presentationId, `P${MAX_SPLITS + 9}`);
  assert.equal(splitsView(log, 1e9)[0].name, "Untitled");
});

test("the view says which presentation, and marks an open stay whose screens are blank", () => {
  let log = noteItem([], a, 0);
  assert.deepEqual([splitsView(log, 5000)[0].presentationId, splitsView(log, 5000)[0].blank], ["A", false]);
  log = noteItem(log, null, 4000);
  assert.equal(splitsView(log, 5000)[0].blank, true);
  log = noteItem(log, a, 6000);
  assert.equal(splitsView(log, 7000)[0].blank, false, "back, so not blank");
});

// --- What leaves this Mac (docs/service-feed.md) ---------------------------------
import { feedItems, itemLines, leftOpenLines, FEED_ITEMS_MAX, FEED_NAME_MAX } from "../server/item-splits.js";

const TZ = "America/Denver";
const SECRET = "Was blind but now I see";

test("the history snapshot is newest first, capped, names trimmed, UTC times, and has nothing but the named fields", () => {
  let log = [];
  for (let i = 0; i < 45; i++) log = noteItem(log, { presentationId: `P${i}`, name: i === 44 ? "x".repeat(500) : `Item ${i}`, text: SECRET, slideText: SECRET }, i * 60_000, 60);
  const items = feedItems(log);
  assert.equal(items.length, FEED_ITEMS_MAX);
  assert.equal(items[0].name.length, FEED_NAME_MAX);
  assert.deepEqual(Object.keys(items[0]).sort(), ["blank", "current", "endedAt", "id", "name", "startedAt"]);
  assert.deepEqual([items[0].current, items[0].endedAt], [true, null]);
  assert.equal(items[1].endedAt, new Date(44 * 60_000).toISOString(), "UTC ISO, closed when the next came up");
  assert.doesNotMatch(JSON.stringify(items), /Was blind|presentationId|P44/);
});

test("item lines: one when an item opens, one with the same id when it closes, none for what did not change", () => {
  let log = [];
  const all = [];
  const step = (item, t) => {
    const next = noteItem(log, item, t);
    all.push(...itemLines(log, next, TZ));
    log = next;
  };
  step(a, 0);
  step(a, 4000); // still the same item
  step(null, 10_000); // a blank being forgiven: no line
  step(a, 20_000);
  assert.equal(all.length, 1, "one open line so far");
  assert.deepEqual([all[0].endedAt, all[0].reason, all[0].tz, all[0].name], [null, null, TZ, "Welcome Loop"]);
  step(b, 60_000);
  assert.equal(all.length, 3);
  assert.deepEqual([all[1].id === all[0].id, all[1].reason, all[1].endedAt], [true, "moved", new Date(60_000).toISOString()]);
  assert.deepEqual([all[2].endedAt, all[2].reason, all[2].name], [null, null, "Amazing Grace"]);
  step(null, 70_000);
  step(null, 70_000 + BLANK_GRACE_MS + 1);
  const last = all.at(-1);
  assert.deepEqual([last.id === all[2].id, last.reason, last.endedAt], [true, "blank-timeout", new Date(70_000).toISOString()], "ended when the screens went blank");
});

test("the same item keeps the same id every time it is sent", () => {
  const log = noteItem([], a, 5000);
  assert.equal(feedItems(log)[0].id, feedItems(log)[0].id);
  assert.equal(feedItems(noteItem(log, a, 9000))[0].id, feedItems(log)[0].id, "slides changing inside one item do not re-id it");
});

test("an item open when Refrain restarts is closed at the last moment the old run wrote anything, as a restart; this run's own are left alone", () => {
  const BOOT = "2026-10-11T16:00:00.000Z";
  const text = [
    { t: "2026-10-11T15:40:00.000Z", event: "item", id: "old-1", name: "Sermon", startedAt: "2026-10-11T15:30:00.000Z", endedAt: null, reason: null, tz: TZ },
    { t: "2026-10-11T15:41:00.000Z", event: "item", id: "old-0", name: "Song", startedAt: "2026-10-11T15:20:00.000Z", endedAt: null, reason: null, tz: TZ },
    { t: "2026-10-11T15:42:00.000Z", event: "item", id: "old-0", name: "Song", startedAt: "2026-10-11T15:20:00.000Z", endedAt: "2026-10-11T15:42:00.000Z", reason: "moved", tz: TZ },
    { t: "2026-10-11T15:55:00.000Z", event: "minute", live: true },
    { t: "2026-10-11T16:00:30.000Z", event: "item", id: "new-1", name: "Sermon", startedAt: "2026-10-11T16:00:30.000Z", endedAt: null, reason: null, tz: TZ },
  ].map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n";
  const lines = leftOpenLines(text, BOOT, TZ);
  assert.deepEqual(lines, [{ id: "old-1", name: "Sermon", startedAt: "2026-10-11T15:30:00.000Z", endedAt: "2026-10-11T15:55:00.000Z", reason: "restart", tz: TZ }]);
  assert.deepEqual(leftOpenLines("", BOOT, TZ), []);
  // The run that comes back opens its items with new ids.
  const reopened = noteItem([], a, Date.parse(BOOT) + 40_000);
  assert.notEqual(feedItems(reopened)[0].id, "old-1");
});

test("no slide words appear in the snapshot or the item lines, whatever the item carried", () => {
  let log = noteItem([], { ...a, text: SECRET, snippet: SECRET }, 0);
  const next = noteItem(log, { ...b, text: SECRET }, 9000);
  const out = JSON.stringify([feedItems(next), itemLines(log, next, TZ), splitsView(next)]);
  assert.doesNotMatch(out, /Was blind/);
});
