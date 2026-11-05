/**
 * Reads one presentation file in the API's shape (server/presentation-files.js)
 * off Refrain's main thread, for the Go Live check. Reads, never writes.
 */
import { parentPort, workerData } from "node:worker_threads";
import { loadFileReader, readPresentationFile } from "./presentation-files.js";

try {
  const lib = await loadFileReader();
  parentPort.postMessage({ ok: true, doc: lib ? await readPresentationFile(lib, workerData.file) : null });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err?.message ?? String(err) });
}
