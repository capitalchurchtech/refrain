import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fileFingerprint,
  readFingerprint,
  sameBuildOptions,
  planIncremental,
  fingerprintTargets,
  readFingerprintUnchangedSince,
  carriedEntryFields,
} from "../server/index-fingerprint.js";

const SCHEMA = 3;

// A previous index holding one carried-over-able presentation.
function previousIndex(overrides = {}) {
  return {
    builtAt: "2026-08-22T20:15:25.000Z",
    schemaVersion: SCHEMA,
    buildOptions: { preferredArrangements: ["FS", "T"], crawlPlaylists: false },
    presentations: {
      song1: {
        name: "Build My Life",
        slides: [{ index: 0, text: "holy", groupId: "g1", groupOffset: 0 }],
        groupSequence: ["Verse 1"],
        arrangementName: "FS",
        arrangementId: "arr-fs",
        arrangementSource: "preferred",
        createdDate: "2025-01-01T00:00:00.000Z",
        modifiedDate: "2025-01-02T00:00:00.000Z",
        presentationPath: "/Libraries/Songs/Build My Life.pro",
        fingerprint: "100:1700000000000:abc",
      },
    },
    ...overrides,
  };
}

// --- fileFingerprint ---

test("fileFingerprint is size and mtime — metadata only, never contents", () => {
  // Refrain does not open presentation files. stat() reads the directory entry
  // and the body is never touched, so ProPresenter is never competing with
  // Refrain for a handle on a document it may be writing.
  assert.equal(fileFingerprint({ size: 100, mtimeMs: 1700000000000 }), "100:1700000000000");
});

test("fileFingerprint rounds sub-millisecond mtimes", () => {
  // The filesystem keeps nanoseconds while Node reports fractional ms. Left
  // unrounded, a file could fingerprint differently on two reads and re-index
  // forever — the same trap that broke mtime comparison in library-sync.
  const a = fileFingerprint({ size: 5, mtimeMs: 1700000000000.4 });
  const b = fileFingerprint({ size: 5, mtimeMs: 1700000000000.0 });
  assert.equal(a, b);
});

test("a same-size same-mtime edit is NOT detected, and that is the trade", async () => {
  // Documenting a deliberate limitation rather than deleting the test that
  // used to cover it.
  //
  // Content hashing caught this, at the cost of reading all 445 library files
  // in full on every incremental reindex. Refrain touching library files is
  // what corrupted three of this church's workspaces, so the reads went. The
  // hole hashing closed was created by Library Sync back-dating mtimes, and
  // that back-dating is gone too — a synced-in file now carries the time it
  // actually arrived, which a plain mtime comparison sees.
  //
  // What remains uncovered needs someone to restore a timestamp deliberately
  // onto a same-size edit. If that ever becomes real, the fix is a full
  // rebuild, not resuming whole-file reads.
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-fp-"));
  try {
    const file = path.join(dir, "song.pro");
    const when = new Date("2026-01-01T00:00:00Z");

    await writeFile(file, "AAAA");
    await utimes(file, when, when);
    const before = await readFingerprint(file);

    await writeFile(file, "BBBB"); // same 4 bytes
    await utimes(file, when, when); // and the timestamp put back by hand
    const after = await readFingerprint(file);

    assert.equal(after, before, "metadata cannot see it, by design");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readFingerprint is stable across repeated reads of an untouched file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-fp-"));
  try {
    const file = path.join(dir, "song.pro");
    await writeFile(file, "unchanged");
    assert.equal(await readFingerprint(file), await readFingerprint(file));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readFingerprint returns null for a missing file, a directory, or no path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-fp-"));
  try {
    assert.equal(await readFingerprint(path.join(dir, "nope.pro")), null);
    assert.equal(await readFingerprint(dir), null);
    assert.equal(await readFingerprint(null), null);
    assert.equal(await readFingerprint(""), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- sameBuildOptions ---

test("sameBuildOptions treats preferred-arrangement order as significant", () => {
  // ["FS","T"] and ["T","FS"] disagree on which wins for a song holding both,
  // so the slide order indexed differs even though no file changed.
  const a = { preferredArrangements: ["FS", "T"], crawlPlaylists: false };
  assert.ok(sameBuildOptions(a, { preferredArrangements: ["FS", "T"], crawlPlaylists: false }));
  assert.ok(!sameBuildOptions(a, { preferredArrangements: ["T", "FS"], crawlPlaylists: false }));
  assert.ok(!sameBuildOptions(a, { preferredArrangements: ["FS"], crawlPlaylists: false }));
  assert.ok(!sameBuildOptions(a, { preferredArrangements: ["FS", "T"], crawlPlaylists: true }));
});

test("sameBuildOptions treats absent and empty as equivalent", () => {
  assert.ok(sameBuildOptions(undefined, { preferredArrangements: [], crawlPlaylists: false }));
  assert.ok(sameBuildOptions({}, {}));
});

// --- planIncremental ---

const opts = { preferredArrangements: ["FS", "T"], crawlPlaylists: false };

test("planIncremental carries over a presentation whose file is unchanged", () => {
  const plan = planIncremental({
    ids: ["song1"],
    previous: previousIndex(),
    fingerprints: { song1: "100:1700000000000:abc" },
    buildOptions: opts,
    schemaVersion: SCHEMA,
  });
  assert.equal(plan.mode, "incremental");
  assert.deepEqual(plan.needFetch, []);
  assert.equal(plan.counts.carriedOver, 1);
  assert.deepEqual(plan.carryOver.song1.slides, [{ index: 0, text: "holy", groupId: "g1", groupOffset: 0 }]);
  assert.equal(plan.carryOver.song1.arrangementName, "FS", "arrangement fields must survive the carry-over");
  assert.equal(plan.carryOver.song1.fingerprint, "100:1700000000000:abc");
});

test("planIncremental does not carry the listing-owned fields", () => {
  // name/folder/appearsIn come from this run's library listing, so a
  // presentation renamed or moved between folders must not keep the old ones.
  const plan = planIncremental({
    ids: ["song1"],
    previous: previousIndex(),
    fingerprints: { song1: "100:1700000000000:abc" },
    buildOptions: opts,
    schemaVersion: SCHEMA,
  });
  assert.equal(plan.carryOver.song1.name, undefined);
  assert.equal(plan.carryOver.song1.folder, undefined);
  assert.equal(plan.carryOver.song1.appearsIn, undefined);
});

test("planIncremental re-fetches a changed file", () => {
  const plan = planIncremental({
    ids: ["song1"],
    previous: previousIndex(),
    fingerprints: { song1: "100:1700000000000:DIFFERENT" },
    buildOptions: opts,
    schemaVersion: SCHEMA,
  });
  assert.deepEqual(plan.needFetch, ["song1"]);
  assert.equal(plan.counts.changed, 1);
  assert.equal(plan.carryOver.song1, undefined);
});

test("planIncremental fetches ids the previous index never had", () => {
  const plan = planIncremental({
    ids: ["song1", "brandNew"],
    previous: previousIndex(),
    fingerprints: { song1: "100:1700000000000:abc" },
    buildOptions: opts,
    schemaVersion: SCHEMA,
  });
  assert.deepEqual(plan.needFetch, ["brandNew"]);
  assert.equal(plan.counts.added, 1);
  assert.equal(plan.counts.carriedOver, 1);
});

test("planIncremental drops ids no longer in the library by simply omitting them", () => {
  const plan = planIncremental({
    ids: [],
    previous: previousIndex(),
    fingerprints: {},
    buildOptions: opts,
    schemaVersion: SCHEMA,
  });
  assert.deepEqual(plan.carryOver, {});
  assert.deepEqual(plan.needFetch, []);
});

test("planIncremental re-fetches when the file cannot be read", () => {
  // Deleted, moved, or a volume that went away — never silently keep slides
  // we can no longer vouch for.
  const plan = planIncremental({
    ids: ["song1"],
    previous: previousIndex(),
    fingerprints: { song1: null },
    buildOptions: opts,
    schemaVersion: SCHEMA,
  });
  assert.deepEqual(plan.needFetch, ["song1"]);
  assert.equal(plan.counts.unverifiable, 1);
});

test("planIncremental re-fetches entries indexed before fingerprinting existed", () => {
  const previous = previousIndex();
  delete previous.presentations.song1.fingerprint;
  const plan = planIncremental({
    ids: ["song1"],
    previous,
    fingerprints: { song1: "100:1700000000000:abc" },
    buildOptions: opts,
    schemaVersion: SCHEMA,
  });
  assert.deepEqual(plan.needFetch, ["song1"]);
  assert.equal(plan.counts.unverifiable, 1);
});

test("planIncremental falls back to a full rebuild when there is no previous index", () => {
  for (const previous of [null, undefined, {}, { builtAt: null }]) {
    const plan = planIncremental({ ids: ["song1"], previous, buildOptions: opts, schemaVersion: SCHEMA });
    assert.equal(plan.mode, "full");
    assert.match(plan.reason, /no previous index/);
  }
});

test("planIncremental falls back to a full rebuild on a schema change", () => {
  const plan = planIncremental({
    ids: ["song1"],
    previous: previousIndex({ schemaVersion: 2 }),
    fingerprints: { song1: "100:1700000000000:abc" },
    buildOptions: opts,
    schemaVersion: SCHEMA,
  });
  assert.equal(plan.mode, "full");
  assert.match(plan.reason, /older version/);
});

test("planIncremental falls back to a full rebuild when preferred arrangements changed", () => {
  // The decisive case: no file changed, but every song holding both FS and T
  // would now index a different slide order. Carrying entries over would
  // leave the index a mix of two arrangements.
  const plan = planIncremental({
    ids: ["song1"],
    previous: previousIndex(),
    fingerprints: { song1: "100:1700000000000:abc" },
    buildOptions: { preferredArrangements: ["T", "FS"], crawlPlaylists: false },
    schemaVersion: SCHEMA,
  });
  assert.equal(plan.mode, "full");
  assert.match(plan.reason, /settings changed/);
});

test("planIncremental falls back to a full rebuild when playlist crawling is switched on", () => {
  const plan = planIncremental({
    ids: ["song1"],
    previous: previousIndex(),
    fingerprints: { song1: "100:1700000000000:abc" },
    buildOptions: { preferredArrangements: ["FS", "T"], crawlPlaylists: true },
    schemaVersion: SCHEMA,
  });
  assert.equal(plan.mode, "full");
});

// --- fingerprintTargets ---

test("fingerprintTargets only lists ids with a known file path", () => {
  const previous = previousIndex();
  previous.presentations.noPath = { name: "Remote", slides: [] };
  assert.deepEqual(fingerprintTargets({ ids: ["song1", "noPath", "unknown"], previous }), [
    { id: "song1", path: "/Libraries/Songs/Build My Life.pro" },
  ]);
});

test("fingerprintTargets is empty with no previous index", () => {
  assert.deepEqual(fingerprintTargets({ ids: ["song1"], previous: null }), []);
});

// --- readFingerprintUnchangedSince ---

test("readFingerprintUnchangedSince accepts a file written just before the cutoff", async () => {
  // Date.now() is whole milliseconds and mtimeMs is fractional, so an
  // unfloored comparison makes a file written a fraction of a millisecond
  // earlier look like it was saved mid-fetch — which made every presentation
  // unverifiable and every reindex a full re-read.
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-fp-"));
  try {
    const file = path.join(dir, "song.pro");
    await writeFile(file, "written first");
    const cutoff = Date.now();
    assert.notEqual(await readFingerprintUnchangedSince(file, cutoff), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readFingerprintUnchangedSince refuses a file saved after the cutoff", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-fp-"));
  try {
    const file = path.join(dir, "song.pro");
    await writeFile(file, "original");
    const cutoff = Date.now() - 60_000; // pretend the fetch began a minute ago
    assert.equal(await readFingerprintUnchangedSince(file, cutoff), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readFingerprintUnchangedSince returns null for a missing file or no path", async () => {
  assert.equal(await readFingerprintUnchangedSince(null, Date.now()), null);
  assert.equal(await readFingerprintUnchangedSince("/nope/missing.pro", Date.now()), null);
});

// --- carriedEntryFields ---

test("carriedEntryFields copies the reusable fields and nothing else", () => {
  const carried = carriedEntryFields({
    slides: [{ index: 0, text: "holy" }],
    arrangementName: "FS",
    fingerprint: "1:2:abc",
    name: "Build My Life",
    folder: "Songs",
    appearsIn: ["p1"],
  });
  assert.deepEqual(Object.keys(carried).sort(), ["arrangementName", "fingerprint", "slides"]);
});

test("carriedEntryFields handles a missing previous entry", () => {
  assert.deepEqual(carriedEntryFields(undefined), {});
  assert.deepEqual(carriedEntryFields(null), {});
});
