// Context for the assistant (server/mcp/context-tools.js), through the SDK client: a ProPresenter workspace
// read where it lives or from the church folder's copy, never from the database beside it; and the church's
// skills, saved with their history kept, their reference files filed beside them, and offered as prompts.
// Workspaces here are invented, made with the package's schema.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../server/mcp/server.js";

const lib = await import("propresenter-bundle").catch(() => null);
const skip = lib?.readWorkspacePart ? false : "propresenter-bundle with workspace support is not installed";
const require = createRequire(import.meta.url);

function encode(type, obj) {
  const T = lib.loadSchema().root.lookupType(type);
  return Buffer.from(T.encode(T.fromObject(obj)).finish());
}
const uid = (n) => ({ string: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` });

/** A workspace's content folder, as ProPresenter lays one out, with invented macros and playlists. */
function makeWorkspace(dir) {
  fs.mkdirSync(path.join(dir, "Configuration"), { recursive: true });
  fs.mkdirSync(path.join(dir, "Playlists"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Configuration", "Macros"), encode("rv.data.MacrosDocument", {
    macros: [{ uuid: uid(1), name: "Lower Thirds", color: { red: 1, green: 0, blue: 0, alpha: 1 } }, { uuid: uid(2), name: "Clear All" }],
    macro_collections: [{ uuid: uid(3), name: "Service", items: [{ macro_id: uid(1) }] }],
  }));
  fs.writeFileSync(path.join(dir, "Configuration", "Labels"), encode("rv.data.ProLabelsDocument", { labels: [{ text: "Verse" }, { text: "Chorus" }] }));
  fs.writeFileSync(path.join(dir, "Playlists", "Library"), encode("rv.data.PlaylistDocument", {
    root_node: { uuid: uid(10), name: "root", playlists: { playlists: [
      { uuid: uid(11), name: "Sundays", playlists: { playlists: [
        { uuid: uid(12), name: "Example Sunday", items: { items: [
          { uuid: uid(13), name: "Welcome", header: { color: { red: 1, alpha: 1 } } },
          { uuid: uid(14), name: "Example Song", presentation: { document_path: { local: { root: 1, path: "Libraries/Default/Example Song.pro" } }, arrangement: uid(15) } },
        ] } },
      ] } },
    ] } },
  }));
}

async function connect({ config = {}, userWorkspaces } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-ctx-"));
  const server = createMcpServer({ root, staging: path.join(root, "staging"), getConfig: () => config, userWorkspaces: userWorkspaces ?? path.join(root, "no-propresenter") });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  await client.listTools();
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(r.content.map((c) => c.text).join(" "));
    return r.structuredContent;
  };
  return { root, client, call };
}

test("the workspace is read where ProPresenter keeps it, part by part, one playlist at a time", { skip }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-pp-"));
  const user = path.join(home, "RenewedVision", "ProPresenter", "UserWorkspaces");
  makeWorkspace(path.join(user, "Main"));
  const { call } = await connect({ userWorkspaces: user });

  const all = await call("refrain_read_workspace");
  assert.deepEqual([all.workspace.name, all.workspace.source], ["Main", "ProPresenter on this computer"]);
  assert.deepEqual(all.parts.macros, { macros: 2, collections: 1 });
  assert.deepEqual(all.parts.playlists, { playlists: 1 });
  assert.equal(all.parts.looks, null, "a part this workspace lacks is null, not an error");

  const macros = await call("refrain_read_workspace", { part: "macros" });
  assert.deepEqual(macros.macros.map((m) => [m.name, m.color]), [["Lower Thirds", "#ff0000"], ["Clear All", null]]);
  assert.deepEqual(macros.collections, [{ name: "Service", id: uid(3).string, macros: ["Lower Thirds"] }]);

  const top = await call("refrain_read_workspace", { part: "playlists" });
  assert.deepEqual(top.playlists, [{ kind: "folder", name: "Sundays", playlists: 1 }], "a level at a time");
  const folder = await call("refrain_read_workspace", { part: "playlists", folder: "sundays" });
  assert.deepEqual(folder.playlists, [{ kind: "playlist", name: "Example Sunday", items: 2 }]);
  await assert.rejects(call("refrain_read_workspace", { part: "playlists", folder: "Nope" }), /No playlist folder Nope/);
  const one = await call("refrain_read_workspace", { part: "playlists", playlist: "example sunday" });
  assert.deepEqual(one.playlist.items.map((i) => [i.kind, i.name, i.file ?? null]), [["header", "Welcome", null], ["presentation", "Example Song", "Example Song.pro"]]);

  const status = await call("refrain_setup_status");
  assert.deepEqual(status.context.workspace, { name: "Main", source: "ProPresenter on this computer" });
});

test("never the database: a workspace that leads into ProPresenter's state folder is refused", { skip }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-pp-"));
  const pp = path.join(home, "RenewedVision", "ProPresenter");
  const state = path.join(pp, "Workspaces", "Main-123");
  makeWorkspace(state);
  fs.mkdirSync(path.join(state, "Database"));
  fs.mkdirSync(path.join(pp, "UserWorkspaces"), { recursive: true });
  fs.symlinkSync(state, path.join(pp, "UserWorkspaces", "Sneaky"));
  const { call } = await connect({ userWorkspaces: path.join(pp, "UserWorkspaces") });
  await assert.rejects(call("refrain_read_workspace"), /Workspaces folder.*never reads ProPresenter's database/);
});

test("without ProPresenter: the church folder's copy, or a plain message saying where to put one", { skip }, async () => {
  const bare = await connect();
  await assert.rejects(bare.call("refrain_read_workspace"), /ProPresenter isn't installed on this computer.*copy a workspace's Configuration and Playlists folders/);
  assert.match((await bare.call("refrain_setup_status")).context.note, /still read any file given/);

  const church = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-church-"));
  makeWorkspace(path.join(church, "workspace"));
  const { call } = await connect({ config: { probundleModule: { packsDir: church } } });
  const w = await call("refrain_read_workspace", { part: "labels" });
  assert.equal(w.workspace.source, "copy in the church folder");
  assert.deepEqual(w.labels.map((l) => l.text), ["Verse", "Chorus"]);
});

test("skills: saved with the old version kept, files filed without replacing, offered as prompts", { skip }, async () => {
  const church = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-church-"));
  const { call, client, root } = await connect({ config: { probundleModule: { packsDir: church } } });
  assert.deepEqual((await call("refrain_list_skills")).skills, []);
  await assert.rejects(call("refrain_save_skill", { skill: "Sermon Slides", description: "x", instructions: "y" }), /lower case letters, numbers and hyphens/);

  const saved = await call("refrain_save_skill", { skill: "sermon-slides", description: "Sermon slides from last week's bundle.", instructions: "Copy the point slides.\nOne point per slide." });
  assert.equal(saved.previous_version, null);
  const again = await call("refrain_save_skill", { skill: "sermon-slides", description: "Sermon slides,\n from last week's bundle.", instructions: "One point per slide." });
  assert.ok(fs.existsSync(again.previous_version), "the first version is kept");
  assert.match(fs.readFileSync(again.previous_version, "utf8"), /Copy the point slides/);

  const theme = path.join(root, "Message.protheme");
  fs.copyFileSync(path.join(path.dirname(require.resolve("propresenter-bundle/package.json")), "test", "fixtures", "sample.protheme"), theme);
  const f1 = await call("refrain_file_away", { path: theme, skill: "sermon-slides" });
  const f2 = await call("refrain_file_away", { path: theme, skill: "sermon-slides" });
  assert.deepEqual([path.basename(f1.file), path.basename(f2.file)], ["Message.protheme", "Message 2.protheme"]);
  assert.ok(fs.existsSync(theme), "the original stays where it was");
  await assert.rejects(call("refrain_file_away", { path: theme, skill: "no-such-skill" }), /Save it with refrain_save_skill first/);

  const read = await call("refrain_read_skill", { skill: "sermon-slides" });
  assert.deepEqual([read.description, read.instructions], ["Sermon slides, from last week's bundle.", "One point per slide."]);
  assert.deepEqual(read.files.map((f) => f.name), ["Message 2.protheme", "Message.protheme"]);

  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts, [{ name: "sermon-slides", description: "Sermon slides, from last week's bundle." }]);
  const prompt = await client.getPrompt({ name: "sermon-slides" });
  assert.match(prompt.messages[0].content.text, /Use the sermon-slides skill\.\n\nOne point per slide\.\n\nReference files.*Message\.protheme/s);
});

test("stage layouts and props come out as an ordinary presentation, links and all, to import and copy from", { skip }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-pp-"));
  const ws = path.join(home, "RenewedVision", "ProPresenter", "UserWorkspaces", "Main");
  makeWorkspace(ws);
  const box = (n, name, link) => ({ element: { uuid: uid(n), name, bounds: { origin: { x: 0, y: 0 }, size: { width: 800, height: 200 } } }, ...(link ? { data_links: [link] } : {}) });
  fs.writeFileSync(path.join(ws, "Configuration", "Stage"), encode("rv.data.Stage.Document", { layouts: [
    { uuid: uid(20), name: "Lyrics", slide: { uuid: uid(21), size: { width: 1920, height: 1080 }, elements: [box(22, "Current", { slide_text: {} }), box(23, "Clock", { clock_text: {} })] } },
    { uuid: uid(24), name: "Sermon", slide: { uuid: uid(25), elements: [box(26, "Notes", { presentation_notes: {} })] } },
  ] }));
  fs.writeFileSync(path.join(ws, "Configuration", "Props"), encode("rv.data.PropDocument", { cues: [
    { uuid: uid(30), name: "Logo bug", actions: [{ uuid: uid(31), type: 11, slide: { prop: { base_slide: { uuid: uid(32), elements: [box(33, "Logo")] } } } }] },
  ] }));
  const { call } = await connect({ userWorkspaces: path.dirname(ws) });

  const stage = await call("refrain_workspace_to_presentation", { part: "stage_layouts" });
  assert.deepEqual([stage.slides, stage.names], [2, ["Lyrics", "Sermon"]]);
  const opened = await call("refrain_open", { path: stage.file, boxes: true });
  assert.deepEqual(opened.slides.map((s) => [s.group, s.label]), [["Stage layouts", "Lyrics"], ["Stage layouts", "Sermon"]]);
  assert.deepEqual(opened.slides[0].boxes.map((b) => [b.name, b.linked_to]), [["Current", ["another slide's words"]], ["Clock", ["clock"]]], "the links come with the boxes");
  assert.notEqual(opened.slides[0].boxes[0].id, uid(22).string, "fresh ids, so pasting doesn't collide");

  const one = await call("refrain_workspace_to_presentation", { part: "props", names: ["logo BUG"], name: "Props to tidy" });
  assert.deepEqual([one.slides, one.names, path.basename(one.file)], [1, ["Logo bug"], "Props to tidy.probundle"]);
  await assert.rejects(call("refrain_workspace_to_presentation", { part: "stage_layouts", names: ["Nope"] }), /No stage layout called nope.*There are: Lyrics, Sermon/);
  await assert.rejects(call("refrain_workspace_to_presentation", { part: "macros" }), /stage_layouts or props/);
});

test("slide actions: read in plain words, added by name from the workspace (copying the macros' own example), removed", { skip }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-pp-"));
  const ws = path.join(home, "RenewedVision", "ProPresenter", "UserWorkspaces", "Main");
  makeWorkspace(ws);
  const conf = (f, type, obj) => fs.writeFileSync(path.join(ws, "Configuration", f), encode(type, obj));
  conf("Workspace", "rv.data.ProPresenterWorkspace", { pro_screens: [{ uuid: uid(40), name: "Front", screen_type: 1 }, { uuid: uid(41), name: "Confidence", screen_type: 2 }], audience_looks: [{ uuid: uid(42), name: "Lower Third" }] });
  conf("Stage", "rv.data.Stage.Document", { layouts: [{ uuid: uid(43), name: "Sermon Notes", slide: { uuid: uid(44) } }] });
  conf("Props", "rv.data.PropDocument", { cues: [{ uuid: uid(45), name: "Logo bug" }], prop_collections: [{ uuid: uid(46), name: "Bugs", items: [{ prop_cue_uuid: uid(45) }] }] });
  conf("Messages", "rv.data.MessageDocument", { messages: [{ uuid: uid(47), title: "Nursery" }] });
  conf("Timers", "rv.data.TimersDocument", { timers: [{ uuid: uid(48), name: "Countdown", configuration: { countdown: { duration: 300 } } }] });
  conf("ClearGroups", "rv.data.ClearGroupsDocument", { groups: [{ uuid: uid(49), name: "Clear to logo" }] });
  // The church's macros: a prop action carrying ProPresenter's auto-clear setting, which a new prop action copies.
  conf("Macros", "rv.data.MacrosDocument", { macros: [{ uuid: uid(50), name: "Bug on", actions: [{ uuid: uid(51), isEnabled: true, type: 6, prop: { identification: { parameter_uuid: uid(99), parameter_name: "Old" }, trigger: { auto_clear_enabled: true } } }] }] });
  const { call } = await connect({ userWorkspaces: path.dirname(ws) });
  const fix = path.join(path.dirname(require.resolve("propresenter-bundle/package.json")), "test", "fixtures");
  const copy = await call("refrain_make_copy", { path: path.join(fix, "sample-fixed.pro") });

  const r = await call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 1, add_action: [
    { kind: "clear", what: "messages" }, { kind: "look", name: "lower third" }, { kind: "prop", name: "Logo bug" }, { kind: "message", name: "Nursery" },
    { kind: "timer", name: "Countdown", do: "reset_and_start" }, { kind: "clear group", name: "Clear to logo" }, { kind: "stage layout", name: "Sermon Notes" },
  ] }] });
  assert.deepEqual(r.slides[0].changed.actions_added.map((a) => a.kind), ["clear", "look", "prop", "message", "timer", "clear group", "stage layout"]);
  const actions = (await call("refrain_read_slide", { copy_id: copy.copy_id, slide: 1 })).slide.actions;
  assert.deepEqual(actions.filter((a) => a.kind !== "media"), [
    { kind: "clear", what: "messages" }, { kind: "look", name: "Lower Third" }, { kind: "prop", name: "Logo bug" }, { kind: "message", name: "Nursery" },
    { kind: "timer", name: "Countdown", do: "reset_and_start" }, { kind: "clear group", name: "Clear to logo" },
    { kind: "stage layout", screens: [{ screen: "Confidence", layout: "Sermon Notes" }] },
  ], "the stage layout goes to every stage screen, not the audience one");

  const raw = lib.decodePresentation(fs.readFileSync(copy.file)).doc.cues[0].actions.find((a) => a.prop);
  assert.equal(raw.prop.trigger?.auto_clear_enabled, true, "the macros' example setting came along");
  assert.deepEqual(raw.prop.identification.parent_collection?.parameter_name, "Bugs");

  await assert.rejects(call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 1, add_action: [{ kind: "look", name: "Nope" }] }] }), /No Look called "Nope"/);
  await assert.rejects(call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 1, add_action: [{ kind: "macro", name: "x" }] }] }), /media and macros have their own fields/);
  const gone = await call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 1, remove_action: [{ kind: "timer" }, { kind: "stage layout", name: "sermon notes" }] }] });
  assert.deepEqual(gone.slides[0].changed.actions_removed.map((x) => x.count), [1, 1]);
  await assert.rejects(call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 1, remove_action: [{ kind: "timer" }] }] }), /no timer action on this slide/);
});

test("without a workspace, a clear can still be added, and a named action says where it would look", { skip }, async () => {
  const { call } = await connect();
  const fix = path.join(path.dirname(require.resolve("propresenter-bundle/package.json")), "test", "fixtures");
  const copy = await call("refrain_make_copy", { path: path.join(fix, "sample-fixed.pro") });
  await call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 2, add_action: [{ kind: "clear", what: "slide" }] }] });
  assert.ok((await call("refrain_read_slide", { copy_id: copy.copy_id, slide: 2 })).slide.actions.some((a) => a.kind === "clear" && a.what === "slide"));
  await assert.rejects(call("refrain_edit_slides", { copy_id: copy.copy_id, changes: [{ slide: 2, add_action: [{ kind: "prop", name: "Logo bug" }] }] }), /no ProPresenter workspace on this computer/);
});
