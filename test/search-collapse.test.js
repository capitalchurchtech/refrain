import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIndexFromDisk, search } from "../server/search-index.js";

// search() reads the module's loaded index, and loadIndexFromDisk reads
// ./cache relative to the working directory, so build a throwaway cache in a
// temp cwd rather than touching the real one.
let origCwd, dir;
before(async () => {
  origCwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "refrain-idx-"));
  process.chdir(dir);
  await mkdir("cache", { recursive: true });
  await writeFile(
    join("cache", "search-index.json"),
    JSON.stringify({
      schemaVersion: 2,
      builtAt: new Date().toISOString(),
      presentations: {
        "pres-1": {
          name: "Build My Life",
          folder: "Songs",
          appearsIn: [],
          createdDate: null,
          modifiedDate: null,
          arrangementName: "FS",
          arrangementId: "arr-fs",
          arrangementSource: "preferred",
          // A chorus repeated three times, as an arrangement that repeats a
          // group produces, plus one unique line.
          slides: [
            { index: 0, text: "firm foundation", groupId: "g-c", groupOffset: 0 },
            { index: 4, text: "firm foundation", groupId: "g-c", groupOffset: 0 },
            { index: 9, text: "firm foundation", groupId: "g-c", groupOffset: 0 },
            { index: 12, text: "only unique line", groupId: "g-e", groupOffset: 0 },
          ],
        },
      },
    })
  );
  await loadIndexFromDisk();
});
after(async () => {
  process.chdir(origCwd);
  await rm(dir, { recursive: true, force: true });
});

test("search collapses a repeated lyric into one result with a repeat count", () => {
  const results = search({ query: "firm foundation" });
  assert.equal(results.length, 1, "three repeats of the same lyric are one result");
  assert.equal(results[0].repeatCount, 3);
});

test("search keeps the earliest occurrence, so Go Live lands on the first time it is sung", () => {
  const [r] = search({ query: "firm foundation" });
  assert.equal(r.slideIndex, 0);
  assert.equal(r.groupId, "g-c");
  assert.equal(r.groupOffset, 0);
});

test("search results carry the anchor and arrangement the UI needs", () => {
  const [r] = search({ query: "only unique" });
  assert.equal(r.arrangementName, "FS");
  assert.equal(r.groupId, "g-e");
  assert.equal(r.groupOffset, 0);
  assert.equal(r.repeatCount, 1);
  assert.equal(r.slideIndex, 12);
});
