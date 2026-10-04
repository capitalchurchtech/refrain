/**
 * Auto-discovers providers/, storage/, slide-splitters/, delivery/ and modules/
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

export async function discoverDeliveryBackends() {
  return discoverIn("./delivery");
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

/** A module's menu placement, with safe defaults: an unknown group is "prep". */
export function moduleNav(nav) {
  const group = nav?.group === "service" ? "service" : "prep";
  const order = Number.isFinite(nav?.order) ? nav.order : 99;
  // The tabbed page it's a tab of, if any: "service" (Now, Flags, Day) or
  // "prep". A prep-group module is on Prep unless it says otherwise.
  const page = ["service", "prep"].includes(nav?.page) ? nav.page : group === "prep" ? "prep" : null;
  return { group, order, page };
}
/**
 * A module's screen script: a plain file in public/ and the name of the
 * function that builds it. Anything else (a path, another origin) is dropped,
 * so a module's metadata can't make the page load a script from elsewhere.
 */
export function moduleClient(client) {
  const file = String(client?.file ?? "");
  const init = String(client?.init ?? "");
  return /^[a-z0-9-]+\.js$/.test(file) && /^[A-Za-z_$][\w$]*$/.test(init) ? { file, init } : null;
}


/**
 * Which Settings tab holds a module's on/off switch, for "X is off. Turn it on
 * in Settings." Most are on Features; one that says otherwise names its tab.
 */
export function moduleSettingsTab(tab) {
  return ["status", "search", "audit", "features", "phones", "customize"].includes(tab) ? tab : "features";
}
