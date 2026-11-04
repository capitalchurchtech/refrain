/**
 * Draws one ProPresenter library file off Refrain's main thread, for the
 * desktop previews (see server/slide-drawing.js). Reads the file, never writes
 * it. Answers once and exits.
 */
import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { drawWithPictures } from "./slide-pictures.js";
import { workspaceOfFile } from "./presentation-files.js";
import { playedCueIds } from "./slide-drawing.js";

try {
  const { file, pid, version } = workerData;
  const lib = await import("propresenter-bundle");
  const { doc } = lib.decodePresentation(await readFile(file));
  if (doc?.uuid?.string !== pid) throw new Error("That file holds a different presentation.");
  const workspace = workspaceOfFile(file);
  const at = `/api/preview/drawn/${encodeURIComponent(pid)}/picture/`;
  const { drawn, pictures } = drawWithPictures(lib, doc, { workspace, url: (n) => `${at}${n}?v=${encodeURIComponent(version)}` });
  parentPort.postMessage({
    ok: true,
    order: playedCueIds(doc),
    drawn: drawn.map((d) => ({ id: d.id, html: d.html, fonts: d.fonts, width: d.width, height: d.height })),
    pictures,
    workspace,
  });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err?.message ?? String(err) });
}
