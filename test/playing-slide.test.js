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

test("the outline names a slide by label and group in the arrangement that played, never by guessing", async () => {
  const { outlineOf, slideInOutline } = await import("../server/playing-slide.js");
  // Announcements 2026-11-01's shape: three groups, three arrangements, each with its own group.
  const doc = {
    presentation: {
      id: { uuid: "ANN" },
      current_arrangement: "",
      groups: [
        { uuid: "G-SAT", name: "SLC · Saturday 5pm", slides: [{ label: "Speaker Intro", text: "secret" }, { label: "Giving ALL", text: "secret" }] },
        { uuid: "G-PC", name: "Park City · Sunday 10am", slides: [{ label: "Speaker Intro", text: "secret" }, { label: "Serving", text: "secret" }, { label: "", text: "secret" }] },
      ],
      arrangements: [{ id: { uuid: "A-SAT", name: "Saturday" }, groups: ["G-SAT"] }, { id: { uuid: "A-PC", name: "PC Sunday" }, groups: ["G-PC"] }],
    },
  };
  const outline = outlineOf(doc.presentation);
  assert.doesNotMatch(JSON.stringify(outline), /secret/, "no words in the outline");
  assert.deepEqual(slideInOutline(outline, "A-PC", 1), { label: "Serving", group: "Park City · Sunday 10am" }, "counted within PC Sunday, not the whole file");
  assert.deepEqual(slideInOutline(outline, "A-PC", 2), { label: null, group: "Park City · Sunday 10am" }, "a slide with no label still has its group");
  assert.equal(slideInOutline(outline, "A-PC", 3), null, "past the arrangement's end");
  assert.equal(slideInOutline(outline, null, 1), null, "several arrangements and none known: no guess");
  assert.deepEqual(slideInOutline({ ...outline, current: "A-SAT" }, null, 1), { label: "Giving ALL", group: "SLC · Saturday 5pm" }, "the selected one when no playlist chose");
  const flat = outlineOf({ ...doc.presentation, arrangements: [] });
  assert.deepEqual(slideInOutline(flat, null, 3), { label: "Serving", group: "Park City · Sunday 10am" }, "no arrangements: the file's own order");
  assert.ok(playingFromDoc(doc).outline, "kept with the playing presentation");
});

test("the arrangement a playlist item chose is the one whose words show; unknown means no words, never the whole file", async () => {
  const { playingArrangement } = await import("../server/playing-slide.js");
  // Announcements 2026-11-01's shape, played from a playlist on "PC Sunday": ProPresenter selects nothing.
  const ann = {
    presentation: {
      id: { uuid: "ANN" },
      current_arrangement: "",
      groups: [
        { uuid: "G-SAT", name: "Saturday", slides: [{ text: "sat one" }, { text: "sat two" }] },
        { uuid: "G-PC", name: "PC", slides: [{ text: "pc one" }, { text: "pc two" }, { text: "pc three" }] },
      ],
      arrangements: [{ id: { uuid: "A-SAT", name: "Saturday" }, groups: ["G-SAT"] }, { id: { uuid: "A-PC", name: "PC Sunday" }, groups: ["G-PC"] }],
    },
  };
  assert.deepEqual(playingArrangement(ann, { arrangementUuid: "A-PC" }), { uuid: "A-PC" });
  assert.deepEqual(playingArrangement(ann, { arrangementUuid: null }), { raw: true }, "the playlist item chose none: the file's own order");
  assert.deepEqual(playingArrangement(ann, null), { pending: true }, "the playlist hasn't caught up yet");
  assert.deepEqual(playingArrangement(ann, null, { lastTry: true }), { raw: true }, "never this presentation: put up from the library");
  assert.deepEqual(playingArrangement({ presentation: { ...ann.presentation, current_arrangement: "A-SAT" } }, null), { uuid: "A-SAT" }, "selected in the app: no need to ask");
  assert.deepEqual(playingArrangement({ presentation: { ...ann.presentation, arrangements: [] } }, null), { raw: true }, "no arrangements: nothing to ask");

  const pc = playingFromDoc(ann, { arrangementUuid: "A-PC" });
  assert.deepEqual([pc.arrangementName, pc.count, pc.slides[1].text], ["PC Sunday", 3, "pc two"], "slide 1 is PC's second, not the file's");
  const unknown = playingFromDoc(ann, { pending: true });
  assert.equal(unknown.pending, true);
  assert.deepEqual(liveSlideDetails({ playing: unknown, slideIndex: 1, indexed: { text: "index words", arrangementName: "X", selectedArrangementName: "X", slideCount: 9 } }), { text: null, slideCount: null, arrangementName: null }, "no words, and not the index's either");
  assert.equal(playingStale({ ...unknown, at: 0 }, 5, 10_000, { quiet: true }), false, "an unknown count never makes it read the presentation again");
});
