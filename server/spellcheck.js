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
