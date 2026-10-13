import { test } from "node:test";
import assert from "node:assert/strict";
import { delimiterNames, isDelimiterName, delimiterOnScreen, rescanDue, DELIMITER_QUIET_MS } from "../server/delimiter.js";

const open = (extra = {}) => ({ id: "k1", presentationId: "S", name: "Scrolling Slides", startMs: 0, endMs: null, delimiter: true, ...extra });

test("nothing is a delimiter until a church lists one; a name or the start of one matches, in any case", () => {
  assert.equal(isDelimiterName("Scrolling Slides", []), false);
  assert.equal(isDelimiterName("Scrolling Slides", undefined), false);
  assert.equal(isDelimiterName("Scrolling Slides", ["Scrolling Slides"]), true);
  assert.equal(isDelimiterName("scrolling slides 2026-10-10", ["Scrolling Slides"]), true, "a dated copy still starts with it");
  assert.equal(isDelimiterName("Washed - [ T ]", ["Scrolling Slides"]), false);
  assert.equal(isDelimiterName("", ["Scrolling Slides"]), false);
  assert.deepEqual(delimiterNames([" A ", "", 7, null, "B"]), ["A", "B"]);
});

test("the light refresh waits until the delimiter has been up five minutes, and runs once per stay", () => {
  assert.equal(rescanDue(open(), DELIMITER_QUIET_MS - 1), false, "not yet: a quick flick through is not an intermission");
  assert.equal(rescanDue(open(), DELIMITER_QUIET_MS), true);
  assert.equal(rescanDue(open(), DELIMITER_QUIET_MS + 1, "k1"), false, "already done for this stay");
  assert.equal(rescanDue(open({ id: "k2" }), DELIMITER_QUIET_MS + 1, "k1"), true, "a new stay is a new chance");
});

test("it is never due for an ordinary item, a closed stay, or while the screens are clear", () => {
  const late = DELIMITER_QUIET_MS * 3;
  assert.equal(rescanDue(open({ delimiter: false }), late), false);
  assert.equal(rescanDue(open({ delimiter: undefined }), late), false);
  assert.equal(rescanDue(open({ endMs: 5 }), late), false);
  assert.equal(rescanDue(open({ blankSince: 1000 }), late), false, "cleared for a moment: not on the screens");
  assert.equal(rescanDue(null, late), false);
  assert.equal(delimiterOnScreen(open()), true);
});
