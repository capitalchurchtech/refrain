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
    for (const [method, path] of [["POST", "/api/trigger"], ["POST", "/api/live/clear"], ["POST", "/api/live/macro"], ["GET", "/api/health"], ["POST", "/api/preferences"], ["GET", "/api/search?q=a"]]) {
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
