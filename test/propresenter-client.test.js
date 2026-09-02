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
