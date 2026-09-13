/**
 * Run Refrain in the background, starting at login (macOS only).
 *
 * The friction this removes is real: without it the operator keeps a Terminal
 * window open for the whole service, and closing that window kills Refrain --
 * which the boot banner has to warn about in as many words. A launchd
 * LaunchAgent runs the same Node process with no window, restarts it if it
 * dies, and brings it back at the next login.
 *
 * A LaunchAgent and not a bundled desktop app: the agent lives in the
 * operator's own ~/Library/LaunchAgents, needs no administrator password, is a
 * plain text file anyone can read, and is removed by deleting it. Shipping a
 * second copy of Chromium to solve "no Terminal window" would cost a few
 * hundred MB of RAM on the machine that is also driving the service.
 *
 * Scripts already did this by double-click. This module is the same work
 * behind a button, and it is the better path for one specific reason: Node is
 * already running here, so `process.execPath` is the exact interpreter to
 * write into the plist. The shell scripts have to go hunting for it.
 */

import { writeFile, rename, unlink, readFile, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir, platform } from "node:os";

const run = promisify(execFile);

export const LABEL = "com.refrain.server";

export function isSupported() {
  return platform() === "darwin";
}

export function plistPath(home = homedir()) {
  return join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
}

/** XML text nodes, so a path with an ampersand cannot break the document. */
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The plist text.
 *
 * `KeepAlive` is deliberately `{ SuccessfulExit: false }` rather than `true`.
 * With plain `true`, launchd restarts the job whatever happened -- and the
 * likeliest thing to happen, the moment this becomes a button, is that the
 * operator enables it while Refrain is already running in a Terminal window.
 * The new copy cannot bind the port, dies, and launchd restarts it forever.
 * Refrain now exits 0 in that case (see the listen handler in index.js), and
 * this tells launchd that a clean exit means "stood down on purpose, leave it
 * alone". A crash still restarts, which is the reason to want KeepAlive.
 *
 * Every path is absolute because launchd expands neither `~` nor environment
 * variables, and WorkingDirectory is the app folder because Refrain reads
 * config.json and writes its cache relative to it.
 */
export function buildPlist({ nodePath, appDir, port, logDir }) {
  const args = [nodePath, join(appDir, "server", "index.js")]
    .map((a) => `    <string>${xmlEscape(a)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(appDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(`${nodePath.replace(/\/node$/, "")}:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>
    <key>PORT</key>
    <string>${xmlEscape(port)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(join(logDir, "refrain.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(join(logDir, "refrain.err.log"))}</string>
</dict>
</plist>
`;
}

/**
 * `launchctl list <label>` exits non-zero when the job is not loaded, which is
 * the "not running" answer rather than a failure to report.
 */
export async function isLoaded() {
  if (!isSupported()) return false;
  try {
    await run("launchctl", ["list", LABEL]);
    return true;
  } catch {
    return false;
  }
}

export async function status(home = homedir()) {
  const path = plistPath(home);
  if (!isSupported()) {
    return { supported: false, installed: false, loaded: false, plistPath: path };
  }
  let installed = false;
  try {
    await access(path);
    installed = true;
  } catch {
    installed = false;
  }
  return { supported: true, installed, loaded: await isLoaded(), plistPath: path };
}

/**
 * Writes the plist through a temp file and a rename, the way saveConfig does.
 * A half-written plist is not a corrupt preference the operator can re-enter --
 * it is a launchd job that fails to parse at every login.
 */
export async function install({ appDir, port, home = homedir(), nodePath = process.execPath }) {
  if (!isSupported()) throw new Error("Starting at login is a macOS feature.");
  const logDir = join(appDir, "logs");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(home, "Library", "LaunchAgents"), { recursive: true });
  await mkdir(logDir, { recursive: true });

  const path = plistPath(home);
  const temp = `${path}.tmp`;
  await writeFile(temp, buildPlist({ nodePath, appDir, port: String(port), logDir }), "utf-8");
  try {
    await run("plutil", ["-lint", temp]);
  } catch (err) {
    await unlink(temp).catch(() => {});
    throw new Error(`Wrote an invalid LaunchAgent, so nothing was installed: ${err.message}`);
  }
  await rename(temp, path);

  // Reload cleanly whether or not an older version was already loaded.
  await run("launchctl", ["unload", path]).catch(() => {});
  await run("launchctl", ["load", "-w", path]);
  return status(home);
}

export async function uninstall({ home = homedir() } = {}) {
  if (!isSupported()) throw new Error("Starting at login is a macOS feature.");
  const path = plistPath(home);
  await run("launchctl", ["unload", "-w", path]).catch(() => {});
  await unlink(path).catch(() => {});
  return status(home);
}

/** Only for the Health screen's "where are the logs" line. */
export async function lastLogLines(appDir, lines = 5) {
  try {
    const text = await readFile(join(appDir, "logs", "refrain.err.log"), "utf-8");
    return text.trim().split("\n").slice(-lines);
  } catch {
    return [];
  }
}
