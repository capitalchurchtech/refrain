import { test } from "node:test";
import assert from "node:assert/strict";
import { stageMessages, addStageMessage, removeStageMessage, editStageMessage, moveStageMessage, cleanStageText, messageFieldValue, DEFAULT_STAGE_MESSAGES, MAX_STAGE_MESSAGES, STAGE_TEXT_MAX } from "../server/stage-messages.js";

test("a church that never saved any gets the three defaults; an emptied list stays empty", () => {
  assert.deepEqual(stageMessages(undefined).map((m) => m.text), DEFAULT_STAGE_MESSAGES.map((m) => m.text));
  assert.deepEqual(stageMessages([]), []);
  assert.deepEqual(stageMessages([{ id: "a", text: "" }, { id: "", text: "x" }, "junk", { id: "b", text: "Ok" }]), [{ id: "b", text: "Ok" }]);
});

test("adding: cleaned to one line, the same text twice is one preset, a full list is an error", () => {
  let r = addStageMessage([], "  Wrap   up\nnow ", { id: "w" });
  assert.deepEqual(r.added, { id: "w", text: "Wrap up now" });
  assert.equal(addStageMessage(r.list, "wrap up NOW").added.id, "w");
  assert.equal(addStageMessage(r.list, "   ").error, "Type the message first.");
  const full = Array.from({ length: MAX_STAGE_MESSAGES }, (_, i) => ({ id: `m${i}`, text: `M${i}` }));
  r = addStageMessage(full, "One more");
  assert.ok(r.error);
  assert.equal(r.list.length, MAX_STAGE_MESSAGES, "nothing dropped");
});

test("edit, move and remove change only the one asked for", () => {
  const list = [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }];
  assert.deepEqual(editStageMessage(list, "b", " Bee ").map((m) => m.text), ["A", "Bee", "C"]);
  assert.deepEqual(editStageMessage(list, "b", "  ").map((m) => m.text), ["A", "B", "C"], "an empty edit keeps the old text");
  assert.deepEqual(moveStageMessage(list, "c", -1).map((m) => m.id), ["a", "c", "b"]);
  assert.deepEqual(moveStageMessage(list, "a", -1).map((m) => m.id), ["a", "b", "c"]);
  assert.deepEqual(removeStageMessage(list, "a").map((m) => m.id), ["b", "c"]);
});

test("stage text is one line and capped; message fields are upper-cased", () => {
  assert.equal(cleanStageText("x".repeat(200)).length, STAGE_TEXT_MAX);
  assert.equal(cleanStageText(null), "");
  assert.equal(messageFieldValue("  ex vx\n"), "EX VX");
});
