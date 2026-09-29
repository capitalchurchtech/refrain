import { test } from "node:test";
import assert from "node:assert/strict";
import { setAvailableTools, openWith, takeOpenWith, songActionsHtml } from "../public/open-with.js";

test("a row offers only the tools that are on, and opening one hands the song over once", () => {
  globalThis.location = { hash: "#slide-flags" };
  setAvailableTools(["spellcheck"]);
  const html = songActionsHtml("P1", 'Oceans "live"');
  assert.match(html, /Spell check this/);
  assert.doesNotMatch(html, /Arrangement/, "Arrangement is off, so no button for it");
  assert.match(html, /data-name="Oceans &quot;live&quot;"/, "the name is escaped");
  assert.equal(songActionsHtml(null, "x"), "", "nothing to offer without a presentation");

  openWith("arrangement", { presentationId: "P1" });
  assert.equal(globalThis.location.hash, "#slide-flags", "a tool that's off doesn't open");
  openWith("spellcheck", { presentationId: "P1", name: "Oceans" });
  assert.equal(globalThis.location.hash, "prep/spellcheck");
  assert.equal(takeOpenWith("arrangement"), null, "another tool doesn't get it");
  assert.deepEqual(takeOpenWith("spellcheck"), { tool: "spellcheck", presentationId: "P1", name: "Oceans" });
  assert.equal(takeOpenWith("spellcheck"), null, "only once: a later visit is an ordinary one");
});
