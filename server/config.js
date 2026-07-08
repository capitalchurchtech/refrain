/**
 * Loads config.json (non-secret preferences) and .env (secrets),
 * per docs/refrain-architecture.md Section 4.
 *
 * On every call, also validates whether the arrangement module's
 * required credentials are present for the selected provider/backend
 * (Section 4.1) — missing credentials should never throw here; they
 * should resolve to a "misconfigured" status the health screen can
 * display, while the rest of the app keeps working.
 */
import { readFileSync, existsSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import "dotenv/config"; // TODO: add `dotenv` as a real dependency

const CONFIG_PATH = "./config.json";
const CONFIG_EXAMPLE_PATH = "./config.example.json";

export function loadConfig() {
  const path = existsSync(CONFIG_PATH) ? CONFIG_PATH : CONFIG_EXAMPLE_PATH;
  const config = JSON.parse(readFileSync(path, "utf-8"));
  return config;
}

/** Whether a real (non-example) config.json exists on disk yet. */
export function configFileExists() {
  return existsSync(CONFIG_PATH);
}

/**
 * Whether config.json exists and has the fields the app actually needs
 * to run (Section 6) — used to decide whether to show first-run setup.
 */
export function isConfigComplete(config) {
  return Boolean(
    configFileExists() &&
      config?.propresenter?.host &&
      config?.propresenter?.port &&
      (config?.role === "reader" || config?.role === "logger")
  );
}

/** Atomically writes config.json (Section 5.2's write-safety pattern). */
export async function saveConfig(config) {
  const tmpPath = `${CONFIG_PATH}.tmp`;
  await writeFile(tmpPath, JSON.stringify(config, null, 2));
  await rename(tmpPath, CONFIG_PATH);
}

/**
 * @returns {"off" | "misconfigured" | "active"}
 */
export function getArrangementModuleStatus(config) {
  if (!config.arrangementModule?.enabled) return "off";

  const backend = config.arrangementModule.storageBackend;
  if (backend === "firestore") {
    if (!process.env.FIRESTORE_PROJECT_ID) return "misconfigured";
    if (config.role === "logger" && !process.env.FIRESTORE_SERVICE_ACCOUNT_KEY_PATH) {
      return "misconfigured";
    }
  }
  if (backend === "sftp") {
    if (!process.env.SFTP_HOST || !process.env.SFTP_USERNAME || !process.env.SFTP_PRIVATE_KEY_PATH) {
      return "misconfigured";
    }
  }

  // A missing provider credential falls back to "manual" rather than
  // taking down the whole module (Section 4.1) — only actually block
  // activation if the config explicitly asks for planning-center
  // without the credentials it needs, on the machine that would use them.
  if (config.arrangementModule.provider === "planning-center" && config.role === "logger") {
    if (!process.env.PLANNING_CENTER_APP_ID || !process.env.PLANNING_CENTER_SECRET) {
      return "misconfigured";
    }
  }

  return "active";
}

/**
 * Each logger instance gets its own persistent machine ID (Section 8.5)
 * — used only for multi-logger collision detection, never shown to the
 * user. Generated once, on first use in logger role, and persisted to
 * config.json. Reader machines don't need one.
 */
export async function ensureMachineId(config) {
  if (config.role !== "logger" || config.machineId) return config;
  const updated = { ...config, machineId: randomUUID() };
  await saveConfig(updated);
  return updated;
}
