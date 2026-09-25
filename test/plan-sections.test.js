import { test } from "node:test";
import assert from "node:assert/strict";
import { songItemsWithSections } from "../providers/planning-center.js";

const item = (item_type, title) => ({ attributes: { item_type, title } });

test("each song carries the header above it, so a set repeated per service can be told apart", () => {
  const out = songItemsWithSections([
    item("header", "Early Service"),
    item("header", "Early :: Worship"),
    item("song", "Amazing Grace"),
    item("item", "Welcome"),
    item("song", "How Great Thou Art"),
    item("header", "::"),
    item("header", "Late :: Worship"),
    item("song", "Amazing Grace"),
  ]);
  assert.deepEqual(
    out.map(({ item, section }) => [item.attributes.title, section]),
    [
      ["Amazing Grace", "Early :: Worship"],
      ["How Great Thou Art", "Early :: Worship"],
      ["Amazing Grace", "Late :: Worship"],
    ]
  );
});

test("a spacer header does not blank the label, and songs before any header have none", () => {
  const out = songItemsWithSections([item("song", "Be Thou My Vision"), item("header", "Main"), item("header", "  :: "), item("song", "Holy, Holy, Holy")]);
  assert.deepEqual(out.map((o) => o.section), [null, "Main"]);
  assert.deepEqual(songItemsWithSections(undefined), []);
});
