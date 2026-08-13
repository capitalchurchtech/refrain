import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSlides } from "../server/search-index.js";
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
    { index: 0, text: "one" },
    { index: 1, text: "two" },
    { index: 2, text: "three" },
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
    { index: 0, text: "chorus" },
    { index: 1, text: "verse" },
  ]);
});

test("extractSlides normalizes slide text and tolerates missing slides", () => {
  const doc = {
    presentation: {
      current_arrangement: "",
      groups: [{ uuid: "g1", slides: [{ text: "multi\nline  text" }] }, { uuid: "g2" }],
    },
  };
  assert.deepEqual(extractSlides(doc), [{ index: 0, text: "multi line text" }]);
});

test("extractSlides returns nothing for an empty document", () => {
  assert.deepEqual(extractSlides({}), []);
  assert.deepEqual(extractSlides(null), []);
});
