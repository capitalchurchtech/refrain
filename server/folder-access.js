/**
 * Whether the account running Refrain can use Refrain's own folder: save its
 * settings and data, and read its secrets.
 *
 * Each account runs its own copy (docs/install.md, "Several accounts on one
 * Mac"). A copy another account installed belongs to that account: macOS lets
 * this one only read it, and not even that for `.env`. Refrain still starts,
 * but it can't save, can't write its logs and has no service feed key, and
 * nothing said so: a second account's Tuesday and Wednesday logs never arrived
 * (owner, 2026-11-04). This finds it, for Settings › Status. Reads nothing but
 * permissions. Sharing the folder instead was rejected: it would let any
 * account change the code another account runs.
 */
import { access, constants } from "node:fs/promises";
import path from "node:path";

/**
 * @param {string} dir  Refrain's folder
 * @param {{ access?: typeof access }} [deps]
 * @returns {Promise<{ dir: string, problems: string[] }>} one sentence per thing this account can't do; empty when all is well
 */
export async function folderAccess(dir, { access: check = access } = {}) {
  // true, false, or null when the file isn't there yet (then its folder decides).
  const can = (rel, mode) => check(path.join(dir, rel), mode).then(() => true, (err) => (err?.code === "ENOENT" ? null : false));
  const problems = [];
  // Settings are written beside config.json and renamed into place, so the folder itself must be writable.
  if (!(await can(".", constants.W_OK)) || (await can("config.json", constants.W_OK)) === false) problems.push("It can't save settings.");
  if ((await can("data", constants.W_OK)) === false) problems.push("It can't save its data, so logs, flags and service days are lost.");
  if ((await can(".env", constants.R_OK)) === false) problems.push("It can't read its secrets (.env), so the service feed key and mail login are missing.");
  return { dir, problems };
}
