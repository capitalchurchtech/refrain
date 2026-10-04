import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { catchAsyncRoutes, routeErrorHandler } from "../server/async-routes.js";

function start() {
  const app = catchAsyncRoutes(express());
  app.use(express.json());
  app.get("/async-throws", async () => {
    throw new Error("boom");
  });
  app.get("/sync-throws", () => {
    throw new Error("bang");
  });
  app.get("/ok", async (_req, res) => res.json({ ok: true }));
  app.post("/echo", (req, res) => res.json(req.body));
  app.use(routeErrorHandler);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test("a route that throws, async or not, answers 500 instead of hanging; others are untouched", async () => {
  const errors = console.error;
  console.error = () => {};
  const { server, base } = await start();
  try {
    const a = await fetch(`${base}/async-throws`, { signal: AbortSignal.timeout(2000) });
    assert.equal(a.status, 500);
    assert.match((await a.json()).error, /boom/);
    assert.equal((await fetch(`${base}/sync-throws`, { signal: AbortSignal.timeout(2000) })).status, 500);
    assert.deepEqual(await (await fetch(`${base}/ok`)).json(), { ok: true });
    const bad = await fetch(`${base}/echo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{nope" });
    assert.equal(bad.status, 400, "a malformed body is still a 400");
  } finally {
    console.error = errors;
    server.close();
  }
});
