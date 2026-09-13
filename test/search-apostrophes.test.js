import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIndexFromDisk, search, foldApostrophes, unifyApostrophes } from "../server/search-index.js";

// Same fixture shape as search-collapse.test.js, and set up at module scope for
// the same reason: on Node 20 a top-level `before` runs after the test bodies,
// which would silently search the real index instead of this one.
const origCwd = process.cwd();
const dir = await mkdtemp(join(tmpdir(), "refrain-apos-"));
process.chdir(dir);
await mkdir("cache", { recursive: true });
await writeFile(
  join("cache", "search-index.json"),
  JSON.stringify({
    schemaVersion: 2,
    builtAt: new Date().toISOString(),
    presentations: {
      "pres-1": {
        name: "Apostrophe Fixture",
        folder: "Songs",
        appearsIn: [],
        createdDate: null,
        modifiedDate: null,
        arrangementName: "FS",
        arrangementId: "arr-fs",
        arrangementSource: "preferred",
        slides: [
          // A straight apostrophe, as ProPresenter's own editor produces.
          { index: 0, text: "I've been set free", groupId: "g-v", groupOffset: 0 },
          // The curly one, as it arrives from a word processor via paste.
          { index: 1, text: "You\u2019re still good", groupId: "g-c", groupOffset: 0 },
          // No apostrophe at all, to prove the fold works in both directions.
          { index: 2, text: "wont let go", groupId: "g-b", groupOffset: 0 },
          // Two in one line, one of them a possessive rather than a contraction.
          { index: 3, text: "the Lord's mercy doesn't end", groupId: "g-v2", groupOffset: 0 },
          // Elision, where the apostrophe stands in for dropped letters at the
          // end of a word rather than inside it -- hymn text is full of these.
          { index: 4, text: "o'er and o'er", groupId: "g-h", groupOffset: 0 },
          // A curly opening quote, which is U+2018 doing a job that is not an
          // apostrophe at all. Folding it is harmless; mangling the line is not.
          { index: 5, text: "he said \u2018come and see\u2019 to them", groupId: "g-q", groupOffset: 0 },
          // Line starts with the contraction, so a match sits at offset 0.
          { index: 6, text: "'tis mercy all", groupId: "g-s", groupOffset: 0 },
          // Mixed case, to keep the case-insensitive path honest alongside it.
          { index: 7, text: "HE\u2019S RISEN INDEED", groupId: "g-u", groupOffset: 0 },
        ],
      },
    },
  })
);
await loadIndexFromDisk();

after(async () => {
  process.chdir(origCwd);
  await rm(dir, { recursive: true, force: true });
});

test("foldApostrophes removes straight, curly and modifier-letter forms", () => {
  assert.equal(foldApostrophes("I've"), "Ive");
  assert.equal(foldApostrophes("You\u2019re"), "Youre");
  assert.equal(foldApostrophes("can\u02BCt"), "cant");
  assert.equal(foldApostrophes("no punctuation here"), "no punctuation here");
  assert.equal(foldApostrophes(null), "");
});

test("unifyApostrophes maps the curly forms onto the straight one", () => {
  assert.equal(unifyApostrophes("You\u2019re"), "You're");
  assert.equal(unifyApostrophes("can\u02BCt"), "can't");
  assert.equal(unifyApostrophes("I've"), "I've");
});

test("a dropped apostrophe still matches the lyric that has one", () => {
  assert.equal(search({ query: "ive been set free" }).length, 1);
  assert.equal(search({ query: "youre still good" }).length, 1);
});

test("curly and straight are the same character as far as a search is concerned", () => {
  assert.equal(search({ query: "I\u2019ve been" }).length, 1, "curly typed, straight stored");
  assert.equal(search({ query: "You're still" }).length, 1, "straight typed, curly stored");
});

test("a typed apostrophe is taken literally, so it does not widen the search", () => {
  // The one-way fold. Forgiving this direction too would make "i've" match
  // "give" and "important" -- 1,599 results against the real library where 56
  // were wanted.
  assert.equal(search({ query: "won't let go" }).length, 0);
});

test("exact matches are unaffected", () => {
  const [r] = search({ query: "I've been" });
  assert.equal(r.snippet, "I've been set free");
  assert.equal(search({ query: "wont let go" }).length, 1);
});

test("folding does not make unrelated words match", () => {
  assert.equal(search({ query: "ivy been set free" }).length, 0);
  assert.equal(search({ query: "wonts let go" }).length, 0);
});

test("a possessive is forgiven the same as a contraction", () => {
  assert.equal(search({ query: "lords mercy" }).length, 1);
});

test("two apostrophes in one line both fold", () => {
  assert.equal(search({ query: "lords mercy doesnt end" }).length, 1);
});

test("elision at the end of a word folds too", () => {
  // "o'er" is not a contraction of two words, and a rule written around
  // "don't" would miss it. The fold is about the character, not the grammar.
  assert.equal(search({ query: "oer and oer" }).length, 1);
});

test("a curly opening quote is not an apostrophe, and folding it is still safe", () => {
  // U+2018 opening a quotation is the same codepoint as a curly apostrophe, so
  // a quotation mark folds away too. That is fine, and the reason is the space:
  // removing the mark from "said \u2018come" leaves "said come", not "saidcome".
  // Words only ever weld when the mark sits between two letters -- which is
  // precisely the contraction this is for.
  assert.equal(search({ query: "come and see" }).length, 1);
  assert.equal(search({ query: "said come" }).length, 1, "reading across a stripped quote mark");
  assert.equal(search({ query: "andsee" }).length, 0, "nothing welds across a space");
  assert.equal(search({ query: "seeto" }).length, 0);
});

test("a match at the very start of a line", () => {
  assert.equal(search({ query: "tis mercy" }).length, 1);
});

test("folding is case-insensitive on both sides", () => {
  assert.equal(search({ query: "hes risen" }).length, 1);
  assert.equal(search({ query: "HES RISEN" }).length, 1);
  assert.equal(search({ query: "He\u2019s Risen" }).length, 1);
});

test("a query that is nothing but punctuation does not match everything", () => {
  // "'" unified and left literal: it should find the lines that actually have
  // one, not every line in the library.
  const hits = search({ query: "'" }).length;
  assert.ok(hits > 0 && hits < 8, `expected some but not all lines, got ${hits}`);
});

test("an empty query still returns nothing", () => {
  assert.equal(search({ query: "" }).length, 0);
  assert.equal(search({ query: "   " }).length, 0);
});

test("surrounding whitespace and doubled spaces are normalized away", () => {
  assert.equal(search({ query: "  ive been  " }).length, 1);
  assert.equal(search({ query: "ive  been" }).length, 1, "a doubled space still matches");
});
