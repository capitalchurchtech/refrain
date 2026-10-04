import { test } from "node:test";
import assert from "node:assert/strict";
import { quickSlidesView } from "../public/quick-slides.js";

const slide = (n) => ({ id: `s${n}`, label: `Slide ${n}`, presentationId: "p", slideIndex: n });

test("the menu shows the first four safe slides and counts the rest", () => {
  const list = [1, 2, 3, 4, 5, 6].map(slide);
  const view = quickSlidesView(list);
  assert.deepEqual(view.shown.map((s) => s.id), ["s1", "s2", "s3", "s4"]);
  assert.equal(view.more, 2);
});

test("fewer than four: all shown, nothing more", () => {
  const view = quickSlidesView([slide(1), slide(2)]);
  assert.equal(view.shown.length, 2);
  assert.equal(view.more, 0);
});

test("no list, or not a list, shows nothing rather than throwing", () => {
  for (const v of [undefined, null, {}, "x"]) assert.deepEqual(quickSlidesView(v), { shown: [], more: 0 });
});
