import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSlides, isServiceDay } from "../server/search-index.js";
import { normalizeText } from "../server/propresenter-client.js";

test("normalizeText collapses newlines and runs of whitespace", () => {
  assert.equal(normalizeText("line one\n\n  line   two\t"), "line one line two");
});

test("normalizeText tolerates null/undefined", () => {
  assert.equal(normalizeText(null), "");
  assert.equal(normalizeText(undefined), "");
});

test("extractSlides indexes groups in document order when no arrangement is active", () => {
  const doc = {
    presentation: {
      current_arrangement: "",
      groups: [
        { uuid: "g1", slides: [{ text: "one" }, { text: "two" }] },
        { uuid: "g2", slides: [{ text: "three" }] },
      ],
    },
  };
  assert.deepEqual(extractSlides(doc), [
    { index: 0, text: "one", groupId: "g1", groupOffset: 0 },
    { index: 1, text: "two", groupId: "g1", groupOffset: 1 },
    { index: 2, text: "three", groupId: "g2", groupOffset: 0 },
  ]);
});

test("extractSlides follows the active arrangement's group order", () => {
  const doc = {
    presentation: {
      current_arrangement: "arr1",
      arrangements: [{ id: { uuid: "arr1" }, groups: ["g2", "g1"] }],
      groups: [
        { uuid: "g1", slides: [{ text: "verse" }] },
        { uuid: "g2", slides: [{ text: "chorus" }] },
      ],
    },
  };
  // Arrangement plays g2 then g1, and the flat index must follow that order
  // (this is the index Go Live triggers on).
  assert.deepEqual(extractSlides(doc), [
    { index: 0, text: "chorus", groupId: "g2", groupOffset: 0 },
    { index: 1, text: "verse", groupId: "g1", groupOffset: 0 },
  ]);
});

test("extractSlides normalizes slide text and tolerates missing slides", () => {
  const doc = {
    presentation: {
      current_arrangement: "",
      groups: [{ uuid: "g1", slides: [{ text: "multi\nline  text" }] }, { uuid: "g2" }],
    },
  };
  assert.deepEqual(extractSlides(doc), [{ index: 0, text: "multi line text", groupId: "g1", groupOffset: 0 }]);
});

test("extractSlides returns nothing for an empty document", () => {
  assert.deepEqual(extractSlides({}), []);
  assert.deepEqual(extractSlides(null), []);
});

test("extractSlides honors a preferred arrangement over the selected one", () => {
  const doc = {
    presentation: {
      current_arrangement: "arr-short",
      arrangements: [
        { id: { uuid: "arr-fs", name: "FS" }, groups: ["g1", "g2"] },
        { id: { uuid: "arr-short", name: "Short" }, groups: ["g2"] },
      ],
      groups: [
        { uuid: "g1", slides: [{ text: "verse" }] },
        { uuid: "g2", slides: [{ text: "chorus" }] },
      ],
    },
  };
  assert.deepEqual(
    extractSlides(doc, ["FS"]).map((s) => s.text),
    ["verse", "chorus"]
  );
  assert.deepEqual(
    extractSlides(doc).map((s) => s.text),
    ["chorus"],
    "with no preference it still follows ProPresenter's selection"
  );
});

test("isServiceDay covers Saturday and Sunday only", () => {
  // A rebuild must never kick off by itself on a service day.
  const day = (iso) => isServiceDay(new Date(iso));
  assert.equal(day("2026-08-22T10:00:00"), true, "Saturday");
  assert.equal(day("2026-08-23T10:00:00"), true, "Sunday");
  assert.equal(day("2026-08-24T10:00:00"), false, "Monday");
  assert.equal(day("2026-08-26T10:00:00"), false, "Wednesday");
  assert.equal(day("2026-08-21T10:00:00"), false, "Friday");
});
