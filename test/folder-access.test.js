import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { folderAccess } from "../server/folder-access.js";
import { folderRowHtml } from "../public/health-check.js";

test("a folder this account owns has no problems; missing files are fine", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-folder-"));
  try {
    assert.deepEqual((await folderAccess(dir)).problems, [], "a fresh install has no config.json, data or .env yet");
    await mkdir(path.join(dir, "data"));
    await writeFile(path.join(dir, "config.json"), "{}");
    await writeFile(path.join(dir, ".env"), "X=1");
    assert.deepEqual((await folderAccess(dir)).problems, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("what this account can't do is said in a sentence each (another account's copy)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-folder-"));
  try {
    await mkdir(path.join(dir, "data"));
    await writeFile(path.join(dir, ".env"), "X=1");
    await chmod(path.join(dir, "data"), 0o555);
    await chmod(path.join(dir, ".env"), 0o000);
    await chmod(dir, 0o555);
    const { problems } = await folderAccess(dir);
    assert.equal(problems.length, 3);
    assert.match(problems.join(" "), /save settings.*save its data.*read its secrets/);
  } finally {
    await chmod(dir, 0o755);
    await chmod(path.join(dir, "data"), 0o755);
    await rm(dir, { recursive: true, force: true });
  }
});

test("Status shows a folder row only when something is wrong, naming the folder and what to do, escaped", () => {
  assert.equal(folderRowHtml(undefined), "");
  assert.equal(folderRowHtml({ dir: "/x", problems: [] }), "");
  const html = folderRowHtml({ dir: "/Users/Shared/Refrain<b>", problems: ["It can't save settings."] });
  assert.match(html, /data-hc-row="folder"/);
  assert.match(html, /This account can&#39;t use \/Users\/Shared\/Refrain&lt;b&gt;\. It can&#39;t save settings\./);
  assert.match(html, /install Refrain in this account&#39;s own folder/);
  assert.match(html, /Several accounts on one Mac/);
});
