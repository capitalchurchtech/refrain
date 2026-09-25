import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  dayKey,
  localTimeOn,
  buildEvent,
  newServiceId,
  scheduledServices,
  scheduleProblems,
  foldDay,
  serviceWindow,
  shouldHoldPace,
  assignService,
  transitionEvents,
  timelineRows,
  serviceSummary,
  lockinReminder,
  saveEvent,
  readDay,
  retryPendingEvents,
} from "../server/service-days.js";

const DAY = "2026-10-04"; // a Sunday
const at = (hhmm, sec = 0) => localTimeOn(DAY, hhmm) + sec * 1000;
const ev = (type, fields, hhmm, sec) => buildEvent(type, fields, { now: at(hhmm, sec), machine: "test" });

// A generic two-item plan with a pre-roll that loops back at the end.
const PLAYLIST = {
  id: "PL",
  name: "Early",
  items: [
    { presentationId: "ROLL", name: "Pre-roll", arrangementName: "Pre" },
    { presentationId: "HYMN", name: "Amazing Grace", arrangementName: "Full" },
    { presentationId: "TALK", name: "Message", arrangementName: null },
    { presentationId: "ROLL", name: "Pre-roll", arrangementName: "Post" },
  ],
};

function withService(extra = [], { startsAt = at("09:00") } = {}) {
  const added = ev("service-added", { name: "Early", source: "today", startsAt, playlist: PLAYLIST }, "08:00");
  return { added, serviceId: newServiceId(added), events: [added, ...extra] };
}

// Plays a list of [hhmm, sec, presentationId|null, arrangementName] through the
// recorder the way the heartbeat does, returning every event written.
function play(baseEvents, steps, opts = {}) {
  const events = [...baseEvents];
  for (const [hhmm, sec, presentationId, arrangementName] of steps) {
    const state = foldDay(events, { day: DAY, ...opts });
    const current = presentationId ? { presentationId, name: presentationId, arrangementName } : null;
    events.push(...transitionEvents(state, current, at(hhmm, sec), { machine: "test" }));
  }
  return events;
}

test("a wall-clock time stays on the clock across a daylight-saving change", () => {
  // 2026-11-01 is the US fall-back date; 09:00 must still read 09:00 locally.
  const ms = localTimeOn("2026-11-01", "09:00");
  const d = new Date(ms);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 0);
  assert.equal(dayKey(ms), "2026-11-01");
  assert.equal(localTimeOn(DAY, "25:00"), null);
  assert.equal(localTimeOn(DAY, "9"), null);
});

test("a recurring schedule yields only the services on that weekday", () => {
  const schedule = [
    { day: "sun", time: "09:00", name: "Early" },
    { day: ["sun", "wed"], time: "18:30", name: "Evening" },
    { day: "sat", time: "17:00", name: "Vigil" },
    { day: "sun", time: "nope", name: "Broken" },
  ];
  assert.deepEqual(scheduledServices(DAY, schedule).map((s) => s.name), ["Early", "Evening"]);
  assert.deepEqual(scheduledServices("2026-10-07", schedule).map((s) => s.name), ["Evening"]);
  assert.equal(scheduleProblems(schedule).length, 1);
  assert.deepEqual(scheduleProblems(undefined), []);
  assert.equal(scheduleProblems("sun").length, 1);
});

test("the timeline records first live, time on screen, the gap before, and returns without overwriting", () => {
  const { events, serviceId } = withService();
  const all = play(events, [
    ["08:58", 0, "ROLL", "Pre"],
    ["09:01", 0, "HYMN", "Full"],
    ["09:05", 10, null], // cleared for ten seconds
    ["09:05", 20, "TALK"],
    ["09:40", 0, "HYMN", "Full"], // back to the hymn at the end
    ["09:42", 0, "ROLL", "Post"],
    ["09:45", 0, null],
  ]);
  const rows = timelineRows(foldDay(all, { day: DAY }), serviceId, at("10:00"));
  assert.deepEqual(
    rows.map((r) => [r.position, r.name, r.onScreenMs / 1000, r.gapBeforeMs == null ? null : r.gapBeforeMs / 1000, r.returns.length]),
    [
      [1, "Pre-roll", 180, null, 0],
      [2, "Amazing Grace", 250 + 120, 0, 1], // 4:10 first, then 2:00 on the return
      [3, "Message", 34 * 60 + 40, 10, 0],
      [4, "Pre-roll", 180, 0, 0], // the second pre-roll is the fourth item, not a return of the first
    ]
  );
  assert.equal(rows[1].firstLive, at("09:01"), "the return did not overwrite the first activation");
  assert.equal(rows[1].lastLive, at("09:40"));
});

test("something not in the playlist is kept, marked off-plan", () => {
  const { events, serviceId } = withService();
  const all = play(events, [
    ["09:00", 0, "HYMN", "Full"],
    ["09:04", 0, "EXTRA"],
    ["09:06", 0, null],
  ]);
  const rows = timelineRows(foldDay(all, { day: DAY }), serviceId, at("10:00"));
  assert.deepEqual(rows.map((r) => [r.name, r.offPlan]), [["Amazing Grace", false], ["EXTRA", true]]);
});

test("advancing slides inside one presentation is not a new item", () => {
  const { events } = withService();
  const state = foldDay(play(events, [["09:00", 0, "HYMN", "Full"]]), { day: DAY });
  assert.deepEqual(transitionEvents(state, { presentationId: "HYMN", arrangementName: "Full" }, at("09:01")), []);
});

test("outside every service, what goes live is still recorded, with no service", () => {
  const all = play([], [["14:00", 0, "HYMN"], ["14:05", 0, null]]);
  const state = foldDay(all, { day: DAY });
  assert.equal(state.segments.length, 1);
  assert.equal(state.segments[0].serviceId, null);
});

test("two watched services 90 minutes apart: each item goes to the service whose playlist has it, else the nearer start", () => {
  const early = ev("service-added", { name: "Early", source: "today", startsAt: at("09:00"), playlist: PLAYLIST }, "08:00");
  const late = ev(
    "service-added",
    { name: "Late", source: "today", startsAt: at("10:30"), playlist: { id: "PL2", name: "Late", items: [{ presentationId: "LATE-ONLY", name: "Late song" }] } },
    "08:00",
    1
  );
  const state = foldDay([early, late], { day: DAY });
  assert.equal(assignService(state, { presentationId: "LATE-ONLY" }, at("10:20")).serviceId, newServiceId(late));
  assert.equal(assignService(state, { presentationId: "HYMN" }, at("10:20")).serviceId, newServiceId(early));
  assert.equal(assignService(state, { presentationId: "UNKNOWN" }, at("10:20")).serviceId, newServiceId(late), "10:20 is nearer 10:30 than 9:00");
});

test("a late start inside the window still belongs to the service; one far outside does not", () => {
  const { events, serviceId } = withService();
  const state = foldDay(events, { day: DAY });
  assert.equal(assignService(state, { presentationId: "HYMN" }, at("09:20")).serviceId, serviceId);
  // Past the trail but the playlist still matches: a timed service is only watched in its window.
  assert.equal(assignService(state, { presentationId: "HYMN" }, at("13:00")).serviceId, null);
});

test("the heartbeat holds its pace inside a window or a lock-in, and relaxes outside", () => {
  const { events } = withService();
  const state = foldDay(events, { day: DAY });
  assert.equal(shouldHoldPace(state, at("08:40")), false, "before the 15-minute lead");
  assert.equal(shouldHoldPace(state, at("08:46")), true);
  assert.equal(shouldHoldPace(state, at("11:31")), false, "after the 150-minute trail");
  const ended = foldDay([...events, ev("service-ended", { serviceId: newServiceId(events[0]) }, "10:00")], { day: DAY });
  assert.equal(shouldHoldPace(ended, at("10:05")), false, "ended by hand");
});

test("lock-in: everything that goes live belongs to it until released, and release ends it", () => {
  const added = ev("service-added", { name: "Carols", source: "lockin" }, "18:00");
  const sid = newServiceId(added);
  const started = ev("lockin-started", { serviceId: sid, name: "Carols", armedPerformance: true }, "18:00", 1);
  let events = [added, started];
  let state = foldDay(events, { day: DAY });
  assert.equal(state.lockin.serviceId, sid);
  assert.equal(state.lockin.armedPerformance, true);
  assert.equal(shouldHoldPace(state, at("23:59")), true, "open-ended");
  events = play(events, [["18:05", 0, "HYMN"], ["18:10", 0, "TALK"], ["18:40", 0, null]]);
  events.push(ev("lockin-released", { serviceId: sid }, "19:00"));
  state = foldDay(events, { day: DAY });
  assert.equal(state.lockin, null);
  assert.equal(shouldHoldPace(state, at("19:01")), false);
  assert.deepEqual(timelineRows(state, sid, at("20:00")).map((r) => r.name), ["HYMN", "TALK"]);
  assert.equal(serviceSummary(state, sid, at("20:00")).runMs, 35 * 60_000);
});

test("a lock-in is pointed out after six hours, never released by that", () => {
  const lockin = { startedAt: at("08:00") };
  assert.equal(lockinReminder(lockin, at("13:59")), null);
  assert.deepEqual(lockinReminder(lockin, at("14:30")), { hours: 6 });
  assert.equal(lockinReminder(null, at("14:30")), null);
});

test("restart mid-service: folding the saved events gives back what was live", () => {
  const { events, serviceId } = withService();
  const all = play(events, [["09:00", 0, "HYMN", "Full"]]);
  const state = foldDay(all, { day: DAY }); // what a fresh process sees
  assert.equal(state.openItem.presentationId, "HYMN");
  assert.equal(state.openItem.serviceId, serviceId);
  // The same thing still live after the restart writes nothing new.
  assert.deepEqual(transitionEvents(state, { presentationId: "HYMN" }, at("09:03")), []);
});

test("events are saved one file each, readable back, and a waiting copy is retried", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "svc-"));
  try {
    const folder = path.join(dir, "shared");
    const pendingDir = path.join(dir, "pending");
    const e1 = ev("service-added", { name: "Early", source: "today" }, "08:00");
    assert.deepEqual(await saveEvent(e1, { folder, pendingDir }), { shared: true });
    // A shared folder that is really a file cannot be written: the event must still be safe here.
    const blocked = path.join(dir, "blocked");
    await (await import("node:fs/promises")).writeFile(blocked, "not a folder");
    const e2 = ev("item-live", { presentationId: "HYMN" }, "09:00");
    const r = await saveEvent(e2, { folder: blocked, pendingDir });
    assert.equal(r.shared, false);
    assert.deepEqual((await readDay(DAY, { folder: blocked, pendingDir })).map((e) => e.type), ["item-live"]);
    const retried = await retryPendingEvents({ folder, pendingDir });
    assert.deepEqual(retried, { attempted: 1, succeeded: 1 });
    assert.equal((await readdir(path.join(folder, DAY))).length, 2);
    await assert.rejects(saveEvent({ id: "bad", day: DAY }, { folder, pendingDir }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("damaged or foreign files in a day folder are ignored", () => {
  const state = foldDay([{ type: "nonsense", at: "x" }, null, ev("item-live", { presentationId: "HYMN" }, "09:00")], { day: DAY });
  assert.equal(state.openItem.presentationId, "HYMN");
  assert.equal(serviceWindow({ source: "today", startsAt: null }), null);
});

test("a service with no time claims an off-plan item while it is running, and not after it goes quiet", () => {
  const added = ev("service-added", { name: "Rehearsal", source: "today", startsAt: null, playlist: PLAYLIST }, "08:00");
  const sid = newServiceId(added);
  const all = play([added], [
    ["09:00", 0, "HYMN", "Full"],
    ["09:04", 0, "EXTRA"], // not in the playlist, but the service is running
    ["09:06", 0, null],
    ["11:00", 0, "OTHER"], // two hours of nothing: no longer running
    ["11:02", 0, null],
  ]);
  const state = foldDay(all, { day: DAY });
  assert.deepEqual(timelineRows(state, sid, at("12:00")).map((r) => [r.name, r.offPlan]), [["Amazing Grace", false], ["EXTRA", true]]);
  assert.deepEqual(timelineRows(state, null, at("12:00")).map((r) => r.name), ["OTHER"]);
});
