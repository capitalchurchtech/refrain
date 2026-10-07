import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { otherArrangementSlides, resolveArrangement } from "../server/arrangements.js";
import { loadIndexFromDisk, searchOtherArrangements, otherSlidesCoverage } from "../server/search-index.js";

// A song whose FS arrangement skips the Tag, which Long plays at the end, and
// a Bridge that no arrangement uses at all.
const doc = () => ({
  presentation: {
    current_arrangement: "arr-fs",
    groups: [
      { uuid: "g-v", name: "Verse 1", slides: [{ text: "verse a" }, { text: "verse b" }] },
      { uuid: "g-c", name: "Chorus", slides: [{ text: "chorus a" }] },
      { uuid: "g-t", name: "Tag", slides: [{ text: "tag line one" }, { text: "  " }, { text: "tag line two" }] },
      { uuid: "g-b", name: "Bridge", slides: [{ text: "orphan bridge" }] },
    ],
    arrangements: [
      { id: { uuid: "arr-fs", name: "FS" }, groups: ["g-v", "g-c"] },
      { id: { uuid: "arr-long", name: "Long" }, groups: ["g-v", "g-c", "g-v", "g-t"] },
    ],
  },
});

test("otherArrangementSlides lists only what the chosen arrangement skips, placed in the first arrangement that plays it", () => {
  const d = doc();
  const out = otherArrangementSlides(d, resolveArrangement(d, ["FS"]));
  assert.deepEqual(
    out.map((s) => [s.groupName, s.groupOffset, s.text, s.arrangementName, s.slideIndex, s.slideCount]),
    [
      // Long = Verse(2) + Chorus(1) + Verse(2) = 5 slides before the Tag, so its
      // first line is index 5 of 8 (the Tag itself has three slides).
      ["Tag", 0, "tag line one", "Long", 5, 8],
      // The blank slide at offset 1 is not listed, but it still holds a place in
      // the arrangement, so the next line keeps its real position.
      ["Tag", 2, "tag line two", "Long", 7, 8],
      // No arrangement uses the Bridge: found, but not placed.
      ["Bridge", 0, "orphan bridge", null, null, null],
    ]
  );
});

test("otherArrangementSlides is empty when the song has no arrangements", () => {
  const d = { presentation: { groups: [{ uuid: "g", name: "A", slides: [{ text: "x" }] }], arrangements: [] } };
  assert.deepEqual(otherArrangementSlides(d, resolveArrangement(d, [])), []);
  assert.deepEqual(otherArrangementSlides(null, null), []);
});

const origCwd = process.cwd();
const dir = await mkdtemp(join(tmpdir(), "refrain-deep-"));
process.chdir(dir);
await mkdir("cache", { recursive: true });
const d = doc();
await writeFile(
  join("cache", "search-index.json"),
  JSON.stringify({
    schemaVersion: 3,
    builtAt: new Date().toISOString(),
    presentations: {
      "pres-1": { name: "Oceans", folder: "Songs", appearsIn: [], slides: [], arrangementName: "FS", otherSlides: otherArrangementSlides(d, resolveArrangement(d, ["FS"])) },
      // Indexed before Deep Search existed: no otherSlides.
      "pres-2": { name: "Older", folder: "Songs", appearsIn: [], slides: [], arrangementName: "FS" },
    },
  })
);
await loadIndexFromDisk();
process.chdir(origCwd);

test("searchOtherArrangements finds a Tag line and says where it lives", () => {
  const [hit, ...rest] = searchOtherArrangements({ query: "tag line two" });
  assert.equal(rest.length, 0);
  assert.equal(hit.presentationName, "Oceans");
  assert.equal(hit.groupName, "Tag");
  assert.equal(hit.arrangementName, "Long");
  assert.equal(hit.slideIndex, 7);
});

test("searchOtherArrangements matches an unplaced group, ignores an empty query, and respects folders", () => {
  assert.equal(searchOtherArrangements({ query: "ORPHAN" })[0].arrangementName, null);
  assert.deepEqual(searchOtherArrangements({ query: "   " }), []);
  assert.deepEqual(searchOtherArrangements({ query: "tag", folders: ["Elsewhere"] }), []);
});

test("coverage says how many songs Deep Search could read", () => {
  assert.deepEqual(otherSlidesCoverage(), { covered: 1, total: 2 });
});
