/**
 * Save the day summary into a folder: for printing, or a shared drive the
 * team already reads. Nothing leaves the machine unless that folder syncs.
 * Setting: `reportModule.folder`.
 */
import { DeliveryBackend } from "./base.js";
import { saveTextRecord } from "../server/append-store.js";

export default class FolderDelivery extends DeliveryBackend {
  static backendId = "folder";
  static displayName = "Folder";

  static problems(moduleConfig) {
    return typeof moduleConfig?.folder === "string" && moduleConfig.folder.trim() ? [] : ["reportModule.folder isn't set."];
  }

  async deliver({ day, markdown, moduleConfig }) {
    const stamp = new Date().toTimeString().slice(0, 5).replace(":", "");
    const name = `${day} Refrain summary ${stamp}.md`;
    const r = await saveTextRecord("", name, markdown, { folder: moduleConfig.folder.trim(), pendingDir: "./data/report-pending" });
    return { ok: true, detail: r.shared ? `Saved as ${name}.` : `Saved here; copying to the folder is waiting (${r.reason}).` };
  }
}
