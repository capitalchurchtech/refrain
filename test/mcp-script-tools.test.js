// The MCP's script-builder tools (server/mcp/script-tools.js) on a made-up show: the package's synthetic
// template, set up as a church's pack in a temp folder. The reading and building themselves are tested in the
// propresenter-bundle package; this is the glue: kinds of show from packs, drafts, the questions that must be
// answered before a build, corrections, and a build that never overwrites.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// The package comes from GitHub and may be missing (see README, Bundles): these tests then skip, as the module's do.
const lib = await import("propresenter-bundle").catch(() => null);
const { readBundle, decodePresentation } = lib ?? {};
const { listTypes, parseScriptTool, previewScriptTool, updateDraftTool, buildTool } = lib ? await import("../server/mcp/script-tools.js") : {};
const skip = lib ? false : "propresenter-bundle is not installed";

const require = createRequire(import.meta.url);
const FIX = lib ? path.join(path.dirname(require.resolve("propresenter-bundle/package.json")), "test", "fixtures") : null;

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-mcp-"));
  const kind = path.join(root, "packs", "example", "scripts", "example-show");
  fs.mkdirSync(kind, { recursive: true });
  fs.copyFileSync(path.join(FIX, "show-template.pro"), path.join(kind, "template.pro"));
  fs.copyFileSync(path.join(FIX, "show-recipe.json"), path.join(kind, "recipe.json"));
  // A broken recipe beside it must not hide the good one.
  fs.mkdirSync(path.join(root, "packs", "example", "scripts", "broken"), { recursive: true });
  fs.writeFileSync(path.join(root, "packs", "example", "scripts", "broken", "recipe.json"), "{not json");
  fs.writeFileSync(path.join(root, "packs", "example", "scripts", "broken", "template.pro"), "");
  return { root, ctx: { packsDir: path.join(root, "packs"), staging: path.join(root, "staging") } };
}

const SCRIPT = `THE BAKER AND THE BELL
BAKER: Good morning, everyone!
WREN: Morning!
[Music starts playing and the lights go into party mode]
[PICTURE: cake.png]
BAKER: Let's bake.`;

test("kinds of show come from the packs; a broken recipe is skipped", { skip }, () => {
  const { ctx } = setup();
  const types = listTypes(ctx.packsDir);
  assert.deepEqual(types.map((t) => t.id), ["example/example-show"]);
  assert.equal(types[0].noteAdvanceSeconds, 1);
  assert.deepEqual(listTypes(path.join(ctx.packsDir, "missing")), []);
});

test("parse_script makes a draft, reads it back as a script, and asks the two questions", { skip }, async () => {
  const { ctx } = setup();
  const d = await parseScriptTool({ text: SCRIPT, type: "example-show", name: "Baker" }, ctx);
  assert.match(d.draft_id, /^[a-f0-9-]{36}$/);
  assert.equal(d.type, "example/example-show");
  assert.deepEqual(d.ask_before_building.map((q) => q.id), ["colors", "reused"]);
  assert.match(d.script, /BAKER\n\s+Good morning, everyone!/);
  assert.deepEqual(d.checklist.sound.map((s) => s.what), ["AUDIO"]);
  const again = await previewScriptTool({ draft_id: d.draft_id }, ctx);
  assert.equal(again.slides, d.slides);
  await assert.rejects(parseScriptTool({ text: SCRIPT, type: "nope" }, ctx), /No kind of show "nope"/);
  await assert.rejects(previewScriptTool({ draft_id: "../../etc/passwd" }, ctx), /not a draft id/);
});

test("a build waits for the person's answers, then writes a bundle without overwriting", { skip }, async () => {
  const { ctx } = setup();
  const d = await parseScriptTool({ text: SCRIPT, type: "example/example-show", name: "Baker" }, ctx);
  const early = await buildTool({ draft_id: d.draft_id }, ctx);
  assert.equal(early.built, false);
  assert.deepEqual(early.ask_before_building.map((q) => q.id), ["colors", "reused"]);

  await assert.rejects(updateDraftTool({ draft_id: d.draft_id, cast: [{ label: "Nobody", color: "#000000" }] }, ctx), /No speaker "Nobody"/);
  await assert.rejects(updateDraftTool({ draft_id: d.draft_id, cast: [{ label: "Baker", color: "red" }] }, ctx), /#rrggbb/);
  const colours = await updateDraftTool({ draft_id: d.draft_id, cast: [{ label: "Baker", color: "#CC2929" }, { label: "Wren", color: "#123456" }] }, ctx);
  assert.equal(colours.answers.colors, true);
  assert.match(colours.notes.join(" "), /Wren's #123456 is not one of ProPresenter's swatches/);
  const answered = await updateDraftTool({ draft_id: d.draft_id, reused: { title_slide: "title.png", title_extras: ["Welcome"] } }, ctx);
  assert.equal(answered.ask_before_building.length, 0);
  assert.equal(answered.slides, d.slides + 2, "the title slide opens and closes the show");

  const built = await buildTool({ draft_id: d.draft_id }, ctx);
  assert.equal(built.built, true);
  assert.equal(path.basename(built.file), "Baker.probundle");
  const { doc } = decodePresentation(readBundle(fs.readFileSync(built.file)).find((e) => e.name.endsWith(".pro")).data);
  assert.deepEqual(doc.cue_groups.map((g) => g.group.name), ["Baker", "Title"]);
  const baker = doc.cues.find((c) => c.actions.find((a) => a.slide).label?.text === "Baker");
  assert.equal(Math.round(baker.actions.find((a) => a.slide).label.color.red * 255), 0xcc);
  const second = await buildTool({ draft_id: d.draft_id }, ctx);
  assert.equal(path.basename(second.file), "Baker 2.probundle", "never over an existing file");
});

test("corrections use the slide numbers the person saw, before a title slide is added", { skip }, async () => {
  const { ctx } = setup();
  const d = await parseScriptTool({ text: SCRIPT, type: "example-show" }, ctx);
  const line = d.script.split("\n").find((l) => /Good morning/.test(l));
  assert.ok(line);
  const after = await updateDraftTool({ draft_id: d.draft_id, edits: [{ op: "replace", index: 1, beat: { text: "THE BAKER, THE BELL" } }, { op: "delete", index: 3 }], reused: { title_slide: "title.png" } }, ctx);
  const preview = await previewScriptTool({ draft_id: d.draft_id }, ctx);
  assert.match(preview.script, /^\s+2\s+TITLE: THE BAKER, THE BELL/m, "slide 1 as seen, now after the opening title slide");
  assert.doesNotMatch(preview.script, /Morning!/, "slide 3 as seen was deleted");
  assert.equal(after.slides, d.slides - 1 + 2);
  await assert.rejects(updateDraftTool({ draft_id: d.draft_id, edits: [{ op: "replace", index: 999, beat: { text: "x" } }] }, ctx), /not in this script/);
});

test("an inserted slide is new, not a copy of the slide it goes before; a delete past the end is refused", { skip }, async () => {
  const { ctx } = setup();
  const d = await parseScriptTool({ text: SCRIPT, type: "example-show" }, ctx);
  await updateDraftTool({ draft_id: d.draft_id, edits: [{ op: "insert", index: 2, beat: { kind: "note", text: "The bell rings offstage." } }] }, ctx);
  const draft = JSON.parse(fs.readFileSync(path.join(ctx.staging, "drafts", `${d.draft_id}.json`), "utf8"));
  const inserted = draft.beats[1];
  assert.equal(inserted.kind, "note");
  assert.equal(inserted.speaker, undefined, "no speaker carried over from the line it was put before");
  assert.notEqual(inserted.id, draft.beats[2].id);
  await assert.rejects(updateDraftTool({ draft_id: d.draft_id, edits: [{ op: "delete", index: draft.beats.length + 1 }] }, ctx), /op must be/);
});
