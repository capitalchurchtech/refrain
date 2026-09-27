import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createThumbStore } from "../server/thumb-store.js";

const img = (s) => ({ type: "image/jpeg", bytes: Buffer.from(s) });

test("pictures are kept per presentation version; an edit makes them stale, and so does age", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-thumbs-"));
  try {
    const store = createThumbStore({ dir, maxAgeMs: 1000 });
    await store.put("P", 0, "10:1", img("a"), 0);
    await store.put("P", 1, "10:1", img("b"), 0);
    assert.equal((await store.get("P", 1, "10:1", 500)).bytes.toString(), "b");
    assert.equal(await store.complete("P", "10:1", 2, 500), true);
    assert.equal(await store.complete("P", "10:1", 3, 500), false, "a slide missing");
    assert.equal(await store.get("P", 0, "11:2", 500), null, "edited since: not served");
    assert.equal(await store.get("P", 0, "10:1", 5000), null, "too old (a theme may have changed): not served either");
    assert.equal(await store.complete("P", "10:1", 2, 5000), false);
    await store.put("P", 0, "10:1", img("a2"), 5000);
    assert.equal(await store.get("P", 1, "10:1", 5100), null, "an aged set starts again rather than mixing old and new");
    assert.equal((await store.get("P", 0, "10:1", 5100)).bytes.toString(), "a2");

    await store.put("P", 0, "11:2", img("c"), 6000);
    assert.equal(await store.get("P", 1, "11:2", 6100), null, "the new version starts with nothing from the old");
    assert.equal((await store.get("P", 0, "11:2", 6100)).bytes.toString(), "c");

    // A fresh store (a restart) reads the same pictures back from disk.
    const again = createThumbStore({ dir, maxAgeMs: 1000 });
    assert.equal((await again.get("P", 0, "11:2", 6100)).bytes.toString(), "c");
    assert.equal(await again.get("P", 0, null), null, "no fingerprint, no stored picture");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only the most recent presentations are kept", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-thumbs-"));
  try {
    const store = createThumbStore({ dir, maxPresentations: 2 });
    for (const [i, pid] of ["A", "B", "C"].entries()) await store.put(pid, 0, "1:1", img(pid), i * 1000);
    assert.equal(await store.prune(), 1);
    assert.deepEqual((await readdir(dir)).sort(), ["B", "C"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two slides of one presentation stored at once both land, including across a version change", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-thumbs-"));
  try {
    const store = createThumbStore({ dir });
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.put("P", i, "1:1", img(`s${i}`))));
    for (let i = 0; i < 12; i++) assert.equal((await store.get("P", i, "1:1")).bytes.toString(), `s${i}`);
    await Promise.all(Array.from({ length: 6 }, (_, i) => store.put("P", i, "2:2", img(`n${i}`))));
    assert.equal(await store.complete("P", "2:2", 6), true, "the version change didn't delete a picture written beside it");
    const fresh = createThumbStore({ dir });
    assert.equal(await fresh.complete("P", "2:2", 6), true, "and meta.json on disk says so too");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
