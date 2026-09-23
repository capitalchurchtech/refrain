import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicateNames } from "../server/search-index.js";

// From docs/ideas.md: "Songs/X.pro and Songs Archive/X.pro having the same
// document name is how at least one confusing situation arose here." The
// function takes a plain index object directly, so these build one by hand
// rather than going through a fixture cache file.

test("finds a name that appears in two different folders", () => {
  const index = {
    presentations: {
      "p-live": { name: "Amazing Grace", folder: "Songs" },
      "p-archived": { name: "Amazing Grace", folder: "Songs Archive" },
    },
  };
  const groups = findDuplicateNames(index);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Amazing Grace");
  assert.deepEqual(
    groups[0].entries.map((e) => e.folder).sort(),
    ["Songs", "Songs Archive"]
  );
});

test("the same name repeated within ONE folder is not reported", () => {
  // A library can legitimately have two presentations sharing a name without
  // the cross-library ambiguity this exists to catch.
  const index = {
    presentations: {
      a: { name: "Welcome", folder: "Songs" },
      b: { name: "Welcome", folder: "Songs" },
    },
  };
  assert.deepEqual(findDuplicateNames(index), []);
});

test("differs only by whitespace or case — still the same collision an operator would hit", () => {
  const index = {
    presentations: {
      a: { name: "Build My Life", folder: "Songs" },
      b: { name: "  build my life  ", folder: "Songs Archive" },
    },
  };
  const groups = findDuplicateNames(index);
  assert.equal(groups.length, 1, "trimmed/cased variants still collide");
});

test("a genuinely different name is not flagged", () => {
  const index = {
    presentations: {
      a: { name: "Build My Life", folder: "Songs" },
      b: { name: "Build My Life (Reprise)", folder: "Songs Archive" },
    },
  };
  assert.deepEqual(findDuplicateNames(index), []);
});

test("three-way collisions across three folders report every entry", () => {
  const index = {
    presentations: {
      a: { name: "Christmas Eve", folder: "Songs" },
      b: { name: "Christmas Eve", folder: "Songs Archive" },
      c: { name: "Christmas Eve", folder: "Christmas" },
    },
  };
  const groups = findDuplicateNames(index);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].entries.length, 3);
});

test("an untitled or empty name never collides with another empty name", () => {
  // Two presentations Refrain could not name should not be reported as
  // duplicates of each other -- that would just be noise pointing at nothing.
  const index = {
    presentations: {
      a: { name: "", folder: "Songs" },
      b: { name: null, folder: "Songs Archive" },
    },
  };
  assert.deepEqual(findDuplicateNames(index), []);
});

test("results are sorted by name, and tolerate a missing/empty index", () => {
  const index = {
    presentations: {
      z: { name: "Zion's Hill", folder: "Songs" },
      z2: { name: "Zion's Hill", folder: "Hymns" },
      a: { name: "Ancient Words", folder: "Songs" },
      a2: { name: "Ancient Words", folder: "Hymns" },
    },
  };
  const groups = findDuplicateNames(index);
  assert.deepEqual(
    groups.map((g) => g.name),
    ["Ancient Words", "Zion's Hill"]
  );
  assert.deepEqual(findDuplicateNames({ presentations: {} }), []);
  assert.deepEqual(findDuplicateNames(null), []);
  assert.deepEqual(findDuplicateNames(undefined), []);
});
