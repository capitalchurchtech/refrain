import { StorageBackend } from "./base.js";
import { readFile, writeFile, readdir, mkdir, rename } from "node:fs/promises";
import path from "node:path";

/**
 * Default backend for single-machine churches: reads/writes plain
 * JSON files in a local folder. No credentials, no setup.
 *
 * Also the underlying logic reused by storage/synced-folder.js —
 * pointing this same code at a Google Drive / Dropbox / OneDrive
 * synced path is how "shared storage" works with zero API/OAuth.
 */
export class LocalFolderStorage extends StorageBackend {
  static backendId = "local-folder";

  constructor({ dirPath = "./data/arrangements" } = {}) {
    super();
    this.dirPath = dirPath;
  }

  async #ensureDir() {
    await mkdir(this.dirPath, { recursive: true });
  }

  #filePath(songId) {
    return path.join(this.dirPath, `${songId}.json`);
  }

  async readSongFile(songId) {
    try {
      const raw = await readFile(this.#filePath(songId), "utf-8");
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  async writeSongFile(songId, data) {
    await this.#ensureDir();
    // Write-safety pattern from Section 5.2, applied here too — never
    // leave a corrupted half-written song file if the process dies
    // mid-write.
    const finalPath = this.#filePath(songId);
    const tmpPath = `${finalPath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2));
    await rename(tmpPath, finalPath);
  }

  async listSongFiles() {
    await this.#ensureDir();
    const entries = await readdir(this.dirPath);
    return entries.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  }
}

export default LocalFolderStorage;
