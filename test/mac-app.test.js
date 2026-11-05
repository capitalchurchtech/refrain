import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildMacAppIfStale, MAC_APP_SOURCES } from "../server/mac-app.js";

// A stand-in for execFile. `stamp` is the commit the installed app says it was
// built from ("" for an app built before the stamp); `diff` is git diff
// --quiet's exit code; `buildFails` makes the build script fail.
function fakeRun({ stamp = "abc123", diff = 0, buildFails = false } = {}) {
  const calls = [];
  const fail = (code, stderr) => Promise.reject(Object.assign(new Error(`exit ${code}`), { code, stdout: "", stderr }));
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "/usr/bin/plutil") return stamp ? { stdout: `${stamp}\n`, stderr: "" } : fail(1, "No value at that key path");
    if (cmd === "git") return diff === 0 ? { stdout: "", stderr: "" } : fail(diff, "");
    if (buildFails) throw Object.assign(new Error("exit 1"), { stdout: "Building Refrain.app 0.39.0...", stderr: "swiftc: error" });
    return { stdout: "Built: ~/Applications/Refrain.app\n", stderr: "" };
  };
  return { run, calls, builds: () => calls.filter(([cmd]) => cmd === "/bin/bash").length };
}

const home = mkdtempSync(join(tmpdir(), "refrain-mac-app-"));
const appPath = join(home, "Refrain.app");
mkdirSync(appPath);
test.after(() => rmSync(home, { recursive: true, force: true }));

test("rebuilds when HEAD changed what the app was built from", async () => {
  const fake = fakeRun({ diff: 1 });
  const result = await rebuildMacAppIfStale({ platform: "darwin", appPath, run: fake.run });
  assert.equal(result.rebuilt, true);
  assert.match(result.note, /rebuilt/);
  assert.equal(fake.builds(), 1);
  // Asks git only about the app's own sources, from the stamped commit to HEAD.
  assert.deepEqual(fake.calls[1], ["git", "diff", "--quiet", "abc123", "HEAD", "--", ...MAC_APP_SOURCES]);
});

test("leaves a current app alone", async () => {
  const fake = fakeRun({ diff: 0 });
  assert.equal(await rebuildMacAppIfStale({ platform: "darwin", appPath, run: fake.run }), null);
  assert.equal(fake.builds(), 0);
});

test("rebuilds an app that predates the stamp, or was built from a commit this clone lacks", async () => {
  const unstamped = fakeRun({ stamp: "" });
  assert.equal((await rebuildMacAppIfStale({ platform: "darwin", appPath, run: unstamped.run })).rebuilt, true);
  assert.equal(unstamped.calls.some(([cmd]) => cmd === "git"), false);

  const unknown = fakeRun({ diff: 128 });
  assert.equal((await rebuildMacAppIfStale({ platform: "darwin", appPath, run: unknown.run })).rebuilt, true);
});

test("never gives an app to a Mac that didn't build one, or off macOS", async () => {
  const fake = fakeRun({ diff: 1 });
  assert.equal(await rebuildMacAppIfStale({ platform: "darwin", appPath: join(home, "missing.app"), run: fake.run }), null);
  assert.equal(await rebuildMacAppIfStale({ platform: "win32", appPath, run: fake.run }), null);
  assert.equal(fake.calls.length, 0);
});

test("a failed build is a note, never a failed update", async () => {
  const fake = fakeRun({ diff: 1, buildFails: true });
  const result = await rebuildMacAppIfStale({ platform: "darwin", appPath, run: fake.run });
  assert.equal(result.rebuilt, false);
  assert.match(result.note, /build-mac-app\.command/);
  assert.match(result.output, /swiftc: error/);
});
