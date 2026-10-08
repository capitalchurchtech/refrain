import { test } from "node:test";
import assert from "node:assert/strict";
import { hiddenIds, markHidden, setHidden, isControlId } from "../server/live-visibility.js";
import { macroBank } from "../public/live.js";

const macros = [
  { id: "M1", name: "Service Lights" },
  { id: "M2", name: "Christmas Lights" },
  { id: "M3", name: "Blackout" },
];

test("hidden macros are marked, not dropped, so edit mode can bring them back", () => {
  const marked = markHidden(macros, ["M2"]);
  assert.deepEqual(marked.map((m) => [m.id, m.hidden]), [["M1", false], ["M2", true], ["M3", false]]);
  assert.deepEqual(markHidden(macros, undefined).filter((m) => m.hidden), []);
});

test("hiding and showing keeps the list clean: no duplicates, no junk, a new array each time", () => {
  let list = setHidden(undefined, "M2", true);
  list = setHidden(list, "M2", true);
  assert.deepEqual(list, ["M2"]);
  assert.deepEqual(setHidden(list, "M2", false), []);
  assert.deepEqual(setHidden(list, "", true), ["M2"], "a blank id is ignored");
  assert.deepEqual(hiddenIds(["M1", 7, null, "M1", "x".repeat(200)]), ["M1"]);
  assert.equal(isControlId("x".repeat(129)), false);
  const before = ["M1"];
  setHidden(before, "M3", true);
  assert.deepEqual(before, ["M1"], "the stored list is never mutated in place");
});

test("the bank shows only unhidden macros normally, and all of them while editing", () => {
  const marked = markHidden(macros, ["M2"]);
  assert.deepEqual(macroBank(marked).shown.map((m) => m.id), ["M1", "M3"]);
  assert.equal(macroBank(marked).hiddenCount, 1);
  assert.deepEqual(macroBank(marked, true).shown.map((m) => m.id), ["M1", "M2", "M3"]);
  assert.deepEqual(macroBank([]).shown, []);
});

import { plainMessagesHtml } from "../public/live.js";

test("a message with nothing to fill in is listed with Show, Take down, its text, and whether it's up", () => {
  const html = plainMessagesHtml([
    { id: "P", name: "Kids <Pager>", text: "A12", active: true },
    { id: "C", name: "Countdown", text: null, active: false },
  ]);
  assert.match(html, /data-message-show="P"/);
  assert.match(html, /data-message-hide="C"/);
  assert.match(html, /Says: A12/);
  assert.equal((html.match(/On screen/g) ?? []).length, 2, "the LED title and the label, for the active one only");
  assert.match(html, /Kids &lt;Pager&gt;/, "names are escaped");
  assert.equal(plainMessagesHtml([]), "");
});

import { dayRowText } from "../public/live.js";

test("Now's Service day row says where the day stands", () => {
  assert.equal(dayRowText({ dayEnded: { at: "x" }, services: [{}] }), "Day ended");
  assert.equal(dayRowText({ checksDue: [{ name: "9:00" }], services: [{}] }), "Checks due");
  assert.equal(dayRowText({ services: [{}] }), "1 service today");
  assert.equal(dayRowText({ services: [{}, {}] }), "2 services today");
  assert.equal(dayRowText({ services: [] }), "No services yet");
  assert.equal(dayRowText(null), "No services yet");
});
