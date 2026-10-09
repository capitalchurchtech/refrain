import { test } from "node:test";
import assert from "node:assert/strict";
import { noteItem, splitsView, MAX_SPLITS } from "../server/item-splits.js";

const a = { presentationId: "A", name: "Welcome Loop" };
const b = { presentationId: "B", name: "Amazing Grace" };

test("a stay lasts until a different item comes up, and the same item changing slides is one stay", () => {
  let log = noteItem([], a, 1000);
  assert.equal(log.length, 1);
  assert.equal(noteItem(log, a, 5000), log, "nothing changed, so the same list comes back");
  log = noteItem(log, b, 9000);
  assert.deepEqual(log.map((e) => [e.name, e.startMs, e.endMs]), [["Amazing Grace", 9000, null], ["Welcome Loop", 1000, 9000]]);
});

test("clearing the screens closes the stay; the next item starts a new one; coming back is a new row", () => {
  let log = noteItem([], a, 0);
  log = noteItem(log, null, 4000);
  assert.equal(log[0].endMs, 4000);
  assert.equal(noteItem(log, null, 5000), log, "still nothing up");
  log = noteItem(log, b, 6000);
  log = noteItem(log, a, 9000);
  assert.deepEqual(log.map((e) => e.presentationId), ["A", "B", "A"]);
  assert.deepEqual(log.map((e) => e.endMs), [null, 9000, 4000]);
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
