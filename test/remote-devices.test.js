import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyRegistry, seeDevice, setApproved, removeDevice, isApproved, isRemoved, deviceList, createConfirmer, createCooldown } from "../server/remote-devices.js";
import { issueToken, tokenDevice, tokenValid } from "../server/remote-auth.js";

test("a phone's token carries its own id, and old-style tokens still verify", () => {
  const { token, deviceId } = issueToken("s", { trust: true });
  assert.equal(tokenDevice("s", token), deviceId);
  assert.equal(tokenValid("s", token), true);
  assert.equal(tokenDevice("other", token), null);
});

test("a phone signs in unapproved; the booth approves it; removing it refuses it until it signs in again", () => {
  let reg = seeDevice(emptyRegistry(), "p1", { name: "  Sam's phone ", signIn: true, now: 1 });
  assert.equal(reg.devices.p1.name, "Sam's phone");
  assert.equal(isApproved(reg, "p1"), false);
  reg = setApproved(reg, "p1", true, 2);
  assert.equal(isApproved(reg, "p1"), true);
  reg = seeDevice(reg, "p1", { now: 3 });
  assert.equal(isApproved(reg, "p1"), true, "being seen again keeps approval");
  reg = removeDevice(reg, "p1");
  assert.equal(isRemoved(reg, "p1"), true);
  assert.equal(isApproved(reg, "p1"), false);
  reg = seeDevice(reg, "p1", { now: 4 });
  assert.equal(isRemoved(reg, "p1"), true, "a removed phone isn't brought back by just calling in");
  reg = seeDevice(reg, "p1", { now: 5, signIn: true, name: "Sam" });
  assert.equal(isRemoved(reg, "p1"), false, "signing in again with the PIN starts over");
  assert.equal(isApproved(reg, "p1"), false, "...unapproved");
  assert.deepEqual(deviceList(reg, 6).map((d) => d.name), ["Sam"]);
});

test("a control press must be confirmed by the same phone, once, in time", () => {
  let n = 0;
  const c = createConfirmer({ ttlMs: 5000, idOf: () => `c${++n}` });
  const id = c.prepare("p1", { kind: "next" }, 0);
  assert.equal(c.take("p2", id, 100), null, "another phone can't confirm it");
  const id2 = c.prepare("p1", { kind: "next" }, 0);
  assert.deepEqual(c.take("p1", id2, 100), { kind: "next" });
  assert.equal(c.take("p1", id2, 200), null, "once only");
  const id3 = c.prepare("p1", { kind: "next" }, 0);
  assert.equal(c.take("p1", id3, 6000), null, "too late");
  assert.equal(c.take("p1", "made-up", 0), null);
});

test("control presses from one phone are spaced out", () => {
  const c = createCooldown(1000);
  assert.equal(c.ready("p", 0), true);
  c.mark("p", 0);
  assert.equal(c.ready("p", 500), false);
  assert.equal(c.ready("p", 500), false, "looking doesn't restart the pause");
  assert.equal(c.ready("p", 1000), true);
  assert.equal(c.ready("q", 100), true, "per phone");
});
