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
