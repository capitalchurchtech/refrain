/**
 * Service days: what happened, when, in which service (handoff section 37,
 * phase 1; issue #6).
 *
 * **One idea holds it together: a day is a folder of events.** Every fact is a
 * new file -- a service was added, something went live, it left, a lock-in
 * started or was released -- and "the state of the day" is those events
 * folded in time order. Nothing is ever rewritten, so a shared folder works
 * without sync conflicts (see append-store.js), and a restart mid-service
 * loses nothing: the events are already on disk.
 *
 * **Where services come from, most specific first:**
 *   1. a lock-in, opened by hand, lasting until released (live events);
 *   2. a service added for today on the Service screen;
 *   3. a recurring schedule in config (`serviceModule.schedule`);
 *   4. otherwise nothing is scheduled, and what goes live is still recorded,
 *      as "not in a service".
 * No times live in code. Services are the church's own, and optional.
 *
 * **The timeline rides on the heartbeat.** The recorder watches the live
 * presentation the heartbeat already reads. It adds no ProPresenter traffic,
 * which is what makes it safe under performance mode. The cost, stated where
 * it is shown: a time is when Refrain first *saw* an item, up to one beat
 * (4s during a service) after it went live.
 *
 * Everything here is pure (clock and machine are parameters) except the three
 * storage functions at the bottom.
 */

import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";
import { saveRecord, retryPending, readJsonDir, listSubdirs } from "./append-store.js";

export const DEFAULT_DAYS_FOLDER = "./data/service-days";
export const PENDING_DIR = "./data/service-days-pending";

/** A scheduled service is watched from this long before its start... */
export const DEFAULT_LEAD_MINUTES = 15;
/** ...until this long after, or until it is ended by hand, whichever is first. */
export const DEFAULT_TRAIL_MINUTES = 150;
/** A lock-in this old gets pointed out. Never released automatically. */
export const LOCKIN_REMIND_HOURS = 6;
/** A service with no set time counts as running while something from it was on screen this recently. */
export const RUNNING_GAP_MS = 15 * 60_000;

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// --- time -----------------------------------------------------------------

/** The local calendar date of a moment, as YYYY-MM-DD. The machine's own time zone. */
export function dayKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDayKey(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * The moment a local wall-clock time happens on a given day, e.g. 09:00 on
 * 2026-11-01. Built from local fields rather than by adding hours to
 * midnight, so a daylight-saving change that day moves nothing: "9:00" is
 * 9:00 on the clock the congregation reads.
 * @returns {number|null} ms, or null for a malformed time
 */
export function localTimeOn(day, hhmm) {
  if (!isDayKey(day)) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(y, mo - 1, d, h, min, 0, 0).getTime();
}

// --- events ---------------------------------------------------------------

/** Sortable and unique, like a flag id: the time first, so a folder lists in order. */
export function eventId(atIso) {
  return `${atIso.replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
}

export function isEventId(id) {
  return typeof id === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}$/.test(id);
}

export const EVENT_TYPES = new Set([
  "service-added",
  "service-ended",
  "lockin-started",
  "lockin-released",
  "item-live",
  "item-left",
  "checks-run",
  "step-set",
  "day-ended",
]);

export function buildEvent(type, fields = {}, { now = Date.now(), machine = hostname(), id } = {}) {
  if (!EVENT_TYPES.has(type)) throw new Error(`Unknown event type: ${type}`);
  const at = new Date(now).toISOString();
  return { id: id ?? eventId(at), type, at, day: dayKey(now), machine, ...fields };
}

/**
 * The service a new service-added event creates. The id is derived from the
 * event, so two machines adding "Carols" at once get two services rather than
 * one silently merged.
 */
export function newServiceId(event) {
  return `svc-${event.id}`;
}

// --- schedule -------------------------------------------------------------

/**
 * Recurring services from config that fall on this day, as virtual services.
 * `schedule: [{ day: "sun", time: "09:00", name: "Early", playlistMatch: "early" }]`.
 * Entries that do not parse are skipped here and reported by
 * getServiceModuleStatus, so a typo in config degrades to "misconfigured"
 * rather than breaking the screen.
 */
export function scheduledServices(day, schedule = []) {
  if (!isDayKey(day)) return [];
  const [y, mo, d] = day.split("-").map(Number);
  const weekday = DAY_NAMES[new Date(y, mo - 1, d).getDay()];
  const out = [];
  for (const entry of Array.isArray(schedule) ? schedule : []) {
    const days = [].concat(entry?.day ?? []).map((x) => String(x).toLowerCase().slice(0, 3));
    if (!days.includes(weekday)) continue;
    const startsAt = localTimeOn(day, entry.time);
    if (startsAt == null) continue;
    out.push({
      serviceId: `sched-${day}-${String(entry.time).replace(":", "")}`,
      name: String(entry.name ?? entry.time),
      source: "schedule",
      startsAt,
      playlistMatch: entry.playlistMatch ? String(entry.playlistMatch) : null,
    });
  }
  return out;
}

/** Problems with a schedule, for the module status. Empty means fine. */
export function scheduleProblems(schedule) {
  if (schedule == null) return [];
  if (!Array.isArray(schedule)) return ["serviceModule.schedule must be a list."];
  const problems = [];
  schedule.forEach((e, i) => {
    const days = [].concat(e?.day ?? []).map((x) => String(x).toLowerCase().slice(0, 3));
    if (!days.length || !days.every((d) => DAY_NAMES.includes(d))) problems.push(`Entry ${i + 1}: day should be like "sun".`);
    if (localTimeOn("2026-01-04", e?.time) == null) problems.push(`Entry ${i + 1}: time should be like "09:00".`);
  });
  return problems;
}

// --- folding a day --------------------------------------------------------

/**
 * The state of a day from its events (plus that day's scheduled services).
 *
 * @returns {{
 *   services: Array<object>,   // every service, in start order
 *   lockin: object|null,       // the open lock-in, if any
 *   openItem: object|null,     // what the last event says is live
 *   segments: Array<object>,   // each stretch an item was on screen
 * }}
 */
export function foldDay(events, { schedule = [], day = null, now = Date.now() } = {}) {
  const ordered = [...(events ?? [])]
    .filter((e) => e && EVENT_TYPES.has(e.type) && typeof e.at === "string")
    .sort((a, b) => a.at.localeCompare(b.at) || (a.seq ?? 0) - (b.seq ?? 0) || String(a.id).localeCompare(String(b.id)));

  const services = new Map();
  for (const s of scheduledServices(day ?? ordered[0]?.day ?? dayKey(now), schedule)) {
    services.set(s.serviceId, { ...s, playlist: null, endedAt: null, releasedAt: null });
  }

  let lockin = null;
  let open = null;
  const checks = new Map(); // serviceId -> the latest run
  const steps = new Map(); // `${phaseId}:${stepId}:${serviceId ?? "day"}` -> done
  const dayEnds = [];
  const segments = [];
  const closeOpen = (atMs) => {
    if (!open) return;
    segments.push({ ...open, endMs: Math.max(atMs, open.startMs) });
    open = null;
  };

  for (const e of ordered) {
    const atMs = Date.parse(e.at);
    if (e.type === "service-added") {
      const id = e.serviceId ?? newServiceId(e);
      services.set(id, {
        serviceId: id,
        name: e.name ?? "Service",
        source: e.source ?? "today",
        startsAt: Number.isFinite(e.startsAt) ? e.startsAt : null,
        playlist: e.playlist ?? null,
        playlistMatch: null,
        addedAt: atMs,
        endedAt: null,
        releasedAt: null,
      });
    } else if (e.type === "service-ended") {
      const s = services.get(e.serviceId);
      if (s && s.endedAt == null) s.endedAt = atMs;
    } else if (e.type === "lockin-started") {
      lockin = { serviceId: e.serviceId, name: e.name, startedAt: atMs, armedPerformance: Boolean(e.armedPerformance) };
      const s = services.get(e.serviceId);
      if (s) s.source = "lockin";
    } else if (e.type === "lockin-released") {
      if (lockin && lockin.serviceId === e.serviceId) {
        const s = services.get(e.serviceId);
        if (s) {
          s.releasedAt = atMs;
          s.endedAt ??= atMs;
        }
        lockin = null;
      }
    } else if (e.type === "item-live") {
      closeOpen(atMs);
      open = {
        presentationId: e.presentationId,
        name: e.name ?? null,
        arrangementName: e.arrangementName ?? null,
        serviceId: e.serviceId ?? null,
        itemIndex: Number.isInteger(e.itemIndex) ? e.itemIndex : null,
        startMs: atMs,
      };
    } else if (e.type === "item-left") {
      if (open && (!e.presentationId || e.presentationId === open.presentationId)) closeOpen(atMs);
    } else if (e.type === "checks-run") {
      checks.set(e.serviceId ?? null, { at: atMs, results: Array.isArray(e.results) ? e.results : [] });
    } else if (e.type === "step-set") {
      steps.set(stepKey(e.phaseId, e.stepId, e.serviceId), Boolean(e.done));
    } else if (e.type === "day-ended") {
      dayEnds.push({ at: atMs, eventId: e.id, summaryFile: e.summaryFile ?? null });
    }
  }
  const lastEnd = dayEnds.at(-1) ?? null;
  // Anything recorded after End means the day was picked up again: a late
  // service, or someone putting a song back up. Shown, never silently merged.
  const reopened = Boolean(lastEnd) && ordered.some((e) => Date.parse(e.at) > lastEnd.at && e.type !== "day-ended");

  return {
    services: [...services.values()].sort((a, b) => (a.startsAt ?? a.addedAt ?? 0) - (b.startsAt ?? b.addedAt ?? 0)),
    lockin,
    openItem: open,
    segments,
    checks,
    steps,
    dayEnds,
    reopened,
  };
}

export function stepKey(phaseId, stepId, serviceId = null) {
  return `${phaseId}:${stepId}:${serviceId ?? "day"}`;
}

// --- finding this week's playlist -------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Ways a church might write a date in a playlist name, for one day. Collected
 * from a real library, which used all of these within a year: 6/7/26,
 * 02/21/26, Dec-13-25, Oct 25, Jan 8, plus 2026-09-27 for tidy people.
 */
export function dateTokens(day) {
  const [y, m, d] = day.split("-").map(Number);
  const yy = String(y).slice(2);
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const mon = MONTHS[m - 1];
  return [
    `${m}/${d}/${yy}`, `${mm}/${dd}/${yy}`, `${m}/${d}/${y}`, `${mm}/${dd}/${y}`,
    `${m}-${d}-${yy}`, `${mm}-${dd}-${yy}`, `${mon}-${dd}-${yy}`, `${mon}-${d}-${yy}`,
    `${y}-${mm}-${dd}`, `${m}/${d}`, `${mm}/${dd}`, `${mon} ${d}`, `${mon} ${dd}`,
  ];
}

/**
 * The playlist a scheduled service means: its name contains the pattern
 * ("SL-09"), and when several do (every past week's does), the one dated this
 * day. Dates are matched as whole tokens, so "9/2" doesn't match "9/27".
 * Returns null rather than guess when it can't tell, and says why.
 */
export function matchPlaylist(playlists, pattern, day) {
  const want = String(pattern ?? "").toLowerCase();
  if (!want) return { playlist: null, reason: "no pattern" };
  const named = (playlists ?? []).filter((p) => String(p.name).toLowerCase().includes(want));
  if (!named.length) return { playlist: null, reason: `no playlist name contains "${pattern}"` };
  const tokens = dateTokens(day);
  const dated = named.filter((p) => {
    const name = String(p.name).toLowerCase();
    return tokens.some((t) => new RegExp(`(^|[^0-9a-z])${t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}($|[^0-9])`).test(name));
  });
  if (dated.length === 1) return { playlist: dated[0], reason: "dated today" };
  if (dated.length > 1) return { playlist: null, reason: `${dated.length} playlists match "${pattern}" and today's date` };
  if (named.length === 1) return { playlist: named[0], reason: "only match" };
  return { playlist: null, reason: `${named.length} playlists contain "${pattern}", none dated today` };
}

// --- windows and pacing ---------------------------------------------------

/** When a service is being watched closely, or null for one with no time (added without a start). */
export function serviceWindow(service, { leadMinutes = DEFAULT_LEAD_MINUTES, trailMinutes = DEFAULT_TRAIL_MINUTES } = {}) {
  if (service.source === "lockin") {
    const from = service.addedAt ?? null;
    return from == null ? null : { from, to: service.releasedAt ?? Infinity };
  }
  if (service.startsAt == null) return null;
  const naturalEnd = service.startsAt + trailMinutes * 60_000;
  return { from: service.startsAt - leadMinutes * 60_000, to: service.endedAt != null ? Math.min(service.endedAt, naturalEnd) : naturalEnd };
}

/** The services being watched at this moment. */
export function activeServices(state, now = Date.now(), opts = {}) {
  return state.services.filter((s) => {
    const w = serviceWindow(s, opts);
    return w && now >= w.from && now <= w.to;
  });
}

/**
 * Whether the heartbeat should hold its active pace regardless of whether a
 * browser is open. A booth machine mid-service normally has nobody at the
 * desk, and the idle 30s beat would make the timeline ±30s.
 */
export function shouldHoldPace(state, now = Date.now(), opts = {}) {
  return Boolean(state.lockin) || activeServices(state, now, opts).length > 0;
}

// --- recording ------------------------------------------------------------

/**
 * Which service a presentation going live belongs to, and which playlist item
 * it is. Order: the open lock-in; a watched service whose playlist has it; the
 * watched service with the nearest start; a timeless service added today whose
 * playlist has it and which has not ended; otherwise no service.
 *
 * Item matching handles a presentation that appears more than once in a
 * playlist (a looping pre-roll at the start, the intermission and the end):
 * it prefers the same arrangement, then the first occurrence after the last
 * item this service played, so the second pass lands on the second entry.
 */
export function assignService(state, { presentationId, arrangementName = null }, now = Date.now(), opts = {}) {
  const inPlaylist = (s) => (s.playlist?.items ?? []).some((it) => it.presentationId === presentationId);
  const watched = activeServices(state, now, opts);
  let service = null;
  if (state.lockin) service = state.services.find((s) => s.serviceId === state.lockin.serviceId) ?? null;
  if (!service) service = watched.find(inPlaylist) ?? null;
  if (!service && watched.length) {
    service = [...watched].sort((a, b) => Math.abs((a.startsAt ?? a.addedAt) - now) - Math.abs((b.startsAt ?? b.addedAt) - now))[0];
  }
  const timeless = state.services.filter((s) => s.startsAt == null && s.source !== "lockin" && s.endedAt == null);
  if (!service) service = timeless.find(inPlaylist) ?? null;
  // A service with no time is "running" once something from it has been on
  // screen recently. While it runs it also claims what is not in its
  // playlist, so an extra song shows as off-plan in that service rather than
  // dropping out of it.
  if (!service) {
    const recent = (s) =>
      (state.openItem?.serviceId === s.serviceId) ||
      state.segments.some((g) => g.serviceId === s.serviceId && now - g.endMs <= RUNNING_GAP_MS);
    service = timeless.find(recent) ?? null;
  }
  if (!service) return { serviceId: null, itemIndex: null };

  const items = service.playlist?.items ?? [];
  const lastIndex = Math.max(
    -1,
    ...state.segments.filter((g) => g.serviceId === service.serviceId && g.itemIndex != null).map((g) => g.itemIndex),
    state.openItem?.serviceId === service.serviceId && state.openItem.itemIndex != null ? state.openItem.itemIndex : -1
  );
  const candidates = items.map((it, i) => ({ it, i })).filter(({ it }) => it.presentationId === presentationId);
  if (!candidates.length) return { serviceId: service.serviceId, itemIndex: null };
  const pick =
    candidates.find(({ it, i }) => i > lastIndex && arrangementName && it.arrangementName === arrangementName) ??
    candidates.find(({ i }) => i > lastIndex) ??
    candidates.find(({ it }) => arrangementName && it.arrangementName === arrangementName) ??
    candidates[0];
  return { serviceId: service.serviceId, itemIndex: pick.i };
}

/**
 * The events a heartbeat should record, given what was live and what is live
 * now. Only the live *presentation* matters: advancing slides inside a song is
 * not a new item, and neither is the same song staying up.
 */
export function transitionEvents(state, current, now = Date.now(), { machine, opts } = {}) {
  const prevId = state.openItem?.presentationId ?? null;
  const nextId = current?.presentationId ?? null;
  if (prevId === nextId) return [];
  const events = [];
  // Same timestamp, explicit order: the old item leaves, then the new one goes
  // live. `seq` breaks the tie when folding, without skewing either time.
  if (prevId) events.push(buildEvent("item-left", { presentationId: prevId, serviceId: state.openItem.serviceId ?? null, seq: 0 }, { now, machine }));
  if (nextId) {
    const { serviceId, itemIndex } = assignService(state, current, now, opts);
    events.push(
      buildEvent(
        "item-live",
        { presentationId: nextId, name: current.name ?? null, arrangementName: current.arrangementName ?? null, serviceId, itemIndex, seq: 1 },
        { now, machine }
      )
    );
  }
  return events;
}

// --- the rundown ----------------------------------------------------------

/**
 * One row per item, per service, in the order they first went live: when it
 * first went up, total time on screen, the gap before it, and any later
 * returns. Items not in the service's playlist are rows too, marked off-plan,
 * because "we ran an extra song" is worth seeing.
 */
export function timelineRows(state, serviceId, now = Date.now()) {
  const segs = state.segments.filter((g) => g.serviceId === serviceId);
  if (state.openItem && state.openItem.serviceId === serviceId) segs.push({ ...state.openItem, endMs: now, open: true });
  segs.sort((a, b) => a.startMs - b.startMs);

  const service = state.services.find((s) => s.serviceId === serviceId);
  const items = service?.playlist?.items ?? [];
  const rows = new Map();
  let prevEnd = null;
  for (const g of segs) {
    const key = g.itemIndex != null ? `item-${g.itemIndex}` : `off-${g.presentationId}`;
    const gap = prevEnd == null ? null : Math.max(0, g.startMs - prevEnd);
    const duration = Math.max(0, g.endMs - g.startMs);
    if (!rows.has(key)) {
      rows.set(key, {
        key,
        position: g.itemIndex != null ? g.itemIndex + 1 : null,
        name: (g.itemIndex != null ? items[g.itemIndex]?.name : null) ?? g.name ?? "Untitled",
        offPlan: g.itemIndex == null && Boolean(service?.playlist),
        firstLive: g.startMs,
        lastLive: g.startMs,
        onScreenMs: duration,
        gapBeforeMs: gap,
        returns: [],
        live: Boolean(g.open),
      });
    } else {
      const row = rows.get(key);
      row.lastLive = g.startMs;
      row.onScreenMs += duration;
      row.returns.push({ at: g.startMs, onScreenMs: duration });
      row.live = row.live || Boolean(g.open);
    }
    prevEnd = g.endMs;
  }
  return [...rows.values()].sort((a, b) => a.firstLive - b.firstLive);
}

/** Start, end and running time of a service, from what actually went live. */
export function serviceSummary(state, serviceId, now = Date.now()) {
  const rows = timelineRows(state, serviceId, now);
  if (!rows.length) return { startedAt: null, endedAt: null, runMs: 0, items: 0 };
  const segs = state.segments.filter((g) => g.serviceId === serviceId);
  const openHere = state.openItem?.serviceId === serviceId;
  const startedAt = Math.min(...rows.map((r) => r.firstLive));
  const endedAt = openHere ? null : Math.max(...segs.map((g) => g.endMs));
  return { startedAt, endedAt, runMs: (endedAt ?? now) - startedAt, items: rows.length };
}

/** "Locked in since 18:02 (6h). Release?" once it has been on long enough to be worth asking. */
export function lockinReminder(lockin, now = Date.now(), hours = LOCKIN_REMIND_HOURS) {
  if (!lockin) return null;
  const ageMs = now - lockin.startedAt;
  return ageMs >= hours * 3_600_000 ? { hours: Math.floor(ageMs / 3_600_000) } : null;
}

// --- storage --------------------------------------------------------------

/** Saves one event into its day's folder: here first, then the shared folder. */
export async function saveEvent(event, { folder = DEFAULT_DAYS_FOLDER, pendingDir = PENDING_DIR } = {}) {
  if (!isEventId(event?.id) || !isDayKey(event?.day)) throw new Error("That is not a valid service event, so it was not saved.");
  return saveRecord(event.day, `${event.id}.json`, event, { folder, pendingDir });
}

/** Every event for a day, from the shared folder and anything still waiting to reach it. */
export async function readDay(day, { folder = DEFAULT_DAYS_FOLDER, pendingDir = PENDING_DIR } = {}) {
  if (!isDayKey(day)) return [];
  const byId = new Map();
  for (const dir of [path.join(folder, day), path.join(pendingDir, day)]) {
    for (const e of await readJsonDir(dir, (n) => isEventId(n.replace(/\.json$/, "")))) {
      if (isEventId(e?.id) && !byId.has(e.id)) byId.set(e.id, e);
    }
  }
  return [...byId.values()];
}

/** Copies waiting events to the shared folder, every day that has any. */
export async function retryPendingEvents({ folder = DEFAULT_DAYS_FOLDER, pendingDir = PENDING_DIR } = {}) {
  const days = (await listSubdirs(pendingDir)).filter(isDayKey);
  return retryPending(days, { folder, pendingDir });
}
