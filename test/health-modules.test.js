import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeModules } from "../public/health.js";

test("the Modules tile puts a misconfigured module first and lights", () => {
  const s = summarizeModules({
    arrangementModule: { status: "active", pendingUploads: 0 },
    shareLibrary: { status: "misconfigured" },
  });
  assert.equal(s.headline, "1 needs setup");
  assert.equal(s.detail, "Share Library misconfigured · Arrangement active");
  assert.equal(s.attention, true);
});

test("uploads still waiting for shared storage are counted, and light the tile", () => {
  const s = summarizeModules({ arrangementModule: { status: "active", pendingUploads: 2 }, shareLibrary: { status: "off" } });
  assert.equal(s.headline, "Nothing misconfigured");
  assert.match(s.detail, /2 uploads waiting$/);
  assert.equal(s.attention, true);
});

test("all quiet reads as quiet, and missing sections do not throw", () => {
  const s = summarizeModules({ arrangementModule: { status: "off" }, shareLibrary: { status: "off" } });
  assert.equal(s.attention, false);
  assert.deepEqual(summarizeModules({}), { headline: "Nothing misconfigured", detail: "", attention: false });
});
