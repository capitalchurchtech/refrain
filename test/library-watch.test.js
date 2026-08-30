import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  decideAutoReindex,
  startLibraryWatch,
  fullRebuildSuggestion,
  WATCH_DEFAULTS,
  FULL_REBUILD_SUGGEST_DAYS,
  indexStaleness,
} from "../server/library-watch.js";

const READY = WATCH_DEFAULTS.settleAfterReadyMs + 1000;
const incrementalPlan = (n) => ({ mode: "incremental", needFetch: Array.from({ length: n }, (_, i) => `id${i}`) });

// --- decideAutoReindex ---

test("a small number of changed presentations is reindexed automatically", () => {
  const d = decideAutoReindex({ plan: incrementalPlan(3), readyForMs: READY });
  assert.equal(d.run, true);
  assert.equal(d.count, 3);
});

test("nothing changed means nothing to do", () => {
  const d = decideAutoReindex({ plan: incrementalPlan(0), readyForMs: READY });
  assert.equal(d.run, false);
  assert.equal(d.nothingToDo, true);
});

test("a full rebuild is never started automatically", () => {
  // The decisive guard. A full rebuild took 26.6 minutes on a real library and
  // makes ProPresenter sluggish throughout — never something to begin unasked.
  const d = decideAutoReindex({
    plan: { mode: "full", reason: "indexing settings changed since the last build" },
    readyForMs: READY,
  });
  assert.equal(d.run, false);
  assert.equal(d.needsFullRebuild, true);
  assert.match(d.reason, /settings changed/);
});

test("a large batch of changes is surfaced rather than acted on", () => {
  const d = decideAutoReindex({ plan: incrementalPlan(200), readyForMs: READY });
  assert.equal(d.run, false);
  assert.equal(d.tooMany, true);
  assert.equal(d.count, 200);
});

test("the auto-reindex cap is honoured exactly at its boundary", () => {
  const max = WATCH_DEFAULTS.maxAutoFetch;
  assert.equal(decideAutoReindex({ plan: incrementalPlan(max), readyForMs: READY }).run, true);
  assert.equal(decideAutoReindex({ plan: incrementalPlan(max + 1), readyForMs: READY }).run, false);
});

test("nothing runs while another index build is going", () => {
  const d = decideAutoReindex({ plan: incrementalPlan(1), readyForMs: READY, rebuildInProgress: true });
  assert.equal(d.run, false);
  assert.match(d.reason, /already running/);
});

test("nothing runs while ProPresenter is not answering", () => {
  const d = decideAutoReindex({ plan: incrementalPlan(1), readyForMs: null });
  assert.equal(d.run, false);
  assert.match(d.reason, /not answering/);
});

test("nothing runs in the first minutes after ProPresenter starts answering", () => {
  // Measured: a crawl begun while ProPresenter was still indexing its own media
  // lost 221 of 445 reads. Those same presentations fetched in 15-30ms once it
  // had settled.
  const d = decideAutoReindex({ plan: incrementalPlan(1), readyForMs: 5_000 });
  assert.equal(d.run, false);
  assert.equal(d.retry, true);
  assert.match(d.reason, /settle/);
});

test("nothing runs automatically when playlist crawling is on", () => {
  // A reindex with crawling on re-crawls every playlist, which is the slowest
  // thing Refrain does — not cheap enough to start unasked.
  const d = decideAutoReindex({ plan: incrementalPlan(1), readyForMs: READY, crawlPlaylists: true });
  assert.equal(d.run, false);
  assert.match(d.reason, /playlist crawling/);
});

test("every refusal carries a reason", () => {
  const cases = [
    { plan: incrementalPlan(1), readyForMs: READY, rebuildInProgress: true },
    { plan: incrementalPlan(1), readyForMs: null },
    { plan: incrementalPlan(1), readyForMs: 1 },
    { plan: incrementalPlan(1), readyForMs: READY, crawlPlaylists: true },
    { plan: { mode: "full", reason: "x" }, readyForMs: READY },
    { plan: incrementalPlan(0), readyForMs: READY },
    { plan: incrementalPlan(9999), readyForMs: READY },
    { plan: null, readyForMs: READY },
  ];
  for (const c of cases) {
    const d = decideAutoReindex(c);
    assert.equal(d.run, false);
    assert.ok(d.reason && d.reason.length > 0, `missing reason for ${JSON.stringify(c.plan)}`);
  }
});

// --- startLibraryWatch ---

function harness(overrides = {}) {
  const calls = { plans: 0, reindexes: 0 };
  const deps = {
    dirs: () => [],
    plan: async () => {
      calls.plans += 1;
      return incrementalPlan(2);
    },
    reindex: async () => {
      calls.reindexes += 1;
      return { buildDurationMs: 120 };
    },
    rebuildInProgress: () => false,
    readyForMs: () => READY,
    crawlPlaylists: () => false,
    ...overrides,
  };
  return { deps, calls };
}

test("checkNow reindexes when the plan is small", async () => {
  const { deps, calls } = harness();
  const w = startLibraryWatch(deps, { debounceMs: 1, safetyNetMs: 60_000 });
  try {
    await w.checkNow("test");
    assert.equal(calls.reindexes, 1);
    assert.match(w.status().outcome, /reindexed 2 presentations/);
  } finally {
    w.stop();
  }
});

test("a refused check records what it declined to do, so it can be surfaced", async () => {
  const { deps, calls } = harness({ plan: async () => incrementalPlan(500) });
  const w = startLibraryWatch(deps, { debounceMs: 1, safetyNetMs: 60_000 });
  try {
    await w.checkNow("test");
    assert.equal(calls.reindexes, 0);
    const s = w.status();
    assert.equal(s.pending.count, 500);
    assert.equal(s.pending.needsFullRebuild, false);
    assert.match(s.outcome, /more than Refrain will reindex/);
  } finally {
    w.stop();
  }
});

test("a plan that wants a full rebuild is recorded as pending, not run", async () => {
  const { deps, calls } = harness({ plan: async () => ({ mode: "full", reason: "schema changed" }) });
  const w = startLibraryWatch(deps, { debounceMs: 1, safetyNetMs: 60_000 });
  try {
    await w.checkNow("test");
    assert.equal(calls.reindexes, 0);
    assert.equal(w.status().pending.needsFullRebuild, true);
  } finally {
    w.stop();
  }
});

test("a failing plan is reported rather than thrown", async () => {
  const { deps, calls } = harness({
    plan: async () => {
      throw new Error("ProPresenter went away");
    },
  });
  const w = startLibraryWatch(deps, { debounceMs: 1, safetyNetMs: 60_000 });
  try {
    await w.checkNow("test");
    assert.equal(calls.reindexes, 0);
    assert.match(w.status().outcome, /could not check: ProPresenter went away/);
  } finally {
    w.stop();
  }
});

test("a failing reindex is reported rather than thrown", async () => {
  const { deps } = harness({
    reindex: async () => {
      throw new Error("socket hang up");
    },
  });
  const w = startLibraryWatch(deps, { debounceMs: 1, safetyNetMs: 60_000 });
  try {
    await w.checkNow("test");
    assert.match(w.status().outcome, /reindex failed: socket hang up/);
  } finally {
    w.stop();
  }
});

test("overlapping checks do not run twice at once", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { deps, calls } = harness({
    plan: async () => {
      calls.plans += 1;
      await gate;
      return incrementalPlan(1);
    },
  });
  const w = startLibraryWatch(deps, { debounceMs: 1, safetyNetMs: 60_000 });
  try {
    const first = w.checkNow("a");
    const second = w.checkNow("b"); // must be dropped while the first is mid-flight
    release();
    await Promise.all([first, second]);
    assert.equal(calls.reindexes, 1, "a second check must not pile on top of the first");
  } finally {
    w.stop();
  }
});

test("a real .pro file change triggers a debounced reindex, and other files do not", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-watch-"));
  const { deps, calls } = harness({ dirs: () => [dir] });
  const w = startLibraryWatch(deps, { debounceMs: 40, safetyNetMs: 60_000 });
  try {
    await writeFile(path.join(dir, "notes.txt"), "ignore me");
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(calls.reindexes, 0, "a non-presentation file must not trigger anything");

    await writeFile(path.join(dir, "song.pro"), "AAA");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(calls.reindexes, 1, "a .pro write should trigger exactly one reindex");
  } finally {
    w.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a burst of saves collapses into a single reindex", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-watch-"));
  const { deps, calls } = harness({ dirs: () => [dir] });
  const w = startLibraryWatch(deps, { debounceMs: 120, safetyNetMs: 60_000 });
  try {
    for (const n of ["a", "b", "c", "d"]) {
      await writeFile(path.join(dir, `${n}.pro`), "x");
      await new Promise((r) => setTimeout(r, 15));
    }
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(calls.reindexes, 1, "four saves in a row are one edit session, not four reindexes");
  } finally {
    w.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("stop() means no further work happens", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-watch-"));
  const { deps, calls } = harness({ dirs: () => [dir] });
  const w = startLibraryWatch(deps, { debounceMs: 20, safetyNetMs: 60_000 });
  w.stop();
  try {
    await writeFile(path.join(dir, "song.pro"), "AAA");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(calls.reindexes, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unwatchable folder does not stop the watcher starting", () => {
  const { deps } = harness({ dirs: () => ["/definitely/not/a/real/folder"] });
  const w = startLibraryWatch(deps, { debounceMs: 1, safetyNetMs: 60_000 });
  assert.equal(w.status().watching, 0);
  w.stop();
});

// --- fullRebuildSuggestion ---

test("no full-rebuild suggestion before the threshold", () => {
  assert.equal(fullRebuildSuggestion(0), null);
  assert.equal(fullRebuildSuggestion(FULL_REBUILD_SUGGEST_DAYS - 1), null);
  assert.equal(fullRebuildSuggestion(null), null);
});

test("a full rebuild is suggested once the library has not been fully read in a quarter", () => {
  const s = fullRebuildSuggestion(FULL_REBUILD_SUGGEST_DAYS);
  assert.equal(s.daysSince, FULL_REBUILD_SUGGEST_DAYS);
  assert.match(s.message, /playlist membership/);
  assert.match(s.message, /quiet hour/);
});

test("performance mode stops the watcher before it makes any call at all", async () => {
  // The promise is that Refrain goes completely quiet, not that it looks
  // around and then behaves. If plan() runs, that is an API call we said we
  // would not make.
  const { deps, calls } = harness({ frozen: () => true });
  const w = startLibraryWatch(deps, { debounceMs: 1, safetyNetMs: 60_000 });
  try {
    await w.checkNow("test");
    assert.equal(calls.plans, 0, "performance mode must prevent even the check");
    assert.equal(calls.reindexes, 0);
    assert.match(w.status().outcome, /performance mode is on/);
  } finally {
    w.stop();
  }
});

test("the watcher resumes once performance mode ends", async () => {
  let armed = true;
  const { deps, calls } = harness({ frozen: () => armed });
  const w = startLibraryWatch(deps, { debounceMs: 1, safetyNetMs: 60_000 });
  try {
    await w.checkNow("while armed");
    assert.equal(calls.reindexes, 0);
    armed = false;
    await w.checkNow("after");
    assert.equal(calls.reindexes, 1, "work deferred during a service must happen afterwards");
  } finally {
    w.stop();
  }
});

// --- index staleness: the silent failure ---

test("a fresh index says nothing at all", () => {
  // Not a "fresh" object -- null, so the caller renders nothing. An all-clear
  // nobody asked for is noise on the screen used under pressure.
  const now = Date.UTC(2026, 7, 30);
  assert.equal(indexStaleness(new Date(now).toISOString(), now), null);
  assert.equal(indexStaleness(new Date(now - 47 * 3600_000).toISOString(), now), null);
});

test("two days old is the threshold, and it reports the age", () => {
  const now = Date.UTC(2026, 7, 30);
  const s = indexStaleness(new Date(now - 2 * 86_400_000).toISOString(), now);
  assert.equal(s.days, 2);
  assert.match(s.message, /Index is 2 days old\. Refresh\./);
});

test("the observed case: four days, which renders identically to fresh today", () => {
  const now = Date.UTC(2026, 7, 30);
  const s = indexStaleness(new Date(now - 4 * 86_400_000).toISOString(), now);
  assert.equal(s.days, 4);
  assert.match(s.message, /4 days old/);
});

test("one day is singular, if the threshold is ever lowered", () => {
  const now = Date.UTC(2026, 7, 30);
  const s = indexStaleness(new Date(now - 86_400_000).toISOString(), now, 1);
  assert.match(s.message, /Index is 1 day old/);
});

test("a missing or unparseable builtAt reports nothing rather than guessing", () => {
  const now = Date.UTC(2026, 7, 30);
  for (const bad of [null, undefined, "", "not a date", 0]) {
    assert.equal(indexStaleness(bad, now), null);
  }
});

test("a builtAt in the future is not stale", () => {
  // Clock skew between two machines sharing a synced folder should not produce
  // a negative age rendered as staleness.
  const now = Date.UTC(2026, 7, 30);
  assert.equal(indexStaleness(new Date(now + 86_400_000).toISOString(), now), null);
});
