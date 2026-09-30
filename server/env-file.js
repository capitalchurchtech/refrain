/**
 * Reading and editing .env from Settings (owner, 2026-09-30: "Can it load the
 * .env in an editable way?").
 *
 * .env holds the church's passwords and API keys, so the rules are strict:
 *
 * - **Nothing is lost.** Comments, blank lines and the order of the file are
 *   kept; only the values that changed are rewritten, and a key nobody edited
 *   is left byte for byte. The previous file is kept as `.env.previous`.
 * - **Written safely.** Temp file then rename, owner-only (0600), so a crash
 *   mid-save leaves the old file, and nobody else on the Mac can read it.
 * - **Only names that look like settings.** A key has to be UPPER_SNAKE_CASE;
 *   a value can't contain a line break (it would split into two settings).
 * - **Read at startup.** Refrain reads .env once, so a saved change needs a
 *   restart to take effect, and Settings says so rather than pretending.
 *
 * Only the main app on this machine serves these routes; the phone listener
 * never does (see server/remote.js).
 */
import { readFile, writeFile, rename, copyFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";

const KEY = /^[A-Z][A-Z0-9_]*$/;
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/** A value as dotenv reads it: quotes removed, an unquoted trailing comment dropped. */
export function unquote(raw) {
  const v = String(raw ?? "").trim();
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) return v.slice(1, -1);
  const hash = v.search(/\s#/);
  return (hash >= 0 ? v.slice(0, hash) : v).trim();
}

/**
 * A value written so dotenv reads it back exactly. Plain when it can be;
 * single-quoted (taken literally) when it has spaces, a # or a double quote;
 * double-quoted when it has a single quote but no double quote. A value with
 * both kinds of quote can't be written reliably, so it's refused.
 */
export function quoteValue(value) {
  const v = String(value ?? "");
  if (/[\r\n]/.test(v)) throw new Error("A value can't contain a line break.");
  if (!/[\s#"'\\=]/.test(v)) return v;
  if (!v.includes("'")) return `'${v}'`;
  if (!v.includes('"') && !v.includes("\\")) return `"${v}"`;
  throw new Error("A value can't contain both kinds of quote mark.");
}

/** The settings a .env should have (from .env.example) and what it has now, in order. */
export function envEntries(envText, exampleText) {
  const values = new Map();
  for (const line of String(envText ?? "").split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m && !line.trim().startsWith("#")) values.set(m[1], unquote(m[2]));
  }
  const names = [];
  for (const line of String(exampleText ?? "").split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m && !line.trim().startsWith("#") && !names.includes(m[1])) names.push(m[1]);
  }
  for (const k of values.keys()) if (!names.includes(k)) names.push(k);
  return names.map((name) => ({ name, value: values.get(name) ?? "", set: Boolean(values.get(name)), inExample: String(exampleText ?? "").includes(`${name}=`) }));
}

/**
 * The .env text with `edits` ({ NAME: value }) applied. Existing lines are
 * rewritten in place, everything else is kept as it was, and a setting that
 * isn't in the file yet is added at the end.
 */
export function applyEnvEdits(envText, edits) {
  for (const k of Object.keys(edits ?? {})) if (!KEY.test(k)) throw new Error(`"${k}" isn't a setting name (use CAPITALS_AND_UNDERSCORES).`);
  const pending = new Map(Object.entries(edits ?? {}).map(([k, v]) => [k, quoteValue(v)]));
  const lines = String(envText ?? "").split(/\r?\n/);
  const out = lines.map((line) => {
    const m = LINE.exec(line);
    if (!m || line.trim().startsWith("#") || !pending.has(m[1])) return line;
    const v = pending.get(m[1]);
    pending.delete(m[1]);
    return `${m[1]}=${v}`;
  });
  if (pending.size) {
    while (out.length && out.at(-1) === "") out.pop();
    for (const [k, v] of pending) out.push(`${k}=${v}`);
    out.push("");
  }
  return out.join("\n");
}

/** Saves .env: previous file kept as .env.previous, then temp-and-rename, owner-only. */
export async function saveEnvFile(path, text) {
  if (existsSync(path)) {
    await copyFile(path, `${path}.previous`);
    await chmod(`${path}.previous`, 0o600).catch(() => {});
  }
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, path);
  await chmod(path, 0o600).catch(() => {});
}

export async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}
