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
import { mkdir, readFile, writeFile, rename, rm, readdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const safe = (id) => encodeURIComponent(String(id)).replace(/%/g, "_");

/**
 * What a slide is, for keeping its picture across edits (owner, 2026-10-04:
 * Sunday-morning edits change words and arrangements). Its group, its
 * position in the group, and its words: a slide that keeps all three looks
 * the same, wherever an arrangement change has moved it. Pure.
 */
export function slideKey({ groupId = null, groupOffset = null, text = "" } = {}) {
  const words = String(text ?? "").replace(/\s+/g, " ").trim();
  return `${groupId ?? ""}:${groupOffset ?? ""}:${createHash("sha1").update(words).digest("hex").slice(0, 12)}`;
}

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

    /** `key` (slideKey), when known, lets a later version keep this picture. */
    put(pid, idx, fingerprint, img, now = Date.now(), key = null) {
      if (!fingerprint || !img?.bytes) return Promise.resolve();
      return serial(pid, async () => {
        let m = await meta(pid);
        if (!current(m, fingerprint, now)) {
          // A new version of the presentation, or a set old enough that the
          // theme may have changed: the old pictures go, and this starts anew.
          await rm(folder(pid), { recursive: true, force: true });
          m = { fingerprint, renderedAt: now, type: img.type, slides: {}, keys: {} };
        }
        await mkdir(folder(pid), { recursive: true });
        await writeAtomic(path.join(folder(pid), `${idx}.jpg`), img.bytes);
        m.slides[idx] = true;
        if (key) (m.keys ??= {})[idx] = key;
        m.type = img.type ?? m.type;
        metas.set(pid, m);
        await writeAtomic(path.join(folder(pid), "meta.json"), JSON.stringify(m));
      });
    },

    /**
     * Moves to a new version of a presentation, keeping every picture whose
     * slide is unchanged (same slideKey), wherever it now sits. `keys[i]` is
     * the slideKey of slide i in the new version. Returns how many were kept;
     * the rest are left to be drawn. Nothing is kept from a set too old to
     * trust (a theme may have changed), or one stored without keys.
     */
    carryOver(pid, fingerprint, keys, now = Date.now()) {
      return serial(pid, async () => {
        const m = await meta(pid);
        const save = async (out) => {
          await mkdir(folder(pid), { recursive: true });
          await writeAtomic(path.join(folder(pid), "meta.json"), JSON.stringify(out));
          metas.set(pid, out);
        };
        if (current(m, fingerprint, now)) {
          // This version already. A picture drawn without a key (when someone
          // looked at it) takes the key of the slide now at its place; a known
          // key that differs means the order changed (an arrangement switched
          // without the file changing), so it falls through to matching.
          const known = m.keys ?? {};
          if (keys.every((k, i) => known[i] === undefined || known[i] === k)) {
            const adopted = { ...known };
            for (let i = 0; i < keys.length; i++) if (m.slides?.[i]) adopted[i] = keys[i];
            await save({ ...m, keys: adopted, count: keys.length });
            return keys.filter((_, i) => m.slides?.[i]).length;
          }
        }
        if (!m || !m.keys || now - m.renderedAt > maxAgeMs) {
          await rm(folder(pid), { recursive: true, force: true });
          await save({ fingerprint, renderedAt: now, type: m?.type ?? "image/jpeg", slides: {}, keys: {}, count: keys.length });
          return 0;
        }
        const byKey = new Map();
        for (const [i, k] of Object.entries(m.keys)) if (m.slides?.[i] && !byKey.has(k)) byKey.set(k, i);
        const next = `${folder(pid)}.next`;
        await rm(next, { recursive: true, force: true });
        await mkdir(next, { recursive: true });
        const out = { fingerprint, renderedAt: m.renderedAt, type: m.type, slides: {}, keys: {}, count: keys.length };
        for (let i = 0; i < keys.length; i++) {
          const from = byKey.get(keys[i]);
          if (from == null) continue;
          try {
            await copyFile(path.join(folder(pid), `${from}.jpg`), path.join(next, `${i}.jpg`));
            out.slides[i] = true;
            out.keys[i] = keys[i];
          } catch {
            /* that one is drawn again */
          }
        }
        await writeFile(path.join(next, "meta.json"), JSON.stringify(out));
        // A cache, not a record: if this is interrupted between the two
        // steps, the cost is drawing the pictures again.
        await rm(folder(pid), { recursive: true, force: true });
        await rename(next, folder(pid));
        metas.set(pid, out);
        return Object.keys(out.slides).length;
      });
    },

    /** The stored set's version and slide count, or null. */
    async info(pid) {
      const m = await meta(pid);
      return m ? { fingerprint: m.fingerprint, renderedAt: m.renderedAt, count: m.count ?? null } : null;
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
