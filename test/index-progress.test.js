import { test } from "node:test";
import assert from "node:assert/strict";
import { runningState, endedState, waitingState, doneText, stageIndex, pushTrace, IDLE } from "../public/index-run.js";

test("a server stage maps to one of the four on the card; the final sweep belongs to the last", () => {
  assert.deepEqual(["library", "playlists", "checking files", "presentations", "sweep", "nonsense"].map(stageIndex), [0, 1, 2, 3, 3, 0]);
});

test("reading presentations: the count, the time left, the title and the stage bars", () => {
  const s = runningState({ stage: "presentations", current: 222, total: 444, etaMs: 180_000, recentNames: ["Amazing Grace", "Be Thou My Vision", "Rock of Ages"] });
  assert.equal(s.phase, "running");
  assert.equal(s.sentence, "Reading presentations · 222 of 444 · about 3 min left");
  assert.equal(s.frac, 0.5);
  assert.equal(s.pct, "50%");
  assert.equal(s.reading, "Amazing Grace");
  assert.equal(s.short, "Amazing Grace");
  assert.deepEqual(s.trail, ["Be Thou My Vision", "Rock of Ages"]);
  assert.deepEqual(s.stages.map((t) => t.state), ["done", "done", "done", "active"]);
  assert.equal(s.stages[3].frac, 0.5);
});

test("early stages: no time left, earlier stages not yet done, no title to show", () => {
  const lib = runningState({ stage: "library", current: 0, total: 0, recentNames: ["Left over from the last stage"] });
  assert.equal(lib.sentence, "Reading the library");
  assert.equal(lib.reading, "Reading the library");
  assert.deepEqual(lib.stages.map((t) => t.state), ["active", "pending", "pending", "pending"]);
  const files = runningState({ stage: "checking files", current: 10, total: 40, etaMs: 999_999 });
  assert.equal(files.sentence, "Checking which files changed · 10 of 40");
  assert.deepEqual(files.stages.map((t) => t.state), ["done", "done", "active", "pending"]);
  assert.equal(runningState({ stage: "presentations", current: 9, total: 10, etaMs: 20_000 }).sentence, "Reading presentations · 9 of 10 · under a minute left");
});

test("the final sweep says what it is and offers no estimate", () => {
  const s = runningState({ stage: "sweep", current: 3, total: 7, etaMs: 60_000 });
  assert.equal(s.sentence, "Re-reading presentations that failed the first time");
  assert.equal(runningState({ stage: "sweep", current: 3, total: 7, recentNames: ["Last of the crawl"] }).reading, "Re-reading presentations that failed the first time", "the sweep does not name what it reads, so no stale title");
});

test("a count past the total never overfills the bar", () => {
  assert.equal(runningState({ stage: "presentations", current: 12, total: 10 }).frac, 1);
});

test("Stop pressed: it says so at once, before the server reaches the next boundary", () => {
  const s = runningState({ stage: "presentations", current: 5, total: 10 }, { stopping: true });
  assert.equal(s.phase, "stopping");
  assert.equal(s.sentence, "Stopping after this presentation");
  assert.equal(runningState({ stage: "playlists", current: 1, total: 9 }, { stopping: true }).sentence, "Stopping as soon as it reaches the presentations");
});

test("how a run ended: ready, or stopped part-way with what was kept", () => {
  assert.deepEqual(doneText({ presentationCount: 445 }), { fault: false, text: "Search index ready: 445 presentations." });
  const stopped = endedState({ partial: { read: 120, of: 445 }, presentationCount: 445 }, {});
  assert.equal(stopped.phase, "stopped");
  assert.match(stopped.sentence, /stopped after 120 of 445/);
  assert.deepEqual(stopped.stages.map((t) => t.state), ["done", "done", "done", "pending"]);
  assert.equal(stopped.pct, "26%");
  const done = endedState({ presentationCount: 445 }, { current: 445, total: 445 });
  assert.equal(done.phase, "done");
  assert.equal(done.pct, "100%");
  assert.ok(done.stages.every((t) => t.state === "done"));
});

test("a press that cannot run says why, and idle shows nothing", () => {
  const w = waitingState("Performance mode is on, so indexing is paused.");
  assert.equal(w.phase, "waiting");
  assert.equal(w.sentence, "Performance mode is on, so indexing is paused.");
  assert.equal(IDLE.phase, "idle");
});

test("the speed trace keeps the last stretch and ignores readings that mean nothing", () => {
  let h = [];
  for (let i = 1; i <= 40; i++) h = pushTrace(h, i);
  assert.equal(h.length, 32);
  assert.equal(h.at(-1), 40);
  assert.deepEqual(pushTrace([1], null), [1]);
  assert.deepEqual(pushTrace([1], 0), [1]);
  assert.deepEqual(pushTrace([1], NaN), [1]);
});
