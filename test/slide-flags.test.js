import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readdir, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildFlag,
  flagId,
  isFlagId,
  saveFlag,
  retryPendingFlags,
  listFlags,
  LIVE_STATE_MAX_AGE_MS,
  flagTypes,
  DEFAULT_FLAG_TYPES,
  buildUpdate,
  saveUpdate,
  visibleFlags,
} from "../server/slide-flags.js";
import { describeFlagSave, groupFlagsByDay, groupByPresentation, renderReviewHtml, renderTypeGridHtml, liveSummaryText } from "../public/slide-flags.js";

const now = Date.parse("2026-09-27T16:05:30.000Z");
const live = (over = {}) => ({
  connected: true,
  live: true,
  checkedAt: now - 2000,
  slide: {
    presentationId: "P-1",
    slideIndex: 12,
    presentationName: "Build My Life",
    arrangementName: "FS",
    folder: "Songs",
    text: "Holy there is no one like You",
  },
  ...over,
});

// --- buildFlag ----------------------------------------------------------------

test("records the live slide from the cached state, text included", () => {
  const r = buildFlag(live(), { now, machine: "booth", indexEntry: { presentationPath: "/lib/Songs/Build My Life.pro" } });
  assert.equal(r.ok, true);
  assert.equal(r.flag.presentationId, "P-1");
  assert.equal(r.flag.slideIndex, 12);
  assert.equal(r.flag.arrangementName, "FS");
  assert.equal(r.flag.text, "Holy there is no one like You", "a snapshot, so the record survives the slide being edited");
  assert.equal(r.flag.presentationPath, "/lib/Songs/Build My Life.pro");
  assert.equal(r.flag.capturedAt, "2026-09-27T16:05:30.000Z");
  assert.equal(r.flag.wasOnScreen, true);
  assert.equal(r.flag.machine, "booth");
  assert.ok(isFlagId(r.flag.id));
});

test("refuses when there is no slide, or ProPresenter is not answering", () => {
  assert.equal(buildFlag(live({ slide: null }), { now }).ok, false);
  assert.equal(buildFlag(live({ connected: false }), { now }).ok, false);
  assert.equal(buildFlag(null, { now }).ok, false);
  assert.match(buildFlag(live({ slide: null }), { now }).error, /cannot see a slide/);
});

test("refuses to guess from state older than one idle heartbeat", () => {
  const stale = buildFlag(live({ checkedAt: now - LIVE_STATE_MAX_AGE_MS - 1 }), { now });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /cannot be sure which slide/);
  assert.equal(buildFlag(live({ checkedAt: now - LIVE_STATE_MAX_AGE_MS + 1000 }), { now }).ok, true);
});

test("a cleared screen still flags the current slide, and says it was not on screen", () => {
  const r = buildFlag(live({ live: false }), { now });
  assert.equal(r.ok, true);
  assert.equal(r.flag.wasOnScreen, false);
});

test("flag ids sort by time, stay unique, and are safe filenames", () => {
  const a = flagId("2026-09-27T16:05:30.000Z");
  const b = flagId("2026-09-27T16:05:30.000Z");
  assert.notEqual(a, b, "two presses in the same millisecond on two machines still differ");
  assert.ok(isFlagId(a));
  assert.doesNotMatch(a, /[:/\\]/, "no colons or slashes -- some synced folders reject colons");
  assert.ok(flagId("2026-09-27T16:05:31.000Z") > flagId("2026-09-27T16:05:30.000Z"));
  assert.equal(isFlagId("../../etc/passwd"), false);
  assert.equal(isFlagId(42), false);
});

// --- saving, retrying, listing -------------------------------------------------

const scratch = await mkdtemp(path.join(tmpdir(), "refrain-flags-"));
after(() => rm(scratch, { recursive: true, force: true }));

// Builds a real flag captured at `iso`, with live state fresh as of that
// moment. Asserts the build succeeded: an earlier version pinned checkedAt to
// one fixed time, so later captures were (correctly) refused as stale, the
// helper saved id-less objects, and one test passed by comparing against
// "undefined.json".
function flagAt(iso, extra = {}) {
  const at = Date.parse(iso);
  const built = buildFlag(live({ checkedAt: at - 2000 }), { now: at, machine: "booth" });
  assert.equal(built.ok, true, `fixture flag at ${iso} was refused: ${built.error}`);
  assert.ok(isFlagId(built.flag.id));
  return { ...built.flag, ...extra };
}

test("a normal save lands in the flags folder and leaves nothing waiting", async () => {
  const folder = path.join(scratch, "normal", "shared");
  const pendingDir = path.join(scratch, "normal", "pending");
  const flag = flagAt("2026-09-27T16:05:30.000Z");
  const r = await saveFlag(flag, { folder, pendingDir });
  assert.deepEqual(r, { shared: true });
  assert.deepEqual(await readdir(folder), [`${flag.id}.json`]);
  assert.deepEqual(await readdir(pendingDir), []);
});

test("an unreachable shared folder keeps the flag on this machine, then catches up", async () => {
  const base = path.join(scratch, "offline");
  await mkdir(base, { recursive: true });
  // A FILE where the folder should be: mkdir fails the way an unmounted
  // network drive does.
  const folder = path.join(base, "shared");
  await writeFile(folder, "not a directory");
  const pendingDir = path.join(base, "pending");

  const flag = flagAt("2026-09-27T16:10:00.000Z");
  const r = await saveFlag(flag, { folder, pendingDir });
  assert.equal(r.shared, false, "the operator is told it is waiting, not that it failed");
  assert.deepEqual(await readdir(pendingDir), [`${flag.id}.json`], "safe on this machine");

  const listed = await listFlags({ folder, pendingDir });
  assert.equal(listed.length, 1, "a waiting flag is still shown");
  assert.equal(listed[0].pending, true);

  // The drive comes back.
  await rm(folder);
  const retry = await retryPendingFlags({ folder, pendingDir });
  assert.deepEqual(retry, { attempted: 1, succeeded: 1 });
  assert.deepEqual(await readdir(pendingDir), []);
  const after = await listFlags({ folder, pendingDir });
  assert.equal(after.length, 1);
  assert.equal(after[0].pending, false);
});

test("two machines sharing one folder see each other's flags, newest first", async () => {
  const folder = path.join(scratch, "two", "shared");
  const booth = flagAt("2026-09-27T16:05:00.000Z", { machine: "booth" });
  const office = flagAt("2026-09-27T16:20:00.000Z", { machine: "office" });
  await saveFlag(booth, { folder, pendingDir: path.join(scratch, "two", "booth-pending") });
  await saveFlag(office, { folder, pendingDir: path.join(scratch, "two", "office-pending") });

  const seenFromBooth = await listFlags({ folder, pendingDir: path.join(scratch, "two", "booth-pending") });
  assert.deepEqual(seenFromBooth.map((f) => f.machine), ["office", "booth"]);
});

test("a damaged or foreign file in the folder is skipped, not fatal", async () => {
  const folder = path.join(scratch, "damaged", "shared");
  const pendingDir = path.join(scratch, "damaged", "pending");
  const good = flagAt("2026-09-27T16:30:00.000Z");
  await saveFlag(good, { folder, pendingDir });
  await writeFile(path.join(folder, "half-synced.json"), "{ not json");
  await writeFile(path.join(folder, "someone-elses.json"), JSON.stringify({ id: "not-a-flag-id" }));
  const listed = await listFlags({ folder, pendingDir });
  assert.deepEqual(listed.map((f) => f.id), [good.id]);
});

test("a flag present in both places is listed once, as the shared copy", async () => {
  const folder = path.join(scratch, "both", "shared");
  const pendingDir = path.join(scratch, "both", "pending");
  const flag = flagAt("2026-09-27T16:40:00.000Z");
  await saveFlag(flag, { folder, pendingDir });
  // As if the unlink after a successful copy had failed.
  await mkdir(pendingDir, { recursive: true });
  await writeFile(path.join(pendingDir, `${flag.id}.json`), JSON.stringify(flag));
  const listed = await listFlags({ folder, pendingDir });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].pending, false);
});

test("an empty or missing folder is an empty list", async () => {
  assert.deepEqual(await listFlags({ folder: path.join(scratch, "nope"), pendingDir: path.join(scratch, "nope2") }), []);
});

test("a flag without a real id is refused, never written as undefined.json", async () => {
  const folder = path.join(scratch, "no-id", "shared");
  const pendingDir = path.join(scratch, "no-id", "pending");
  await assert.rejects(() => saveFlag({ machine: "booth" }, { folder, pendingDir }), /not a valid flag/);
  await assert.rejects(() => saveFlag(undefined, { folder, pendingDir }), /not a valid flag/);
  assert.deepEqual(await readdir(pendingDir).catch(() => []), []);
});

// --- the front end's pure helpers --------------------------------------------


test("the save message never claims the flag is shared when it is only local", () => {
  const flag = { presentationName: "Build My Life", slideIndex: 12 };
  assert.equal(describeFlagSave({ flag, shared: true }), "Flagged Build My Life, slide 13.");
  const waiting = describeFlagSave({ flag, shared: false });
  assert.match(waiting, /Saved on this machine/);
  assert.match(waiting, /will copy to the shared flags folder/);
});

test("slide numbers are shown one-based, the way ProPresenter numbers them", () => {
  assert.match(describeFlagSave({ flag: { presentationName: "X", slideIndex: 0 }, shared: true }), /slide 1\./);
});

test("flags group under the day they were captured, newest day first", () => {
  const groups = groupFlagsByDay([
    { capturedAt: new Date(2026, 8, 27, 10, 0).toISOString() },
    { capturedAt: new Date(2026, 8, 20, 9, 0).toISOString() },
    { capturedAt: new Date(2026, 8, 27, 11, 30).toISOString() },
    { capturedAt: "not a date" },
  ]);
  assert.deepEqual(groups.map((g) => [g.day, g.flags.length]), [["2026-09-27", 2], ["2026-09-20", 1]]);
});

const at = (h, m = 0) => new Date(2026, 8, 27, h, m).toISOString();

test("the review list escapes slide text, and names machines only when there are two", () => {
  const one = renderReviewHtml([
    { id: "a", capturedAt: at(10), presentationName: "Song", presentationId: "P", slideIndex: 2, text: "<script>x</script>", machine: "booth", wasOnScreen: true },
  ]);
  assert.doesNotMatch(one, /<script>x/);
  assert.match(one, /&lt;script&gt;/);
  assert.doesNotMatch(one, /from booth/, "one machine: no need to say which");

  const two = renderReviewHtml([
    { id: "a", capturedAt: at(10), presentationName: "Song", presentationId: "P", slideIndex: 2, machine: "booth" },
    { id: "b", capturedAt: at(11), presentationName: "Song", presentationId: "P", slideIndex: 3, machine: "office", pending: true },
  ]);
  assert.match(two, /from booth/);
  assert.match(two, /from office/);
  assert.match(two, /waiting to copy/);
});

test("an empty review list says how to add a flag", () => {
  assert.match(renderReviewHtml([]), /Nothing flagged/);
});

test("a blank slide says it was blank, rather than showing nothing", () => {
  assert.match(renderReviewHtml([{ id: "a", capturedAt: at(10), presentationName: "Song", presentationId: "P", slideIndex: 3, text: "" }]), /No text on this slide/);
});

test("within a day, presentations come in the order they first came up", () => {
  const groups = groupByPresentation([
    { presentationId: "sermon", capturedAt: at(10, 40) },
    { presentationId: "song", capturedAt: at(10, 5) },
    { presentationId: "sermon", capturedAt: at(10, 20) },
    { presentationId: "song", capturedAt: at(10, 50) },
  ]);
  assert.deepEqual(groups.map((g) => g.presentationId), ["song", "sermon"], "song was flagged first, at 10:05");
  assert.deepEqual(groups[1].flags.map((f) => f.capturedAt), [at(10, 20), at(10, 40)], "and each group's flags by time");
});

test("a type removed from config still shows on old flags, never silently lost", () => {
  const html = renderReviewHtml(
    [{ id: "a", capturedAt: at(10), presentationName: "Song", presentationId: "P", slideIndex: 0, type: "Retired type" }],
    [{ label: "Formatting", icon: "type" }]
  );
  assert.match(html, /<option value="Retired type" selected>Retired type<\/option>/);
});

test("resolved flags past the window are counted, and said to be kept", () => {
  const html = renderReviewHtml([], [], { hiddenResolved: 3, keepResolvedDays: 14 });
  assert.match(html, /3 resolved flags older than 14 days not shown/);
  assert.match(html, /kept, not deleted/);
});

test("the type grid renders every type, escaped, in the order given", () => {
  const html = renderTypeGridHtml([{ label: "Formatting", icon: "type" }, { label: "Typo <b>", icon: "spell-check" }]);
  assert.ok(html.indexOf("Formatting") < html.indexOf("Typo"));
  assert.match(html, /Typo &lt;b&gt;/);
  assert.match(html, /data-lucide="spell-check"/);
});

test("the Live summary counts only open flags", () => {
  assert.equal(liveSummaryText([]), "Nothing flagged and open.");
  assert.equal(liveSummaryText([{ resolved: true }, { resolved: false }, {}]), "2 flagged slides open.");
});

test("the save message names the type when there is one", () => {
  assert.equal(describeFlagSave({ flag: { presentationName: "Song", slideIndex: 0, type: "Formatting" }, shared: true }), "Flagged Song, slide 1 as Formatting.");
});

// --- issue #2: types, changes, and the retention window ---------------------

test("the eleven default types, sorted alphabetically with Other where it falls", () => {
  const labels = flagTypes().map((t) => t.label);
  assert.equal(labels.length, 11);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)));
  assert.ok(labels.indexOf("Other") > 0 && labels.indexOf("Other") < labels.length - 1, "strict alphabetical: Other sits in the middle");
  assert.equal(DEFAULT_FLAG_TYPES.length, 11);
});

test("configured types are sorted at render time, deduped, and given a fallback icon", () => {
  const t = flagTypes([{ label: "Zebra", icon: "zap" }, { label: "Audio" }, "  Lyrics  ", { label: "audio", icon: "x" }, { label: "", icon: "x" }, { label: "Bad icon", icon: "../../x" }]);
  assert.deepEqual(t.map((x) => x.label), ["Audio", "Bad icon", "Lyrics", "Zebra"]);
  assert.equal(t.find((x) => x.label === "Audio").icon, "flag");
  assert.equal(t.find((x) => x.label === "Bad icon").icon, "flag", "an icon name is never a path");
  assert.deepEqual(flagTypes([]).length, 11, "an empty list falls back to the defaults");
});

test("a typed capture records the type; the quick chip records none", () => {
  assert.equal(buildFlag(live(), { now, type: "Formatting" }).flag.type, "Formatting");
  assert.equal(buildFlag(live(), { now }).flag.type, null);
});

test("an update only carries the fields it changes", () => {
  const f = flagAt("2026-09-27T17:00:00.000Z");
  const u = buildUpdate(f.id, { note: "fix the line break" }, { now: Date.parse("2026-09-28T09:00:00.000Z") });
  assert.equal(u.ok, true);
  assert.equal(u.update.note, "fix the line break");
  assert.equal("resolved" in u.update, false);
  assert.equal(buildUpdate("../evil", { note: "x" }).ok, false);
  assert.equal(buildUpdate(f.id, {}).ok, false);
});

test("notes, type changes and resolving apply in order, latest change winning", async () => {
  const folder = path.join(scratch, "edits", "shared");
  const pendingDir = path.join(scratch, "edits", "pending");
  const f = flagAt("2026-09-27T17:00:00.000Z");
  await saveFlag(f, { folder, pendingDir });
  const at = (iso) => ({ now: Date.parse(iso) });
  await saveUpdate(buildUpdate(f.id, { note: "first" }, at("2026-09-28T09:00:00.000Z")).update, { folder, pendingDir });
  await saveUpdate(buildUpdate(f.id, { type: "Typo or spelling" }, at("2026-09-28T09:05:00.000Z")).update, { folder, pendingDir });
  await saveUpdate(buildUpdate(f.id, { note: "second" }, at("2026-09-28T09:10:00.000Z")).update, { folder, pendingDir });
  await saveUpdate(buildUpdate(f.id, { resolved: true }, at("2026-09-28T09:20:00.000Z")).update, { folder, pendingDir });
  const [got] = await listFlags({ folder, pendingDir });
  assert.equal(got.note, "second");
  assert.equal(got.type, "Typo or spelling");
  assert.equal(got.resolved, true);
  assert.equal(got.resolvedAt, "2026-09-28T09:20:00.000Z");
});

test("two machines editing the SAME flag both land -- nothing is rewritten", async () => {
  const folder = path.join(scratch, "same-flag", "shared");
  const f = flagAt("2026-09-27T17:30:00.000Z");
  await saveFlag(f, { folder, pendingDir: path.join(scratch, "same-flag", "booth") });
  // The booth adds a note while the office marks it resolved, near-simultaneously.
  const note = buildUpdate(f.id, { note: "wrong background" }, { now: Date.parse("2026-09-28T09:00:00.000Z"), machine: "booth" }).update;
  const done = buildUpdate(f.id, { resolved: true }, { now: Date.parse("2026-09-28T09:00:01.000Z"), machine: "office" }).update;
  await saveUpdate(note, { folder, pendingDir: path.join(scratch, "same-flag", "booth") });
  await saveUpdate(done, { folder, pendingDir: path.join(scratch, "same-flag", "office") });
  const files = await readdir(path.join(folder, "updates"));
  assert.equal(files.length, 2, "two separate files, so a sync service has nothing to conflict over");
  const [got] = await listFlags({ folder, pendingDir: path.join(scratch, "same-flag", "booth") });
  assert.equal(got.note, "wrong background");
  assert.equal(got.resolved, true);
});

test("marking unresolved again clears the resolved time", async () => {
  const folder = path.join(scratch, "reopen", "shared");
  const pendingDir = path.join(scratch, "reopen", "pending");
  const f = flagAt("2026-09-27T18:00:00.000Z");
  await saveFlag(f, { folder, pendingDir });
  await saveUpdate(buildUpdate(f.id, { resolved: true }, { now: Date.parse("2026-09-28T09:00:00.000Z") }).update, { folder, pendingDir });
  await saveUpdate(buildUpdate(f.id, { resolved: false }, { now: Date.parse("2026-09-28T09:05:00.000Z") }).update, { folder, pendingDir });
  const [got] = await listFlags({ folder, pendingDir });
  assert.equal(got.resolved, false);
  assert.equal(got.resolvedAt, null);
});

test("a change made while the shared folder is down waits, shows, and catches up", async () => {
  const base = path.join(scratch, "edit-offline");
  const folder = path.join(base, "shared");
  const pendingDir = path.join(base, "pending");
  const f = flagAt("2026-09-27T18:30:00.000Z");
  await saveFlag(f, { folder, pendingDir });
  await rm(folder, { recursive: true });
  await writeFile(folder, "unplugged");
  const r = await saveUpdate(buildUpdate(f.id, { note: "offline note" }, { now: Date.parse("2026-09-28T10:00:00.000Z") }).update, { folder, pendingDir });
  assert.equal(r.shared, false);
  await rm(folder);
  const retry = await retryPendingFlags({ folder, pendingDir });
  assert.equal(retry.succeeded, retry.attempted);
  // The flag itself went away with the unplugged drive in this test, so only the
  // update and its flag's pending copy matter: nothing waiting is lost.
  assert.deepEqual(await readdir(path.join(pendingDir, "updates")), []);
});

test("resolved flags drop out of the list after the window, but open ones never do", () => {
  const now2 = Date.parse("2026-10-20T12:00:00.000Z");
  const flags = [
    { id: "open-old", resolved: false },
    { id: "resolved-recent", resolved: true, resolvedAt: "2026-10-15T12:00:00.000Z" },
    { id: "resolved-old", resolved: true, resolvedAt: "2026-09-01T12:00:00.000Z" },
  ];
  assert.deepEqual(visibleFlags(flags, { now: now2, keepResolvedDays: 14 }).map((f) => f.id), ["open-old", "resolved-recent"]);
});
