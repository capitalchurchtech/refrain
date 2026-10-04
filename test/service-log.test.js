import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCall, createCallStats, createAskedCounter, parseProPresenterPs, propresenterLoadNotice, formatServiceLine } from "../server/service-log.js";
import { transitionReason, initialState, armManually } from "../server/performance-mode.js";
import { stamp } from "../server/log-stamp.js";

test("ProPresenter calls are counted by what they cost it", () => {
  assert.equal(classifyCall("/v1/status/layers"), "status");
  assert.equal(classifyCall("/v1/presentation/slide_index"), "status");
  assert.equal(classifyCall("/v1/presentation/ABC/thumbnail/3"), "thumbnail");
  assert.equal(classifyCall("/v1/presentation/ABC"), "document");
  assert.equal(classifyCall("/v1/presentation/active/next/trigger"), "control");
  assert.equal(classifyCall("/v1/clear/layer/slide"), "control");
  assert.equal(classifyCall("/v1/library/XYZ"), "library");
  const stats = createCallStats();
  stats.record({ kind: "status", ms: 4, ok: true });
  stats.record({ kind: "status", ms: 10, ok: false, timedOut: true });
  assert.deepEqual(stats.take(), { status: { n: 2, totalMs: 14, maxMs: 10, failed: 1, timedOut: 1 } });
  assert.deepEqual(stats.take(), {}, "and starts again");
});

test("ProPresenter's own process is read from ps, helpers counted apart", () => {
  const ps = [
    "  PID  %CPU    RSS COMM",
    "  856   0.4 106656 /Users/x/Library/Application Support/RenewedVision/ProPresenter/Helpers/Workspaces/ProPresenter Helper (Workspaces)",
    " 1170  99.0  76608 ProPresenter Helper (Snapshots)",
    "66643  61.6 5511504 /Applications/ProPresenter.app/Contents/MacOS/ProPresenter",
    "71900   1.0 120000 node",
  ].join("\n");
  const p = parseProPresenterPs(ps);
  assert.equal(p.pid, 66643);
  assert.equal(p.cpu, 61.6);
  assert.equal(p.rssMB, 5382);
  assert.equal(p.helpers.count, 2);
  assert.equal(Math.round(p.helpers.cpu), 99);
  assert.equal(parseProPresenterPs("71900 1.0 120000 node"), null, "not running");
});

test("a heavy ProPresenter gets one plain sentence; an ordinary one gets none", () => {
  const mb = (gb) => gb * 1024;
  assert.equal(propresenterLoadNotice([{ cpu: 60, rssMB: mb(5) }], mb(32)), null);
  const mem = propresenterLoadNotice([{ cpu: 60, rssMB: mb(11) }], mb(16));
  assert.equal(mem.kind, "memory");
  assert.match(mem.message, /11 GB of this Mac's 16 GB.*restart it between services/);
  const busy = Array.from({ length: 5 }, () => ({ cpu: 210, rssMB: mb(4) }));
  assert.equal(propresenterLoadNotice(busy, mb(32)).kind, "cpu");
  assert.equal(propresenterLoadNotice(busy.slice(0, 4), mb(32)), null, "a short burst isn't news");
  assert.equal(propresenterLoadNotice([null], mb(32)), null);
});

test("the minute line says what Refrain asked, how it went, and how both apps are doing", () => {
  const line = formatServiceLine({
    why: "service",
    paceMs: 4000,
    calls: { status: { n: 30, totalMs: 120, maxMs: 9, failed: 0, timedOut: 0 }, thumbnail: { n: 2, totalMs: 60, maxMs: 40, failed: 1, timedOut: 0 } },
    refrain: { cpu: 1.2, rssMB: 180, loopMaxMs: 12, loopP99Ms: 3 },
    propresenter: { cpu: 70, rssMB: 7000, helpers: { count: 2, cpu: 5, rssMB: 180 } },
    performance: { armed: true, source: "auto" },
    index: null,
  });
  assert.match(line, /checking every 4s/);
  assert.match(line, /status 30 avg 4ms max 9ms, thumbnail 2 avg 30ms max 40ms 1 failed/);
  assert.match(line, /Refrain 1% CPU 180 MB, stalls up to 12ms/);
  assert.match(line, /ProPresenter 70% CPU 6\.8 GB/);
  assert.match(line, /performance mode on \(auto\)/);
});

test("performance mode says why it turned off, not a dash and nothing", () => {
  const off = initialState();
  assert.match(transitionReason({ ...off, armed: true, source: "unknown" }, off), /answering again/);
  assert.match(transitionReason({ ...off, armed: true, source: "auto" }, off), /clear for 20 minutes/);
  assert.equal(transitionReason(armManually(off, 0), off), "Off by hand.");
  assert.match(transitionReason(off, armManually(off, 0)), /On by hand/);
});

test("log lines carry a local timestamp", () => {
  assert.equal(stamp(new Date(2026, 8, 27, 9, 5, 7)), "2026-09-27 09:05:07");
});

test("what Refrain asked of this ProPresenter is counted once per thing, and starts again when it restarts", () => {
  const asked = createAskedCounter();
  asked.seen(100);
  for (const p of ["/v1/presentation/A", "/v1/presentation/A", "/v1/presentation/B", "/v1/presentation/slide_index", "/v1/presentation/A/thumbnail/3", "/v1/presentation/A/thumbnail/3", "/v1/status/layers"]) asked.note(p);
  assert.deepEqual(asked.counts(), { documents: 2, pictures: 1 });
  asked.seen(100);
  assert.deepEqual(asked.counts(), { documents: 2, pictures: 1 }, "same process");
  asked.seen(200);
  assert.deepEqual(asked.counts(), { documents: 0, pictures: 0 }, "ProPresenter restarted");
  // A big index run is worth a restart before the service.
  const n = propresenterLoadNotice([{ cpu: 50, rssMB: 4000 }], 32 * 1024, { asked: { documents: 320, pictures: 10 } });
  assert.equal(n.kind, "documents");
  assert.match(n.message, /read 320 presentations through this ProPresenter.*Restart ProPresenter before the service/);
});

test("the stage message: reading it is a look, showing or taking it down is a press", () => {
  assert.equal(classifyCall("/v1/stage/message", "GET"), "status");
  assert.equal(classifyCall("/v1/stage/message", "PUT"), "control");
  assert.equal(classifyCall("/v1/stage/message", "DELETE"), "control");
  assert.equal(classifyCall("/v1/stage/message"), "status");
});
