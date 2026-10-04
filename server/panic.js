/**
 * The kill switch (GitHub issue #15): what the stopped page tells the
 * operator to run to bring Refrain back. Pure, so it's testable; index.js
 * owns the route and the exit.
 *
 * Exit code 0 matters: the LaunchAgent's KeepAlive is `SuccessfulExit:
 * false`, so a clean exit stays down and only a crash is restarted. A kill
 * that came back by itself ten seconds later would be worse than no kill.
 */

/**
 * The one command that starts Refrain again: the login item when there is
 * one (it stays loaded after a clean exit, so kickstart starts it), else the
 * install folder by hand.
 */
export function restartCommand({ launchAgent, label, installDir }) {
  if (launchAgent) return `launchctl kickstart gui/$(id -u)/${label}`;
  return `cd "${installDir}" && npm start`;
}

/**
 * Whether the login item is what runs this copy: its plist names this folder
 * as the working directory. A second copy run by hand from another folder (a
 * developer's checkout) has a plist on the Mac that isn't its own.
 */
export function runByLoginItem(plistText, cwd) {
  const m = String(plistText ?? "").match(/<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/);
  return Boolean(m) && m[1].replace(/\/+$/, "") === String(cwd ?? "").replace(/\/+$/, "");
}

/** The request is a deliberate kill only with `{ confirm: true }`. */
export function isConfirmedKill(body) {
  return body?.confirm === true;
}
