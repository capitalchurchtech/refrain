import test from "node:test";
import assert from "node:assert/strict";
import { parseLaunchdManaged, findOrphanedHelpers } from "../server/propresenter-doctor.js";
import { libraryWriteSafety } from "../server/library-guard.js";

// Taken from the real machine. The Workspaces helper is a launchd service with
// PPID 1 that runs whenever ProPresenter is INSTALLED, app open or not, and
// launchd restarts it within seconds of being killed. Treating it as a leftover
// was wrong in two places at once.
const PS_APP_CLOSED = `  27829     1 /Users/x/Library/Application Support/RenewedVision/ProPresenter/Helpers/Workspaces/ProPresenter Helper (Workspaces)
  27834 27829 ProPresenter Helper (Snapshots)
   9001  9000 /usr/bin/something-else`;

const PS_APP_RUNNING = `  24480     1 /Applications/ProPresenter.app/Contents/MacOS/ProPresenter
  24489 24480 /Applications/ProPresenter.app/Contents/MacOS/ProPresenter Helper (Network)
  27829     1 /Users/x/Library/Application Support/RenewedVision/ProPresenter/Helpers/Workspaces/ProPresenter Helper (Workspaces)`;

const PS_REAL_ORPHAN = `  31000     1 /Applications/ProPresenter.app/Contents/MacOS/ProPresenter Helper (Network)`;

const LAUNCHCTL = `-\t0\tcom.apple.SafariHistoryServiceAgent
27829\t-15\tcom.renewedvision.propresenter.workspaces-helper
-\t0\tcom.example.other`;

test("parseLaunchdManaged picks out ProPresenter's launchd services", () => {
  const pids = parseLaunchdManaged(LAUNCHCTL);
  assert.deepEqual([...pids], [27829]);
});

test("parseLaunchdManaged tolerates junk and unloaded services", () => {
  assert.equal(parseLaunchdManaged(null).size, 0);
  assert.equal(parseLaunchdManaged("").size, 0);
  // A "-" PID means loaded but not running; there is nothing to exclude.
  assert.equal(parseLaunchdManaged("-\t0\tcom.renewedvision.propresenter.workspaces-helper").size, 0);
});

test("a launchd-managed helper is not an orphan, and neither is its child", () => {
  // The Snapshots helper is a child of the Workspaces helper. Killing it just
  // makes launchd's service respawn it, which is the loop this caused.
  const r = findOrphanedHelpers(PS_APP_CLOSED, { managedPids: parseLaunchdManaged(LAUNCHCTL) });
  assert.equal(r.mainAppRunning, false);
  assert.deepEqual(r.orphaned, [], "nothing to clear");
  assert.deepEqual(r.managed.map((h) => h.pid).sort(), [27829, 27834]);
});

test("without launchd knowledge they still look orphaned — the old behaviour", () => {
  // Documents why this is a two-part fix: the ps output alone cannot tell them
  // apart, so the doctor needs the second source.
  const r = findOrphanedHelpers(PS_APP_CLOSED);
  assert.equal(r.orphaned.length, 2);
});

test("a genuinely orphaned helper is still reported", () => {
  // Not launchd-managed, main app gone: this one really is a leftover.
  const r = findOrphanedHelpers(PS_REAL_ORPHAN, { managedPids: parseLaunchdManaged(LAUNCHCTL) });
  assert.equal(r.orphaned.length, 1);
  assert.equal(r.orphaned[0].pid, 31000);
});

// --- the guard, which had the more damaging version of the same bug ---

test("a sync is allowed when only launchd services are running", () => {
  // This is the bug that mattered: with ProPresenter fully quit, the managed
  // helpers are still up, so the guard refused every sync forever. A safety
  // check that blocks the feature in all cases is an outage wearing a
  // safety check's clothes.
  const v = libraryWriteSafety({ psOutput: PS_APP_CLOSED, apiReachable: false, launchctlOutput: LAUNCHCTL });
  assert.equal(v.safe, true, v.reason ?? "");
  assert.equal(v.evidence.launchdManaged, 2);
});

test("the main app running still refuses — the case that cost three workspaces", () => {
  const v = libraryWriteSafety({ psOutput: PS_APP_RUNNING, apiReachable: false, launchctlOutput: LAUNCHCTL });
  assert.equal(v.safe, false);
  assert.match(v.reason, /running/i);
});

test("a real leftover helper still refuses", () => {
  const v = libraryWriteSafety({ psOutput: PS_REAL_ORPHAN, apiReachable: false, launchctlOutput: LAUNCHCTL });
  assert.equal(v.safe, false);
  assert.match(v.reason, /not fully closed/i);
});

test("no launchctl output means nothing is excused — still fail-closed", () => {
  // If we cannot tell what launchd owns, every helper counts as blocking.
  const v = libraryWriteSafety({ psOutput: PS_APP_CLOSED, apiReachable: false, launchctlOutput: null });
  assert.equal(v.safe, false);
});

test("a reachable API still refuses regardless of launchd", () => {
  const v = libraryWriteSafety({ psOutput: PS_APP_CLOSED, apiReachable: true, launchctlOutput: LAUNCHCTL });
  assert.equal(v.safe, false);
  assert.match(v.reason, /API is answering/i);
});
