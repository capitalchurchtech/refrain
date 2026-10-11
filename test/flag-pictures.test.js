import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveFlagPicture, readFlagPicture, listFlagPictureIds, MAX_PICTURE_BYTES } from "../server/flag-pictures.js";

const ID = "2026-10-09T10-52-01-123Z-0a1b2c3d";
const png = { type: "image/png", bytes: Buffer.from([137, 80, 78, 71, 1, 2, 3]) };

test("a picture is saved under the flag's id, privately, and reads back", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flagpic-"));
  try {
    const name = await saveFlagPicture(dir, ID, png);
    assert.equal(name, `${ID}.png`);
    assert.equal(((await stat(path.join(dir, name))).mode & 0o077), 0, "only this account can read it");
    assert.deepEqual(await readdir(dir), [name], "no temporary file is left");
    const back = await readFlagPicture(dir, ID);
    assert.equal(back.type, "image/png");
    assert.deepEqual(back.bytes, png.bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("only real flag ids, real picture types and sensible sizes are kept", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flagpic-"));
  try {
    assert.equal(await saveFlagPicture(dir, "../etc/passwd", png), null);
    assert.equal(await saveFlagPicture(dir, ID, { type: "text/html", bytes: Buffer.from("<script>") }), null);
    assert.equal(await saveFlagPicture(dir, ID, { type: "image/png", bytes: Buffer.alloc(0) }), null);
    assert.equal(await saveFlagPicture(dir, ID, { type: "image/png", bytes: Buffer.alloc(MAX_PICTURE_BYTES + 1) }), null);
    assert.equal(await saveFlagPicture(dir, ID, null), null);
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a picture can only be read by a real flag id, never by a path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flagpic-"));
  try {
    await saveFlagPicture(dir, ID, png);
    assert.equal(await readFlagPicture(dir, `../${ID}`), null);
    assert.equal(await readFlagPicture(dir, "bad-id"), null);
    assert.equal(await readFlagPicture(dir, "2026-10-09T10-52-01-123Z-ffffffff"), null, "no such flag");
    assert.equal((await readFlagPicture(dir, ID)).type, "image/png");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the pictured flags are listed from one look at the folder, and anything else in it is ignored", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "flagpic-"));
  try {
    assert.equal((await listFlagPictureIds(path.join(dir, "missing"))).size, 0, "no folder yet is just none");
    await saveFlagPicture(dir, ID, png);
    await writeFile(path.join(dir, "notes.txt"), "x");
    await writeFile(path.join(dir, "bad-id.png"), "x");
    assert.deepEqual([...(await listFlagPictureIds(dir))], [ID]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
