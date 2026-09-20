/**
 * Follow module — candidate song matching for the Phase 1 harness.
 *
 * This exists to answer the only question Phase 1 actually asks: not "is
 * this transcript accurate?" but "could this transcript have found the
 * right song?" Whisper's output on sung vocals is wrong often enough that
 * reading it tells you very little; what matters is whether it's
 * DISTINCTIVE enough to pick one song out of a few hundred.
 *
 * So this is deliberately a measuring instrument, not the eventual Phase 2
 * matcher. It never triggers anything. It scores the library against a
 * rolling window of transcript words and reports a ranked list, which the
 * Follow screen shows beside the song ProPresenter actually has live — so
 * "did it pick the right one, and how fast did it converge?" is something
 * you can watch rather than guess at.
 *
 * Why not reuse search()? `search()` in search-index.js is an exact
 * case-insensitive substring match — exactly right for a human who types a
 * line they heard correctly, and useless against a transcript that renders
 * "Jireh" as "driver". Same index, different matching layer.
 *
 * Scoring is IDF-weighted word coverage: a word shared by half the library
 * ("the", "praise") says almost nothing about which song is playing, while
 * a rare one ("jireh", "gethsemane") nearly settles it. Score is the share
 * of the transcript's total "distinctiveness" the song accounts for, so it
 * stays comparable as the window grows.
 */
import { foldApostrophes, unifyApostrophes } from "./search-index.js";

// Lyrics are saturated with these; they carry no information about which
// song is being sung, and including them would let long songs win on bulk.
const STOPWORDS = new Set(
  ("a all an and are as at be been but by can come could did do does for from get go had has have he her here him his how i if in into is it its just know let like me my no not now of oh on one or our out over say see she so some take than that the their them then there these they this to too up us was we were what when where which who will with would you your yours".split(
    " "
  ))
);

/** Normalized, de-punctuated, stopword-free word list. Shared by both sides so they tokenize identically. */
export function tokenize(text) {
  return foldApostrophes(unifyApostrophes(String(text ?? "")))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/**
 * Build the searchable song corpus from the live search index.
 *
 * @param {object} presentations  currentIndex.presentations (id -> entry)
 * @param {string[]|null} folders  Library folders to treat as songs; null = all.
 *   Scoping this to the song folders is what stops a transcript latching onto
 *   a sermon slide that happens to share a phrase.
 */
export function buildSongCorpus(presentations, folders = null) {
  const folderSet = folders && folders.length ? new Set(folders) : null;
  const docs = [];
  const df = new Map(); // word -> how many songs contain it

  for (const [presentationId, entry] of Object.entries(presentations ?? {})) {
    if (folderSet && !folderSet.has(entry.folder)) continue;
    const slides = (entry.slides ?? []).map((s) => ({
      index: s.index,
      text: s.text ?? "",
      groupId: s.groupId ?? null,
      groupOffset: s.groupOffset ?? null,
      words: new Set(tokenize(s.text)),
    }));
    if (!slides.length) continue;

    const words = new Set();
    for (const slide of slides) for (const w of slide.words) words.add(w);
    if (!words.size) continue;

    for (const w of words) df.set(w, (df.get(w) ?? 0) + 1);
    docs.push({
      presentationId,
      name: entry.name ?? null,
      folder: entry.folder ?? null,
      arrangementName: entry.arrangementName ?? null,
      slides,
      words,
    });
  }

  return { docs, df, totalDocs: docs.length };
}

/**
 * Inverse document frequency. A word in every song approaches 0; a word in
 * one song scores high. `+1` keeps an unseen word finite rather than Infinity.
 */
export function idf(word, corpus) {
  const seen = corpus.df.get(word) ?? 0;
  return Math.log((corpus.totalDocs + 1) / (seen + 1));
}

/**
 * Rank songs against a rolling window of transcript words.
 *
 * @returns {Array<{presentationId, name, folder, score, matchedWords, bestSlide}>}
 *   `score` is 0..1 — the fraction of the transcript's total distinctiveness
 *   this song accounts for. `bestSlide` is that song's strongest single slide,
 *   carrying the (groupId, groupOffset) anchor Phase 2 would track position
 *   with. Empty array when there's nothing informative to go on.
 */
export function rankCandidates(transcriptWords, corpus, { limit = 5 } = {}) {
  const words = [...new Set(transcriptWords ?? [])].filter((w) => !STOPWORDS.has(w));
  if (!words.length || !corpus?.docs?.length) return [];

  const weights = new Map(words.map((w) => [w, idf(w, corpus)]));
  const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return [];

  const ranked = [];
  for (const doc of corpus.docs) {
    let score = 0;
    const matchedWords = [];
    for (const w of words) {
      if (doc.words.has(w)) {
        score += weights.get(w);
        matchedWords.push(w);
      }
    }
    if (!matchedWords.length) continue;
    ranked.push({
      presentationId: doc.presentationId,
      name: doc.name,
      folder: doc.folder,
      // `weight` is the raw distinctiveness actually accounted for, and it is
      // what ranks. `score` is the share of the window explained, which reads
      // well in the UI but is NOT discriminative on its own: a song matching
      // three throwaway words scores 1.0 exactly like a song matching two rare
      // ones, so ranking on it would call "all my life" a confident hit.
      weight: score,
      score: score / totalWeight,
      matchedWords,
      bestSlide: bestSlideFor(doc, matchedWords, weights),
    });
  }

  // Sorted by evidence, not coverage. The gap between first and second is the
  // signal that actually matters for song ID — a narrow margin means "still
  // deciding", which is why Phase 2 should accumulate across windows rather
  // than commit on one.
  ranked.sort((a, b) => b.weight - a.weight || (a.name ?? "").localeCompare(b.name ?? ""));
  return ranked.slice(0, limit);
}

/** The single slide in a song accounting for most of the matched weight — the position hint. */
function bestSlideFor(doc, matchedWords, weights) {
  let best = null;
  let bestScore = 0;
  for (const slide of doc.slides) {
    let score = 0;
    for (const w of matchedWords) if (slide.words.has(w)) score += weights.get(w) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = slide;
    }
  }
  if (!best) return null;
  return {
    slideIndex: best.index,
    text: best.text,
    groupId: best.groupId,
    groupOffset: best.groupOffset,
  };
}
