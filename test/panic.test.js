import { test } from "node:test";
import assert from "node:assert/strict";
import { restartCommand, isConfirmedKill, isConfirmedRestart, restartPlan, runByLoginItem } from "../server/panic.js";

test("the restart command: the login item when there is one, else the install folder", () => {
  assert.equal(restartCommand({ launchAgent: true, label: "com.refrain.server", installDir: "/x" }), "launchctl kickstart gui/$(id -u)/com.refrain.server");
  assert.equal(restartCommand({ launchAgent: false, label: "com.refrain.server", installDir: "/Users/Shared/Refrain" }), 'cd "/Users/Shared/Refrain" && npm start');
});

test("only { confirm: true } stops Refrain", () => {
  assert.equal(isConfirmedKill({ confirm: true }), true);
  for (const b of [undefined, null, {}, { confirm: "true" }, { confirm: 1 }]) assert.equal(isConfirmedKill(b), false);
});

test("the login item counts only when it runs this folder", () => {
  const plist = "<dict><key>WorkingDirectory</key>\n  <string>/Users/Shared/Refrain</string></dict>";
  assert.equal(runByLoginItem(plist, "/Users/Shared/Refrain"), true);
  assert.equal(runByLoginItem(plist, "/Users/Shared/Refrain/"), true);
  assert.equal(runByLoginItem(plist, "/Applications/MAMP/htdocs/sandbox/refrain"), false, "a checkout run by hand");
  assert.equal(runByLoginItem("", "/x"), false);
});

test("only { confirm: true } restarts Refrain", () => {
  assert.equal(isConfirmedRestart({ confirm: true }), true);
  for (const b of [undefined, null, {}, { confirm: "true" }, { confirm: 1 }]) assert.equal(isConfirmedRestart(b), false);
});

test("restart: the login item is kicked by launchd; a hand-run copy waits for its port and starts the same script again", () => {
  const base = { label: "com.refrain.server", uid: 501, pid: 4242, execPath: "/usr/local/bin/node", script: "/Users/Shared/Refrain/server/index.js", cwd: "/Users/Shared/Refrain" };
  const agent = restartPlan({ ...base, launchAgent: true });
  assert.deepEqual([agent.how, agent.command, agent.args], ["launchd", "/bin/launchctl", ["kickstart", "-k", "gui/501/com.refrain.server"]]);
  const hand = restartPlan({ ...base, launchAgent: false });
  assert.equal(hand.how, "respawn");
  assert.equal(hand.cwd, "/Users/Shared/Refrain");
  // The pid and the command travel as arguments, never spliced into the shell text.
  assert.deepEqual(hand.args.slice(2), ["sh", "4242", "/usr/local/bin/node", "/Users/Shared/Refrain/server/index.js"]);
  assert.doesNotMatch(hand.args[1], /4242|Refrain/);
});
