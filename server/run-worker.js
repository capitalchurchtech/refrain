/**
 * One job in a worker thread, with a time limit: the worker answers once with
 * { ok, ...result } or { ok: false, error } and is stopped. For file work that
 * would otherwise hold Refrain's main thread, which runs the heartbeat, Go
 * Live and the phones (Bundles' reads, slide drawings, the Go Live check).
 */
import { Worker } from "node:worker_threads";

/**
 * @param {URL} url  the worker module
 * @param {{ workerData?: any, transferList?: any[], ms: number, tooLong: string, maxOldGenerationSizeMb?: number }} o
 * @returns {Promise<object>} the worker's answer
 */
export function runWorker(url, { workerData, transferList, ms, tooLong, maxOldGenerationSizeMb = 1024 }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, { workerData, transferList, resourceLimits: { maxOldGenerationSizeMb } });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(tooLong));
    }, ms);
    worker.once("message", (m) => {
      clearTimeout(timer);
      worker.terminate();
      if (m.ok) resolve(m);
      else reject(new Error(m.error));
    });
    worker.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
