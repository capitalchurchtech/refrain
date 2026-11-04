// The Bundles module's glue (server/probundle.js): where files may come from,
// the packs folder rule, the status, and the routes end to end on a made-up
// presentation. The format itself is tested in the propresenter-bundle package.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { fileURLToPath } from "node:url";
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
function samplePro(title, words, media = []) {
  const { Presentation } = lib.loadSchema();
  const rtf = (w) => Buffer.from(`{\\rtf1\\ansi{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;}\n\\pard\n\n\\f0\\fs80 \\cf2 ${w}}`, "latin1");
  const id = (n) => ({ string: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` });
  // Each media action names its file by a path relative to the workspace, as ProPresenter writes it.
  const mediaActions = media.map((rel, i) => ({ uuid: id(20 + i), isEnabled: true, type: 2, media: { layer_type: 0, element: { url: { local: { root: 10, path: rel } }, image: {} } } }));
  const cue = { uuid: id(1), name: "One", actions: [...mediaActions, { uuid: id(2), label: { text: "One" }, type: 11, slide: { presentation: { base_slide: { elements: [{ element: { uuid: id(3), name: "Words", bounds: { origin: { x: 100, y: 100 }, size: { width: 1700, height: 300 } }, text: { rtf_data: rtf(words), attributes: {} } } }] } } } }] };
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
    appRoot: dir,
    userWorkspaces: path.join(dir, "no-propresenter"),
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

test("drawn slides: a batch at a time, pictures by number from the workspace or the bundle, never from outside them", { skip: lib?.drawPresentation ? false : "propresenter-bundle with drawing is not installed" }, async () => {
  const { default: sharp } = await import("sharp");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probundle-draw-"));
  // A made-up ProPresenter workspace: one picture in its Media folder, one outside the workspace.
  const ws = path.join(dir, "UserWorkspaces", "Example");
  fs.mkdirSync(path.join(ws, "Media", "Assets"), { recursive: true });
  fs.mkdirSync(path.join(ws, "Libraries", "Misc"), { recursive: true });
  const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#336699" } }).png().toBuffer();
  fs.writeFileSync(path.join(ws, "Media", "Assets", "here.png"), png);
  fs.writeFileSync(path.join(dir, "secret.png"), png);
  const file = path.join(ws, "Libraries", "Misc", "Example.pro");
  fs.writeFileSync(file, samplePro("Example", "Welcome in", ["Media/Assets/here.png", "Media/Assets/gone.png", "../../secret.png"]));
  let busy = null;
  const deps = {
    getConfig: () => ({ features: { probundle: true }, probundleModule: { packsDir: dir } }),
    updateConfig: async () => {},
    getStatus: getProbundleModuleStatus,
    getProblems: probundleModuleProblems,
    getIndex: () => ({ presentations: { "pres-1": { name: "Example", folder: "Misc", presentationPath: file } } }),
    busyReason: () => busy,
    appRoot: dir,
    userWorkspaces: path.join(dir, "no-propresenter"),
  };
  try {
    await withServer(deps, async (base) => {
      const post = (p, body, headers = { "Content-Type": "application/json" }) => fetch(base + p, { method: "POST", headers, body });
      const opened = await post("/open/library", JSON.stringify({ presentationId: "pres-1" })).then((r) => r.json());
      assert.equal(opened.drawnCount, 1);
      const batch = await fetch(`${base}/slides/${opened.sourceId}?from=0&count=24`).then((r) => r.json());
      assert.equal(batch.total, 1);
      assert.match(batch.css, /\.slide\{/);
      assert.match(batch.fontCss, /ps-HelveticaNeue/);
      const html = batch.slides[0].html;
      assert.ok(html.includes("Welcome in"));
      // The last media action is the one playing; earlier ones are replaced by it.
      assert.ok(!html.includes("__SRC__"), "the page gets real addresses");

      // Each media action in turn, as the one playing: the picture there, the one missing, the one outside.
      const drawnWith = async (rel) => {
        fs.writeFileSync(file, samplePro("Example", "Welcome in", [rel]));
        const o = await post("/open/library", JSON.stringify({ presentationId: "pres-1" })).then((r) => r.json());
        return { id: o.sourceId, html: (await fetch(`${base}/slides/${o.sourceId}`).then((r) => r.json())).slides[0].html };
      };
      const here = await drawnWith("Media/Assets/here.png");
      assert.ok(here.html.includes(`/api/probundle/picture/${here.id}/0`));
      const pic = await fetch(`${base}/picture/${here.id}/0`);
      assert.equal(pic.status, 200);
      assert.equal(pic.headers.get("content-type"), "image/jpeg");
      assert.equal((await sharp(Buffer.from(await pic.arrayBuffer())).metadata()).width, 40, "small pictures are not enlarged");
      assert.equal((await fetch(`${base}/picture/${here.id}/7`)).status, 404);
      assert.equal((await fetch(`${base}/picture/not-opened/0`)).status, 404);
      busy = "Performance mode is on.";
      assert.equal((await fetch(`${base}/picture/${here.id}/0`)).status, 409, "no picture work during a service");
      busy = null;

      const gone = await drawnWith("Media/Assets/gone.png");
      assert.match(gone.html, /class="full missing">gone\.png</, "a picture nobody has is marked missing by name");
      const outside = await drawnWith("../../secret.png");
      assert.match(outside.html, /class="full missing">secret\.png</, "a path out of the workspace is not followed");
      assert.ok(!outside.html.includes("/api/probundle/picture/"));

      assert.equal((await fetch(`${base}/slides/nope`)).status, 404);
    });

    // A bundle's own pictures are copied into the cache under their content hash and served from there.
    const bundle = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.resolve("propresenter-bundle/package.json"))), "test", "fixtures", "sample.probundle"));
    await withServer(deps, async (base) => {
      const up = await fetch(`${base}/open/upload`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": "sample.probundle" }, body: bundle }).then((r) => r.json());
      const { slides } = await fetch(`${base}/slides/${up.sourceId}`).then((r) => r.json());
      const urls = [...new Set(slides.flatMap((s) => [...s.html.matchAll(/\/api\/probundle\/picture\/[^/]+\/(\d+)/g)].map((m) => m[1])))];
      assert.ok(urls.length, "the bundle's pictures are drawn");
      for (const n of urls) assert.equal((await fetch(`${base}/picture/${up.sourceId}/${n}`)).status, 200);
      assert.ok(slides.some((s) => s.html.includes(">example-panel.png<")), "the one the bundle lacks is marked missing");
      const cached = fs.readdirSync(path.join(dir, "data", "probundle-staging", "pictures"));
      assert.ok(cached.some((f) => /^[0-9a-f]{64}\.png$/.test(f)), "copied in under its content hash");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a picture's source: only the cache by hash, or inside the workspace, never a link out of it", async () => {
  const { pictureSource, workspaceOfLibraryFile } = await import("../server/slide-pictures.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probundle-pics-"));
  try {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(path.join(ws, "Media", "Assets"), { recursive: true });
    fs.writeFileSync(path.join(ws, "Media", "Assets", "a.jpg"), "x");
    fs.writeFileSync(path.join(dir, "out.jpg"), "x");
    fs.symlinkSync(path.join(dir, "out.jpg"), path.join(ws, "Media", "Assets", "link.jpg"));
    fs.writeFileSync(path.join(ws, "Media", "Assets", "notes.txt"), "x");
    const at = (pic) => pictureSource(pic, { cacheDir: path.join(dir, "cache"), workspace: ws });
    assert.equal(at({ name: "a.jpg", rel: "Media/Assets/a.jpg" }), fs.realpathSync(path.join(ws, "Media", "Assets", "a.jpg")));
    assert.equal(at({ name: "a.jpg", rel: null }), fs.realpathSync(path.join(ws, "Media", "Assets", "a.jpg")), "found by name in Media/Assets");
    assert.equal(at({ name: "out.jpg", rel: "../out.jpg" }), null);
    assert.equal(at({ name: "out.jpg", rel: path.join(dir, "out.jpg") }), null, "an absolute path is not followed");
    assert.equal(at({ name: "link.jpg", rel: "Media/Assets/link.jpg" }), null, "a link that leads out is not followed");
    assert.equal(at({ name: "notes.txt", rel: "Media/Assets/notes.txt" }), null, "pictures and videos only");
    assert.equal(at({ name: "x.png", cached: "../../etc/passwd" }), null);
    assert.equal(at({ name: "x.png", cached: `${"a".repeat(64)}.png` }), path.join(dir, "cache", `${"a".repeat(64)}.png`));
    assert.equal(pictureSource({ name: "a.jpg" }, { cacheDir: dir, workspace: null }), null);
    assert.equal(workspaceOfLibraryFile("/Users/x/Library/Application Support/RenewedVision/ProPresenter/UserWorkspaces/ProPresenter/Libraries/Misc/A.pro"), "/Users/x/Library/Application Support/RenewedVision/ProPresenter/UserWorkspaces/ProPresenter");
    assert.equal(workspaceOfLibraryFile("/tmp/A.pro"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("this Mac's workspace is the one whose libraries changed last, not the first by name", async () => {
  const { localWorkspace } = await import("../server/slide-pictures.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probundle-ws-"));
  try {
    for (const [name, days] of [["Aardvark clone", 30], ["ProPresenter", 1], ["test", 10]]) {
      fs.mkdirSync(path.join(dir, name, "Media"), { recursive: true });
      fs.mkdirSync(path.join(dir, name, "Libraries"));
      const t = new Date(Date.now() - days * 86_400_000);
      fs.utimesSync(path.join(dir, name, "Libraries"), t, t);
    }
    fs.mkdirSync(path.join(dir, "no media"));
    assert.equal(localWorkspace(dir), path.join(dir, "ProPresenter"));
    assert.equal(localWorkspace(path.join(dir, "missing")), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Claude's drafts: listed newest first, opened by id, their version checked; never a path", { skip: lib?.drawPresentation ? false : "propresenter-bundle with drawing is not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probundle-drafts-"));
  const staging = path.join(dir, "data", "probundle-staging");
  const copyId = "11111111-2222-4333-8444-555555555555";
  fs.mkdirSync(path.join(staging, "copies", copyId), { recursive: true });
  fs.mkdirSync(path.join(staging, "built"), { recursive: true });
  const copyFile = path.join(staging, "copies", copyId, "Sunday (edited).pro");
  fs.writeFileSync(copyFile, samplePro("Sunday", "First words"));
  fs.writeFileSync(path.join(staging, "copies", copyId, "copy.json"), JSON.stringify({ file: "Sunday (edited).pro", kind: "pro", made: "2026-11-01T10:00:00Z", changed: "2026-11-01T10:05:00Z", note: "Changed slide 1 (words)" }));
  fs.writeFileSync(path.join(staging, "built", "Skit.pro"), samplePro("Skit", "Built"));
  fs.utimesSync(path.join(staging, "built", "Skit.pro"), new Date(2020, 0, 1), new Date(2020, 0, 1));
  fs.writeFileSync(path.join(staging, "built", "notes.txt"), "not a presentation");
  const deps = {
    getConfig: () => ({ features: { probundle: true }, probundleModule: { packsDir: dir } }),
    updateConfig: async () => {},
    getStatus: getProbundleModuleStatus,
    getProblems: probundleModuleProblems,
    getIndex: () => ({ presentations: {} }),
    busyReason: () => null,
    appRoot: dir,
    userWorkspaces: path.join(dir, "no-propresenter"),
  };
  try {
    await withServer(deps, async (base) => {
      const { drafts } = await fetch(`${base}/drafts`).then((r) => r.json());
      assert.deepEqual(drafts.map((d) => [d.id, d.name, d.note]), [[`copy:${copyId}`, "Sunday (edited)", "Changed slide 1 (words)"], ["built:Skit.pro", "Skit", null]]);
      assert.ok(drafts.every((d) => !("file" in d)), "no paths go to the page");

      const post = (body) => fetch(`${base}/open/draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const opened = await post({ id: `copy:${copyId}` }).then((r) => r.json());
      assert.equal(opened.draft.id, `copy:${copyId}`);
      assert.equal(opened.model.groups[0].slides[0].text[0], "First words");
      const v1 = (await fetch(`${base}/drafts/version?id=${encodeURIComponent(`copy:${copyId}`)}`).then((r) => r.json())).version;
      assert.equal(v1, opened.draft.version);

      // The assistant saves a change: the version moves, and opening again draws the new words.
      fs.writeFileSync(copyFile, samplePro("Sunday", "Second words"));
      fs.utimesSync(copyFile, new Date(), new Date(Date.now() + 5000));
      const v2 = (await fetch(`${base}/drafts/version?id=${encodeURIComponent(`copy:${copyId}`)}`).then((r) => r.json())).version;
      assert.notEqual(v2, v1);
      const again = await post({ id: `copy:${copyId}` }).then((r) => r.json());
      const { slides } = await fetch(`${base}/slides/${again.sourceId}`).then((r) => r.json());
      assert.ok(slides[0].html.includes("Second words"));

      for (const id of ["copy:../../etc", "built:../secret.pro", "built:.hidden.pro", "built:notes.txt", "/etc/passwd", "copy:not-a-uuid", `copy:${copyId}/../x`]) {
        assert.equal((await post({ id })).status, 404, `${id} is refused`);
        assert.equal((await fetch(`${base}/drafts/version?id=${encodeURIComponent(id)}`)).status, 404);
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
