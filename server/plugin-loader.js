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

async function discoverIn(dirPath) {
  const files = await readdir(dirPath).catch(() => []);
  const modules = [];
  for (const file of files) {
    if (file === "base.js" || !file.endsWith(".js")) continue;
    const mod = await import(path.resolve(dirPath, file));
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
  // modules/ is one level deeper (modules/<name>/module.js) —
  // TODO: adjust traversal accordingly once modules/ has real content.
  return [];
}
