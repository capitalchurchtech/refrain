import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeModules } from "../public/health.js";

test("the Modules tile puts a misconfigured module first and lights", () => {
  const s = summarizeModules({
    arrangementModule: { status: "active", pendingUploads: 0 },
    networkModule: { status: "misconfigured" },
  });
  assert.equal(s.headline, "1 needs setup");
  assert.equal(s.detail, "Phone flags misconfigured · Arrangement active");
  assert.equal(s.attention, true);
});

test("uploads still waiting for shared storage are counted, and light the tile", () => {
  const s = summarizeModules({ arrangementModule: { status: "active", pendingUploads: 2 } });
  assert.equal(s.headline, "Nothing misconfigured");
  assert.match(s.detail, /2 uploads waiting$/);
  assert.equal(s.attention, true);
});

test("all quiet reads as quiet, and missing sections do not throw", () => {
  const s = summarizeModules({ arrangementModule: { status: "off" } });
  assert.equal(s.attention, false);
  assert.deepEqual(summarizeModules({}), { headline: "Nothing misconfigured", detail: "", attention: false });
});

test("Settings > Search says in one line what search reads, from the index itself", async () => {
  const { searchScopeSummary } = await import("../public/health.js");
  assert.equal(searchScopeSummary({ selected: null, indexed: { Songs: 184, Messages: 261 } }), "Searching every library: 445 presentations.");
  assert.equal(
    searchScopeSummary({ folders: ["Songs", "Messages", "Misc"], selected: ["Songs"], indexed: { Songs: 184 } }),
    "Searching 1 of 3 libraries (Songs): 184 presentations."
  );
  assert.equal(searchScopeSummary({ selected: [], indexed: {} }), "No libraries chosen, so search is empty.");
  // ProPresenter not answering: no folder list, but what's searched is still known.
  assert.equal(searchScopeSummary({ selected: ["Songs"], indexed: { Songs: 1 } }), "Searching 1 library (Songs): 1 presentation.");
});
