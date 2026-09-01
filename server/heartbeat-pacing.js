/**
 * How often to ask ProPresenter what is on the screens.
 *
 * The heartbeat used to run every four seconds unconditionally, from boot until
 * the process died, whether or not a browser was open. Two API calls each time:
 * 1,800 an hour, 43,200 a day, indefinitely, for an app nobody was looking at.
 *
 * Measured, each call answers in about 3ms, so this was never *overwhelming*
 * ProPresenter — worth saying plainly rather than blaming it for a corruption
 * it did not cause. But asking a presentation app forty-three thousand
 * questions a day while nobody is using yours is not defensible on its own
 * terms, and the install script encourages leaving Refrain running.
 *
 * So the rate follows whether anyone is actually there:
 *
 *   - A browser polled recently: four seconds. The live readout is on the path
 *     to screen, and an operator watching what is live needs it current.
 *   - Nobody there: thirty seconds. An 87% reduction, and still frequent enough
 *     for performance mode to notice a service starting.
 *
 * Deliberately **not** stopping altogether when idle. Performance mode is what
 * stops Refrain indexing during a service, and it learns that a service has
 * started by watching the screens. An idle Refrain that has stopped looking
 * would arm late, which is the moment it most needs to be right — and "nobody
 * has the browser open" is the normal state of a booth machine mid-service.
 */

/** A browser seen within this long counts as someone being there. */
export const CLIENT_ACTIVE_MS = 2 * 60_000;

export const HEARTBEAT_ACTIVE_MS = 4_000;
export const HEARTBEAT_IDLE_MS = 30_000;

/**
 * The interval to use right now.
 *
 * `lastClientAt` is null before any browser has ever polled, which is the state
 * of a machine booted into a service with nobody at the desk — so it is treated
 * as idle rather than as active.
 */
export function heartbeatInterval({ lastClientAt = null, now = Date.now() } = {}) {
  if (lastClientAt == null) return HEARTBEAT_IDLE_MS;
  const since = now - lastClientAt;
  if (!Number.isFinite(since) || since < 0) return HEARTBEAT_ACTIVE_MS;
  return since <= CLIENT_ACTIVE_MS ? HEARTBEAT_ACTIVE_MS : HEARTBEAT_IDLE_MS;
}

/** Requests per hour at a given interval, for the Health screen and for tests. */
export function callsPerHour(intervalMs, callsPerBeat = 2) {
  return Math.round((3_600_000 / intervalMs) * callsPerBeat);
}
