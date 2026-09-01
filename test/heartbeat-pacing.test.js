import test from "node:test";
import assert from "node:assert/strict";
import {
  heartbeatInterval,
  callsPerHour,
  CLIENT_ACTIVE_MS,
  HEARTBEAT_ACTIVE_MS,
  HEARTBEAT_IDLE_MS,
} from "../server/heartbeat-pacing.js";

const NOW = 1_800_000_000_000;

test("a browser polling right now gets the responsive rate", () => {
  assert.equal(heartbeatInterval({ lastClientAt: NOW, now: NOW }), HEARTBEAT_ACTIVE_MS);
});

test("still responsive just inside the window", () => {
  const t = NOW - CLIENT_ACTIVE_MS + 1000;
  assert.equal(heartbeatInterval({ lastClientAt: t, now: NOW }), HEARTBEAT_ACTIVE_MS);
});

test("backs off once nobody has polled for a while", () => {
  const t = NOW - CLIENT_ACTIVE_MS - 1000;
  assert.equal(heartbeatInterval({ lastClientAt: t, now: NOW }), HEARTBEAT_IDLE_MS);
});

test("a machine nobody has ever opened starts idle, not active", () => {
  // A booth machine booted for a service with nobody at the desk. Treating
  // "never seen" as active is how 43,200 requests a day happened.
  assert.equal(heartbeatInterval({ lastClientAt: null, now: NOW }), HEARTBEAT_IDLE_MS);
  assert.equal(heartbeatInterval({}), HEARTBEAT_IDLE_MS);
});

test("a clock that jumped backwards does not strand it at idle", () => {
  // Two machines on a synced folder, or an NTP correction. A negative age must
  // not read as "ages ago".
  assert.equal(heartbeatInterval({ lastClientAt: NOW + 60_000, now: NOW }), HEARTBEAT_ACTIVE_MS);
});

test("idle still polls often enough for performance mode to arm in time", () => {
  // Performance mode learns a service started by watching the screens, and
  // arms after two minutes of live output. The idle rate has to sample that
  // several times over, or it would arm late — exactly when it matters.
  assert.ok(HEARTBEAT_IDLE_MS * 4 <= 2 * 60_000, `idle ${HEARTBEAT_IDLE_MS}ms is too slow to arm on time`);
});

test("the idle rate is a large reduction, which is the point", () => {
  const active = callsPerHour(HEARTBEAT_ACTIVE_MS);
  const idle = callsPerHour(HEARTBEAT_IDLE_MS);
  assert.equal(active, 1800);
  assert.equal(idle, 240);
  assert.ok(idle < active / 5, `${idle}/hr vs ${active}/hr is not worth the complexity`);
});
