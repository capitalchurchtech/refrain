import { test } from "node:test";
import assert from "node:assert/strict";
import { restartCommand, isConfirmedKill, runByLoginItem } from "../server/panic.js";

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
