import { test } from "node:test";
import assert from "node:assert/strict";
import { createRemoteApp } from "../server/remote.js";
import { issueToken } from "../server/remote-auth.js";

const SECRET = "test-secret";
const CODE = "4821";

function start({ enabled = true, pin = "0000", allowedIds = new Set(), runs = [], runFails = null } = {}) {
  const state = { enabled };
  const allowed = allowedIds;
  const app = createRemoteApp({
    getState: () => ({ liveState: { connected: true, live: true }, recent: [], progress: null }),
    saveFlag: async () => ({ shared: true }),
    flagTypes: () => [{ label: "Typo" }],
    auth: { expectedPin: () => pin, secret: () => SECRET, hint: () => "", daily: () => true },
    golive: {
      enabled: () => state.enabled,
      code: () => CODE,
      allowed: (id) => allowed.has(id),
      allow: (id) => allowed.add(id),
      describe: (pid, idx) => (pid === "P1" && idx === 3 ? { label: "Amazing Grace, slide 4", text: "Was blind, but now I see" } : null),
      onScreen: () => "Welcome Loop, slide 1",
      run: async (action, id) => {
        if (runFails) throw new Error(runFails);
        runs.push({ action, id });
        return { label: action.label };
      },
    },
  });
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}`, state, allowed, runs }));
  });
}

const phone = () => issueToken(SECRET, {});
const call = (base, tok, path, body) =>
  fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "x-refrain-device": tok.token }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

/** Takes a phone all the way to a typed request code, returning what the confirm needs. */
async function toApproved(base, tok, code) {
  await call(base, tok, "/api/golive/allow", { code: CODE });
  const req = await call(base, tok, "/api/golive/request", { presentationId: "P1", slideIndex: 3 });
  const ok = await call(base, tok, "/api/golive/approve", { requestId: req.body.requestId, code: code ?? req.body.code });
  return { req, ok };
}

test("the booth's switch off: no phone can go live, but it can still be given the permission, and status says so", async () => {
  const { server, base } = await start({ enabled: false });
  try {
    const t = phone();
    assert.deepEqual((await call(base, t, "/api/golive/status")).body, { pin: true, enabled: false, allowed: false, until: null, lockedMs: 0 });
    // The permission itself (the device code) does not depend on the booth's go-live switch: it is also what Search and Alerts need.
    assert.equal((await call(base, t, "/api/golive/allow", { code: CODE })).status, 200);
    for (const [p, b] of [["/api/golive/request", { presentationId: "P1", slideIndex: 3 }], ["/api/golive/approve", {}], ["/api/golive/confirm", {}]]) {
      const r = await call(base, t, p, b);
      assert.equal(r.status, 403, p);
      assert.match(r.body.error, /off at the booth/);
    }
  } finally { server.close(); }
});

test("without phone PINs there is no phone identity, so there is no going live", async () => {
  const { server, base } = await start({ pin: null });
  try {
    const r = await fetch(base + "/api/golive/allow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: CODE }) });
    assert.equal(r.status, 403);
    assert.deepEqual(await (await fetch(base + "/api/golive/status")).json(), { pin: false, enabled: false, allowed: false });
  } finally { server.close(); }
});

test("a phone that has not typed the device code cannot ask to go live", async () => {
  const { server, base } = await start();
  try {
    const r = await call(base, phone(), "/api/golive/request", { presentationId: "P1", slideIndex: 3 });
    assert.equal(r.status, 403);
    assert.equal(r.body.needsCode, true);
  } finally { server.close(); }
});

test("the device code allows the phone; a wrong one is refused with the tries left, then locks", async () => {
  const { server, base, allowed } = await start();
  try {
    const t = phone();
    const w1 = await call(base, t, "/api/golive/allow", { code: "0000" });
    assert.equal(w1.status, 403);
    assert.match(w1.body.error, /2 tries left/);
    assert.equal((await call(base, t, "/api/golive/allow", { code: "0001" })).body.error.includes("1 try left"), true);
    const w3 = await call(base, t, "/api/golive/allow", { code: "0002" });
    assert.match(w3.body.error, /locked out/);
    const locked = await call(base, t, "/api/golive/allow", { code: CODE });
    assert.equal(locked.status, 429, "even the right code is refused while locked");
    assert.equal(allowed.size, 0);
    const other = phone();
    assert.equal((await call(base, other, "/api/golive/allow", { code: CODE })).body.ok, true);
    assert.equal(allowed.size, 1);
  } finally { server.close(); }
});

test("the whole path: allow, request, approve with the request code, confirm: and only then it runs, once", async () => {
  const runs = [];
  const { server, base } = await start({ runs });
  try {
    const t = phone();
    await call(base, t, "/api/golive/allow", { code: CODE });
    const req = await call(base, t, "/api/golive/request", { presentationId: "P1", slideIndex: 3 });
    assert.equal(req.status, 200);
    assert.match(req.body.code, /^\d{4}$/);
    assert.equal(req.body.label, "Amazing Grace, slide 4");
    assert.equal(req.body.replaces, "Welcome Loop, slide 1");
    assert.equal(runs.length, 0, "asking sends nothing");
    const ap = await call(base, t, "/api/golive/approve", { requestId: req.body.requestId, code: req.body.code });
    assert.equal(ap.status, 200);
    assert.equal(runs.length, 0, "approving sends nothing either");
    const done = await call(base, t, "/api/golive/confirm", { confirmId: ap.body.confirmId });
    assert.equal(done.status, 200);
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0].action, { kind: "golive", presentationId: "P1", slideIndex: 3, slideText: "Was blind, but now I see", label: "Amazing Grace, slide 4" });
    const again = await call(base, t, "/api/golive/confirm", { confirmId: ap.body.confirmId });
    // Inside the pause it is told to wait (as the control presses are); after it, the id is gone.
    assert.ok([409, 429].includes(again.status), "a confirm cannot be replayed");
    assert.equal(runs.length, 1);
  } finally { server.close(); }
});

test("a wrong request code is refused, gets a fresh code, and nothing runs", async () => {
  const runs = [];
  const { server, base } = await start({ runs });
  try {
    const t = phone();
    await call(base, t, "/api/golive/allow", { code: CODE });
    const req = await call(base, t, "/api/golive/request", { presentationId: "P1", slideIndex: 3 });
    const wrongCode = req.body.code === "0000" ? "0001" : "0000";
    const bad = await call(base, t, "/api/golive/approve", { requestId: req.body.requestId, code: wrongCode });
    assert.equal(bad.status, 403);
    assert.match(bad.body.error, /2 tries left/);
    assert.match(bad.body.code, /^\d{4}$/);
    const noConfirm = await call(base, t, "/api/golive/confirm", { confirmId: "guess" });
    assert.equal(noConfirm.status, 409);
    assert.equal(runs.length, 0);
  } finally { server.close(); }
});

test("a confirm id from one phone cannot be used by another", async () => {
  const runs = [];
  const { server, base, allowed } = await start({ runs });
  try {
    const a = phone(), b = phone();
    const { ok } = await toApproved(base, a);
    // The second phone is allowed too, but it did not make this request.
    await call(base, b, "/api/golive/allow", { code: CODE });
    assert.equal(allowed.size, 2);
    const stolen = await call(base, b, "/api/golive/confirm", { confirmId: ok.body.confirmId });
    assert.equal(stolen.status, 409);
    assert.equal(runs.length, 0);
  } finally { server.close(); }
});

test("the switch is read on every call: turned off between approve and confirm, nothing runs", async () => {
  const runs = [];
  const { server, base, state } = await start({ runs });
  try {
    const t = phone();
    const { ok } = await toApproved(base, t);
    state.enabled = false;
    const r = await call(base, t, "/api/golive/confirm", { confirmId: ok.body.confirmId });
    assert.equal(r.status, 403);
    assert.equal(runs.length, 0);
  } finally { server.close(); }
});

test("a slide the index does not know, or a malformed pick, is refused before any code is made", async () => {
  const { server, base } = await start({ allowedIds: new Set() });
  try {
    const t = phone();
    await call(base, t, "/api/golive/allow", { code: CODE });
    assert.equal((await call(base, t, "/api/golive/request", { presentationId: "NOPE", slideIndex: 3 })).status, 404);
    for (const body of [{}, { presentationId: "P1", slideIndex: -1 }, { presentationId: "P1", slideIndex: 1.5 }, { presentationId: "P1", slideIndex: "3" }, { presentationId: 7, slideIndex: 3 }]) {
      assert.equal((await call(base, t, "/api/golive/request", body)).status, 400, JSON.stringify(body));
    }
  } finally { server.close(); }
});

test("go-lives are paced, and a failure from ProPresenter is a sentence, not a stack", async () => {
  const { server, base } = await start({ runFails: "ProPresenter isn't answering." });
  try {
    const t = phone();
    const { ok } = await toApproved(base, t);
    const r = await call(base, t, "/api/golive/confirm", { confirmId: ok.body.confirmId });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, "ProPresenter isn't answering.");
    const req = await call(base, t, "/api/golive/request", { presentationId: "P1", slideIndex: 3 });
    const ap = await call(base, t, "/api/golive/approve", { requestId: req.body.requestId, code: req.body.code });
    const quick = await call(base, t, "/api/golive/confirm", { confirmId: ap.body.confirmId });
    assert.equal(quick.status, 429, "a second go-live straight after must wait");
  } finally { server.close(); }
});

test("the request codes are random per request, and never appear in the status or approve answers", async () => {
  const { server, base } = await start();
  try {
    const t = phone();
    await call(base, t, "/api/golive/allow", { code: CODE });
    const seen = new Set();
    for (let i = 0; i < 12; i++) seen.add((await call(base, t, "/api/golive/request", { presentationId: "P1", slideIndex: 3 })).body.code);
    assert.ok(seen.size > 3, "codes vary");
    const st = await call(base, t, "/api/golive/status");
    assert.doesNotMatch(JSON.stringify(st.body), new RegExp(CODE));
  } finally { server.close(); }
});
