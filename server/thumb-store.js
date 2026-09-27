/**
 * Slide pictures kept on disk, rendered ahead of a service (owner request,
 * 2026-09-27).
 *
 * During a service each picture a phone or the Live preview needs would
 * otherwise be a render on the live ProPresenter. Rendering the day's
 * playlists beforehand, while nothing is on the screens, moves that work out
 * of the service, and keeping the pictures on disk means a Refrain restart
 * mid-service doesn't send every request back to ProPresenter.
 *
 * **Fresh by fingerprint.** Each presentation's pictures are stored with the
 * index fingerprint of its .pro file (size and modified time). An edited
 * presentation has a new fingerprint, so its old pictures simply stop
 * matching and are rendered again. Theme edits change pictures without
 * touching the .pro, so a set older than `maxAgeMs` counts as stale too.
 *
 * A cache, not a record: losing it costs renders, never data. Writes are
 * still temp-then-rename so a crash can't leave half a picture behind.
 */
import { mkdir, readFile, writeFile, rename, rm, readdir } from "node:fs/promises";
import path from "node:path";

const safe = (id) => encodeURIComponent(String(id)).replace(/%/g, "_");

export function createThumbStore({ dir, maxPresentations = 200, maxAgeMs = 20 * 3_600_000 } = {}) {
  const metas = new Map(); // presentationId -> { fingerprint, renderedAt, slides: { [idx]: true } }
  // Writes for one presentation run one after another: two slides stored at
  // once would share meta.json's temp file, and a new version's clear-out
  // could delete a picture the other had just written.
  const queues = new Map();
  const serial = (pid, fn) => {
    const next = (queues.get(pid) ?? Promise.resolve()).then(fn, fn);
    queues.set(pid, next.catch(() => {}));
    return next;
  };
  const current = (m, fingerprint, now) => m && m.fingerprint === fingerprint && now - m.renderedAt <= maxAgeMs;
  const folder = (pid) => path.join(dir, safe(pid));

  async function meta(pid) {
    if (metas.has(pid)) return metas.get(pid);
    let m = null;
    try {
      m = JSON.parse(await readFile(path.join(folder(pid), "meta.json"), "utf8"));
    } catch {
      /* none yet */
    }
    metas.set(pid, m);
    return m;
  }

  async function writeAtomic(file, data) {
    const tmp = `${file}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, file);
  }

  return {
    /** The stored picture, or null if there isn't a current one. */
    async get(pid, idx, fingerprint, now = Date.now()) {
      if (!fingerprint) return null;
      const m = await meta(pid);
      // Too old counts as missing: a theme edit changes pictures without
      // changing the .pro, so no set is trusted for longer than maxAgeMs.
      if (!current(m, fingerprint, now) || !m.slides?.[idx]) return null;
      try {
        return { type: m.type ?? "image/jpeg", bytes: await readFile(path.join(folder(pid), `${idx}.jpg`)) };
      } catch {
        return null;
      }
    },

    put(pid, idx, fingerprint, img, now = Date.now()) {
      if (!fingerprint || !img?.bytes) return Promise.resolve();
      return serial(pid, async () => {
        let m = await meta(pid);
        if (!current(m, fingerprint, now)) {
          // A new version of the presentation, or a set old enough that the
          // theme may have changed: the old pictures go, and this starts anew.
          await rm(folder(pid), { recursive: true, force: true });
          m = { fingerprint, renderedAt: now, type: img.type, slides: {} };
        }
        await mkdir(folder(pid), { recursive: true });
        await writeAtomic(path.join(folder(pid), `${idx}.jpg`), img.bytes);
        m.slides[idx] = true;
        m.type = img.type ?? m.type;
        metas.set(pid, m);
        await writeAtomic(path.join(folder(pid), "meta.json"), JSON.stringify(m));
      });
    },

    /** Whether every slide 0..count-1 has a current picture. */
    async complete(pid, fingerprint, count, now = Date.now()) {
      const m = await meta(pid);
      if (!current(m, fingerprint, now)) return false;
      for (let i = 0; i < count; i++) if (!m.slides?.[i]) return false;
      return true;
    },

    /** Drops the oldest sets beyond `maxPresentations`. */
    prune() {
      return serial("\0prune", async () => {
      let names;
      try {
        names = await readdir(dir);
      } catch {
        return 0;
      }
      if (names.length <= maxPresentations) return 0;
      const aged = [];
      for (const name of names) {
        try {
          const m = JSON.parse(await readFile(path.join(dir, name, "meta.json"), "utf8"));
          aged.push({ name, at: m.renderedAt ?? 0 });
        } catch {
          aged.push({ name, at: 0 });
        }
      }
      aged.sort((a, b) => a.at - b.at);
      const drop = aged.slice(0, aged.length - maxPresentations);
      for (const { name } of drop) await rm(path.join(dir, name), { recursive: true, force: true });
      metas.clear();
      return drop.length;
      });
    },
  };
}
