import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { installAsyncErrorCatching, routeErrorHandler } from "../server/async-routes.js";

function start() {
  installAsyncErrorCatching();
  const app = express();
  app.use(express.json());
  app.get("/async-throws", async () => {
    throw new Error("ENOENT: /Users/someone/secret/config.json");
  });
  app.get("/sync-throws", () => {
    throw new Error("bang");
  });
  app.get("/rejects-nothing", () => Promise.reject());
  // A router, as a module might mount: covered too.
  const router = express.Router();
  router.get("/inner", async () => {
    throw new Error("from a router");
  });
  app.use("/mod", router);
  app.all("/any", async () => {
    throw new Error("from app.all");
  });
  app.get("/ok", async (_req, res) => res.json({ ok: true }));
  app.post("/echo", (req, res) => res.json(req.body));
  app.use(routeErrorHandler);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test("every way a route throws gets an answer: async, sync, a router, app.all, a rejection with nothing in it", async () => {
  const logged = [];
  const error = console.error;
  console.error = (...a) => logged.push(a.join(" "));
  const { server, base } = await start();
  try {
    const get = (p) => fetch(base + p, { signal: AbortSignal.timeout(2000) });
    const a = await get("/async-throws");
    assert.equal(a.status, 500);
    const body = await a.json();
    assert.doesNotMatch(body.error, /secret|ENOENT/, "no internal detail reaches the screen");
    assert.ok(logged.some((l) => /secret\/config\.json/.test(l)), "but the log has it");
    assert.equal((await get("/sync-throws")).status, 500);
    assert.equal((await get("/rejects-nothing")).status, 500, "not a 404 for a route that exists");
    assert.equal((await get("/mod/inner")).status, 500);
    assert.equal((await get("/any")).status, 500);
    assert.deepEqual(await (await get("/ok")).json(), { ok: true });
    const bad = await fetch(`${base}/echo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{nope" });
    assert.equal(bad.status, 400, "a malformed body is still a 400");
  } finally {
    console.error = error;
    server.close();
  }
});
