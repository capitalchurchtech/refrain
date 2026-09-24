import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  findReferencedNames,
  workspaceRootsFromLibraryDirs,
  resolveMediaPath,
  scanOrphanedMedia,
} from "../server/orphaned-media.js";
import { formatBytes, renderOrphanResults } from "../public/health.js";

// --- findReferencedNames ---------------------------------------------------
//
// The fast matcher has to agree with the obvious one exactly: the obvious one
// is what "referenced" means, the fast one is just how it gets computed in a
// second instead of thirty.

function naive(corpus, names) {
  return new Set(
    [...new Set(names)].filter(
      (n) => corpus.includes(n) || corpus.includes(encodeURIComponent(n)) || corpus.includes(encodeURI(n))
    )
  );
}

function agrees(corpusText, names) {
  const corpus = Buffer.from(corpusText, "utf8");
  assert.deepEqual([...findReferencedNames(corpus, names)].sort(), [...naive(corpus, names)].sort());
}

test("agrees with a plain substring search on ordinary names", () => {
  agrees("xx Media/Assets/Song-Overlay.png yy Here-It-is.jpg zz", ["Song-Overlay.png", "Here-It-is.jpg", "Unused.jpg"]);
});

test("finds a name referenced only in its URL-encoded form", () => {
  // A file with a space may only appear %20-encoded inside a file:// URL.
  const corpus = Buffer.from("file:///Users/second-mac/Media/Assets/sample%20image.jpg", "utf8");
  assert.ok(findReferencedNames(corpus, ["sample image.jpg"]).has("sample image.jpg"));
  agrees("file:///Users/second-mac/Media/Assets/sample%20image.jpg", ["sample image.jpg"]);
});

test("apostrophes and parentheses match literally, the way ProPresenter stores them", () => {
  agrees("3Media/Assets/Here's-a-Photo-(Sample).jpg", ["Here's-a-Photo-(Sample).jpg"]);
});

test("non-ASCII names compare as UTF-8 bytes", () => {
  agrees("Media/Assets/Café-Morning.jpg and Nöel.mp4", ["Café-Morning.jpg", "Nöel.mp4", "Cafe-Morning.jpg"]);
});

test("names without an extension still work", () => {
  agrees("a reference to LOGOFILE in a theme", ["LOGOFILE", "OTHERFILE"]);
});

test("case matters, the same way it does to a substring search", () => {
  agrees("Media/Assets/photo.JPG", ["photo.JPG", "photo.jpg"]);
});

test("a name that is the tail of a longer referenced name counts as used", () => {
  // Over-matching is the safe direction: "foo.jpg" inside "barfoo.jpg" hides
  // a possible orphan, and never invents one.
  agrees("Media/Assets/barfoo.jpg", ["foo.jpg", "barfoo.jpg", "zfoo.jpg"]);
});

test("empty or missing input finds nothing and does not throw", () => {
  assert.equal(findReferencedNames(Buffer.alloc(0), ["a.jpg"]).size, 0);
  assert.equal(findReferencedNames(null, ["a.jpg"]).size, 0);
  assert.equal(findReferencedNames(Buffer.from("a.jpg"), []).size, 0);
});

// --- workspaceRootsFromLibraryDirs -------------------------------------------

test("derives the workspace root two levels above each library", () => {
  assert.deepEqual(
    workspaceRootsFromLibraryDirs([
      "/ws/ProPresenter/Libraries/Songs",
      "/ws/ProPresenter/Libraries/Messages",
      "/ws/Bisect/Libraries/Songs",
    ]),
    ["/ws/Bisect", "/ws/ProPresenter"]
  );
});

test("ignores anything not shaped like <workspace>/Libraries/<name>", () => {
  assert.deepEqual(workspaceRootsFromLibraryDirs(["/somewhere/else/Songs", "", null, 42]), []);
  assert.deepEqual(workspaceRootsFromLibraryDirs(undefined), []);
});

// --- resolveMediaPath ---------------------------------------------------------

test("reveals only paths inside a known workspace's Media folder", () => {
  const roots = ["/ws/ProPresenter"];
  assert.equal(resolveMediaPath(roots, "/ws/ProPresenter", "Media/Assets/a.jpg"), "/ws/ProPresenter/Media/Assets/a.jpg");
  assert.equal(resolveMediaPath(roots, "/ws/ProPresenter", "Media/../Libraries/Songs/x.pro"), null, "no climbing out of Media");
  assert.equal(resolveMediaPath(roots, "/ws/ProPresenter", "../../../etc/passwd"), null);
  assert.equal(resolveMediaPath(roots, "/ws/Other", "Media/a.jpg"), null, "root must be one the scan knows");
  assert.equal(resolveMediaPath(roots, "/ws/ProPresenter", "Media-evil/a.jpg"), null, "a sibling that merely starts with Media is not Media");
});

// --- scanOrphanedMedia, against a real folder tree --------------------------

const scratch = await mkdtemp(path.join(tmpdir(), "refrain-orphans-"));
after(async () => {
  // Undo the permission trap before removing, or rm cannot descend into it.
  await chmod(path.join(scratch, "unreadable", "ProPresenter", "Libraries", "Songs", "locked.pro"), 0o644).catch(() => {});
  await rm(scratch, { recursive: true, force: true });
});

/** Builds <scratch>/<name>/ProPresenter as a small ProPresenter-shaped workspace. */
async function workspace(name, { media = {}, files = {} } = {}) {
  const root = path.join(scratch, name, "ProPresenter");
  await mkdir(path.join(root, "Libraries", "Songs"), { recursive: true });
  for (const [rel, body] of Object.entries(media)) {
    await mkdir(path.dirname(path.join(root, "Media", rel)), { recursive: true });
    await writeFile(path.join(root, "Media", rel), body);
  }
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), body);
  }
  return root;
}

test("reports media nothing refers to, largest first, with totals", async () => {
  const root = await workspace("basic", {
    media: { "Assets/used.jpg": "u", "Assets/small-orphan.jpg": "x", "Assets/big-orphan.mov": "x".repeat(500) },
    files: { "Libraries/Songs/Song.pro": "\x12Media/Assets/used.jpg\x1a" },
  });
  const r = await scanOrphanedMedia({ libraryDirs: [path.join(root, "Libraries", "Songs")] });
  assert.equal(r.ok, true);
  const [w] = r.workspaces;
  assert.equal(w.mediaFiles, 3);
  assert.equal(w.orphanCount, 2);
  assert.equal(w.orphanBytes, 501);
  assert.deepEqual(w.orphans.map((o) => o.relPath), ["Media/Assets/big-orphan.mov", "Media/Assets/small-orphan.jpg"]);
});

test("TRAP 1: a reference from another Mac's absolute URL still counts", async () => {
  // Real booth decks point at /Users/other-mac/... and /Users/second-mac/... -- not
  // this Mac. Matching absolute paths would report every file as an orphan.
  const root = await workspace("foreign-url", {
    media: { "Assets/Song-Overlay.png": "p" },
    files: { "Libraries/Songs/Song.pro": "Kfile:///Users/other-mac/Documents/ProPresenter/Media/Assets/Song-Overlay.png" },
  });
  const r = await scanOrphanedMedia({ libraryDirs: [path.join(root, "Libraries", "Songs")] });
  assert.equal(r.workspaces[0].orphanCount, 0);
});

test("TRAP 2: the Media bin (Playlists/Media, a FILE) is a reference, not the Media folder", async () => {
  // Skipping anything whose path ends in /Media threw this file away and
  // reported 522 in-use files on the booth as orphans.
  const root = await workspace("media-bin", {
    media: { "Assets/only-in-the-bin.mp4": "v", "Assets/really-orphaned.mp4": "v" },
    files: { "Playlists/Media": "\x0aonly-in-the-bin.mp4\x12" },
  });
  const r = await scanOrphanedMedia({ libraryDirs: [path.join(root, "Libraries", "Songs")] });
  assert.deepEqual(r.workspaces[0].orphans.map((o) => o.relPath), ["Media/Assets/really-orphaned.mp4"]);
});

test("TRAP 3: one unreadable reference file fails the whole scan instead of inventing orphans", async () => {
  const root = await workspace("unreadable", {
    media: { "Assets/referenced-only-by-the-locked-file.jpg": "j" },
    files: { "Libraries/Songs/locked.pro": "Media/Assets/referenced-only-by-the-locked-file.jpg" },
  });
  const locked = path.join(root, "Libraries", "Songs", "locked.pro");
  await chmod(locked, 0o000);
  try {
    await assert.rejects(
      () => scanOrphanedMedia({ libraryDirs: [path.join(root, "Libraries", "Songs")] }),
      /EACCES|permission/i,
      "must not quietly treat an unreadable file as having no references"
    );
  } finally {
    await chmod(locked, 0o644);
  }
});

test("themes, playlists and configuration all count as references", async () => {
  const root = await workspace("elsewhere", {
    media: { "Assets/theme-bg.jpg": "t", "Assets/playlist.mp4": "p", "Assets/config-logo.png": "c" },
    files: {
      "Themes/Sunday/Theme.theme": "Media/Assets/theme-bg.jpg",
      "Playlists/Weekend": "playlist.mp4",
      "Configuration/Stage": "config-logo.png",
    },
  });
  const r = await scanOrphanedMedia({ libraryDirs: [path.join(root, "Libraries", "Songs")] });
  assert.equal(r.workspaces[0].orphanCount, 0);
});

test("dotfiles in Media are never reported, and symlinks are never followed", async () => {
  const root = await workspace("dotfiles", { media: { ".DS_Store": "junk", "Assets/.hidden.jpg": "h" } });
  await symlink("/etc", path.join(root, "Media", "Assets", "link-out")).catch(() => {});
  const r = await scanOrphanedMedia({ libraryDirs: [path.join(root, "Libraries", "Songs")] });
  assert.equal(r.workspaces[0].mediaFiles, 0);
  assert.equal(r.workspaces[0].orphanCount, 0);
});

test("a workspace with no Media folder is reported as such, not as a crash", async () => {
  const root = await workspace("no-media");
  const r = await scanOrphanedMedia({ libraryDirs: [path.join(root, "Libraries", "Songs")] });
  assert.equal(r.ok, true);
  assert.equal(r.workspaces[0].missing, true);
});

test("an index that knows no workspace says so plainly", async () => {
  const r = await scanOrphanedMedia({ libraryDirs: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /build the index/i);
});

test("the listed orphans are capped, but the totals still count all of them", async () => {
  const media = {};
  for (let i = 0; i < 12; i++) media[`Assets/o${String(i).padStart(2, "0")}.jpg`] = "x";
  const root = await workspace("capped", { media });
  const r = await scanOrphanedMedia({ libraryDirs: [path.join(root, "Libraries", "Songs")], maxListed: 5 });
  const [w] = r.workspaces;
  assert.equal(w.orphans.length, 5);
  assert.equal(w.orphanCount, 12);
  assert.equal(w.truncated, true);
});

// --- the Health card's renderers ---------------------------------------------


test("formatBytes reads the way Finder does", () => {
  assert.equal(formatBytes(500), "1 KB");
  assert.equal(formatBytes(34_600_000), "35 MB");
  assert.equal(formatBytes(4_000_000), "4.0 MB");
  assert.equal(formatBytes(121_200_000), "121 MB");
  assert.equal(formatBytes(37_000_000_000), "37.0 GB");
  assert.equal(formatBytes(-1), "0 KB");
});

test("the results always carry the look-before-you-delete caveat", () => {
  const html = renderOrphanResults({ workspaces: [{ name: "ProPresenter", root: "/ws/ProPresenter", mediaFiles: 10, orphanCount: 0, orphans: [] }] });
  assert.match(html, /all 10 media files are in use/);
  assert.match(html, /Look before you delete/);
});

test("each orphan offers Show in Finder, never a delete", () => {
  const html = renderOrphanResults({
    workspaces: [{ name: "ProPresenter", root: "/ws/ProPresenter", mediaFiles: 2189, orphanCount: 1, orphanBytes: 34_600_000,
      orphans: [{ relPath: "Media/Assets/IMG_4999.mov", bytes: 34_600_000 }] }],
  });
  assert.match(html, /1 of 2,189 files/);
  assert.match(html, /Show in Finder/);
  assert.doesNotMatch(html, /delete<\/button>|Delete<\/button>/i, "there is no delete button, by design");
  assert.match(html, /data-rel-path="Media\/Assets\/IMG_4999.mov"/);
});

test("names from disk are escaped, not rendered as markup", () => {
  const html = renderOrphanResults({
    workspaces: [{ name: "WS", root: "/ws/WS", mediaFiles: 1, orphanCount: 1, orphanBytes: 1,
      orphans: [{ relPath: 'Media/Assets/<img src=x onerror=alert(1)>.jpg', bytes: 1 }] }],
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});
