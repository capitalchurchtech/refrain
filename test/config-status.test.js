import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanFolderSetting,
  getArrangementModuleStatus,
  getEnvRequirements,
  getLibrarySyncModuleStatus,
  registerProviders,
} from "../server/config.js";

// A made-up provider, so the checks are proven to read the declaration and
// not a vendor name baked into shared code.
class FakeProvider {
  static providerId = "fake-crm";
  static displayName = "Fake CRM";
  static requiredEnv = [{ name: "FAKE_CRM_KEY", roles: ["logger"] }];
}

const arrangement = (role) => ({
  role,
  arrangementModule: { enabled: true, storageBackend: "local-folder", provider: "fake-crm" },
});

test("a provider's declared credentials decide misconfigured, on the roles it names", () => {
  registerProviders([FakeProvider]);
  delete process.env.FAKE_CRM_KEY;
  assert.equal(getArrangementModuleStatus(arrangement("logger")), "misconfigured");
  assert.equal(getArrangementModuleStatus(arrangement("reader")), "active", "a reader never needs the key");
  process.env.FAKE_CRM_KEY = "set";
  assert.equal(getArrangementModuleStatus(arrangement("logger")), "active");
  delete process.env.FAKE_CRM_KEY;
});

test("Health's env list names the provider by its displayName and never shows a value", () => {
  registerProviders([FakeProvider]);
  process.env.FAKE_CRM_KEY = "secret-value";
  const reqs = getEnvRequirements(arrangement("logger"));
  assert.deepEqual(reqs.map((r) => [r.name, r.set]), [["FAKE_CRM_KEY", true]]);
  assert.match(reqs[0].note, /Fake CRM/);
  assert.ok(!JSON.stringify(reqs).includes("secret-value"));
  delete process.env.FAKE_CRM_KEY;
});

test("an unknown or unregistered provider needs nothing and stays active", () => {
  registerProviders([]);
  assert.equal(getArrangementModuleStatus(arrangement("logger")), "active");
  assert.deepEqual(getEnvRequirements(arrangement("logger")), []);
});

test("a cleared folder is null, including the 'null' string an older save wrote", () => {
  for (const v of [null, undefined, "", "   ", "null", "undefined"]) assert.equal(cleanFolderSetting(v), null, String(v));
  assert.equal(cleanFolderSetting("  /Users/Shared/Sync  "), "/Users/Shared/Sync");
  const sync = { librarySyncModule: { enabled: true, sharedFolder: "null", libraryName: "Songs", direction: "send" } };
  assert.equal(getLibrarySyncModuleStatus(sync), "misconfigured", "a stored 'null' is not a folder");
});
