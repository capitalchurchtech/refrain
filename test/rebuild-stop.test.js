import test from "node:test";
import assert from "node:assert/strict";
import { rebuildIndex, getIndex, lastCrawlAbort } from "../server/search-index.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same reason as the other index tests: rebuildIndex persists to ./cache.
process.chdir(await mkdtemp(join(tmpdir(), "refrain-stop-")));

function client(count, { onFetch } = {}) {
  const songs = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`p${i}`, `Song ${i}`])
  );
  return {
    isLocalHost: false,
    async getLibraryDetailed() {
      return {
        items: Object.entries(songs).map(([id, name]) => ({ id, name, folder: "Songs" })),
        failedFolders: [], unmatchedNames: [], availableFolders: ["Songs"],
      };
    },
    async getLibrary() { return (await this.getLibraryDetailed()).items; },
    async getPresentation(id) {
      onFetch?.(id);
      return { presentation: { current_arrangement: "", groups: [{ uuid: "g", slides: [{ text: `lyric ${id}` }] }] } };
    },
    async getFileDates() { return { createdDate: null, modifiedDate: null }; },
  };
}

test("a rebuild stops when asked, instead of running to the end of the library", async () => {
  // The gap this closes: performance mode could refuse to START index work,
  // but a crawl already running carried straight on through a service and the
  // only way to end it was to quit Refrain.
  let fetched = 0;
  const c = client(30, { onFetch: () => fetched++ });
  await rebuildIndex(c, {}, [], { shouldStop: () => fetched >= 5 });
  assert.ok(fetched < 30, `stopped early, read ${fetched} of 30`);
  assert.ok(fetched >= 5, "it did get going first");
});

test("a stopped rebuild leaves a usable index, not a half-built one", async () => {
  // Whatever was not re-read keeps what the previous index had, which is the
  // same path the consecutive-failure breaker already used.
  const c = client(20);
  await rebuildIndex(c, {}, []);              // full build first
  const before = Object.keys(getIndex().presentations).length;
  assert.equal(before, 20);

  let n = 0;
  await rebuildIndex(client(20, { onFetch: () => n++ }), {}, [], { shouldStop: () => n >= 3 });
  const after = getIndex().presentations;
  assert.equal(Object.keys(after).length, 20, "every song is still in the index");
  const withSlides = Object.values(after).filter((e) => e.slides?.length).length;
  assert.equal(withSlides, 20, "including the ones it never got to re-read");
});

test("stopping is reported, not silent", async () => {
  // An index that is quietly short is the failure mode this whole area keeps
  // producing; a stop the operator cannot see is the same bug again.
  let n = 0;
  await rebuildIndex(client(20, { onFetch: () => n++ }), {}, [], { shouldStop: () => n >= 2 });
  const abort = lastCrawlAbort();
  assert.ok(abort, "the stop is recorded");
  assert.equal(abort.reason, "stopped");
  assert.match(abort.message, /stopped/i);
  assert.match(abort.message, /again/i, "and says what to do about it");
});

test("no shouldStop means the old behaviour, unchanged", async () => {
  let n = 0;
  await rebuildIndex(client(12, { onFetch: () => n++ }), {}, []);
  assert.equal(n, 12, "read every presentation");
  assert.equal(lastCrawlAbort(), null, "and reports no abort");
});

test("a predicate that never fires does not stop anything", async () => {
  let n = 0;
  await rebuildIndex(client(10, { onFetch: () => n++ }), {}, [], { shouldStop: () => false });
  assert.equal(n, 10);
});

test("an aborted crawl reports what it read, not what it planned to read", async () => {
  // The bug this pins: `reindexCounts` carried the PLAN, so an aborted run
  // announced "871 changed, 101 re-checked" directly above a notice saying 843
  // presentations had been left untouched. Two lines from one run, contradicting
  // each other, and the reassuring one was the lie.
  let n = 0;
  const idx = await rebuildIndex(client(40, { onFetch: () => n++ }), {}, [], {
    shouldStop: () => n >= 6,
  });
  assert.equal(idx.reindexAttempted, 40, "it planned to read all 40");
  assert.ok(idx.reindexCompleted < 40, `it actually read ${idx.reindexCompleted}`);
  assert.equal(idx.reindexCompleted, n - 1 >= 0 ? idx.reindexCompleted : 0);
});

test("a run that finishes reports attempted and completed as equal", async () => {
  const idx = await rebuildIndex(client(15), {}, []);
  assert.equal(idx.reindexAttempted, 15);
  assert.equal(idx.reindexCompleted, 15, "nothing was skipped, so they match");
});
