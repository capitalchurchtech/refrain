import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkSourceGuard,
  planSync,
  snapshotName,
  prunePlan,
  listLibraryFiles,
  listSnapshots,
  takeSnapshot,
  syncLibrary,
  libraryDirFromPresentationPath,
  DEFAULT_MINIMUM_FILES,
} from "../server/library-sync.js";

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "refrain-libsync-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seed(sub, names, body = "song") {
  const d = join(dir, sub);
  await mkdir(d, { recursive: true });
  for (const n of names) await writeFile(join(d, n), `${body} ${n}`);
  return d;
}

// --- the guard: the whole point is refusing the disaster case ---

test("checkSourceGuard refuses an empty source", () => {
  const r = checkSourceGuard(0);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no presentations/i);
});

test("checkSourceGuard refuses a source below the safety floor", () => {
  const r = checkSourceGuard(3, 50);
  assert.equal(r.ok, false);
  assert.match(r.reason, /only 3 presentations/);
});

test("checkSourceGuard allows a plausible library", () => {
  assert.equal(checkSourceGuard(184, 50).ok, true);
  assert.equal(checkSourceGuard(DEFAULT_MINIMUM_FILES).ok, true);
});

// --- planning: never proposes a deletion ---

test("planSync splits new, changed and unchanged files", () => {
  const source = [
    { name: "a.pro", size: 1, hash: "aaa" },
    { name: "b.pro", size: 2, hash: "bbb" },
    { name: "c.pro", size: 3, hash: "ccc" },
  ];
  const dest = [
    { name: "b.pro", size: 2, hash: "bbb" }, // identical
    { name: "c.pro", size: 3, hash: "different" }, // same size, different content
  ];
  const plan = planSync(source, dest);
  assert.deepEqual(plan.toCopy, ["a.pro"]);
  assert.deepEqual(plan.unchanged, ["b.pro"]);
  assert.deepEqual(plan.toReplace, ["c.pro"]);
});

test("planSync reports destination-only files as extra and never deletes them", () => {
  const plan = planSync([{ name: "a.pro", size: 1, hash: "a" }], [{ name: "gone.pro", size: 1, hash: "g" }]);
  assert.deepEqual(plan.extra, ["gone.pro"]);
  assert.ok(!("toDelete" in plan), "there is deliberately no delete concept");
});

// --- snapshot naming and pruning ---

test("snapshotName is sortable and readable", () => {
  assert.equal(snapshotName(new Date(2026, 7, 23, 9, 5, 3)), "2026-08-23_090503");
});

test("prunePlan drops the oldest beyond the keep count", () => {
  const names = ["2026-08-01_000000", "2026-08-02_000000", "2026-08-03_000000"];
  assert.deepEqual(prunePlan(names, 2), ["2026-08-01_000000"]);
  assert.deepEqual(prunePlan(names, 5), []);
});

test("prunePlan with keep <= 0 never prunes, so snapshots are not silently destroyed", () => {
  assert.deepEqual(prunePlan(["2026-08-01_000000"], 0), []);
  assert.deepEqual(prunePlan(["2026-08-01_000000"], -1), []);
});

// --- listing ---

test("listLibraryFiles returns only .pro files and tolerates a missing folder", async () => {
  const d = await seed("lib", ["a.pro", "b.pro"]);
  await writeFile(join(d, "notes.txt"), "ignore me");
  await writeFile(join(d, ".hidden.pro"), "ignore me");
  assert.deepEqual((await listLibraryFiles(d)).map((f) => f.name), ["a.pro", "b.pro"]);
  assert.deepEqual(await listLibraryFiles(join(dir, "nope")), []);
});

// --- the sync itself ---

test("syncLibrary copies new files and leaves destination-only files alone", async () => {
  const src = await seed("src", ["one.pro", "two.pro", "three.pro"]);
  const dst = await seed("dst", ["keepme.pro"]);
  const r = await syncLibrary({ sourceDir: src, destDir: dst, minimumFiles: 1 });

  assert.equal(r.ok, true);
  assert.deepEqual(r.copied.sort(), ["one.pro", "three.pro", "two.pro"]);
  assert.deepEqual(r.extra, ["keepme.pro"]);
  const after = (await listLibraryFiles(dst)).map((f) => f.name);
  assert.ok(after.includes("keepme.pro"), "a file only the receiver has must survive");
  assert.equal(after.length, 4);
});

test("syncLibrary refuses a suspiciously small source and writes nothing", async () => {
  const src = await seed("src", ["only.pro"]);
  const dst = await seed("dst", ["a.pro", "b.pro", "c.pro"]);
  const r = await syncLibrary({ sourceDir: src, destDir: dst, minimumFiles: 50 });

  assert.equal(r.ok, false);
  assert.match(r.reason, /safety floor/);
  assert.equal((await listLibraryFiles(dst)).length, 3, "the good copy is untouched");
});

test("syncLibrary backs up a file before replacing it", async () => {
  const src = await seed("src", ["song.pro"], "NEW");
  const dst = await seed("dst", ["song.pro"], "OLD");
  const backup = join(dir, "backup", "2026-08-23");

  const r = await syncLibrary({ sourceDir: src, destDir: dst, backupDir: backup, minimumFiles: 1 });

  assert.deepEqual(r.replaced, ["song.pro"]);
  assert.deepEqual(r.backedUp, ["song.pro"]);
  assert.match(await readFile(join(dst, "song.pro"), "utf-8"), /^NEW/, "destination took the new version");
  assert.match(await readFile(join(backup, "song.pro"), "utf-8"), /^OLD/, "previous version was preserved");
});

test("syncLibrary refuses when source and destination are the same folder", async () => {
  const d = await seed("same", ["a.pro", "b.pro"]);
  const r = await syncLibrary({ sourceDir: d, destDir: d, minimumFiles: 1 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /same folder/i);
});

test("syncLibrary leaves no temp files behind", async () => {
  const src = await seed("src", ["a.pro", "b.pro"]);
  const dst = join(dir, "dst");
  await syncLibrary({ sourceDir: src, destDir: dst, minimumFiles: 1 });
  const leftovers = (await readdir(dst)).filter((n) => n.includes("refrain-tmp"));
  assert.deepEqual(leftovers, [], "atomic copy must rename its temp file away");
});

test("a second sync copies nothing because everything is unchanged", async () => {
  const src = await seed("src", ["a.pro", "b.pro"]);
  const dst = join(dir, "dst");
  await syncLibrary({ sourceDir: src, destDir: dst, minimumFiles: 1 });
  const second = await syncLibrary({ sourceDir: src, destDir: dst, minimumFiles: 1 });
  assert.deepEqual(second.copied, []);
  assert.deepEqual(second.replaced, []);
  assert.equal(second.unchanged, 2, "identical contents are recognised, so nothing is re-copied");
});

// --- snapshots ---

test("takeSnapshot copies first time and hard-links unchanged files after", async () => {
  const src = await seed("src", ["a.pro", "b.pro"]);
  const snaps = join(dir, "snapshots");

  const first = await takeSnapshot({ sourceDir: src, snapshotsDir: snaps, now: new Date(2026, 7, 23, 9, 0, 0) });
  assert.equal(first.fileCount, 2);
  assert.equal(first.copied, 2);
  assert.equal(first.linked, 0);

  const second = await takeSnapshot({ sourceDir: src, snapshotsDir: snaps, now: new Date(2026, 7, 23, 10, 0, 0) });
  assert.equal(second.linked, 2, "unchanged files are hard-linked, not copied again");

  const a1 = await stat(join(snaps, first.name, "a.pro"));
  const a2 = await stat(join(snaps, second.name, "a.pro"));
  assert.equal(a1.ino, a2.ino, "same inode means the second snapshot cost no extra space");
});

test("takeSnapshot prunes only beyond the keep count", async () => {
  const src = await seed("src", ["a.pro"]);
  const snaps = join(dir, "snapshots");
  for (let h = 0; h < 4; h++) {
    await takeSnapshot({ sourceDir: src, snapshotsDir: snaps, keep: 2, now: new Date(2026, 7, 23, h, 0, 0) });
  }
  const kept = await listSnapshots(snaps);
  assert.equal(kept.length, 2, "oldest snapshots pruned down to the keep count");
  assert.deepEqual(kept, ["2026-08-23_020000", "2026-08-23_030000"]);
});

// --- path derivation ---

test("libraryDirFromPresentationPath takes the folder holding the presentation", () => {
  assert.equal(
    libraryDirFromPresentationPath("/Users/x/Library/Application Support/Vendor/Libraries/Songs/Song.pro"),
    "/Users/x/Library/Application Support/Vendor/Libraries/Songs"
  );
  assert.equal(libraryDirFromPresentationPath(null), null);
  assert.equal(libraryDirFromPresentationPath(""), null);
});

test("a same-size but different-content edit is still detected", () => {
  // Timestamps cannot be relied on and sizes collide, so content decides.
  const plan = planSync(
    [{ name: "song.pro", size: 100, hash: "new" }],
    [{ name: "song.pro", size: 100, hash: "old" }]
  );
  assert.deepEqual(plan.toReplace, ["song.pro"]);
  assert.deepEqual(plan.unchanged, []);
});

test("repeated syncs stay idempotent, so backups do not grow without bound", async () => {
  const src = await seed("src", ["a.pro", "b.pro", "c.pro"]);
  const dst = join(dir, "dst");
  const backup = join(dir, "backup");
  await syncLibrary({ sourceDir: src, destDir: dst, backupDir: backup, minimumFiles: 1 });
  for (let i = 0; i < 3; i++) {
    const r = await syncLibrary({ sourceDir: src, destDir: dst, backupDir: backup, minimumFiles: 1 });
    assert.deepEqual(r.copied, [], "nothing new on an unchanged run");
    assert.deepEqual(r.replaced, [], "nothing replaced on an unchanged run");
    assert.deepEqual(r.backedUp, [], "and so nothing is backed up on an unchanged run");
  }
});

test("two snapshots in the same second get separate folders", async () => {
  const src = await seed("src", ["a.pro"]);
  const snaps = join(dir, "snapshots");
  const sameMoment = new Date(2026, 7, 23, 9, 0, 0);
  const first = await takeSnapshot({ sourceDir: src, snapshotsDir: snaps, now: sameMoment });
  const second = await takeSnapshot({ sourceDir: src, snapshotsDir: snaps, now: sameMoment });
  assert.notEqual(first.name, second.name, "a second run must not write into the first's snapshot");
  assert.equal(second.name, `${first.name}-2`);
  assert.deepEqual(await listSnapshots(snaps), [first.name, second.name], "both are listed, so both can be pruned later");
});
