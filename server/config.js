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
 * @returns {"off" | "misconfigured" | "active"}
 * No .env credentials needed at all (no external service involved) —
 * "misconfigured" only happens if the folders/presets are missing,
 * which shouldn't occur once the module's own setup screen provides
 * defaults on first enable.
 */
export function getImageCropModuleStatus(config) {
  const mod = config.imageCropModule;
  if (!mod?.enabled) return "off";
  if (!mod.inputFolder || !mod.outputFolder || !mod.presets?.length) return "misconfigured";
  return "active";
}

/**
 * Which .env values matter for the *current* config, and whether each
 * is actually set — drives the Health screen's "Environment Variables"
 * card so editing .env is only ever presented when it would do
 * something. Mirrors getArrangementModuleStatus's own checks exactly;
 * update both together if the requirements ever change.
 */
export function getEnvRequirements(config) {
  const reqs = [];
  const arrangement = config.arrangementModule ?? {};
  if (!arrangement.enabled) return reqs;

  if (arrangement.storageBackend === "firestore") {
    reqs.push({
      name: "FIRESTORE_PROJECT_ID",
      set: Boolean(process.env.FIRESTORE_PROJECT_ID),
      note: "Firestore storage backend — required on every machine.",
    });
    if (config.role === "logger") {
      reqs.push({
        name: "FIRESTORE_SERVICE_ACCOUNT_KEY_PATH",
        set: Boolean(process.env.FIRESTORE_SERVICE_ACCOUNT_KEY_PATH),
        note: "Firestore storage backend — required on the logger machine only (it writes; readers only read).",
      });
    }
  }

  if (arrangement.storageBackend === "sftp") {
    reqs.push(
      { name: "SFTP_HOST", set: Boolean(process.env.SFTP_HOST), note: "SFTP storage backend." },
      { name: "SFTP_USERNAME", set: Boolean(process.env.SFTP_USERNAME), note: "SFTP storage backend." },
      { name: "SFTP_PRIVATE_KEY_PATH", set: Boolean(process.env.SFTP_PRIVATE_KEY_PATH), note: "SFTP storage backend." }
    );
  }

  if (arrangement.provider === "planning-center" && config.role === "logger") {
    reqs.push(
      {
        name: "PLANNING_CENTER_APP_ID",
        set: Boolean(process.env.PLANNING_CENTER_APP_ID),
        note: "Planning Center provider — required on the logger machine only.",
      },
      {
        name: "PLANNING_CENTER_SECRET",
        set: Boolean(process.env.PLANNING_CENTER_SECRET),
        note: "Planning Center provider — required on the logger machine only.",
      }
    );
  }

  return reqs;
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
