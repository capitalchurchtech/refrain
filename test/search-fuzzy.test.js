import { test } from "node:test";
import assert from "node:assert/strict";
import { editDistance, correctQuery } from "../server/search-index.js";

// A small library vocabulary: word -> how often it appears.
const words = new Map(
  Object.entries({ oceans: 12, where: 30, feet: 8, may: 40, fail: 9, goodness: 20, of: 300, god: 150, way: 60, maker: 15, amazing: 10, grace: 25, great: 40, is: 400, thy: 50, faithfulness: 18, the: 900, holy: 30, spirit: 28, heart: 20, hear: 22 })
);

test("edit distance counts a swapped pair of letters as one slip", () => {
  assert.equal(editDistance("ocenas", "oceans"), 1);
  assert.equal(editDistance("goodnes", "goodness"), 1);
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("abc", "abcdefgh", 2), 3, "gives up early past the limit");
});

test("unknown words become the library's nearest word; known words are left alone", () => {
  assert.equal(correctQuery("ocenas", words), "oceans");
  assert.equal(correctQuery("goodnes of god", words), "goodness of god");
  assert.equal(correctQuery("great is thy faithfullness", words), "great is thy faithfulness", "two slips allowed on a long word");
  assert.equal(correctQuery("amazing grace", words), null, "nothing to correct");
});

test("a word run together is split into two the library has, even when a two-slip word exists", () => {
  const withRival = new Map([...words, ["hatmaker", 1]]);
  assert.equal(correctQuery("waymaker", withRival), "way maker");
  assert.equal(correctQuery("waymaker", words), "way maker");
});

test("ties go to the word the library uses more, and short or hopeless words are left as typed", () => {
  // "heat" is one edit from both "heart" (20) and "hear" (22): the commoner wins.
  assert.equal(correctQuery("heat", words), "hear");
  assert.equal(correctQuery("xq", words), null);
  assert.equal(correctQuery("zzzzzzzz", words), null);
  assert.equal(correctQuery("", words), null);
});
