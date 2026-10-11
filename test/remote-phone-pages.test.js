import { test } from "node:test";
import assert from "node:assert/strict";
import { createRemoteApp } from "../server/remote.js";
import { issueToken } from "../server/remote-auth.js";

const SECRET = "test-secret";
const FLAG_ID = "2026-10-09T10-52-01-123Z-0a1b2c3d";

function start({ approved = true, permitted = true, captured = "pic.png", controls = [], searchLog = [] } = {}) {
  const saved = [];
  const app = createRemoteApp({
    getState: () => ({ liveState: { connected: true, live: true }, recent: [], progress: null }),
    saveFlag: async (f) => (saved.push(f), { shared: true }),
    flagTypes: () => [{ label: "Typo or spelling" }, { label: "Note" }],
    knownSlide: (pid, idx) => (pid === "P1" && idx === 3 ? { presentationName: "Amazing Grace", text: "Was blind, but now I see" } : null),
    auth: { expectedPin: () => "0000", secret: () => SECRET, hint: () => "", daily: () => true },
    devices: { see() {}, approved: () => approved, removed: () => false, name: () => "Sam" },
    golive: { enabled: () => false, code: () => "4821", allowed: () => permitted, allow() {}, describe: () => null, onScreen: () => null, run: async () => ({}) },
    search: (q) => (searchLog.push(q), Array.from({ length: 25 }, (_, i) => ({ presentationId: "P1", slideIndex: i, presentationName: "Amazing Grace", snippet: `line ${i} ${q}` }))),
    history: () => [{ name: "Amazing Grace", startedAt: "2026-10-09T10:00:00.000Z", endedAt: null, elapsedMs: 5000, current: true }],
    stage: async () => ({ presets: [{ id: "a", text: "Keep going" }], current: "" }),
    captureFlagPicture: async (id) => (captured ? `${id}.png` : null),
    openFlags: async () => [{ id: FLAG_ID, presentationName: "Amazing Grace", slideNumber: 4, type: "Typo or spelling", note: "wretch", by: "Sam", at: "2026-10-09T10:52:01.123Z", picture: `${FLAG_ID}.png` }, { id: "2026-10-09T10-53-01-123Z-0a1b2c3e", picture: null }],
    flagPicture: async (id) => (id === FLAG_ID ? { type: "image/png", bytes: Buffer.from([137, 80, 78, 71]) } : null),
    stageControl: controls,
    control: async (action) => (controls.push(action), { label: action.label }),
  });
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}`, saved }));
  });
}
const tok = () => issueToken(SECRET, {}).token;
const get = (base, t, path) => fetch(base + path, { headers: { "x-refrain-device": t } });
const post = (base, t, path, body) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", "x-refrain-device": t }, body: JSON.stringify(body) });

test("search is read-only text: needs two letters, is capped at twenty, and says there are more", async () => {
  const log = [];
  const { server, base } = await start({ searchLog: log });
  try {
    const t = tok();
    assert.deepEqual(await (await get(base, t, "/api/search?q=a")).json(), { results: [], more: false });
    assert.equal(log.length, 0, "a one-letter search is never run");
    const r = await (await get(base, t, "/api/search?q=grace")).json();
    assert.equal(r.results.length, 20);
    assert.equal(r.more, true);
    assert.deepEqual(Object.keys(r.results[0]).sort(), ["presentationId", "presentationName", "slideIndex", "slideNumber", "text"]);
    assert.equal(r.results[0].slideNumber, 1);
    assert.equal((await get(base, t, "/api/search?q[]=a&q[]=b")).status, 400);
    assert.equal((await get(base, "nope", "/api/search?q=grace")).status, 401, "a phone without a token is refused");
  } finally { server.close(); }
});

test("history is what the server counted, read-only", async () => {
  const { server, base } = await start();
  try {
    const r = await (await get(base, tok(), "/api/history")).json();
    assert.equal(r.items[0].elapsedMs, 5000);
    assert.equal((await post(base, tok(), "/api/history", {})).status, 404);
  } finally { server.close(); }
});

test("a flag from a search result keeps its picture, and says when no picture could be taken", async () => {
  const { server, base, saved } = await start();
  try {
    const t = tok();
    const ok = await (await post(base, t, "/api/flag", { slide: { presentationId: "P1", slideIndex: 3 }, type: "Typo or spelling", note: "wretch", name: "Sam" })).json();
    assert.equal(ok.ok, true);
    assert.equal(ok.picture, true);
    assert.equal(saved[0].picture, `${saved[0].id}.png`);
    assert.equal(saved[0].presentationName, "Amazing Grace");
  } finally { server.close(); }
  const none = await start({ captured: null });
  try {
    const r = await (await post(none.base, tok(), "/api/flag", { slide: { presentationId: "P1", slideIndex: 3 }, type: "Typo or spelling" })).json();
    assert.equal(r.ok, true, "the flag is still kept");
    assert.equal(r.picture, false);
    assert.equal("picture" in none.saved[0], false);
  } finally { none.server.close(); }
});

test("a Note needs its words; other types do not", async () => {
  const { server, base, saved } = await start();
  try {
    const t = tok();
    const slide = { presentationId: "P1", slideIndex: 3 };
    const bad = await post(base, t, "/api/flag", { slide, type: "Note", note: "   " });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /note for the team/);
    assert.equal(saved.length, 0);
    assert.equal((await post(base, t, "/api/flag", { slide, type: "Note", note: "Hold this one longer" })).status, 200);
    assert.equal(saved[0].type, "Note");
  } finally { server.close(); }
});

test("a slide that is not in the index cannot be flagged", async () => {
  const { server, base, saved } = await start();
  try {
    const r = await post(base, tok(), "/api/flag", { slide: { presentationId: "NOPE", slideIndex: 3 }, type: "Typo or spelling" });
    assert.equal(r.status, 404);
    assert.equal(saved.length, 0);
  } finally { server.close(); }
});

test("open flags list, and a flag's picture is served only by a real flag id that has one", async () => {
  const { server, base } = await start();
  try {
    const t = tok();
    const list = await (await get(base, t, "/api/flags")).json();
    assert.equal(list.flags.length, 2);
    const img = await get(base, t, `/api/flag-picture/${FLAG_ID}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.equal((await get(base, t, "/api/flag-picture/..%2F..%2Fconfig")).status, 404);
    assert.equal((await get(base, t, "/api/flag-picture/2026-10-09T10-54-01-123Z-ffffffff")).status, 404, "a flag with no picture");
  } finally { server.close(); }
});

test("a typed stage message is cleaned like the booth's, needs a second tap, and only approved phones can send one", async () => {
  const controls = [];
  const { server, base } = await start({ controls });
  try {
    const t = tok();
    const empty = await post(base, t, "/api/control/prepare", { kind: "stage-custom", text: "   " });
    assert.equal(empty.status, 400);
    const prep = await (await post(base, t, "/api/control/prepare", { kind: "stage-custom", text: "  Hold   for \n prayer  " })).json();
    assert.equal(prep.label, 'Stage: "Hold for prayer"');
    assert.equal(controls.length, 0, "preparing sends nothing");
    assert.equal((await post(base, t, "/api/control/confirm", { confirmId: prep.confirmId })).status, 200);
    assert.deepEqual(controls[0], { kind: "stage", text: "Hold for prayer", label: 'Stage: "Hold for prayer"' });
    const long = await (await post(base, t, "/api/control/prepare", { kind: "stage-custom", text: "x".repeat(300) })).json();
    assert.ok(long.label.length <= 'Stage: ""'.length + 80);
    const num = await post(base, t, "/api/control/prepare", { kind: "stage-custom", text: 9 });
    assert.equal(num.status, 400, "a number is not a message");
  } finally { server.close(); }
  const un = await start({ approved: false });
  try {
    assert.equal((await post(un.base, tok(), "/api/control/prepare", { kind: "stage-custom", text: "Hi" })).status, 403);
  } finally { un.server.close(); }
});

test("a phone without this month's device code cannot search, whatever else it has", async () => {
  const log = [];
  const { server, base } = await start({ permitted: false, searchLog: log });
  try {
    const r = await get(base, tok(), "/api/search?q=grace");
    assert.equal(r.status, 403);
    assert.equal((await r.json()).needsCode, true);
    assert.equal(log.length, 0, "the search never ran");
    // Flagging and reading stay open to any signed-in phone.
    assert.equal((await get(base, tok(), "/api/history")).status, 200);
    assert.equal((await get(base, tok(), "/api/flags")).status, 200);
  } finally { server.close(); }
});

test("one phone is held to 40 searches a minute, and all phones together to 150", async () => {
  const { server, base } = await start();
  try {
    const t = tok();
    let last = 200;
    for (let i = 0; i < 41; i++) last = (await get(base, t, "/api/search?q=grace")).status;
    assert.equal(last, 429, "the 41st search in a minute from one phone is refused");
    let refused = false;
    for (let i = 0; i < 4 && !refused; i++) {
      const other = tok();
      for (let j = 0; j < 40; j++) if ((await get(base, other, "/api/search?q=grace")).status === 429) { refused = true; break; }
    }
    assert.equal(refused, true, "and the phones together are held to a total too");
  } finally { server.close(); }
});
