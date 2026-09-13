import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIndexFromDisk, search } from "../server/search-index.js";

// search() derives a lowercased/folded copy of each slide once and reuses it
// across queries. That cache is keyed by presentation id, so a rebuild or a
// reload that changes a presentation's slides while keeping its id is the
// case that would serve stale text -- the operator edits a lyric, reindexes,
// and keeps finding the old words. These tests are that case.
const origCwd = process.cwd();
const dir = await mkdtemp(join(tmpdir(), "refrain-derived-"));
process.chdir(dir);
await mkdir("cache", { recursive: true });

async function writeIndex(text) {
  await writeFile(
    join("cache", "search-index.json"),
    JSON.stringify({
      schemaVersion: 2,
      builtAt: new Date().toISOString(),
      presentations: {
        // Same id both times, which is what makes this a cache test.
        "pres-1": {
          name: "Fixture",
          folder: "Songs",
          appearsIn: [],
          createdDate: null,
          modifiedDate: null,
          arrangementName: "FS",
          arrangementId: "arr-fs",
          arrangementSource: "preferred",
          slides: [{ index: 0, text, groupId: "g-a", groupOffset: 0 }],
        },
      },
    })
  );
  await loadIndexFromDisk();
}

after(async () => {
  process.chdir(origCwd);
  await rm(dir, { recursive: true, force: true });
});

test("a reload replaces what the cache had derived", async () => {
  await writeIndex("the old words");
  assert.equal(search({ query: "old words" }).length, 1, "sanity: the first load is searchable");

  await writeIndex("the new words");
  assert.equal(search({ query: "new words" }).length, 1, "the edit is findable");
  assert.equal(search({ query: "old words" }).length, 0, "the old text is gone, not cached");
});

test("the apostrophe forms are re-derived too, not just the plain text", async () => {
  await writeIndex("nothing here");
  assert.equal(search({ query: "wont let go" }).length, 0);

  await writeIndex("won't let go");
  assert.equal(search({ query: "wont let go" }).length, 1, "folded form follows the reload");

  await writeIndex("plain text now");
  assert.equal(search({ query: "wont let go" }).length, 0, "stale folded form is not left behind");
});
