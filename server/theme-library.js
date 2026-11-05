/**
 * The church's theme library, and which of its themes an assistant may use.
 *
 * ProPresenter exports every theme it has into one .protheme, and the export
 * has no preview, so the person choosing what to export can't see what they are
 * choosing. Bundles › Themes takes that file, splits it into one file per theme,
 * draws each so it can be looked at, and lets the person tick the on-brand ones.
 * The MCP server opens only a theme that is ticked (server/mcp/file-tools.js):
 * unticked is the default, and a theme anywhere else on the computer is
 * refused too, so a stray export can't go around the list.
 *
 * Kept in the packs folder, outside Refrain's code:
 *   <packs>/themes/index.json      [{ id, name, sha, allowed, added }]
 *   <packs>/themes/<id>.protheme   one theme and its pictures
 * `sha` is the hash of the theme's own data, so the same theme uploaded twice is
 * one entry (and keeps its tick), and a changed theme of the same name is a new
 * entry, unticked, rather than inheriting the old one's approval.
 *
 * Nothing here talks to ProPresenter or to the network. Theme names are shown as
 * written. Writes are temp-then-rename like the other files a person would hate
 * to lose.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";

const THEME_ENTRY = /(^|\/)Theme$/;
// A theme and its pictures are small. A zip that unpacks to more than this in one entry is refused rather than held in memory.
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** Where a church's themes live: under its packs folder (the default under ./data when none is set). */
export const themesDir = (config, root) => path.join(path.resolve(root, config?.probundleModule?.packsDir || "./data/probundle-packs"), "themes");

/**
 * Whether a zip might hold a theme, from its entry names alone (nothing is unpacked, so a huge bundle costs
 * nothing). A zip this can't walk (an entry size it can't read here) answers yes: the reader that opens it
 * next fails the same way, and a "maybe" only costs a closer look. This is what keeps a theme from going
 * around the tick by a different file extension.
 * @param {Buffer} buf
 */
export function mightHoldTheme(buf) {
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) return false;
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const flags = buf.readUInt16LE(p + 6);
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const start = p + 30 + nameLen + buf.readUInt16LE(p + 28);
    if (THEME_ENTRY.test(buf.subarray(p + 30, p + 30 + nameLen).toString("utf8"))) return true;
    if (flags & 0x08 || size === 0xffffffff) return true;
    p = start + size;
  }
  return false;
}

/**
 * The Theme entries of a .protheme as `{ name, sha, entries }`: its name (the folder it sits in) and
 * everything under that folder. Reads nothing but the bytes it is given.
 * @param {Buffer} buf
 * @param {typeof import("propresenter-bundle")} lib
 */
export function themesIn(buf, lib) {
  if (!lib.isZip(buf)) throw new Error("That is not a theme: a .protheme is a zip, and this file is not one.");
  const all = lib.readBundle(buf, { maxEntryBytes: MAX_ENTRY_BYTES }).filter((e) => !e.name.endsWith("/"));
  return all
    .filter((e) => THEME_ENTRY.test(e.name))
    .map((theme) => {
      const folder = theme.name.includes("/") ? theme.name.slice(0, theme.name.lastIndexOf("/")) : "";
      const entries = folder ? all.filter((e) => e.name === theme.name || e.name.startsWith(`${folder}/`)) : all;
      return { name: folder.split("/").pop() || "Untitled theme", sha: sha256(theme.data), entries };
    });
}

/**
 * An export split into one .protheme per theme.
 * @returns {Promise<{ name: string, sha: string, bytes: Buffer }[]>}
 */
export async function splitThemes(buf, lib) {
  const found = themesIn(buf, lib);
  if (!found.length) throw new Error("That file holds no theme, so it is not a ProPresenter theme export.");
  return Promise.all(found.map(async (t) => ({ name: t.name, sha: t.sha, bytes: await lib.writeBundle(t.entries) })));
}

const idOf = (sha) => sha.slice(0, 16);

/** The library in one folder. Changes are made one at a time, so two uploads can't write over each other. */
export function createThemeLibrary({ dir }) {
  const indexFile = path.join(dir, "index.json");
  let queue = Promise.resolve();
  const exclusive = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function load() {
    try {
      const list = JSON.parse(await readFile(indexFile, "utf8"));
      return Array.isArray(list) ? list.filter((t) => t && typeof t.id === "string" && typeof t.sha === "string") : [];
    } catch {
      return [];
    }
  }
  async function save(list) {
    await mkdir(dir, { recursive: true });
    const tmp = `${indexFile}.tmp`;
    await writeFile(tmp, JSON.stringify(list, null, 2));
    await rename(tmp, indexFile);
  }
  const fileOf = (id) => path.join(dir, `${id}.protheme`);

  return {
    fileOf,
    list: load,

    /** Adds the themes of an export; ones already here are left as they are, tick and all. */
    add: (buf, lib, now = () => new Date().toISOString()) =>
      exclusive(async () => {
        const incoming = await splitThemes(buf, lib);
        const list = await load();
        const added = [];
        const kept = [];
        await mkdir(dir, { recursive: true });
        for (const t of incoming) {
          const id = idOf(t.sha);
          if (list.some((x) => x.id === id)) {
            kept.push(t.name);
            continue;
          }
          const tmp = `${fileOf(id)}.tmp`;
          await writeFile(tmp, t.bytes);
          await rename(tmp, fileOf(id));
          list.push({ id, name: t.name, sha: t.sha, allowed: false, added: now() });
          added.push(t.name);
        }
        await save(list);
        return { added, kept, total: list.length };
      }),

    setAllowed: (id, allowed) =>
      exclusive(async () => {
        const list = await load();
        const t = list.find((x) => x.id === id);
        if (!t) return null;
        t.allowed = allowed === true;
        await save(list);
        return t;
      }),

    remove: (id) =>
      exclusive(async () => {
        const list = await load();
        const t = list.find((x) => x.id === id);
        if (!t) return false;
        await save(list.filter((x) => x !== t));
        await rm(fileOf(id), { force: true });
        return true;
      }),

    /** The entry for a theme's data hash, or null. */
    async byHash(sha) {
      return (await load()).find((t) => t.sha === sha) ?? null;
    },
  };
}

/**
 * Whether an assistant may open these bytes, if they are a theme: `{ theme: false }` for anything else,
 * else `{ theme: true, allowed, name }`, or `{ theme: true, many: n }` for an export of several (which has
 * to be uploaded in Refrain, where each can be looked at and ticked).
 * @param {Buffer} bytes
 * @param {{ dir: string, lib: typeof import("propresenter-bundle") }} deps
 */
export async function themeAccess(bytes, { dir, lib }) {
  if (!lib.isZip(bytes)) return { theme: false };
  const found = themesIn(bytes, lib);
  if (!found.length) return { theme: false };
  if (found.length > 1) return { theme: true, many: found.length };
  const entry = await createThemeLibrary({ dir }).byHash(found[0].sha);
  return { theme: true, allowed: entry?.allowed === true, name: entry?.name ?? found[0].name };
}
