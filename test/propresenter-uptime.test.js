import test from "node:test";
import assert from "node:assert/strict";
import { parsePsEtime, propresenterUptimeSeconds } from "../server/propresenter-doctor.js";

// BSD ps on macOS has no `etimes`, so elapsed time only arrives as a string.
test("parsePsEtime handles every shape ps produces", () => {
  assert.equal(parsePsEtime("12:34"), 754);             // MM:SS
  assert.equal(parsePsEtime("01:06:37"), 3997);         // HH:MM:SS
  assert.equal(parsePsEtime("2-03:04:05"), 183845);     // D-HH:MM:SS
  assert.equal(parsePsEtime("  00:05 "), 5);            // ps pads its columns
});

test("parsePsEtime returns null rather than a wrong number", () => {
  for (const bad of [null, undefined, "", "-", "abc", "5", "1:2:3:4"]) {
    assert.equal(parsePsEtime(bad), null, JSON.stringify(bad));
  }
});

const PS = `  33451    01:06:37 /Applications/ProPresenter.app/Contents/MacOS/ProPresenter
  33470    01:06:30 /Applications/ProPresenter.app/Contents/MacOS/ProPresenter Helper (Network)
  27829    04:12:00 /Users/x/Library/Application Support/RenewedVision/ProPresenter/Helpers/Workspaces/ProPresenter Helper (Workspaces)
   9001       10:00 /usr/bin/something-else`;

test("uptime comes from the main app, not its helpers", () => {
  // The launchd Workspaces helper had been up four hours here and the app one.
  // Taking the longest-running ProPresenter-ish process would report the helper
  // and skip the settle wait entirely, which is the failure this guards.
  assert.equal(propresenterUptimeSeconds(PS), 3997);
});

test("no main app means no uptime, rather than zero", () => {
  const helpersOnly = PS.split("\n").filter((l) => /Helper/.test(l)).join("\n");
  assert.equal(propresenterUptimeSeconds(helpersOnly), null);
  assert.equal(propresenterUptimeSeconds(""), null);
  assert.equal(propresenterUptimeSeconds(null), null);
});

test("an app that has just launched reports a small number, not null", () => {
  // The case the settle gate exists for: this must be distinguishable from
  // "not running", because one is worth waiting for and the other is not.
  const fresh = `  500       00:03 /Applications/ProPresenter.app/Contents/MacOS/ProPresenter`;
  assert.equal(propresenterUptimeSeconds(fresh), 3);
});
