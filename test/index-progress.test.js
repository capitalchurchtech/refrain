import { test } from "node:test";
import assert from "node:assert/strict";
import { progressView, doneText, BLOCKS } from "../public/index-progress.js";

test("hidden when nothing is indexing", () => {
  assert.deepEqual(progressView({ rebuild: { inProgress: false } }), { show: false });
  assert.deepEqual(progressView(null), { show: false });
});

test("blocks fill in proportion, with the count and time left", () => {
  const v = progressView({ rebuild: { inProgress: true, stage: "presentations", current: 222, total: 444, etaMs: 180_000 } });
  assert.equal(v.show, true);
  assert.equal(v.filled, BLOCKS / 2);
  assert.equal(v.text, "Reading presentations · 222 of 444 · about 3 min left");
});

test("early stages: no time left, and no blocks before there's a total", () => {
  assert.deepEqual(progressView({ rebuild: { inProgress: true, stage: "library", current: 0, total: 0 } }), { show: true, filled: 0, text: "Reading the library" });
  assert.equal(progressView({ rebuild: { inProgress: true, stage: "checking files", current: 10, total: 40, etaMs: 999_999 } }).text, "Checking which files changed · 10 of 40");
  assert.equal(progressView({ rebuild: { inProgress: true, stage: "presentations", current: 9, total: 10, etaMs: 20_000 } }).text, "Reading presentations · 9 of 10 · under a minute left");
});

test("how a run ended: ready, or stopped part-way", () => {
  assert.deepEqual(doneText({ presentationCount: 445 }), { fault: false, text: "Search index ready: 445 presentations." });
  const stopped = doneText({ partial: { read: 120, of: 445 } });
  assert.equal(stopped.fault, true);
  assert.match(stopped.text, /stopped after 120 of 445/);
});
