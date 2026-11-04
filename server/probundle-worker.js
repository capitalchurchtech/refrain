/**
 * Reads, checks and draws one ProPresenter file off Refrain's main thread (see
 * server/probundle.js). A big bundle is a lot of bytes to unzip and decode,
 * and the main thread runs the heartbeat, Go Live and the phones: none of
 * those should wait on it. Answers once and exits.
 *
 * Drawing: every slide as HTML (the package's drawPresentation). A picture is
 * named in the HTML by its number in `pictures`, under __SRC__ (the opened
 * file's id, which only the main thread knows); the main thread serves it. A
 * bundle's own media are copied into the picture cache under their content
 * hash, so the bundle's bytes need not be kept.
 */
import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { drawWithPictures } from "./slide-pictures.js";

const MEDIA = /\.(png|jpe?g|gif|tiff?|heic|bmp|webp|mp4|m4v|mov)$/i;

try {
  const lib = await import("propresenter-bundle");
  const buf = Buffer.from(workerData.bytes);
  const { findings, model, predicted, file } = lib.checkFile(buf, { maxEntryBytes: workerData.maxEntryBytes });
  let drawn = null;
  let pictures = [];
  if (model && workerData.cacheDir && lib.drawPresentation) ({ drawn, pictures } = draw(lib, buf));
  parentPort.postMessage({ ok: true, findings, model, predicted, file, drawn, pictures });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err?.message ?? String(err) });
}

function draw(lib, buf) {
  const opened = lib.openFile(buf, { maxEntryBytes: workerData.maxEntryBytes });
  const { doc } = lib.decodePresentation(opened.pro);
  // A bundle's media, by file name, as files in the cache (written once: the name is the content's hash).
  const cached = new Map();
  if (opened.kind === "probundle") {
    mkdirSync(workerData.cacheDir, { recursive: true });
    for (const e of lib.readBundle(buf, { maxEntryBytes: workerData.maxEntryBytes })) {
      if (!MEDIA.test(e.name)) continue;
      const name = `${createHash("sha256").update(e.data).digest("hex")}${path.extname(e.name).toLowerCase()}`;
      const to = path.join(workerData.cacheDir, name);
      if (!existsSync(to)) {
        const tmp = `${to}.${process.pid}.tmp`;
        writeFileSync(tmp, e.data);
        renameSync(tmp, to);
      }
      cached.set(e.name.split("/").pop(), name);
    }
  }
  const notes = new Map((doc.cues ?? []).map((c) => [c.uuid?.string, lib.notesOf((c.actions ?? []).find((a) => a.slide))]));
  const { drawn, pictures } = drawWithPictures(lib, doc, { cached, cacheDir: workerData.cacheDir, workspace: workerData.workspace, url: (n) => `/api/probundle/picture/__SRC__/${n}` });
  return { drawn: drawn.map((s) => ({ ...s, notes: notes.get(s.id) ?? "" })), pictures };
}
