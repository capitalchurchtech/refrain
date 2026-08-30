/**
 * Non-blocking failure notices, for the live path.
 *
 * These replace `alert()`. A native alert is a modal: it freezes the entire
 * tool until it is dismissed, and it does that at the exact moment a trigger
 * has just failed and the operator needs to press again. So the failure
 * handling made the failure worse, in front of a room, on a clock. Worse, the
 * dismiss target is a small OS button in an unpredictable place rather than the
 * control they were already aiming at.
 *
 * What replaces it has to satisfy three things the alert did not:
 *
 *   1. Never take the keyboard or block a retry. The operator can press Go Live
 *      again immediately, without dismissing anything.
 *   2. Never move the layout. A notice that pushes results down relocates the
 *      button they were about to press, which under pressure is its own hazard.
 *      So it overlays rather than inserting.
 *   3. Announce itself to a screen reader, since a silent failure is worse than
 *      a loud one. `role="alert"` is deliberate over a polite live region: a
 *      trigger that did not fire is not something to mention when convenient.
 *
 * It reports a fault, so it takes the fault vocabulary rather than an emitter --
 * failures do not glow, and the emitter budget is spent. It fades on its own,
 * because a stale error from four songs ago is noise, and it can be dismissed
 * immediately by the operator who has already read it.
 */

const VISIBLE_MS = 8000;

let host = null;
let timer = null;

function ensureHost() {
  if (host && document.body.contains(host)) return host;
  host = document.createElement("div");
  host.id = "rf-notices";
  document.body.appendChild(host);
  return host;
}

/**
 * Shows a failure without blocking anything.
 *
 * `text` is cold-zone copy: what happened, then what to do. It is shown as
 * given, so callers own their own wording rather than this assembling a
 * sentence out of fragments.
 */
export function showFailure(text) {
  const el = ensureHost();
  // One notice at a time. Two stacked failures during a service is a wall to
  // read, and the most recent is the one that matters.
  el.innerHTML = "";
  clearTimeout(timer);

  const note = document.createElement("div");
  note.className = "rf-notice";
  note.setAttribute("role", "alert");

  const body = document.createElement("span");
  body.className = "rf-notice-text";
  body.textContent = text;

  const close = document.createElement("button");
  close.className = "rf-notice-close";
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  close.addEventListener("click", () => dismissFailure());

  note.append(body, close);
  el.appendChild(note);
  timer = setTimeout(dismissFailure, VISIBLE_MS);
}

export function dismissFailure() {
  clearTimeout(timer);
  if (host) host.innerHTML = "";
}
