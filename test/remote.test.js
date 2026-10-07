import { test } from "node:test";
import assert from "node:assert/strict";
import { createRemoteApp, pushRecent, flagFromRecent, serviceProgress, rateLimiter } from "../server/remote.js";

const slide = (n, extra = {}) => ({ presentationId: `P${n}`, presentationName: `Hymn ${n}`, slideIndex: n, text: `Line ${n}`, ...extra });

function start({ pin = null, recent = [], secret = { value: "s1" }, features } = {}) {
  const saved = [];
  const app = createRemoteApp({
    getState: () => ({ liveState: { connected: true, live: true }, recent, progress: { live: true, item: { name: "Hymn 1" } } }),
    saveFlag: async (f) => (saved.push(f), { shared: true }),
    flagTypes: () => [{ label: "Typo or spelling" }],
    auth: { expectedPin: () => pin, secret: () => secret.value, hint: () => "On the Flags screen in the booth.", daily: () => true },
    ...(features ? { features: () => features } : {}),
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
    for (const [method, path] of [["POST", "/api/trigger"], ["POST", "/api/live/clear"], ["POST", "/api/live/macro"], ["GET", "/api/health"], ["POST", "/api/preferences"], ["POST", "/api/live/look"], ["POST", "/api/live/message"], ["POST", "/api/panic"], ["POST", "/api/live/stage-message"]]) {
      const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined });
      assert.equal(res.status, 404, `${method} ${path} must not exist here`);
    }
    assert.equal((await fetch(`${base}/api/state`)).status, 200);
  } finally {
    server.close();
  }
});

test("a feature switched off at the booth is off on the phone too: its tab is hidden and its routes refuse", async () => {
  const { server, base, saved } = await start({ recent: pushRecent([], slide(1)), features: { flags: false, messages: true } });
  try {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.deepEqual(state.features, { flags: false, messages: true });
    const flag = await fetch(`${base}/api/flag`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "Typo or spelling" }) });
    assert.equal(flag.status, 404);
    assert.equal((await flag.json()).off, true);
    assert.equal((await fetch(`${base}/api/flag-slides`)).status, 404);
    for (const path of ["/api/flag/", "/API/FLAG", "/Api/Flag-Slides/"]) {
      const r = await fetch(base + path, { method: path.includes("Slides") ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: path.includes("Slides") ? undefined : "{}" });
      assert.equal(r.status, 404, `${path} meets the switch too`);
    }
    assert.equal(saved.length, 0, "nothing was flagged");
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

function startControl({ pictures = false } = {}) {
  let reg = emptyRegistry();
  const done = [];
  const activity = { count: 0 };
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
    thumb: async () => ({ type: "image/jpeg", bytes: Buffer.from("jpg") }),
    pictures: () => pictures,
    currentSlides: () => ({ presentationId: "H", presentationName: "Hymn", currentIndex: 2, slides: [0, 1, 2, 3, 4].map((i) => ({ slideIndex: i, text: `line ${i + 1}` })) }),
    stage: async () => ({ presets: [{ id: "short", text: "Cut short, pressing for time" }], current: "" }),
    messages: async () => [{ id: "PAGER", name: "Kids pager", active: false, fields: ["Code"], recent: {} }],
    noteActivity: () => activity.count++,
    control: async (action, deviceId) => (done.push({ ...action, deviceId }), { label: action.label }),
  });
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}`, done, activity, approve: (id) => (reg = setApproved(reg, id, true)), remove: (id) => (reg = removeDevice(reg, id)), reg: () => reg })
    );
  });
}

test("alerts: unapproved phones can't; approved ones prepare then confirm, once; nothing moves a slide; removal signs them out", async () => {
  const t = await startControl();
  const post = (path, body, token) => fetch(t.base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-refrain-device": token } : {}) }, body: JSON.stringify(body) });
  try {
    const { token } = await (await post("/api/unlock", { pin: "2468", name: "Sam" })).json();
    const id = Object.keys(t.reg().devices)[0];
    assert.equal(t.reg().devices[id].name, "Sam");
    assert.equal((await post("/api/control/prepare", { kind: "stage-clear" }, token)).status, 403, "not approved yet");
    t.approve(id);
    const state = await (await fetch(`${t.base}/api/state`, { headers: { "x-refrain-device": token } })).json();
    assert.deepEqual(state.phone, { name: "Sam", canControl: true });
    const { confirmId, label } = await (await post("/api/control/prepare", { kind: "stage-clear" }, token)).json();
    assert.equal(label, "Take down the stage message");
    assert.equal(t.done.length, 0, "preparing does nothing");
    assert.equal((await post("/api/control/confirm", { confirmId }, token)).status, 200);
    assert.deepEqual(t.done, [{ kind: "stage-clear", label, deviceId: id }]);
    const replay = await post("/api/control/confirm", { confirmId }, token);
    assert.ok([409, 429].includes(replay.status), "a confirm can't be replayed");
    assert.equal(t.done.length, 1, "and the replay did nothing");
    // The phone is for alerts and flags (owner, 2026-10-04): nothing that
    // moves a slide or opens the editor.
    for (const kind of ["next", "previous", "safe", "focus", "clear-all"]) {
      assert.equal((await post("/api/control/prepare", { kind, safeId: "logo", presentationId: "H" }, token)).status, 400, `${kind} isn't something a phone can do`);
    }
    for (const path of ["/api/preview", "/api/search?q=grace", "/api/safe-slides"]) {
      assert.equal((await fetch(t.base + path, { headers: { "x-refrain-device": token } })).status, 404, `${path} is gone from the phone`);
    }
    t.remove(id);
    assert.equal((await fetch(`${t.base}/api/state`, { headers: { "x-refrain-device": token } })).status, 401, "removed phones are signed out");
  } finally {
    t.server.close();
  }
});

test("pictures are closed to phones by default, whatever the page asks for", async () => {
  const t = await startControl();
  try {
    const { token } = await (await fetch(`${t.base}/api/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "2468" }) })).json();
    const h = { headers: { "x-refrain-device": token } };
    for (const p of ["H/0", "H/3", "H/9", "OTHER/0"]) assert.equal((await fetch(`${t.base}/api/preview/image/${p}`, h)).status, 404, "a phone is never served a picture");
    const all = await (await fetch(`${t.base}/api/flag-slides`, h)).json();
    assert.equal(all.slides.length, 5);
    assert.equal(all.slides.some((x) => "image" in x), false, "no picture address in the slide list");
  } finally {
    t.server.close();
  }
});

test("pictures, when the booth opens them: the presentation on screen only, for flagging", async () => {
  const t = await startControl({ pictures: true });
  try {
    const { token } = await (await fetch(`${t.base}/api/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "2468" }) })).json();
    const h = { headers: { "x-refrain-device": token } };
    assert.equal((await fetch(`${t.base}/api/preview/image/H/3`, h)).status, 200);
    assert.equal((await fetch(`${t.base}/api/preview/image/H/9`, h)).status, 404, "not past the end of the presentation");
    assert.equal((await fetch(`${t.base}/api/preview/image/OTHER/0`, h)).status, 404, "not another presentation");
    assert.equal((await fetch(`${t.base}/api/preview/image/H/0`, h)).status, 200, "any slide of the one on screen, for the tray");
    const all = await (await fetch(`${t.base}/api/flag-slides`, h)).json();
    assert.equal(all.currentIndex, 2);
    assert.deepEqual(all.slides.map((x) => x.slideNumber), [1, 2, 3, 4, 5]);
    assert.equal((await fetch(`${t.base}/api/preview/image/LOGO/0`, h)).status, 404, "no safe slides on the phone any more");
    // A tray pick with no words is never in the index; it's accepted as a
    // slide of the presentation on screen, and one of another isn't.
    const flag = (slide) => fetch(`${t.base}/api/flag`, { method: "POST", headers: { "Content-Type": "application/json", "x-refrain-device": token }, body: JSON.stringify({ slide }) });
    assert.equal((await flag({ presentationId: "H", slideIndex: 4 })).status, 200);
    assert.equal((await flag({ presentationId: "OTHER", slideIndex: 0 })).status, 404);
    assert.equal((await fetch(`${t.base}/api/flag-slides`)).status, 401, "behind the PIN");
    assert.ok(t.activity.count > 0, "a phone polling keeps the heartbeat at its active pace");
  } finally {
    t.server.close();
  }
});

test("stage message and pager from a phone: presets only, codes upper-cased, two presses each", async () => {
  const t = await startControl();
  const post = (path, body, token) => fetch(t.base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-refrain-device": token } : {}) }, body: JSON.stringify(body) });
  try {
    const { token } = await (await post("/api/unlock", { pin: "2468", name: "Sam" })).json();
    const id = Object.keys(t.reg().devices)[0];
    assert.equal((await fetch(`${t.base}/api/stage`, { headers: { "x-refrain-device": token } })).status, 403, "approved phones only");
    t.approve(id);
    const stage = await (await fetch(`${t.base}/api/stage`, { headers: { "x-refrain-device": token } })).json();
    assert.equal(stage.presets[0].id, "short");

    const a = await (await post("/api/control/prepare", { kind: "stage", presetId: "short" }, token)).json();
    assert.equal(a.label, 'Stage: "Cut short, pressing for time"');
    assert.equal(t.done.length, 0, "preparing does nothing");
    assert.equal((await post("/api/control/confirm", { confirmId: a.confirmId }, token)).status, 200);
    assert.deepEqual(t.done.at(-1), { kind: "stage", text: "Cut short, pressing for time", label: a.label, deviceId: id });
    assert.equal((await post("/api/control/prepare", { kind: "stage", presetId: "nope" }, token)).status, 400, "no typed text from a phone");
    assert.equal((await post("/api/control/prepare", { kind: "stage", text: "anything" }, token)).status, 400);

    await new Promise((r) => setTimeout(r, 1300)); // the per-phone cooldown (1.2s)
    const m = await (await post("/api/control/prepare", { kind: "message", messageId: "PAGER", values: [{ name: "Code", text: " exvx " }, { name: "Other", text: "x" }] }, token)).json();
    assert.equal(m.label, "Kids pager: EXVX");
    assert.equal((await post("/api/control/confirm", { confirmId: m.confirmId }, token)).status, 200);
    assert.deepEqual(t.done.at(-1).values, [{ name: "Code", text: "EXVX" }], "only the message's own field, upper-cased");
    assert.equal((await post("/api/control/prepare", { kind: "message", messageId: "PAGER", values: [] }, token)).status, 400, "an empty code isn't posted");
    assert.equal((await post("/api/control/prepare", { kind: "message", messageId: "OTHER", values: [] }, token)).status, 400);
  } finally {
    t.server.close();
  }
});

test("a phone route that throws still answers, instead of leaving the phone waiting", async () => {
  const app = createRemoteApp({
    getState: () => ({ liveState: { connected: true, live: true }, recent: [] }),
    saveFlag: async () => ({}),
    flagTypes: () => [],
    auth: { expectedPin: () => null, secret: () => "s", hint: () => "", daily: () => true },
    currentSlides: () => ({ presentationId: "H", presentationName: "Hymn", currentIndex: 0, slides: [{ slideIndex: 0, text: "x" }] }),
    pictures: () => true,
    thumb: async () => {
      throw new Error("disk went away");
    },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const logged = [];
    const error = console.error;
    console.error = (...a) => logged.push(a.join(" "));
    let res;
    try {
      res = await fetch(`${base}/api/preview/image/H/0`, { signal: AbortSignal.timeout(2000) });
    } finally {
      console.error = error;
    }
    assert.equal(res.status, 500, "a fault in Refrain, said as one, not blamed on the phone");
    assert.equal((await res.json()).error, "Something went wrong at the booth. Try again.", "nothing internal reaches the phone");
    assert.ok(logged.some((l) => /disk went away/.test(l)), "and the booth's log has it");
  } finally {
    server.close();
  }
});
