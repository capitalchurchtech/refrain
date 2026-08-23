import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCrashReport,
  findOrphanedHelpers,
  findDanglingLibraryRefs,
  deriveSupportRoot,
  formatBytes,
  buildFindings,
} from "../server/propresenter-doctor.js";

// --- crash report signature ---

function ips({ type = "EXC_BREAKPOINT", signal = "SIGTRAP", combine = true, debounce = true } = {}) {
  const frames = [
    { imageIndex: 0 },
    ...(combine ? [{ imageIndex: 1, symbol: debounce ? "closure #1 in Publishers.Debounce.Inner.receive(_:)" : "Subscribers.Sink.receive(_:)" }] : []),
  ];
  return `{"header":1}\n${JSON.stringify({
    app_version: "21.3",
    os_version: "macOS 26.5.2",
    exception: { type, signal },
    usedImages: [{ name: "ProPresenter" }, { name: "Combine" }],
    threads: [{ triggered: true, queue: "com.apple.main-thread", frames }],
  })}`;
}

test("parseCrashReport recognises the known bootstrap signature", () => {
  const r = parseCrashReport("a.ips", ips());
  assert.equal(r.parsed, true);
  assert.equal(r.exception, "EXC_BREAKPOINT");
  assert.equal(r.matchesBootstrapSignature, true);
});

test("parseCrashReport does not match a different crash", () => {
  assert.equal(parseCrashReport("b.ips", ips({ type: "EXC_BAD_ACCESS" })).matchesBootstrapSignature, false);
  assert.equal(parseCrashReport("c.ips", ips({ combine: false })).matchesBootstrapSignature, false);
  assert.equal(parseCrashReport("d.ips", ips({ debounce: false })).matchesBootstrapSignature, false);
});

test("parseCrashReport survives an unreadable report", () => {
  assert.equal(parseCrashReport("e.ips", "not json at all").parsed, false);
});

// --- orphaned helpers ---

const PS_ORPHANED = `
  9884     1 /Users/x/Library/Application Support/RenewedVision/ProPresenter/Helpers/Workspaces/ProPresenter Helper (Workspaces)
  9910  9884 ProPresenter Helper (Snapshots)
  1234  5678 /Applications/Safari.app/Contents/MacOS/Safari
`;
const PS_HEALTHY = `
  9868     1 /Applications/ProPresenter.app/Contents/MacOS/ProPresenter
  9884  9868 ProPresenter Helper (Workspaces)
`;

test("findOrphanedHelpers flags helpers left behind with no main app", () => {
  const r = findOrphanedHelpers(PS_ORPHANED);
  assert.equal(r.mainAppRunning, false);
  assert.deepEqual(r.orphaned.map((o) => o.pid), [9884, 9910], "a helper parented by an orphaned helper counts too");
});

test("findOrphanedHelpers reports nothing orphaned when the app is running", () => {
  const r = findOrphanedHelpers(PS_HEALTHY);
  assert.equal(r.mainAppRunning, true);
  assert.deepEqual(r.orphaned, []);
});

test("findOrphanedHelpers ignores unrelated processes", () => {
  assert.equal(findOrphanedHelpers("  1234  5678 /Applications/Safari.app/Contents/MacOS/Safari").rows.length, 0);
});

// --- dangling library references ---

test("findDanglingLibraryRefs decodes percent-encoded names before comparing", () => {
  // The index holds file:// URLs, so spaces arrive as %20. Without decoding,
  // every library with a space in its name reads as missing.
  const index = 'file:///x/Libraries/One%20Accord/a.pro Libraries/Songs/b.pro';
  assert.deepEqual(findDanglingLibraryRefs(index, ["One Accord", "Songs"]), []);
});

test("findDanglingLibraryRefs reports a genuinely missing folder", () => {
  const index = "Libraries/Songs/a.pro Libraries/Gone%20Away/b.pro";
  assert.deepEqual(findDanglingLibraryRefs(index, ["Songs"]), ["Gone Away"]);
});

test("findDanglingLibraryRefs never reports the index file itself", () => {
  assert.deepEqual(findDanglingLibraryRefs("Libraries/LibraryData/", []), []);
});

// --- path derivation ---

test("deriveSupportRoot prefers real evidence over the fallback path", () => {
  assert.equal(deriveSupportRoot({ cachedRoot: "/cached/ProPresenter" }), "/cached/ProPresenter");
  assert.equal(
    deriveSupportRoot({ helperPath: "/Users/x/Library/Application Support/RenewedVision/ProPresenter/Helpers/Workspaces/H" }),
    "/Users/x/Library/Application Support/RenewedVision/ProPresenter"
  );
  assert.equal(
    deriveSupportRoot({ presentationPath: "/Users/y/Library/Application Support/RenewedVision/ProPresenter/UserWorkspaces/ProPresenter/Libraries/Songs/a.pro" }),
    "/Users/y/Library/Application Support/RenewedVision/ProPresenter"
  );
  assert.match(deriveSupportRoot({ home: "/Users/z" }), /^\/Users\/z\/Library/);
});

test("formatBytes is readable", () => {
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(-1), "unknown");
});

// --- findings assembly ---

test("buildFindings surfaces a copyable prompt on every actionable problem", () => {
  const findings = buildFindings({
    connected: false,
    host: "localhost",
    port: 56563,
    isLocalHost: true,
    processes: { available: true, ...findOrphanedHelpers(PS_ORPHANED) },
    workspaceState: { available: true, workspaces: [{ name: "W-1", dir: "/w/W-1", database: { exists: true, bytes: 5e6, modified: new Date().toISOString() }, thumbnails: { exists: true } }] },
    crashReports: { available: true, reports: [parseCrashReport("z.ips", ips())] },
    libraryConsistency: { available: true, folders: ["Songs"], dangling: ["Gone"] },
  });
  const problems = findings.filter((f) => f.severity === "problem");
  assert.ok(problems.length >= 3, "connection, orphaned helpers and crash signature");
  for (const f of problems) assert.ok(f.prompt?.length > 40, `${f.id} needs a prompt to hand off`);
  assert.equal(findings[0].severity, "problem", "worst finding sorts first");
  assert.ok(findings.find((f) => f.id === "crash-signature"));
});

test("buildFindings refuses to draw local conclusions about a remote machine", () => {
  const findings = buildFindings({
    connected: false, host: "10.0.0.9", port: 1025, isLocalHost: false,
    processes: { available: false }, workspaceState: { available: false, workspaces: [] },
    crashReports: { available: false, reports: [] }, libraryConsistency: { available: false, folders: [], dangling: [] },
  });
  assert.ok(findings.find((f) => f.id === "remote"), "must say the local checks do not apply");
  assert.equal(findings.find((f) => f.id === "orphaned-helpers"), undefined);
});
