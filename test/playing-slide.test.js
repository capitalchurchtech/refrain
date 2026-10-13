import { test } from "node:test";
import assert from "node:assert/strict";
import { playingFromDoc, playingStale, liveSlideDetails, slideNumber, PLAYING_TTL_MS } from "../server/playing-slide.js";

// A presentation with two arrangements, T selected: FS has 3 slides, T has 2.
const doc = {
  presentation: {
    id: { uuid: "P1", name: "Graves Into Gardens" },
    current_arrangement: "T",
    arrangements: [
      { id: { uuid: "FS", name: "FS" }, groups: ["v1", "ch", "br"] },
      { id: { uuid: "T", name: "T" }, groups: ["v1", "br"] },
    ],
    groups: [
      { uuid: "v1", name: "Verse 1", slides: [{ text: "Verse words" }] },
      { uuid: "ch", name: "Chorus", slides: [{ text: "Chorus words" }] },
      { uuid: "br", name: "Bridge", slides: [{ text: "You turn seas into highways" }] },
    ],
  },
};

test("the playing arrangement is the selected one, not a preferred one", () => {
  const p = playingFromDoc(doc);
  assert.deepEqual([p.presentationId, p.arrangementName, p.count], ["P1", "T", 2]);
  assert.deepEqual(p.slides.map((s) => s.text), ["Verse words", "You turn seas into highways"]);
  assert.equal(p.slides[1].index, 1);
});

test("a document that is not a presentation (nothing live) is nothing", () => {
  for (const d of [null, {}, { presentation: null }, { presentation: { groups: [] } }]) assert.equal(playingFromDoc(d), null);
});

test("with no arrangements the groups play in order", () => {
  const p = playingFromDoc({ presentation: { id: { uuid: "P2" }, groups: [{ uuid: "a", name: "A", slides: [{ text: "one" }, { text: "two" }] }] } });
  assert.deepEqual([p.arrangementName, p.count], [null, 2]);
});

test("the live words come from the playing arrangement, where the index would be wrong", () => {
  const playing = { ...playingFromDoc(doc), at: 0 };
  const indexed = { arrangementName: "FS", selectedArrangementName: "T", text: "Chorus words", slideCount: 3 };
  const d = liveSlideDetails({ playing, slideIndex: 1, indexed });
  assert.deepEqual(d, { text: "You turn seas into highways", slideCount: 2, arrangementName: "T" });
});

test("without a live read, the index is used only when it was built from the selected arrangement; otherwise nothing, never a guess", () => {
  const ok = liveSlideDetails({ playing: null, slideIndex: 0, indexed: { arrangementName: "T", selectedArrangementName: "T", text: "words", slideCount: 4 } });
  assert.deepEqual(ok, { text: "words", slideCount: 4, arrangementName: "T" });
  const wrong = liveSlideDetails({ playing: null, slideIndex: 0, indexed: { arrangementName: "FS", selectedArrangementName: "T", text: "words", slideCount: 4 } });
  assert.deepEqual(wrong, { text: null, slideCount: null, arrangementName: null });
  const unknown = liveSlideDetails({ playing: null, slideIndex: 0, indexed: { arrangementName: "FS", text: "words", slideCount: 4 } });
  assert.equal(unknown.text, null, "selected arrangement unknown: not verifiable");
  assert.equal(liveSlideDetails({ playing: null, slideIndex: 0, indexed: null }).text, null);
});

test("the live presentation is read again when never read, when slides were added past what was read, and when old", () => {
  const entry = { count: 5, at: 1000 };
  assert.equal(playingStale(null, 0, 0), true);
  assert.equal(playingStale(entry, 4, 2000), false);
  assert.equal(playingStale(entry, 5, 1000 + 6000), true, "past the end: the arrangement has grown");
  assert.equal(playingStale(entry, 5, 1000 + 2000), false, "but not every beat: a fresh read that is still short is left alone for a few seconds");
  assert.equal(playingStale(entry, 0, 1000 + PLAYING_TTL_MS + 1), true);
  assert.equal(playingStale(entry, 0, 1000 + PLAYING_TTL_MS + 1, { quiet: true }), false, "during performance mode no periodic look");
  assert.equal(playingStale(entry, 5, 1000 + 6000, { quiet: true }), true, "but a slide past the end still asks");
});

test("a person's slide number is the API index plus one, and nothing for a bad index", () => {
  assert.deepEqual([slideNumber(0), slideNumber(28), slideNumber(-1), slideNumber(null), slideNumber(1.5)], [1, 29, null, null, null]);
});
