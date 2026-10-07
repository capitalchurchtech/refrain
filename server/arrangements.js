/**
 * Arrangement resolution and slide anchoring.
 *
 * ProPresenter's trigger API takes a bare flat slide number
 * (/v1/presentation/{uuid}/{flatIndex}/trigger) and resolves it against
 * whichever arrangement that presentation currently has selected. An
 * arrangement can reorder groups AND repeat them, so the same slide sits at
 * a different flat index under each arrangement. Verified against a real
 * library: 80 of 184 songs have more than one arrangement and 75 of those
 * have differing slide counts (e.g. one song's FS/T/Short arrangements are
 * 33/33/13 slides, where flat index 3 is a different lyric in each).
 *
 * So a flat index alone is not a durable reference to a slide. Slides carry
 * no id of their own (a slide is {enabled, notes, text, label, size}), but
 * groups do, and arrangements reference groups by uuid. The durable anchor
 * is therefore (group uuid + offset within that group), which survives both
 * an arrangement switch and a lyric edit. findLiveIndex turns that anchor
 * back into the flat index that's correct right now.
 */
import { normalizeText } from "./propresenter-client.js";

const norm = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Picks which arrangement to walk, in priority order:
 *   1. the first arrangement whose name matches `preferred` (compared
 *      case- and whitespace-insensitively, in `preferred`'s own order, so
 *      ["FS","T"] means FS wins when a song has both);
 *   2. the arrangement ProPresenter currently has selected;
 *   3. raw document order, when there's no arrangement selected or the
 *      selected one no longer exists.
 *
 * `droppedGroupRefs` counts arrangement entries pointing at groups that
 * aren't in the document. Those are skipped (they can't be rendered), which
 * shortens the flat index, so the count is surfaced rather than hidden.
 *
 * @returns {{arrangementId: string|null, arrangementName: string|null,
 *   source: "preferred"|"current"|"raw", groups: object[], droppedGroupRefs: number}}
 */
/**
 * When a presentation has one of the church's preferred arrangements (config
 * `preferredArrangements`, e.g. ["FS"]) but ProPresenter has a different one
 * selected, the two names; otherwise null. Read-only: there's no API to
 * change the selection and Refrain won't rewrite a .pro to fake one (handoff
 * §38), so this only feeds a list with Show in Editor on each.
 */
export function preferredNotSelected(presentationDoc, preferred = []) {
  const presentation = presentationDoc?.presentation ?? {};
  const arrangements = presentation.arrangements ?? [];
  let hit = null;
  for (const want of preferred ?? []) {
    hit = arrangements.find((a) => norm(a.id?.name) === norm(want) && norm(want));
    if (hit) break;
  }
  if (!hit || hit.id?.uuid === presentation.current_arrangement) return null;
  const selected = arrangements.find((a) => a.id?.uuid === presentation.current_arrangement);
  // Any preferred name counts as fine, the way the pre-service check reads
  // it: a song deliberately on T isn't wrong because FS comes first in the
  // list. "FS Message" and "T Homework" are variants of FS and T.
  if (selectedIsPreferred(selected?.id?.name, preferred)) return null;
  return { preferredName: hit.id?.name ?? null, selectedName: selected?.id?.name ?? null };
}

/** Whether an arrangement name is one of the preferred ones, or a variant ("T Homework" of "T"). */
export function selectedIsPreferred(name, preferred = []) {
  const n = norm(name);
  if (!n) return false;
  return (preferred ?? []).some((p) => norm(p) && (n === norm(p) || n.startsWith(`${norm(p)} `) || n.startsWith(`${norm(p)}(`)));
}

export function resolveArrangement(presentationDoc, preferred = []) {
  const presentation = presentationDoc?.presentation ?? {};
  const rawGroups = presentation.groups ?? [];
  const arrangements = presentation.arrangements ?? [];
  const groupsByUuid = new Map(rawGroups.map((g) => [g.uuid, g]));

  let chosen = null;
  let source = "raw";

  for (const want of preferred ?? []) {
    const wanted = norm(want);
    if (!wanted) continue;
    const hit = arrangements.find((a) => norm(a.id?.name) === wanted);
    if (hit) {
      chosen = hit;
      source = "preferred";
      break;
    }
  }

  if (!chosen && presentation.current_arrangement) {
    const hit = arrangements.find((a) => a.id?.uuid === presentation.current_arrangement);
    if (hit) {
      chosen = hit;
      source = "current";
    }
  }

  if (!chosen) {
    return {
      arrangementId: null,
      arrangementName: null,
      source: "raw",
      groups: rawGroups,
      droppedGroupRefs: 0,
    };
  }

  const refs = chosen.groups ?? [];
  const groups = refs.map((uuid) => groupsByUuid.get(uuid)).filter(Boolean);
  return {
    arrangementId: chosen.id?.uuid ?? null,
    arrangementName: chosen.id?.name ?? null,
    source,
    groups,
    droppedGroupRefs: refs.length - groups.length,
  };
}

/**
 * Walks resolved groups into the flat slide list ProPresenter would play,
 * carrying each slide's durable anchor. A repeated group contributes its
 * slides again at new flat indices, with the same groupId and the same
 * per-group offsets.
 *
 * @returns {{index: number, text: string, groupId: string|null, groupOffset: number}[]}
 */
export function flattenGroups(groups) {
  const slides = [];
  let index = 0;
  for (const group of groups ?? []) {
    let groupOffset = 0;
    for (const slide of group.slides ?? []) {
      slides.push({
        index,
        text: normalizeText(slide.text),
        groupId: group.uuid ?? null,
        // The group's own name ("Verse 1"), so a result can lead with it.
        // Absent from an index built before this existed; screens must cope.
        groupName: group.name ?? null,
        groupOffset,
      });
      index += 1;
      groupOffset += 1;
    }
  }
  return slides;
}

/**
 * The slides a song has that the indexed arrangement does not play: groups no
 * step of the chosen arrangement uses (a Tag, a second Bridge), each with the
 * first arrangement that does include its group and where it sits in that one.
 * This is what Deep Search reads. It needs no extra call to ProPresenter: it is
 * built from the same document the index already read.
 *
 * `slideIndex` and `slideCount` are null for a group that no arrangement uses
 * at all; such a slide can be found but not placed.
 *
 * @param {object} presentationDoc the document read from ProPresenter
 * @param {{groups: object[]}} resolved what resolveArrangement chose
 * @returns {{groupId: string|null, groupName: string|null, groupOffset: number, text: string,
 *   arrangementName: string|null, slideIndex: number|null, slideCount: number|null}[]}
 */
export function otherArrangementSlides(presentationDoc, resolved) {
  const presentation = presentationDoc?.presentation ?? {};
  const rawGroups = presentation.groups ?? [];
  const groupsByUuid = new Map(rawGroups.map((g) => [g.uuid, g]));
  const played = new Set((resolved?.groups ?? []).map((g) => g.uuid));
  // Each arrangement laid out once: where its first use of every group starts.
  const layouts = (presentation.arrangements ?? []).map((a) => {
    const groups = (a.groups ?? []).map((uuid) => groupsByUuid.get(uuid)).filter(Boolean);
    const starts = new Map();
    let at = 0;
    for (const g of groups) {
      if (!starts.has(g.uuid)) starts.set(g.uuid, at);
      at += (g.slides ?? []).length;
    }
    return { name: a.id?.name ?? null, starts, total: at };
  });
  const out = [];
  for (const group of rawGroups) {
    if (played.has(group.uuid)) continue;
    const home = layouts.find((l) => l.starts.has(group.uuid)) ?? null;
    (group.slides ?? []).forEach((slide, offset) => {
      const text = normalizeText(slide.text);
      if (!text) return;
      out.push({
        groupId: group.uuid ?? null,
        groupName: group.name ?? null,
        groupOffset: offset,
        text,
        arrangementName: home?.name ?? null,
        slideIndex: home ? home.starts.get(group.uuid) + offset : null,
        slideCount: home ? home.total : null,
      });
    });
  }
  return out;
}

/** Of several candidates, the one whose flat index sits closest to `near`. */
function nearest(candidates, near) {
  const target = Number.isInteger(near) ? near : 0;
  return candidates.reduce((best, c) =>
    best === null || Math.abs(c.index - target) < Math.abs(best.index - target) ? c : best
  , null);
}

/**
 * Maps a stored anchor onto the flat index that's correct for `liveSlides`
 * (i.e. for the arrangement ProPresenter has selected right now).
 *
 * Match order: the exact (groupId, groupOffset) anchor, then the slide's
 * text, then give up. In both matching steps a repeated group yields
 * several candidates, and the one nearest the originally stored index wins,
 * so clicking the second chorus still goes to the second chorus. Returns
 * null when nothing matches, letting the caller fall back to the stored
 * index rather than guessing.
 *
 * @param {{index:number,text:string,groupId:string|null,groupOffset:number}[]} liveSlides
 * @param {{groupId?: string|null, groupOffset?: number, index?: number, text?: string}} anchor
 * @returns {number|null}
 */
export function findLiveIndex(liveSlides, anchor) {
  const slides = Array.isArray(liveSlides) ? liveSlides : [];
  if (!slides.length || !anchor) return null;

  if (anchor.groupId && Number.isInteger(anchor.groupOffset)) {
    const byAnchor = slides.filter((s) => s.groupId === anchor.groupId && s.groupOffset === anchor.groupOffset);
    const hit = nearest(byAnchor, anchor.index);
    if (hit) return hit.index;
  }

  // Empty slides are common (blank/spacer slides), so an empty anchor text
  // must never match one — it would fire an arbitrary blank.
  const wantedText = normalizeText(anchor.text);
  if (wantedText) {
    const byText = slides.filter((s) => s.text === wantedText);
    const hit = nearest(byText, anchor.index);
    if (hit) return hit.index;
  }

  return null;
}

/**
 * A slide index off the wire, or null if it is not one.
 *
 * Accepts a number or a digit string, since the value arrives as JSON from our
 * own front end but has been a string in the DOM on the way there. Everything
 * else is rejected rather than coerced, and that is the whole point: `Number()`
 * maps null, "" and [] all to 0, so a caller whose slide index was simply
 * missing would have fired the first slide of the song instead of erroring --
 * silently correct-looking, and live.
 *
 * Lives here rather than beside the route because `server/index.js` calls
 * `app.listen` at module scope, so importing it to test one function boots a
 * server. That is also why the routes themselves have no unit tests.
 */
export function parseSlideIndex(value) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}
