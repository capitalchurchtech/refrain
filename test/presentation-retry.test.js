import { test } from "node:test";
import assert from "node:assert/strict";
import { readPresentationOnce } from "../server/search-index.js";

// Measured on a real 973-presentation workspace: ProPresenter returns 500 for
// about a fifth of reads and recovers immediately. These cover the retry that
// turns those into successes without weakening the abort guard.

function client(outcomes) {
  const calls = [];
  return {
    calls,
    async getPresentation(id) {
      calls.push(id);
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

test("a read that succeeds first time is not retried", async () => {
  const c = client([{ presentation: { id: "a" } }]);
  const doc = await readPresentationOnce(c, "a", { delayMs: 0 });
  assert.equal(doc.presentation.id, "a");
  assert.equal(c.calls.length, 1, "no second call when the first worked");
});

test("a transient failure is retried once and succeeds", async () => {
  const c = client([new Error("HTTP 500"), { presentation: { id: "b" } }]);
  const doc = await readPresentationOnce(c, "b", { delayMs: 0 });
  assert.equal(doc.presentation.id, "b");
  assert.equal(c.calls.length, 2);
});

test("two failures in a row still throw, so the abort guard still counts it", async () => {
  const c = client([new Error("HTTP 500"), new Error("HTTP 500")]);
  await assert.rejects(() => readPresentationOnce(c, "c", { delayMs: 0 }), /HTTP 500/);
  assert.equal(c.calls.length, 2, "one retry, not an unbounded loop");
});

test("a crawl being told to stop does not spend the retry", async () => {
  // A service starting mid-crawl should end it at the next boundary, not wait
  // out a retry for every remaining song.
  const c = client([new Error("HTTP 500"), { presentation: { id: "d" } }]);
  await assert.rejects(() => readPresentationOnce(c, "d", { delayMs: 0, shouldStop: () => true }), /HTTP 500/);
  assert.equal(c.calls.length, 1, "no retry once asked to stand down");
});

test("the retry waits before asking again", async () => {
  const c = client([new Error("HTTP 500"), { presentation: { id: "e" } }]);
  const started = Date.now();
  await readPresentationOnce(c, "e", { delayMs: 40 });
  assert.ok(Date.now() - started >= 35, "gave ProPresenter a moment rather than hammering it");
});

