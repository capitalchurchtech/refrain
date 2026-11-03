/**
 * Refrain's MCP tools and the server that offers them, apart from the transport so a test can talk to it.
 *
 * Every tool is named refrain_… (it sits beside other servers in an assistant), says whether it only reads or
 * also writes, and returns structured results with a schema as well as text. The general tools need only the
 * package (`needs: "package"`); the script tools also need the church's packs (`needs: "packs"`);
 * refrain_setup_status needs nothing, so an assistant can always find out
 * what is missing and tell the person the exact setting to change. The package is loaded only when a tool
 * uses it, so a missing package is reported rather than stopping the server.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getProbundleModuleStatus, probundleModuleProblems } from "../config.js";

const require = createRequire(import.meta.url);

// Where each setting is changed, in the words of Refrain's own screens.
const WHERE = {
  feature: "Refrain: Settings › Features › Bundles",
  packsDir: "Refrain's Bundles screen › Packs folder (probundleModule.packsDir in config.json)",
};

/** The package's version, or null when it is not installed. */
async function packageVersion() {
  try {
    await import("propresenter-bundle");
    return require("propresenter-bundle/package.json").version ?? "unknown";
  } catch {
    return null;
  }
}

const scriptTools = () => import("./script-tools.js");
const fileTools = () => import("./file-tools.js");
const contextTools = () => import("./context-tools.js");

/**
 * What is set up and what is not, each problem with the setting that fixes it. The general tools need only
 * the package; the script builder also needs Bundles on and its packs. Neither needs ProPresenter.
 */
export async function setupStatus({ config, root, staging, userWorkspaces }) {
  const version = await packageVersion();
  const general = version ? [] : ["The propresenter-bundle package is not installed. Run npm install in Refrain's folder, then restart the assistant."];
  const bundles = getProbundleModuleStatus(config);
  const dir = config.probundleModule?.packsDir;
  const packsDir = dir ? path.resolve(root, dir) : null;
  const script = [...general];
  if (bundles === "off") script.push(`Bundles is switched off. Turn it on in ${WHERE.feature}.`);
  else if (bundles === "misconfigured") for (const p of probundleModuleProblems(config)) script.push(`${p} Set it on ${WHERE.packsDir}.`);
  let kinds = null;
  if (version && bundles === "active") {
    kinds = (await scriptTools()).listTypes(packsDir).length;
    if (!kinds) script.push(`The packs folder has no kinds of show yet. Each is a folder <pack>/scripts/<kind>/ in ${packsDir}, holding the booth's template.pro and a recipe.json.`);
  }
  const ctx = await contextTools();
  const workspaces = ctx.findWorkspaces({ config, root, ...(userWorkspaces ? { userWorkspaces } : {}) });
  return {
    package: { installed: Boolean(version), version },
    staging,
    context: {
      church_folder: ctx.churchFolder(config, root),
      skills: ctx.listSkills({ config, root }).length,
      workspace: workspaces[0] ? { name: workspaces[0].name, source: workspaces[0].source } : null,
      note: workspaces.length ? null : "No ProPresenter workspace here: the tools still read any file given. Copy a workspace's Configuration and Playlists folders into the church folder's workspace folder for macros, Looks and playlists.",
    },
    general_tools: { ready: general.length === 0, problems: general },
    script_builder: { ready: script.length === 0, bundles, packs_folder: packsDir, kinds_of_show: kinds, problems: script },
  };
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

// What a draft looks like in every script tool's answer.
const DRAFT = {
  draft_id: { type: "string" }, name: { type: "string" }, type: { type: "string" }, type_label: { type: "string" },
  slides: { type: "integer" }, counts: { type: "object" }, cast: { type: "array" }, answers: { type: "object" },
  ask_before_building: { type: "array", description: "Questions to put to the person before building. Empty when answered." },
};
const DRAFT_REQUIRED = ["draft_id", "name", "type", "slides", "ask_before_building"];
const READ = { readOnlyHint: true, openWorldHint: false };

// Where a tool reads from: a document by its path, or a working copy by its id.
const FROM = {
  path: { type: "string", description: "Full path of a .pro, .probundle, .protheme or .proplaylist on this computer" },
  inside: { type: "string", description: "With a .proplaylist path: the presentation in it, by file name" },
  copy_id: { type: "string", description: "A working copy from refrain_make_copy, instead of a path" },
};
const SLIDE = { type: "object", properties: { number: { type: "integer" }, id: { type: ["string", "null"] }, words: { type: "string" }, boxes: { type: ["array", "integer"], items: { type: "object" } } } };
const CHANGE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

// Open, read, check and change any ProPresenter document. Need only the package: not ProPresenter, not Bundles.
const GENERAL = [
  {
    name: "refrain_open",
    title: "Open a ProPresenter file",
    description: "Open a presentation (.pro), bundle (.probundle), theme (.protheme) or playlist (.proplaylist: its items, arrangement names and the presentations it carries; open one of those with inside) and list every slide, numbered from 1, in brief: its label or name, the start of its words, how many boxes, its macros. With boxes: true, every box on every slide (id, name, kind, the start of its words), as a whole-file job like renaming needs; for one slide, refrain_read_slide is lighter. Read only: the file is not changed. ProPresenter's database is never opened.",
    inputSchema: { type: "object", properties: { ...FROM, boxes: { type: "boolean", description: "List every box on every slide (larger)" } } },
    outputSchema: { type: "object", required: ["file", "kind", "slide_count", "slides", "can_change"], properties: { file: { type: "string" }, copy_id: { type: "string" }, kind: { type: "string", enum: ["pro", "probundle", "protheme", "proplaylist"] }, name: { type: "string" }, slide_count: { type: "integer" }, can_change: { type: "boolean" }, unreadable_fields: { type: "integer" }, slides: { type: "array", items: SLIDE } } },
    annotations: READ,
    needs: "package",
    run: async (args, env) => (await fileTools()).openTool(args, env),
  },
  {
    name: "refrain_read_slide",
    title: "Read one slide in full",
    description: "One slide in full: every box with its id, name, kind, role, position and size, font, type size, capitals, picture and all its words; the slide's macros and media, and every action it fires, in plain words. slide is its number from refrain_open, or its id.",
    inputSchema: { type: "object", required: ["slide"], properties: { ...FROM, slide: { type: ["integer", "string"] } } },
    outputSchema: { type: "object", required: ["file", "kind", "slide"], properties: { file: { type: "string" }, kind: { type: "string" }, slide: SLIDE } },
    annotations: READ,
    needs: "package",
    run: async (args, env) => (await fileTools()).readSlideTool(args, env),
  },
  {
    name: "refrain_check",
    title: "Check a file",
    description: "What will go wrong or needs tidying: fields the reader can't understand, media a bundle leaves out, text predicted to overflow its box (a rough guess without the church's font table), boxes with no name, and boxes on one slide sharing a name.",
    inputSchema: { type: "object", properties: FROM },
    outputSchema: { type: "object", required: ["file", "findings"], properties: { file: { type: "string" }, kind: { type: "string" }, findings: { type: "array", items: { type: "object" } } } },
    annotations: READ,
    needs: "package",
    run: async (args, env) => (await fileTools()).checkTool(args, env),
  },
  {
    name: "refrain_make_copy",
    title: "Make a working copy",
    description: "Copy a file into Refrain's staging folder to change it. Every change is made on the copy; the original is never touched. Refused for a file holding fields the reader can't understand, so nothing in it is lost. Returns the copy_id the change tools take.",
    inputSchema: { type: "object", required: ["path"], properties: { path: FROM.path, inside: FROM.inside, name: { type: "string", description: "Name for the copy; default: the original's name plus (edited)" } } },
    outputSchema: { type: "object", required: ["copy_id", "file", "kind"], properties: { copy_id: { type: "string" }, file: { type: "string" }, kind: { type: "string" }, name: { type: "string" }, from: { type: "string" } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    needs: "package",
    run: async (args, env) => (await fileTools()).makeCopyTool(args, env),
  },
  {
    name: "refrain_edit_boxes",
    title: "Change boxes",
    description: "Change boxes on a working copy, by box id, as ProPresenter's editor would: a list of changes, each with the box and only what should change. Words keep the box's font and capitals (**double asterisks** for bold); line_spacing is a multiple of single (1.2); a box linked to its slide's label sets the label, and one linked to anything else (a timer, the clock) has no words of its own. Position and size are slide pixels. arrange: front, back, forward, backward, duplicate or delete. picture: a new picture or video in a picture box (bundles). A font not used in the file needs font_family. Colours are #rrggbb, or none. All checked together: if one is wrong, none is saved. Changes only the copy.",
    inputSchema: {
      type: "object", required: ["copy_id", "changes"],
      properties: {
        copy_id: FROM.copy_id,
        changes: {
          type: "array",
          items: {
            type: "object", required: ["box"],
            properties: {
              box: { type: "string" }, name: { type: "string" }, words: { type: "string" }, type_size: { type: "number" },
              font: { type: "string" }, font_family: { type: "string" }, text_color: { type: "string" },
              align: { enum: ["left", "center", "right", "justify"] }, vertical_align: { enum: ["top", "middle", "bottom"] },
              fit: { enum: ["none", "grow_box", "shrink_text", "grow_text", "fit_text"] }, capitals: { enum: ["none", "all", "small", "title", "start"] },
              line_spacing: { type: "number", description: "A multiple of single spacing, e.g. 1.2" },
              x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, rotation: { type: "number" },
              fill: { type: "string" }, outline: { type: "string" }, outline_width: { type: "number" }, shadow: { type: "boolean" },
              opacity: { type: "number" }, hidden: { type: "boolean" }, locked: { type: "boolean" },
              arrange: { enum: ["front", "back", "forward", "backward", "duplicate", "delete"] },
              picture: { type: "string", description: "Full path of a picture or video to replace the one in a picture box" },
            },
          },
        },
      },
    },
    outputSchema: { type: "object", required: ["copy_id", "changes"], properties: { copy_id: { type: "string" }, file: { type: "string" }, changes: { type: "array", items: { type: "object" } } } },
    annotations: CHANGE,
    needs: "package",
    run: async (args, env) => (await fileTools()).editBoxesTool(args, env),
  },
  {
    name: "refrain_edit_slides",
    title: "Change slides",
    description: "Change whole slides on a working copy: a list of changes, each with the slide (its number when the copy was opened, or its id) and only what should change: label, label_color, enabled, background (#rrggbb or none), group (moves it, making the group if new), move (up, down, first, last, duplicate, delete, within its group), add_macro and remove_macro (by name, from ProPresenter's workspace or another slide in the file), add_media (a picture, video or sound file as a background or foreground media action, or a picture or video as a box; on a bundle, which carries the file) and remove_media (by file name), add_action (clear a layer, a Look, prop, message, timer, clear group or stage layout, by its name in ProPresenter's workspace) and remove_action (by kind, and name). Also groups ({ name, rename, color }), arrangements ({ name, groups in play order, rename, delete }), play_arrangement, and the presentation's name. notes sets a slide's notes; transition (an effect's name, copied from a slide that already uses it, in this file or ProPresenter's library) and transition_seconds its transition. All checked together: if one is wrong, none is saved. Changes only the copy.",
    inputSchema: {
      type: "object", required: ["copy_id"],
      properties: {
        copy_id: FROM.copy_id,
        changes: {
          type: "array",
          items: {
            type: "object", required: ["slide"],
            properties: {
              slide: { type: ["integer", "string"] }, label: { type: "string" }, label_color: { type: "string" }, enabled: { type: "boolean" }, notes: { type: "string", description: "The slide's notes; empty removes them" }, transition: { type: "string", description: "An effect's name (Dissolve, Cut…) or none" }, transition_seconds: { type: "number" },
              background: { type: "string" }, group: { type: "string" }, move: { enum: ["up", "down", "first", "last", "duplicate", "delete"] },
              add_macro: { type: ["string", "array"], items: { type: "string" } }, remove_macro: { type: ["string", "array"], items: { type: "string" } },
              add_media: {
                type: "array",
                items: { type: "object", required: ["file"], properties: { file: { type: "string", description: "Full path of a picture, video or sound" }, as: { enum: ["background", "foreground", "box"] }, name: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } } },
              },
              remove_media: { type: ["string", "array"], items: { type: "string" }, description: "A media file's name, as a media action or a picture box" },
              add_action: {
                type: "array",
                items: {
                  type: "object", required: ["kind"],
                  properties: {
                    kind: { enum: ["clear", "look", "prop", "message", "timer", "clear group", "stage layout"] }, name: { type: "string" },
                    what: { enum: ["all", "audio", "background", "live_video", "prop", "slide", "logo", "messages", "audio_effects"], description: "For clear" },
                    do: { enum: ["start", "stop", "reset", "reset_and_start", "stop_and_reset", "increment"], description: "For timer" },
                    screens: { type: "array", items: { type: "string" }, description: "For stage layout; default every stage screen" },
                  },
                },
              },
              remove_action: { type: "array", items: { type: "object", required: ["kind"], properties: { kind: { type: "string" }, name: { type: "string" } } } },
            },
          },
        },
        groups: { type: "array", items: { type: "object", required: ["name"], properties: { name: { type: "string" }, rename: { type: "string" }, color: { type: "string" } } } },
        arrangements: { type: "array", items: { type: "object", required: ["name"], properties: { name: { type: "string" }, groups: { type: "array", items: { type: "string" }, description: "Group names in the order they play (makes the arrangement if new)" }, rename: { type: "string" }, delete: { type: "boolean" } } } },
        play_arrangement: { type: "string", description: "The arrangement that plays when the presentation opens, or none" },
        name: { type: "string" },
      },
    },
    outputSchema: { type: "object", required: ["copy_id"], properties: { copy_id: { type: "string" }, file: { type: "string" }, slides: { type: "array" }, groups: { type: "array" }, name: { type: "string" }, notes: { type: "array" } } },
    annotations: CHANGE,
    needs: "package",
    run: async (args, env) => (await fileTools()).editSlidesTool(args, env),
  },
  {
    name: "refrain_build_from",
    title: "Build a presentation from existing slides",
    description: "A new presentation made by copying slides of an existing presentation or bundle (last week's sermon, say), or of a theme (its slides as masters, their pictures carried): each slide as it is, with its macros, links and pictures, and new words in the boxes you name (a box linked to the slide label sets the label). slides: a list of { from: slide number or id, group: group name, label, words: { box id: new words } }. Writes a new .probundle in Refrain's staging folder, with the pictures those slides use; never over a file, never into ProPresenter's library. The source is only read.",
    inputSchema: {
      type: "object", required: ["source", "name", "slides"],
      properties: {
        source: { type: "object", properties: FROM }, name: { type: "string" },
        slides: { type: "array", items: { type: "object", required: ["from"], properties: { from: { type: ["integer", "string"] }, group: { type: "string" }, label: { type: "string" }, words: { type: "object", additionalProperties: { type: "string" } } } } },
      },
    },
    outputSchema: { type: "object", required: ["file", "slides"], properties: { file: { type: "string" }, name: { type: "string" }, slides: { type: "integer" }, groups: { type: "array" }, media_included: { type: "array" }, media_not_included: { type: "array" }, next: { type: "string" } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    needs: "package",
    run: async (args, env) => (await fileTools()).buildFromTool(args, env),
  },
];

// Context: the workspace (read only) and the church's skills, in the church folder.
const CONTEXT = [
  {
    name: "refrain_read_workspace",
    title: "Read ProPresenter's workspace",
    description: "What this church's ProPresenter knows by name: macros, Looks and screens, labels, groups, props, messages, timers, stage layouts, clear groups and playlists. Read only. Uses ProPresenter's workspace on this computer when it is installed, else a copy kept in the church folder. With no part, a count of each; with part, its contents. Playlists are read a level at a time: the top level, then a folder by name, then a playlist by name or id. Never reads ProPresenter's database.",
    inputSchema: {
      type: "object",
      properties: {
        part: { type: "string", enum: ["macros", "looks", "labels", "groups", "props", "messages", "timers", "stage_layouts", "clear_groups", "playlists"] },
        folder: { type: "string", description: "With part playlists: one folder's name, to see what is in it" },
        playlist: { type: "string", description: "With part playlists: one playlist's name or id, to see its items" },
        workspace: { type: "string", description: "Which workspace, when there is more than one; default the one used most recently" },
      },
    },
    outputSchema: { type: "object", required: ["workspace"], properties: { workspace: { type: "object" }, other_workspaces: { type: "array" }, parts: { type: "object" }, part: { type: "string" } } },
    annotations: READ,
    needs: "package",
    run: async (args, env) => (await contextTools()).readWorkspaceTool(args, env),
  },
  {
    name: "refrain_workspace_to_presentation",
    title: "Stage layouts or props as a presentation",
    description: "ProPresenter can't import a stage layout or a prop, and the workspace is never written here. This makes them an ordinary presentation instead: one slide per stage layout or prop (all, or those named), every box as it is, links to the current slide, clock and timers included, with the pictures they use. The person imports it, can tidy it first with refrain_make_copy and refrain_edit_boxes, and copies the boxes into ProPresenter's stage layout or prop editor. Writes a new .probundle in Refrain's staging folder.",
    inputSchema: { type: "object", required: ["part"], properties: { part: { enum: ["stage_layouts", "props"] }, names: { type: "array", items: { type: "string" } }, name: { type: "string" }, workspace: { type: "string" } } },
    outputSchema: { type: "object", required: ["file", "slides"], properties: { file: { type: "string" }, slides: { type: "integer" }, from: { type: "object" }, names: { type: "array" }, media_included: { type: "array" }, media_not_found: { type: "array" }, next: { type: "string" } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    needs: "package",
    run: async (args, env) => (await contextTools()).workspaceToPresentationTool(args, env),
  },
  {
    name: "refrain_list_skills",
    title: "The church's skills",
    description: "The church's skills: written instructions for a specific job (sermon slides, tidying a theme, a skit, anything) with the reference files that go with it, kept in the church folder. Check here before a job, and read the skill that fits.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", required: ["church_folder", "skills"], properties: { church_folder: { type: "string" }, skills: { type: "array", items: { type: "object" } } } },
    annotations: READ,
    run: async (args, env) => (await contextTools()).listSkillsTool(args, env),
  },
  {
    name: "refrain_read_skill",
    title: "Read a skill",
    description: "A skill's instructions and the full paths of its reference files (open those with refrain_open). Follow the instructions for that job.",
    inputSchema: { type: "object", required: ["skill"], properties: { skill: { type: "string" } } },
    outputSchema: { type: "object", required: ["skill", "instructions", "files"], properties: { skill: { type: "string" }, description: { type: "string" }, instructions: { type: "string" }, files: { type: "array", items: { type: "object" } } } },
    annotations: READ,
    run: async (args, env) => (await contextTools()).readSkillTool(args, env),
  },
  {
    name: "refrain_save_skill",
    title: "Save a skill",
    description: "Write or rewrite a skill with the person: its name (lower case and hyphens), a one-line description of the job and when to use it, and the instructions. Show the person the instructions before saving. The previous version is kept in the skill's .history folder.",
    inputSchema: { type: "object", required: ["skill", "description", "instructions"], properties: { skill: { type: "string" }, description: { type: "string" }, instructions: { type: "string" } } },
    outputSchema: { type: "object", required: ["skill", "file"], properties: { skill: { type: "string" }, file: { type: "string" }, previous_version: { type: ["string", "null"] } } },
    // A rewrite replaces the instructions, but the old ones are kept beside them.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (args, env) => (await contextTools()).saveSkillTool(args, env),
  },
  {
    name: "refrain_file_away",
    title: "Keep a file with a skill",
    description: "Copy a ProPresenter file the person gives (a theme, last week's bundle) into a skill's reference files, so it is there next time. The original stays where it is; a file already there is never replaced.",
    inputSchema: { type: "object", required: ["path", "skill"], properties: { path: { type: "string" }, skill: { type: "string" }, name: { type: "string", description: "Name to keep it under; default its own" } } },
    outputSchema: { type: "object", required: ["skill", "file"], properties: { skill: { type: "string" }, file: { type: "string" }, from: { type: "string" } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (args, env) => (await contextTools()).fileAwayTool(args, env),
  },
];

export const TOOLS = [
  {
    name: "refrain_setup_status",
    title: "What is set up",
    description: "What is set up on this computer and what is missing, each with the exact setting in Refrain that fixes it: the church folder, its skills and the ProPresenter workspace in use; the general tools (open, read, check and change ProPresenter files; they need only the package) and the script builder (it also needs Refrain's Bundles feature and the church's packs). Neither needs ProPresenter. Call this first, and whenever another tool says something is not set up, so you can tell the person what to change.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object", required: ["package", "general_tools", "script_builder"],
      properties: {
        package: { type: "object" }, staging: { type: "string" }, context: { type: "object" },
        general_tools: { type: "object", required: ["ready", "problems"], properties: { ready: { type: "boolean" }, problems: { type: "array", items: { type: "string" } } } },
        script_builder: {
          type: "object", required: ["ready", "bundles", "problems"],
          properties: {
            ready: { type: "boolean" }, bundles: { type: "string", enum: ["off", "misconfigured", "active"] },
            packs_folder: { type: ["string", "null"] }, kinds_of_show: { type: ["integer", "null"] }, problems: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    annotations: READ,
    run: (_args, env) => setupStatus(env),
  },
  ...GENERAL,
  ...CONTEXT,
  {
    name: "refrain_list_script_types",
    title: "Kinds of show",
    description: "The kinds of show this church can build from a script (a skit, a camp night and so on), from its own template packs. Call first to pick the type for refrain_parse_script.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", required: ["types"], properties: { types: { type: "array", items: { type: "object" } } } },
    annotations: READ,
    needs: "packs",
    run: async (_args, ctx) => ({ types: (await scriptTools()).listTypes(ctx.packsDir).map(({ dir, ...t }) => t) }),
  },
  {
    name: "refrain_parse_script",
    title: "Read a script into a draft",
    description: "Read a play's script (pasted text: NAME: words, [directions], {tech notes}, or a screenplay's text) into a draft: one slide per line, direction, cue, picture or background. Returns the draft read back as a script, the booth's checklist, and the questions to ASK THE PERSON before building (label colours, reused slides). Show the person the script and ask those questions; do not answer them yourself.",
    inputSchema: { type: "object", required: ["text", "type"], properties: { text: { type: "string" }, type: { type: "string", description: "A type id from refrain_list_script_types, e.g. my-church/family-service" }, name: { type: "string", description: "The presentation's name" } } },
    outputSchema: { type: "object", required: [...DRAFT_REQUIRED, "script", "checklist"], properties: { ...DRAFT, script: { type: "string" }, checklist: { type: "object" } } },
    // Writes a new draft file in Refrain's staging folder; nothing else.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    needs: "packs",
    run: async (args, ctx) => (await scriptTools()).parseScriptTool(args, ctx),
  },
  {
    name: "refrain_preview_script",
    title: "Read a draft back",
    description: "A draft read back as a play's script (numbered slides, speakers, directions, cue slides) with the booth's checklist: sound and video slides to add and test, lights as Vista notes, pictures to pull or create, macros on and after gag slides, timing.",
    inputSchema: { type: "object", required: ["draft_id"], properties: { draft_id: { type: "string" } } },
    outputSchema: { type: "object", required: [...DRAFT_REQUIRED, "script", "checklist"], properties: { ...DRAFT, script: { type: "string" }, checklist: { type: "object" } } },
    annotations: READ,
    needs: "packs",
    run: async (args, ctx) => (await scriptTools()).previewScriptTool(args, ctx),
  },
  {
    name: "refrain_update_script_draft",
    title: "Record answers and corrections",
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
    outputSchema: { type: "object", required: [...DRAFT_REQUIRED, "notes"], properties: { ...DRAFT, notes: { type: "array", items: { type: "string" } } } },
    // Changes the draft in place, and an edit can delete one of its slides. Only the draft: no bundle, no library.
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    needs: "packs",
    run: async (args, ctx) => (await scriptTools()).updateDraftTool(args, ctx),
  },
  {
    name: "refrain_build_script_bundle",
    title: "Build the bundle",
    description: "Build the draft into a .probundle in Refrain's staging folder, from the church's own master slides. Refuses until the person has answered the colour and reused-slides questions. Never overwrites a file and never touches ProPresenter's library: the person imports the bundle.",
    inputSchema: { type: "object", required: ["draft_id"], properties: { draft_id: { type: "string" } } },
    outputSchema: {
      type: "object", required: ["built"],
      properties: {
        built: { type: "boolean" }, reason: { type: "string" }, ask_before_building: { type: "array" },
        file: { type: "string" }, slides: { type: "integer" }, checklist: { type: "object" }, next: { type: "string" },
      },
    },
    // Writes a new bundle, never over an existing file.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    needs: "packs",
    run: async (args, ctx) => (await scriptTools()).buildTool(args, ctx),
  },
];

/**
 * One tool call, as the MCP answer. A result is returned twice, as the spec asks: structured, and as text for
 * an assistant that reads only text (a play's script first, since it reads best as itself). The text is JSON
 * without spacing: every character costs the assistant's allowance.
 */
export async function callTool(name, args, env) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { isError: true, content: [{ type: "text", text: `No tool ${name}. The tools are: ${TOOLS.map((t) => t.name).join(", ")}.` }] };
  try {
    let ctx = env;
    if (tool.needs) {
      const status = await setupStatus(env);
      const sb = status.script_builder;
      // The script tools are stopped only by a missing package or Bundles not ready: an empty packs folder
      // still lets one say which kinds there are (none), and that problem only arises once both are fine.
      const stop = tool.needs === "packs" ? (!status.package.installed || sb.bundles !== "active" ? sb.problems[0] : null) : status.general_tools.problems[0];
      if (stop) throw new Error(`${stop} (refrain_setup_status lists everything that is missing.)`);
      if (tool.needs === "packs") ctx = { ...env, packsDir: sb.packs_folder };
    }
    const result = (await tool.run(args ?? {}, ctx)) ?? {};
    const { script, ...rest } = result;
    return {
      structuredContent: result,
      content: [...(script ? [{ type: "text", text: script }] : []), { type: "text", text: JSON.stringify(rest) }],
    };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err.message }] };
  }
}

/**
 * The server, not yet connected. `getConfig` is read on every call, so a setting changed in Refrain applies
 * without restarting the assistant. `userWorkspaces` points somewhere other than ProPresenter's own folder (tests).
 */
export function createMcpServer({ root, staging, getConfig, userWorkspaces }) {
  const server = new Server({ name: "refrain", version: "0.2.0" }, { capabilities: { tools: {}, prompts: {} } });
  const env = () => ({ root, staging, config: getConfig(), ...(userWorkspaces ? { userWorkspaces } : {}) });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.map(({ run, needs, ...t }) => t) }));
  server.setRequestHandler(CallToolRequestSchema, (req) => callTool(req.params.name, req.params.arguments, env()));
  // The church's skills, also as prompts, for an assistant that offers prompts as commands.
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: (await contextTools()).skillPrompts(env()) }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => (await contextTools()).skillPrompt(req.params.name, env()));
  return server;
}
