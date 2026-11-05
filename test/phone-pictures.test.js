import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPhonePictures, phonePicturesStatus } from "../server/phone-pictures.js";
import { outlineOf, placeInOutline } from "../server/playing-slide.js";

// A stand-in for the snapshot tool: "photographs" every page by writing its file, except any url ending /bad.
const fakeRun = async (_helper, jobs) => Promise.all(jobs.map(async (j) => {
  if (j.url.endsWith("/bad")) return { out: j.out, ok: false, error: "no" };
  await writeFile(j.out, "jpeg");
  return { out: j.out, ok: true };
}));

test("off until switched on; on a Mac with the tool built it is active, else it says what's missing", () => {
  assert.equal(phonePicturesStatus({}).status, "off");
  assert.equal(phonePicturesStatus({ slidePictures: { phones: true } }, { platform: "win32", helperExists: true }).status, "misconfigured");
  assert.match(phonePicturesStatus({ slidePictures: { phones: true } }, { platform: "darwin", helperExists: false }).problem, /Build Refrain\.app/);
  assert.equal(phonePicturesStatus({ slidePictures: { phones: true } }, { platform: "darwin", helperExists: true }).status, "active");
});

test("pictures are kept by cue and file version, found by cue, by place in any arrangement, or by the file's order", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-phonepics-"));
  try {
    const pics = createPhonePictures({ dir, helper: "x", run: fakeRun });
    const groups = { "G-SAT": ["c1", "c2"], "G-PC": ["c3", "c4", "c5"] };
    const order = ["c1", "c2", "c3", "c4", "c5"];
    assert.deepEqual(await pics.missing("P", "v1", order), order, "nothing made yet");
    const r = await pics.make("P", "v1", groups, order, ["c1", "c2", "c3", "c4", "c5"], (cue) => (cue === "c5" ? "http://x/bad" : `http://x/${cue}`));
    assert.deepEqual(r, { made: 4, failed: 1 });
    assert.deepEqual(await pics.missing("P", "v1", order), ["c5"], "only the failed one is left");
    assert.equal((await pics.picture("P", "v1", "c3")).cue, "c3");
    assert.equal(await pics.picture("P", "v2", "c3"), null, "the file changed since: not served");
    assert.equal((await pics.picture("P", "v1", { order: 3 })).cue, "c4", "a flag's slide, in the file's order");

    // A slide numbered in the arrangement playing finds its cue through its group and place.
    const outline = outlineOf({
      current_arrangement: "",
      groups: [{ uuid: "G-SAT", name: "Sat", slides: [{}, {}] }, { uuid: "G-PC", name: "PC", slides: [{}, {}, {}] }],
      arrangements: [{ id: { uuid: "A-PC", name: "PC Sunday" }, groups: ["G-PC"] }, { id: { uuid: "A-SAT", name: "Saturday" }, groups: ["G-SAT"] }],
    });
    assert.equal((await pics.picture("P", "v1", placeInOutline(outline, "A-PC", 1))).cue, "c4", "slide 1 of PC Sunday is the PC group's second");
    assert.equal(placeInOutline(outline, null, 1), null, "no arrangement known: no guess");
    assert.deepEqual(placeInOutline(outline, null, 2, { raw: true }), { groupUuid: "G-PC", offset: 0 }, "the file's own order");

    // A new version starts the folder afresh; a fresh store reads the manifest back.
    await pics.make("P", "v2", groups, order, ["c1"], (cue) => `http://x/${cue}`);
    assert.deepEqual((await readdir(path.join(dir, "P"))).sort(), ["c1.jpg", "manifest.json"]);
    const again = createPhonePictures({ dir, helper: "x", run: fakeRun });
    assert.equal((await again.picture("P", "v2", "c1")).cue, "c1");
    assert.equal(await again.picture("P", "v2", "c2"), null);

    await again.make("Q", "v1", { G: ["q1"] }, ["q1"], ["q1"], (cue) => `http://x/${cue}`);
    await again.prune(new Set(["Q"]));
    assert.deepEqual(await readdir(dir), ["Q"], "presentations no longer wanted are dropped");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an id can never name a folder outside the store", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-phonepics-"));
  try {
    const pics = createPhonePictures({ dir: path.join(dir, "store"), helper: "x", run: fakeRun });
    await pics.make("..", "v1", { G: ["../x"] }, ["../x"], ["../x"], () => "http://x/ok");
    assert.deepEqual(await readdir(dir), ["store"], "nothing written beside the store");
    assert.deepEqual((await readdir(path.join(dir, "store"))).sort(), ["_.."]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
