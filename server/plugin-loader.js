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
  const dirs = await readdir("./modules", { withFileTypes: true }).catch(() => []);
  const modules = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const modPath = path.resolve("./modules", dir.name, "module.js");
    try {
      const mod = await import(modPath);
      modules.push(mod.default ?? mod);
    } catch {
      // A module folder without a valid module.js shouldn't take down
      // the rest of discovery.
    }
  }
  return modules;
}
