// The Bundles module's glue (server/probundle.js): where files may come from,
// the packs folder rule, the status, and the routes end to end on a made-up
// presentation. The format itself is tested in the propresenter-bundle package.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { packsDirProblem, createSourceStore, probundleRouter } from "../server/probundle.js";
import { getProbundleModuleStatus, probundleModuleProblems, registerFeatureDefaults } from "../server/config.js";

const lib = await import("propresenter-bundle").catch(() => null);

test("a packs folder may be under ./data or outside Refrain, never elsewhere in the repo", () => {
  const root = "/opt/refrain";
  assert.equal(packsDirProblem("./data/probundle-packs", root), null);
  assert.equal(packsDirProblem("/Users/Shared/Church Packs", root), null);
  assert.match(packsDirProblem("./modules/packs", root), /cannot live inside Refrain's folder/);
  assert.match(packsDirProblem("/opt/refrain", root), /cannot live inside/);
  assert.match(packsDirProblem("./data/../public", root), /cannot live inside/);
  assert.equal(packsDirProblem("/opt/refrain-packs", root), null, "a sibling folder whose name starts the same is outside");
  assert.match(packsDirProblem("  ", root), /Enter a folder/);
  assert.match(packsDirProblem(undefined, root), /Enter a folder/);
});

test("the module is off until switched on, then misconfigured until its packs folder exists", () => {
  registerFeatureDefaults({ probundle: false });
  assert.equal(getProbundleModuleStatus({}), "off");
  const on = { features: { probundle: true } };
  assert.equal(getProbundleModuleStatus(on), "misconfigured");
  assert.match(probundleModuleProblems(on)[0], /No packs folder/);
  const missing = { ...on, probundleModule: { packsDir: path.join(os.tmpdir(), "no-such-packs-folder-x") } };
  assert.match(probundleModuleProblems(missing)[0], /does not exist/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packs-"));
  try {
    assert.equal(getProbundleModuleStatus({ ...on, probundleModule: { packsDir: dir } }), "active");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("opened files are kept for comparing: the newest few, for an hour", () => {
  let t = 0;
  const store = createSourceStore({ kept: 2, keptMs: 1000, now: () => t });
  const a = store.add({ name: "A" }), b = store.add({ name: "B" }), c = store.add({ name: "C" });
  assert.equal(store.get(a), null, "the oldest goes when a third arrives");
  assert.equal(store.get(b).name, "B");
  t = 2000;
  assert.equal(store.get(c), null, "older than an hour is forgotten");
  assert.equal(store.get({ not: "a string" }), null);
});

// A presentation of invented words, made with the package's own schema.
function samplePro(title, words) {
  const { Presentation } = lib.loadSchema();
  const rtf = (w) => Buffer.from(`{\\rtf1\\ansi{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;}\n\\pard\n\n\\f0\\fs80 \\cf2 ${w}}`, "latin1");
  const id = (n) => ({ string: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` });
  const cue = { uuid: id(1), name: "One", actions: [{ uuid: id(2), label: { text: "One" }, type: 11, slide: { presentation: { base_slide: { elements: [{ element: { uuid: id(3), name: "Words", bounds: { origin: { x: 100, y: 100 }, size: { width: 1700, height: 300 } }, text: { rtf_data: rtf(words), attributes: {} } } }] } } } }] };
  return Buffer.from(Presentation.encode(Presentation.fromObject({ uuid: id(9), name: title, cues: [cue], cue_groups: [{ group: { uuid: id(4), name: "Main" }, cue_identifiers: [id(1)] }] })).finish());
}

async function withServer(deps, fn) {
  const app = express();
  app.use(express.json());
  app.use("/api/probundle", probundleRouter(deps));
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  try {
    await fn(`http://127.0.0.1:${server.address().port}/api/probundle`);
  } finally {
    server.close();
  }
}

test("routes: open from the library by id and by upload, compare the two, refuse while busy", { skip: lib ? false : "propresenter-bundle is not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probundle-"));
  const file = path.join(dir, "Example.pro");
  fs.writeFileSync(file, samplePro("Example", "Welcome in"));
  let busy = null;
  let config = { features: { probundle: true }, probundleModule: { packsDir: dir } };
  const deps = {
    getConfig: () => config,
    updateConfig: async (f) => { config = f(config); },
    getStatus: getProbundleModuleStatus,
    getProblems: probundleModuleProblems,
    getIndex: () => ({ presentations: { "pres-1": { name: "Example", folder: "Misc", presentationPath: file } } }),
    busyReason: () => busy,
  };
  try {
    await withServer(deps, async (base) => {
      const status = await fetch(`${base}/status`).then((r) => r.json());
      assert.equal(status.status, "active");

      const list = await fetch(`${base}/library?q=exam`).then((r) => r.json());
      assert.deepEqual(list.presentations, [{ id: "pres-1", name: "Example", folder: "Misc" }]);

      const post = (p, body, headers = { "Content-Type": "application/json" }) => fetch(base + p, { method: "POST", headers, body });
      const fromLib = await post("/open/library", JSON.stringify({ presentationId: "pres-1" })).then((r) => r.json());
      assert.equal(fromLib.model.name, "Example");
      assert.deepEqual(fromLib.model.groups[0].slides[0].text, ["Welcome in"]);

      const missing = await post("/open/library", JSON.stringify({ presentationId: "../../etc/passwd" }));
      assert.equal(missing.status, 404, "only ids the index knows; never a path");

      const up = await post("/open/upload", samplePro("Example", "Welcome home"), { "Content-Type": "application/octet-stream", "X-File-Name": "Example%20fixed.pro" }).then((r) => r.json());
      assert.equal(up.name, "Example fixed.pro");

      // A long name in another alphabet is decoded before it is cut, and a name not encoded is shown as it came.
      const long = "é".repeat(150) + ".pro";
      const longUp = await post("/open/upload", samplePro("Example", "Welcome"), { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(long) }).then((r) => r.json());
      assert.equal(longUp.name, long.slice(0, 200));
      const raw = await post("/open/upload", samplePro("Example", "Welcome"), { "Content-Type": "application/octet-stream", "X-File-Name": "100% fixed.pro" }).then((r) => r.json());
      assert.equal(raw.name, "100% fixed.pro");

      // One read at a time: a second arriving while the first is read is told to wait.
      const both = await Promise.all([1, 2].map(() => post("/open/upload", samplePro("Example", "Welcome"), { "Content-Type": "application/octet-stream" })));
      assert.deepEqual(both.map((r) => r.status).sort(), [200, 429]);

      const diff = await post("/diff", JSON.stringify({ before: fromLib.sourceId, after: up.sourceId })).then((r) => r.json());
      assert.deepEqual(diff.diff.changed[0].changes.map((c) => [c.what, c.before, c.after]), [["words", "Welcome in", "Welcome home"]]);

      const junk = await post("/open/upload", Buffer.from("this is not a presentation"), { "Content-Type": "application/octet-stream" });
      assert.equal(junk.status, 422);

      busy = "Performance mode is on.";
      const refused = await post("/open/library", JSON.stringify({ presentationId: "pres-1" }));
      assert.equal(refused.status, 409);
      assert.equal((await refused.json()).error, "Performance mode is on.");

      const badDir = await post("/config", JSON.stringify({ packsDir: "./public/packs" }));
      assert.equal(badDir.status, 400);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
