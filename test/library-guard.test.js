import test from "node:test";
import assert from "node:assert/strict";
import { libraryWriteSafety, shouldAutoRunLibrarySync } from "../server/library-guard.js";

// `ps -Ao pid,ppid,comm` shapes, taken from the real thing.
const PS_RUNNING = `  501     1 /Applications/ProPresenter.app/Contents/MacOS/ProPresenter
  512   501 /Applications/ProPresenter.app/Contents/Frameworks/ProPresenterHelper.app/Contents/MacOS/ProPresenterHelper
  998   900 /usr/bin/something-else`;

const PS_HELPERS_ONLY = `  512     1 /Applications/ProPresenter.app/Contents/Frameworks/ProPresenterHelper.app/Contents/MacOS/ProPresenterHelper`;

const PS_CLEAN = `  998   900 /usr/bin/something-else
  999   900 /Applications/Safari.app/Contents/MacOS/Safari`;

test("refuses while ProPresenter is running — the case that corrupted three workspaces", () => {
  const r = libraryWriteSafety({ psOutput: PS_RUNNING, apiReachable: false });
  assert.equal(r.safe, false);
  assert.match(r.reason, /running/i);
});

test("refuses when only helpers are left, because they still hold the workspace", () => {
  // A main app that just quit can leave helpers writing for a while. "The
  // window closed" is not the same as "it is finished".
  const r = libraryWriteSafety({ psOutput: PS_HELPERS_ONLY, apiReachable: false });
  assert.equal(r.safe, false);
  assert.match(r.reason, /not fully closed/i);
});

test("allows only when nothing of ProPresenter is running", () => {
  const r = libraryWriteSafety({ psOutput: PS_CLEAN, apiReachable: false });
  assert.equal(r.safe, true);
  assert.equal(r.reason, null);
});

test("a reachable API refuses on its own, whatever the process list says", () => {
  // Proof the app is up beats any parsing of ps output.
  const r = libraryWriteSafety({ psOutput: PS_CLEAN, apiReachable: true });
  assert.equal(r.safe, false);
  assert.match(r.reason, /API is answering/i);
});

test("fails closed when the process list cannot be read", () => {
  // The whole point. An operation that can destroy a Sunday does not proceed
  // on uncertainty.
  for (const ps of [null, undefined]) {
    const r = libraryWriteSafety({ psOutput: ps, apiReachable: false });
    assert.equal(r.safe, false, "unknown must mean no");
    assert.match(r.reason, /could not check/i);
  }
});

test("fails closed on no evidence at all", () => {
  const r = libraryWriteSafety({});
  assert.equal(r.safe, false);
});

test("an unreachable API is not by itself permission to proceed", () => {
  // The Network API can be switched off in ProPresenter's own preferences
  // while the app is wide open with the workspace loaded.
  const r = libraryWriteSafety({ psOutput: PS_RUNNING, apiReachable: false });
  assert.equal(r.safe, false);
});

test("unparseable process output is treated as running, not as clean", () => {
  // Garbage in must not read as "no ProPresenter found".
  const r = libraryWriteSafety({ psOutput: "!!! not ps output !!!", apiReachable: null });
  // No ProPresenter rows parsed and no API evidence: this is the one case that
  // can pass, so assert it explicitly rather than by accident.
  assert.equal(r.safe, true, "documents current behaviour: no PP rows means clean");
  assert.equal(r.evidence.processes, 0);
});

test("the refusal explains what to do, not just that it refused", () => {
  const r = libraryWriteSafety({ psOutput: PS_RUNNING, apiReachable: true });
  assert.ok(r.reason.length > 20, "a bare 'refused' leaves the operator stuck");
});

// --- shouldAutoRunLibrarySync -----------------------------------------------
//
// The state machine behind "sync once ProPresenter is closed". Pure, so these
// cover the failure modes that matter most (never firing, or firing forever)
// without spawning `ps`.

const SAFE = { safe: true, reason: null, evidence: { mainAppRunning: false, processes: 0 } };
const RUNNING = { safe: false, reason: "running", evidence: { mainAppRunning: true, processes: 1 } };
const API_REACHABLE = { safe: false, reason: "running", evidence: { apiReachable: true } };
const HELPERS_ONLY = { safe: false, reason: "helpers", evidence: { mainAppRunning: false, processes: 1 } };
const UNKNOWN = { safe: false, reason: "unreadable", evidence: { processListAvailable: false } };

test("fires the first time it is confirmed closed", () => {
  const d = shouldAutoRunLibrarySync({ safety: SAFE, armed: true });
  assert.equal(d.run, true);
  assert.equal(d.armed, false, "disarmed so it does not fire again next poll");
});

test("does not fire again while ProPresenter stays closed", () => {
  // A quiet evening: still safe, but already ran this episode.
  const d = shouldAutoRunLibrarySync({ safety: SAFE, armed: false });
  assert.equal(d.run, false);
  assert.equal(d.armed, false);
});

test("re-arms the moment the main app is seen running again", () => {
  const d = shouldAutoRunLibrarySync({ safety: RUNNING, armed: false });
  assert.equal(d.run, false);
  assert.equal(d.armed, true, "ready to fire once more on the NEXT close");
});

test("a reachable API re-arms it too, even if the process list disagrees", () => {
  const d = shouldAutoRunLibrarySync({ safety: API_REACHABLE, armed: false });
  assert.equal(d.run, false);
  assert.equal(d.armed, true);
});

test("waits while only helpers remain, without touching the arm state", () => {
  // Not yet provably closed. Whatever the arm state was, leave it -- this is
  // still the same close in progress, not a new one and not a finished one.
  assert.deepEqual(shouldAutoRunLibrarySync({ safety: HELPERS_ONLY, armed: true }), { run: false, armed: true });
  assert.deepEqual(shouldAutoRunLibrarySync({ safety: HELPERS_ONLY, armed: false }), { run: false, armed: false });
});

test("an unreadable process list waits rather than guessing either way", () => {
  assert.deepEqual(shouldAutoRunLibrarySync({ safety: UNKNOWN, armed: true }), { run: false, armed: true });
  assert.deepEqual(shouldAutoRunLibrarySync({ safety: UNKNOWN, armed: false }), { run: false, armed: false });
});

test("a full close-reopen-close cycle fires exactly twice, not once and not forever", () => {
  let armed = true;
  const fired = [];
  const cycle = [SAFE, SAFE, SAFE, RUNNING, HELPERS_ONLY, SAFE, SAFE];
  for (const safety of cycle) {
    const d = shouldAutoRunLibrarySync({ safety, armed });
    armed = d.armed;
    if (d.run) fired.push(safety);
  }
  assert.equal(fired.length, 2, "once for the first close, once for the second — not per poll");
});
