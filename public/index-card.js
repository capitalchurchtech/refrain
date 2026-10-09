/**
 * The index run, drawn: the progress bar with its lit needle, and the
 * Settings card built around it. State comes from index-run.js; nothing here
 * keeps any, so mounting a second copy or throwing this one away is free.
 *
 * Two surfaces share the bar so they cannot drift: the card on Settings (a
 * desk, any width) and the strip along the bottom of every other screen
 * (index-progress.js, glanced at). Titles are the church's own, so they go in
 * with textContent and are never restyled.
 */

import { subscribeRun, requestStop } from "./index-run.js";

/** The bar: a recessed groove, a fill with a travelling light, and the needle with the percent on it. */
export function trackHtml() {
  return `<div class="rf-run-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Index progress">
    <div class="rf-run-groove"><div class="rf-run-fill"></div></div>
    <div class="rf-run-head"><i class="rf-run-line"></i><span class="rf-run-tag"></span></div>
  </div>`;
}

/** Moves one bar to a state. The percent tag steps inboard at the ends so it stays inside the card. */
export function paintTrack(track, s) {
  const pct = Math.round(s.frac * 100);
  track.querySelector(".rf-run-fill").style.width = `${s.frac * 100}%`;
  const head = track.querySelector(".rf-run-head");
  head.style.left = `${s.frac * 100}%`;
  head.dataset.edge = s.frac < 0.07 ? "start" : s.frac > 0.93 ? "end" : "";
  track.querySelector(".rf-run-tag").textContent = s.pct;
  track.setAttribute("aria-valuenow", String(pct));
  track.setAttribute("aria-valuetext", s.total ? `${s.current} of ${s.total}` : s.sentence);
}

const CARD = `
  <div class="rf-run" data-phase="idle">
    <div class="rf-run-stages"></div>
    <div class="rf-run-top"><span class="rf-run-legend">Reading now</span><span class="rf-run-word"></span></div>
    <div class="rf-run-now"></div>
    <div class="rf-run-trail"></div>
    ${trackHtml()}
    <div class="rf-run-spark" aria-hidden="true"></div>
    <div class="rf-run-foot"><span class="rf-run-sentence"></span><span class="rf-run-actions"></span></div>
    <div class="rf-hint rf-run-hint"></div>
    <div class="rf-hint rf-run-warm" hidden>Reading every slide you own. Go coil something.</div>
    <div class="alert alert-warning py-2 text-sm mt-2 items-start rf-run-warn" hidden>
      <i data-lucide="alert-triangle" class="w-4 h-4 shrink-0 mt-0.5"></i>
      <span><strong>A rebuild is running, so ProPresenter will be sluggish until it finishes.</strong>
      Keep ProPresenter open, or the build stops. Nothing goes to the screens, but Go Live, Clear
      and macros may be slow or not respond. Stop it if a service is about to start: what's already
      read is kept. After a big run, restart ProPresenter before the service.</span>
    </div>
  </div>`;

/**
 * Draws the run into `host` and keeps it current. `rim` is the element that
 * carries the turning outline (it is lit from the same state). Returns a
 * function that stops listening.
 */
export function mountRunCard(host, rim = null) {
  host.innerHTML = CARD;
  if (window.lucide) window.lucide.createIcons();
  const root = host.querySelector(".rf-run");
  const q = (sel) => root.querySelector(sel);
  const stagesEl = q(".rf-run-stages");
  const trail = q(".rf-run-trail");
  const spark = q(".rf-run-spark");
  const actions = q(".rf-run-actions");
  const hint = q(".rf-run-hint");
  let stagesKey = "";
  let actionsKey = null;

  actions.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-run-stop]")) return;
    hint.textContent = "";
    const failed = await requestStop();
    if (failed) hint.textContent = failed;
  });

  const unsubscribe = subscribeRun((s) => {
    const idle = s.phase === "idle";
    host.hidden = idle;
    root.dataset.phase = s.phase;
    if (rim) rim.dataset.phase = s.phase;
    if (idle) return;

    q(".rf-run-word").textContent = s.word;
    q(".rf-run-now").textContent = s.reading;
    q(".rf-run-sentence").textContent = s.sentence;
    paintTrack(q(".rf-run-track"), s);

    // The stage bars only redraw when what they show changes, so the active
    // one's lit edge is not rebuilt (and its animation restarted) every second.
    const key = JSON.stringify(s.stages.map((t) => [t.state, Math.round(t.frac * 200)]));
    if (key !== stagesKey) {
      stagesKey = key;
      stagesEl.replaceChildren(
        ...s.stages.map((t) => {
          const cell = document.createElement("div");
          cell.className = `rf-run-stage ${t.state}`;
          const groove = document.createElement("div");
          groove.className = "rf-run-groove";
          const fill = document.createElement("div");
          fill.className = "rf-run-fill";
          fill.style.width = `${t.frac * 100}%`;
          groove.append(fill);
          const label = document.createElement("span");
          label.className = "rf-run-legend";
          label.textContent = t.label;
          cell.append(groove, label);
          return cell;
        })
      );
    }

    trail.replaceChildren(
      ...s.trail.map((name) => {
        const row = document.createElement("div");
        row.textContent = name;
        return row;
      })
    );

    const top = Math.max(1, ...s.hist);
    spark.replaceChildren(
      ...s.hist.map((v) => {
        const bar = document.createElement("i");
        bar.style.height = `${Math.max(8, Math.round((v / top) * 100))}%`;
        return bar;
      })
    );

    const running = s.phase === "running" || s.phase === "stopping";
    q(".rf-run-warn").hidden = !running;
    q(".rf-run-warm").hidden = !running;
    // Only when the phase changes: a button rebuilt every poll swallows a click
    // that lands between two polls and drops keyboard focus.
    if (s.phase !== actionsKey) {
      actionsKey = s.phase;
      actions.innerHTML =
        s.phase === "running"
          ? `<button class="btn btn-brand btn-sm" data-run-stop>Stop indexing</button>`
          : s.phase === "stopping"
            ? `<button class="btn btn-brand btn-sm" disabled>Stopping</button>`
            : "";
    }
  });

  return () => {
    unsubscribe();
    if (rim) delete rim.dataset.phase;
  };
}
