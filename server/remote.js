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
 * anything on the main app. Two things reach ProPresenter, both narrow:
 * pictures of the current and next slide (cached), and, for a phone the
 * booth approved by name, next/previous slide and the church's own safe
 * slides, each needing a second, confirming press. The main app stays bound
 * to 127.0.0.1 regardless.
 *
 * "Nobody knows the URL" is not access control, so when a PIN is set (daily
 * or fixed; see server/remote-auth.js) every API call needs a phone token
 * earned with it, and flags are rate-limited per device.
 */

import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildFlag } from "./slide-flags.js";
import { pinMatches, issueToken, tokenDevice } from "./remote-auth.js";
import { createConfirmer, createCooldown } from "./remote-devices.js";
import { messageFieldValue } from "./stage-messages.js";

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

/**
 * Wrong PINs, counted across every phone for the day. Per-device limits
 * alone don't stop guessing (a device can try thousands of times a day, and
 * several devices more), so after `perDay` wrong tries in a day, unlocking
 * stops for everyone until the date changes, when a daily PIN also changes.
 * A church that gets locked out by this reads today's count on Health.
 * With the defaults, a guesser's chance of finding a four-digit PIN in a day
 * is about 30 in 10,000.
 */
export function pinFailureGuard({ perDay = 30, dayOf } = {}) {
  let day = null;
  let failures = 0;
  const roll = (now) => {
    const d = dayOf(now);
    if (d !== day) {
      day = d;
      failures = 0;
    }
  };
  return {
    blocked(now = Date.now()) {
      roll(now);
      return failures >= perDay;
    },
    fail(now = Date.now()) {
      roll(now);
      failures += 1;
    },
    count(now = Date.now()) {
      roll(now);
      return failures;
    },
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
 * @param {(presentationId: string, slideIndex: number) => object|null} [deps.knownSlide]
 * @param {() => void} [deps.noteActivity]  a phone is looking (keeps the heartbeat's active pace)
 *   the indexed slide, so a flag queued on a phone before a restart can still land
 * @param {{ blocked, fail, count }} [deps.pinGuard]  see pinFailureGuard
 * @param {object} [deps.devices]   { see(id, {name, signIn}), approved(id), removed(id), name(id) }
 * @param {(q: string) => Array} [deps.search]      read-only search, for the Search tab
 * @param {() => object} [deps.preview]              previewTargets for what's live
 * @param {(pid, idx) => Promise<{type, bytes}|null>} [deps.thumb]
 * @param {() => boolean} [deps.pictures] whether a phone may be sent slide pictures at all; closed unless the booth opens it (networkModule.phonePictures)
 * @param {() => Array} [deps.safeSlides]
 * @param {(action: object, deviceId: string) => Promise<{label: string}>} [deps.control]
 *   performs an approved, confirmed control action; throws with a sentence on failure
 * @param {string} [deps.publicDir]
 */
export function createRemoteApp({
  getState,
  saveFlag,
  flagTypes,
  auth,
  knownSlide = () => null,
  pinGuard = null,
  devices = { see() {}, approved: () => false, removed: () => false, name: () => null },
  thumb = async () => null,
  pictures = () => false,
  stage = async () => ({ presets: [], current: "" }),
  messages = async () => [],
  currentSlides = () => null,
  noteActivity = () => {},
  control = async () => {
    throw new Error("Control isn't available.");
  },
  publicDir = "./public",
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "8kb" }));
  const allow = rateLimiter();
  // Pictures per phone: a whole tray scrolled end to end is ~30-60, so this
  // only stops a runaway loop or a scripted flood, not a person.
  const allowImage = rateLimiter({ max: 240, windowMs: 60_000 });
  // Five PIN tries a minute per device, and a daily cap across every device
  // (pinGuard). Four digits is the point, since it's read aloud across a room;
  // the cap, not the device limit, is what keeps guessing it unlikely.
  const allowUnlock = rateLimiter({ max: 5, windowMs: 60_000 });
  const pinOn = () => Boolean(auth.expectedPin());

  // Open to anyone: the page, its script, and what the lock needs to say.
  const open = new Set(["/", "/remote.js", "/api/lock", "/api/unlock"]);
  app.use((req, res, next) => {
    // A phone polling counts as someone watching, so the heartbeat keeps
    // its active pace and what the phone shows (and confirms) is current,
    // not up to 30s old when no booth browser is open.
    if (req.path.startsWith("/api/") && !open.has(req.path)) noteActivity();
    if (!pinOn() || open.has(req.path)) return next();
    const id = tokenDevice(auth.secret(), req.get("x-refrain-device"));
    // A phone the booth removed is refused even with a valid token, until
    // it signs in again with the PIN (and then it starts unapproved).
    if (!id || devices.removed(id)) return res.status(401).json({ error: "This phone needs today's PIN.", locked: true });
    req.deviceId = id;
    devices.see(id, {});
    next();
  });

  // Control is only for a phone the booth approved by name, which needs a
  // PIN (without one, phones have no identity to approve).
  const approvedOnly = (req, res, next) => {
    if (!pinOn()) return res.status(403).json({ error: "Control from a phone needs phone PINs turned on." });
    if (!devices.approved(req.deviceId)) return res.status(403).json({ error: "The booth hasn't approved this phone for control." });
    next();
  };
  const confirmer = createConfirmer();
  const cooldown = createCooldown(1200);

  app.get("/api/lock", (_req, res) => {
    res.json({ required: pinOn(), daily: auth.daily(), hint: auth.hint() });
  });

  /** A correct PIN earns this phone a signed token: until midnight, or 30 days if trusted. */
  app.post("/api/unlock", (req, res) => {
    if (!pinOn()) return res.json({ ok: true, token: null });
    if (pinGuard?.blocked()) return res.status(429).json({ error: "Too many wrong PINs today, so phones can't sign in until tomorrow. Phones already signed in still work." });
    if (!allowUnlock(req.ip)) return res.status(429).json({ error: "Too many tries. Wait a minute, then ask the booth for today's PIN." });
    const { pin, trust, name } = req.body ?? {};
    if (!pinMatches(pin, auth.expectedPin())) {
      pinGuard?.fail();
      return res.status(403).json({ error: "That isn't today's PIN." });
    }
    const { token, expires, deviceId } = issueToken(auth.secret(), { trust: trust === true });
    devices.see(deviceId, { name, signIn: true });
    res.json({ ok: true, token, expiresAt: new Date(expires).toISOString(), trusted: trust === true });
  });

  const page = path.resolve(publicDir, "remote.html");
  const script = path.resolve(publicDir, "remote.js");
  app.get("/", (_req, res) => res.type("html").send(readFileSync(page, "utf-8")));
  app.get("/remote.js", (_req, res) => res.type("application/javascript").send(readFileSync(script, "utf-8")));

  app.get("/api/state", (req, res) => {
    const { liveState, recent, progress } = getState();
    res.json({
      connected: Boolean(liveState?.connected),
      live: Boolean(liveState?.live),
      pinRequired: pinOn(),
      types: flagTypes().map((t) => t.label),
      recent: (recent ?? []).map((r) => ({ ref: r.ref, at: new Date(r.at).toISOString(), presentationId: r.presentationId, slideIndex: r.slideIndex, presentationName: r.presentationName, slideNumber: r.slideIndex + 1, text: r.text })),
      progress,
      phone: req.deviceId ? { name: devices.name(req.deviceId), canControl: pinOn() && devices.approved(req.deviceId) } : { name: null, canControl: false },
    });
  });

  // --- helper level: read-only --------------------------------------------
  // The phone is for alerts and flags (owner, 2026-10-04). It has no search,
  // no preview of what's next, and nothing that moves a slide.

  /**
   * Every slide of the presentation on the screens, for the Flag tab:
   * previous, current and next up front, and all of them in a tray, so the
   * person can pick the exact slide that needs fixing (owner request).
   */
  app.get("/api/flag-slides", (_req, res) => {
    const d = currentSlides();
    if (!d) return res.json({ presentationId: null, slides: [] });
    res.json({
      presentationId: d.presentationId,
      presentationName: d.presentationName,
      currentIndex: d.currentIndex,
      slides: d.slides.map((sl) => ({
        slideIndex: sl.slideIndex,
        slideNumber: sl.slideIndex + 1,
        text: sl.text,
        ...(pictures() ? { image: `/api/preview/image/${encodeURIComponent(d.presentationId)}/${sl.slideIndex}` } : {}),
      })),
    });
  });

  // Pictures of the presentation on the screens only, and only ones already
  // on disk (owner, 2026-10-04: "pre cached so it does not hurt performance
  // at all"). `thumb` never asks ProPresenter to draw: a picture that wasn't
  // rendered ahead of the service is simply not shown, and the slide's words
  // stand in for it.
  app.get("/api/preview/image/:pid/:idx", async (req, res) => {
    // Closed unless networkModule.phonePictures is true. Checked here, on the
    // server, so a phone page cannot open it by itself.
    if (!pictures()) return res.status(404).json({ error: "Pictures are not sent to phones." });
    const d = currentSlides();
    const idx = Number(req.params.idx);
    const onScreenDeck = d && d.presentationId === req.params.pid && Number.isInteger(idx) && idx >= 0 && idx < d.slides.length;
    if (!onScreenDeck) return res.status(404).json({ error: "Only slides of the presentation on screen can be previewed." });
    if (!allowImage(req.deviceId ?? req.ip)) return res.status(429).json({ error: "Too many pictures at once. Wait a moment." });
    const imgData = await thumb(req.params.pid, idx);
    if (!imgData) return res.status(404).json({ error: "No picture for that slide." });
    res.set("Cache-Control", "private, max-age=300").type(imgData.type).send(imgData.bytes);
  });

  // --- control level: approved phones, confirmed presses -------------------

  // The stage message (handoff section 44): presets only from a phone, so a
  // phone can't put a typo in front of whoever is speaking.
  app.get("/api/stage", approvedOnly, async (_req, res) => {
    res.json(await stage());
  });

  // Messages with a field to fill (a pager code), asked of ProPresenter at
  // most every 10s however many phones are looking.
  let messagesCache = { at: 0, list: null };
  const messageList = async () => {
    if (!messagesCache.list || Date.now() - messagesCache.at > 10_000) messagesCache = { at: Date.now(), list: await messages() };
    return messagesCache.list;
  };
  app.get("/api/messages", approvedOnly, async (_req, res) => {
    try {
      res.json({ messages: await messageList() });
    } catch {
      res.status(502).json({ error: "ProPresenter isn't answering." });
    }
  });

  /**
   * Step one of a control press: says what it will do and hands back a
   * one-time id. Nothing happens until the same phone confirms it.
   */
  app.post("/api/control/prepare", approvedOnly, async (req, res) => {
    const { kind } = req.body ?? {};
    let action = null;
    if (kind === "stage") {
      const p = (await stage()).presets.find((x) => x.id === req.body?.presetId);
      if (p) action = { kind, text: p.text, label: `Stage: "${p.text}"` };
    } else if (kind === "stage-clear") {
      action = { kind, label: "Take down the stage message" };
    } else if (kind === "message" || kind === "message-clear") {
      const m = await messageList()
        .then((list) => list.find((x) => x.id === req.body?.messageId))
        .catch(() => null);
      if (m && kind === "message-clear") action = { kind, messageId: m.id, label: `Take down ${m.name}` };
      else if (m) {
        // Only the message's own fields, cleaned exactly as the booth's Now
        // screen cleans them (messageFieldValue), so the label confirmed is
        // what goes up.
        const given = Array.isArray(req.body?.values) ? req.body.values : [];
        const values = m.fields.map((name) => ({ name, text: messageFieldValue(given.find((v) => v?.name === name)?.text) }));
        if (values.every((v) => v.text)) action = { kind, messageId: m.id, values, label: `${m.name}: ${values.map((v) => v.text).join(", ")}` };
        else return res.status(400).json({ error: `Fill in ${m.fields.join(" and ")} first.` });
      }
    }
    if (!action) return res.status(400).json({ error: "That isn't something a phone can do." });
    res.json({ confirmId: confirmer.prepare(req.deviceId, action), label: action.label });
  });

  /** Step two: the confirm press. Performs it, once, for this phone only. */
  app.post("/api/control/confirm", approvedOnly, async (req, res) => {
    if (!cooldown.ready(req.deviceId)) return res.status(429).json({ error: "Wait a moment between presses, then tap again." });
    const action = confirmer.take(req.deviceId, String(req.body?.confirmId ?? ""));
    if (!action) return res.status(409).json({ error: "That press timed out. Press it again." });
    cooldown.mark(req.deviceId);
    try {
      const out = await control(action, req.deviceId);
      if (action.kind.startsWith("message")) messagesCache = { at: 0, list: null }; // show what changed
      res.json({ ok: true, label: out?.label ?? action.label });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post("/api/flag", async (req, res) => {
    if (!allow(req.ip)) return res.status(429).json({ error: "That's a lot of flags at once. Wait a minute and try again." });
    const { ref, type, note, name, slide } = req.body ?? {};
    let entry = (getState().recent ?? []).find((r) => r.ref === ref);
    // A flag queued on a phone (no signal) can arrive after its slide has
    // left the in-memory list, or after a restart. It carries which slide it
    // meant; that's accepted only if the slide really is in the index, and
    // the text recorded is the index's, never the phone's.
    if (!entry && slide && typeof slide.presentationId === "string" && Number.isInteger(slide.slideIndex)) {
      const indexed = knownSlide(slide.presentationId, slide.slideIndex);
      const seenAt = Date.parse(slide.at);
      if (indexed) entry = { ...indexed, presentationId: slide.presentationId, slideIndex: slide.slideIndex, at: Number.isFinite(seenAt) ? seenAt : Date.now() };
      // Or any slide of the presentation on screen, picked from the tray:
      // a slide with no words (a graphic) is never in the index. What's
      // recorded is the booth's own copy of it, never the phone's.
      const d = entry ? null : currentSlides();
      const own = d?.presentationId === slide.presentationId ? d.slides.find((x) => x.slideIndex === slide.slideIndex) : null;
      if (own) entry = { presentationId: d.presentationId, presentationName: d.presentationName, slideIndex: own.slideIndex, text: own.text ?? "", at: Date.now() };
    }
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
  // A malformed request gets one plain sentence. Express's default would
  // send a stack trace, with file paths, to anyone on the network.
  // Four arguments, because that's how Express knows it's an error handler.
  app.use((err, _req, res, _next) => res.status(err.status && err.status < 500 ? err.status : 400).json({ error: "Bad request." }));
  return app;
}
