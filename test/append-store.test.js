import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeAtomic } from "../server/append-store.js";

test("a private file is created private, never briefly readable by other accounts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "store-"));
  try {
    await writeAtomic(dir, "secret.json", { secret: "x" }, { mode: 0o600 });
    assert.equal((await stat(path.join(dir, "secret.json"))).mode & 0o777, 0o600);
    // Rewriting keeps it private, and a leftover temp file from a crash doesn't block the write.
    await writeAtomic(dir, "secret.json", { secret: "y" }, { mode: 0o600 });
    assert.equal(JSON.parse(await readFile(path.join(dir, "secret.json"), "utf-8")).secret, "y");
    assert.equal((await stat(path.join(dir, "secret.json"))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
