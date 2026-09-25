import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, comparisonText, renderRowsHtml, renderServicesHtml, renderLockinHtml, paceNote } from "../public/service.js";

test("durations read like a stopwatch", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(250_000), "4:10");
  assert.equal(formatDuration(4_360_000), "1:12:40");
  assert.equal(formatDuration(NaN), "–");
});

test("a later service is compared with the first one that ran, once both have ended", () => {
  const svc = (id, name, runMs, ended = true) => ({ serviceId: id, name, summary: { items: 5, runMs, endedAt: ended ? "x" : null } });
  const early = svc("a", "Early", 60 * 60_000);
  assert.equal(comparisonText(svc("b", "Late", 63 * 60_000 + 40_000), early), "3:40 longer than Early");
  assert.equal(comparisonText(svc("b", "Late", 58 * 60_000), early), "2:00 shorter than Early");
  assert.equal(comparisonText(svc("b", "Late", 60 * 60_000 + 10_000), early), "about the same as Early");
  assert.equal(comparisonText(svc("b", "Late", 10, false), early), "", "not while it is still running");
  assert.equal(comparisonText(early, early), "");
});

test("the rundown shows position, off-plan items, what is on screen, and returns", () => {
  const html = renderRowsHtml([
    { position: 2, name: "Amazing Grace", offPlan: false, live: false, firstLive: "2026-10-04T15:01:00Z", onScreenMs: 250_000, gapBeforeMs: 8_000, returns: [{ at: "2026-10-04T15:40:00Z", onScreenMs: 100_000 }] },
    { position: null, name: "<b>Extra</b>", offPlan: true, live: true, firstLive: "2026-10-04T15:44:00Z", onScreenMs: 55_000, gapBeforeMs: null, returns: [] },
  ]);
  assert.match(html, /Amazing Grace/);
  assert.match(html, /4:10/);
  assert.match(html, /↺ back again/);
  assert.match(html, /Off-plan/);
  assert.match(html, /On screen/);
  assert.match(html, /&lt;b&gt;Extra/, "names are escaped");
  assert.match(renderRowsHtml([]), /Nothing has gone live yet/);
});

test("an empty day says what to do, and a lock-in offers Release", () => {
  assert.match(renderServicesHtml({ services: [] }), /No services today yet/);
  const locked = renderLockinHtml({ lockin: { name: "Carols", startedAt: new Date(Date.now() - 60_000).toISOString() }, lockinReminder: null });
  assert.match(locked, /Locked in: Carols/);
  assert.match(locked, /service-release-btn/);
  assert.match(renderLockinHtml({ lockin: null }), /Lock in for an event/);
  assert.match(renderLockinHtml({ lockin: { name: "X", startedAt: new Date().toISOString() }, lockinReminder: { hours: 7 } }), /7 hours/);
});

test("the timing note is honest about the pace it was recorded at", () => {
  assert.match(paceNote({ holdingPace: true }), /about 4 seconds/);
  assert.match(paceNote({ holdingPace: false, beatMs: 30_000 }), /30 seconds/);
});
