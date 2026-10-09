/**
 * The indexing strip along the bottom of every screen (owner, 2026-10-04:
 * "there's no indication that indexing is even happening").
 *
 * Shown whenever a search index run is going, however it started: Rebuild,
 * Save and rebuild, the file watcher, the morning catch-up. A bar fills as
 * presentations are read, with a lit needle at its edge carrying the percent.
 * When the run ends it says how it ended for a few seconds, then goes. A press
 * that can't run says why here too. Stop is here as well, because the run it
 * stops is the one slowing ProPresenter down, wherever the operator is.
 *
 * It draws; index-run.js knows. Same state as Settings' Search index card.
 */

import { subscribeRun, requestStop } from "./index-run.js";
import { trackHtml, paintTrack } from "./index-card.js";

export function initIndexProgress() {
  const bar = document.createElement("div");
  bar.id = "index-progress";
  bar.className = "rf-index-bar";
  bar.hidden = true;
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.innerHTML = `
    <div class="rf-index-line">
      <span class="rf-index-word"></span>
      <span class="rf-index-text"></span>
      <button class="rf-index-stop" type="button" hidden>Stop</button>
    </div>
    ${trackHtml()}`;
  document.body.appendChild(bar);
  const word = bar.querySelector(".rf-index-word");
  const text = bar.querySelector(".rf-index-text");
  const stop = bar.querySelector(".rf-index-stop");
  const track = bar.querySelector(".rf-run-track");

  // Sits over the content column only, never over the menu.
  const place = () => {
    const main = document.getElementById("main-content");
    if (!main) return;
    const r = main.getBoundingClientRect();
    bar.style.left = `${Math.max(0, r.left)}px`;
    bar.style.width = `${r.width}px`;
  };
  window.addEventListener("resize", place);

  stop.addEventListener("click", async () => {
    const failed = await requestStop();
    if (failed) text.textContent = failed;
  });

  subscribeRun((s) => {
    const on = s.phase !== "idle";
    bar.hidden = !on;
    // Room under the content while the bar is up, so it covers nothing.
    document.body.toggleAttribute("data-index-bar", on);
    if (!on) return;
    bar.dataset.state = s.phase;
    // Said aloud when a run ends or can't start, not for every title read.
    bar.setAttribute("aria-live", s.phase === "running" || s.phase === "stopping" ? "off" : "polite");
    word.textContent = s.word;
    // Finished and waiting messages are sentences; a running one is the title being read.
    text.textContent = s.phase === "running" || s.phase === "stopping" ? s.short : s.sentence;
    stop.hidden = s.phase !== "running";
    paintTrack(track, s);
    place();
  });
}
