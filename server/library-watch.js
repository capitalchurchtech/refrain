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
 *   held()            -> a sentence when a scheduled service is starting or running, else null (optional)
 */
export function startLibraryWatch(deps, options = {}) {
  const cfg = { ...WATCH_DEFAULTS, ...options };
  const watchers = [];
  let debounceTimer = null;
  let safetyTimer = null;
  let stopped = false;
  let checking = false;
  let last = { at: null, outcome: "not run yet", count: 0, pending: null, unreadChanges: false };
  // A .pro file changed and no check has read it yet. Fed by the fs.watch
  // handler, which is a local event costing nothing, so this survives while
  // performance mode forbids the check that would act on it. That is the whole
  // point: during a service the operator gets told the index is behind rather
  // than getting an empty search with no explanation.
  //
  // A counter rather than a boolean, because a save can land *while* a reindex
  // is in flight. Clearing a boolean on completion would claim that save was
  // read when the plan predated it, and the next check is dropped outright if
  // one is still running -- so the miss would survive until the safety net, or
  // past the moment performance mode arms, which is exactly the silent failure
  // this exists to remove. Each check only ever marks off the events it
  // actually saw.
  let fileEventSeq = 0;
  let readEventSeq = 0;
  const unreadFileEvent = () => fileEventSeq > readEventSeq;

  async function check(trigger) {
    if (stopped || checking) return;
    // Performance mode is checked before anything else, and before any API
    // call: the promise is that Refrain goes completely quiet, not that it
    // looks around and then decides to behave.
    // `held` is the other reason to stay quiet (owner, 2026-10-11): a scheduled
    // service is starting or running, so nothing reindexes from its lead time
    // on, before performance mode has had anything to arm on. It says why in
    // words, or null.
    const frozen = Boolean(deps.frozen?.());
    const holdReason = frozen ? "performance mode is on" : (deps.held?.() ?? null);
    if (holdReason) {
      last = {
        at: new Date().toISOString(),
        outcome: holdReason,
        count: 0,
        // `pending` belongs to the last real check and is rendered on Health as
        // a count or a full-rebuild warning. Performance mode did not resolve
        // it, so carry it forward untouched -- overwriting it here printed
        // "undefined presentations have changed" and swallowed the
        // full-rebuild warning, which matters most during a Library Sync run
        // (ProPresenter closed, so performance mode is armed, hundreds of
        // files landing).
        pending: last.pending,
        // Its own field, because this is a different fact with a different
        // shape: not a count -- counting means planning, and planning is an
        // API call we promised not to make -- only that something changed and
        // nobody has read it.
        unreadChanges: unreadFileEvent(),
        trigger,
      };
      return;
    }
    checking = true;
    try {
      // Everything this check can possibly account for. Events arriving after
      // this line belong to the next one.
      const seenSeq = fileEventSeq;
      let plan = null;
      try {
        plan = await deps.plan();
      } catch (err) {
        last = { at: new Date().toISOString(), outcome: `could not check: ${err.message}`, count: 0, pending: null, unreadChanges: unreadFileEvent() };
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

      // Read and found nothing outstanding: whatever those file events were,
      // they did not change a presentation. Anything else (not answering, too
      // many, needs a full rebuild) leaves them unread and still worth saying.
      if (decision.nothingToDo) readEventSeq = seenSeq;

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
          unreadChanges: unreadFileEvent(),
          trigger,
        };
        return;
      }

      try {
        const index = await deps.reindex();
        // Only what this run planned for. A save that landed while it was
        // running is still unread.
        readEventSeq = seenSeq;
        last = {
          at: new Date().toISOString(),
          outcome: `reindexed ${decision.count} presentation${decision.count === 1 ? "" : "s"}`,
          count: decision.count,
          pending: null,
          unreadChanges: unreadFileEvent(),
          trigger,
          durationMs: index?.buildDurationMs ?? null,
        };
      } catch (err) {
        last = { at: new Date().toISOString(), outcome: `reindex failed: ${err.message}`, count: 0, pending: null, unreadChanges: unreadFileEvent(), trigger };
      }
    } finally {
      checking = false;
    }
  }

  function nudge(trigger) {
    if (stopped) return;
    fileEventSeq += 1;
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

/**
 * How long an index can go untouched before it should say so.
 *
 * Two days, and the reasoning is about when a church actually edits. The
 * watcher reindexes within seconds of a presentation being saved -- but only
 * while Refrain is running, and on most machines it is not. Songs get edited
 * midweek with the app closed, so a Sunday morning index can be four days
 * behind with nothing having gone wrong.
 *
 * That is the silent failure: a stale index renders identically to a fresh one,
 * search quietly misses anything edited since, and the operator has no way to
 * know. Two days spans a normal gap between touching the app without reaching
 * back past the previous weekend.
 */
export const INDEX_STALE_DAYS = 2;

/**
 * Whether the index is old enough to mention, and what to say about it.
 *
 * Returns null below the threshold rather than a "fresh" object, so the caller
 * renders nothing at all rather than an all-clear. A reassurance the operator
 * did not ask for is noise on the screen they use under pressure, and it is the
 * same reasoning that keeps nominal from being a colour anywhere else.
 *
 * Deliberately age rather than a real freshness check. Knowing whether the
 * library has actually changed means reading every file, which is the expensive
 * thing this exists to avoid doing on every page load. Age is honest about what
 * it measures: nobody has looked recently.
 */
export function indexStaleness(builtAt, now = Date.now(), thresholdDays = INDEX_STALE_DAYS) {
  const t = builtAt ? new Date(builtAt).getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now - t) / 86_400_000);
  if (days < thresholdDays) return null;
  return {
    days,
    // Cold zone: what is true, then the one action. "Refresh" rather than
    // "Reindex changed only" because the button beside it is the remedy and
    // the operator does not need the mechanism named twice.
    message: `Index is ${days} ${days === 1 ? "day" : "days"} old. Refresh.`,
  };
}
