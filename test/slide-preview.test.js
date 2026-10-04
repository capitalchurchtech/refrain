import { test } from "node:test";
import assert from "node:assert/strict";
import { previewTargets, createThumbCache } from "../server/slide-preview.js";

test("current and next come from what's live; the last slide says so instead of guessing", () => {
  const text = (id, i) => `${id} slide ${i + 1}`;
  const mid = previewTargets({ presentationId: "H", presentationName: "Hymn", slideIndex: 2, slideCount: 5 }, text);
  assert.equal(mid.current.text, "H slide 3");
  assert.deepEqual(mid.next, { presentationId: "H", slideIndex: 3, text: "H slide 4" });
  assert.equal(mid.atEnd, false);
  const last = previewTargets({ presentationId: "H", slideIndex: 4, slideCount: 5 }, text);
  assert.equal(last.next, null);
  assert.equal(last.atEnd, true);
  assert.deepEqual(previewTargets(null), { current: null, next: null, atEnd: false });
});

test("pictures are cached, shared between screens asking at once, and the oldest are dropped", async () => {
  let calls = 0;
  const get = createThumbCache(async (id, i) => (calls++, { bytes: Buffer.from(`${id}${i}`) }), { max: 2 });
  await Promise.all([get("A", 0), get("A", 0)]);
  assert.equal(calls, 1, "two at once cost one request");
  await get("A", 0);
  assert.equal(calls, 1, "cached");
  await get("B", 0);
  await get("C", 0);
  await get("A", 0);
  assert.equal(calls, 4, "A was the oldest and was dropped");
  const failing = createThumbCache(async () => { throw new Error("no"); });
  assert.equal(await failing("X", 0), null);
});

test("ProPresenter is asked for at most two pictures at once; a runaway wait is refused", async () => {
  let running = 0;
  let peak = 0;
  const get = createThumbCache(async (id, i) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return { bytes: Buffer.from(`${id}${i}`) };
  }, { maxQueued: 100 });
  const got = await Promise.all(Array.from({ length: 50 }, (_, i) => get("A", i)));
  assert.equal(peak, 2, "never more than two renders in flight");
  assert.ok(got.every(Boolean), "and every one arrives");

  const small = createThumbCache(() => new Promise(() => {}), { concurrency: 1, maxQueued: 3 });
  const pending = Array.from({ length: 4 }, (_, i) => small("B", i)); // 1 running, 3 waiting
  assert.equal(await small("B", 9), null, "a fifth miss is refused, not piled on");
  void pending;
});

test("a picture already stored skips the render queue entirely", async () => {
  let renders = 0;
  const get = createThumbCache(() => (renders++, new Promise(() => {})), {
    concurrency: 1,
    maxQueued: 1,
    stored: async (id, i) => (id === "DISK" ? { bytes: Buffer.from(`d${i}`) } : null),
  });
  void get("LIVE", 0); // takes the only render slot, forever
  void get("LIVE", 1); // and fills the queue
  const got = await Promise.all(Array.from({ length: 20 }, (_, i) => get("DISK", i)));
  assert.ok(got.every(Boolean), "all 20 stored pictures served while ProPresenter is busy");
  assert.equal(renders, 1, "and none of them asked for a render");
});

test("a new version of a presentation gets new pictures, not the old slide's at its number", async () => {
  let calls = 0;
  const get = createThumbCache(async (id, i, v) => (calls++, { bytes: Buffer.from(`${id}${i}${v}`) }));
  const before = await get("P", 3, "v1");
  assert.equal((await get("P", 3, "v1")).bytes.toString(), before.bytes.toString(), "same version: from memory");
  assert.equal(calls, 1);
  const after = await get("P", 3, "v2");
  assert.equal(calls, 2, "a slide removed in ProPresenter changes the version, so it's drawn again");
  assert.equal(after.bytes.toString(), "P3v2");
  const stored = [];
  const withDisk = createThumbCache(async () => ({ bytes: Buffer.from("x") }), { stored: async (id, i, v) => (stored.push(v), null) });
  await withDisk("P", 1, "v9");
  assert.deepEqual(stored, ["v9"], "the disk store is asked for that version");
});

test("forget drops one presentation's pictures from memory, and only that one", async () => {
  let calls = 0;
  const get = createThumbCache(async (id, i) => (calls++, { bytes: Buffer.from(`${id}${i}`) }));
  await get("P", 1);
  await get("Q", 1);
  get.forget("P");
  await get("P", 1);
  await get("Q", 1);
  assert.equal(calls, 3, "P drawn again, Q still remembered");
});
