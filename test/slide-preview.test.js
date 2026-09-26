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
