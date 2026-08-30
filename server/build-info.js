/**
 * Which code is actually running.
 *
 * The crash report's most valuable single field is the commit, because without
 * it every other field is guesswork about which version produced the stack. A
 * church install updates by `git pull`, so the working tree is the truth and
 * the package version alone is not: two machines can both say v0.11.0 and be
 * eleven commits apart.
 *
 * Read from `.git` directly rather than by shelling out to git. Three reasons,
 * and the first is the one that matters: this runs at boot on a machine that
 * may not have git on its PATH even though the repo was cloned by something
 * that did. It also avoids spawning a process during startup, and it cannot
 * hang on a git lock held by an editor.
 *
 * Every field degrades to null rather than throwing. A tarball install with no
 * `.git` is a legitimate way to run this, and boot must not care.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolves HEAD to a commit SHA.
 *
 * `.git/HEAD` is either a raw SHA (detached) or `ref: refs/heads/<branch>`.
 * The ref may live as a loose file, or only in `packed-refs` if the repo has
 * been gc'd -- which a long-lived church install eventually will be, so the
 * packed case is not exotic.
 */
export function readGitHead(gitDir = ".git") {
  try {
    if (!existsSync(gitDir)) return { commit: null, branch: null };
    const head = readFileSync(join(gitDir, "HEAD"), "utf-8").trim();

    if (!head.startsWith("ref:")) {
      return { commit: head || null, branch: null };
    }

    const ref = head.slice(4).trim();
    const branch = ref.replace(/^refs\/heads\//, "") || null;

    const loose = join(gitDir, ref);
    if (existsSync(loose)) {
      return { commit: readFileSync(loose, "utf-8").trim() || null, branch };
    }

    // Packed refs: lines of "<sha> <ref>", plus comments and peeled "^" lines.
    const packedPath = join(gitDir, "packed-refs");
    if (existsSync(packedPath)) {
      for (const line of readFileSync(packedPath, "utf-8").split("\n")) {
        if (!line || line.startsWith("#") || line.startsWith("^")) continue;
        const [sha, name] = line.trim().split(/\s+/);
        if (name === ref) return { commit: sha || null, branch };
      }
    }
    return { commit: null, branch };
  } catch {
    return { commit: null, branch: null };
  }
}

/** Short form, for a report a human reads. */
export function shortCommit(commit) {
  return typeof commit === "string" && commit.length >= 7 ? commit.slice(0, 7) : null;
}

/**
 * The whole identity, assembled once at boot.
 *
 * `dirty` is deliberately absent rather than guessed. Detecting a dirty tree
 * means running git, and a wrong answer here is worse than no answer: it would
 * send someone looking for uncommitted changes that do not exist, or reassure
 * them the tree is clean when it is not. If a church install is modified in
 * place, the commit plus a stack that does not match it is the signal.
 */
export function buildInfo({ version, gitDir = ".git" } = {}) {
  const { commit, branch } = readGitHead(gitDir);
  return {
    version: version ?? null,
    commit,
    commitShort: shortCommit(commit),
    branch,
    gitInstall: existsSync(gitDir),
  };
}
