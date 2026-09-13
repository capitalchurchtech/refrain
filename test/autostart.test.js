import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { buildPlist, plistPath, LABEL } from "../server/autostart.js";

const run = promisify(execFile);
const base = { nodePath: "/opt/homebrew/bin/node", appDir: "/Users/booth/Refrain", port: "3000", logDir: "/Users/booth/Refrain/logs" };

test("the plist names the interpreter and the server entry point", () => {
  const xml = buildPlist(base);
  assert.match(xml, /<string>\/opt\/homebrew\/bin\/node<\/string>/);
  assert.match(xml, /<string>\/Users\/booth\/Refrain\/server\/index\.js<\/string>/);
  assert.match(xml, new RegExp(`<string>${LABEL}</string>`));
});

test("WorkingDirectory is the app folder, because config.json is read relative to it", () => {
  assert.match(buildPlist(base), /<key>WorkingDirectory<\/key>\s*<string>\/Users\/booth\/Refrain<\/string>/);
});

test("the port is passed through, so the agent answers where the app expects", () => {
  assert.match(buildPlist({ ...base, port: "3100" }), /<key>PORT<\/key>\s*<string>3100<\/string>/);
});

test("KeepAlive only restarts on a crash, never on a clean exit", () => {
  // This is the whole reason the second copy can stand down on EADDRINUSE
  // instead of being restarted forever. A plain <true/> here would restore the
  // crash loop that turning this into a button makes easy to trigger.
  const xml = buildPlist(base);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
  assert.doesNotMatch(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
});

test("a path containing an ampersand does not break the document", () => {
  const xml = buildPlist({ ...base, appDir: "/Users/av&booth/Refrain" });
  assert.match(xml, /av&amp;booth/);
  assert.doesNotMatch(xml, /av&booth/);
});

test("the agent lives in the user's own LaunchAgents, needing no admin password", () => {
  assert.equal(plistPath("/Users/booth"), `/Users/booth/Library/LaunchAgents/${LABEL}.plist`);
});

// The generator is only as good as what launchd will actually parse, and a
// regex cannot tell you that. plutil is the real validator and ships with
// macOS, so run it there and skip elsewhere.
test("plutil accepts the generated plist", { skip: platform() !== "darwin" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "refrain-plist-"));
  try {
    const file = join(dir, "test.plist");
    await writeFile(file, buildPlist({ ...base, appDir: "/Users/av&booth/Re frain" }), "utf-8");
    await run("plutil", ["-lint", file]);
    const { stdout } = await run("plutil", ["-extract", "Label", "raw", file]);
    assert.equal(stdout.trim(), LABEL);
    const { stdout: wd } = await run("plutil", ["-extract", "WorkingDirectory", "raw", file]);
    assert.equal(wd.trim(), "/Users/av&booth/Re frain", "the escaped path round-trips to the real one");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
