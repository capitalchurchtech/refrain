/**
 * Context for the assistant: what the church's ProPresenter knows by name (the workspace), and the church's
 * own skills, the written instructions for a specific job with the reference files that go with it.
 *
 * THE WORKSPACE, READ ONLY. When ProPresenter is installed here its workspace is read where it lives
 * (UserWorkspaces/<name>, the content folder; never the Workspaces state folder beside it, which holds the
 * database: paths.js). Without ProPresenter, a copy of a workspace's Configuration and Playlists folders in
 * the church folder's `workspace` is read instead. Nothing here writes to a workspace.
 *
 * SKILLS live in the church folder, `skills/<name>/SKILL.md` (a name and description at the top, then the
 * instructions), with reference files in `skills/<name>/files/`. The same folder works as a Claude skill. A
 * saved skill keeps its previous version in `.history/`, and a filed reference never replaces another file.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, copyFileSync, renameSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { forbiddenReason, openablePath } from "./paths.js";

const lib = () => import("propresenter-bundle");
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const USER_WORKSPACES = path.join(os.homedir(), "Library", "Application Support", "RenewedVision", "ProPresenter", "UserWorkspaces");
const PLAYLIST_ITEMS_MAX = 400;

/** The church's folder: Refrain's packs folder when one is set, else its default under ./data. */
export function churchFolder(config, root) {
  return path.resolve(root, config.probundleModule?.packsDir || "./data/probundle-packs");
}

/** A folder, as it really is, refused if it is ProPresenter's state rather than its content. */
function safeFolder(p) {
  const real = realpathSync(p);
  const why = forbiddenReason(real);
  if (why) throw new Error(`Not read: ${why}. This never reads ProPresenter's database.`);
  return real;
}

const looksLikeWorkspace = (dir) => existsSync(path.join(dir, "Configuration")) || existsSync(path.join(dir, "Playlists"));
const changed = (dir) => { try { return statSync(path.join(dir, "Configuration", "Workspace")).mtimeMs; } catch { return 0; } };

/** Every workspace this computer has, newest first, then the church folder's copy if there is one. */
export function findWorkspaces({ config, root, userWorkspaces = USER_WORKSPACES }) {
  const found = [];
  if (existsSync(userWorkspaces)) {
    for (const name of readdirSync(userWorkspaces)) {
      const dir = path.join(userWorkspaces, name);
      if (looksLikeWorkspace(dir)) found.push({ name, folder: dir, source: "ProPresenter on this computer", changed: changed(dir) });
    }
    found.sort((a, b) => b.changed - a.changed);
  }
  const copy = path.join(churchFolder(config, root), "workspace");
  if (looksLikeWorkspace(copy)) found.push({ name: "workspace (church folder copy)", folder: copy, source: "copy in the church folder", changed: changed(copy) });
  return found.map(({ changed: _c, ...w }) => w);
}

function pickWorkspace(env, which) {
  const all = findWorkspaces(env);
  if (which) {
    const w = all.find((x) => x.name === which) ?? (path.isAbsolute(which) && looksLikeWorkspace(which) ? { name: path.basename(which), folder: which, source: "folder given" } : null);
    if (!w) throw new Error(`No workspace ${which}. ${all.length ? `There are: ${all.map((x) => x.name).join(", ")}.` : ""}`);
    return { w, all };
  }
  if (!all.length) {
    throw new Error(`ProPresenter isn't installed on this computer, and the church folder has no copy of a workspace. To give the assistant your macros, Looks, labels and playlists, copy a workspace's Configuration and Playlists folders (from UserWorkspaces/<name> on the ProPresenter computer) into ${path.join(churchFolder(env.config, env.root), "workspace")}.`);
  }
  return { w: all[0], all };
}

function readPart(p, folder, part) {
  const file = path.join(folder, p.WORKSPACE_PARTS[part]);
  if (!existsSync(file)) return null;
  const real = realpathSync(file);
  const why = forbiddenReason(real);
  if (why) throw new Error(`Not read: ${why}. This never reads ProPresenter's database.`);
  return p.readWorkspacePart(part, readFileSync(real));
}

// A library can hold hundreds of playlists and thousands of items, so it is read a level at a time: the top
// level, then one folder, then one playlist. A folder below the level shown is a count, not its contents.
const playlistsIn = (nodes, out = []) => { for (const n of nodes) (n.kind === "folder" ? playlistsIn(n.children, out) : out.push(n)); return out; };
const level = (nodes) => nodes.map((n) => (n.kind === "folder" ? { kind: "folder", name: n.name, playlists: playlistsIn(n.children).length } : { kind: "playlist", name: n.name, items: n.items.length }));
const foldersIn = (nodes, out = []) => { for (const n of nodes) if (n.kind === "folder") { out.push(n); foldersIn(n.children, out); } return out; };

export async function readWorkspaceTool(args, env) {
  const p = await lib();
  const { w, all } = pickWorkspace(env, args.workspace);
  const folder = safeFolder(w.folder);
  const about = { workspace: { name: w.name, folder, source: w.source }, other_workspaces: all.filter((x) => x !== w).map((x) => x.name) };
  if (!args.part) {
    const parts = {};
    for (const part of Object.keys(p.WORKSPACE_PARTS)) {
      const r = readPart(p, folder, part);
      if (!r) { parts[part] = null; continue; }
      const { unknown, ...rest } = r;
      parts[part] = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== "part").map(([k, v]) => [k, Array.isArray(v) ? (k === "playlists" ? playlistsIn(v).length : v.length) : v ? 1 : 0]));
      if (unknown) parts[part].fields_not_understood = unknown;
    }
    return { ...about, parts, next: "Read a part by name for its contents, e.g. part: macros. For playlists, read the list, then one playlist by name or id." };
  }
  const r = readPart(p, folder, args.part);
  if (!r) throw new Error(`This workspace has no ${args.part} file.`);
  if (args.part !== "playlists") return { ...about, ...r };
  if (!args.playlist) {
    if (!args.folder) return { ...about, part: "playlists", unknown: r.unknown, playlists: level(r.playlists), next: "Ask for a folder by name, or a playlist by name." };
    const folders = foldersIn(r.playlists).filter((f) => f.name.toLowerCase() === String(args.folder).toLowerCase());
    if (!folders.length) throw new Error(`No playlist folder ${args.folder} in ${w.name}.`);
    return { ...about, part: "playlists", folder: folders[0].name, playlists: level(folders[0].children), ...(folders.length > 1 ? { note: `${folders.length} folders have that name; this is the first.` } : {}) };
  }
  const want = String(args.playlist);
  const hits = playlistsIn(r.playlists).filter((x) => x.id === want || x.name.toLowerCase() === want.toLowerCase());
  if (!hits.length) throw new Error(`No playlist ${want} in ${w.name}.`);
  if (hits.length > 1) return { ...about, part: "playlists", matches: hits.map((h) => ({ name: h.name, id: h.id, items: h.items.length })), next: "More than one playlist has that name: ask again by id." };
  const pl = hits[0];
  return { ...about, part: "playlists", unknown: r.unknown, playlist: { name: pl.name, id: pl.id, item_count: pl.items.length, items: pl.items.slice(0, PLAYLIST_ITEMS_MAX) } };
}

// --- Skills ---------------------------------------------------------------------------------------------

function skillDir(env, name) {
  if (!SKILL_NAME.test(name ?? "")) throw new Error("A skill's name is lower case letters, numbers and hyphens, like sermon-slides.");
  return path.join(churchFolder(env.config, env.root), "skills", name);
}

/** SKILL.md as { name, description, instructions }. */
function parseSkill(text, fallback) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const head = Object.fromEntries((m?.[1] ?? "").split("\n").map((l) => /^(\w+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2].trim()]));
  return { name: head.name || fallback, description: head.description ?? "", instructions: (m ? m[2] : text).trim() };
}

function filesOf(dir) {
  const files = path.join(dir, "files");
  if (!existsSync(files)) return [];
  return readdirSync(files).filter((f) => !f.startsWith(".")).sort().map((f) => ({ name: f, path: path.join(files, f) }));
}

export function listSkills(env) {
  const base = path.join(churchFolder(env.config, env.root), "skills");
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((n) => SKILL_NAME.test(n) && existsSync(path.join(base, n, "SKILL.md"))).sort().map((n) => {
    const s = parseSkill(readFileSync(path.join(base, n, "SKILL.md"), "utf8"), n);
    return { skill: n, description: s.description, files: filesOf(path.join(base, n)).map((f) => f.name) };
  });
}

export async function listSkillsTool(_args, env) {
  return { church_folder: churchFolder(env.config, env.root), skills: listSkills(env) };
}

export async function readSkillTool(args, env) {
  const dir = skillDir(env, args.skill);
  if (!existsSync(path.join(dir, "SKILL.md"))) throw new Error(`No skill ${args.skill}. ${listSkills(env).map((s) => s.skill).join(", ") || "There are none yet: save one with refrain_save_skill."}`);
  const s = parseSkill(readFileSync(path.join(dir, "SKILL.md"), "utf8"), args.skill);
  return { skill: args.skill, description: s.description, instructions: s.instructions, files: filesOf(dir) };
}

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export async function saveSkillTool(args, env) {
  const dir = skillDir(env, args.skill);
  const description = oneLine(args.description);
  if (!description) throw new Error("Give the skill a one-line description: what job it does and when to use it.");
  if (typeof args.instructions !== "string" || !args.instructions.trim()) throw new Error("Give the skill's instructions.");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  let previous = null;
  if (existsSync(file)) {
    // The old version is kept, never replaced: a person may want back what they had.
    mkdirSync(path.join(dir, ".history"), { recursive: true });
    previous = path.join(dir, ".history", `SKILL-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
    copyFileSync(file, previous);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, `---\nname: ${args.skill}\ndescription: ${description}\n---\n\n${args.instructions.trim()}\n`);
  await rename(tmp, file);
  return { skill: args.skill, file, previous_version: previous };
}

export async function fileAwayTool(args, env) {
  const from = openablePath(args.path);
  const dir = path.join(skillDir(env, args.skill), "files");
  if (!existsSync(path.join(path.dirname(dir), "SKILL.md"))) throw new Error(`No skill ${args.skill} yet. Save it with refrain_save_skill first, then file its references.`);
  mkdirSync(dir, { recursive: true });
  const ext = path.extname(from);
  const base = String(args.name ?? "").replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || path.basename(from, ext);
  let to = path.join(dir, `${base}${ext}`);
  for (let n = 2; existsSync(to); n++) to = path.join(dir, `${base} ${n}${ext}`);
  const tmp = `${to}.tmp-${process.pid}`;
  copyFileSync(from, tmp);
  renameSync(tmp, to);
  return { skill: args.skill, file: to, from };
}

/** The skills as MCP prompts, for an assistant that offers them as commands. */
export function skillPrompts(env) {
  return listSkills(env).map((s) => ({ name: s.skill, description: s.description }));
}

export async function skillPrompt(name, env) {
  const s = await readSkillTool({ skill: name }, env);
  const files = s.files.length ? `\n\nReference files (open them with refrain_open):\n${s.files.map((f) => `- ${f.path}`).join("\n")}` : "";
  return { description: s.description, messages: [{ role: "user", content: { type: "text", text: `Use the ${s.skill} skill.\n\n${s.instructions}${files}` } }] };
}
