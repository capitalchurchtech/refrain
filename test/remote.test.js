import { test } from "node:test";
import assert from "node:assert/strict";
import { createRemoteApp, pushRecent, flagFromRecent, serviceProgress, rateLimiter } from "../server/remote.js";

const slide = (n, extra = {}) => ({ presentationId: `P${n}`, presentationName: `Hymn ${n}`, slideIndex: n, text: `Line ${n}`, ...extra });

function start({ pin = null, recent = [], secret = { value: "s1" } } = {}) {
  const saved = [];
  const app = createRemoteApp({
    getState: () => ({ liveState: { connected: true, live: true }, recent, progress: { live: true, item: { name: "Hymn 1" } } }),
    saveFlag: async (f) => (saved.push(f), { shared: true }),
    flagTypes: () => [{ label: "Typo or spelling" }],
    auth: { expectedPin: () => pin, secret: () => secret.value, hint: () => "On the Flags screen in the booth.", daily: () => true },
  });
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}`, saved }));
  });
}

test("the recent list keeps the last slides, newest first, without repeating the one still up", () => {
  let list = [];
  list = pushRecent(list, slide(1), 1000);
  list = pushRecent(list, slide(1), 2000);
  list = pushRecent(list, slide(2), 3000);
  assert.deepEqual(list.map((r) => r.slideIndex), [2, 1]);
  for (let i = 3; i < 30; i++) list = pushRecent(list, slide(i), i * 1000);
  assert.equal(list.length, 12);
  assert.deepEqual(pushRecent(list, { presentationId: null }), list);
});

test("a phone flag points at the slide the person chose, with their note and name", () => {
  const [entry] = pushRecent([], slide(4), Date.parse("2026-09-27T15:10:00Z"));
  const r = flagFromRecent(entry, { type: "Typo or spelling", note: "  should be grace ", name: "Sam" });
  assert.equal(r.ok, true);
  assert.equal(r.flag.slideIndex, 4);
  assert.equal(r.flag.note, "should be grace");
  assert.equal(r.flag.submittedBy, "Sam");
  assert.equal(r.flag.source, "remote");
  assert.equal(r.flag.slideSeenAt, "2026-09-27T15:10:00.000Z");
});

test("progress is item N of M and time up, never a percentage, and honest when nothing is live", () => {
  const state = {
    services: [{ serviceId: "s", name: "Early", playlist: { items: [{ name: "Welcome" }, { name: "Hymn" }, { name: "Talk" }] } }],
    segments: [{ serviceId: "s", startMs: 0, endMs: 60_000 }],
    openItem: { serviceId: "s", itemIndex: 1, name: "Hymn", startMs: 60_000 },
  };
  const p = serviceProgress(state, { live: true, connected: true }, 120_000);
  assert.deepEqual(p.item, { name: "Hymn", position: 2, of: 3, upForMs: 60_000 });
  assert.equal(p.service.runningMs, 120_000);
  assert.equal(serviceProgress(null, { live: false, connected: true }).item, null);
});

test("only the phone routes exist: nothing that could change the screens is reachable", async () => {
  const { server, base } = await start({ recent: pushRecent([], slide(1)) });
  try {
    for (const [method, path] of [["POST", "/api/trigger"], ["POST", "/api/live/clear"], ["POST", "/api/live/macro"], ["GET", "/api/health"], ["POST", "/api/preferences"], ["POST", "/api/live/look"], ["POST", "/api/live/message"]]) {
      const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined });
      assert.equal(res.status, 404, `${method} ${path} must not exist here`);
    }
    assert.equal((await fetch(`${base}/api/state`)).status, 200);
  } finally {
    server.close();
  }
});

test("with a PIN: the page and the lock say where to find it; everything else needs a phone token earned with it", async () => {
  const recent = pushRecent([], slide(1));
  const secret = { value: "s1" };
  const { server, base, saved } = await start({ pin: "2468", recent, secret });
  const post = (path, body, token) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-refrain-device": token } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/`)).status, 200);
    const lock = await (await fetch(`${base}/api/lock`)).json();
    assert.deepEqual(lock, { required: true, daily: true, hint: "On the Flags screen in the booth." });
    assert.equal((await fetch(`${base}/api/state`)).status, 401);
    assert.equal((await post("/api/unlock", { pin: "1111" })).status, 403);
    const unlocked = await (await post("/api/unlock", { pin: "2468", trust: true })).json();
    assert.equal(unlocked.trusted, true);
    const state = await (await fetch(`${base}/api/state`, { headers: { "x-refrain-device": unlocked.token } })).json();
    const sent = await post("/api/flag", { ref: state.recent[0].ref, type: "Typo or spelling", note: "x", name: "Sam" }, unlocked.token);
    assert.equal(sent.status, 200);
    assert.equal(saved.length, 1);
    assert.equal((await post("/api/flag", { ref: "gone" }, unlocked.token)).status, 404);
    // Forget all phones: a new secret, and the old token stops working.
    secret.value = "s2";
    assert.equal((await fetch(`${base}/api/state`, { headers: { "x-refrain-device": unlocked.token } })).status, 401);
  } finally {
    server.close();
  }
});

test("guessing the PIN is held to five tries a minute", async () => {
  const { server, base } = await start({ pin: "2468" });
  try {
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await fetch(`${base}/api/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "0000" }) })).status);
    assert.deepEqual(codes, [403, 403, 403, 403, 403, 429, 429]);
  } finally {
    server.close();
  }
});

test("a stuck button can't fill the flags folder", () => {
  const allow = rateLimiter({ max: 3, windowMs: 1000 });
  assert.deepEqual([1, 2, 3, 4].map(() => allow("phone", 0)), [true, true, true, false]);
  assert.equal(allow("phone", 2000), true, "a new window");
  assert.equal(allow("other", 0), true, "per device");
});

import { pinFailureGuard } from "../server/remote.js";
import { crossSiteRefused } from "../server/request-guard.js";

test("wrong PINs are capped across every phone for the day, and the cap lifts when the day changes", () => {
  let day = "2026-09-27";
  const guard = pinFailureGuard({ perDay: 3, dayOf: () => day });
  for (let i = 0; i < 3; i++) guard.fail();
  assert.equal(guard.blocked(), true);
  assert.equal(guard.count(), 3);
  day = "2026-09-28";
  assert.equal(guard.blocked(), false);
});

test("the daily cap refuses unlocking even with the right PIN, from any device", async () => {
  let blockedNow = false;
  const app = createRemoteApp({
    getState: () => ({ liveState: {}, recent: [] }),
    saveFlag: async () => ({}),
    flagTypes: () => [],
    auth: { expectedPin: () => "2468", secret: () => "s", hint: () => "", daily: () => true },
    pinGuard: { blocked: () => blockedNow, fail: () => {}, count: () => 0 },
  });
  const server = await new Promise((r) => { const sv = app.listen(0, "127.0.0.1", () => r(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    blockedNow = true;
    const res = await fetch(`${base}/api/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "2468" }) });
    assert.equal(res.status, 429);
  } finally {
    server.close();
  }
});

test("a malformed request gets one sentence, never a stack trace", async () => {
  const { server, base } = await start({ pin: "2468" });
  try {
    const res = await fetch(`${base}/api/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    const text = await res.text();
    assert.equal(res.status, 400);
    assert.equal(text, JSON.stringify({ error: "Bad request." }));
    assert.doesNotMatch(text, /node_modules|\sat\s/);
  } finally {
    server.close();
  }
});

test("a flag that waited on the phone still lands, but only on a slide the index really has, with the index's text", async () => {
  const saved = [];
  const app = createRemoteApp({
    getState: () => ({ liveState: {}, recent: [] }),
    saveFlag: async (f) => (saved.push(f), { shared: true }),
    flagTypes: () => [],
    auth: { expectedPin: () => null, secret: () => "s", hint: () => "", daily: () => false },
    knownSlide: (id, i) => (id === "REAL" ? { presentationName: "Real Hymn", text: "Indexed text", slideIndex: i } : null),
  });
  const server = await new Promise((r) => { const sv = app.listen(0, "127.0.0.1", () => r(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/flag`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ ref: "gone", slide: { presentationId: "REAL", slideIndex: 2, at: "2026-09-27T15:00:00Z", text: "made up" }, note: "kept" })).status, 200);
    assert.equal(saved[0].text, "Indexed text", "the phone's copy of the text is never trusted");
    assert.equal(saved[0].note, "kept");
    assert.equal(saved[0].slideSeenAt, "2026-09-27T15:00:00.000Z");
    assert.equal((await post({ ref: "gone", slide: { presentationId: "FAKE", slideIndex: 0 } })).status, 404);
  } finally {
    server.close();
  }
});

test("another site's page can't send the main app a change; Refrain's own pages and tools can", () => {
  assert.equal(crossSiteRefused("POST", "https://evil.example", "127.0.0.1:9999"), true);
  assert.equal(crossSiteRefused("POST", "http://127.0.0.1:1234", "127.0.0.1:9999"), true, "another local port is another site");
  assert.equal(crossSiteRefused("POST", "http://127.0.0.1:9999", "127.0.0.1:9999"), false);
  assert.equal(crossSiteRefused("POST", "http://localhost:9999", "127.0.0.1:9999"), false);
  assert.equal(crossSiteRefused("POST", undefined, "127.0.0.1:9999"), false, "curl sends no Origin");
  assert.equal(crossSiteRefused("GET", "https://evil.example", "127.0.0.1:9999"), false, "reads are left alone");
  assert.equal(crossSiteRefused("POST", "null", "127.0.0.1:9999"), true);
});

import { emptyRegistry, seeDevice, setApproved, removeDevice, isApproved, isRemoved } from "../server/remote-devices.js";

function startControl() {
  let reg = emptyRegistry();
  const done = [];
  const app = createRemoteApp({
    getState: () => ({ liveState: { connected: true, live: true }, recent: [] }),
    saveFlag: async () => ({}),
    flagTypes: () => [],
    auth: { expectedPin: () => "2468", secret: () => "s", hint: () => "", daily: () => true },
    devices: {
      see: (id, o) => (reg = seeDevice(reg, id, o)),
      approved: (id) => isApproved(reg, id),
      removed: (id) => isRemoved(reg, id),
      name: (id) => reg.devices[id]?.name ?? null,
    },
    preview: () => ({ current: { presentationId: "H", slideIndex: 2, text: "now" }, next: { presentationId: "H", slideIndex: 3, text: "next" }, atEnd: false }),
    thumb: async () => ({ type: "image/jpeg", bytes: Buffer.from("jpg") }),
    safeSlides: () => [{ id: "logo", label: "Logo" }],
    control: async (action, deviceId) => (done.push({ ...action, deviceId }), { label: action.label }),
  });
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}`, done, approve: (id) => (reg = setApproved(reg, id, true)), remove: (id) => (reg = removeDevice(reg, id)), reg: () => reg })
    );
  });
}

test("control: unapproved phones can't; approved ones prepare then confirm, once; removal signs them out", async () => {
  const t = await startControl();
  const post = (path, body, token) => fetch(t.base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-refrain-device": token } : {}) }, body: JSON.stringify(body) });
  try {
    const { token } = await (await post("/api/unlock", { pin: "2468", name: "Sam" })).json();
    const id = Object.keys(t.reg().devices)[0];
    assert.equal(t.reg().devices[id].name, "Sam");
    assert.equal((await post("/api/control/prepare", { kind: "next" }, token)).status, 403, "not approved yet");
    t.approve(id);
    const state = await (await fetch(`${t.base}/api/state`, { headers: { "x-refrain-device": token } })).json();
    assert.deepEqual(state.phone, { name: "Sam", canControl: true });
    const { confirmId, label } = await (await post("/api/control/prepare", { kind: "safe", safeId: "logo" }, token)).json();
    assert.equal(label, "Logo");
    assert.equal(t.done.length, 0, "preparing does nothing");
    assert.equal((await post("/api/control/confirm", { confirmId }, token)).status, 200);
    assert.deepEqual(t.done, [{ kind: "safe", safeId: "logo", label: "Logo", deviceId: id }]);
    const replay = await post("/api/control/confirm", { confirmId }, token);
    assert.ok([409, 429].includes(replay.status), "a confirm can't be replayed");
    assert.equal(t.done.length, 1, "and the replay did nothing");
    assert.equal((await post("/api/control/prepare", { kind: "clear-all" }, token)).status, 400, "nothing beyond next, previous and safe slides");
    t.remove(id);
    assert.equal((await fetch(`${t.base}/api/state`, { headers: { "x-refrain-device": token } })).status, 401, "removed phones are signed out");
  } finally {
    t.server.close();
  }
});

test("previews: the current and next slide's words and pictures, and no other slide's picture", async () => {
  const t = await startControl();
  try {
    const { token } = await (await fetch(`${t.base}/api/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "2468" }) })).json();
    const h = { headers: { "x-refrain-device": token } };
    const p = await (await fetch(`${t.base}/api/preview`, h)).json();
    assert.equal(p.current.text, "now");
    assert.equal(p.next.slideNumber, 4);
    assert.equal((await fetch(t.base + p.next.image, h)).status, 200);
    assert.equal((await fetch(`${t.base}/api/preview/image/H/9`, h)).status, 404, "not an arbitrary slide");
    assert.equal((await fetch(`${t.base}/api/preview`)).status, 401, "behind the PIN");
  } finally {
    t.server.close();
  }
});
