// The MCP server as an assistant sees it (server/mcp/server.js), through the SDK's own client over an
// in-memory link: the names, the read/write marks, the setup status and its settings, and structured results
// that the client checks against each tool's schema. The tools' own behaviour is tested in
// mcp-script-tools.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, TOOLS } from "../server/mcp/server.js";

const lib = await import("propresenter-bundle").catch(() => null);
const skip = lib ? false : "propresenter-bundle is not installed";
const require = createRequire(import.meta.url);

async function connect(config, root) {
  const server = createMcpServer({ root, staging: path.join(root, "staging"), getConfig: () => config });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const text = (r) => r.content.map((c) => c.text).join("\n");

test("every tool is named refrain_…, says whether it writes, and has a result schema", async () => {
  const client = await connect({}, os.tmpdir());
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), TOOLS.map((t) => t.name));
  for (const t of tools) {
    assert.match(t.name, /^refrain_[a-z_]+$/);
    assert.equal(typeof t.annotations?.readOnlyHint, "boolean", `${t.name} says whether it only reads`);
    assert.equal(t.annotations.openWorldHint, false, `${t.name} talks to nothing outside this computer`);
    if (!t.annotations.readOnlyHint) assert.equal(typeof t.annotations.destructiveHint, "boolean", `${t.name} says whether it can destroy`);
    assert.equal(t.outputSchema?.type, "object");
  }
  const reads = tools.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
  assert.deepEqual(reads, ["refrain_setup_status", "refrain_open", "refrain_read_slide", "refrain_check", "refrain_read_workspace", "refrain_list_skills", "refrain_read_skill", "refrain_list_script_types", "refrain_preview_script"]);
});

test("setup status names the exact setting for each thing missing, and a tool that needs it says so", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-mcp-"));
  const off = await connect({ features: { probundle: false } }, root);
  const s = (await off.callTool({ name: "refrain_setup_status", arguments: {} })).structuredContent;
  assert.deepEqual(s.general_tools, { ready: Boolean(lib), problems: lib ? [] : s.general_tools.problems }, "the general tools need only the package");
  assert.equal(s.script_builder.ready, false);
  assert.equal(s.script_builder.bundles, "off");
  assert.match(s.script_builder.problems.join(" "), /Settings › Features › Bundles/);

  const refused = await off.callTool({ name: "refrain_list_script_types", arguments: {} });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /Settings › Features › Bundles.*refrain_setup_status/);

  const noFolder = await connect({ features: { probundle: true } }, root);
  const n = (await noFolder.callTool({ name: "refrain_setup_status", arguments: {} })).structuredContent.script_builder;
  assert.equal(n.bundles, "misconfigured");
  assert.match(n.problems.join(" "), /No packs folder is set yet\. Set it on Refrain's Bundles screen › Packs folder/);

  const missing = await connect({ features: { probundle: true }, probundleModule: { packsDir: path.join(root, "nope") } }, root);
  assert.match(text(await missing.callTool({ name: "refrain_parse_script", arguments: { text: "A: hi", type: "x" } })), /does not exist\. Set it on Refrain's Bundles screen/);

  const unknown = await off.callTool({ name: "parse_script", arguments: {} });
  assert.match(text(unknown), /No tool parse_script\. The tools are: refrain_setup_status/);
});

test("once set up, the script tools answer with results the client checks against their schemas", { skip }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "refrain-mcp-"));
  const kind = path.join(root, "packs", "example", "scripts", "example-show");
  fs.mkdirSync(kind, { recursive: true });
  const fix = path.join(path.dirname(require.resolve("propresenter-bundle/package.json")), "test", "fixtures");
  fs.copyFileSync(path.join(fix, "show-template.pro"), path.join(kind, "template.pro"));
  fs.copyFileSync(path.join(fix, "show-recipe.json"), path.join(kind, "recipe.json"));
  const client = await connect({ features: { probundle: true }, probundleModule: { packsDir: path.join(root, "packs") } }, root);
  await client.listTools(); // the client checks results only against schemas it has listed

  const status = (await client.callTool({ name: "refrain_setup_status", arguments: {} })).structuredContent.script_builder;
  assert.deepEqual([status.ready, status.kinds_of_show, status.problems], [true, 1, []]);

  const types = await client.callTool({ name: "refrain_list_script_types", arguments: {} });
  assert.deepEqual(types.structuredContent.types.map((t) => t.id), ["example/example-show"]);

  const parsed = await client.callTool({ name: "refrain_parse_script", arguments: { text: "BAKER: Good morning!\nWREN: Morning!", type: "example-show", name: "Baker" } });
  const d = parsed.structuredContent;
  assert.equal(parsed.content[0].text, d.script, "the script reads first, as text");
  assert.deepEqual(d.ask_before_building.map((q) => q.id), ["colors", "reused"]);

  const early = await client.callTool({ name: "refrain_build_script_bundle", arguments: { draft_id: d.draft_id } });
  assert.equal(early.structuredContent.built, false);
  assert.match(early.structuredContent.reason, /refrain_update_script_draft/);

  const updated = await client.callTool({ name: "refrain_update_script_draft", arguments: { draft_id: d.draft_id, cast: [{ label: "Baker", color: "#CC2929" }, { label: "Wren", color: "#123456" }], reused: {} } });
  assert.equal(updated.structuredContent.ask_before_building.length, 0);
  const built = await client.callTool({ name: "refrain_build_script_bundle", arguments: { draft_id: d.draft_id } });
  assert.equal(built.structuredContent.built, true);
  assert.ok(fs.existsSync(built.structuredContent.file));
});
