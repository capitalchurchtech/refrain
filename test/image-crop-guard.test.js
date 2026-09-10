import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeProPresenterFolder, foldersOverlap } from "../server/image-crop.js";

// Image Crop MOVES every file it processes out of the input folder. That is
// correct for a drop box and catastrophic for a media folder: it would take
// the artwork away from every presentation that references it, one file at a
// time, with no error anywhere.

test("refuses the folders a volunteer would plausibly point this at", () => {
  for (const dir of [
    "/Users/booth/Documents/ProPresenter/Media",
    "/Users/booth/Documents/ProPresenter/Assets",
    "/Users/booth/Library/Application Support/RenewedVision/ProPresenter",
    "/Users/booth/Documents/ProPresenter",
  ]) {
    assert.equal(looksLikeProPresenterFolder(dir), true, dir);
  }
});

test("allows an ordinary drop folder", () => {
  for (const dir of [
    "/Users/booth/Desktop/crop-me",
    "/Users/booth/Dropbox/Church/Images",
    "./images/input",
  ]) {
    assert.equal(looksLikeProPresenterFolder(dir), false, dir);
  }
});

test("a folder merely mentioning the name in passing is not matched on a partial segment", () => {
  // "ProPresenterBackups" is not inside ProPresenter's tree; matching it would
  // block a legitimate folder. The check is segment-wise for that reason.
  assert.equal(looksLikeProPresenterFolder("/Users/booth/ProPresenterBackups"), false);
  assert.equal(looksLikeProPresenterFolder("/Users/booth/my-propresenter-notes"), false);
});

test("empty or missing input is not a ProPresenter folder", () => {
  for (const v of [null, undefined, ""]) assert.equal(looksLikeProPresenterFolder(v), false);
});

test("the pre-existing overlap guard still holds", () => {
  assert.equal(foldersOverlap("/a/in", "/a/in"), true);
  assert.equal(foldersOverlap("/a/in", "/a/in/out"), true);
  assert.equal(foldersOverlap("/a/in", "/a/out"), false);
});
