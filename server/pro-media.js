/**
 * Media a presentation's slides point at, and which of it is not on this Mac
 * (issue #9: "which presentations in the upcoming weekend's playlists
 * reference assets marked Missing").
 *
 * **Why the file, not the API.** ProPresenter's API reports no media at all
 * for a slide, and the Ready/Missing flag the issue cites lives in the state
 * database, which is a derived copy of these files (see orphaned-media.js).
 * So this reads the `.pro` file the API names in `presentation_path`, and
 * asks the filesystem whether each file is there. Read-only, always.
 *
 * **The format is protobuf with no schema here.** Only a handful of field
 * numbers are relied on, each one checked against real files and the API:
 *
 *   Presentation.cue_groups = 12   CueGroup { group = 1 { uuid = 1, name = 2 }, cue_identifiers = 2 }
 *   Presentation.cues       = 13   Cue { uuid = 1 }
 *   UUID                           { string = 1 }
 *   URL                            { absolute_string = 1, local = 4 { root = 1, path = 2 } }
 *
 * Group order and slide counts matched the API exactly, and the group UUIDs
 * are the same `groupId` the search index anchors slides by, so a finding
 * lands on the slide Spell Check already knows how to jump to.
 *
 * A URL is found by shape rather than by path through the cue: a message
 * whose field 1 is a `file://` string. Backgrounds, videos and images placed
 * on the slide all sit at different depths, and ProPresenter stores the same
 * reference twice in places, so references are de-duplicated per slide.
 *
 * **Embedded images decode as garbage.** Any blob of bytes parses as *some*
 * sequence of protobuf fields, and walking a thumbnail as though it were a
 * message ran a first draft out of memory on a 2,000-file library. So a blob
 * is only descended into if it decodes cleanly into a modest number of
 * fields -- a thumbnail's bytes read as thousands of tiny ones -- and each
 * slide gets a fixed budget of decodes. Size is deliberately not the test: a
 * real action that carries a large thumbnail beside its URL must still be
 * read, or its media would go unchecked.
 */

import path from "node:path";

const MAX_FIELDS = 500;
const MAX_DEPTH = 16;
// Messages decoded per slide before giving up on the rest of it. Real cues
// take a few hundred; this only stops a pathological file.
const DECODE_BUDGET = 20_000;

function readVarint(buf, i) {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (i >= buf.length) throw new Error("truncated varint");
    const byte = buf[i++];
    // Numbers here (field numbers, lengths, enums) stay well under 2^53, and
    // multiplication keeps them exact past 32 bits where `<<` would not.
    result += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [result, i];
    shift += 7;
    if (shift > 63) throw new Error("varint too long");
  }
}

/** One level of a protobuf message: its fields, with byte ranges for length-delimited ones. */
export function decodeFields(buf, start = 0, end = buf.length, maxFields = Infinity) {
  const fields = [];
  let i = start;
  while (i < end) {
    if (fields.length >= maxFields) throw new Error("too many fields");
    let key;
    [key, i] = readVarint(buf, i);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 0) throw new Error("field 0");
    if (wire === 0) {
      let value;
      [value, i] = readVarint(buf, i);
      fields.push({ field, wire, value });
    } else if (wire === 2) {
      let length;
      [length, i] = readVarint(buf, i);
      if (i + length > end) throw new Error("length past end");
      fields.push({ field, wire, start: i, end: i + length });
      i += length;
    } else if (wire === 1) {
      i += 8;
      fields.push({ field, wire });
    } else if (wire === 5) {
      i += 4;
      fields.push({ field, wire });
    } else {
      throw new Error(`wire type ${wire}`);
    }
  }
  if (i !== end) throw new Error("overran message");
  return fields;
}

function tryMessage(buf, start, end) {
  try {
    // Stops counting at the cap rather than building a million-entry array
    // for a thumbnail first and rejecting it after.
    return decodeFields(buf, start, end, MAX_FIELDS);
  } catch {
    return null;
  }
}

const text = (buf, f) => buf.toString("utf8", f.start, f.end);
const isFileUrl = (buf, f) => f.wire === 2 && f.end - f.start > 7 && buf.toString("utf8", f.start, f.start + 7) === "file://";

function uuidString(buf, f) {
  const inner = f && tryMessage(buf, f.start, f.end);
  const s = inner?.find((x) => x.field === 1 && x.wire === 2);
  return s ? text(buf, s) : null;
}

function collectUrls(buf, start, end, out, depth, budget) {
  if (depth > MAX_DEPTH || budget.left-- <= 0) return;
  const fields = tryMessage(buf, start, end);
  if (!fields) return;
  const abs = fields.find((f) => f.field === 1 && isFileUrl(buf, f));
  if (abs) {
    const local = fields.find((f) => f.field === 4 && f.wire === 2);
    const localFields = local && tryMessage(buf, local.start, local.end);
    const root = localFields?.find((f) => f.field === 1 && f.wire === 0)?.value ?? null;
    const relField = localFields?.find((f) => f.field === 2 && f.wire === 2);
    out.push({ url: text(buf, abs), root, relative: relField ? text(buf, relField) : null });
    return;
  }
  for (const f of fields) {
    if (f.wire === 2 && f.end - f.start > 2) collectUrls(buf, f.start, f.end, out, depth + 1, budget);
  }
}

/**
 * Every slide that references media, keyed the way the search index keys a
 * slide: its group's UUID and its position within that group.
 * @returns {Array<{ groupId: string, groupName: string, groupOffset: number, refs: Array<{ url: string, root: number|null, relative: string|null }> }>}
 */
export function slideMediaRefs(buf) {
  const top = decodeFields(buf);
  const cues = new Map();
  for (const f of top) {
    if (f.field !== 13 || f.wire !== 2) continue;
    const fields = tryMessage(buf, f.start, f.end);
    const id = uuidString(buf, fields?.find((x) => x.field === 1 && x.wire === 2));
    if (id) cues.set(id, f);
  }

  const slides = [];
  for (const f of top) {
    if (f.field !== 12 || f.wire !== 2) continue;
    const groupFields = tryMessage(buf, f.start, f.end);
    const group = groupFields?.find((x) => x.field === 1 && x.wire === 2);
    const groupInner = group && tryMessage(buf, group.start, group.end);
    const groupId = uuidString(buf, groupInner?.find((x) => x.field === 1 && x.wire === 2));
    const nameField = groupInner?.find((x) => x.field === 2 && x.wire === 2);
    const groupName = nameField ? text(buf, nameField) : "";
    if (!groupId) continue;
    const cueIds = (groupFields ?? []).filter((x) => x.field === 2 && x.wire === 2).map((x) => uuidString(buf, x));
    cueIds.forEach((cueId, groupOffset) => {
      const cue = cueId && cues.get(cueId);
      if (!cue) return;
      const found = [];
      collectUrls(buf, cue.start, cue.end, found, 0, { left: DECODE_BUDGET });
      const seen = new Set();
      const refs = found.filter((r) => (seen.has(r.url) ? false : seen.add(r.url)));
      if (refs.length) slides.push({ groupId, groupName, groupOffset, refs });
    });
  }
  return slides;
}

/** The path a `file://` URL names, or null if it is not one. */
export function filePathOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === "file:" ? decodeURIComponent(u.pathname) : null;
  } catch {
    return null;
  }
}

/**
 * Whether a reference resolves on this Mac, and if not, what to say about it.
 *
 * The absolute URL usually comes from whichever Mac last saved the deck, so a
 * miss on it proves nothing on its own. ProPresenter falls back to the
 * relative path under a known root, so this does too, against `mediaRoots`
 * (this Mac's ProPresenter folder and the workspace roots). Only when every
 * candidate is absent is it reported, which errs toward silence: a false
 * "missing" on Thursday teaches people to ignore the list.
 *
 * @param {{ url: string, relative: string|null }} ref
 * @param {{ exists: (p: string) => boolean, mediaRoots: string[], home: string }} env
 * @returns {null | { fileName: string, path: string, otherMac: boolean }}
 */
export function missingReference(ref, { exists, mediaRoots, home }) {
  const abs = filePathOf(ref.url);
  if (!abs) return null;
  if (exists(abs)) return null;
  if (ref.relative) {
    for (const root of mediaRoots) {
      if (exists(path.join(root, ref.relative))) return null;
    }
  }
  const homeOf = (p) => p.match(/^\/Users\/[^/]+/)?.[0] ?? null;
  const theirs = homeOf(abs);
  return {
    fileName: path.basename(abs),
    path: abs,
    // Saved on another Mac and never copied here -- the case the issue calls
    // out, where one machine of a pair has stale media.
    otherMac: Boolean(theirs && home && theirs !== home),
  };
}

/**
 * The missing media on each slide of one presentation, keyed by group anchor.
 * @returns {Map<string, Array<{ fileName: string, path: string, otherMac: boolean }>>} key `${groupId}:${groupOffset}`
 */
export function missingMediaBySlide(buf, env) {
  const bySlide = new Map();
  for (const slide of slideMediaRefs(buf)) {
    const missing = slide.refs.map((r) => missingReference(r, env)).filter(Boolean);
    if (missing.length) bySlide.set(`${slide.groupId}:${slide.groupOffset}`, missing);
  }
  return bySlide;
}
