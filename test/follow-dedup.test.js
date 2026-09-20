import test from "node:test";
import assert from "node:assert/strict";
import { mergeTranscriptWindow } from "../server/follow.js";

// Whisper re-transcribes a ~4s window every ~1s, so consecutive windows
// overlap heavily. mergeTranscriptWindow keeps only the genuinely new tail,
// so the transcript grows by what was actually sung, not 4x over.

test("appends the whole first window when nothing has been emitted", () => {
  const { added, words } = mergeTranscriptWindow([], "amazing grace how sweet");
  assert.equal(added, "amazing grace how sweet");
  assert.deepEqual(words, ["amazing", "grace", "how", "sweet"]);
});

test("emits only the new tail when a window overlaps the prior one", () => {
  const prior = ["amazing", "grace", "how", "sweet"];
  const { added, words } = mergeTranscriptWindow(prior, "how sweet the sound");
  assert.equal(added, "the sound");
  assert.deepEqual(words, ["amazing", "grace", "how", "sweet", "the", "sound"]);
});

test("a fully-contained repeat adds nothing", () => {
  const prior = ["how", "sweet", "the", "sound"];
  const { added, words } = mergeTranscriptWindow(prior, "sweet the sound");
  assert.equal(added, "");
  assert.deepEqual(words, prior, "the running transcript is unchanged");
});

test("overlap matching ignores case and punctuation", () => {
  const prior = ["how", "sweet", "the", "sound"];
  const { added } = mergeTranscriptWindow(prior, "Sound! that saved a wretch");
  assert.equal(added, "that saved a wretch");
});

test("a window with no overlap is treated as a fresh phrase and kept whole", () => {
  const prior = ["was", "blind", "but", "now", "i", "see"];
  const { added } = mergeTranscriptWindow(prior, "when we've been there ten thousand years");
  assert.equal(added, "when we've been there ten thousand years");
});

test("empty or whitespace text adds nothing and leaves the transcript alone", () => {
  const prior = ["a", "b"];
  for (const t of ["", "   ", null, undefined]) {
    const { added, words } = mergeTranscriptWindow(prior, t);
    assert.equal(added, "");
    assert.deepEqual(words, prior);
  }
});
