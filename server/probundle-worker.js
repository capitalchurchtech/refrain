/**
 * Reads and checks one ProPresenter file off Refrain's main thread (see
 * server/probundle.js). A big bundle is a lot of bytes to unzip and decode,
 * and the main thread runs the heartbeat, Go Live and the phones: none of
 * those should wait on it. Answers once and exits.
 */
import { parentPort, workerData } from "node:worker_threads";

try {
  const lib = await import("propresenter-bundle");
  const buf = Buffer.from(workerData.bytes);
  const { findings, model, predicted, file } = lib.checkFile(buf, { maxEntryBytes: workerData.maxEntryBytes });
  parentPort.postMessage({ ok: true, findings, model, predicted, file });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err?.message ?? String(err) });
}
