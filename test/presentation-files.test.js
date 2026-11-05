// The search index read from ProPresenter's library files (server/presentation-files.js): the API's
// answer rebuilt from a .pro, the files found in ProPresenter's own workspace (never a clone of it), the
// per-library check, the Go Live comparison, and rebuildIndex asking ProPresenter for nothing but listings.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

const lib = await import("propresenter-bundle").then((l) => (l.decodePresentation && l.showsOwnLabel ? l : null)).catch(() => null);
const skip = lib ? false : "propresenter-bundle is not installed";
const files = await import("../server/presentation-files.js");

// rebuildIndex persists to ./cache, as the other index tests note.
process.chdir(await mkdtemp(path.join(os.tmpdir(), "refrain-files-index-")));

const uid = (n) => ({ string: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` });
const rtf = (body) => Buffer.from(`{\\rtf1\\ansi{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;}\n{\\colortbl;\\red255\\green255\\blue255;}\n\\pard\n\n\\f0\\fs80 \\cf1 ${body}}`, "latin1");
const box = (n, body, links) => ({ element: { uuid: uid(n), name: `Box ${n}`, text: { rtf_data: rtf(body), attributes: {} } }, ...(links ? { data_links: links } : {}) });

/** An invented presentation: two groups, an arrangement that plays the second first, the boxes the API rules are about. */
function samplePro(id, { label = "Romans 8" } = {}) {
  const { Presentation } = lib.loadSchema();
  const cue = (n, elements, extra = {}) => ({ uuid: uid(n), name: `Cue ${n}`, ...extra, actions: [{ uuid: uid(n + 100), type: 11, label: { text: label }, slide: { presentation: { base_slide: { elements } } } }] });
  const doc = {
    uuid: { string: id }, name: "Sample",
    cues: [
      cue(1, [box(11, "stale words", [{ slide_Label_Text: {} }]), box(12, "Amazing grace\\\nhow sweet")]),
      cue(2, [box(21, "{\\listtext\t1.\t}first\\\n{\\listtext\t2.\t}second")], { isEnabled: false }),
      cue(3, [box(31, "\\uc0\\u8234 3:16\\u8236  John"), box(32, "10:00", [{ timer_text: { timer_name: "Countdown" } }])]),
    ],
    cue_groups: [
      { group: { uuid: uid(201), name: "Verse" }, cue_identifiers: [uid(1), uid(2)] },
      { group: { uuid: uid(202), name: "Chorus" }, cue_identifiers: [uid(3)] },
    ],
    arrangements: [{ uuid: uid(301), name: "FS", group_identifiers: [uid(202), uid(201)] }],
    selected_arrangement: uid(301),
  };
  return Buffer.from(Presentation.encode(Presentation.fromObject(doc)).finish());
}

test("a file read gives the API's answer: label boxes as 'Slide Label', list markers kept, embedding marks gone, disabled slides counted", { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pres-file-"));
  try {
    const file = path.join(dir, "Sample.pro");
    fs.writeFileSync(file, samplePro("AAAA0000-0000-4000-8000-000000000001"));
    const doc = await files.readPresentationFile(lib, file);
    const p = doc.presentation;
    assert.equal(p.id.uuid, "AAAA0000-0000-4000-8000-000000000001");
    assert.equal(p.presentation_path, file);
    assert.equal(p.current_arrangement, uid(301).string);
    assert.deepEqual(p.arrangements, [{ id: { uuid: uid(301).string, name: "FS" }, groups: [uid(202).string, uid(201).string] }]);
    assert.deepEqual(p.groups.map((g) => [g.name, g.slides.length]), [["Verse", 2], ["Chorus", 1]]);
    const [s1, s2] = p.groups[0].slides, [s3] = p.groups[1].slides;
    assert.equal(s1.text, "Slide Label\nAmazing grace\nhow sweet", "ProPresenter reports a label box by its placeholder, whatever words it holds");
    assert.equal(s2.enabled, false, "a disabled slide is still a slide: ProPresenter counts it");
    assert.equal(s2.text.replace(/\s+/g, " ").trim(), "1. first 2. second", "the markers, as the API gives them (normalized as the index does)");
    assert.equal(s3.text, "3:16 John\n10:00", "the right-to-left embedding marks are dropped");
    assert.deepEqual([s1.liveWords, s3.liveWords], [false, true], "a timer box makes a slide's words live");
    assert.equal(await files.readPresentationFile(lib, path.join(dir, "missing.pro")), null);
    // The Go Live check reads the same file in a worker, off the main thread, and gets the same answer.
    const { runWorker } = await import("../server/run-worker.js");
    const viaWorker = await runWorker(new URL("../server/presentation-file-worker.js", import.meta.url), { workerData: { file }, ms: 30_000, tooLong: "too long" });
    assert.deepEqual(viaWorker.doc, doc);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("files are found in ProPresenter's own workspace, by name or by id, never in a clone; the per-library check counts the rest", { skip }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pres-ws-"));
  try {
    const lib1 = path.join(root, "UserWorkspaces", "Real", "Libraries", "Songs");
    const clone = path.join(root, "UserWorkspaces", "Bisect", "Libraries", "Songs");
    fs.mkdirSync(lib1, { recursive: true });
    fs.mkdirSync(clone, { recursive: true });
    const id = (n) => `BBBB0000-0000-4000-8000-00000000000${n}`;
    fs.writeFileSync(path.join(lib1, "Amazing Grace.pro"), samplePro(id(1)));
    fs.writeFileSync(path.join(lib1, "Renamed on disk.pro"), samplePro(id(2)));
    fs.writeFileSync(path.join(lib1, "Not listed.pro"), samplePro(id(9)));
    fs.writeFileSync(path.join(clone, "Amazing Grace.pro"), samplePro(id(1), { label: "clone" }));
    const items = [
      { id: id(1), name: "Amazing Grace", folder: "Songs" },
      { id: id(2), name: "Old Name", folder: "Songs" },
      { id: id(3), name: "Gone", folder: "Songs" },
    ];
    let asked = 0;
    // No previous index: one API read says where the real workspace is.
    const reading = await files.createFileReading({ lib, items, knownPaths: {}, askPath: async () => { asked += 1; return path.join(lib1, "Amazing Grace.pro"); } });
    assert.equal(asked, 1);
    assert.equal(reading.workspace, path.join(root, "UserWorkspaces", "Real"));
    assert.equal((await reading.read(id(1))).presentation.presentation_path, path.join(lib1, "Amazing Grace.pro"));
    assert.equal((await reading.read(id(2))).presentation.presentation_path, path.join(lib1, "Renamed on disk.pro"), "found by id when the name differs");
    assert.equal(await reading.read(id(3)), null);
    assert.deepEqual(await reading.summary(), { workspace: "Real", fromFiles: 2, notOnDisk: 1, libraries: [{ folder: "Songs", listed: 3, onDisk: 3, notListed: 1 }] }, "only the file no listed presentation was read from; the renamed one is accounted for");

    // A previous index's paths say which workspace is ProPresenter's: a stale path into the clone is not followed.
    const known = await files.createFileReading({ lib, items, knownPaths: { [id(2)]: path.join(lib1, "Renamed on disk.pro"), [id(1)]: path.join(clone, "Amazing Grace.pro") }, askPath: async () => assert.fail("not asked when a path is known") });
    assert.equal(known.workspace, path.join(root, "UserWorkspaces", "Real"));
    assert.equal((await known.read(id(1))).presentation.presentation_path, path.join(lib1, "Amazing Grace.pro"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the Go Live check: same count and same words is a match; a live box's words are not compared", () => {
  const s = (text, liveWords = false) => ({ text, liveWords });
  assert.deepEqual(files.compareWithLive({ liveSlides: [s("a"), s("b")], fileSlides: [s("a"), s("b")] }), { match: true, liveCount: 2, fileCount: 2, firstDifference: null });
  assert.deepEqual(files.compareWithLive({ liveSlides: [s("a"), s("12:34")], fileSlides: [s("a"), s("10:00", true)] }).match, true);
  assert.deepEqual(files.compareWithLive({ liveSlides: [s("a"), s("x")], fileSlides: [s("a"), s("b")] }), { match: false, liveCount: 2, fileCount: 2, firstDifference: 1 });
  assert.equal(files.compareWithLive({ liveSlides: [s("a")], fileSlides: [s("a"), s("b")] }).match, false);
  assert.equal(files.workspaceOfFile("/u/UserWorkspaces/W/Libraries/Songs/A.pro"), "/u/UserWorkspaces/W");
  assert.equal(files.workspaceOfFile("/u/elsewhere/A.pro"), null);
});

test("rebuildIndex reads from files and asks ProPresenter only for listings; files-only (Protect on) never asks for a presentation", { skip }, async () => {
  const { rebuildIndex, getIndex } = await import("../server/search-index.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pres-rebuild-"));
  try {
    const dir = path.join(root, "UserWorkspaces", "Real", "Libraries", "Songs");
    fs.mkdirSync(dir, { recursive: true });
    const id = (n) => `CCCC0000-0000-4000-8000-00000000000${n}`;
    fs.writeFileSync(path.join(dir, "One.pro"), samplePro(id(1)));
    fs.writeFileSync(path.join(dir, "Two.pro"), samplePro(id(2)));
    const reads = [];
    const client = {
      isLocalHost: true,
      async getLibraryDetailed() {
        return { items: [{ id: id(1), name: "One", folder: "Songs" }, { id: id(2), name: "Two", folder: "Songs" }, { id: id(3), name: "Three", folder: "Songs" }], failedFolders: [], unmatchedNames: [], availableFolders: ["Songs"] };
      },
      async getLibrary() { return (await this.getLibraryDetailed()).items; },
      async getPresentation(pid) {
        reads.push(pid);
        if (pid === id(3)) return { presentation: { current_arrangement: "", groups: [{ uuid: "g", slides: [{ text: "from the API" }] }] } };
        return { presentation: { presentation_path: path.join(dir, pid === id(1) ? "One.pro" : "Two.pro"), groups: [] } };
      },
      async getFileDates() { return { createdDate: null, modifiedDate: null }; },
    };
    const index = await rebuildIndex(client, {}, ["FS"], { fromFiles: true, pacingMs: 0 });
    // One read to learn the workspace, one for the presentation with no file; none for the other two.
    assert.deepEqual(reads, [id(1), id(3)]);
    const one = index.presentations[id(1)];
    assert.equal(one.arrangementName, "FS");
    assert.deepEqual(one.slides.map((s) => s.text), ["3:16 John 10:00", "Slide Label Amazing grace how sweet", "1. first 2. second"], "FS plays the Chorus first; normalized as the API's words are");
    assert.equal(index.presentations[id(3)].slides[0].text, "from the API");
    assert.deepEqual({ ...index.fileReading, libraries: undefined }, { workspace: "Real", fromFiles: 2, notOnDisk: 1, fromApi: 1, unchanged: 0, libraries: undefined });

    // Protect on: the previous index's paths give the workspace, and the missing one keeps what it had.
    reads.length = 0;
    const again = await rebuildIndex(client, {}, ["FS"], { fromFiles: true, filesOnly: true, pacingMs: 0 });
    assert.deepEqual(reads, [], "nothing read through ProPresenter");
    assert.equal(again.presentations[id(3)].slides[0].text, "from the API", "kept from the last index");
    assert.equal(getIndex().fileReading.fromApi, 0);

    // No readable files and Protect on: refused, never crawled through the API.
    const remote = { ...client, isLocalHost: false };
    await assert.rejects(rebuildIndex(remote, {}, [], { fromFiles: true, filesOnly: true, pacingMs: 0 }), (err) => err.protected === true);
    assert.deepEqual(reads, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the index card says where presentations were read from, quietly when all is well", async () => {
  const { renderFileReading } = await import("../public/health.js");
  assert.equal(renderFileReading({ fileReading: null, fileCheck: null }), "");
  const ok = renderFileReading({ fileReading: { fromFiles: 763, fromApi: 0, notOnDisk: 0, libraries: [{ folder: "Songs", notListed: 0 }] }, fileCheck: { checked: 4, differed: 0 } });
  assert.match(ok, /Read from ProPresenter's library files: 763 presentations\. Reading files asks nothing of ProPresenter\. Checked against ProPresenter at Go Live: 4 presentations, all the same\./);
  assert.doesNotMatch(ok, /alert/);
  const warn = renderFileReading({
    fileReading: { fromFiles: 760, fromApi: 0, notOnDisk: 3, libraries: [{ folder: "Messages <b>", notListed: 1 }] },
    fileCheck: { checked: 5, differed: 1, last: { fileCount: 27, liveCount: 29, firstDifference: null } },
  });
  assert.match(renderFileReading({ fileReading: { fromFiles: 2, unchanged: 761, fromApi: 0, notOnDisk: 0, libraries: [] }, fileCheck: null }), /library files: 2 presentations \(761 unchanged since the last read\)\./);
  const onlyExtra = renderFileReading({ fileReading: { fromFiles: 763, fromApi: 0, notOnDisk: 0, libraries: [{ folder: "Messages", notListed: 1 }] }, fileCheck: { checked: 1, differed: 0 } });
  assert.doesNotMatch(onlyExtra, /alert/, "a file ProPresenter doesn't list harms nothing: said quietly");
  assert.match(onlyExtra, /not in ProPresenter's list, so not in search either: 1 in Messages\. Checked against ProPresenter at Go Live: 1 presentation, all the same\./);
  assert.match(warn, /alert-warning/);
  assert.match(warn, /3 presentations ProPresenter listed weren't found in its library folders, so they kept what the last index had/);
  assert.match(warn, /1 in Messages &lt;b&gt;/, "a library's name is escaped");
  assert.match(warn, /1 of 5 presentations read from their files didn't match what ProPresenter played \(the last: 27 slides from the file, 29 playing\)/);
});
