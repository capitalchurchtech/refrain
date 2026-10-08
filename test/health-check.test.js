import { test } from "node:test";
import assert from "node:assert/strict";
import { healthCheckHtml, indexAge } from "../public/health-check.js";

const NOW = Date.parse("2026-10-11T10:00:00Z");
const base = { connected: true, host: "localhost", port: 1025, feed: "ok", armed: false, indexBuiltAt: "2026-10-11T09:58:00Z", indexCount: 445 };

test("indexAge says minutes, hours, then a date, and nothing for a bad time", () => {
  assert.equal(indexAge("2026-10-11T09:59:50Z", NOW), "just now");
  assert.equal(indexAge("2026-10-11T09:50:00Z", NOW), "10 min ago");
  assert.equal(indexAge("2026-10-11T05:00:00Z", NOW), "5 h ago");
  assert.equal(indexAge("nonsense", NOW), "");
  assert.equal(indexAge(null, NOW), "");
});

test("a healthy console reads linked, flowing, and shows its index age", () => {
  const html = healthCheckHtml(base, NOW);
  assert.match(html, /Answering at localhost:1025/);
  assert.match(html, />Linked</);
  assert.match(html, />Flowing</);
  assert.match(html, /445 songs, updated 2 min ago/);
  assert.match(html, /data-hc="perf"[^>]*>Turn on</);
  assert.match(html, /data-hc="refresh"/);
  assert.doesNotMatch(html, /data-hc-row="modules"/, "no Modules row when nothing needs a look");
});

test("a lost link, a failing feed and an unbuilt index are each said plainly, in amber", () => {
  const html = healthCheckHtml({ ...base, connected: false, feed: "fault", indexBuiltAt: null }, NOW);
  assert.match(html, /Not answering at localhost:1025/);
  assert.match(html, />No link</);
  assert.match(html, /Not getting through\. See Settings/);
  assert.match(html, /Not built yet\. Search is empty until it is\./);
  assert.equal((html.match(/data-tone="fault"/g) ?? []).length >= 3, true);
});

test("performance mode offers the opposite of its state, an unknown feed reads off, and Modules appears only when it needs a look", () => {
  assert.match(healthCheckHtml({ ...base, armed: true }, NOW), /data-hc="perf"[^>]*>Turn off</);
  assert.match(healthCheckHtml({ ...base, feed: "something-new" }, NOW), />Off</);
  const withModules = healthCheckHtml({ ...base, modules: { attention: true, headline: "1 needs a look", detail: "Service feed: no key" } }, NOW);
  assert.match(withModules, /data-hc-row="modules"/);
  assert.match(withModules, /Service feed: no key/);
});

test("names from the server are escaped", () => {
  assert.doesNotMatch(healthCheckHtml({ ...base, host: "<img src=x>" }, NOW), /<img/);
});
