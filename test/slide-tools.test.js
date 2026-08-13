import { test } from "node:test";
import assert from "node:assert/strict";
import { stripInvisible, cleanText, groupRepeats, splitterLabel } from "../public/slide-tools.js";

test("stripInvisible removes zero-width, BOM, and control chars; NBSP -> space", () => {
  // Built from char codes so no literal invisible characters live in the test.
  const zwsp = String.fromCharCode(0x200b);
  const bom = String.fromCharCode(0xfeff);
  const nbsp = String.fromCharCode(0x00a0);
  const bell = String.fromCharCode(0x0007);
  const raw = `For${zwsp}God${nbsp}so${bell} loved${bom}`;
  assert.equal(stripInvisible(raw), "ForGod so loved");
});

test("stripInvisible keeps newlines and tabs", () => {
  assert.equal(stripInvisible("a\nb\tc"), "a\nb\tc");
});

test("cleanText straightens curly quotes, dashes, and ellipsis when asked", () => {
  const input = String.fromCharCode(0x201c) + "Jesus" + String.fromCharCode(0x2019) + " love" + String.fromCharCode(0x201d) + " " + String.fromCharCode(0x2014) + " amazing" + String.fromCharCode(0x2026);
  assert.equal(cleanText(input, true), '"Jesus\' love" - amazing...');
});

test("cleanText leaves curly punctuation alone when straighten is off", () => {
  const curly = String.fromCharCode(0x201c) + "hi" + String.fromCharCode(0x201d);
  assert.equal(cleanText(curly, false), curly);
});

test("cleanText collapses runs of spaces and blank lines and trims edges", () => {
  assert.equal(cleanText("\n\nline   one\n\n\n\nline  two  \n\n", false), "line one\n\nline two");
});

test("cleanText preserves accented letters", () => {
  assert.equal(cleanText("café", true), "café");
});

test("groupRepeats labels unique blocks and records play order", () => {
  const { unique, order } = groupRepeats(["Chorus", "Verse", "chorus", "Verse"]);
  assert.deepEqual(
    unique.map((u) => `${u.label}:${u.count}`),
    ["A:2", "B:2"]
  );
  assert.deepEqual(order, ["A", "B", "A", "B"]);
});

test("groupRepeats treats one-word-different blocks as distinct", () => {
  const { unique } = groupRepeats(["Holy is he", "Holy is she"]);
  assert.equal(unique.length, 2);
});

test("splitterLabel humanizes a kebab-case id", () => {
  assert.equal(splitterLabel("blank-line-delimited"), "Blank Line Delimited");
});
