/**
 * Second-device flags and a service progress feed (issues #8 and #7).
 *
 * A separate, narrow listener, off unless a church turns on `networkModule`.
 * It exists so the person at the back who spots the typo can flag it from a
 * phone, and so the green room can see where the service is, without the
 * operator being interrupted.
 *
 * **The boundary is the point.** This app is its own Express instance on its
 * own port. It can do exactly these things and nothing else:
 *   - serve the phone page and its script,
 *   - report what's live, the last few slides, and service progress,
 *   - add a flag (a type, a note, a name) for one of those slides.
 * There is no route to Go Live, Clear, Looks, Macros, messages, settings or
 * anything on the main app, and nothing here calls ProPresenter: it reads
 * the state Refrain's heartbeat already has. The main app stays bound to
 * 127.0.0.1 regardless.
 *
 * "Nobody knows the URL" is not access control, so when a PIN is set (daily
 * or fixed; see server/remote-auth.js) every API call needs a phone token
 * earned with it, and flags are rate-limited per device.
 */

import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildFlag } from "./slide-flags.js";
import { pinMatches, issueToken, tokenValid } from "./remote-auth.js";

export const RECENT_SLIDES = 12;

/**
 * The last few slides that were on the screens, newest first. A phone
 * submission is late by nature (see the thing, unlock, find the tab, tap),
 * so the page offers these instead of only "what's live now".
 */
export function pushRecent(list, slide, now = Date.now()) {
  if (!slide?.presentationId || !Number.isInteger(slide.slideIndex)) return list ?? [];
  const key = `${slide.presentationId}:${slide.slideIndex}`;
  const current = list ?? [];
  if (current[0]?.key === key) return current;
  const entry = {
    ref: `r${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    key,
    at: now,
    presentationId: slide.presentationId,
    presentationName: slide.presentationName ?? slide.name ?? null,
    arrangementName: slide.arrangementName ?? null,
    folder: slide.folder ?? null,
    slideIndex: slide.slideIndex,
    text: slide.text ?? null,
  };
  return [entry, ...current].slice(0, RECENT_SLIDES);
}

/** A flag for a slide from the recent list, marked with who sent it and when they saw it. */
export function flagFromRecent(entry, { type = null, note = "", name = "", now = Date.now() } = {}) {
  const built = buildFlag({ connected: true, live: true, slide: entry, checkedAt: now }, { type, now });
  if (!built.ok) return built;
  const cleanNote = String(note ?? "").trim().slice(0, 500);
  const cleanName = String(name ?? "").trim().slice(0, 40);
  return {
    ok: true,
    flag: {
      ...built.flag,
      ...(cleanNote ? { note: cleanNote } : {}),
      submittedBy: cleanName || null,
      source: "remote",
      slideSeenAt: new Date(entry.at).toISOString(),
    },
  };
}

/**
 * Where the service is, for the feed: item N of M and how long it's been up,
 * and how long the service has run. Item count, never a percentage: "70% of
 * slides" can mean five minutes left or twenty-five (issue #7).
 */
export function serviceProgress(state, liveState, now = Date.now()) {
  const open = state?.openItem ?? null;
  const service = open?.serviceId ? state.services.find((s) => s.serviceId === open.serviceId) : null;
  const firstStart = service ? Math.min(...state.segments.filter((g) => g.serviceId === service.serviceId).map((g) => g.startMs), open.startMs) : null;
  return {
    live: Boolean(liveState?.live && open),
    connected: Boolean(liveState?.connected),
    service: service ? { name: service.name, runningMs: now - firstStart } : null,
    item: open
      ? {
          name: (open.itemIndex != null ? service?.playlist?.items?.[open.itemIndex]?.name : null) ?? open.name ?? "Untitled",
          position: open.itemIndex != null ? open.itemIndex + 1 : null,
          of: service?.playlist?.items?.length ?? null,
          upForMs: now - open.startMs,
        }
      : null,
  };
}

/** A tiny fixed-window limiter, per device, so a stuck button can't fill the flags folder. */
export function rateLimiter({ max = 20, windowMs = 60_000 } = {}) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    h.count += 1;
    return h.count <= max;
  };
}

/**
 * @param {object} deps
 * @param {() => object} deps.getState     { liveState, recent, progress }
 * @param {(flag) => Promise<object>} deps.saveFlag
 * @param {() => Array<{label:string}>} deps.flagTypes
 * @param {{ expectedPin: () => string|null, secret: () => string, hint: () => string, daily: () => boolean }} deps.auth
 *   expectedPin is today's PIN (daily or fixed), or null for no PIN.
 * @param {string} [deps.publicDir]
 */
export function createRemoteApp({ getState, saveFlag, flagTypes, auth, publicDir = "./public" }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "8kb" }));
  const allow = rateLimiter();
  // Five PIN tries a minute per device: four digits read aloud across a room
  // is the point, and this is what makes guessing them impractical.
  const allowUnlock = rateLimiter({ max: 5, windowMs: 60_000 });
  const pinOn = () => Boolean(auth.expectedPin());

  // Open to anyone: the page, its script, and what the lock needs to say.
  const open = new Set(["/", "/remote.js", "/api/lock", "/api/unlock"]);
  app.use((req, res, next) => {
    if (!pinOn() || open.has(req.path)) return next();
    if (!tokenValid(auth.secret(), req.get("x-refrain-device"))) return res.status(401).json({ error: "This phone needs today's PIN.", locked: true });
    next();
  });

  app.get("/api/lock", (_req, res) => {
    res.json({ required: pinOn(), daily: auth.daily(), hint: auth.hint() });
  });

  /** A correct PIN earns this phone a signed token: until midnight, or 30 days if trusted. */
  app.post("/api/unlock", (req, res) => {
    if (!pinOn()) return res.json({ ok: true, token: null });
    if (!allowUnlock(req.ip)) return res.status(429).json({ error: "Too many tries. Wait a minute, then ask the booth for today's PIN." });
    const { pin, trust } = req.body ?? {};
    if (!pinMatches(pin, auth.expectedPin())) return res.status(403).json({ error: "That isn't today's PIN." });
    const { token, expires } = issueToken(auth.secret(), { trust: trust === true });
    res.json({ ok: true, token, expiresAt: new Date(expires).toISOString(), trusted: trust === true });
  });

  const page = path.resolve(publicDir, "remote.html");
  const script = path.resolve(publicDir, "remote.js");
  app.get("/", (_req, res) => res.type("html").send(readFileSync(page, "utf-8")));
  app.get("/remote.js", (_req, res) => res.type("application/javascript").send(readFileSync(script, "utf-8")));

  app.get("/api/state", (_req, res) => {
    const { liveState, recent, progress } = getState();
    res.json({
      connected: Boolean(liveState?.connected),
      live: Boolean(liveState?.live),
      pinRequired: pinOn(),
      types: flagTypes().map((t) => t.label),
      recent: (recent ?? []).map((r) => ({ ref: r.ref, at: new Date(r.at).toISOString(), presentationName: r.presentationName, slideNumber: r.slideIndex + 1, text: r.text })),
      progress,
    });
  });

  app.post("/api/flag", async (req, res) => {
    if (!allow(req.ip)) return res.status(429).json({ error: "That's a lot of flags at once. Wait a minute and try again." });
    const { ref, type, note, name } = req.body ?? {};
    const entry = (getState().recent ?? []).find((r) => r.ref === ref);
    if (!entry) return res.status(404).json({ error: "That slide has scrolled out of the recent list. Pick it again." });
    const types = flagTypes().map((t) => t.label);
    const chosenType = typeof type === "string" && types.includes(type) ? type : null;
    const built = flagFromRecent(entry, { type: chosenType, note, name });
    if (!built.ok) return res.status(409).json({ error: built.error });
    try {
      const saved = await saveFlag(built.flag);
      res.json({ ok: true, id: built.flag.id, shared: saved?.shared !== false });
    } catch (err) {
      res.status(500).json({ error: `Not saved: ${err.message}` });
    }
  });

  // Anything else doesn't exist here, by construction.
  app.use((_req, res) => res.status(404).json({ error: "Not available from another device." }));
  return app;
}
