/**
 * Ending the day on its own, and sending the summary (owner, 2026-10-04: "can
 * the log auto send if idle for a couple of hours ... and/or when
 * ProPresenter has been quit").
 *
 * Off unless `serviceModule.autoEnd.enabled` is true. When on, the day ends
 * by itself, whichever comes first:
 *   - **idle**: nothing on the screens for `idleMinutes` (default 2 hours)
 *     since the last thing that was;
 *   - **closed**: ProPresenter not running on this Mac for `closedMinutes`
 *     (default 15). A crash counts, being the same as a quit; a restart
 *     between services doesn't, since it's back long before then. Only on
 *     this Mac: from another one a quit can't be told from a network drop,
 *     so there only the idle rule applies.
 *
 * Never on a day nothing went live, never during or before a service still
 * scheduled for today, never during a lock-in or performance mode, never while
 * something is on the screens, and at most once a day (a day already ended,
 * by hand or not, is left alone). Pure: index.js supplies the facts and
 * does the ending and the sending.
 */

export const AUTO_END_DEFAULTS = { enabled: false, idleMinutes: 120, closedMinutes: 15 };

/** The setting as stored, with defaults and sane bounds. */
export function autoEndSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const minutes = (v, d, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : d);
  return {
    enabled: r.enabled === true,
    idleMinutes: minutes(r.idleMinutes, AUTO_END_DEFAULTS.idleMinutes, 15, 24 * 60),
    closedMinutes: minutes(r.closedMinutes, AUTO_END_DEFAULTS.closedMinutes, 5, 6 * 60),
  };
}

/**
 * What auto-end would do now.
 *
 * @param {object} p
 * @param {number} p.now
 * @param {object} p.settings      from autoEndSettings
 * @param {object} p.state         foldDay's state for today
 * @param {boolean} p.liveNow      something is on the screens
 * @param {boolean} p.performanceArmed
 * @param {boolean} [p.serviceUnderWay]  a service is in its window and not ended
 * @param {number|null} p.closedSince  when ProPresenter was first seen not
 *                                 running on this Mac; null when it's running
 *                                 or Refrain can't tell
 * @returns {{ status: "off"|"done"|"nothing"|"held"|"waiting"|"due", reason?: string, dueAt?: number, trigger?: "idle"|"closed" }}
 */
export function autoEndPlan({ now, settings, state, liveNow, performanceArmed, closedSince = null, serviceUnderWay = false }) {
  if (!settings?.enabled) return { status: "off" };
  if ((state?.dayEnds ?? []).length) return { status: "done" };
  const segments = state?.segments ?? [];
  if (!segments.length && !state?.openItem) return { status: "nothing", reason: "Nothing has gone live today." };
  if (state?.lockin) return { status: "held", reason: "A lock-in is on." };
  if (performanceArmed) return { status: "held", reason: "Performance mode is on." };
  if (liveNow) return { status: "held", reason: "Something is on the screens." };
  // A crash, or a move to the backup Mac, mid-service: never end the day
  // and send half a summary while a service is still under way.
  if (serviceUnderWay) return { status: "held", reason: "A service is under way." };
  const later = (state?.services ?? []).filter((s) => Number.isFinite(s.startsAt) && s.startsAt > now && s.endedAt == null);
  if (later.length) {
    const next = Math.min(...later.map((s) => s.startsAt));
    return { status: "held", reason: "A service is still to come today.", dueAt: next };
  }

  const lastLive = Math.max(0, ...segments.map((g) => g.endMs ?? 0), state?.openItem?.startMs ?? 0);
  const idleAt = lastLive + settings.idleMinutes * 60_000;
  const closedAt = Number.isFinite(closedSince) ? closedSince + settings.closedMinutes * 60_000 : Infinity;
  const dueAt = Math.min(idleAt, closedAt);
  const trigger = closedAt <= idleAt ? "closed" : "idle";
  if (now >= dueAt) return { status: "due", dueAt, trigger };
  return { status: "waiting", dueAt, trigger };
}

/** The line in the summary saying why the day ended without a press. */
export function autoEndNote(trigger, settings) {
  if (trigger === "closed") return `Ended automatically: ProPresenter had been closed for ${settings.closedMinutes} minutes.`;
  const h = settings.idleMinutes / 60;
  const span = Number.isInteger(h) ? `${h} hour${h === 1 ? "" : "s"}` : `${settings.idleMinutes} minutes`;
  return `Ended automatically: nothing had been on the screens for ${span}.`;
}

/** The summary with the note just under its title. */
export function withAutoNote(markdown, note) {
  const md = String(markdown ?? "");
  return /^# .*\n/.test(md) ? md.replace(/^(# .*\n)/, `$1\n_${note}_\n`) : `_${note}_\n\n${md}`;
}
