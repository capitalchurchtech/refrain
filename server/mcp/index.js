#!/usr/bin/env node
/**
 * Refrain's MCP server: tools an assistant (Claude) calls on the machine that holds the church's files. Today
 * that is the script builder: a play's script into a ProPresenter bundle built from the booth's own master
 * slides. Run it over stdio (`npm run mcp`); it reads Refrain's own config.json, so it is on only when the
 * Bundles feature is on and its packs folder is set, and says why not otherwise.
 *
 * It never writes into ProPresenter's library: drafts and built bundles go to the staging folder
 * (data/probundle-staging), and the person imports a bundle themselves. No telemetry, nothing over the network.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// config.json and the data folder are relative to Refrain's own folder, wherever the assistant starts us from.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(ROOT);
const { loadConfig, getProbundleModuleStatus, probundleModuleProblems } = await import("../config.js");
const tools = await import("./script-tools.js");

const STAGING = path.join(ROOT, "data", "probundle-staging");

/** The packs folder, or the reason the script builder is not available. */
function context() {
  const config = loadConfig();
  const status = getProbundleModuleStatus(config);
  if (status === "off") throw new Error("Bundles is switched off in Refrain (Settings › Features › Bundles).");
  if (status !== "active") throw new Error(`Bundles is not set up: ${probundleModuleProblems(config).join(" ")}`);
  return { packsDir: path.resolve(ROOT, config.probundleModule.packsDir), staging: STAGING };
}

const BEAT = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["line", "heading", "note", "cue", "lights", "picture", "background", "video", "audio", "reset"] },
    speaker: { type: "string" }, text: { type: "string" }, file: { type: "string" }, length: { type: "string" },
    label: { type: "string" }, vista: { type: "string", description: "Lights cue for the slide's notes, e.g. 139,1" },
    macro: { type: "string", enum: ["auto", "none", "script", "slide"] },
  },
};

const TOOLS = [
  {
    name: "list_script_types",
    description: "The kinds of show this church can build from a script (a skit, a camp night and so on), from its own template packs. Call first to pick the type for parse_script.",
    inputSchema: { type: "object", properties: {} },
    run: (_args, ctx) => ({ types: tools.listTypes(ctx.packsDir).map(({ dir, ...t }) => t) }),
  },
  {
    name: "parse_script",
    description: "Read a play's script (pasted text: NAME: words, [directions], {tech notes}, or a screenplay's text) into a draft: one slide per line, direction, cue, picture or background. Returns the draft read back as a script, the booth's checklist, and the questions to ASK THE PERSON before building (label colours, reused slides). Show the person the script and ask those questions; do not answer them yourself.",
    inputSchema: { type: "object", required: ["text", "type"], properties: { text: { type: "string" }, type: { type: "string", description: "A type id from list_script_types, e.g. my-church/family-service" }, name: { type: "string", description: "The presentation's name" } } },
    run: (args, ctx) => tools.parseScriptTool(args, ctx),
  },
  {
    name: "preview_script",
    description: "A draft read back as a play's script (numbered slides, speakers, directions, cue slides) with the booth's checklist: sound and video slides to add and test, lights as Vista notes, pictures to pull or create, macros on and after gag slides, timing.",
    inputSchema: { type: "object", required: ["draft_id"], properties: { draft_id: { type: "string" } } },
    run: (args, ctx) => tools.previewScriptTool(args, ctx),
  },
  {
    name: "update_script_draft",
    description: "Record the person's answers and corrections on a draft. cast: the label colour for each speaker, as the person chose (#rrggbb; ProPresenter's swatches are offered). reused: the person's answer about reused slides (title_slide: a picture file in Media/Assets, or none). edits: corrections to slides by number (replace, insert, delete).",
    inputSchema: {
      type: "object", required: ["draft_id"],
      properties: {
        draft_id: { type: "string" }, name: { type: "string" },
        cast: { type: "array", items: { type: "object", required: ["label", "color"], properties: { label: { type: "string" }, color: { type: "string" } } } },
        reused: { type: "object", properties: { title_slide: { type: "string" }, title_extras: { type: "array", items: { type: "string" } }, after: { type: "number" }, bookend: { type: "boolean" }, verse_slide: { type: "string" }, logo_slide: { type: "string" } } },
        edits: { type: "array", items: { type: "object", required: ["op", "index"], properties: { op: { type: "string", enum: ["replace", "insert", "delete"] }, index: { type: "number", description: "Slide number, 1-based, as the preview shows it" }, beat: BEAT } } },
      },
    },
    run: (args, ctx) => tools.updateDraftTool(args, ctx),
  },
  {
    name: "build_script_bundle",
    description: "Build the draft into a .probundle in Refrain's staging folder, from the church's own master slides. Refuses until the person has answered the colour and reused-slides questions. Never overwrites a file and never touches ProPresenter's library: the person imports the bundle.",
    inputSchema: { type: "object", required: ["draft_id"], properties: { draft_id: { type: "string" } } },
    run: (args, ctx) => tools.buildTool(args, ctx),
  },
];

const server = new Server({ name: "refrain", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.map(({ run, ...t }) => t) }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) return { isError: true, content: [{ type: "text", text: `No tool ${req.params.name}.` }] };
  try {
    const result = await tool.run(req.params.arguments ?? {}, context());
    // The script reads best as text; everything else as JSON beside it.
    const { script, ...rest } = result ?? {};
    return { content: [...(script ? [{ type: "text", text: script }] : []), { type: "text", text: JSON.stringify(rest, null, 1) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err.message }] };
  }
});

await server.connect(new StdioServerTransport());
