import test from "node:test";
import assert from "node:assert/strict";
import { parseSlideIndex } from "../server/arrangements.js";

test("real slide indices are accepted, including zero", () => {
  // Slide 0 is the first slide of every song, so it must not read as missing.
  assert.equal(parseSlideIndex(0), 0);
  assert.equal(parseSlideIndex(12), 12);
  assert.equal(parseSlideIndex("0"), 0);
  assert.equal(parseSlideIndex(" 7 "), 7);
});

test("null, empty string and [] are rejected rather than coerced to slide 0", () => {
  // The trap this exists for: Number(null), Number("") and Number([]) are all
  // 0, so a caller whose slide index was simply missing would have fired the
  // first slide of the song and looked like it worked.
  for (const bad of [null, undefined, "", "   ", [], {}, true, false]) {
    assert.equal(parseSlideIndex(bad), null, `${JSON.stringify(bad)} must be rejected`);
  }
});

test("not-a-number, fractional and negative are rejected", () => {
  for (const bad of ["abc", NaN, Infinity, -Infinity, 3.7, -1, "-1", "3.7", "1e3", "0x10"]) {
    assert.equal(parseSlideIndex(bad), null, `${String(bad)} must be rejected`);
  }
});

test("a huge but whole index is still a number, not a rejection", () => {
  // Refusing large values would be inventing a library-size limit the API
  // does not have; ProPresenter answers for what it has.
  assert.equal(parseSlideIndex(99999), 99999);
});
