/**
 * Auto-discovers providers/, storage/, slide-splitters/, and modules/
 * at startup, per docs/refrain-architecture.md Section 17.11.
 *
 * Deliberately no central registry file — a contributor adds one file
 * in the right folder and it just shows up, avoiding merge conflicts
 * on a shared "list of plugins" file as the project grows.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Dynamic import of an absolute path, as a file:// URL.
 *
 * A bare absolute path works on macOS but throws on Windows, where Node's
 * ESM loader reads the drive letter as a URL scheme ("Received protocol
 * 'c:'"). That made every discovery call here return nothing on Windows:
 * no providers, no storage backends, no splitters, and no module nav
 * entries at all, with /api/config-options failing and taking the Health
 * screen's whole Configuration card down with it.
 */
function importAbsolute(absPath) {
  return import(pathToFileURL(absPath).href);
}

async function discoverIn(dirPath) {
  const files = await readdir(dirPath).catch(() => []);
  const modules = [];
  for (const file of files) {
    if (file === "base.js" || !file.endsWith(".js")) continue;
    const mod = await importAbsolute(path.resolve(dirPath, file));
    modules.push(mod.default ?? mod);
  }
  return modules;
}

export async function discoverProviders() {
  return discoverIn("./providers");
}

export async function discoverStorageBackends() {
  return discoverIn("./storage");
}

export async function discoverSlideSplitters() {
  return discoverIn("./slide-splitters");
}

export async function discoverModules() {
  const dirs = await readdir("./modules", { withFileTypes: true }).catch(() => []);
  const modules = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const modPath = path.resolve("./modules", dir.name, "module.js");
    try {
      const mod = await importAbsolute(modPath);
      modules.push(mod.default ?? mod);
    } catch {
      // A module folder without a valid module.js shouldn't take down
      // the rest of discovery.
    }
  }
  return modules;
}
