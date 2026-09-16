import { showFailure } from "./notice.js";

/**
 * "There's a newer Refrain. Update?" — once, on load, dismissible.
 *
 * The nav dot says an update exists; this asks. The difference matters: a dot
 * is noticed eventually by someone who already knows what it means, and an
 * update that needs a volunteer to go looking is an update that does not
 * happen. One press does the whole thing.
 *
 * Three guards, and the first is the one that matters:
 *
 * 1. **Never while anything is live.** Performance mode armed means something
 *    is on the screens, and a prompt asking an operator to make a decision
 *    about software maintenance mid-service is the worst version of this
 *    feature. It waits. This is also why it is a callout in the page rather
 *    than a modal: it takes no focus and blocks no keystroke even if the
 *    service starts while it is sitting there.
 * 2. **Dismissed stays dismissed, per version.** "Not now" means not for this
 *    version, not "never again" -- the next release asks once more, which is
 *    the whole point. Stored per version rather than as a flag for that reason.
 * 3. **Git installs only.** A ZIP copy cannot update itself, and offering a
 *    button that can only fail is worse than offering nothing; Health already
 *    explains the ZIP route.
 */

const DISMISSED_KEY = "refrain.updateNudgeDismissed";

function dismissedVersion() {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    // Private windows and locked-down profiles throw rather than return null.
    // Not being able to remember a dismissal is not a reason to fail loudly.
    return null;
  }
}

function rememberDismissal(version) {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // Then it asks again next load. Mildly annoying beats broken.
  }
}

export function initUpdateNudge() {
  const wrap = document.getElementById("update-nudge");
  const text = document.getElementById("update-nudge-text");
  const go = document.getElementById("update-nudge-go");
  const dismiss = document.getElementById("update-nudge-dismiss");
  const status = document.getElementById("update-nudge-status");
  if (!wrap || !text || !go || !dismiss) return;

  let latest = null;

  dismiss.addEventListener("click", () => {
    if (latest) rememberDismissal(latest);
    wrap.classList.add("hidden");
  });

  go.addEventListener("click", async () => {
    go.disabled = true;
    dismiss.disabled = true;
    // The pull and npm install take tens of seconds on a slow connection, and
    // a button that goes quiet for that long reads as broken.
    if (status) status.textContent = "Updating — this takes a moment...";
    try {
      const res = await fetch("/api/update", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      // Deliberately not offering to restart it: the server cannot restart
      // itself without dropping the very request that asked, and a volunteer
      // closing and reopening the window is a step they already know.
      text.textContent = `Updated to v${latest}. Quit Refrain and start it again to finish — your settings and index are untouched.`;
      go.classList.add("hidden");
      dismiss.textContent = "Close";
      dismiss.disabled = false;
      if (status) status.textContent = "";
      if (latest) rememberDismissal(latest);
    } catch (err) {
      go.disabled = false;
      dismiss.disabled = false;
      if (status) status.textContent = "";
      showFailure(`Couldn't update: ${err.message}. Nothing was changed — the Health screen has a command you can run by hand.`);
    }
  });

  (async () => {
    try {
      const [update, live] = await Promise.all([
        fetch("/api/version-check").then((r) => r.json()),
        fetch("/api/performance-mode").then((r) => r.json()).catch(() => ({ armed: false })),
      ]);
      if (!update.updateAvailable || !update.gitInstall) return;
      if (live.armed) return;
      if (dismissedVersion() === update.latestVersion) return;

      latest = update.latestVersion;
      text.textContent =
        `Refrain v${update.latestVersion} is out — you have v${update.currentVersion}. ` +
        `Updating takes about a minute and leaves your settings and index alone.`;
      wrap.classList.remove("hidden");
    } catch {
      // Offline, or GitHub is down. Say nothing.
    }
  })();
}
