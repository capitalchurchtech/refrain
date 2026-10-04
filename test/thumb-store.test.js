import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createThumbStore, slideKey } from "../server/thumb-store.js";

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

test("a new version keeps the pictures of slides that didn't change, wherever they moved", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-thumbs-"));
  try {
    const store = createThumbStore({ dir, maxAgeMs: 10_000 });
    const v1 = [
      { groupId: "V1", groupOffset: 0, text: "Amazing grace" },
      { groupId: "C", groupOffset: 0, text: "My chains are gone" },
      { groupId: "V2", groupOffset: 0, text: "Twas grace" },
    ];
    for (const [i, sl] of v1.entries()) await store.put("P", i, "1:1", img(`pic-${sl.groupId}`), 0, slideKey(sl));

    // Sunday morning: a word fixed in verse 2, and the arrangement changed so
    // the chorus comes first and is sung twice.
    const v2 = [v1[1], v1[0], { ...v1[2], text: "'Twas grace" }, v1[1]];
    const kept = await store.carryOver("P", "2:2", v2.map(slideKey), 100);
    assert.equal(kept, 3, "the two unchanged slides, the chorus twice; the edited verse is drawn again");
    assert.equal((await store.get("P", 0, "2:2", 100)).bytes.toString(), "pic-C", "moved, and still its own picture");
    assert.equal((await store.get("P", 1, "2:2", 100)).bytes.toString(), "pic-V1");
    assert.equal(await store.get("P", 2, "2:2", 100), null, "the edited slide has no picture until it's drawn");
    assert.equal((await store.get("P", 3, "2:2", 100)).bytes.toString(), "pic-C");
    assert.equal(await store.get("P", 0, "1:1", 100), null, "the old version is gone");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nothing is kept from a set too old to trust, or one stored without slide keys", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-thumbs-"));
  try {
    const store = createThumbStore({ dir, maxAgeMs: 1000 });
    const k = slideKey({ groupId: "A", groupOffset: 0, text: "x" });
    await store.put("OLD", 0, "1:1", img("a"), 0, k);
    assert.equal(await store.carryOver("OLD", "2:2", [k], 5000), 0, "older than maxAge");
    assert.equal(await store.get("OLD", 0, "2:2", 5000), null);
    assert.equal((await store.info("OLD")).count, 1, "a fresh set, ready to be drawn into");
    await store.put("NOKEY", 0, "1:1", img("a"), 0);
    assert.equal(await store.carryOver("NOKEY", "2:2", [k], 10), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("same file, different order (an arrangement switched without the file changing): matched by key", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-thumbs-"));
  try {
    const store = createThumbStore({ dir, maxAgeMs: 10_000 });
    const a = { groupId: "A", groupOffset: 0, text: "one" };
    const b = { groupId: "B", groupOffset: 0, text: "two" };
    await store.put("P", 0, "1:1", img("A"), 0, slideKey(a));
    await store.put("P", 1, "1:1", img("B"), 0, slideKey(b));
    assert.equal(await store.carryOver("P", "1:1", [slideKey(b), slideKey(a)], 10), 2);
    assert.equal((await store.get("P", 0, "1:1", 10)).bytes.toString(), "B");
    assert.equal(await store.carryOver("P", "1:1", [slideKey(b), slideKey(a)], 20), 2, "unchanged: all kept, nothing moved");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pictures drawn without a key take the key of the slide at their place, so the next run keeps them", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-thumbs-"));
  try {
    const store = createThumbStore({ dir, maxAgeMs: 10_000 });
    const k = [slideKey({ groupId: "A", groupOffset: 0, text: "one" }), slideKey({ groupId: "B", groupOffset: 0, text: "two" })];
    await store.put("P", 0, "1:1", img("A"), 0); // seen on Now, no key
    await store.put("P", 1, "1:1", img("B"), 0, k[1]);
    assert.equal(await store.carryOver("P", "1:1", k, 10), 2);
    assert.equal(await store.carryOver("P", "1:1", k, 20), 2, "and again: nothing to draw");
    assert.equal((await store.get("P", 0, "1:1", 20)).bytes.toString(), "A");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
