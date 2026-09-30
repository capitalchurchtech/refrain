import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { discoverModules, moduleNav, moduleClient, moduleSettingsTab } from "../server/plugin-loader.js";

test("every module says where it sits in the menu and which script is its screen", async () => {
  const modules = await discoverModules();
  assert.ok(modules.length >= 10);
  for (const m of modules) {
    assert.ok(["service", "prep"].includes(m.nav?.group), `${m.id} has a menu group`);
    assert.ok(Number.isFinite(m.nav?.order), `${m.id} has a menu order`);
    const client = moduleClient(m.client);
    assert.ok(client, `${m.id} names a screen script`);
    assert.ok(existsSync(`public/${client.file}`), `${m.id}'s screen script exists`);
  }
  const service = modules.filter((m) => m.nav.group === "service").map((m) => m.id).sort();
  assert.deepEqual(service, ["live", "search", "service", "slide-flags"], "the four screens used during a service");
});

test("a module's metadata can't point the page at a script elsewhere", () => {
  assert.deepEqual(moduleClient({ file: "qr-code.js", init: "initQrCode" }), { file: "qr-code.js", init: "initQrCode" });
  assert.equal(moduleClient({ file: "../server/index.js", init: "x" }), null);
  assert.equal(moduleClient({ file: "https://evil.example/x.js", init: "x" }), null);
  assert.equal(moduleClient({ file: "a.js", init: "x();alert(1)" }), null);
  assert.equal(moduleClient(null), null);
  assert.deepEqual(moduleNav({ group: "nonsense" }), { group: "prep", order: 99 }, "unknown group and order fall back to the end of Prep");
});

test("the off notice sends you to the Settings tab where the module's switch is", async () => {
  const modules = await discoverModules();
  assert.equal(moduleSettingsTab("search"), "search", "a module can name another tab");
  assert.equal(modules.find((m) => m.id === "library-sync"), undefined, "Share Library is removed (dangerous: it wrote into ProPresenter's library)");
  assert.equal(moduleSettingsTab(modules.find((m) => m.id === "arrangement").settingsTab), "features");
  assert.equal(moduleSettingsTab("nonsense"), "features");
});
