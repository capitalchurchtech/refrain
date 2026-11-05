/**
 * Keeps Refrain.app current after an update.
 *
 * The app is compiled on each Mac from `mac/` (owner, 2026-11-04: no
 * Developer ID, each Mac builds its own), so a `git pull` that changes `mac/`
 * leaves the installed app on the old build until something reruns
 * `scripts/build-mac-app.command`. This reruns it when the app is stale, and
 * only on a Mac that already has the app: a Mac that never built it isn't
 * given one.
 *
 * Stale is judged from the commit the build script stamps into the app's
 * Info.plist, not from what this one pull changed. A pull whose npm install
 * failed, a build that failed, or a `git pull` typed by hand would otherwise
 * leave the app old with nothing ever noticing; this way the next update
 * catches it. An app with no stamp predates it and is rebuilt once.
 *
 * Never fails the update. The server and every screen are already updated by
 * the time this runs, and an old Refrain.app still shows them; a build that
 * fails comes back as a note saying to run the script by hand.
 *
 * Both Update now (`/api/update`) and `scripts/update.command` call this.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

/** What Refrain.app is built from, as git pathspecs. */
export const MAC_APP_SOURCES = ["mac", "scripts/build-mac-app.command"];

/** Where build-mac-app.command installs the app. */
export const INSTALLED_MAC_APP = join(homedir(), "Applications", "Refrain.app");

/**
 * Rebuilds Refrain.app if HEAD changed what it's built from since it was
 * built. Returns null when nothing was built, else `{ rebuilt, note, output }`.
 */
export async function rebuildMacAppIfStale({ platform = process.platform, appPath = INSTALLED_MAC_APP, run = promisify(execFile) } = {}) {
  if (platform !== "darwin" || !existsSync(appPath)) return null;
  const builtFrom = await run("/usr/bin/plutil", ["-extract", "RefrainSourceCommit", "raw", "-o", "-", join(appPath, "Contents", "Info.plist")], { timeout: 10000 }).then(
    (r) => r.stdout.trim(),
    () => "",
  );
  if (builtFrom) {
    // Exit 0 means no difference. 1 (changed) and anything else (a commit
    // this clone doesn't have) both rebuild: an app of unknown age is stale.
    const current = await run("git", ["diff", "--quiet", builtFrom, "HEAD", "--", ...MAC_APP_SOURCES], { timeout: 30000 }).then(
      () => true,
      () => false,
    );
    if (current) return null;
  }
  try {
    const { stdout } = await run("/bin/bash", ["scripts/build-mac-app.command"], { timeout: 600000 });
    return { rebuilt: true, note: "Refrain.app was rebuilt for this update. If it's open, quit it and open it again.", output: stdout.trim() };
  } catch (err) {
    return {
      rebuilt: false,
      note: "Refrain.app couldn't be rebuilt, so it still has the old build. Double-click scripts/build-mac-app.command to build it.",
      output: [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").trim(),
    };
  }
}

// `node server/mac-app.js`, from scripts/update.command.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await rebuildMacAppIfStale();
  if (result) console.log(`${result.output}\n\n${result.note}`);
}
