import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeTooOld, nodeRefusal } from "../server/node-version.js";

test("an update is refused only when the running Node is older than the incoming version needs", () => {
  assert.equal(nodeTooOld(">=20.9.0", "20.8.1"), "20.9.0");
  assert.equal(nodeTooOld(">=20.9.0", "18.20.4"), "20.9.0");
  assert.equal(nodeTooOld(">=20.9.0", "20.9.0"), null);
  assert.equal(nodeTooOld(">=20.9.0", "22.23.2"), null);
  assert.equal(nodeTooOld(">=20.9.0", "v20.10.0"), null, "a leading v is fine");
  assert.equal(nodeTooOld(">=20", "19.9.9"), "20.0.0", "a bare major");
  assert.equal(nodeTooOld("^20.9.0", "18.0.0"), null, "a range it doesn't understand lets the update through, as before");
  assert.equal(nodeTooOld(undefined, "18.0.0"), null, "no range at all, likewise");
  assert.match(nodeRefusal("20.9.0", "20.8.1"), /needs Node 20\.9\.0 or newer.*Node 20\.8\.1.*Nothing was changed/);
});
