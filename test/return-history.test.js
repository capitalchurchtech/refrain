import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RETURN_HISTORY,
  sameSlide,
  pushReturnEntry,
  findReturnEntry,
} from "../server/return-history.js";

const slide = (id, index, name = null) => ({ presentationId: id, slideIndex: index, name });

test("a jump records where you were", () => {
  const h = pushReturnEntry([], slide("a", 3));
  assert.equal(h.length, 1);
  assert.equal(h[0].presentationId, "a");
});

test("newest first, so the bar shows the most recent place you left", () => {
  let h = [];
  h = pushReturnEntry(h, slide("a", 1));
  h = pushReturnEntry(h, slide("b", 2));
  assert.deepEqual(h.map((e) => e.presentationId), ["b", "a"]);
});

test("a second jump does not overwrite the first — this is the whole bug", () => {
  // The old single-slot pin lost the plan the moment you took a second tangent,
  // which is why Return "sometimes worked".
  let h = [];
  h = pushReturnEntry(h, slide("plan", 5));
  h = pushReturnEntry(h, slide("tangent", 0));
  assert.equal(h.length, 2);
  assert.equal(h.at(-1).presentationId, "plan", "the plan is still reachable");
});

test("revisiting a place moves it to the front rather than duplicating it", () => {
  // Bouncing between two slides must not fill all ten entries with those two.
  let h = [];
  h = pushReturnEntry(h, slide("a", 1));
  h = pushReturnEntry(h, slide("b", 2));
  h = pushReturnEntry(h, slide("a", 1));
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((e) => e.presentationId), ["a", "b"]);
});

test("a different slide of the same presentation is a different place", () => {
  let h = pushReturnEntry([], slide("a", 1));
  h = pushReturnEntry(h, slide("a", 2));
  assert.equal(h.length, 2);
});

test("the history is capped, dropping the oldest", () => {
  let h = [];
  for (let i = 0; i < MAX_RETURN_HISTORY + 5; i++) h = pushReturnEntry(h, slide("p", i));
  assert.equal(h.length, MAX_RETURN_HISTORY);
  assert.equal(h[0].slideIndex, MAX_RETURN_HISTORY + 4, "newest kept");
  assert.equal(h.at(-1).slideIndex, 5, "oldest dropped");
});

test("junk is ignored rather than stored, so the bar never offers a dead entry", () => {
  assert.deepEqual(pushReturnEntry([], null), []);
  assert.deepEqual(pushReturnEntry([], {}), []);
  assert.deepEqual(pushReturnEntry([], { presentationId: "a" }), []);
  assert.deepEqual(pushReturnEntry([], { presentationId: "a", slideIndex: "3" }), []);
  const existing = [slide("a", 1)];
  assert.equal(pushReturnEntry(existing, null).length, 1, "a bad entry does not clear the history");
});

test("a place stays in the history after it has been returned to", () => {
  // Returning stands the bar down; it does not erase where you were. A place
  // you went back to once is a place you may want again, and the pulldown reads
  // the history rather than the bar.
  let h = [];
  h = pushReturnEntry(h, slide("plan", 0));
  h = pushReturnEntry(h, slide("tangent", 0));
  // the server clears its pin flag; the history is untouched
  assert.deepEqual(h.map((e) => e.presentationId), ["tangent", "plan"]);
  assert.ok(findReturnEntry(h, "plan", 0), "still reachable after a return");
});

test("entries are found by value, not by position", () => {
  // The list can shift under the operator: another screen triggering a Go Live
  // unshifts an entry and moves every index by one. Position would return them
  // to the wrong place.
  const h = [slide("newest", 0), slide("wanted", 7), slide("older", 1)];
  const found = findReturnEntry(h, "wanted", 7);
  assert.equal(found.presentationId, "wanted");
  assert.equal(findReturnEntry(h, "wanted", 8), null, "same song, wrong slide, no match");
  assert.equal(findReturnEntry(h, "absent", 0), null);
});

test("findReturnEntry accepts a string index, since it arrives over HTTP", () => {
  const h = [slide("a", 4)];
  assert.equal(findReturnEntry(h, "a", "4")?.slideIndex, 4);
});

test("sameSlide is exact", () => {
  assert.ok(sameSlide(slide("a", 1), slide("a", 1)));
  assert.ok(!sameSlide(slide("a", 1), slide("a", 2)));
  assert.ok(!sameSlide(slide("a", 1), slide("b", 1)));
  assert.ok(!sameSlide(null, slide("a", 1)));
});
