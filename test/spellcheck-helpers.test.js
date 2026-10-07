import { test } from "node:test";
import assert from "node:assert/strict";
import { nearestServicePlaylist, resolveFilter } from "../public/spellcheck.js";

const NOW = Date.parse("2026-10-11T09:00:00Z");
const svc = (name, startsAt, id) => ({ name, startsAt, playlist: id ? { id, name: `List ${id}` } : null });
const lists = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];

test("the playlist chosen is the nearest service's, among those ProPresenter listed", () => {
  const services = [svc("Early", "2026-10-11T08:00:00Z", "p1"), svc("Late", "2026-10-11T11:00:00Z", "p2"), svc("Soon", "2026-10-11T09:20:00Z", "p3")];
  assert.equal(nearestServicePlaylist(services, lists, NOW).name, "Soon");
  assert.equal(nearestServicePlaylist(services, [{ id: "p2" }], NOW).name, "Late", "a playlist not in the list is skipped");
});

test("a service with no time loses to one with a time, and no qualifying service gives null", () => {
  assert.equal(nearestServicePlaylist([svc("Untimed", null, "p1"), svc("Timed", "2026-10-11T20:00:00Z", "p2")], lists, NOW).name, "Timed");
  assert.equal(nearestServicePlaylist([svc("Untimed", null, "p1")], lists, NOW).name, "Untimed", "alone, it still counts");
  assert.equal(nearestServicePlaylist([svc("None", "2026-10-11T09:00:00Z", null)], lists, NOW), null);
  assert.equal(nearestServicePlaylist(undefined, lists, NOW), null);
  assert.equal(nearestServicePlaylist([svc("A", "2026-10-11T09:00:00Z", "p9")], lists, NOW), null);
});

test("a count filter with nothing left falls back to All", () => {
  const counts = { all: 3, words: 2, dates: 0, media: 0 };
  assert.equal(resolveFilter("words", counts), "words");
  assert.equal(resolveFilter("dates", counts), "all");
  assert.equal(resolveFilter("all", { all: 0, words: 0, dates: 0, media: 0 }), "all");
});
