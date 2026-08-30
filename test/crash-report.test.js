import test from "node:test";
import assert from "node:assert/strict";
import { crumb, readCrumbs, resetCrumbs, MAX_CRUMBS } from "../public/breadcrumbs.js";
import { buildCrashReport, describeError, safeJson } from "../public/crash-report.js";
import { readGitHead, shortCommit, buildInfo } from "../server/build-info.js";

// --- breadcrumbs: the part where a bug leaks church data ---

test("a breadcrumb records what was pressed", () => {
  resetCrumbs();
  crumb("search", { results: 117 });
  const [c] = readCrumbs();
  assert.equal(c.action, "search");
  assert.equal(c.results, 117);
});

test("free text is dropped, not truncated — a truncated lyric is still a lyric", () => {
  resetCrumbs();
  crumb("search", { query: "Amazing grace how sweet the sound", results: 4 });
  const [c] = readCrumbs();
  assert.equal(c.query, undefined, "the query never reaches the report");
  assert.equal(c.results, 4, "the count does");
});

test("presentation names and slide text are refused", () => {
  resetCrumbs();
  crumb("golive", {
    name: "Great Is Thy Faithfulness",
    text: "Morning by morning new mercies I see",
    slide: 12,
  });
  const [c] = readCrumbs();
  assert.equal(c.name, undefined);
  assert.equal(c.text, undefined);
  assert.equal(c.slide, 12);
});

test("a UUID is kept, because it names nothing", () => {
  resetCrumbs();
  crumb("golive", { presentation: "94097C18-8A53-4E1F-951F-DB7B7CF88ACC" });
  assert.equal(readCrumbs()[0].presentation, "94097C18-8A53-4E1F-951F-DB7B7CF88ACC");
});

test("an identifier-shaped value is kept; a sentence is not", () => {
  resetCrumbs();
  crumb("nav", { to: "health" });
  crumb("nav", { to: "the Health screen, which the user opened" });
  const [a, b] = readCrumbs();
  assert.equal(a.to, "health");
  assert.equal(b.to, undefined);
});

test("the buffer is capped and keeps the newest", () => {
  resetCrumbs();
  for (let i = 0; i < MAX_CRUMBS + 10; i++) crumb("nav", { step: i });
  const all = readCrumbs();
  assert.equal(all.length, MAX_CRUMBS);
  assert.equal(all.at(-1).step, MAX_CRUMBS + 9, "newest kept");
  assert.equal(all[0].step, 10, "oldest dropped");
});

test("a junk action is ignored rather than recorded", () => {
  resetCrumbs();
  crumb("", {});
  crumb(null, {});
  crumb("a name with spaces", {});
  assert.equal(readCrumbs().length, 0);
});

// --- the report: it must never throw, because it runs inside an error handler ---

test("a circular error payload does not break the report", () => {
  resetCrumbs();
  const circular = { name: "boom" };
  circular.self = circular;
  const err = new Error("exploded");
  err.payload = circular;
  const out = buildCrashReport({ error: err, build: { version: "0.11.0", commit: "abc123" } });
  assert.match(out, /Refrain crash report/);
  assert.match(out, /exploded/);
});

test("a thrown non-Error is still described", () => {
  resetCrumbs();
  const out = buildCrashReport({ error: "just a string" });
  assert.match(out, /just a string/);
});

test("null and undefined do not produce an empty report", () => {
  resetCrumbs();
  for (const bad of [null, undefined, 0, false]) {
    const out = buildCrashReport({ error: bad, route: "#search" });
    assert.match(out, /Refrain crash report/);
  }
});

test("a getter that throws costs its line, not the report", () => {
  resetCrumbs();
  const err = new Error("fine");
  Object.defineProperty(err, "stack", {
    get() {
      throw new Error("stack getter exploded");
    },
  });
  const out = buildCrashReport({ error: err, route: "#live" });
  assert.match(out, /Refrain crash report/);
  assert.match(out, /fine/);
});

test("the report leads with the commit, which is the field that makes it fixable", () => {
  resetCrumbs();
  const out = buildCrashReport({
    error: new Error("x"),
    build: { version: "0.11.0", commit: "deadbeef", branch: "main" },
    route: "#health",
  });
  const head = out.split("\n").slice(0, 8).join("\n");
  assert.match(head, /version {4}0\.11\.0/);
  assert.match(head, /commit {5}deadbeef/);
  assert.match(head, /route {6}#health/);
});

test("the breadcrumb trail appears, and says so when empty", () => {
  resetCrumbs();
  assert.match(buildCrashReport({ error: new Error("x") }), /nothing recorded/);
  crumb("nav", { to: "live" });
  assert.match(buildCrashReport({ error: new Error("x") }), /nav/);
});

test("the report states that church data is excluded", () => {
  resetCrumbs();
  assert.match(buildCrashReport({ error: new Error("x") }), /No slide text, search terms/);
});

test("describeError survives anything", () => {
  for (const v of [null, undefined, 0, "", {}, [], new Error("e")]) {
    const d = describeError(v);
    assert.equal(typeof d.message, "string");
    assert.ok(d.class);
  }
});

test("safeJson replaces cycles instead of throwing", () => {
  const a = { n: 1 };
  a.self = a;
  assert.match(safeJson(a), /circular/);
});

// --- build identity ---

test("shortCommit trims to seven, or gives nothing", () => {
  assert.equal(shortCommit("1234567890abcdef"), "1234567");
  assert.equal(shortCommit("abc"), null);
  assert.equal(shortCommit(null), null);
});

test("a missing .git degrades to nulls rather than throwing", () => {
  const r = readGitHead("/nonexistent-path-for-a-test");
  assert.deepEqual(r, { commit: null, branch: null });
  const b = buildInfo({ version: "0.11.0", gitDir: "/nonexistent-path-for-a-test" });
  assert.equal(b.version, "0.11.0");
  assert.equal(b.commit, null);
  assert.equal(b.gitInstall, false);
});

test("this repo's own HEAD resolves, which is the case that ships", () => {
  const { commit, branch } = readGitHead(".git");
  assert.match(commit ?? "", /^[0-9a-f]{40}$/, "a real SHA");
  assert.ok(branch === null || typeof branch === "string");
});
