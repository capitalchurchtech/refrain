import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateChecks, checksFromScan, checkArrangementRefs, checkDuplicateNames, checkIndex, checksHeadline } from "../server/service-checks.js";
import { playbookPhases, checklistState, skippedSteps, DEFAULT_PHASES } from "../server/service-playbook.js";
import { renderDaySummary, flagsByService } from "../server/service-summary.js";
import { matchPlaylist, dateTokens, stepKey, foldDay, buildEvent, newServiceId, localTimeOn } from "../server/service-days.js";

const items = [
  { id: "HYMN", name: "Amazing Grace", arrangementUuid: "A-FULL", arrangementName: "Full" },
  { id: "TALK", name: "Message", arrangementUuid: "GONE", arrangementName: "Old cut" },
  { id: "LOOP", name: "Pre-roll", arrangementUuid: null },
];
const docs = new Map([
  ["HYMN", { presentation: { arrangements: [{ id: { uuid: "A-FULL", name: "Full" } }] } }],
  ["TALK", { presentation: { arrangements: [{ id: { uuid: "A-NEW", name: "New" } }] } }],
  ["LOOP", { presentation: { arrangements: [] } }],
]);
const scan = {
  items,
  docs,
  scannedCount: 3,
  truncated: false,
  mediaUnreadable: 0,
  presentations: [
    { presentationName: "Amazing Grace", slides: [{ slideIndex: 2, words: [{ word: "Gace" }], pastDates: [], missingMedia: [{ fileName: "sunrise.jpg" }] }] },
  ],
};

test("#5: a playlist entry pointing at an arrangement the presentation no longer has needs a look", () => {
  const r = checkArrangementRefs({ items, docs });
  assert.equal(r.status, "attention");
  assert.deepEqual(r.details.map((d) => d.name), ["Message"]);
  assert.match(r.details[0].text, /Old cut/);
  assert.equal(checkArrangementRefs({ items: [items[0]], docs }).status, "pass");
  assert.equal(checkArrangementRefs({ items: [items[0]], docs: new Map() }).status, "couldnt", "a presentation it couldn't read is not a pass");
});

test("one scan answers typos, past dates and missing media, naming each slide", () => {
  const [typos, dates, media] = checksFromScan(scan);
  assert.equal(typos.status, "attention");
  assert.deepEqual(typos.details[0], { name: "Amazing Grace", slide: 3, text: "Gace" });
  assert.equal(dates.status, "pass");
  assert.equal(media.status, "attention");
  const unread = checksFromScan({ ...scan, presentations: [], mediaUnreadable: 2 })[2];
  assert.equal(unread.status, "couldnt", "unreadable files are 'couldn't check', never 'everything is here'");
});

test("the index and duplicate-name checks look only at the playlist", () => {
  assert.equal(checkIndex({ items, indexedIds: new Set(["HYMN", "TALK", "LOOP"]), staleness: null }).status, "pass");
  assert.equal(checkIndex({ items, indexedIds: new Set(["HYMN"]), staleness: null }).status, "attention");
  const groups = [
    { name: "Amazing Grace", entries: [{ presentationId: "HYMN", folder: "Songs", name: "Amazing Grace" }, { presentationId: "X", folder: "Archive", name: "Amazing Grace" }] },
    { name: "Unrelated", entries: [{ presentationId: "Y", folder: "A" }, { presentationId: "Z", folder: "B" }] },
  ];
  const d = checkDuplicateNames({ items, groups });
  assert.equal(d.status, "attention");
  assert.equal(d.details.length, 1);
});

test("under performance mode, or with ProPresenter away, every reading check says couldn't, and says why", () => {
  const held = evaluateChecks({ connected: true, performanceArmed: true, scan: null, indexedIds: new Set(), groups: [] });
  assert.equal(held[0].status, "pass");
  assert.ok(held.slice(1).every((r) => r.status === "couldnt" && /Performance mode/.test(r.summary)));
  const away = evaluateChecks({ connected: false, performanceArmed: false, scan: null, indexedIds: new Set(), groups: [] });
  assert.ok(away.every((r) => r.status === "couldnt"));
  assert.equal(checksHeadline(away), `${away.length} couldn't be checked`);
  const ran = evaluateChecks({ connected: true, performanceArmed: false, scan, indexedIds: new Set(["HYMN", "TALK", "LOOP"]), groups: [] });
  assert.equal(ran.length, 7);
  assert.equal(checksHeadline(ran), "3 need a look");
});

test("this week's playlist is found by pattern and date, in every date style the library uses", () => {
  const ps = ["Sun 6/7/26 SL-09 (FS)", "Sun 9/27/26 SL-09 (FS)", "Sat Sep-26-26 SL-05", "Sun 9/2/26 SL-09", "Sat Oct 3 SL-05"].map((name, i) => ({ id: String(i), name }));
  assert.equal(matchPlaylist(ps, "SL-09", "2026-09-27").playlist.name, "Sun 9/27/26 SL-09 (FS)");
  assert.equal(matchPlaylist(ps, "SL-09", "2026-09-02").playlist.name, "Sun 9/2/26 SL-09", "9/2 is not 9/27");
  assert.equal(matchPlaylist(ps, "SL-05", "2026-09-26").playlist.name, "Sat Sep-26-26 SL-05");
  assert.equal(matchPlaylist(ps, "SL-05", "2026-10-03").playlist.name, "Sat Oct 3 SL-05");
  assert.equal(matchPlaylist(ps, "SL-09", "2026-10-04").playlist, null, "several and none dated: refuse to guess");
  assert.equal(matchPlaylist(ps, "SL-11", "2026-09-27").playlist, null);
  assert.ok(dateTokens("2026-09-27").includes("09/27/26"));
});

test("a configured playbook replaces the default; a broken one falls back and says why", () => {
  assert.equal(playbookPhases(undefined).phases, DEFAULT_PHASES);
  const { phases, problems } = playbookPhases([{ name: "Doors open", steps: ["Lights up", { label: "Lights up" }, { label: "Run checks", checks: true }] }]);
  assert.equal(phases[0].id, "doors-open");
  assert.deepEqual(phases[0].steps.map((s) => s.id), ["lights-up", "run-checks"]);
  assert.equal(problems.length, 1, "the duplicate step is reported");
  assert.equal(playbookPhases([]).phases, DEFAULT_PHASES);
});

test("per-service phases repeat for each service; checks and End tick themselves", () => {
  const services = [{ serviceId: "a", name: "Early" }, { serviceId: "b", name: "Late" }];
  const done = new Map([[stepKey("arrive", "screens", null), true]]);
  const list = checklistState(DEFAULT_PHASES, { services, isDone: (k) => done.get(k), checksRun: (id) => id === "a", dayEnded: false, stepKey });
  // "Between" follows every service but the last: nothing comes between the last one and End.
  assert.deepEqual(list.map((p) => `${p.phaseId}:${p.serviceName ?? "day"}`), ["arrive:day", "before:Early", "before:Late", "between:Early", "after:day"]);
  assert.equal(list[0].steps.find((s) => s.id === "screens").done, true);
  assert.equal(list[1].steps.find((s) => s.checks).done, true);
  assert.equal(list[2].steps.find((s) => s.checks).done, false);
  assert.ok(skippedSteps(list).every((s) => s.step !== "End the day"), "End is not a skipped step, it's the thing being done");
});

test("the day summary: rundown, flags by service and type, checks that needed a look, drift, and skipped steps", () => {
  const DAY = "2026-10-04";
  const at = (hhmm) => localTimeOn(DAY, hhmm);
  const added = buildEvent("service-added", { name: "Early", source: "today", startsAt: at("09:00") }, { now: at("08:00") });
  const sid = newServiceId(added);
  const events = [
    added,
    buildEvent("item-live", { presentationId: "HYMN", name: "Amazing | Grace", serviceId: sid, itemIndex: 0, seq: 1 }, { now: at("09:01") }),
    buildEvent("item-left", { presentationId: "HYMN", serviceId: sid, seq: 0 }, { now: at("09:05") }),
  ];
  const state = foldDay(events, { day: DAY });
  const flags = flagsByService(
    [
      { capturedAt: new Date(at("09:02")).toISOString(), presentationName: "Amazing Grace", slideIndex: 1, type: "Typo or spelling" },
      { capturedAt: new Date(at("14:00")).toISOString(), presentationName: "Other", type: null },
    ],
    state
  );
  assert.equal(flags.get(sid).length, 1);
  assert.equal(flags.get(null).length, 1);
  const md = renderDaySummary({
    day: DAY,
    services: [{ serviceId: sid, name: "Early", startsAt: at("09:00"), summary: { items: 1, startedAt: at("09:01"), runMs: 240_000 }, rows: [{ position: 1, name: "Amazing | Grace", firstLive: at("09:01"), onScreenMs: 240_000, gapBeforeMs: null, returns: [] }] }],
    outside: [],
    flags,
    checks: new Map([[sid, { at: at("08:30"), results: [{ label: "Likely typos", status: "attention", summary: "1 likely typo." }, { label: "Media", status: "pass", summary: "ok" }] }]]),
    skipped: [{ phase: "Arrive", service: null, step: "Stage display showing" }],
    drift: { ran: false, reason: "the Arrangement module is off on this machine" },
    reopened: false,
    endedAt: at("12:00"),
  });
  assert.match(md, /^# Sunday, October 4, 2026/);
  assert.match(md, /Amazing \\\| Grace/, "a pipe in a title can't break the table");
  assert.match(md, /Typo or spelling\*\* \(1\)/);
  assert.match(md, /Needs a look: Likely typos/);
  assert.doesNotMatch(md, /Media\. ok/, "passing checks aren't listed");
  assert.match(md, /Not compared: the Arrangement module is off/);
  const noneInPlan = renderDaySummary({ day: DAY, services: [], outside: [], flags: new Map(), checks: new Map(), skipped: [], drift: { ran: true, plan: { dates: "October 3 & 4" }, results: [] }, reopened: false, endedAt: at("12:00") });
  assert.match(noneInPlan, /None of the songs shown were in the most recent plan \(October 3 & 4\)/, "0 compared is not 'every song matched'");
  assert.match(md, /Stage display showing/);
  assert.match(md, /## Not in a service/);
});
