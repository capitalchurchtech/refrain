// Desktop previews drawn from the presentation's file (server/slide-drawing.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { playedCueIds, createSlideDrawing } from "../server/slide-drawing.js";
import { apiShapeFromDoc } from "../server/presentation-files.js";
import { resolveArrangement, flattenGroups } from "../server/arrangements.js";

const lib = await import("propresenter-bundle").then((l) => (l.drawPresentation ? l : null)).catch(() => null);

// An invented presentation: three groups, cue c4 in no group, and an
// arrangement that repeats the chorus and skips the bridge.
const id = (s) => ({ string: s });
const doc = {
  uuid: id("p1"),
  cues: ["c1", "c2", "c3", "c4", "c5"].map((c) => ({ uuid: id(c), actions: [] })),
  cue_groups: [
    { group: { uuid: id("verse"), name: "Verse" }, cue_identifiers: [id("c1"), id("c2")] },
    { group: { uuid: id("chorus"), name: "Chorus" }, cue_identifiers: [id("c3"), id("gone")] },
    { group: { uuid: id("bridge"), name: "Bridge" }, cue_identifiers: [id("c5")] },
  ],
  arrangements: [{ uuid: id("a1"), name: "FS", group_identifiers: [id("verse"), id("chorus"), id("missing"), id("chorus")] }],
};
const stub = { showsOwnLabel: () => false, readableText: () => "", linksOf: () => [] };

test("slides are numbered as ProPresenter plays them, the same numbering as the index", () => {
  const selected = { ...doc, selected_arrangement: id("a1") };
  assert.deepEqual(playedCueIds(selected), ["c1", "c2", "c3", "c3"]);
  assert.deepEqual(playedCueIds(doc), ["c1", "c2", "c3", "c5"], "no arrangement selected: every group in order");
  assert.deepEqual(playedCueIds({ ...doc, selected_arrangement: id("other") }), ["c1", "c2", "c3", "c5"], "an arrangement that is not there: every group");
  // The count matches the API-shaped answer's flat slides, which is what the
  // picture numbers and Go Live use.
  for (const d of [doc, selected]) {
    const flat = flattenGroups(resolveArrangement(apiShapeFromDoc(stub, d, "/x.pro"), []).groups);
    assert.equal(playedCueIds(d).length, flat.length);
  }
  assert.deepEqual(playedCueIds(null), []);
});

test("a file is drawn once per version, one at a time, and asked by played number", async () => {
  const calls = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const draw = async ({ pid, version }) => {
    calls.push(`${pid}@${version}`);
    await gate;
    return { order: ["c1", "c2"], drawn: [{ id: "c1", html: `<i>${version} one</i>`, fonts: ["A"], width: 1920, height: 1080 }, { id: "c2", html: "<i>two</i>", fonts: [], width: 1920, height: 1080 }], pictures: [], workspace: null };
  };
  const sd = createSlideDrawing({ draw, kept: 2 });
  assert.equal(await sd.slide("p1", "/f.pro", "v1", 0, { drawNew: false }), null, "nothing drawn yet, and not asked to draw");
  const a = sd.slide("p1", "/f.pro", "v1", 0);
  const b = sd.slide("p1", "/f.pro", "v1", 1);
  release();
  assert.equal((await a).html, "<i>v1 one</i>");
  assert.equal((await b).html, "<i>two</i>");
  assert.deepEqual(calls, ["p1@v1"], "two slides of one file: one drawing");
  assert.equal((await sd.slide("p1", "/f.pro", "v1", 1, { drawNew: false })).html, "<i>two</i>", "a drawing already made is answered during a service");
  assert.equal(await sd.slide("p1", "/f.pro", "v1", 2), null, "past the last slide");
  assert.equal(await sd.slide("p1", "/f.pro", "v1", -1), null);
  assert.equal(await sd.slide("p1", "/f.pro", null, 0), null, "no version, no drawing");
  assert.equal((await sd.slide("p1", "/f.pro", "v2", 0)).html, "<i>v2 one</i>", "a new version is drawn again");
  assert.equal(await sd.slide("p1", "/f.pro", "v1", 0, { drawNew: false }), null, "the old version is not kept");
  await sd.slide("p2", "/g.pro", "v1", 0);
  await sd.slide("p3", "/h.pro", "v1", 0);
  assert.equal(await sd.slide("p1", "/f.pro", "v2", 0, { drawNew: false }), null, "the least recently used file is dropped past the limit");
});

test("a drawing that fails answers null, and the next ask tries again", async () => {
  let n = 0;
  const sd = createSlideDrawing({
    draw: async () => {
      if (++n === 1) throw new Error("unreadable");
      return { order: ["c1"], drawn: [{ id: "c1", html: "ok", fonts: [] }], pictures: [], workspace: null };
    },
  });
  assert.equal(await sd.slide("p1", "/f.pro", "v1", 0), null);
  assert.equal((await sd.slide("p1", "/f.pro", "v1", 0)).html, "ok");
});

test("pictures are served only from inside the drawn file's workspace", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-drawn-"));
  fs.mkdirSync(path.join(ws, "Media", "Assets"), { recursive: true });
  fs.writeFileSync(path.join(ws, "Media", "Assets", "logo.png"), "x");
  const pictures = [{ name: "logo.png", rel: "Media/Assets/logo.png", cached: null }, { name: "x.png", rel: "../../etc/x.png", cached: null }, { name: "c.png", rel: null, cached: "a".repeat(64) + ".png" }];
  const sd = createSlideDrawing({ draw: async () => ({ order: [], drawn: [], pictures, workspace: ws }) });
  await sd.slide("p1", "/f.pro", "v1", 0);
  assert.equal(sd.picture("p1", 0), fs.realpathSync(path.join(ws, "Media", "Assets", "logo.png")));
  assert.equal(sd.picture("p1", 1), null, "a path out of the workspace");
  assert.equal(sd.picture("p1", 2), null, "a cache name never comes from a library file");
  assert.equal(sd.picture("p1", 9), null);
  assert.equal(sd.picture("nope", 0), null, "a presentation not drawn");
  fs.rmSync(ws, { recursive: true, force: true });
});

test("the worker draws a library file in played order", { skip: !lib && "propresenter-bundle not installed" }, async () => {
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.resolve("propresenter-bundle/package.json"))), "test", "fixtures", "sample.pro");
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-drawn-"));
  const file = path.join(ws, "Libraries", "Test", "sample.pro");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(fixture, file);
  const { doc: decoded } = lib.decodePresentation(fs.readFileSync(file));
  const pid = decoded.uuid.string;
  const sd = createSlideDrawing();
  const played = playedCueIds(decoded);
  const first = await sd.slide(pid, file, "v1", 0);
  assert.match(first?.html ?? "", /class="slide[ "]/, "drawn");
  assert.equal(await sd.slide(pid, file, "v1", played.length), null);
  assert.equal(await createSlideDrawing().slide("not-this-one", file, "v1", 0), null, "a file holding another presentation is not drawn");
  fs.rmSync(ws, { recursive: true, force: true });
});
