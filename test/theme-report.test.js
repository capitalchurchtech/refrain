import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutThemes, themesInDeck, themeReport } from "../server/theme-report.js";

const U = (n) => `${String(n).padStart(8, "0")}-0000-0000-0000-000000000000`;
const themes = {
  groups: [{ id: { name: "Series" }, themes: [{ id: { name: "Autumn" }, slides: [{ id: { uuid: U(1) } }, { id: { uuid: U(2) } }] }], groups: [] }],
  themes: [{ id: { name: "Classic" }, slides: [{ id: { uuid: U(3) } }] }],
};

test("layout ids map to their theme, including themes inside folders", () => {
  const map = layoutThemes(themes);
  assert.equal(map.get(U(1)), "Series / Autumn");
  assert.equal(map.get(U(3)), "Classic");
});

test("a deck uses the themes whose layout ids appear in its bytes", () => {
  const map = layoutThemes(themes);
  const buf = Buffer.from(`\x0a$${U(2)}\x12 junk ${U(99)} $${U(3)}`, "latin1");
  assert.deepEqual([...themesInDeck(buf, map)].sort(), ["Classic", "Series / Autumn"]);
});

test("each library's current theme is its most used, and the others are listed", () => {
  const d = (name, folder, ...t) => ({ presentationId: name, name, folder, themes: new Set(t) });
  const report = themeReport([
    d("Week 1", "Messages", "Autumn"),
    d("Week 2", "Messages", "Autumn"),
    d("Week 3", "Messages", "Classic"),
    d("Week 4", "Messages", "Autumn", "Classic"),
    d("Hymn", "Songs"), // no theme layouts: not judged
  ]);
  assert.equal(report.length, 1);
  assert.equal(report[0].current, "Autumn");
  assert.deepEqual(report[0].off.map((o) => [o.name, o.alsoCurrent]), [["Week 3", false], ["Week 4", true]]);
});

import { renderThemeReport } from "../public/health.js";

test("the Health card lists each library's current theme and the decks that differ", () => {
  const html = renderThemeReport({ libraries: [{ folder: "Messages", current: "Message", currentCount: 3, themedDecks: 4, off: [{ name: "Kids <Week>", themes: ["Kids"], alsoCurrent: false }] }] });
  assert.match(html, /current theme Message \(3 of 4 decks\)/);
  assert.match(html, /Kids &lt;Week&gt;: Kids/);
  assert.match(renderThemeReport({ libraries: [] }), /nothing to compare/);
});
