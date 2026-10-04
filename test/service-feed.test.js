import { test } from "node:test";
import assert from "node:assert/strict";
import { getServiceFeedModuleStatus } from "../server/config.js";
import { renderLogSendHtml } from "../public/service.js";
import {
  applyServiceFeedSettings,
  buildStatus,
  imageKeyOf,
  cleanServiceFeedSettings,
  createServiceFeed,
  inWindow,
  isConfigFailure,
  logsToSend,
  serviceFeedProblems,
  statusFingerprint,
} from "../server/service-feed.js";

const good = { enabled: true, url: "https://announce.example.org/api/consoles", name: "Main", consoleId: "c1" };
const env = { SERVICE_FEED_TOKEN: "k" };
const live = (extra = {}) => ({
  connected: true,
  live: true,
  liveSince: null,
  performanceMode: { armed: false },
  slide: { presentationName: "Amazing Grace", arrangementName: null, slideIndex: 2, slideCount: 6, text: "Was blind but now I see" },
  ...extra,
});

test("off by default, and a missing address, name or key is misconfigured with a reason", () => {
  assert.equal(getServiceFeedModuleStatus({}).status, "off");
  const s = getServiceFeedModuleStatus({ serviceFeedModule: { enabled: true } }, {});
  assert.equal(s.status, "misconfigured");
  assert.equal(s.problems.length, 3);
  assert.equal(getServiceFeedModuleStatus({ serviceFeedModule: good }, env).status, "active");
});

test("the key is never sent over plain http, except to this machine", () => {
  assert.match(serviceFeedProblems({ ...good, url: "http://announce.example.org" }, env)[0], /https/);
  assert.deepEqual(serviceFeedProblems({ ...good, url: "http://localhost:3000/api/consoles" }, env), []);
});

test("slide words only go when the church asked for them", () => {
  const args = { live: live(), consoleId: "c1", appVersion: "1", seq: 1, now: 0 };
  assert.equal("text" in buildStatus({ ...args, mod: good }).slide, false);
  assert.equal(buildStatus({ ...args, mod: { ...good, includeSlideText: true } }).slide.text, "Was blind but now I see");
});

test("the fingerprint ignores the clock and the counter, not the slide", () => {
  const a = buildStatus({ live: live(), mod: good, consoleId: "c1", appVersion: "1", seq: 1, now: 0 });
  const b = buildStatus({ live: live(), mod: good, consoleId: "c1", appVersion: "1", seq: 9, now: 99999 });
  const c = buildStatus({ live: live({ slide: { slideIndex: 3 } }), mod: good, consoleId: "c1", appVersion: "1", seq: 1, now: 0 });
  assert.equal(statusFingerprint(a), statusFingerprint(b));
  assert.notEqual(statusFingerprint(a), statusFingerprint(c));
});

test("logs to send: only day files whose size the server has not already accepted, oldest first", () => {
  const files = [
    { name: "2026-10-02.jsonl", size: 50 },
    { name: "2026-10-01.jsonl", size: 40 },
    { name: "notes.txt", size: 5 },
    { name: "2026-09-30.jsonl", size: 30 },
    { name: "2026-10-03.jsonl", size: 0 },
  ];
  assert.deepEqual(logsToSend(files, { "2026-09-30.jsonl": 30, "2026-10-02.jsonl": 20 }).map((f) => f.name), ["2026-10-01.jsonl", "2026-10-02.jsonl"]);
});

test("a wrong key is the church's to fix; a busy server is not", () => {
  assert.equal(isConfigFailure(401), true);
  assert.equal(isConfigFailure(403), true);
  assert.equal(isConfigFailure(429), false);
  assert.equal(isConfigFailure(503), false);
});

function rig({ responses = [], files = [], frozen = false } = {}) {
  const calls = [];
  let clock = new Date("2026-10-04T09:00:00").getTime();
  let saved = {};
  const feed = createServiceFeed({
    getModule: () => good,
    getLive: () => live(),
    isFrozen: () => frozen,
    appVersion: "1",
    env,
    now: () => clock,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const status = responses.shift() ?? 204;
      return { ok: status < 300, status };
    },
    listLogs: async () => files,
    readLog: async () => "x".repeat(files[0]?.size ?? 0),
    loadSent: async () => saved,
    saveSent: async (s) => (saved = s),
  });
  return { feed, calls, advance: (ms) => (clock += ms), sent: () => saved.days ?? {}, saved: () => saved, setModule: (m) => Object.assign(good, m) };
}

test("status goes on change, then waits thirty seconds as proof of life", async () => {
  const r = rig();
  assert.equal(await r.feed.tickStatus(), true);
  assert.equal(r.calls[0].url, "https://announce.example.org/api/consoles/status");
  assert.equal(r.calls[0].init.headers.authorization, "Bearer k");
  r.advance(5000);
  assert.equal(await r.feed.tickStatus(), false, "nothing changed and not yet thirty seconds");
  r.advance(26_000);
  assert.equal(await r.feed.tickStatus(), true);
});

test("a failed status push is dropped, and a refused key backs off instead of hammering", async () => {
  const r = rig({ responses: [401] });
  assert.equal(await r.feed.tickStatus(), false);
  assert.match(r.feed.state().lastError, /did not accept/);
  r.advance(60_000);
  assert.equal(await r.feed.tickStatus(), false, "held off for minutes after a refusal");
  assert.equal(r.calls.length, 1);
});

test("a log is marked sent only after the server accepted it; a failure leaves it to retry", async () => {
  const r = rig({ files: [{ name: "2026-10-02.jsonl", size: 12 }], responses: [503, 204] });
  const first = await r.feed.sendLogs();
  assert.equal(first.ok, false);
  assert.deepEqual(r.sent(), {}, "nothing marked after a failure");
  const second = await r.feed.sendLogs();
  assert.deepEqual([second.ok, second.sent], [true, 1]);
  assert.deepEqual(r.sent(), { "2026-10-02.jsonl": 12 });
  assert.equal(r.calls[1].init.method, "PUT");
  assert.equal((await r.feed.sendLogs()).sent, 0, "identical, so nothing goes again");
});

test("logs never go on their own, only when asked", async () => {
  const r = rig({ files: [{ name: "2026-10-02.jsonl", size: 12 }] });
  await r.feed.tickStatus();
  assert.equal(r.calls.every((c) => c.url.endsWith("/status")), true);
});

test("a person can send the log outside the window, but not during performance mode", async () => {
  const r = rig({ files: [{ name: "2026-10-02.jsonl", size: 12 }] });
  r.advance(3 * 86_400_000); // Wednesday, closed window
  assert.equal((await r.feed.sendLogs()).sent, 1);
  const busy = rig({ files: [{ name: "2026-10-02.jsonl", size: 12 }], frozen: true });
  const out = await busy.feed.sendLogs();
  assert.match(out.error, /Performance mode/);
  assert.equal(busy.calls.length, 0);
});

test("the window is Sunday 9 to 2 by default, local time, and a bad one never means always", () => {
  const at = (iso) => new Date(iso); // no zone suffix: local time
  assert.equal(inWindow({}, at("2026-10-04T09:30:00")), true, "Sunday 9:30");
  assert.equal(inWindow({}, at("2026-10-04T14:00:00")), false, "Sunday 2pm exactly is closed");
  assert.equal(inWindow({}, at("2026-10-04T08:59:00")), false);
  assert.equal(inWindow({}, at("2026-10-05T09:30:00")), false, "Monday");
  assert.equal(inWindow({ windows: [{ days: ["wed"], from: "bad", until: "14:00" }] }, at("2026-10-07T09:30:00")), false, "falls back to Sunday");
  assert.equal(inWindow({ windows: [] }, at("2026-10-04T10:00:00")), true, "cleared windows mean the default, not always");
  const two = { windows: [{ days: ["sun"], from: "09:00", until: "14:00" }, { days: ["wed"], from: "18:00", until: "21:00" }] };
  assert.equal(inWindow(two, at("2026-10-07T19:00:00")), true, "a second window");
});

test("settings from the tab are checked and tidied", () => {
  assert.equal(cleanServiceFeedSettings({ name: "x" }).ok, false, "enabled is required");
  assert.equal(cleanServiceFeedSettings({ enabled: true, windows: [{ days: [], from: "09:00", until: "14:00" }] }).ok, false, "a window needs a day");
  assert.equal(cleanServiceFeedSettings({ enabled: true, windows: [{ days: ["sun"], from: "14:00", until: "09:00" }] }).ok, false, "start before end");
  const ok = cleanServiceFeedSettings({ enabled: true, name: "  FOH  ", url: " https://a.example ", windows: [{ days: ["sun", "fri"], from: "09:00", until: "14:00" }], extra: 1 });
  assert.deepEqual(ok.value, { enabled: true, name: "FOH", url: "https://a.example", includeSlideText: false, includeSlideImage: false, windows: [{ days: ["sun", "fri"], from: "09:00", until: "14:00" }] });
});

test("outside the window no status is sent", async () => {
  const r = rig({ files: [{ name: "2026-10-02.jsonl", size: 12 }] });
  r.advance(3 * 86_400_000); // Wednesday
  assert.equal(await r.feed.tickStatus(), false);
  assert.equal(r.calls.length, 0);
  assert.equal(r.feed.state().inWindow, false);
});

test("a window that closes mid-service says not live on the way out, once", async () => {
  const r = rig();
  assert.equal(await r.feed.tickStatus(), true, "live inside the window");
  r.advance(6 * 3600_000); // 15:00, closed
  assert.equal(await r.feed.tickStatus(), true, "one goodbye");
  const body = JSON.parse(r.calls.at(-1).init.body);
  assert.deepEqual([body.live, body.slide], [false, null]);
  r.advance(60_000);
  assert.equal(await r.feed.tickStatus(), false, "then silence");
  assert.equal(r.calls.length, 2);
});

test("a key bound to another console id reads as a setup problem and backs off", async () => {
  const r = rig({ responses: [403] });
  await r.feed.tickStatus();
  assert.match(r.feed.state().lastError, /Reset key/);
  r.advance(60_000);
  assert.equal(await r.feed.tickStatus(), false);
  assert.equal(r.calls.length, 1);
});

test("a log a different server never saw is sent again after the address changes", async () => {
  const r = rig({ files: [{ name: "2026-10-02.jsonl", size: 12 }] });
  assert.equal((await r.feed.sendLogs()).sent, 1);
  assert.equal((await r.feed.sendLogs()).sent, 0);
  const original = good.url;
  r.setModule({ url: "https://production.example.org/api/consoles" });
  assert.equal((await r.feed.sendLogs()).sent, 1, "new address starts from nothing");
  r.setModule({ url: original });
});

test("the sent marker is the file's size on disk, so non-ASCII text cannot make it re-send forever", async () => {
  const r = rig({ files: [{ name: "2026-10-02.jsonl", size: 12 }] });
  await r.feed.sendLogs();
  assert.equal(r.saved().days["2026-10-02.jsonl"], 12);
});

test("a refused log upload does not silence live status", async () => {
  const r = rig({ files: [{ name: "2026-10-02.jsonl", size: 12 }], responses: [413] });
  assert.equal((await r.feed.sendLogs()).ok, false);
  assert.equal(r.feed.state().lastError, null);
  assert.equal(await r.feed.tickStatus(), true);
});

test("a goodbye that cannot be delivered is retried a few times, not every tick", async () => {
  const r = rig({ responses: [204, 503, 503, 503, 503, 503] });
  await r.feed.tickStatus();
  r.advance(6 * 3600_000);
  await r.feed.tickStatus();
  await r.feed.tickStatus();
  assert.equal(r.calls.length, 2, "the retry waits thirty seconds");
  for (let i = 0; i < 6; i++) {
    r.advance(31_000);
    await r.feed.tickStatus();
  }
  assert.equal(r.calls.length, 4, "one status and three goodbyes, then it stops");
});

test("turning telemetry off mid-service still says not live", async () => {
  const r = rig();
  await r.feed.tickStatus();
  r.setModule({ enabled: false });
  r.advance(31_000);
  assert.equal(await r.feed.tickStatus(), true);
  assert.equal(JSON.parse(r.calls.at(-1).init.body).live, false);
  r.setModule({ enabled: true });
});

test("saving settings mints a console id once, on first enable, and keeps the rest", () => {
  let n = 0;
  const id = () => `id${++n}`;
  const value = { enabled: false, name: "A", url: null, includeSlideText: false, windows: [] };
  const off = applyServiceFeedSettings({ theme: "dark" }, value, id);
  assert.equal(off.serviceFeedModule.consoleId, null);
  const on = applyServiceFeedSettings(off, { ...value, enabled: true }, id);
  assert.equal(on.serviceFeedModule.consoleId, "id1");
  assert.equal(applyServiceFeedSettings(on, { ...value, enabled: true, name: "B" }, id).serviceFeedModule.consoleId, "id1");
  assert.equal(on.theme, "dark");
});

test("Send log shows only when telemetry is set up", () => {
  assert.equal(renderLogSendHtml({ status: "off" }), "");
  assert.equal(renderLogSendHtml(undefined), "");
  assert.match(renderLogSendHtml({ status: "misconfigured" }), /isn't set up/);
  const active = renderLogSendHtml({ status: "active", lastLogOkAt: null });
  assert.match(active, /service-send-log-btn/);
  assert.match(active, /Not sent yet/);
});

const picRig = (extra = {}) => {
  const calls = [];
  const mod = { ...good, includeSlideImage: true };
  let clock = new Date("2026-10-04T09:00:00").getTime();
  const feed = createServiceFeed({
    getModule: () => mod, getLive: () => live({ slide: { presentationId: "p1", presentationName: "A", slideIndex: 2, slideCount: 6 } }),
    appVersion: "1", env, now: () => clock,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 204 }; },
    getPicture: extra.getPicture ?? (async () => ({ type: "image/jpeg", bytes: Buffer.from("jpg") })),
    listLogs: async () => [], readLog: async () => "", loadSent: async () => ({}), saveSent: async () => {},
  });
  return { feed, calls, advance: (ms) => (clock += ms) };
};

test("with picture sending on, the status names the picture and it follows once per slide", async () => {
  const r = picRig();
  await r.feed.tickStatus();
  const status = JSON.parse(r.calls[0].init.body);
  assert.equal(status.slide.imageKey, "p1:2");
  assert.equal(r.calls[1].url.endsWith("/image"), true);
  assert.equal(r.calls[1].init.headers["x-slide-key"], "p1:2");
  r.advance(31_000);
  await r.feed.tickStatus();
  assert.equal(r.calls.filter((c) => c.url.endsWith("/image")).length, 1, "same slide, not sent again");
});

test("with picture sending off there is no imageKey", () => {
  const status = buildStatus({ live: live({ slide: { presentationId: "p1", slideIndex: 1 } }), mod: good, consoleId: "c1", appVersion: "1", seq: 1, now: 0 });
  assert.equal("imageKey" in status.slide, false);
  assert.equal(imageKeyOf({ presentationId: "p1", slideIndex: 1 }), "p1:1");
});

test("a slide with no picture ready sends none, tries a few times, and never disturbs status", async () => {
  let asked = 0;
  const r = picRig({ getPicture: async () => (asked++, null) });
  await r.feed.tickStatus();
  for (let i = 0; i < 6; i++) { r.advance(31_000); await r.feed.tickStatus(); }
  assert.equal(r.calls.some((c) => c.url.endsWith("/image")), false);
  assert.equal(asked, 3, "three tries, then left alone");
  assert.equal(r.feed.state().lastError, null);
});

test("a picture over the size cap is not sent", async () => {
  const r = picRig({ getPicture: async () => ({ type: "image/jpeg", bytes: Buffer.alloc(300 * 1024) }) });
  await r.feed.tickStatus();
  assert.equal(r.calls.some((c) => c.url.endsWith("/image")), false);
});

test("settings carry the picture choice, off unless asked", () => {
  assert.equal(cleanServiceFeedSettings({ enabled: true }).value.includeSlideImage, false);
  assert.equal(cleanServiceFeedSettings({ enabled: true, includeSlideImage: true }).value.includeSlideImage, true);
});
