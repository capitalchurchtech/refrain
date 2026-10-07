import { test } from "node:test";
import assert from "node:assert/strict";
import { moduleFeatures, featureDefaults, featureForPath } from "../server/features.js";
import { featureOn, registerFeatureDefaults } from "../server/config.js";

const modules = [
  { id: "search", navLabel: "Search", nav: { order: 0 } },
  { id: "qr-code", navLabel: "QR Codes", nav: { order: 5 }, feature: { default: true, apiPrefixes: ["/api/qr"] } },
  {
    id: "live",
    navLabel: "Now",
    nav: { order: 1 },
    features: [
      { id: "looks", label: "Looks", default: false, apiPrefixes: ["/api/live/look", "/api/live/current-look"] },
      { id: "messages", label: "Messages", default: true, apiPrefixes: ["/api/live/message", "/api/live/stage-message"] },
    ],
  },
  { id: "image-crop", navLabel: "Image Crop", nav: { order: 6 }, feature: { default: false, apiPrefixes: ["not-an-api-path"] } },
];

test("modules declare their own features; one with none is core", () => {
  const f = moduleFeatures(modules);
  assert.deepEqual(f.map((x) => x.id), ["looks", "messages", "qr-code", "image-crop"], "in menu order, parts of a screen under it");
  assert.ok(!f.some((x) => x.id === "search"), "Search declares no feature, so it's always on");
  assert.equal(f.find((x) => x.id === "looks").parent, "live");
  assert.deepEqual(f.find((x) => x.id === "image-crop").apiPrefixes, [], "only /api/ prefixes are taken");
  assert.deepEqual(featureDefaults(f), { looks: false, messages: true, "qr-code": true, "image-crop": false });
});

test("a request path belongs to the feature with the longest matching prefix", () => {
  const f = moduleFeatures(modules);
  assert.equal(featureForPath(f, "/api/live/stage-messages/abc").id, "messages");
  assert.equal(featureForPath(f, "/api/live/current-look").id, "looks");
  assert.equal(featureForPath(f, "/api/qr/history").id, "qr-code");
  assert.equal(featureForPath(f, "/api/search"), null, "core paths belong to no feature");
  assert.equal(featureForPath(f, "/API/Live/Look").id, "looks", "any case, as Express routes it");
});

test("a feature is what the church chose, else its module's default", () => {
  registerFeatureDefaults({ looks: false, messages: true });
  assert.equal(featureOn({}, "looks"), false);
  assert.equal(featureOn({}, "messages"), true);
  assert.equal(featureOn({ features: { looks: true } }, "looks"), true);
  assert.equal(featureOn({ features: { messages: false } }, "messages"), false);
  assert.equal(featureOn({ features: { looks: "yes" } }, "looks"), false, "only true or false counts");
});
