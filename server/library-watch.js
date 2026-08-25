/**
 * Keeps the search index current without anyone pressing anything.
 *
 * Watches the library folders for .pro files changing, waits for the writing to
 * stop, then reindexes just what changed. A slow safety-net poll covers the
 * events fs.watch drops, which it does — on macOS it is a best-effort stream,
 * not a guarantee.
 *
 * The interval barely matters, because deciding and acting cost wildly
 * different amounts. Measured on a real 445-presentation library: deciding is
 * three API calls plus 445 local file hashes, about 80ms; acting is ~135ms per
 * changed presentation, paced so ProPresenter stays responsive. So this checks
 * freely and acts narrowly, and every guard below is about what it is allowed
 * to DO, not how often it is allowed to look.
 *
 * What it must never do is turn into a full rebuild on its own. A full rebuild
 * took 26.6 minutes on that library and makes ProPresenter sluggish throughout.
 * Automatic is fine for half a second of work; it is never fine for half an
 * hour, and least of all on a Sunday morning.
 */
import { watch } from "node:fs";

export const WATCH_DEFAULTS = {
  // Long enough that saving several songs in a row is one reindex, short enough
  // that a volunteer who edits a slide and switches to Refrain finds it there.
  debounceMs: 10_000,
  // fs.watch can miss events; this is the floor on how stale things can get.
  safetyNetMs: 30 * 60_000,
  // Above this, ask rather than act. A bulk import or a Library Sync run should
  // not silently trigger a multi-minute crawl.
  maxAutoFetch: 25,
  // Reads fail en masse while ProPresenter is still indexing its own media
  // after launch — measured at 221 of 445 lost. Give it a few minutes.
  settleAfterReadyMs: 3 * 60_000,
};

/**
 * Whether an automatic reindex may proceed, given a plan.
 *
 * Pure, so every refusal is testable without a ProPresenter, a filesystem, or
 * a clock. Returns a reason in all cases — a watcher that silently declines is
 * indistinguishable from one that is broken.
 *
 * @param {object} opts
 * @param {object} opts.plan - from planReindex()
 * @param {boolean} opts.crawlPlaylists - whether playlist crawling is enabled
 * @param {boolean} opts.rebuildInProgress
 * @param {number|null} opts.readyForMs - how long ProPresenter has been
 *   answering, or null if it is not answering at all
 * @param {number} opts.maxAutoFetch
 * @param {number} opts.settleAfterReadyMs
 */
export function decideAutoReindex({
  plan,
  crawlPlaylists = false,
  rebuildInProgress = false,
  readyForMs = null,
  maxAutoFetch = WATCH_DEFAULTS.maxAutoFetch,
  settleAfterReadyMs = WATCH_DEFAULTS.settleAfterReadyMs,
}) {
  if (rebuildInProgress) {
    return { run: false, reason: "an index build is already running" };
  }
  if (readyForMs == null) {
    return { run: false, reason: "ProPresenter is not answering" };
  }
  if (readyForMs < settleAfterReadyMs) {
    return { run: false, reason: "ProPresenter has only just started - letting it settle first", retry: true };
  }
  if (crawlPlaylists) {
    // Playlist membership is not in the presentation files, so a reindex with
    // crawling on re-crawls every playlist — the slowest thing Refrain does.
    // Not something to start unasked.
    return { run: false, reason: "playlist crawling is on, so a reindex is not cheap enough to run automatically" };
  }
  if (!plan || plan.mode !== "incremental") {
    return {
      run: false,
      needsFullRebuild: true,
      reason: plan?.reason ?? "the index cannot be updated incrementally",
    };
  }
  const count = plan.needFetch.length;
  if (count === 0) {
    return { run: false, nothingToDo: true, reason: "nothing changed" };
  }
  if (count > maxAutoFetch) {
    return {
      run: false,
      tooMany: true,
      count,
      reason: `${count} presentations changed, which is more than Refrain will reindex without being asked`,
    };
  }
  return { run: true, count, reason: `${count} presentation${count === 1 ? "" : "s"} changed` };
}

/**
 * Starts watching, and returns { status(), stop() }.
 *
 * `deps` is everything this touches, so it can be driven by a test:
 *   dirs()            -> library folders to watch
 *   plan()            -> planReindex(...)
 *   reindex()         -> rebuildIndex(..., {incremental:true})
 *   rebuildInProgress()
 *   readyForMs()      -> ms ProPresenter has been answering, or null (may be async)
 *   crawlPlaylists()
 *   frozen()          -> true when performance mode is on (optional)
 */
export function startLibraryWatch(deps, options = {}) {
  const cfg = { ...WATCH_DEFAULTS, ...options };
  const watchers = [];
  let debounceTimer = null;
  let safetyTimer = null;
  let stopped = false;
  let checking = false;
  let last = { at: null, outcome: "not run yet", count: 0, pending: null };

  async function check(trigger) {
    if (stopped || checking) return;
    // Performance mode is checked before anything else, and before any API
    // call: the promise is that Refrain goes completely quiet, not that it
    // looks around and then decides to behave.
    if (deps.frozen?.()) {
      last = { at: new Date().toISOString(), outcome: "performance mode is on", count: 0, pending: null, trigger };
      return;
    }
    checking = true;
    try {
      let plan = null;
      try {
        plan = await deps.plan();
      } catch (err) {
        last = { at: new Date().toISOString(), outcome: `could not check: ${err.message}`, count: 0, pending: null };
        return;
      }
      const decision = decideAutoReindex({
        plan,
        crawlPlaylists: deps.crawlPlaylists(),
        rebuildInProgress: deps.rebuildInProgress(),
        readyForMs: await deps.readyForMs(),
        maxAutoFetch: cfg.maxAutoFetch,
        settleAfterReadyMs: cfg.settleAfterReadyMs,
      });

      if (!decision.run) {
        last = {
          at: new Date().toISOString(),
          outcome: decision.reason,
          count: decision.count ?? 0,
          // Surfaced on the Health screen: work Refrain deliberately did not do
          // is only a good decision if the operator can see it waiting.
          pending:
            decision.tooMany || decision.needsFullRebuild
              ? { count: decision.count ?? null, needsFullRebuild: Boolean(decision.needsFullRebuild), reason: decision.reason }
              : null,
          trigger,
        };
        return;
      }

      try {
        const index = await deps.reindex();
        last = {
          at: new Date().toISOString(),
          outcome: `reindexed ${decision.count} presentation${decision.count === 1 ? "" : "s"}`,
          count: decision.count,
          pending: null,
          trigger,
          durationMs: index?.buildDurationMs ?? null,
        };
      } catch (err) {
        last = { at: new Date().toISOString(), outcome: `reindex failed: ${err.message}`, count: 0, pending: null, trigger };
      }
    } finally {
      checking = false;
    }
  }

  function nudge(trigger) {
    if (stopped) return;
    clearTimeout(debounceTimer);
    // ProPresenter writes a presentation in bursts, and a volunteer editing a
    // set saves several in a row. Wait for quiet rather than reindexing per
    // keystroke-sized event.
    debounceTimer = setTimeout(() => check(trigger), cfg.debounceMs);
    debounceTimer.unref?.();
  }

  for (const dir of deps.dirs()) {
    try {
      const w = watch(dir, { persistent: false }, (_event, filename) => {
        if (!filename || !String(filename).endsWith(".pro")) return;
        nudge("file change");
      });
      w.on("error", () => {
        /* a folder going away is the safety net's problem, not a crash */
      });
      watchers.push(w);
    } catch {
      // Unwatchable folder (permissions, network volume). The safety-net poll
      // still covers it, so this is not worth failing startup over.
    }
  }

  safetyTimer = setInterval(() => check("safety net"), cfg.safetyNetMs);
  safetyTimer.unref?.();

  return {
    status: () => ({ watching: watchers.length, ...last }),
    checkNow: (trigger = "manual") => check(trigger),
    stop: () => {
      stopped = true;
      clearTimeout(debounceTimer);
      clearInterval(safetyTimer);
      for (const w of watchers) w.close();
      watchers.length = 0;
    },
  };
}

/**
 * How stale a full rebuild is allowed to get before Refrain mentions it.
 *
 * Fingerprinting catches anything that changes a presentation file, which is
 * almost everything — but not quite. Playlist membership is not in those files,
 * failed reads carry the previous index's slides forward indefinitely, and a
 * ProPresenter upgrade can change how a document is interpreted without
 * touching it. A full read once a quarter resettles all of that.
 *
 * A suggestion only. It never starts one: that decision belongs to whoever
 * knows what is happening in the building for the next hour.
 */
export const FULL_REBUILD_SUGGEST_DAYS = 90;

export function fullRebuildSuggestion(daysSince, threshold = FULL_REBUILD_SUGGEST_DAYS) {
  if (daysSince == null || daysSince < threshold) return null;
  return {
    daysSince,
    message:
      `The whole library was last read ${daysSince} days ago. Reindexing keeps up with edited ` +
      `presentations, but a full rebuild also resettles playlist membership and anything a ` +
      `ProPresenter upgrade changed. Worth running once you have a quiet hour.`,
  };
}
