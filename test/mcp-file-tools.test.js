// The general MCP tools (server/mcp/file-tools.js) on the package's invented files, through the SDK client so
// every result is also checked against its schema; and the guard that keeps every tool away from
// ProPresenter's database (server/mcp/paths.js). No ProPresenter and no Bundles setting is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../server/mcp/server.js";
import { openablePath, forbiddenReason } from "../server/mcp/paths.js";

const lib = await import("propresenter-bundle").catch(() => null);
const skip = lib?.readThemeFile ? false : "propresenter-bundle with theme support is not installed";
const require = createRequire(import.meta.url);
const FIX = lib ? path.join(path.dirname(require.resolve("propresenter-bundle/package.json")), "test", "fixtures") : null;

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-files-"));
  const staging = path.join(root, "staging");
  // Bundles off: the general tools must not need it.
  const server = createMcpServer({ root, staging, getConfig: () => ({ features: { probundle: false } }) });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  await client.listTools();
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(r.content.map((c) => c.text).join(" "));
    return r.structuredContent;
  };
  return { root, staging, call };
}

test("ProPresenter's database is refused however it is reached; documents elsewhere open", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-guard-"));
  const db = path.join(root, "RenewedVision", "ProPresenter", "Workspaces", "Main-123", "Database");
  fs.mkdirSync(db, { recursive: true });
  for (const f of ["CURRENT", "000123.sst", "LOCK", "looks-like.pro"]) fs.writeFileSync(path.join(db, f), "x");
  assert.throws(() => openablePath(path.join(db, "CURRENT")), /Workspaces folder.*never reads ProPresenter's database/);
  assert.throws(() => openablePath(path.join(db, "looks-like.pro")), /Workspaces folder/);
  assert.match(forbiddenReason("/x/Database.broken-20260911/a.pro"), /folder named Database/);

  // A link from somewhere ordinary into the database is followed and refused.
  fs.symlinkSync(path.join(db, "looks-like.pro"), path.join(root, "innocent.pro"));
  assert.throws(() => openablePath(path.join(root, "innocent.pro")), /never reads ProPresenter's database/);
  // And a link with a document's name to a file that is not one.
  fs.symlinkSync(path.join(db, "000123.sst"), path.join(root, "also.pro"));
  assert.throws(() => openablePath(path.join(root, "also.pro")), /never reads/);

  assert.throws(() => openablePath(path.join(root, "notes.txt")), /Only ProPresenter documents open here/);
  assert.throws(() => openablePath(path.join(root, "missing.pro")), /No file at/);
  fs.mkdirSync(path.join(root, "folder.pro"));
  assert.throws(() => openablePath(path.join(root, "folder.pro")), /is a folder/);
  const library = path.join(root, "RenewedVision", "ProPresenter", "UserWorkspaces", "Main", "Libraries", "Default");
  fs.mkdirSync(library, { recursive: true });
  fs.writeFileSync(path.join(library, "Song.pro"), "x");
  assert.equal(openablePath(path.join(library, "Song.pro")), fs.realpathSync(path.join(library, "Song.pro")), "a library presentation is a document");
});

test("open and read a bundle and a theme, read only", { skip }, async () => {
  const { call } = await setup();
  const bundle = path.join(FIX, "sample.probundle");
  const before = fs.readFileSync(bundle);
  const o = await call("refrain_open", { path: bundle });
  assert.equal(typeof o.slides[0].boxes, "number", "in brief unless the boxes are asked for");
  assert.match(o.slides[0].words, /Welcome, everyone/);
  const withBoxes = await call("refrain_open", { path: bundle, boxes: true });
  assert.equal(o.kind, "probundle");
  assert.equal(o.slide_count, 4);
  assert.equal(o.can_change, false, "sample.pro carries a field the schema lacks");
  assert.deepEqual(o.slides.map((s) => s.label), ["Welcome", "Speaker Intro", "Harvest Supper", "Blank"]);
  assert.match(withBoxes.slides[0].boxes[0].id, /^[0-9A-F-]{36}$/);

  const s = await call("refrain_read_slide", { path: bundle, slide: 3 });
  assert.equal(s.slide.label, "Harvest Supper");
  assert.ok(s.slide.boxes.every((b) => "bounds" in b && "font" in b));
  assert.ok(fs.readFileSync(bundle).equals(before), "nothing was written to the file opened");

  const t = await call("refrain_open", { path: path.join(FIX, "sample.protheme") });
  assert.deepEqual([t.kind, t.name, t.slide_count, t.can_change], ["protheme", "Example Theme", 2, true]);
  const c = await call("refrain_check", { path: path.join(FIX, "sample.protheme") });
  assert.deepEqual(c.findings.map((f) => f.code), ["same-name"], "two boxes on the Verse slide are both called Text");
});

test("a theme is tidied on a working copy; the original never changes", { skip }, async () => {
  const { call, staging } = await setup();
  const original = path.join(FIX, "sample.protheme");
  const before = fs.readFileSync(original);
  const copy = await call("refrain_make_copy", { path: original });
  assert.ok(copy.file.startsWith(staging));
  assert.equal(path.basename(copy.file), "sample (edited).protheme");
  const boxes = (await call("refrain_open", { copy_id: copy.copy_id, boxes: true })).slides[0].boxes;
  const r = await call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: boxes[1].id, name: "Verse" }, { box: boxes[2].id, name: "Reference", x: 200, width: 900 }] });
  assert.deepEqual(r.changes.map((x) => x.changed.name), [["Text", "Verse"], ["Text", "Reference"]]);
  assert.deepEqual(r.changes[1].changed.position[1], { x: 200, y: 760, width: 900, height: 60 }, "only what was given moves");
  assert.deepEqual((await call("refrain_check", { copy_id: copy.copy_id })).findings, []);
  assert.ok(fs.readFileSync(original).equals(before));

  // One bad change in the list stops the whole list: nothing saved.
  await assert.rejects(call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: boxes[1].id, name: "Changed" }, { box: "nope", name: "X" }] }), /no box with the id nope.*Nothing was saved/);
  await assert.rejects(call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: boxes[1].id, name: "Changed" }, { box: boxes[2].id, width: -5 }] }), /width must be a number above 0/);
  await assert.rejects(call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: boxes[0].id, words: "Hello" }] }), /holds no words/);
  await assert.rejects(call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: boxes[1].id }] }), /nothing to change/);
  const now = (await call("refrain_open", { copy_id: copy.copy_id, boxes: true })).slides[0].boxes;
  assert.deepEqual(now.map((b) => b.name), ["Background", "Verse", "Reference"]);
  await assert.rejects(call("refrain_edit_boxes", { changes: [] }), /working copy/);
});

test("a file the reader can't fully read is not copied for changing", { skip }, async () => {
  const { call } = await setup();
  await assert.rejects(call("refrain_make_copy", { path: path.join(FIX, "sample.pro") }), /does not understand, so it is not copied/);
});

test("words change on a copy; a new presentation is built from existing slides", { skip }, async () => {
  const { call, staging } = await setup();
  const src = path.join(FIX, "show-template.pro");
  const copy = await call("refrain_make_copy", { path: src, name: "Words test" });
  const first = (await call("refrain_open", { copy_id: copy.copy_id, boxes: true })).slides[0];
  const box = first.boxes.find((b) => b.kind === "text");
  const w = await call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: box.id, words: "Hello **there**", type_size: 72 }] });
  assert.deepEqual(w.changes[0].changed.words[1], "Hello there");
  const slide = (await call("refrain_read_slide", { copy_id: copy.copy_id, slide: 1 })).slide;
  assert.equal(slide.boxes.find((b) => b.id === box.id).size, 72);
  await assert.rejects(call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: box.id, words: "  " }] }), /give the words/);
  await assert.rejects(call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: box.id, type_size: 72 }] }), /give the words/);

  const built = await call("refrain_build_from", {
    source: { copy_id: copy.copy_id }, name: "Week Two",
    slides: [{ from: 1, group: "Message", label: "Point one", words: { [box.id]: "First point" } }, { from: 1, group: "Message" }, { from: 2, group: "Close" }],
  });
  assert.ok(built.file.startsWith(path.join(staging, "built")));
  assert.deepEqual([built.slides, built.groups], [3, ["Message", "Close"]]);
  const again = await call("refrain_open", { path: built.file });
  assert.deepEqual(again.slides.map((s) => [s.group, s.label]), [["Message", "Point one"], ["Message", first.label], ["Close", again.slides[2].label]]);
  assert.equal((await call("refrain_read_slide", { path: built.file, slide: 1 })).slide.boxes.find((b) => b.kind === "text").words, "First point");
  assert.notEqual(again.slides[0].id, first.id, "copied slides get fresh ids");
  const second = await call("refrain_build_from", { source: { copy_id: copy.copy_id }, name: "Week Two", slides: [{ from: 1 }] });
  assert.equal(path.basename(second.file), "Week Two 2.probundle", "never over an existing file");
  await assert.rejects(call("refrain_build_from", { source: { copy_id: copy.copy_id }, name: "X", slides: [{ from: 99 }] }), /No slide 99/);
});

test("a new presentation from a bundle carries the pictures its slides use, and only those", { skip }, async () => {
  const { call, root } = await setup();
  const ws = "/Users/example/Library/Application Support/RenewedVision/ProPresenter/UserWorkspaces/Example/Media/Assets";
  const bundle = path.join(root, "Last week.probundle");
  fs.writeFileSync(bundle, await lib.writeBundle([
    { name: "Last week.pro", data: fs.readFileSync(path.join(FIX, "sample-fixed.pro")) },
    { name: `${ws}/example-qr.png`, data: fs.readFileSync(path.join(FIX, "dot.png")) },
    { name: `${ws}/example-bg.png`, data: fs.readFileSync(path.join(FIX, "dot.png")) },
  ]));
  const slides = (await call("refrain_open", { path: bundle })).slides;
  const supper = slides.find((s) => s.label === "Harvest Supper");
  const built = await call("refrain_build_from", { source: { path: bundle }, name: "Supper again", slides: [{ from: supper.number }] });
  assert.deepEqual(built.media_included.sort(), ["example-bg.png", "example-qr.png"], "its QR code and its background");
  assert.deepEqual(built.media_not_included.sort(), ["example-panel.png"], "the bundle never had it");
  await assert.rejects(call("refrain_build_from", { source: { path: path.join(FIX, "sample.probundle") }, name: "X", slides: [{ from: 1 }] }), /does not understand, so nothing is built/);
});

test("linked boxes: one showing its slide's label changes the label; one fed by anything else is refused", { skip }, async () => {
  const { call, root } = await setup();
  const uid = (n) => ({ string: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` });
  const rtf = (w) => Buffer.from(`{\\rtf1\\ansi{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;}\n\\pard\n\n\\f0\\fs80 \\cf2 ${w}}`, "latin1");
  const box = (n, name, words, links) => ({ element: { uuid: uid(n), name, text: { rtf_data: rtf(words), attributes: {} } }, ...(links ? { data_links: links } : {}) });
  const { Presentation } = lib.loadSchema();
  const cue = { uuid: uid(1), name: "Romans 12:2", actions: [{ uuid: uid(2), label: { text: "Romans 12:2" }, type: 11, slide: { presentation: { base_slide: { elements: [
    box(3, "Reference", "stale", [{ slide_Label_Text: {} }]), box(4, "Countdown", "10:00", [{ timer_text: {} }]), box(5, "Words", "Do not conform"),
  ] } } } }] };
  const file = path.join(root, "Linked.pro");
  fs.writeFileSync(file, Presentation.encode(Presentation.fromObject({ uuid: uid(9), name: "Linked", cues: [cue], cue_groups: [{ group: { uuid: uid(8), name: "Message" }, cue_identifiers: [uid(1)] }] })).finish());

  const slide = (await call("refrain_read_slide", { path: file, slide: 1 })).slide;
  assert.deepEqual(slide.boxes.map((b) => [b.name, b.words, b.linked_to ?? []]), [["Reference", "Romans 12:2", ["slide label"]], ["Countdown", "10:00", ["timer"]], ["Words", "Do not conform", []]]);

  const copy = await call("refrain_make_copy", { path: file });
  const r = await call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: uid(3).string, words: "**Romans 12:3**" }] });
  assert.deepEqual(r.changes[0].changed.label, ["Romans 12:2", "Romans 12:3"]);
  const after = (await call("refrain_read_slide", { copy_id: copy.copy_id, slide: 1 })).slide;
  assert.deepEqual([after.label, after.boxes[0].words], ["Romans 12:3", "Romans 12:3"]);
  await assert.rejects(call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: uid(4).string, words: "5:00" }] }), /shows the timer, not words of its own/);

  const built = await call("refrain_build_from", { source: { path: file }, name: "Next week", slides: [{ from: 1, words: { [uid(3).string]: "Romans 13:1", [uid(5).string]: "Let everyone be subject" } }] });
  const b = (await call("refrain_read_slide", { path: built.file, slide: 1 })).slide;
  assert.deepEqual([b.label, b.boxes[0].words, b.boxes[2].words], ["Romans 13:1", "Romans 13:1", "Let everyone be subject"], "the linked box's words became the label");
  await assert.rejects(call("refrain_build_from", { source: { path: file }, name: "X", slides: [{ from: 1, label: "Other", words: { [uid(3).string]: "Romans 13:1" } }] }), /must be the same/);
  await assert.rejects(call("refrain_build_from", { source: { path: file }, name: "X", slides: [{ from: 1, words: { [uid(4).string]: "1:00" } }] }), /shows the timer/);
});

test("the slide editor's box settings, through one tool, all or nothing", { skip }, async () => {
  const { call } = await setup();
  const copy = await call("refrain_make_copy", { path: path.join(FIX, "sample-fixed.pro") });
  const slides = (await call("refrain_open", { copy_id: copy.copy_id, boxes: true })).slides;
  const supper = slides.find((s) => s.label === "Harvest Supper");
  const title = supper.boxes.find((b) => b.name === "Title"), desc = supper.boxes.find((b) => b.name === "Description");
  const r = await call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [
    { box: title.id, text_color: "#cc2929", align: "center", vertical_align: "middle", fit: "shrink_text", capitals: "all", font: "HelveticaNeue" },
    { box: desc.id, fill: "#000000", outline: "#ffffff", outline_width: 3, shadow: true, rotation: 5, opacity: 0.8, arrange: "front" },
  ] });
  assert.deepEqual(r.changes.map((c) => Object.keys(c.changed).sort()), [
    ["align", "capitals", "fit", "font", "text_color", "vertical_align"],
    ["arrange", "fill", "opacity", "outline", "outline_width", "rotation", "shadow"],
  ]);
  const after = (await call("refrain_read_slide", { copy_id: copy.copy_id, slide: supper.number })).slide;
  assert.equal(after.boxes[0].name, "Description", "brought to the front");
  const t = after.boxes.find((b) => b.name === "Title");
  assert.deepEqual([t.font, t.font_family, t.caps], ["HelveticaNeue", "Helvetica Neue"].concat(true));
  assert.deepEqual((await call("refrain_check", { copy_id: copy.copy_id })).findings.filter((f) => f.severity === "problem"), []);

  await assert.rejects(call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: title.id, font: "Futura-Bold" }] }), /give font_family too/);
  await assert.rejects(call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: title.id, name: "Changed" }, { box: desc.id, text_color: "blue" }] }), /#rrggbb.*Nothing was saved/);
  assert.ok((await call("refrain_read_slide", { copy_id: copy.copy_id, slide: supper.number })).slide.boxes.some((b) => b.name === "Title"), "the first change was not saved either");
  const dup = await call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: title.id, arrange: "duplicate" }] });
  assert.match(dup.changes[0].changed.new_box, /^[0-9A-F-]{36}$/);
});

test("whole slides: label, colour, on or off, background, group, order, copies, removal, macros, groups and name", { skip }, async () => {
  const { call } = await setup();
  const copy = await call("refrain_make_copy", { path: path.join(FIX, "sample-fixed.pro") });
  const before = (await call("refrain_open", { copy_id: copy.copy_id })).slides;
  assert.deepEqual(before.map((s) => [s.group, s.label]), [["Opening", "Welcome"], ["Opening", "Speaker Intro"], ["Announcements", "Harvest Supper"], ["Announcements", "Blank"], ["Announcements", "Thank You"]]);
  const r = await call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [
    { slide: 1, label: "Welcome: 9:00", label_color: "#00ff00", background: "#101010", add_macro: "Lower Thirds" },
    { slide: 4, enabled: false, move: "first" },
    { slide: 5, group: "Closing" },
    { slide: 3, move: "duplicate" },
    { slide: 2, remove_macro: "Lower Thirds" },
  ], groups: [{ name: "Opening", rename: "Welcome", color: "#3366cc" }], name: "Example Sunday (edited)" });
  assert.deepEqual(r.slides.map((s) => s.slide), [1, 4, 5, 3, 2]);
  assert.match(r.slides[3].changed.new_slide, /^[0-9A-F-]{36}$/);
  const after = (await call("refrain_open", { copy_id: copy.copy_id })).slides;
  assert.deepEqual(after.map((s) => [s.group, s.label, s.enabled ?? true]), [
    ["Welcome", "Welcome: 9:00", true], ["Welcome", "Speaker Intro", true],
    ["Announcements", "Blank", false], ["Announcements", "Harvest Supper", true], ["Announcements", "Harvest Supper", true],
    ["Closing", "Thank You", true],
  ]);
  assert.deepEqual(after[0].macros, ["Lower Thirds"], "found on another slide in the file, by name");
  assert.equal(after[1].macros, undefined, "removed");
  assert.equal((await call("refrain_open", { copy_id: copy.copy_id })).name, "Example Sunday (edited)");

  await assert.rejects(call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 1, label: "X" }, { slide: 1, add_macro: "Nope" }] }), /No macro called "Nope".*Nothing was saved/s);
  assert.equal((await call("refrain_open", { copy_id: copy.copy_id })).slides[0].label, "Welcome: 9:00", "the first change was not saved either");
  await assert.rejects(call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 99, label: "X" }] }), /No slide 99/);
  await assert.rejects(call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 2, move: "delete" }] }).then(() => call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 1, remove_macro: "Nope" }] })), /no macro "Nope" on this slide/);
  assert.equal((await call("refrain_open", { copy_id: copy.copy_id })).slide_count, 5, "the delete was saved on its own");
});

test("media: added as background, foreground or a box, carried in the bundle, swapped in a picture box, removed", { skip }, async () => {
  const { call, root } = await setup();
  const ws = "/Users/example/Library/Application Support/RenewedVision/ProPresenter/UserWorkspaces/Example";
  const bundle = path.join(root, "Week.probundle");
  fs.writeFileSync(bundle, await lib.writeBundle([
    { name: "Week.pro", data: fs.readFileSync(path.join(FIX, "sample-fixed.pro")) },
    { name: `${ws}/Media/Assets/example-qr.png`, data: fs.readFileSync(path.join(FIX, "dot.png")) },
  ]));
  const picture = path.join(root, "Sermon Art.png");
  fs.copyFileSync(path.join(FIX, "dot.png"), picture);
  const copy = await call("refrain_make_copy", { path: bundle });
  const r = await call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [
    { slide: 1, add_media: [{ file: picture }, { file: picture, as: "box", name: "Art", x: 100, y: 100, width: 400, height: 225 }] },
    { slide: 2, add_media: [{ file: picture, as: "foreground" }] },
  ] });
  assert.deepEqual(r.slides[0].changed.media_added, [{ file: "Sermon Art.png", as: "background" }, { file: "Sermon Art.png", as: "box" }]);
  const s1 = (await call("refrain_read_slide", { copy_id: copy.copy_id, slide: 1 })).slide;
  assert.ok(s1.media.some((m) => m.file === "Sermon Art.png" && m.layer === 0), "background layer");
  assert.deepEqual([s1.boxes[0].name, s1.boxes[0].picture], ["Art", "Sermon Art.png"]);
  assert.ok((await call("refrain_read_slide", { copy_id: copy.copy_id, slide: 2 })).slide.media.some((m) => m.file === "Sermon Art.png" && m.layer === 1), "foreground layer");
  const entries = lib.readBundle(fs.readFileSync(copy.file)).map((e) => e.name);
  assert.equal(entries.filter((n) => n.endsWith("/Media/Assets/Sermon Art.png")).length, 1, "the file is in the bundle once, under the workspace its media already uses");
  const problems = (await call("refrain_check", { copy_id: copy.copy_id })).findings.filter((f) => f.severity === "problem");
  assert.deepEqual(problems.map((f) => f.code), ["missing-media", "missing-media"], "only the two pictures this test's bundle never had");
  assert.ok(!problems.some((f) => f.message.includes("Sermon Art")), "the added file is carried");

  const qr = (await call("refrain_read_slide", { copy_id: copy.copy_id, slide: 3 })).slide.boxes.find((b) => b.picture === "example-qr.png");
  const swapped = await call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: qr.id, picture }] });
  assert.equal(swapped.changes[0].changed.picture, "Sermon Art.png");
  const gone = await call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 1, remove_media: "Sermon Art.png" }] });
  assert.deepEqual(gone.slides[0].changed.media_removed, ["Sermon Art.png"]);
  const s1again = (await call("refrain_read_slide", { copy_id: copy.copy_id, slide: 1 })).slide;
  assert.ok(!s1again.media.some((m) => m.file === "Sermon Art.png") && !s1again.boxes.some((b) => b.picture === "Sermon Art.png"), "both the action and the box");

  await assert.rejects(call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 1, add_media: [{ file: path.join(root, "notes.txt") }] }] }), /not a picture, video or sound/);
  const proCopy = await call("refrain_make_copy", { path: path.join(FIX, "sample-fixed.pro") });
  await assert.rejects(call("refrain_edit_slides", { copy_id: proCopy.copy_id, changes: [{ slide: 1, add_media: [{ file: picture }] }] }), /Only a bundle carries its pictures/);
});

test("a playlist opens with its items, and a presentation inside it can be read and copied with its media", { skip: lib?.readPlaylistFile ? false : "propresenter-bundle with playlists is not installed" }, async () => {
  const { call, root } = await setup();
  const uid = (n) => ({ string: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` });
  const T = lib.loadSchema().root.lookupType("rv.data.Playlist");
  const data = Buffer.from(T.encode(T.fromObject({ uuid: uid(1), name: "PLAYLIST", type: 1, playlists: { playlists: [{ uuid: uid(2), name: "Sunday", type: 1, items: { items: [
    { uuid: uid(3), name: "Opening", header: {} },
    { uuid: uid(4), name: "Example Sunday", presentation: { document_path: { local: { root: 2, path: "Example Sunday.pro" } }, arrangement_name: "Full" } },
  ] } }] } })).finish());
  const ws = "/Users/example/Library/Application Support/RenewedVision/ProPresenter/UserWorkspaces/Example";
  const file = path.join(root, "Sunday.proplaylist");
  fs.writeFileSync(file, await lib.writeBundle([
    { name: "data", data }, { name: "Example Sunday.pro", data: fs.readFileSync(path.join(FIX, "sample-fixed.pro")) },
    { name: `${ws}/Media/Assets/example-qr.png`.slice(1), data: fs.readFileSync(path.join(FIX, "dot.png")) },
  ]));

  const o = await call("refrain_open", { path: file });
  assert.deepEqual([o.kind, o.name, o.can_change, o.presentations], ["proplaylist", "Sunday", false, ["Example Sunday.pro"]]);
  assert.deepEqual(o.playlists[0].items.map((i) => [i.kind, i.arrangement_name ?? null]), [["header", null], ["presentation", "Full"]]);
  await assert.rejects(call("refrain_read_slide", { path: file, slide: 1 }), /This is a playlist\. Name a presentation in it with inside: Example Sunday\.pro/);

  const inside = await call("refrain_open", { path: file, inside: "Example Sunday" });
  assert.deepEqual([inside.kind, inside.slide_count], ["probundle", 5]);
  const copy = await call("refrain_make_copy", { path: file, inside: "Example Sunday.pro" });
  assert.equal(path.basename(copy.file), "Example Sunday (edited).probundle");
  const entries = lib.readBundle(fs.readFileSync(copy.file)).map((e) => e.name);
  assert.ok(entries.some((n) => n.endsWith("example-qr.png")), "the picture the presentation uses came with it");
  await call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 1, label: "Changed" }] });
  await assert.rejects(call("refrain_make_copy", { path: file }), /A playlist is read, not changed/);
  await assert.rejects(call("refrain_open", { path: file, inside: "Nope" }), /No presentation Nope in this playlist/);
});

test("notes, line spacing, and arrangements: made, changed, renamed, chosen to play, deleted", { skip: lib?.setNotes ? false : "propresenter-bundle with notes is not installed" }, async () => {
  const { call } = await setup();
  const copy = await call("refrain_make_copy", { path: path.join(FIX, "sample-fixed.pro") });
  const r = await call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 1, notes: "Lights: 139,1\nBand ready" }],
    arrangements: [{ name: "Short", groups: ["Announcements"] }, { name: "Full", rename: "Everything" }], play_arrangement: "Short" });
  assert.equal(r.slides[0].changed.notes, "Lights: 139,1\nBand ready");
  assert.deepEqual(r.arrangements, [{ arrangement: "Short", groups: ["Announcements"] }, { arrangement: "Everything", groups: ["Opening", "Announcements"] }]);
  assert.equal(r.playing_arrangement, "Short");
  const o = await call("refrain_open", { copy_id: copy.copy_id });
  assert.deepEqual([o.arrangements.map((a) => a.name), o.playing_arrangement], [["Everything", "Short"], "Short"]);
  assert.equal((await call("refrain_read_slide", { copy_id: copy.copy_id, slide: 1 })).slide.notes, "Lights: 139,1\nBand ready");

  const box = (await call("refrain_read_slide", { copy_id: copy.copy_id, slide: 1 })).slide.boxes.find((b) => b.kind === "text");
  await call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: box.id, line_spacing: 1.2 }] });
  assert.deepEqual((await call("refrain_check", { copy_id: copy.copy_id })).findings.filter((f) => f.severity === "problem"), []);

  const del = await call("refrain_edit_slides", { copy_id: copy.copy_id, arrangements: [{ name: "Short", delete: true }] });
  assert.deepEqual(del.arrangements, [{ arrangement: "Short", deleted: true }]);
  assert.equal((await call("refrain_open", { copy_id: copy.copy_id })).playing_arrangement, null, "deleting the one that played leaves none chosen");
  await assert.rejects(call("refrain_edit_slides", { copy_id: copy.copy_id, arrangements: [{ name: "X", groups: ["Nope"] }] }), /no group "Nope"/);
  await assert.rejects(call("refrain_edit_slides", { copy_id: copy.copy_id, arrangements: [{ name: "Missing" }] }), /to make one, give its groups/);
  await assert.rejects(call("refrain_edit_slides", { copy_id: copy.copy_id, play_arrangement: "Nope" }), /No arrangement "Nope"/);
  await assert.rejects(call("refrain_edit_boxes", { copy_id: copy.copy_id, changes: [{ box: box.id, line_spacing: 20 }] }), /0\.1 to 5/);
});

test("a new presentation from a theme's slides: its boxes, new words, and the theme's own pictures carried", { skip: lib?.themeSlideAsCue ? false : "propresenter-bundle with theme slides is not installed" }, async () => {
  const { call } = await setup();
  const themePath = path.join(FIX, "sample.protheme");
  const slides = (await call("refrain_open", { path: themePath, boxes: true })).slides;
  const verse = slides[0];
  const built = await call("refrain_build_from", { source: { path: themePath }, name: "Sermon from theme", slides: [
    { from: 1, group: "Message", label: "Romans 12:2", words: { [verse.boxes[1].id]: "Do not be conformed", [verse.boxes[2].id]: "Romans 12:2" } },
    { from: "Quote", group: "Message" },
  ] });
  assert.deepEqual([built.slides, built.groups, built.media_included], [2, ["Message"], ["example-bg.png"]]);
  const o = await call("refrain_open", { path: built.file });
  assert.deepEqual(o.slides.map((s) => [s.group, s.label]), [["Message", "Romans 12:2"], ["Message", "Quote"]]);
  const s1 = (await call("refrain_read_slide", { path: built.file, slide: 1 })).slide;
  assert.deepEqual(s1.boxes.map((b) => b.words), ["", "Do not be conformed", "Romans 12:2"]);
  assert.equal(s1.boxes[0].picture, "example-bg.png");
  assert.deepEqual((await call("refrain_check", { path: built.file })).findings.filter((f) => f.severity === "problem"), [], "the picture is in the bundle");
});
