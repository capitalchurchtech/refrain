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
import "dotenv/config"; // TODO: add `dotenv` as a real dependency

const CONFIG_PATH = "./config.json";
const CONFIG_EXAMPLE_PATH = "./config.example.json";

export function loadConfig() {
  const path = existsSync(CONFIG_PATH) ? CONFIG_PATH : CONFIG_EXAMPLE_PATH;
  const config = JSON.parse(readFileSync(path, "utf-8"));
  return config;
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

  // TODO: also validate provider credentials (e.g. Planning Center)
  // when role === "logger" and provider !== "manual" — a missing
  // provider credential can fall back to "manual" rather than taking
  // down the whole module, per Section 4.1.

  return "active";
}
