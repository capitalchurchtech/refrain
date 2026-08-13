import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig, loadConfig, isConfigComplete, configFileExists } from "../server/config.js";

// saveConfig writes to ./config.json relative to the working directory, so
// run these in a throwaway temp dir to avoid touching the real config.
let origCwd;
let dir;
before(async () => {
  origCwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "refrain-cfg-"));
  process.chdir(dir);
});
after(async () => {
  process.chdir(origCwd);
  await rm(dir, { recursive: true, force: true });
});

const sampleConfig = { propresenter: { host: "localhost", port: 1025 }, role: "reader", theme: "dark" };

test("saveConfig writes valid JSON and round-trips through loadConfig", async () => {
  await saveConfig(sampleConfig);
  assert.ok(configFileExists());
  assert.deepEqual(JSON.parse(await readFile("config.json", "utf8")), sampleConfig);
  assert.deepEqual(loadConfig(), sampleConfig);
});

test("saveConfig leaves no temp file behind (atomic temp-then-rename)", async () => {
  await saveConfig(sampleConfig);
  await assert.rejects(() => stat("config.json.tmp"), "the .tmp staging file must be renamed away, not left behind");
});

test("saveConfig overwrites cleanly on a second write", async () => {
  await saveConfig(sampleConfig);
  const updated = { ...sampleConfig, theme: "blackroom" };
  await saveConfig(updated);
  assert.deepEqual(loadConfig(), updated);
});

test("isConfigComplete requires host, port, and a valid role", async () => {
  await saveConfig(sampleConfig); // so configFileExists() is true
  assert.equal(isConfigComplete(sampleConfig), true);
  assert.equal(isConfigComplete({ propresenter: { host: "x" } }), false);
  assert.equal(isConfigComplete({ propresenter: { host: "x", port: 1 }, role: "bogus" }), false);
  assert.equal(isConfigComplete({ propresenter: { host: "x", port: 1 }, role: "logger" }), true);
});
