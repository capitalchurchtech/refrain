import test from "node:test";
import assert from "node:assert/strict";
import { macroColorHex, macroIcon } from "../server/propresenter-client.js";

test("converts ProPresenter's float components to hex", () => {
  // The real shape, from a live rig: 0..1 floats, not a string.
  assert.equal(macroColorHex({ red: 1, green: 0.8323456645011902, blue: 0.4732058644294739, alpha: 1 }), "#FFD479");
  assert.equal(macroColorHex({ red: 0, green: 0, blue: 0, alpha: 1 }), "#000000");
  assert.equal(macroColorHex({ red: 1, green: 1, blue: 1, alpha: 1 }), "#FFFFFF");
});

test("a malformed colour is no colour, never black", () => {
  // The failure that matters. Degrading to black paints a confident swatch
  // the operator never chose, indistinguishable from one they did.
  for (const bad of [null, undefined, {}, "red", 42, [], { red: 1 }, { red: "1", green: 0, blue: 0 }, { red: NaN, green: 0, blue: 0 }]) {
    assert.equal(macroColorHex(bad), null, `${JSON.stringify(bad)} should be no swatch`);
  }
});

test("fully transparent is no colour", () => {
  // A swatch nobody can see is worse than an absent one: the space still reads
  // as meaningful.
  assert.equal(macroColorHex({ red: 1, green: 0, blue: 0, alpha: 0 }), null);
});

test("float overshoot is clamped, not rejected", () => {
  // 1.0000001 is arithmetic, not a malformed colour.
  assert.equal(macroColorHex({ red: 1.0000001, green: -0.0000001, blue: 0.5, alpha: 1 }), "#FF0080");
});

test("a missing alpha is treated as opaque", () => {
  assert.equal(macroColorHex({ red: 1, green: 0, blue: 0 }), "#FF0000");
});

test("an unknown icon is no icon rather than a guess", () => {
  // A wrong icon makes the bank look scannable while lying.
  assert.equal(macroIcon("Bell"), "bell");
  assert.equal(macroIcon("SomethingNew"), null);
  assert.equal(macroIcon(undefined), null);
});
