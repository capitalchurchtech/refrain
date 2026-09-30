import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { envEntries, applyEnvEdits, quoteValue, saveEnvFile } from "../server/env-file.js";

const EXAMPLE = "# Planning Center\nPLANNING_CENTER_APP_ID=\nPLANNING_CENTER_SECRET=\n\nSMTP_PASSWORD=\n";

test("the settings shown are .env.example's, in its order, plus anything extra the file has", () => {
  const env = "PLANNING_CENTER_SECRET=abc\nMY_OWN=1\n";
  const e = envEntries(env, EXAMPLE);
  assert.deepEqual(e.map((x) => [x.name, x.value, x.set, x.inExample]), [
    ["PLANNING_CENTER_APP_ID", "", false, true],
    ["PLANNING_CENTER_SECRET", "abc", true, true],
    ["SMTP_PASSWORD", "", false, true],
    ["MY_OWN", "1", true, false],
  ]);
});

test("an edit changes only its own line; comments, order and other values are kept byte for byte", () => {
  const env = "# keep me\nPLANNING_CENTER_APP_ID=old  # note\n\nOTHER='x y'\n";
  const out = applyEnvEdits(env, { PLANNING_CENTER_APP_ID: "new", SMTP_PASSWORD: "p" });
  assert.equal(out, "# keep me\nPLANNING_CENTER_APP_ID=new\n\nOTHER='x y'\nSMTP_PASSWORD=p\n");
});

test("whatever is typed reads back exactly through dotenv, the parser Refrain uses", () => {
  for (const v of ["plain", "has space", "hash#tag", 'say "hi"', "it's", "back\\slash", "a=b", "", " lead"]) {
    const text = applyEnvEdits("", { SMTP_PASSWORD: v });
    assert.equal(dotenv.parse(text).SMTP_PASSWORD, v, JSON.stringify(v));
  }
  assert.throws(() => quoteValue("two\nlines"), /line break/);
  assert.throws(() => quoteValue(`both ' and "`), /both kinds/);
  assert.throws(() => applyEnvEdits("", { "bad name": "x" }), /isn't a setting name/);
});

test("saving keeps the previous file and writes owner-only", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-env-"));
  try {
    const p = path.join(dir, ".env");
    await writeFile(p, "A=1\n");
    await saveEnvFile(p, "A=2\n");
    assert.equal(await readFile(p, "utf8"), "A=2\n");
    assert.equal(await readFile(`${p}.previous`, "utf8"), "A=1\n", "the last version is kept");
    assert.equal((await stat(p)).mode & 0o777, 0o600, "only this user can read it");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
