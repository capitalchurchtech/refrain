import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, findTypos } from "../server/spellcheck.js";

// A stand-in for nspell: every word is "correct" except the ones in `typos`.
// suggest() returns a deterministic single suggestion so we can assert on it.
function fakeSpeller(typos) {
  const bad = new Set(typos.map((w) => w.toLowerCase()));
  return {
    correct: (w) => !bad.has(String(w).toLowerCase()),
    suggest: (w) => [`${w}!`],
  };
}

test("tokenize keeps words of length >= 2 and drops shorter tokens", () => {
  assert.deepEqual(tokenize("O God is good"), ["God", "is", "good"]);
});

test("tokenize keeps internal apostrophes but trims edge ones", () => {
  assert.deepEqual(tokenize("'Tis o'er, don't"), ["Tis", "o'er", "don't"]);
});

test("tokenize ignores digits and punctuation-only tokens", () => {
  // "24/7" has no leading letter on either side of length >= 2
  assert.deepEqual(tokenize("sing 24/7 loud"), ["sing", "loud"]);
});

test("tokenize keeps accented letters", () => {
  assert.deepEqual(tokenize("café résumé"), ["café", "résumé"]);
});

test("findTypos flags only genuine typos, sparing vocab and allowlist", () => {
  const knownWords = new Set(["yahweh", "hallelujah", "hosanna"]);
  const allowlist = new Set(["reckless"]);
  const speller = fakeSpeller(["amazng", "forevr"]);
  const text = "Your reckless love O Yahweh hallelujah Your grace is amazng and Hosanna forevr";

  const flagged = findTypos(text, { knownWords, allowlist, speller });

  assert.deepEqual(
    flagged.map((f) => f.word),
    ["amazng", "forevr"],
    "only the real typos should be flagged"
  );
  assert.deepEqual(flagged[0].suggestions, ["amazng!"]);
});

test("findTypos dedupes a repeated typo case-insensitively", () => {
  const speller = fakeSpeller(["teh"]);
  const flagged = findTypos("teh cat and Teh dog and TEH bird", {
    knownWords: new Set(),
    allowlist: new Set(),
    speller,
  });
  assert.equal(flagged.length, 1, "the same typo should be reported once");
  assert.equal(flagged[0].word, "teh");
});

test("findTypos returns at most four suggestions", () => {
  const speller = {
    correct: () => false,
    suggest: () => ["a", "b", "c", "d", "e", "f"],
  };
  const flagged = findTypos("wrongword", { knownWords: new Set(), allowlist: new Set(), speller });
  assert.equal(flagged[0].suggestions.length, 4);
});
