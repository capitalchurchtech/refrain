import { test } from "node:test";
import assert from "node:assert/strict";
import { monthKey, endOfMonth, deviceCode, createLiveGate, appendTakeover, MAX_WRONG, LOCK_MS, REQUEST_TTL_MS } from "../server/remote-live.js";
import { emptyRegistry, seeDevice, setLiveMonth, isLiveAllowed, removeDevice, deviceList } from "../server/remote-devices.js";

test("the device code is four digits, steady for the month, different next month and per secret", () => {
  const a = deviceCode("secret-one", "2026-10");
  assert.match(a, /^\d{4}$/);
  assert.equal(deviceCode("secret-one", "2026-10"), a);
  assert.notEqual(deviceCode("secret-two", "2026-10"), a);
  // Four digits can collide for one pair of months, so check across a year.
  const year = new Set(Array.from({ length: 12 }, (_, i) => deviceCode("secret-one", `2026-${String(i + 1).padStart(2, "0")}`)));
  assert.ok(year.size > 6);
});

test("month keys and the end of the month follow the local calendar", () => {
  assert.equal(monthKey(new Date(2026, 9, 31, 23, 59).getTime()), "2026-10");
  assert.equal(monthKey(new Date(2026, 10, 1, 0, 0).getTime()), "2026-11");
  assert.equal(endOfMonth(new Date(2026, 11, 15).getTime()), new Date(2027, 0, 1).getTime());
});

test("a phone is allowed only in the month it typed the code, and removing it ends that", () => {
  let reg = seeDevice(emptyRegistry(), "p1", { name: "Sam", signIn: true });
  assert.equal(isLiveAllowed(reg, "p1", "2026-10"), false);
  reg = setLiveMonth(reg, "p1", "2026-10");
  assert.equal(isLiveAllowed(reg, "p1", "2026-10"), true);
  assert.equal(isLiveAllowed(reg, "p1", "2026-11"), false, "a new month locks it again");
  assert.equal(isLiveAllowed(reg, "p2", "2026-10"), false, "an unknown phone is never allowed");
  assert.equal(isLiveAllowed(reg, "p1", null), false);
  // Seen again (a refresh) keeps it; signing in again as a removed phone starts over.
  reg = seeDevice(reg, "p1", {});
  assert.equal(isLiveAllowed(reg, "p1", "2026-10"), true);
  assert.equal(deviceList(reg, Date.now(), "2026-10")[0].live, true);
  reg = removeDevice(reg, "p1");
  assert.equal(isLiveAllowed(reg, "p1", "2026-10"), false);
  reg = seeDevice(reg, "p1", { name: "Sam", signIn: true });
  assert.equal(isLiveAllowed(reg, "p1", "2026-10"), false, "a phone that was removed starts unallowed");
});

const slideAction = { kind: "golive", presentationId: "P1", slideIndex: 3, label: "Amazing Grace, slide 4" };
const gate = (extra = {}) => createLiveGate({ codeOf: () => "1111", idOf: (() => { let n = 0; return () => `r${++n}`; })(), ...extra });

test("a right request code returns the action once; the same request cannot be reused", () => {
  const g = gate();
  const r = g.request("p1", slideAction, 1000);
  assert.deepEqual([r.ok, r.code, r.requestId], [true, "1111", "r1"]);
  const a = g.approve("p1", r.requestId, "1111", 2000);
  assert.equal(a.ok, true);
  assert.deepEqual(a.action, slideAction);
  assert.equal(g.approve("p1", r.requestId, "1111", 2500).expired, true, "single use");
});

test("a request code works only for the phone it was made for, and only for a minute", () => {
  const g = gate();
  const r = g.request("p1", slideAction, 0);
  assert.equal(g.approve("p2", r.requestId, "1111", 10).expired, true);
  // The other phone's attempt must not have used up p1's request.
  const r2 = g.request("p1", slideAction, 20);
  assert.equal(g.approve("p1", r2.requestId, "1111", 20 + REQUEST_TTL_MS + 1).expired, true);
});

test("asking again replaces the phone's earlier request", () => {
  const g = gate();
  const first = g.request("p1", slideAction, 0);
  const second = g.request("p1", { ...slideAction, slideIndex: 9 }, 5);
  assert.equal(g.approve("p1", first.requestId, "1111", 10).expired, true);
  assert.equal(g.approve("p1", second.requestId, "1111", 10).action.slideIndex, 9);
});

test("wrong codes are counted, a wrong one gets a fresh code, and the third locks the phone out", () => {
  const codes = ["1111", "2222", "3333", "4444"];
  const g = createLiveGate({ codeOf: () => codes.shift(), idOf: () => "r" });
  const r = g.request("p1", slideAction, 0);
  const w1 = g.approve("p1", r.requestId, "0000", 1);
  assert.deepEqual([w1.ok, w1.wrong, w1.left, w1.code], [false, true, MAX_WRONG - 1, "2222"]);
  assert.equal(g.approve("p1", r.requestId, "1111", 2).wrong, true, "the old code no longer works");
  const w3 = g.approve("p1", r.requestId, "0000", 3);
  assert.equal(w3.ok, false);
  assert.equal(w3.lockedMs, LOCK_MS);
  assert.equal(g.request("p1", slideAction, 4).ok, false, "locked out of asking");
  assert.equal(g.request("p2", slideAction, 4).ok, true, "another phone is unaffected");
  assert.equal(g.request("p1", slideAction, 3 + LOCK_MS + 1).ok, true, "free again after five minutes");
});

test("wrong device codes and wrong request codes share one count, and a right code clears it", () => {
  const g = gate();
  assert.equal(g.failDevice("p1", 0), 2);
  assert.equal(g.failDevice("p1", 1), 1);
  g.succeed("p1");
  assert.equal(g.failDevice("p1", 2), 2, "success starts the count again");
  g.failDevice("p1", 3);
  assert.equal(g.failDevice("p1", 4), 0);
  assert.ok(g.lockedMs("p1", 5) > 0);
});

test("the take-over log keeps newest first, capped, with no codes and trimmed text", () => {
  let log = [];
  for (let i = 0; i < 205; i++) log = appendTakeover(log, { phone: `Phone ${i}`, slide: "Hymn, slide 1", replaced: null });
  assert.equal(log.length, 200);
  assert.equal(log[0].phone, "Phone 204");
  const failed = appendTakeover([], { phone: "x".repeat(100), slide: "s", ok: false, error: "ProPresenter isn't answering." })[0];
  assert.equal(failed.phone.length, 40);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "ProPresenter isn't answering.");
  assert.doesNotMatch(JSON.stringify(failed), /code/i);
});
