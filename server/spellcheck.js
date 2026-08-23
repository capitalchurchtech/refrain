/**
 * Local spell checking for slide text. Uses an offline Hunspell
 * dictionary (nspell + dictionary-en), so nothing leaves the machine,
 * keeping the no-telemetry promise.
 *
 * A plain dictionary is far too noisy on worship lyrics: proper nouns
 * (Yahweh, Zion), archaic forms ('Tis, o'er), and CCLI-stylized
 * spellings would all be "wrong". So a word is only flagged when it is
 * ALL of: not in the dictionary, not in the church's own vocabulary
 * (rare across the indexed library — a real typo is usually unique),
 * and not on the user's allowlist. That surfaces genuine typos as
 * candidates to review rather than a wall of false alarms.
 */
import nspell from "nspell";
import enDictionary from "dictionary-en";

let spellerPromise = null;
function getSpeller() {
  if (!spellerPromise) spellerPromise = Promise.resolve().then(() => nspell(enDictionary));
  return spellerPromise;
}

// Words are letters (incl. common accented ranges) plus internal
// apostrophes for contractions; leading/trailing punctuation trimmed.
const WORD_RE = /[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’]*/g;

export function tokenize(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(WORD_RE)) {
    const word = m[0].replace(/^['’]+|['’]+$/g, "");
    if (word.length >= 2) out.push(word);
  }
  return out;
}

/**
 * Finds candidate typos in one slide's text.
 * @param {string} text
 * @param {object} opts
 * @param {Set<string>} opts.knownWords - lowercased words common in the library (treated as correct)
 * @param {Set<string>} opts.allowlist - lowercased words the user marked fine
 * @param {object} speller - an nspell instance
 * @returns {{word: string, suggestions: string[]}[]}
 */
export function findTypos(text, { knownWords, allowlist, speller }) {
  const flagged = [];
  const seen = new Set();
  for (const word of tokenize(text)) {
    const lower = word.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (allowlist.has(lower) || knownWords.has(lower)) continue;
    if (speller.correct(word) || speller.correct(lower)) continue;
    flagged.push({ word, suggestions: speller.suggest(word).slice(0, 4) });
  }
  return flagged;
}

/** Ready an nspell instance (call once before a batch of findTypos). */
export async function loadSpeller() {
  return getSpeller();
}

/**
 * Allowlist editing.
 *
 * The allowlist is the pressure valve for a spell checker pointed at worship
 * lyrics: names, archaic forms and CCLI spellings that are correct here but not
 * in any dictionary. Adding has to be one click from a flagged word, but a list
 * you cannot see or correct is worse than none, because one mis-click silently
 * hides a real typo forever. So these are separate, pure, and both directions.
 *
 * Words are stored lowercased, since matching is case-insensitive, and kept
 * sorted so the saved config reads sensibly and diffs cleanly.
 */

/** Splits typed input into words. Accepts commas, spaces or newlines. */
export function parseWordList(input) {
  return [
    ...new Set(
      String(input ?? "")
        .split(/[\s,;]+/)
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

/** Adds words, deduped case-insensitively, leaving the rest untouched. */
export function addToAllowlist(current, words) {
  const out = new Set((current ?? []).map((w) => String(w).toLowerCase()));
  // Normalize whichever shape arrived: an array skipping the lowercasing would
  // let "Zion" and "zion" both be stored, defeating the dedupe.
  const incoming = Array.isArray(words) ? words.map((w) => String(w).trim().toLowerCase()).filter(Boolean) : parseWordList(words);
  for (const w of incoming) out.add(w);
  return [...out].sort();
}

/** Removes words. A word that isn't there is not an error. */
export function removeFromAllowlist(current, words) {
  const drop = new Set((Array.isArray(words) ? words : parseWordList(words)).map((w) => String(w).toLowerCase()));
  return (current ?? []).map((w) => String(w).toLowerCase()).filter((w) => !drop.has(w)).sort();
}
