import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { rebuildIndex, getIndex, lastCrawlAbort } from "../server/search-index.js";
import { readFingerprint } from "../server/index-fingerprint.js";

/**
 * End-to-end cover for the incremental path: real .pro files on disk, a fake
 * ProPresenter, and a count of how many presentations were actually re-read.
 *
 * rebuildIndex persists to ./cache relative to cwd, so every test runs inside
 * its own temp cwd. (A previous version of this suite called the real
 * rebuildIndex from the repo root and overwrote the developer's own 445-entry
 * index with three mocks.)
 */

// A .pro file's bytes never get parsed here — the fake client returns the
// presentation doc. The file only has to exist so it can be fingerprinted.
function fakeProPresenter(songs) {
  const fetched = [];
  return {
    fetched,
    isLocalHost: true,
    async getLibrary() {
      return Object.entries(songs).map(([id, s]) => ({ id, name: s.name, folder: "Songs" }));
    },
    async getPresentation(id) {
      fetched.push(id);
      const song = songs[id];
      if (!song) throw new Error("no such presentation");
      return {
        presentation: {
          presentation_path: song.filePath,
          groups: [{ name: "Verse 1", uuid: `${id}-g1`, slides: [{ enabled: true, text: song.text }] }],
          arrangements: [],
          current_arrangement: "",
        },
      };
    },
    async getFileDates() {
      return { createdDate: "2025-01-01T00:00:00.000Z", modifiedDate: "2025-01-02T00:00:00.000Z" };
    },
    async getPlaylists() {
      return [];
    },
  };
}

async function withTempCwd(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "refrain-incr-"));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

async function makeSongs(dir, specs) {
  const songs = {};
  for (const [id, spec] of Object.entries(specs)) {
    const filePath = path.join(dir, `${id}.pro`);
    await writeFile(filePath, spec.body);
    songs[id] = { name: spec.name, text: spec.text, filePath };
  }
  return songs;
}

test("a full build records a path and fingerprint for every presentation", async () => {
  await withTempCwd(async (dir) => {
    const songs = await makeSongs(dir, {
      a: { name: "Song A", text: "alpha", body: "AAA" },
      b: { name: "Song B", text: "bravo", body: "BBB" },
    });
    const client = fakeProPresenter(songs);

    const index = await rebuildIndex(client, {}, ["FS"]);

    assert.equal(index.buildMode, "full");
    assert.equal(client.fetched.length, 2);
    for (const id of ["a", "b"]) {
      assert.equal(index.presentations[id].presentationPath, songs[id].filePath);
      assert.match(index.presentations[id].fingerprint, /^\d+:\d+$/);
    }
    assert.deepEqual(index.buildOptions, { preferredArrangements: ["FS"], crawlPlaylists: false });
  });
});

test("an incremental run re-reads only the presentation whose file changed", async () => {
  await withTempCwd(async (dir) => {
    const songs = await makeSongs(dir, {
      a: { name: "Song A", text: "alpha", body: "AAA" },
      b: { name: "Song B", text: "bravo", body: "BBB" },
      c: { name: "Song C", text: "charlie", body: "CCC" },
    });

    await rebuildIndex(fakeProPresenter(songs), {}, ["FS"]);

    // Song B gets edited. Its new lyric only reaches the index if it is re-read.
    await writeFile(songs.b.filePath, "BBB-EDITED");
    songs.b.text = "bravo rewritten";

    const client = fakeProPresenter(songs);
    const index = await rebuildIndex(client, {}, ["FS"], { incremental: true });

    assert.equal(index.buildMode, "incremental");
    assert.deepEqual(client.fetched, ["b"], "only the edited presentation should be re-read");
    assert.deepEqual(index.reindexCounts, { carriedOver: 2, changed: 1, added: 0, unverifiable: 0 });
    assert.equal(index.presentations.b.slides[0].text, "bravo rewritten", "the edit must land in the index");
    assert.equal(index.presentations.a.slides[0].text, "alpha", "untouched entries keep their slides");
    assert.equal(index.presentations.c.slides[0].text, "charlie");
  });
});

test("an incremental run with nothing changed fetches nothing at all", async () => {
  await withTempCwd(async (dir) => {
    const songs = await makeSongs(dir, {
      a: { name: "Song A", text: "alpha", body: "AAA" },
      b: { name: "Song B", text: "bravo", body: "BBB" },
    });
    await rebuildIndex(fakeProPresenter(songs), {}, []);

    const client = fakeProPresenter(songs);
    const index = await rebuildIndex(client, {}, [], { incremental: true });

    assert.deepEqual(client.fetched, [], "an unchanged library must cost zero presentation fetches");
    assert.equal(index.reindexCounts.carriedOver, 2);
    assert.equal(Object.keys(index.presentations).length, 2);
  });
});

test("an incremental run picks up an added presentation and drops a deleted one", async () => {
  await withTempCwd(async (dir) => {
    const songs = await makeSongs(dir, {
      a: { name: "Song A", text: "alpha", body: "AAA" },
      b: { name: "Song B", text: "bravo", body: "BBB" },
    });
    await rebuildIndex(fakeProPresenter(songs), {}, []);

    delete songs.b; // removed from the library
    Object.assign(songs, await makeSongs(dir, { d: { name: "Song D", text: "delta", body: "DDD" } }));

    const client = fakeProPresenter(songs);
    const index = await rebuildIndex(client, {}, [], { incremental: true });

    assert.deepEqual(client.fetched, ["d"], "only the new presentation is fetched");
    assert.equal(index.presentations.b, undefined, "the removed presentation is gone from the index");
    assert.equal(index.presentations.d.slides[0].text, "delta");
    assert.equal(index.reindexCounts.added, 1);
  });
});

test("an incremental run re-reads a presentation whose file was deleted underneath it", async () => {
  await withTempCwd(async (dir) => {
    const songs = await makeSongs(dir, {
      a: { name: "Song A", text: "alpha", body: "AAA" },
      b: { name: "Song B", text: "bravo", body: "BBB" },
    });
    await rebuildIndex(fakeProPresenter(songs), {}, []);

    // Still listed by ProPresenter, but its file cannot be fingerprinted —
    // never silently keep slides we can no longer vouch for.
    await rm(songs.b.filePath);

    const client = fakeProPresenter(songs);
    const index = await rebuildIndex(client, {}, [], { incremental: true });

    assert.deepEqual(client.fetched, ["b"]);
    assert.equal(index.reindexCounts.unverifiable, 1);
  });
});

test("changing preferred arrangements downgrades an incremental run to a full rebuild", async () => {
  await withTempCwd(async (dir) => {
    const songs = await makeSongs(dir, {
      a: { name: "Song A", text: "alpha", body: "AAA" },
      b: { name: "Song B", text: "bravo", body: "BBB" },
    });
    await rebuildIndex(fakeProPresenter(songs), {}, ["FS", "T"]);

    const client = fakeProPresenter(songs);
    const index = await rebuildIndex(client, {}, ["T", "FS"], { incremental: true });

    assert.equal(index.buildMode, "full", "a different arrangement priority changes what every entry means");
    assert.deepEqual(client.fetched.sort(), ["a", "b"]);
    assert.deepEqual(index.buildOptions.preferredArrangements, ["T", "FS"]);
  });
});

test("a remote ProPresenter falls back to a full rebuild", async () => {
  await withTempCwd(async (dir) => {
    const songs = await makeSongs(dir, { a: { name: "Song A", text: "alpha", body: "AAA" } });
    await rebuildIndex(fakeProPresenter(songs), {}, []);

    // No filesystem to check, so there is nothing to be incremental about.
    const client = { ...fakeProPresenter(songs), isLocalHost: false };
    client.fetched = [];
    const index = await rebuildIndex(client, {}, [], { incremental: true });

    assert.equal(index.buildMode, "full");
    assert.equal(getIndex().buildMode, "full");
  });
});

test("a failed re-read keeps the previous slides instead of emptying the entry", async () => {
  await withTempCwd(async (dir) => {
    const songs = await makeSongs(dir, {
      a: { name: "Song A", text: "alpha", body: "AAA" },
      b: { name: "Song B", text: "bravo", body: "BBB" },
    });
    await rebuildIndex(fakeProPresenter(songs), {}, []);

    // Song B was edited, so it will be re-read — and the re-read times out.
    // Leaving it empty would drop the song out of search entirely, which looks
    // exactly like its lyrics having been deleted.
    await writeFile(songs.b.filePath, "BBB-EDITED");
    const client = fakeProPresenter(songs);
    client.getPresentation = async (id) => {
      if (id === "b") throw new Error("socket hang up");
      throw new Error("should not have been fetched");
    };

    const index = await rebuildIndex(client, {}, [], { incremental: true });

    assert.equal(index.presentations.b.slides[0].text, "bravo", "the old lyrics must survive a failed re-read");
    assert.equal(index.presentations.a.slides[0].text, "alpha");
    // The restored entry must carry the fingerprint of the content those slides
    // came from, not the edited file's — otherwise the next reindex sees a match
    // and settles on stale slides forever. The retry test below proves it.
    assert.notEqual(index.presentations.b.fingerprint, await readFingerprint(songs.b.filePath));
  });
});

test("a failed re-read is retried on the next reindex rather than settling stale", async () => {
  await withTempCwd(async (dir) => {
    const songs = await makeSongs(dir, { a: { name: "Song A", text: "alpha", body: "AAA" } });
    await rebuildIndex(fakeProPresenter(songs), {}, []);

    await writeFile(songs.a.filePath, "AAA-EDITED");
    songs.a.text = "alpha rewritten";

    const failing = fakeProPresenter(songs);
    failing.getPresentation = async () => {
      throw new Error("socket hang up");
    };
    await rebuildIndex(failing, {}, [], { incremental: true });

    // Second attempt, ProPresenter answering again.
    const working = fakeProPresenter(songs);
    const index = await rebuildIndex(working, {}, [], { incremental: true });

    assert.deepEqual(working.fetched, ["a"], "the failed presentation must be retried");
    assert.equal(index.presentations.a.slides[0].text, "alpha rewritten");
  });
});

test("a full rebuild refuses to piggyback on an in-flight incremental run", async () => {
  await withTempCwd(async (dir) => {
    const songs = await makeSongs(dir, {
      a: { name: "Song A", text: "alpha", body: "AAA" },
      b: { name: "Song B", text: "bravo", body: "BBB" },
    });
    await rebuildIndex(fakeProPresenter(songs), {}, []);

    // Hold the incremental run open, then ask for a full rebuild. Returning the
    // incremental's promise would report success for a rebuild that never
    // re-read anything.
    await writeFile(songs.b.filePath, "BBB-EDITED");
    let release;
    const slow = fakeProPresenter(songs);
    slow.getPresentation = async (id) => {
      await new Promise((r) => (release = r));
      return { presentation: { presentation_path: songs[id].filePath, groups: [], arrangements: [], current_arrangement: "" } };
    };

    const inFlight = rebuildIndex(slow, {}, [], { incremental: true });
    await new Promise((r) => setTimeout(r, 50));
    await assert.rejects(() => rebuildIndex(fakeProPresenter(songs), {}, []), /reindex is already running/i);

    release();
    await inFlight;
  });
});

test("an incremental caller may wait on an in-flight full rebuild", async () => {
  await withTempCwd(async (dir) => {
    const songs = await makeSongs(dir, { a: { name: "Song A", text: "alpha", body: "AAA" } });
    let release;
    const slow = fakeProPresenter(songs);
    slow.getPresentation = async (id) => {
      await new Promise((r) => (release = r));
      return {
        presentation: {
          presentation_path: songs[id].filePath,
          groups: [{ name: "V1", uuid: "u1", slides: [{ enabled: true, text: "alpha" }] }],
          arrangements: [],
          current_arrangement: "",
        },
      };
    };

    const full = rebuildIndex(slow, {}, []);
    await new Promise((r) => setTimeout(r, 50));
    // A full rebuild does everything an incremental one would, so joining it is
    // sound rather than a silent no-op.
    const joined = rebuildIndex(slow, {}, [], { incremental: true });

    release();
    const [a, b] = await Promise.all([full, joined]);
    assert.equal(a, b, "the incremental caller should receive the full rebuild's result");
  });
});

test("a crawl stops asking once ProPresenter has clearly stopped answering", async () => {
  // Measured on a real rig: a rebuild begun too soon after launch failed 221 of
  // 445 reads, and the old loop asked all 221 times anyway. Once a run of reads
  // is failing, the useful thing is to stop and say so.
  await withTempCwd(async (dir) => {
    const specs = {};
    for (let i = 0; i < 40; i++) specs[`s${i}`] = { name: `Song ${i}`, text: "words", body: `body-${i}` };
    const songs = await makeSongs(dir, specs);

    const client = fakeProPresenter(songs);
    const realGet = client.getPresentation.bind(client);
    let calls = 0;
    client.getPresentation = async (id) => {
      calls += 1;
      // Healthy for a few, then ProPresenter falls over and stays down.
      if (calls > 3) throw new Error("ProPresenter is not responding");
      return realGet(id);
    };

    await rebuildIndex(client, {}, []);

    // It must give up well short of asking all forty.
    assert.ok(calls < 20, `kept asking ${calls} times after it started failing`);
    assert.ok(calls >= 10, `gave up after only ${calls} — one slow document must not abandon a rebuild`);

    const abort = lastCrawlAbort();
    assert.ok(abort, "the abort is recorded rather than reported as a clean build");
    assert.ok(abort.consecutiveFailures >= 10);
  });
});

test("a few scattered failures do not abandon a rebuild", async () => {
  // One document deleted between the library listing and the read, or one slow
  // response, is ordinary. Only a sustained run means the app is not coping.
  await withTempCwd(async (dir) => {
    const specs = {};
    for (let i = 0; i < 20; i++) specs[`s${i}`] = { name: `Song ${i}`, text: "words", body: `body-${i}` };
    const songs = await makeSongs(dir, specs);

    const client = fakeProPresenter(songs);
    const realGet = client.getPresentation.bind(client);
    let calls = 0;
    client.getPresentation = async (id) => {
      calls += 1;
      if (calls % 5 === 0) throw new Error("transient");
      return realGet(id);
    };

    await rebuildIndex(client, {}, []);
    assert.equal(calls, 20, "every presentation was still attempted");
    assert.equal(lastCrawlAbort(), null, "scattered failures are not an abort");
  });
});
