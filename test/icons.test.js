import { test } from "node:test";
import assert from "node:assert/strict";
import { drawnIcon } from "../public/icons.js";

test("drawnIcon returns an svg for the icons the design draws", () => {
  for (const name of ["search", "spellcheck", "service", "history", "menu", "flag", "library", "deep"]) {
    assert.match(drawnIcon(name), /^<svg class="rf-icon [^"]*" viewBox="0 0 24 24" aria-hidden="true">.+<\/svg>$/, name);
  }
});

test("drawnIcon is null for a name the design does not draw, so the caller falls back to Lucide", () => {
  assert.equal(drawnIcon("prep"), null);
  assert.equal(drawnIcon(undefined), null);
});
