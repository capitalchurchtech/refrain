/**
 * Refuses to touch a ProPresenter library while ProPresenter is running.
 *
 * **Why this exists, written plainly because it cost a church three
 * workspaces.** Library Sync in `receive` mode copies `.pro` files straight
 * into the live library directory that ProPresenter reports as its own. There
 * was no check of any kind on whether ProPresenter was running at the time.
 *
 * ProPresenter keeps a private catalog of each workspace and builds it from the
 * library at startup, holding it locked while the app is open. Files appearing
 * or being replaced underneath a running instance is exactly how that catalog
 * and the filesystem diverge, and a diverged catalog is what "corrupted
 * workspace" means. Three workspaces corrupted in the months after Refrain went
 * into use, none in the years before, and a sync ran the night before the last
 * one.
 *
 * **Both directions are guarded, not just the one that writes.** `send` only
 * reads the library, which sounds safe -- but reading a `.pro` file while
 * ProPresenter is writing it captures a torn copy, which then lands in the
 * shared folder and gets received onto every other machine. A read that
 * propagates a corrupt file to the whole team is worse than a write that breaks
 * one workspace.
 *
 * **It fails closed.** If we cannot tell whether ProPresenter is running -- `ps`
 * unavailable, an unfamiliar platform, output we cannot parse -- the answer is
 * no. An operation that can destroy a Sunday does not get to proceed on
 * uncertainty, and the cost of a false refusal is that someone quits
 * ProPresenter and runs it again.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { findOrphanedHelpers } from "./propresenter-doctor.js";

const execAsync = promisify(exec);

/**
 * Decides whether a library is safe to touch, from evidence rather than a
 * single signal.
 *
 * Pure, so the decision is testable without spawning anything -- which matters
 * because the failure mode here is silent and expensive, and a manual check
 * would not survive the next change.
 *
 * @param {object} evidence
 * @param {string|null} evidence.psOutput  `ps -Ao pid,ppid,comm`, or null if it could not be read
 * @param {boolean|null} evidence.apiReachable  whether ProPresenter's API answered, or null if unknown
 */
export function libraryWriteSafety({ psOutput = null, apiReachable = null } = {}) {
  // The API answering is proof the app is up, whatever the process list says.
  // Checked first because it is the least ambiguous signal available.
  if (apiReachable === true) {
    return {
      safe: false,
      reason: "ProPresenter is running — its API is answering.",
      evidence: { apiReachable: true },
    };
  }

  if (psOutput == null) {
    return {
      safe: false,
      reason:
        "Refrain could not check whether ProPresenter is running, so it will not touch the library. " +
        "Quit ProPresenter and try again.",
      evidence: { processListAvailable: false },
    };
  }

  const { rows, mainAppRunning } = findOrphanedHelpers(psOutput);

  if (mainAppRunning) {
    return {
      safe: false,
      reason: "ProPresenter is running. Quit it before syncing.",
      evidence: { mainAppRunning: true, processes: rows.length },
    };
  }

  // Helpers alone still count. They are the processes that hold the workspace
  // open, and a main app that has just quit can leave them writing for a while.
  if (rows.length > 0) {
    return {
      safe: false,
      reason:
        `ProPresenter is not fully closed — ${rows.length} of its processes are still running. ` +
        "Wait a few seconds, or clear them from the Health screen, then try again.",
      evidence: { mainAppRunning: false, processes: rows.length },
    };
  }

  return { safe: true, reason: null, evidence: { mainAppRunning: false, processes: 0 } };
}

/**
 * Gathers the evidence and asks.
 *
 * Every failure to gather is itself a refusal, per fail-closed above: a thrown
 * `ps`, a timeout, a platform without it. The one thing this must never do is
 * decide "probably fine".
 */
export async function checkLibrarySafeToTouch({ apiProbe = null, timeoutMs = 4000 } = {}) {
  let psOutput = null;
  try {
    const { stdout } = await execAsync("ps -Ao pid,ppid,comm", { timeout: timeoutMs });
    psOutput = stdout;
  } catch {
    psOutput = null; // refused below
  }

  let apiReachable = null;
  if (typeof apiProbe === "function") {
    try {
      apiReachable = Boolean(await apiProbe());
    } catch {
      // A failing probe means "not reachable", which is not on its own proof
      // the app is closed -- the process check still has to agree.
      apiReachable = false;
    }
  }

  return libraryWriteSafety({ psOutput, apiReachable });
}
