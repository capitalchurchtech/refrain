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

import { renderSendHtml } from "../public/service.js";

test("Send appears only when summaries are on, says when it leaves the machine, and shows the last outcome", () => {
  assert.equal(renderSendHtml({ status: "off" }), "");
  assert.match(renderSendHtml({ status: "misconfigured", problems: ["SMTP_HOST isn't set in .env."] }), /isn't set up: SMTP_HOST/);
  const html = renderSendHtml({ status: "active", backend: { id: "email", name: "Email", sendsOffMachine: true }, recipients: 3, lastSent: { ok: false, at: new Date().toISOString(), detail: "The mail server refused the password" } });
  assert.match(html, /sends the summary off this machine/);
  assert.match(html, /Send by Email to 3 recipients/);
  assert.match(html, /Didn't send at .*refused the password/);
});

import { autoEndLine } from "../public/service.js";

test("Day says ahead of time what auto-end will do", () => {
  assert.equal(autoEndLine({ status: "off" }), "");
  assert.equal(autoEndLine({ status: "done" }), "");
  const at = "2026-10-04T14:40:00";
  assert.match(autoEndLine({ status: "waiting", dueAt: at, trigger: "idle", sendable: true }), /Ends on its own and sends the summary at .*, if nothing goes live before then\./);
  assert.match(autoEndLine({ status: "waiting", dueAt: at, trigger: "closed", sendable: true }), /since ProPresenter is closed/);
  assert.match(autoEndLine({ status: "waiting", dueAt: at, trigger: "idle", sendable: false }), /won't be sent: sending isn't set up/);
  assert.match(autoEndLine({ status: "held", reason: "A lock-in is on." }), /For now: A lock-in is on\./);
});

import { picturesHtml } from "../public/service.js";

test("Slide pictures on Day: progress while it runs, and what the last run left ready", () => {
  assert.match(picturesHtml({ run: { running: true, presentations: 6, done: 2, drawn: 14, kept: 90 } }), /Updating pictures: 2 of 6 presentations\. 14 drawn, 90 kept/);
  assert.match(picturesHtml({ run: { running: true, presentations: 6 } }), /disabled/);
  assert.match(picturesHtml({ last: { lastRunAt: null } }), /Not updated yet today/);
  assert.match(picturesHtml({ last: { lastRunAt: new Date().toISOString(), presentations: 0 } }), /No playlists set for today's services/);
  const done = picturesHtml({ last: { lastRunAt: new Date().toISOString(), presentations: 5, ready: 120, total: 124, rendered: 8, kept: 112, stopped: true } });
  assert.match(done, /120 of 124 slides ready/);
  assert.match(done, /8 drawn, 112 kept/);
  assert.match(done, /Stopped part-way/);
});

test("Slide pictures off: Day says so and offers nothing to press", () => {
  const off = picturesHtml({ show: false, last: { lastRunAt: null } });
  assert.match(off, /Slide pictures are off/);
  assert.doesNotMatch(off, /service-pictures-btn/);
});
