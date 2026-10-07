import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanRequest, createStaffRequests, REQUEST_TTL_MS, MAX_WAITING, MAX_REQUEST_TEXT } from "../server/staff-requests.js";

const T0 = Date.parse("2026-10-11T10:00:00Z");
const mod = { enabled: true, url: "https://announce.example.org/api/consoles", name: "Main", consoleId: "c1" };
const env = { SERVICE_FEED_TOKEN: "k" };
const iso = (ms) => new Date(ms).toISOString();

test("cleanRequest keeps one tidy line and says why it refuses the rest", () => {
  const ok = cleanRequest({ id: "r-1", text: "  Code\t48213\n please  ", from: " Children's Ministry ", createdAt: iso(T0 - 60_000) }, T0);
  assert.equal(ok.ok, true);
  assert.equal(ok.request.text, "Code 48213 please", "control characters and runs of space become single spaces");
  assert.equal(ok.request.from, "Children's Ministry");
  assert.equal(ok.request.expiresAt, T0 - 60_000 + REQUEST_TTL_MS);
  assert.equal(cleanRequest({ id: "bad id!", text: "x" }, T0).ok, false, "an id that is not plain");
  assert.equal(cleanRequest({ id: "a", text: "   " }, T0).reason, "empty");
  assert.equal(cleanRequest({ id: "a", text: "x".repeat(MAX_REQUEST_TEXT + 1) }, T0).reason, "too long");
  assert.equal(cleanRequest({ id: "a", text: "x".repeat(MAX_REQUEST_TEXT) }, T0).ok, true, "80 is allowed");
  assert.equal(cleanRequest(null, T0).ok, false);
  assert.equal(cleanRequest({ id: "a", text: "x" }, T0).request.from, "Staff", "no sender becomes Staff");
});

test("a request made in the future counts as made now, so it cannot outlive eight minutes", () => {
  const r = cleanRequest({ id: "a", text: "x", createdAt: iso(T0 + 3_600_000) }, T0).request;
  assert.equal(r.createdAt, T0);
  assert.equal(r.expiresAt, T0 + REQUEST_TTL_MS);
});

/** A console with a fake announcement server, a fake clock and a fake ProPresenter. */
function rig({ server = [], on = true, postFails = false, handled = [] } = {}) {
  const clock = { t: T0 };
  const calls = { results: [], posted: [], fetches: 0, saved: null, logs: [] };
  let serverList = server;
  let resultFails = false;
  const fetchImpl = async (url, init) => {
    calls.fetches += 1;
    assert.equal(init.headers.authorization, "Bearer k");
    assert.equal(init.headers["x-console-id"], "c1");
    if (init.method === "GET") return { ok: true, status: 200, json: async () => ({ requests: serverList }) };
    if (resultFails) return { ok: false, status: 500 };
    calls.results.push([url.split("/requests/")[1].split("/")[0], JSON.parse(init.body).status]);
    return { ok: true, status: 200 };
  };
  const sr = createStaffRequests({
    getModule: () => mod,
    isOn: () => on,
    env,
    fetchImpl,
    now: () => clock.t,
    post: async (text) => {
      if (postFails) throw new Error("ProPresenter isn't answering.");
      calls.posted.push(text);
    },
    loadHandled: async () => handled,
    saveHandled: async (list) => {
      calls.saved = list;
    },
    log: (...a) => calls.logs.push(a.join(" ")),
  });
  return { sr, clock, calls, setServer: (l) => (serverList = l), failResults: (v) => (resultFails = v) };
}

const req = (id, text, madeAgoMs = 1000) => ({ id, text, createdAt: iso(T0 - madeAgoMs) });

test("a poll brings in what is waiting, once, and leaves out what is not acceptable", async () => {
  const { sr } = rig({ server: [req("a", "48213"), req("b", ""), req("a", "48213"), { id: "c" }, req("d", "x".repeat(200))] });
  await sr.tick();
  await sr.tick();
  assert.deepEqual(sr.list().map((r) => r.id), ["a"]);
});

test("nothing is fetched, and nothing is shown, while the feature is off", async () => {
  const { sr, calls } = rig({ server: [req("a", "1")], on: false });
  await sr.tick();
  assert.equal(calls.fetches, 0);
  assert.deepEqual(sr.list(), []);
});

test("a request that is already too old is never shown and the server is told it expired", async () => {
  const { sr, calls } = rig({ server: [req("old", "99999", REQUEST_TTL_MS + 1000)] });
  await sr.tick();
  assert.deepEqual(sr.list(), []);
  assert.deepEqual(calls.results, [["old", "expired"]]);
  assert.deepEqual(calls.saved, ["old"], "and it is remembered, so a restart does not show it");
});

test("only a few wait at once; the rest stay on the server for later", async () => {
  const many = Array.from({ length: MAX_WAITING + 3 }, (_, i) => req(`r${i}`, `code ${i}`, 1000 - i));
  const { sr } = rig({ server: many });
  await sr.tick();
  assert.equal(sr.list().length, MAX_WAITING);
});

test("approving posts the words once, tells the server, and a second press is refused", async () => {
  const { sr, calls } = rig({ server: [req("a", "48213")] });
  await sr.tick();
  assert.deepEqual(await sr.approve("a"), { ok: true });
  assert.deepEqual(calls.posted, ["48213"]);
  assert.deepEqual(calls.results, [["a", "shown"]]);
  const again = await sr.approve("a");
  assert.equal(again.ok, false);
  assert.equal(again.status, 409);
  assert.deepEqual(calls.posted, ["48213"], "not posted twice");
  await sr.tick();
  assert.deepEqual(sr.list(), [], "and a later poll does not bring it back");
});

test("two presses at once post it once", async () => {
  const { sr, calls } = rig({ server: [req("a", "48213")] });
  await sr.tick();
  const [x, y] = await Promise.all([sr.approve("a"), sr.approve("a")]);
  assert.equal([x, y].filter((r) => r.ok).length, 1);
  assert.equal(calls.posted.length, 1);
});

test("if ProPresenter refuses, the request stays waiting and the person is told why", async () => {
  const { sr, calls } = rig({ server: [req("a", "48213")], postFails: true });
  await sr.tick();
  const r = await sr.approve("a");
  assert.equal(r.ok, false);
  assert.equal(r.status, 502);
  assert.match(r.error, /ProPresenter/);
  assert.deepEqual(sr.list().map((x) => x.id), ["a"], "still there to try again");
  assert.deepEqual(calls.results, [], "the server is told nothing happened");
});

test("declining posts nothing, tells the server, and is remembered", async () => {
  const { sr, calls } = rig({ server: [req("a", "48213")] });
  await sr.tick();
  assert.deepEqual(await sr.decline("a"), { ok: true });
  assert.deepEqual(calls.posted, []);
  assert.deepEqual(calls.results, [["a", "declined"]]);
  assert.deepEqual(calls.saved, ["a"]);
  assert.equal((await sr.decline("a")).status, 409);
});

test("a request left alone expires at eight minutes, is reported, and cannot be approved late", async () => {
  const { sr, clock, calls } = rig({ server: [req("a", "48213", 0)] });
  await sr.tick();
  clock.t += REQUEST_TTL_MS - 1000;
  assert.equal(sr.list().length, 1);
  clock.t += 2000;
  assert.deepEqual(sr.list(), [], "gone from the list the moment it runs out");
  assert.equal((await sr.approve("a")).status, 409, "and refused if the press arrives late");
  await sr.tick();
  assert.deepEqual(calls.results, [["a", "expired"]]);
});

test("a request handled before a restart does not come back after it", async () => {
  const { sr } = rig({ server: [req("a", "48213")], handled: ["a"] });
  await sr.tick();
  assert.deepEqual(sr.list(), []);
});

test("a result the server did not hear is told again on the next poll", async () => {
  const { sr, calls, failResults } = rig({ server: [req("a", "48213")] });
  await sr.tick();
  failResults(true);
  await sr.approve("a");
  assert.deepEqual(calls.results, [], "not heard");
  failResults(false);
  await sr.tick();
  assert.deepEqual(calls.results, [["a", "shown"]]);
});

test("the text of a request never reaches the log, even when saving the handled list fails", async () => {
  const { sr, calls } = rig({ server: [req("a", "SECRET-CODE-48213")] });
  const failing = createStaffRequests({
    getModule: () => mod,
    isOn: () => true,
    env,
    fetchImpl: async (u, init) => (init.method === "GET" ? { ok: true, json: async () => ({ requests: [req("a", "SECRET-CODE-48213")] }) } : { ok: true }),
    now: () => T0,
    post: async () => {},
    loadHandled: async () => [],
    saveHandled: async () => {
      throw new Error("disk full");
    },
    log: (...a) => calls.logs.push(a.join(" ")),
  });
  await failing.tick();
  await failing.approve("a");
  assert.ok(calls.logs.length >= 1, "it said the save failed");
  assert.ok(calls.logs.every((l) => !l.includes("SECRET-CODE")), "without the words");
  void sr;
});

test("switched on without Telemetry set up, it says why nothing can arrive", async () => {
  const make = (m, on = true, e = env) =>
    createStaffRequests({ getModule: () => m, isOn: () => on, env: e, fetchImpl: async () => ({ ok: true, json: async () => ({ requests: [] }) }), now: () => T0, post: async () => {}, loadHandled: async () => [], saveHandled: async () => {}, log: () => {} });
  assert.match(make({ ...mod, consoleId: undefined }).state().problem, /Telemetry/, "no console id yet");
  assert.match(make({ ...mod, url: "" }).state().problem, /address/i, "no address");
  assert.match(make(mod, true, {}).state().problem, /SERVICE_FEED_TOKEN/, "no key");
  assert.equal(make(mod).state().problem, null, "set up: nothing to say");
  assert.equal(make({ ...mod, consoleId: undefined }, false).state().problem, null, "switched off: nothing to say");
});
