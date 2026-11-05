/**
 * Slide pictures for phones, made on this Mac (owner, 2026-11-05).
 *
 * Phones get slide words, because a ProPresenter thumbnail writes into its
 * workspace database. These pictures cost ProPresenter nothing: Refrain's own
 * drawing of a slide (server/slide-drawing.js) is photographed in WebKit by
 * mac/helpers/refrain-snapshot.swift, with this Mac's fonts, and kept on disk.
 *
 * The owner's rules: off until switched on (Settings › More › Phones; a slide
 * can carry a name); made ahead of time only, never while something is live
 * or in performance mode, for today's service playlists and flagged slides;
 * shown on the phone's flag picker, flag cards and Now. Without a picture
 * (not made yet, the file changed, not a Mac, the helper not built) a phone
 * shows the slide's words, as before.
 *
 * Kept by cue id, one folder per presentation with the file version it was
 * made from: a slide is the same cue whichever arrangement plays it, so a
 * phone's slide number (in the arrangement playing) finds its picture through
 * the group and place (server/playing-slide.js placeInOutline). A new file
 * version empties the folder. A cache, not a record.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { INSTALLED_MAC_APP } from "./mac-app.js";

/** Where scripts/build-mac-app.command puts the snapshot tool (REFRAIN_SNAPSHOT_HELPER overrides it, for a test build). */
export const SNAPSHOT_HELPER = process.env.REFRAIN_SNAPSHOT_HELPER || path.join(INSTALLED_MAC_APP, "Contents", "Helpers", "refrain-snapshot");
const HELPER_MS = 10 * 60_000;

// A file or folder name from an id: nothing that separates paths, and never "." or "..".
const safe = (s) => {
  const name = encodeURIComponent(String(s)).replace(/%/g, "_");
  return name === "." || name === ".." ? `_${name}` : name;
};

/**
 * Off, misconfigured (with why) or active.
 * @returns {{ status: "off"|"misconfigured"|"active", problem?: string }}
 */
export function phonePicturesStatus(config, { platform = process.platform, helperExists = existsSync(SNAPSHOT_HELPER) } = {}) {
  if (config?.slidePictures?.phones !== true) return { status: "off" };
  if (platform !== "darwin") return { status: "misconfigured", problem: "Phone pictures are made with macOS's WebKit, so they need Refrain on a Mac." };
  if (!helperExists) return { status: "misconfigured", problem: "Build Refrain.app on this Mac (scripts/build-mac-app.command); its tools make the phone pictures." };
  return { status: "active" };
}

/** Runs the helper: one "url\toutfile" line per picture in, one JSON line per picture out. */
function runHelper(helper, jobs) {
  return new Promise((resolve) => {
    const child = spawn(helper, [], { stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => child.kill(), HELPER_MS);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => resolve([]));
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
    });
    child.stdin.end(jobs.map((j) => `${j.url}\t${j.out}`).join("\n") + "\n");
  });
}

/**
 * @param {{ dir: string, helper?: string, run?: (helper: string, jobs: {url: string, out: string}[]) => Promise<{out: string, ok: boolean}[]> }} o
 */
export function createPhonePictures({ dir, helper = SNAPSHOT_HELPER, run = runHelper }) {
  const manifests = new Map(); // pid -> { version, groups } | null
  const folder = (pid) => path.join(dir, safe(pid));
  const fileOf = (pid, cue) => path.join(folder(pid), `${safe(cue)}.jpg`);

  async function manifest(pid) {
    if (!manifests.has(pid)) {
      const m = await readFile(path.join(folder(pid), "manifest.json"), "utf8").then(JSON.parse).catch(() => null);
      manifests.set(pid, m);
    }
    return manifests.get(pid);
  }

  return {
    /**
     * The picture of a cue, if one was made from file version `version`; else
     * null. The cue is given by id, by `{ groupUuid, offset }` (its place in
     * the file, for a slide numbered in the arrangement playing), or by
     * `{ order }` (its number in the file's own selected arrangement, as a
     * flag's slide is drawn on Flags).
     */
    async picture(pid, version, which) {
      const m = await manifest(pid);
      if (!m || !version || m.version !== version) return null;
      const cue = typeof which === "string" ? which : Number.isInteger(which?.order) ? m.order?.[which.order] : m.groups?.[which?.groupUuid]?.[which?.offset];
      if (!cue || !m.made?.includes(cue)) return null;
      return { cue, file: fileOf(pid, cue) };
    },

    /** The cues of a presentation still to photograph at `version` (all of them for a new version). */
    async missing(pid, version, ids) {
      const m = await manifest(pid);
      const made = m?.version === version ? new Set(m.made ?? []) : new Set();
      return ids.filter((id) => !made.has(id));
    },

    /**
     * Photographs `cues` of `pid` at `version`; `urlFor(cue)` is the page that
     * shows one drawn slide. Starts the folder afresh for a new version.
     * @returns {Promise<{ made: number, failed: number }>}
     */
    async make(pid, version, groups, order, cues, urlFor) {
      if (!cues.length) return { made: 0, failed: 0 };
      let m = await manifest(pid);
      if (m?.version !== version) {
        await rm(folder(pid), { recursive: true, force: true });
        m = { version, made: [] };
      }
      m = { ...m, groups, order };
      await mkdir(folder(pid), { recursive: true });
      const results = await run(helper, cues.map((cue) => ({ url: urlFor(cue), out: fileOf(pid, cue) })));
      const ok = new Set(results.filter((r) => r.ok).map((r) => r.out));
      const made = cues.filter((cue) => ok.has(fileOf(pid, cue)));
      m.made = [...new Set([...(m.made ?? []), ...made])];
      const temp = path.join(folder(pid), `manifest.json.${process.pid}.tmp`);
      await writeFile(temp, JSON.stringify(m));
      await rename(temp, path.join(folder(pid), "manifest.json"));
      manifests.set(pid, m);
      return { made: made.length, failed: cues.length - made.length };
    },

    /** Keeps only the presentations in `keep`; the rest are deleted (a cache). */
    async prune(keep) {
      const names = await readdir(dir).catch(() => []);
      const wanted = new Set([...keep].map(safe));
      for (const name of names) {
        if (wanted.has(name)) continue;
        await rm(path.join(dir, name), { recursive: true, force: true });
      }
      for (const pid of [...manifests.keys()]) if (!keep.has(pid)) manifests.delete(pid);
    },
  };
}
