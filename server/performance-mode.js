/**
 * Performance mode: a hard freeze on everything Refrain does unasked.
 *
 * This replaces the old Saturday/Sunday gate, which was a proxy for "something
 * is happening" and wrong in both directions — it blocked indexing at 2pm on a
 * Saturday when the building was empty, and allowed it at 7pm on a Wednesday
 * during a midweek service.
 *
 * ProPresenter will simply tell us instead. /v1/status/layers reports whether
 * anything is on the screens right now, for the cost of one call.
 *
 * The point of a mode rather than more heuristics is that it is a promise
 * rather than a guess: while it is armed, Refrain makes no API call it was not
 * asked to make. That is something an operator can verify and a README can
 * state. Anything the operator presses still works — they are in charge; it is
 * only Refrain's own initiative that stops.
 */

export const PERFORMANCE_DEFAULTS = {
  // Something has to be on screen this long before arming on its own, so
  // flicking through a slide mid-week doesn't freeze the index.
  armAfterLiveMs: 2 * 60_000,
  // ...and clear this long before standing down again. Generous, because the
  // gap between two services is not a good moment to start crawling.
  disarmAfterClearMs: 20 * 60_000,
};

/** Layers that mean something is actually in front of the congregation. */
const OUTPUT_LAYERS = ["slide", "media", "video_input", "announcements", "props"];

export function isLive(layers) {
  if (!layers || typeof layers !== "object") return false;
  return OUTPUT_LAYERS.some((name) => layers[name] === true);
}

/** The starting state, before anything has been observed. */
export function initialState() {
  return { armed: false, source: null, since: null, liveSince: null, clearSince: null, lastCheckedAt: null, lastError: null };
}

/**
 * Advances the arm/disarm state machine.
 *
 * Pure: give it the previous state, what the layers say, and the time, and it
 * returns the next state. No timers, no I/O, so every transition below is
 * testable without a ProPresenter.
 *
 * @param {object} opts
 * @param {object} opts.state - previous state
 * @param {object|null} opts.layers - /v1/status/layers, or null if it failed
 * @param {number} opts.now
 * @param {object} [opts.config] - { armAfterLiveMs, disarmAfterClearMs }
 */
export function advance({ state, layers, now, config = {} }) {
  const { armAfterLiveMs, disarmAfterClearMs } = { ...PERFORMANCE_DEFAULTS, ...config };
  const next = { ...state, lastCheckedAt: now };

  // A manual arm is the operator's decision and outlasts anything observed.
  // Only a person turns it off again.
  if (state.armed && state.source === "manual") {
    next.lastError = layers ? null : "ProPresenter is not answering";
    return next;
  }

  if (!layers) {
    // Can't tell what's on screen. Assume the worst: if ProPresenter is
    // unreachable there is nothing worth indexing anyway, so freezing costs
    // nothing and guessing wrong could cost a service.
    next.lastError = "ProPresenter is not answering";
    next.liveSince = null;
    next.clearSince = null;
    if (!state.armed) {
      next.armed = true;
      next.source = "unknown";
      next.since = now;
    }
    return next;
  }

  next.lastError = null;
  const live = isLive(layers);

  if (live) {
    next.clearSince = null;
    next.liveSince = state.liveSince ?? now;
    // An "unknown" arm was a precaution; now we can see, so re-derive it.
    if (!state.armed || state.source === "unknown") {
      if (now - next.liveSince >= armAfterLiveMs) {
        next.armed = true;
        next.source = "auto";
        next.since = state.armed && state.source === "auto" ? state.since : now;
      } else if (state.source === "unknown") {
        next.armed = false;
        next.source = null;
        next.since = null;
      }
    }
    return next;
  }

  next.liveSince = null;
  next.clearSince = state.clearSince ?? now;

  if (state.armed && state.source === "unknown") {
    // That arm was a precaution taken because we could not see. We can see now,
    // and nothing is on screen, so the reason for it is gone. Waiting out the
    // all-clear would be serving a sentence it never earned.
    next.armed = false;
    next.source = null;
    next.since = null;
    return next;
  }

  if (state.armed && state.source === "auto" && now - next.clearSince >= disarmAfterClearMs) {
    next.armed = false;
    next.source = null;
    next.since = null;
  }
  return next;
}

/** Turns the mode on by hand. Stays on until turned off by hand. */
export function armManually(state, now) {
  return { ...state, armed: true, source: "manual", since: now, liveSince: null, clearSince: null };
}

/** Turns it off by hand, whatever armed it. */
export function disarmManually(state, now) {
  return { ...state, armed: false, source: null, since: null, liveSince: null, clearSince: now };
}

/**
 * A sentence saying what state it is in and why, for the banner.
 *
 * A mode that claims to be protecting you without saying how it decided is
 * worse than no mode, so this always names the source and the last check.
 */
export function describe(state, now = Date.now()) {
  if (!state.armed) {
    return state.lastCheckedAt
      ? `Off. Nothing is on the screens as of ${new Date(state.lastCheckedAt).toLocaleTimeString()}.`
      : "Off.";
  }
  const forMin = state.since ? Math.max(0, Math.round((now - state.since) / 60_000)) : 0;
  const how =
    state.source === "manual"
      ? "Turned on by hand"
      : state.source === "unknown"
        ? "On because ProPresenter is not answering, so Refrain cannot tell whether you are live"
        : "On because ProPresenter is showing something";
  const checked = state.lastCheckedAt ? `, last checked ${new Date(state.lastCheckedAt).toLocaleTimeString()}` : "";
  return `${how}${forMin > 0 ? `, ${forMin} min ago` : ""}${checked}.`;
}
