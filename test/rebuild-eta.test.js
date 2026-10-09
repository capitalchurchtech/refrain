import { test } from "node:test";
import assert from "node:assert/strict";
import { readEta, noteRead, RECENT_READS, MIN_READS_FOR_ETA } from "../server/rebuild-eta.js";

test("no estimate until enough reads have finished to measure", () => {
  assert.deepEqual(readEta({ current: MIN_READS_FOR_ETA - 1, total: 700, startedAt: 0, recent: [] }, 10_000), { perSec: null, etaMs: null });
  assert.equal(readEta({ current: 0, total: 700, startedAt: 0 }, 10_000).etaMs, null);
});

test("a steady run: the estimate is what is left at the speed so far", () => {
  const recent = Array.from({ length: 40 }, (_, i) => 60_000 + i * 1000); // 1 per second
  const { perSec, etaMs } = readEta({ current: 100, total: 700, startedAt: 0, recent }, 100_000);
  assert.ok(Math.abs(perSec - 1) < 0.05);
  assert.ok(Math.abs(etaMs - 600_000) < 40_000);
});

test("a run that is slowing uses the slower recent speed, not the fast average", () => {
  // 100 reads in the first 20s (fast), then one every 4s for the last 40.
  const recent = Array.from({ length: 40 }, (_, i) => 20_000 + i * 4000);
  const slow = readEta({ current: 140, total: 700, startedAt: 0, recent }, 180_000);
  const avgOnly = readEta({ current: 140, total: 700, startedAt: 0, recent: [] }, 180_000);
  assert.ok(slow.etaMs > avgOnly.etaMs * 1.5, `${slow.etaMs} vs ${avgOnly.etaMs}`);
});

test("noteRead keeps only the last stretch of reads", () => {
  let r = [];
  for (let i = 0; i < RECENT_READS + 15; i++) r = noteRead(r, i);
  assert.equal(r.length, RECENT_READS);
  assert.equal(r.at(-1), RECENT_READS + 14);
});
