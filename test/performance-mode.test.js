import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLive,
  initialState,
  advance,
  armManually,
  disarmManually,
  describe as describeState,
  PERFORMANCE_DEFAULTS,
} from "../server/performance-mode.js";

const CLEAR = { video_input: false, media: false, slide: false, announcements: false, props: false, messages: false, audio: false };
const LIVE = { ...CLEAR, slide: true };
const ARM_MS = PERFORMANCE_DEFAULTS.armAfterLiveMs;
const CLEAR_MS = PERFORMANCE_DEFAULTS.disarmAfterClearMs;

// Walks the state machine through a series of [layers, timeOffsetMs] steps.
function run(steps, start = initialState(), t0 = 1_000_000) {
  let state = start;
  for (const [layers, offset] of steps) {
    state = advance({ state, layers, now: t0 + offset });
  }
  return state;
}

// --- isLive ---

test("isLive is true only when something is actually on the screens", () => {
  assert.equal(isLive(CLEAR), false);
  assert.equal(isLive({ ...CLEAR, slide: true }), true);
  assert.equal(isLive({ ...CLEAR, media: true }), true);
  assert.equal(isLive({ ...CLEAR, video_input: true }), true);
  assert.equal(isLive({ ...CLEAR, props: true }), true);
});

test("audio and messages alone do not count as live output", () => {
  // Walk-in music or a nursery code on the stage display is not a service in
  // progress, and freezing the index for either would be wrong.
  assert.equal(isLive({ ...CLEAR, audio: true }), false);
  assert.equal(isLive({ ...CLEAR, messages: true }), false);
});

test("isLive is false for a missing or malformed response", () => {
  assert.equal(isLive(null), false);
  assert.equal(isLive(undefined), false);
  assert.equal(isLive("nope"), false);
});

// --- auto arming ---

test("a brief slide does not arm performance mode", () => {
  // Clicking through a slide midweek should not freeze indexing.
  const s = run([
    [LIVE, 0],
    [LIVE, 30_000],
    [CLEAR, 60_000],
  ]);
  assert.equal(s.armed, false);
});

test("output sustained past the threshold arms it automatically", () => {
  const s = run([
    [LIVE, 0],
    [LIVE, ARM_MS + 1],
  ]);
  assert.equal(s.armed, true);
  assert.equal(s.source, "auto");
});

test("an auto arm stays put while output continues", () => {
  const s = run([
    [LIVE, 0],
    [LIVE, ARM_MS + 1],
    [LIVE, ARM_MS + 600_000],
  ]);
  assert.equal(s.armed, true);
  assert.equal(s.since, 1_000_000 + ARM_MS + 1, "the armed-at time should not keep resetting");
});

// --- auto disarming ---

test("it does not stand down the moment the screens clear", () => {
  // The gap between two services is not a good moment to start crawling.
  const s = run([
    [LIVE, 0],
    [LIVE, ARM_MS + 1],
    [CLEAR, ARM_MS + 2],
    [CLEAR, ARM_MS + 60_000],
  ]);
  assert.equal(s.armed, true);
});

test("it stands down after a long enough all-clear", () => {
  const s = run([
    [LIVE, 0],
    [LIVE, ARM_MS + 1],
    [CLEAR, ARM_MS + 2],
    [CLEAR, ARM_MS + 2 + CLEAR_MS + 1],
  ]);
  assert.equal(s.armed, false);
  assert.equal(s.source, null);
});

test("output during the all-clear countdown restarts it", () => {
  const s = run([
    [LIVE, 0],
    [LIVE, ARM_MS + 1],
    [CLEAR, ARM_MS + 2],
    [LIVE, ARM_MS + 60_000], // back on screen, countdown resets
    [CLEAR, ARM_MS + 61_000],
    [CLEAR, ARM_MS + 61_000 + CLEAR_MS - 1_000],
  ]);
  assert.equal(s.armed, true, "the all-clear timer must restart when output returns");
});

// --- manual arming wins ---

test("a manual arm is not undone by the screens being clear", () => {
  // The operator knows a service starts in ten minutes; a timer does not.
  let s = armManually(initialState(), 1_000_000);
  s = run(
    [
      [CLEAR, 0],
      [CLEAR, CLEAR_MS * 5],
    ],
    s
  );
  assert.equal(s.armed, true);
  assert.equal(s.source, "manual");
});

test("a manual disarm holds even while something is on screen", () => {
  let s = run([
    [LIVE, 0],
    [LIVE, ARM_MS + 1],
  ]);
  assert.equal(s.armed, true);
  s = disarmManually(s, 1_000_000 + ARM_MS + 2);
  assert.equal(s.armed, false);
  // It may re-arm later on its own, but only after the full threshold again.
  s = advance({ state: s, layers: LIVE, now: 1_000_000 + ARM_MS + 3 });
  assert.equal(s.armed, false, "disarming must not be instantly reversed");
});

// --- unreachable ProPresenter ---

test("it arms when ProPresenter cannot be reached, because it cannot tell", () => {
  // Guessing wrong costs a service; freezing costs nothing, since an
  // unreachable ProPresenter has nothing worth indexing anyway.
  const s = run([[null, 0]]);
  assert.equal(s.armed, true);
  assert.equal(s.source, "unknown");
  assert.match(s.lastError, /not answering/);
});

test("a precautionary arm is released once ProPresenter answers and is clear", () => {
  const s = run([
    [null, 0],
    [CLEAR, 10_000],
  ]);
  assert.equal(s.armed, false, "an unknown-state arm should not outlive the uncertainty");
  assert.equal(s.lastError, null);
});

test("a precautionary arm becomes a real one if output turns out to be live", () => {
  const s = run([
    [null, 0],
    [LIVE, 10_000],
    [LIVE, 10_000 + ARM_MS + 1],
  ]);
  assert.equal(s.armed, true);
  assert.equal(s.source, "auto");
});

test("a manual arm survives ProPresenter going away", () => {
  let s = armManually(initialState(), 1_000_000);
  s = advance({ state: s, layers: null, now: 1_000_100 });
  assert.equal(s.armed, true);
  assert.equal(s.source, "manual");
  assert.match(s.lastError, /not answering/);
});

// --- describe ---

test("describe always says how it decided", () => {
  // Off says nothing, deliberately. The invariant is that a mode *claiming* to
  // protect you must say how it decided; off makes no such claim, and the
  // sentence it used to return named what was on the screens -- state the live
  // readout owns, and which put two different "Off." sentences on adjacent
  // lines of the same card. The screen still labels the off state itself.
  assert.equal(describeState(initialState()), "");

  const manual = describeState(armManually(initialState(), 1_000_000), 1_000_000);
  assert.match(manual, /by hand/i);

  const auto = describeState(run([[LIVE, 0], [LIVE, ARM_MS + 1]]), 1_000_000 + ARM_MS + 1);
  assert.match(auto, /showing something/i);

  const unknown = describeState(run([[null, 0]]), 1_000_000);
  assert.match(unknown, /not answering/i);
});

test("describe names when it last checked, so the banner is not just a claim", () => {
  // Pinned to an armed state, which is where the claim actually gets made.
  const s = armManually(run([[CLEAR, 0]]), 1_000_000);
  assert.match(describeState(s, 1_000_000), /last checked \d/);
});
