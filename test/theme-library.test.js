// The theme library (server/theme-library.js): splitting ProPresenter's all-themes export, keeping each
// theme on its own with its pictures, and remembering which are ticked. Built on the package's invented
// fixture theme, never a church's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createThemeLibrary, splitThemes, themeAccess, themesDir } from "../server/theme-library.js";

const lib = await import("propresenter-bundle").catch(() => null);
const skip = lib?.readThemeFile ? false : "propresenter-bundle with theme support is not installed";
const require = createRequire(import.meta.url);
const sample = () => fs.readFileSync(path.join(path.dirname(require.resolve("propresenter-bundle/package.json")), "test", "fixtures", "sample.protheme"));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "refrain-themes-"));

/** An export of the fixture theme under several names, as ProPresenter writes one: <name>/Theme, <name>/Assets/… */
async function exportOf(names, tag = "") {
  const one = lib.readBundle(sample());
  const folder = one.find((e) => /(^|\/)Theme$/.test(e.name)).name.replace(/\/?Theme$/, "");
  const rename = (e, n) => ({ ...e, name: folder ? e.name.replace(`${folder}/`, `${n}/`) : `${n}/${e.name}` });
  // A little text after each Theme's data, from its name, so each name is a theme of its own (its own hash).
  const entries = names.flatMap((n) => one.map((e) => (/(^|\/)Theme$/.test(e.name) ? { ...rename(e, n), data: Buffer.concat([e.data, Buffer.from(n + tag)]) } : rename(e, n))));
  return lib.writeBundle(entries);
}

test("an export of several themes is split into one file each, with its own pictures", { skip }, async () => {
  const parts = await splitThemes(await exportOf(["Message", "Message-1", "Temp"]), lib);
  assert.deepEqual(parts.map((p) => p.name), ["Message", "Message-1", "Temp"]);
  assert.equal(new Set(parts.map((p) => p.sha)).size, 3);
  const first = lib.readBundle(parts[0].bytes);
  assert.ok(first.every((e) => e.name.startsWith("Message/")), "only its own folder: Message-1 is not Message");
  assert.equal(first.filter((e) => /\/Theme$/.test(e.name)).length, 1);
  assert.equal(lib.openTheme(parts[0].bytes).name, "Message", "each part opens as one theme");
});

test("a file with no theme in it is refused plainly", { skip }, async () => {
  await assert.rejects(() => splitThemes(Buffer.from("not a zip"), lib), /not a theme/);
  const noTheme = await lib.writeBundle([{ name: "readme.txt", data: Buffer.from("hi") }]);
  await assert.rejects(() => splitThemes(noTheme, lib), /holds no theme/);
});

test("themes are unticked when added; a tick survives a second upload; a changed theme starts unticked", { skip }, async () => {
  const dir = path.join(tmp(), "themes");
  const themes = createThemeLibrary({ dir });
  const first = await themes.add(await exportOf(["Message", "Temp"]), lib);
  assert.deepEqual([first.added, first.kept, first.total], [["Message", "Temp"], [], 2]);
  assert.deepEqual((await themes.list()).map((t) => t.allowed), [false, false]);

  const [message] = await themes.list();
  await themes.setAllowed(message.id, true);
  const again = await themes.add(await exportOf(["Message", "Temp"]), lib);
  assert.deepEqual([again.added, again.kept, again.total], [[], ["Message", "Temp"], 2]);
  assert.equal((await themes.byHash(message.sha)).allowed, true, "the tick is still there");

  // The same name with different content is a new theme and does not inherit the approval.
  const changed = await themes.add(await exportOf(["Message"], "-v2"), lib);
  assert.deepEqual(changed.added, ["Message"]);
  const all = await themes.list();
  assert.equal(all.length, 3);
  assert.equal(all.filter((t) => t.allowed).length, 1, "only the one ticked before");
});

test("removing a theme deletes its file; a missing or damaged index reads as an empty library", { skip }, async () => {
  const dir = path.join(tmp(), "themes");
  const themes = createThemeLibrary({ dir });
  assert.deepEqual(await themes.list(), []);
  await themes.add(await exportOf(["Message"]), lib);
  const [t] = await themes.list();
  assert.ok(fs.existsSync(themes.fileOf(t.id)));
  assert.equal(await themes.remove(t.id), true);
  assert.equal(fs.existsSync(themes.fileOf(t.id)), false);
  assert.equal(await themes.remove(t.id), false);
  assert.equal(await themes.setAllowed("nope", true), null);
  fs.writeFileSync(path.join(dir, "index.json"), "{ not json");
  assert.deepEqual(await themes.list(), []);
  assert.equal(fs.readdirSync(dir).some((f) => f.endsWith(".tmp")), false, "no half-written file left");
});

test("access: a ticked theme file opens by its content, not its name or place; several themes never open", { skip }, async () => {
  const dir = path.join(tmp(), "themes");
  const themes = createThemeLibrary({ dir });
  await themes.add(await exportOf(["Message"]), lib);
  const [t] = await themes.list();
  const [part] = await splitThemes(await exportOf(["Message"]), lib);

  assert.deepEqual(await themeAccess(part.bytes, { dir, lib }), { theme: true, allowed: false, name: "Message" });
  await themes.setAllowed(t.id, true);
  assert.deepEqual(await themeAccess(part.bytes, { dir, lib }), { theme: true, allowed: true, name: "Message" });
  assert.deepEqual(await themeAccess(await exportOf(["A", "B"]), { dir, lib }), { theme: true, many: 2 });
  assert.deepEqual(await themeAccess(Buffer.from("plain"), { dir, lib }), { theme: false });
  assert.equal((await themeAccess(await lib.writeBundle([{ name: "x.pro", data: Buffer.from("x") }]), { dir, lib })).theme, false);
});

test("the library lives under the packs folder, the default under ./data", () => {
  assert.equal(themesDir({}, "/app"), path.join("/app", "data", "probundle-packs", "themes"));
  assert.equal(themesDir({ probundleModule: { packsDir: "/church/packs" } }, "/app"), path.join("/church/packs", "themes"));
});

test("a theme is recognised by its contents, so another file extension doesn't hide it", { skip }, async () => {
  const { mightHoldTheme } = await import("../server/theme-library.js");
  assert.equal(mightHoldTheme(sample()), true);
  assert.equal(mightHoldTheme(await exportOf(["A", "B"])), true);
  assert.equal(mightHoldTheme(await lib.writeBundle([{ name: "Song.pro", data: Buffer.from("x") }, { name: "pic.png", data: Buffer.from("y") }])), false);
  assert.equal(mightHoldTheme(Buffer.from("plain text, not a zip")), false);
  assert.equal(mightHoldTheme(Buffer.alloc(0)), false);
});
