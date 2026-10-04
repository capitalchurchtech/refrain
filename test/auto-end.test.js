import { test } from "node:test";
import assert from "node:assert/strict";
import { autoEndSettings, autoEndPlan, autoEndNote, withAutoNote } from "../server/auto-end.js";

const H = 3_600_000;
const on = autoEndSettings({ enabled: true });
const day = (extra = {}) => ({ services: [], segments: [{ endMs: 10 * H }], openItem: null, lockin: null, dayEnds: [], ...extra });
const plan = (over = {}) => autoEndPlan({ now: 11 * H, settings: on, state: day(), liveNow: false, performanceArmed: false, closedSince: null, ...over });

test("settings: off by default, 2 hours and 15 minutes, bounded", () => {
  assert.deepEqual(autoEndSettings(undefined), { enabled: false, idleMinutes: 120, closedMinutes: 15 });
  assert.deepEqual(autoEndSettings({ enabled: true, idleMinutes: 1, closedMinutes: 9999 }), { enabled: true, idleMinutes: 120, closedMinutes: 15 });
  assert.equal(autoEndSettings({ enabled: "yes" }).enabled, false);
});

test("off, already ended, or nothing went live: never", () => {
  assert.equal(plan({ settings: autoEndSettings({}) }).status, "off");
  assert.equal(plan({ state: day({ dayEnds: [{ at: 1 }] }) }).status, "done");
  assert.equal(plan({ state: day({ segments: [] }) }).status, "nothing");
});

test("held during a lock-in, performance mode, content on screen, or before a later service", () => {
  assert.equal(plan({ state: day({ lockin: { serviceId: "x" } }) }).status, "held");
  assert.equal(plan({ performanceArmed: true }).status, "held");
  assert.equal(plan({ liveNow: true }).status, "held");
  const later = plan({ state: day({ services: [{ startsAt: 18 * H, endedAt: null }] }) });
  assert.equal(later.status, "held");
  assert.equal(later.dueAt, 18 * H);
  assert.equal(plan({ state: day({ services: [{ startsAt: 9 * H, endedAt: null }] }) }).status, "waiting", "an earlier service doesn't hold it");
});

test("idle: due two hours after the last thing on the screens", () => {
  const waiting = plan({ now: 11 * H });
  assert.deepEqual(waiting, { status: "waiting", dueAt: 12 * H, trigger: "idle" });
  assert.equal(plan({ now: 12 * H }).status, "due");
});

test("closed: due 15 minutes after ProPresenter was first seen not running, if that's sooner", () => {
  const closed = plan({ now: 10.5 * H, closedSince: 10.2 * H });
  assert.equal(closed.status, "due");
  assert.equal(closed.trigger, "closed");
  assert.equal(plan({ now: 10.3 * H, closedSince: 10.2 * H }).status, "waiting", "a restart is back long before 15 minutes");
});

test("the summary says why it ended", () => {
  assert.equal(autoEndNote("idle", on), "Ended automatically: nothing had been on the screens for 2 hours.");
  assert.equal(autoEndNote("closed", on), "Ended automatically: ProPresenter had been closed for 15 minutes.");
  assert.equal(autoEndNote("idle", autoEndSettings({ enabled: true, idleMinutes: 90 })), "Ended automatically: nothing had been on the screens for 90 minutes.");
});

test("the note goes just under the summary's title", () => {
  assert.equal(withAutoNote("# Sunday\n\nEnded 2 PM.\n", "Ended automatically: x."), "# Sunday\n\n_Ended automatically: x._\n\nEnded 2 PM.\n");
  assert.equal(withAutoNote("No title", "N."), "_N._\n\nNo title");
});

test("held while a service is under way, so a crash mid-service doesn't end the day", () => {
  const p = plan({ now: 10.5 * H, closedSince: 10.2 * H, serviceUnderWay: true });
  assert.equal(p.status, "held");
  assert.equal(p.reason, "A service is under way.");
});
