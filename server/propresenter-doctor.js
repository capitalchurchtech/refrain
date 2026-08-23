/**
 * First aid for "ProPresenter won't start".
 *
 * Refrain keeps running when ProPresenter doesn't, which makes it the only
 * thing on the machine able to explain why. Every check here is read-only and
 * local: it reports and hands over a command, it never kills a process, moves
 * a file, or launches an app. Deciding to act stays with the operator, because
 * the moment this screen matters is also the moment they are most stressed and
 * least able to absorb a surprise.
 *
 * Learned the hard way, and the reason several of these checks exist:
 *  - ProPresenter keeps workspace CONTENT in `UserWorkspaces/<name>/` and
 *    workspace STATE (a Database plus a Thumbnails cache) in a separate
 *    `Workspaces/<name>-<id>/` folder one level up. A corrupt Database there
 *    produces a "Bootstrap failure ... Connection timed out" modal whose text
 *    points nowhere near the actual fault.
 *  - The real fault shows up in the crash report as EXC_BREAKPOINT on the main
 *    thread through a Combine Debounce, not as any kind of timeout.
 *  - After a failed launch the helper processes survive as orphans, and until
 *    they are cleared every retry fails identically, which makes a recoverable
 *    problem look permanent.
 *  - Deleting a library folder outside the app leaves its entries behind in
 *    LibraryData, so that mismatch is worth surfacing before it bites.
 *
 * Nothing here reads file contents beyond crash-report metadata and the
 * library index's own path strings; no credentials are touched and nothing
 * leaves the machine.
 */
import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";

/** Severities, worst first, so a caller can sort or pick a headline. */
export const SEVERITY = { problem: 3, warn: 2, info: 1, ok: 0 };

/**
 * The crash signature seen when a workspace Database is corrupt: a Swift trap
 * on the main thread inside a debounced Combine pipeline during bootstrap.
 */
export function parseCrashReport(name, text) {
  // .ips files are a one-line JSON header followed by the real payload.
  let payload;
  try {
    const nl = text.indexOf("\n");
    payload = JSON.parse(nl === -1 ? text : text.slice(nl + 1));
  } catch {
    return { name, parsed: false };
  }
  const exception = payload.exception ?? {};
  const triggered = (payload.threads ?? []).find((t) => t.triggered) ?? {};
  const images = payload.usedImages ?? [];
  const frames = triggered.frames ?? [];
  const frameImage = (f) => images[f.imageIndex]?.name ?? "";
  const combineFrames = frames.filter((f) => frameImage(f) === "Combine").length;
  const debounce = frames.some((f) => String(f.symbol ?? "").includes("Debounce"));

  return {
    name,
    parsed: true,
    version: payload.app_version ?? null,
    osVersion: payload.os_version ?? null,
    exception: exception.type ?? null,
    signal: exception.signal ?? null,
    thread: triggered.name || triggered.queue || "main",
    frameCount: frames.length,
    combineFrames,
    // Both halves matter: the trap alone could be anything, and Combine alone
    // is unremarkable. Together they are the known bootstrap failure.
    matchesBootstrapSignature: exception.type === "EXC_BREAKPOINT" && combineFrames > 0 && debounce,
  };
}

/**
 * Helper processes still alive with the main app gone. `PPID 1` means launchd
 * adopted them after their parent died. Takes `ps -Ao pid,ppid,comm` output so
 * the logic is testable without spawning anything.
 */
export function findOrphanedHelpers(psOutput) {
  const rows = [];
  for (const line of String(psOutput ?? "").split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, comm] = m;
    if (!/propresenter/i.test(comm)) continue;
    rows.push({ pid: Number(pid), ppid: Number(ppid), comm: comm.trim() });
  }
  const isHelper = (r) => /helper/i.test(r.comm);
  const mainApp = rows.find((r) => !isHelper(r));
  // Orphaned only when nothing is parenting them: either PPID 1, or their
  // parent is another helper that is itself orphaned.
  const helpers = rows.filter(isHelper);
  const helperPids = new Set(helpers.map((h) => h.pid));
  const orphaned = mainApp
    ? []
    : helpers.filter((h) => h.ppid === 1 || helperPids.has(h.ppid));
  return { rows, mainAppRunning: Boolean(mainApp), helpers, orphaned };
}

/**
 * Library folders referenced by the index that no longer exist on disk.
 * `indexBytes` is LibraryData; we only pull path strings out of it.
 */
export function findDanglingLibraryRefs(indexBytes, existingFolders) {
  const text = Buffer.isBuffer(indexBytes) ? indexBytes.toString("latin1") : String(indexBytes ?? "");
  const referenced = new Set();
  for (const m of text.matchAll(/Libraries\/([^/\\"\n\r]{1,120})\//g)) {
    // The index stores both plain paths and file:// URLs, so a name can arrive
    // percent-encoded ("One%20Accord"). Decode before comparing, or every
    // library with a space in its name reads as missing — a false alarm that
    // would send someone hunting a problem they do not have.
    let name = m[1].trim();
    try {
      name = decodeURIComponent(name);
    } catch {
      /* leave a malformed escape as-is rather than dropping the entry */
    }
    if (name && name !== "LibraryData") referenced.add(name);
  }
  const have = new Set(existingFolders ?? []);
  return [...referenced].filter((n) => !have.has(n)).sort();
}

/** Bytes, humanised, for sizes shown next to a workspace. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * Derives the RenewedVision support root without hardcoding a vendor path as
 * the primary source. In order of preference: a path we cached while
 * ProPresenter was healthy, a running helper process's own executable path, a
 * presentation path from the API, and only then a known-location fallback.
 * The fallback exists because this screen's whole job is to work when the API
 * is down and there is nothing left to derive from.
 */
export function deriveSupportRoot({ cachedRoot = null, helperPath = null, presentationPath = null, home = null } = {}) {
  const fromMarker = (p) => {
    if (!p) return null;
    const i = String(p).indexOf("/ProPresenter/");
    return i === -1 ? null : String(p).slice(0, i + "/ProPresenter".length + 1).replace(/\/$/, "");
  };
  return (
    cachedRoot ||
    fromMarker(helperPath) ||
    fromMarker(presentationPath) ||
    (home ? path.join(home, "Library/Application Support/RenewedVision/ProPresenter") : null)
  );
}

/** Recursive byte size, capped so a huge thumbnail cache can't stall a page load. */
async function dirSize(dir, { maxEntries = 4000 } = {}) {
  let total = 0;
  let seen = 0;
  let truncated = false;
  const walk = async (d) => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (seen >= maxEntries) {
        truncated = true;
        return;
      }
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else {
        try {
          total += (await stat(full)).size;
          seen += 1;
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  };
  await walk(dir);
  return { bytes: total, truncated };
}

/** Workspace state folders, with the Database sized and Thumbnails only stamped. */
export async function readWorkspaceState(supportRoot) {
  const base = path.join(supportRoot, "Workspaces");
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return { base, available: false, workspaces: [] };
  }
  const workspaces = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(base, e.name);
    const dbDir = path.join(dir, "Database");
    const thumbsDir = path.join(dir, "Thumbnails");
    let db = null;
    let thumbs = null;
    try {
      const s = await stat(dbDir);
      // The Database is small (single-digit MB), so sizing it is cheap. The
      // Thumbnails cache can be tens of GB, so it is only stamped, never walked.
      const { bytes } = await dirSize(dbDir);
      db = { exists: true, bytes, modified: s.mtime.toISOString() };
    } catch {
      db = { exists: false };
    }
    try {
      const s = await stat(thumbsDir);
      thumbs = { exists: true, modified: s.mtime.toISOString() };
    } catch {
      thumbs = { exists: false };
    }
    workspaces.push({ name: e.name, dir, database: db, thumbnails: thumbs });
  }
  workspaces.sort((a, b) => (b.database?.modified ?? "").localeCompare(a.database?.modified ?? ""));
  return { base, available: true, workspaces };
}

/** Newest ProPresenter crash reports, parsed. */
export async function readCrashReports(home, { limit = 3 } = {}) {
  const dir = path.join(home, "Library/Logs/DiagnosticReports");
  let names;
  try {
    names = (await readdir(dir)).filter((n) => /^ProPresenter.*\.ips$/i.test(n)).sort().reverse();
  } catch {
    return { dir, available: false, reports: [] };
  }
  const reports = [];
  for (const name of names.slice(0, limit)) {
    try {
      reports.push(parseCrashReport(name, await readFile(path.join(dir, name), "utf-8")));
    } catch {
      reports.push({ name, parsed: false });
    }
  }
  return { dir, available: true, reports };
}

/** Library folders on disk plus any index entries pointing at missing ones. */
export async function readLibraryConsistency(supportRoot, workspaceContentDir) {
  const libraries = path.join(workspaceContentDir ?? path.join(supportRoot, "UserWorkspaces/ProPresenter"), "Libraries");
  let entries;
  try {
    entries = await readdir(libraries, { withFileTypes: true });
  } catch {
    return { available: false, folders: [], dangling: [] };
  }
  const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  let dangling = [];
  try {
    dangling = findDanglingLibraryRefs(await readFile(path.join(libraries, "LibraryData")), folders);
  } catch {
    /* no index yet is not a problem */
  }
  return { available: true, dir: libraries, folders, dangling };
}

/**
 * Turns raw observations into findings the operator can act on.
 *
 * Each finding carries three things beyond its explanation: a `command` they
 * can paste into Terminal, and a `prompt` they can paste into Claude Code to
 * hand the whole problem over with its context already filled in. The prompt
 * matters because the person hitting this at 9am Sunday is usually not the
 * person who can debug it, and retyping context is exactly what does not
 * happen under pressure.
 */
export function buildFindings({ connected, host, port, isLocalHost, processes, workspaceState, crashReports, libraryConsistency }) {
  const findings = [];
  const add = (f) => findings.push(f);

  // --- Connection, the thing they came here about -------------------------
  if (connected) {
    add({
      id: "connection",
      severity: "ok",
      title: "ProPresenter is answering",
      detail: `Connected at ${host}:${port}. Nothing here needs attention.`,
    });
  } else {
    add({
      id: "connection",
      severity: "problem",
      title: "ProPresenter is not answering",
      detail: `Nothing responded at ${host}:${port}. Either ProPresenter is not running, its Network API is switched off (Preferences, then Network), or it is failing to start. The checks below tell those apart.`,
      prompt:
        `ProPresenter is not answering Refrain at ${host}:${port}. ` +
        `Help me work out whether it is not running, has its Network API disabled, or is failing to launch. ` +
        `I am on the machine that runs ProPresenter. Please give me read-only diagnostic steps first.`,
    });
  }

  if (!isLocalHost) {
    add({
      id: "remote",
      severity: "info",
      title: "Refrain is pointed at another machine",
      detail: `Refrain is configured for ${host}, so the local checks below describe THIS computer, not the one running ProPresenter. To diagnose a launch failure, run Refrain on the affected machine.`,
    });
    return findings.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);
  }

  // --- Orphaned helpers: why retrying never works ------------------------
  if (processes?.available) {
    const { mainAppRunning, orphaned, helpers } = processes;
    if (orphaned.length) {
      const pids = orphaned.map((o) => o.pid).join(", ");
      add({
        id: "orphaned-helpers",
        severity: "problem",
        title: `${orphaned.length} leftover ProPresenter helper${orphaned.length === 1 ? "" : "s"} still running`,
        detail:
          `ProPresenter itself is not running, but its helper processes are (PID ${pids}). ` +
          `Until these are cleared, every launch attempt fails the same way, which makes a recoverable problem look permanent. Clearing them is safe: they hold no unsaved work and come back with the app.`,
        command: `pkill -f ProPresenter; sleep 2; pgrep -fl ProPresenter || echo "all clear"`,
        prompt:
          `ProPresenter will not launch on my Mac. Refrain found ${orphaned.length} orphaned ProPresenter helper process(es) ` +
          `(PID ${pids}) still running with the main app gone (reparented to launchd). ` +
          `Walk me through clearing them and relaunching safely, and tell me what to check if it still fails.`,
      });
    } else if (!mainAppRunning) {
      add({
        id: "not-running",
        severity: "info",
        title: "ProPresenter is not running",
        detail: "No ProPresenter processes at all, and no leftovers. If it will not start, the workspace and crash-report checks below are the ones to read.",
      });
    } else if (helpers.length) {
      add({
        id: "processes-ok",
        severity: "ok",
        title: "ProPresenter processes look normal",
        detail: `Main app running with ${helpers.length} helper${helpers.length === 1 ? "" : "s"}, nothing orphaned.`,
      });
    }
  }

  // --- Crash reports: what actually failed ------------------------------
  const known = (crashReports?.reports ?? []).filter((r) => r.matchesBootstrapSignature);
  const newest = (crashReports?.reports ?? [])[0];
  if (known.length) {
    const r = known[0];
    add({
      id: "crash-signature",
      severity: "problem",
      title: "Crash matches the known workspace-database failure",
      detail:
        `${r.name} shows ${r.exception} (${r.signal}) on the ${r.thread} thread through a Combine Debounce. ` +
        `That signature has been traced to a corrupt workspace Database, even though the on-screen message says "Connection timed out". ` +
        `The fix is to move that workspace's Database folder aside and let ProPresenter rebuild it; the Thumbnails cache stays put.`,
      command: `ls ~/Library/Application\\ Support/RenewedVision/ProPresenter/Workspaces/`,
      prompt:
        `ProPresenter ${r.version ?? "21.x"} shows "Bootstrap failure - Connection timed out" and will not open my existing workspace. ` +
        `The crash report ${r.name} shows ${r.exception} (${r.signal}) on the ${r.thread} thread with Combine Debounce frames, ` +
        `which matches a known corrupt workspace Database rather than any network problem. ` +
        `A new empty workspace opens fine. Walk me through backing up and moving the Database folder aside so ProPresenter rebuilds it, ` +
        `keeping the broken copy for a vendor ticket, and make every step reversible.`,
    });
  } else if (newest?.parsed) {
    add({
      id: "crash-other",
      severity: "warn",
      title: "A recent crash report does not match the known signature",
      detail: `${newest.name}: ${newest.exception ?? "unknown"} (${newest.signal ?? "?"}) on ${newest.thread}, ${newest.frameCount} frames. This is not the workspace-database failure, so treat it as a separate problem.`,
      prompt:
        `ProPresenter crashed and the report ${newest.name} shows ${newest.exception} (${newest.signal}) on the ${newest.thread} thread ` +
        `with ${newest.frameCount} frames. This does NOT match the known corrupt-workspace-database signature. ` +
        `Help me read this crash report and work out what to try next.`,
    });
  } else if (crashReports?.available) {
    add({ id: "crash-none", severity: "ok", title: "No recent ProPresenter crash reports", detail: "Nothing in the crash log, so a launch failure is probably not a crash." });
  }

  // --- Workspace state --------------------------------------------------
  if (workspaceState?.available && workspaceState.workspaces.length) {
    const lines = workspaceState.workspaces.map(
      (w) =>
        `${w.name} — Database ${w.database.exists ? formatBytes(w.database.bytes) : "missing"}${
          w.database.modified ? ` (written ${new Date(w.database.modified).toLocaleString()})` : ""
        }, Thumbnails ${w.thumbnails.exists ? "present" : "missing"}`
    );
    add({
      id: "workspace-state",
      severity: "info",
      title: `${workspaceState.workspaces.length} workspace state folder${workspaceState.workspaces.length === 1 ? "" : "s"}`,
      detail:
        `ProPresenter keeps workspace CONTENT in UserWorkspaces and workspace STATE here. A corrupt Database is what produces a bootstrap failure.\n` +
        lines.join("\n"),
      prompt:
        `ProPresenter will not open my workspace. Its workspace state folders are:\n` +
        workspaceState.workspaces.map((w) => `  ${w.dir}`).join("\n") +
        `\nHelp me identify which one is the active workspace, back it up, and move only its Database folder aside so ProPresenter rebuilds it. Keep every step reversible.`,
    });
  }

  // --- Library index consistency ---------------------------------------
  if (libraryConsistency?.available && libraryConsistency.dangling.length) {
    const names = libraryConsistency.dangling.join(", ");
    add({
      id: "dangling-libraries",
      severity: "warn",
      title: `${libraryConsistency.dangling.length} library folder${libraryConsistency.dangling.length === 1 ? "" : "s"} missing but still indexed`,
      detail:
        `The library index still lists ${names}, but there is no matching folder on disk. This happens when a library is deleted outside ProPresenter. ` +
        `Fix it by letting ProPresenter rewrite its index: open the app and delete that library from inside it, or put the folder back first if you want its contents.`,
      prompt:
        `My ProPresenter library index (LibraryData) still references library folder(s) that no longer exist on disk: ${names}. ` +
        `They were removed outside the app. Help me clean this up safely so the index matches the folders, without losing any presentations.`,
    });
  } else if (libraryConsistency?.available) {
    add({
      id: "libraries-ok",
      severity: "ok",
      title: "Library folders match the index",
      detail: `${libraryConsistency.folders.length} library folders on disk, none missing from the index.`,
    });
  }

  return findings.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);
}
