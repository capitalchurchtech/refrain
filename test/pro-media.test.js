import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFields, slideMediaRefs, missingReference, missingMediaBySlide } from "../server/pro-media.js";

// A tiny protobuf writer, just enough to build a .pro-shaped fixture.
const varint = (n) => {
  const out = [];
  while (n > 127) {
    out.push((n % 128) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const bytes = (field, payload) => {
  const p = typeof payload === "string" ? Buffer.from(payload) : Buffer.concat(payload);
  return Buffer.from([...varint(field * 8 + 2), ...varint(p.length), ...p]);
};
const num = (field, n) => Buffer.from([...varint(field * 8), ...varint(n)]);
const uuid = (field, s) => bytes(field, [bytes(1, s)]);
const url = (abs, rel) => bytes(2, [bytes(1, abs), num(3, 1), bytes(4, [num(1, 10), bytes(2, rel)])]);
// Cue with a media action (background) nested a few levels down, stored twice.
const cue = (id, ...urls) => bytes(13, [uuid(1, id), bytes(10, [bytes(20, [bytes(5, urls)])])]);
const group = (id, name, ...cueIds) => bytes(12, [bytes(1, [uuid(1, id), bytes(2, name)]), ...cueIds.map((c) => uuid(2, c))]);

const BG = "file:///Users/booth/Documents/ProPresenter/Media/Assets/sunrise.jpg";
const pro = Buffer.concat([
  uuid(2, "PRES"),
  bytes(3, "Sample Hymn"),
  group("G-VERSE", "Verse 1", "C1", "C2"),
  group("G-CHORUS", "Chorus", "C3"),
  cue("C1"),
  cue("C2", url(BG, "Media/Assets/sunrise.jpg"), url(BG, "Media/Assets/sunrise.jpg")),
  cue("C3", url("file:///Users/booth/Documents/ProPresenter/Media/Assets/waves.mp4", "Media/Assets/waves.mp4")),
]);

test("the decoder reads one level of fields and refuses bytes that are not a message", () => {
  const f = decodeFields(num(3, 300));
  assert.deepEqual(f, [{ field: 3, wire: 0, value: 300 }]);
  assert.throws(() => decodeFields(Buffer.from([0x0a, 0x05, 0x41])), /length past end/);
});

test("media is keyed by group and position, in the file's own group order, de-duplicated per slide", () => {
  const slides = slideMediaRefs(pro);
  assert.deepEqual(
    slides.map((s) => [s.groupId, s.groupName, s.groupOffset, s.refs.length]),
    [
      ["G-VERSE", "Verse 1", 1, 1],
      ["G-CHORUS", "Chorus", 0, 1],
    ]
  );
  assert.equal(slides[0].refs[0].relative, "Media/Assets/sunrise.jpg");
  assert.equal(slides[0].refs[0].root, 10);
});

test("a file saved on another Mac but present under this Mac's media folder is not missing", () => {
  const env = {
    home: "/Users/second",
    mediaRoots: ["/Users/second/Documents/ProPresenter"],
    exists: (p) => p === "/Users/second/Documents/ProPresenter/Media/Assets/sunrise.jpg",
  };
  const bySlide = missingMediaBySlide(pro, env);
  assert.deepEqual([...bySlide.keys()], ["G-CHORUS:0"]);
  assert.deepEqual(bySlide.get("G-CHORUS:0"), [
    { fileName: "waves.mp4", path: "/Users/booth/Documents/ProPresenter/Media/Assets/waves.mp4", otherMac: true },
  ]);
});

test("a file missing on the Mac that saved it is not blamed on another Mac", () => {
  const miss = missingReference({ url: BG, relative: null }, { home: "/Users/booth", mediaRoots: [], exists: () => false });
  assert.equal(miss.otherMac, false);
  assert.equal(missingReference({ url: BG, relative: null }, { home: "/Users/booth", mediaRoots: [], exists: () => true }), null);
  assert.equal(missingReference({ url: "https://example.com/a.jpg", relative: null }, { home: "", mediaRoots: [], exists: () => false }), null);
});

test("an embedded blob that is not a message is skipped rather than walked", () => {
  const blob = Buffer.alloc(2_000_000, 0x08); // parses as a million tiny varint fields
  const withBlob = Buffer.concat([group("G", "Only", "C"), bytes(13, [uuid(1, "C"), bytes(10, [bytes(99, [blob]), url(BG, "Media/Assets/sunrise.jpg")])])]);
  assert.equal(slideMediaRefs(withBlob).length, 1);
});
