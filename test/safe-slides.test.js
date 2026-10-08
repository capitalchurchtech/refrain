import { test } from "node:test";
import assert from "node:assert/strict";
import { addSafeSlide, removeSafeSlide, renameSafeSlide, moveSafeSlide, safeSlides, defaultLabel, MAX_SAFE_SLIDES } from "../server/safe-slides.js";

const slide = (n, extra = {}) => ({ presentationId: `P${n}`, presentationName: `Deck ${n}`, slideIndex: 0, groupId: `G${n}`, groupOffset: 0, slideText: `Welcome ${n}`, ...extra });

test("a safe slide is stored by its anchor, labelled from its own text", () => {
  const { list, added } = addSafeSlide([], slide(1), { id: "a" });
  assert.equal(list.length, 1);
  assert.equal(added.label, "Welcome 1");
  assert.equal(added.groupId, "G1");
  assert.equal(defaultLabel({ slideText: "", presentationName: "Logo Loop", slideIndex: 2 }), "Logo Loop, slide 3", "a slide with no words is named from the deck");
});

test("the same slide added twice is one safe slide", () => {
  let { list } = addSafeSlide([], slide(1), { id: "a" });
  const again = addSafeSlide(list, slide(1, { slideIndex: 5 }), { id: "b" });
  assert.equal(again.list.length, 1, "same anchor, even at a different index");
  assert.equal(again.added.id, "a");
});

test("a full list says so rather than dropping the slide", () => {
  let list = [];
  for (let i = 0; i < MAX_SAFE_SLIDES; i++) list = addSafeSlide(list, slide(i), { id: `id${i}` }).list;
  const r = addSafeSlide(list, slide(99), { id: "x" });
  assert.equal(r.list.length, MAX_SAFE_SLIDES);
  assert.match(r.error, /already 4 safe slides/);
});

test("bad input is refused, and rename, remove and reorder work", () => {
  assert.ok(addSafeSlide([], { presentationId: "" }).error);
  assert.ok(addSafeSlide([], { presentationId: "P", slideIndex: -1 }).error);
  let list = [slide(1), slide(2), slide(3)].reduce((l, s, i) => addSafeSlide(l, s, { id: String(i) }).list, []);
  list = renameSafeSlide(list, "1", "  Logo   ");
  assert.equal(list[1].label, "Logo");
  assert.equal(renameSafeSlide(list, "1", "   ")[1].label, "Logo", "a blank name keeps the old one");
  list = moveSafeSlide(list, "2", -1);
  assert.deepEqual(list.map((s) => s.id), ["0", "2", "1"]);
  assert.deepEqual(moveSafeSlide(list, "0", -1).map((s) => s.id), ["0", "2", "1"], "the first can't move earlier");
  assert.deepEqual(removeSafeSlide(list, "2").map((s) => s.id), ["0", "1"]);
  assert.deepEqual(safeSlides([{ junk: true }, null]), []);
});

test("a list saved when eight were allowed is still read whole, and cannot grow", () => {
  const legacy = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, presentationId: `P${i}`, slideIndex: 0, label: `Slide ${i}` }));
  assert.equal(safeSlides(legacy).length, 6, "nothing is trimmed behind anyone's back");
  assert.match(addSafeSlide(legacy, slide(99), { id: "x" }).error, /already 4/);
  assert.equal(removeSafeSlide(legacy, "s0").length, 5, "but they can be removed");
});
