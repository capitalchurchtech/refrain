import test from "node:test";
import assert from "node:assert/strict";
import { tokenize, buildSongCorpus, rankCandidates } from "../server/follow-match.js";

// Phase 1's real question isn't "is the transcript accurate" but "is it
// distinctive enough to pick one song out of the library". These cover the
// properties that has to hold even when Whisper mangles the words.

const PRESENTATIONS = {
  jireh: {
    name: "Jireh",
    folder: "Songs",
    slides: [
      { index: 0, text: "Jireh you are enough", groupId: "g1", groupOffset: 0 },
      { index: 1, text: "I will be content in every circumstance", groupId: "g2", groupOffset: 0 },
    ],
  },
  goodness: {
    name: "Goodness of God",
    folder: "Songs",
    slides: [
      { index: 0, text: "All my life you have been faithful", groupId: "g1", groupOffset: 0 },
      { index: 1, text: "And all my life you have been so so good", groupId: "g2", groupOffset: 0 },
    ],
  },
  sermon: {
    name: "Sermon Notes",
    folder: "Messages",
    slides: [{ index: 0, text: "All my life is faithful stewardship", groupId: "g1", groupOffset: 0 }],
  },
};

test("tokenize drops stopwords and punctuation, folds apostrophes", () => {
  assert.deepEqual(tokenize("All my life, You have been faithful!"), ["life", "faithful"]);
  assert.deepEqual(tokenize("Calv'ry's love"), ["calvrys", "love"]);
});

test("a distinctive word pins the right song", () => {
  const corpus = buildSongCorpus(PRESENTATIONS);
  const ranked = rankCandidates(tokenize("jireh you are enough"), corpus);
  assert.equal(ranked[0].name, "Jireh");
  assert.ok(ranked[0].score > 0, "the winner scores above zero");
});

test("common words alone do not decide it, rare ones do", () => {
  const corpus = buildSongCorpus(PRESENTATIONS);
  // "life"/"faithful" are shared by a song and a sermon; "jireh"/"circumstance"
  // occur once in the whole corpus. Both windows are fully explained by their
  // best candidate, so COVERAGE ties at 1.0 — only the raw evidence weight
  // separates them. Ranking on coverage would call "all my life" confident.
  const shared = rankCandidates(tokenize("all my life faithful"), corpus);
  const distinctive = rankCandidates(tokenize("jireh circumstance"), corpus);
  assert.ok(
    distinctive[0].weight > shared[0].weight,
    "a rare-word match must carry more evidence than a common-word match"
  );
});

test("folder scoping keeps a transcript off sermon slides", () => {
  const all = buildSongCorpus(PRESENTATIONS);
  const songsOnly = buildSongCorpus(PRESENTATIONS, ["Songs"]);
  assert.ok(all.docs.some((d) => d.folder === "Messages"), "unscoped corpus includes the sermon");
  assert.ok(!songsOnly.docs.some((d) => d.folder === "Messages"), "scoped corpus excludes it");
  const ranked = rankCandidates(tokenize("all my life is faithful stewardship"), songsOnly);
  assert.ok(ranked.every((r) => r.name !== "Sermon Notes"), "the sermon can never be a candidate");
});

test("the best slide carries the anchor Phase 2 would track position with", () => {
  const corpus = buildSongCorpus(PRESENTATIONS, ["Songs"]);
  const ranked = rankCandidates(tokenize("content in every circumstance"), corpus);
  assert.equal(ranked[0].name, "Jireh");
  assert.equal(ranked[0].bestSlide.slideIndex, 1);
  assert.equal(ranked[0].bestSlide.groupId, "g2", "anchor, not just a flat index");
});

test("nothing informative yields no candidates rather than a random guess", () => {
  const corpus = buildSongCorpus(PRESENTATIONS);
  assert.deepEqual(rankCandidates(tokenize("the and of to"), corpus), []);
  assert.deepEqual(rankCandidates([], corpus), []);
});
