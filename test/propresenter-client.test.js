import test from "node:test";
import assert from "node:assert/strict";
import { ProPresenterClient } from "../server/propresenter-client.js";

/**
 * The live path's time budget, against the failure mode that motivated it: a
 * ProPresenter that accepts TCP connections and then never answers. Observed on
 * a real rig, where /v1/version returned in 14ms while /v1/status/layers,
 * /v1/presentation/slide_index and /v1/looks all hung past 30s.
 *
 * A slow-but-answering stub, rather than one that hangs forever: it settles
 * either way, so the assertions are about which budget won rather than about
 * how fast the test machine is.
 */
function slowFetch(delayMs, payload = { presentation: { groups: [] } }) {
  return (_url, opts) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, status: 200, json: async () => payload }), delayMs);
      opts?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
      });
    });
}

function jsonFetch(payload, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
}

const client = () => new ProPresenterClient({ host: "localhost", port: 56563 });

async function withFetch(stub, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

// --- the Go Live time budget ---

test("getPresentation gives up early when the caller asks for a short budget", async () => {
  // The anchor lookup is optional pre-work ahead of the trigger. Left on the
  // 20s live budget it stacked with the trigger's own 20s, so a wedged
  // ProPresenter took about forty seconds to report a failure, with the button
  // disabled throughout.
  await withFetch(slowFetch(400), async () => {
    const started = Date.now();
    await assert.rejects(client().getPresentation("abc", { timeoutMs: 60 }));
    assert.ok(Date.now() - started < 350, "the short budget won, not the response");
  });
});

test("getPresentation still waits out a slow-but-working ProPresenter by default", async () => {
  // Indexing can afford to wait; only the live path cannot. Fixing the live
  // path must not have narrowed the default, or a busy machine would start
  // failing to index.
  await withFetch(slowFetch(300), async () => {
    const doc = await client().getPresentation("abc");
    assert.ok(doc.presentation, "resolved rather than timing out at 300ms");
  });
});

test("getCurrentSlide accepts a short budget, since it only feeds the Return bar", async () => {
  await withFetch(slowFetch(400, { presentation_index: null }), async () => {
    const started = Date.now();
    await assert.rejects(client().getCurrentSlide({ timeoutMs: 60 }));
    assert.ok(Date.now() - started < 350);
  });
});

// --- getCurrentSlide's validation, which arms the Return bar ---
//
// These rejections are load-bearing: a bad value here sends the operator back
// to a slide they were never on. Pinned because ProPresenter 21.3's response
// shape is otherwise recorded only in a comment.

test("getCurrentSlide reads the live slide out of ProPresenter's shape", async () => {
  await withFetch(
    jsonFetch({ presentation_index: { index: 4, presentation_id: { uuid: "u1", name: "Build My Life" } } }),
    async () => {
      assert.deepEqual(await client().getCurrentSlide(), {
        presentationId: "u1",
        slideIndex: 4,
        name: "Build My Life",
      });
    }
  );
});

test("slide 0 survives, and the genuinely absent is rejected", async () => {
  // The falsy-zero trap first: slide 0 is the first slide of every song, and
  // treating it as missing would break Return on any song opened at the top.
  const cases = [
    [{ presentation_index: { index: 0, presentation_id: { uuid: "u" } } }, { presentationId: "u", slideIndex: 0, name: null }],
    [{ presentation_index: { index: -1, presentation_id: { uuid: "u" } } }, null],
    [{ presentation_index: { index: "3", presentation_id: { uuid: "u" } } }, null],
    [{ presentation_index: { index: 3, presentation_id: {} } }, null],
    [{ presentation_index: null }, null],
    [{}, null],
    [null, null],
  ];
  for (const [payload, expected] of cases) {
    await withFetch(jsonFetch(payload), async () => {
      assert.deepEqual(await client().getCurrentSlide(), expected, JSON.stringify(payload));
    });
  }
});

test("a non-2xx response throws rather than resolving to null", async () => {
  // A silent null would read as "nothing is live", which is a different fact
  // from "ProPresenter refused" -- and the first one arms nothing while the
  // second should be surfaced.
  await withFetch(jsonFetch({}, 500), async () => {
    await assert.rejects(client().getCurrentSlide(), /responded 500/);
  });
});

test("204 means no content, not malformed JSON", async () => {
  // Several ProPresenter endpoints answer 204, and parsing that as JSON throws.
  await withFetch(async () => ({ ok: true, status: 204, json: async () => { throw new Error("no body") } }), async () => {
    assert.equal(await client().getLayerStatus(), null);
  });
});

// --- URL path segments are encoded, so an id cannot pick a different endpoint ---

function urlRecorder() {
  const urls = [];
  const stub = async (url) => {
    urls.push(String(url));
    return { ok: true, status: 200, json: async () => [] };
  };
  return { urls, stub };
}

test("a slash in an id cannot redirect the call to another endpoint", async () => {
  // Raw interpolation made `/v1/macro/${id}/trigger` reachable as any path the
  // id chose. `..` then normalises away the segment the method name promised.
  const { urls, stub } = urlRecorder();
  await withFetch(stub, async () => {
    await client().triggerMacro("../../v1/clear/layer/audio");
  });
  assert.equal(urls.length, 1);
  // The property that matters is the path SHAPE, not the absence of dots:
  // encodeURIComponent leaves `..` alone and encodes the slashes, which is
  // what makes traversal impossible. So assert the structure directly.
  const path = new URL(urls[0]).pathname;
  assert.deepEqual(path.split("/").slice(1, 3), ["v1", "macro"], `still a macro call: ${path}`);
  assert.equal(path.split("/").length, 5, `exactly /v1/macro/<id>/trigger: ${path}`);
  assert.ok(path.endsWith("/trigger"));
  assert.ok(!path.includes("/clear/layer"), "did not become a clear call");
});

test("every id-bearing call encodes its segment", async () => {
  const nasty = "a/b?c=d#e";
  const cases = [
    ["triggerLook", (c) => c.triggerLook(nasty)],
    ["triggerMacro", (c) => c.triggerMacro(nasty)],
    ["clearMessage", (c) => c.clearMessage(nasty)],
    ["focusPresentation", (c) => c.focusPresentation(nasty)],
    ["getPresentation", (c) => c.getPresentation(nasty)],
    ["getPlaylistItems", (c) => c.getPlaylistItems(nasty)],
  ];
  for (const [name, call] of cases) {
    const { urls, stub } = urlRecorder();
    await withFetch(stub, async () => {
      await call(client());
    });
    const u = urls[0];
    assert.ok(!u.includes("?"), `${name} left a query string: ${u}`);
    assert.ok(!u.includes("#"), `${name} left a fragment: ${u}`);
    assert.equal(u.split("/v1/")[1].split("/").filter((p) => p === "b").length, 0, `${name} split the id: ${u}`);
  }
});

test("a real uuid passes through untouched, so encoding changed nothing normal", async () => {
  // The whole point: this is a no-op for valid input. If encoding mangled a
  // uuid, every Go Live in the building would break.
  const uuid = "4B9C1E2A-7F30-4A55-9C21-0D8E6F1A2B3C";
  const { urls, stub } = urlRecorder();
  await withFetch(stub, async () => {
    await client().triggerSlide(uuid, 12);
  });
  assert.equal(urls[0], `http://localhost:56563/v1/presentation/${uuid}/12/trigger`);
});

// --- library folder matching ---

function libraryStub({ folders, contents = {}, failing = [] }) {
  return async (url) => {
    const u = String(url);
    if (u.endsWith("/v1/libraries")) {
      return { ok: true, status: 200, json: async () => folders };
    }
    const uuid = decodeURIComponent(u.split("/v1/library/")[1] ?? "");
    if (failing.includes(uuid)) return { ok: false, status: 500 };
    return { ok: true, status: 200, json: async () => ({ items: contents[uuid] ?? [] }) };
  };
}

const FOLDERS = [
  { uuid: "f1", name: "Songs" },
  { uuid: "f2", name: "Hymns" },
  { uuid: "f3", name: "Liturgy" },
];
const CONTENTS = {
  f1: [{ uuid: "s1", name: "Build My Life" }],
  f2: [{ uuid: "h1", name: "Great Is Thy Faithfulness" }],
  f3: [{ uuid: "l1", name: "Creed" }],
};

test("folder names match case-insensitively — the silent empty index", async () => {
  // `folderNames.includes(f.name)` meant a config saying "songs" against a
  // ProPresenter folder called "Songs" crawled nothing, and the operator got an
  // empty index with no explanation.
  await withFetch(libraryStub({ folders: FOLDERS, contents: CONTENTS }), async () => {
    const r = await client().getLibraryDetailed(["songs", "  HYMNS  "]);
    assert.deepEqual(r.items.map((i) => i.id).sort(), ["h1", "s1"]);
    assert.deepEqual(r.unmatchedNames, []);
  });
});

test("a configured folder that does not exist is reported, with what does", async () => {
  await withFetch(libraryStub({ folders: FOLDERS, contents: CONTENTS }), async () => {
    const r = await client().getLibraryDetailed(["Songs", "Chorales"]);
    assert.deepEqual(r.unmatchedNames, ["Chorales"]);
    assert.deepEqual(r.availableFolders, ["Songs", "Hymns", "Liturgy"]);
    assert.deepEqual(r.items.map((i) => i.id), ["s1"], "the folder that does exist still crawls");
  });
});

test("a folder that throws is reported rather than silently omitted", async () => {
  // One folder timing out must not abort the crawl -- but its songs are missing
  // from search, and that was only ever a console line.
  await withFetch(libraryStub({ folders: FOLDERS, contents: CONTENTS, failing: ["f2"] }), async () => {
    const r = await client().getLibraryDetailed(["Songs", "Hymns"]);
    assert.deepEqual(r.items.map((i) => i.id), ["s1"]);
    assert.equal(r.failedFolders.length, 1);
    assert.equal(r.failedFolders[0].name, "Hymns");
  });
});

test("a duplicated or twice-matching config entry does not crawl a folder twice", async () => {
  await withFetch(libraryStub({ folders: FOLDERS, contents: CONTENTS }), async () => {
    const r = await client().getLibraryDetailed(["Songs", "songs", "SONGS"]);
    assert.deepEqual(r.items.map((i) => i.id), ["s1"], "crawled once");
  });
});

test("no folder filter means every folder, in ProPresenter's own order", async () => {
  await withFetch(libraryStub({ folders: FOLDERS, contents: CONTENTS }), async () => {
    const r = await client().getLibraryDetailed(null);
    assert.deepEqual(r.items.map((i) => i.id), ["s1", "h1", "l1"]);
    assert.deepEqual(r.unmatchedNames, []);
  });
});

test("getLibrary still returns a bare array, so existing callers are unaffected", async () => {
  await withFetch(libraryStub({ folders: FOLDERS, contents: CONTENTS }), async () => {
    const items = await client().getLibrary(["Songs"]);
    assert.ok(Array.isArray(items));
    assert.deepEqual(items.map((i) => i.id), ["s1"]);
  });
});
