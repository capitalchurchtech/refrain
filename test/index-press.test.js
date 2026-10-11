import { test } from "node:test";
import assert from "node:assert/strict";
import { postIndexRun } from "../public/index-press.js";

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sender = (...answers) => {
  const calls = [];
  const send = async (url, init) => (calls.push({ url, body: JSON.parse(init.body) }), answers.shift());
  return { send, calls };
};

test("a run that needs no question goes through once", async () => {
  const { send, calls } = sender(reply(200, { ok: true }));
  const res = await postIndexRun("/api/index/reindex-changed", { send, ask: async () => assert.fail("nothing to ask") });
  assert.equal(res.status, 200);
  assert.deepEqual(calls.map((c) => c.body), [{}]);
});

test("a service warning asks, and Run anyway sends it again with confirm", async () => {
  const { send, calls } = sender(reply(409, { error: "A service is starting. Run it anyway?", needsConfirm: true }), reply(200, { builtAt: "x" }));
  let asked = null;
  const res = await postIndexRun("/api/index/rebuild", { send, ask: async (text, label) => ((asked = [text, label]), true) });
  assert.deepEqual(asked, ["A service is starting. Run it anyway?", "Run anyway"]);
  assert.equal(res.status, 200);
  assert.deepEqual(calls.map((c) => c.body), [{}, { confirm: true }]);
});

test("Cancel leaves it, and says so as a refusal the caller already handles", async () => {
  const { send, calls } = sender(reply(409, { error: "Run it anyway?", needsConfirm: true }));
  const res = await postIndexRun("/api/index/rebuild", { send, ask: async () => false });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "Left as it was.");
  assert.equal(calls.length, 1, "nothing was sent a second time");
});

test("a hard refusal is not overridable: it is returned as it came, with no question", async () => {
  const { send, calls } = sender(reply(409, { error: "Performance mode is on." }));
  const res = await postIndexRun("/api/index/reindex-changed", { send, ask: async () => assert.fail("a hard refusal is not a question") });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "Performance mode is on.");
  assert.equal(calls.length, 1);
});
