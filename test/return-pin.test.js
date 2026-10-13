import { test } from "node:test";
import assert from "node:assert/strict";
import { loadReturnPin } from "../public/return-pin.js";

function fakeFetch(answers) {
  let calls = 0;
  globalThis.fetch = async () => {
    const data = answers[Math.min(calls++, answers.length - 1)];
    await new Promise((r) => setTimeout(r, 5));
    return { json: async () => data };
  };
  return () => calls;
}

test("callers at the same moment share one request", async () => {
  const calls = fakeFetch([{ pin: null, n: 1 }]);
  const [a, b] = await Promise.all([loadReturnPin(), loadReturnPin({ maxAgeMs: 3500 })]);
  assert.equal(calls(), 1);
  assert.deepEqual(a, b);
});

test("a caller that accepts an age takes the fresh answer; one that does not asks again", async () => {
  const calls = fakeFetch([{ n: 1 }, { n: 2 }]);
  await loadReturnPin();
  assert.deepEqual(await loadReturnPin({ maxAgeMs: 3500 }), { n: 1 });
  assert.equal(calls(), 1);
  assert.deepEqual(await loadReturnPin(), { n: 2 });
  assert.equal(calls(), 2);
});

test("an answer older than the age accepted is fetched again", async () => {
  const calls = fakeFetch([{ n: 1 }, { n: 2 }]);
  await loadReturnPin();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(await loadReturnPin({ maxAgeMs: 10 }), { n: 2 });
  assert.equal(calls(), 2);
});

test("a failed fetch is not remembered and the next call asks again", async () => {
  globalThis.fetch = async () => {
    throw new Error("down");
  };
  await assert.rejects(loadReturnPin());
  const calls = fakeFetch([{ n: 3 }]);
  assert.deepEqual(await loadReturnPin(), { n: 3 });
  assert.equal(calls(), 1);
});
