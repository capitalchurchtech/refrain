/**
 * The script builder's MCP tools, as plain functions: a play's script in, the beats a show is made of, read
 * back as a script and as the booth's checklist, and a .probundle built from the church's own master slides.
 *
 * TWO QUESTIONS BEFORE ANY BUILD, because a person has to answer them: the cast's label
 * colours, from ProPresenter's own swatches, and whether the show reuses slides (a title, verse or logo slide).
 * build_script_bundle refuses until both are answered on the draft, so an assistant cannot skip asking.
 *
 * WHERE THINGS LIVE. The kinds of show come from the church's packs (packsDir/<pack>/scripts/<kind>/, a
 * template.pro and a recipe.json; Refrain ships none, they are each church's own). A draft is a JSON file in
 * the staging folder, and a built bundle is written there too, by temp file and rename, never over an
 * existing file. Nothing here writes into ProPresenter's library: the person imports the bundle.
 */
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { writeFile, rename, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  parseScript, withTitleSlides, loadScriptType, buildScriptBundle, readPayload, fileName, playScript, checklist, questions, LABEL_SWATCHES, BEAT_KINDS,
} from "propresenter-bundle/script";
import { checkPresentationBytes, readBundle } from "propresenter-bundle";

const DRAFT_ID = /^[a-f0-9-]{36}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,60}$/;

/** Every kind of show the packs offer, read fresh each call so a pack added on disk shows up at once. */
export function listTypes(packsDir) {
  const out = [];
  if (!packsDir || !existsSync(packsDir)) return out;
  for (const pack of readdirSync(packsDir).filter((p) => SAFE_NAME.test(p)).sort()) {
    const dir = path.join(packsDir, pack, "scripts");
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const key of readdirSync(dir).filter((k) => SAFE_NAME.test(k)).sort()) {
      const recipeFile = path.join(dir, key, "recipe.json");
      if (!existsSync(recipeFile) || !existsSync(path.join(dir, key, "template.pro"))) continue;
      try {
        const r = JSON.parse(readFileSync(recipeFile, "utf8"));
        out.push({ id: `${pack}/${key}`, pack, key, label: r.label ?? key, palette: r.palette ?? [], video: !!r.video, reset: !!r.reset,
          cueStyle: r.cueStyle ?? "soundboard", noteAdvanceSeconds: r.noteAdvanceSeconds ?? null, titleExtras: r.titleExtras ?? [], titleLabel: r.titleLabel ?? "Title Slide", dir: path.join(dir, key) });
      } catch { /* a broken recipe is skipped, not fatal: the others still work */ }
    }
  }
  return out;
}

function findType(packsDir, id) {
  const types = listTypes(packsDir);
  const t = types.find((x) => x.id === id) ?? (types.filter((x) => x.key === id).length === 1 ? types.find((x) => x.key === id) : null);
  if (!t) throw new Error(`No kind of show "${id}". Choose one of: ${types.map((x) => `${x.id} (${x.label})`).join(", ") || "none: the packs folder has no scripts yet"}.`);
  return t;
}

const draftsDir = (staging) => path.join(staging, "drafts");
const draftPath = (staging, id) => {
  if (!DRAFT_ID.test(id ?? "")) throw new Error("That is not a draft id.");
  return path.join(draftsDir(staging), `${id}.json`);
};
async function loadDraft(staging, id) {
  const p = draftPath(staging, id);
  if (!existsSync(p)) throw new Error(`No draft ${id}. Read the script again with parse_script.`);
  return JSON.parse(await readFile(p, "utf8"));
}
/** Temp file, then rename: a draft is never half written. */
async function saveDraft(staging, draft) {
  mkdirSync(draftsDir(staging), { recursive: true });
  const p = draftPath(staging, draft.id);
  const tmp = `${p}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(draft));
  await rename(tmp, p);
}

/** What is still to ask before building, in words to put to the person. */
function openQuestions(draft) {
  const open = [];
  const all = questions(draft.cast);
  if (!draft.answers.colors) open.push({ ...all[0], proposed: draft.cast });
  if (!draft.answers.reused) open.push(all[1]);
  return open;
}

function summary(draft, type) {
  const counts = {};
  for (const b of draft.beats) counts[b.kind] = (counts[b.kind] ?? 0) + 1;
  return {
    draft_id: draft.id, name: draft.name, type: type.id, type_label: type.label, slides: draft.beats.length, counts,
    cast: draft.cast, answers: draft.answers, ask_before_building: openQuestions(draft),
  };
}

/** parse_script: read a pasted script into a draft. */
export async function parseScriptTool({ text, type: typeId, name }, { packsDir, staging }) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Paste the script's text.");
  const type = findType(packsDir, typeId);
  const { beats, cast } = parseScript(text, { palette: type.palette, reset: type.reset, cueStyle: type.cueStyle });
  const draft = {
    id: randomUUID(), created: new Date().toISOString(), type: type.id, name: cleanName(name) || type.label,
    beats, cast, answers: { colors: false, reused: null }, titleSlide: null,
  };
  await saveDraft(staging, draft);
  return { ...summary(draft, type), script: playScript(beats), checklist: checklist(beats, type) };
}

/** preview_script: the draft read back as a play's script, with the booth's checklist. */
export async function previewScriptTool({ draft_id }, { packsDir, staging }) {
  const draft = await loadDraft(staging, draft_id);
  const type = findType(packsDir, draft.type);
  return { ...summary(draft, type), script: playScript(draft.beats), checklist: checklist(draft.beats, type) };
}

// A name the person gives (the presentation, a picture), as a plain file name: the package's own rule.
const cleanName = (s) => (typeof s === "string" ? fileName(s).slice(0, 80) : "");

/**
 * update_script_draft: the person's answers and corrections. `cast` confirms the colours (every speaker, as
 * #rrggbb); `reused` answers the reused-slides question; `edits` correct the beats list, which is where the
 * reader's mistakes are fixed.
 */
export async function updateDraftTool({ draft_id, name, cast, reused, edits }, { packsDir, staging }) {
  const draft = await loadDraft(staging, draft_id);
  const type = findType(packsDir, draft.type);
  const notes = [];
  if (name !== undefined) draft.name = cleanName(name) || draft.name;
  if (cast !== undefined) {
    if (!Array.isArray(cast)) throw new Error("cast is a list of { label, color }.");
    const byLabel = new Map(draft.cast.map((c) => [c.label, c]));
    for (const c of cast) {
      if (!byLabel.has(c?.label)) throw new Error(`No speaker "${c?.label}" in this script. The speakers are: ${draft.cast.map((x) => x.label).join(", ")}.`);
      if (!HEX.test(c.color ?? "")) throw new Error(`${c.label}: give the colour as #rrggbb.`);
      byLabel.get(c.label).color = c.color.toLowerCase();
      if (!LABEL_SWATCHES.includes(c.color.toLowerCase())) notes.push(`${c.label}'s ${c.color} is not one of ProPresenter's swatches; it will still be used.`);
    }
    draft.answers.colors = true;
  }
  if (edits !== undefined) {
    if (!Array.isArray(edits)) throw new Error("edits is a list of { op: replace | insert | delete, index, beat }.");
    // Before the title-slide answer below, and from the highest index down, so each edit's index is the slide
    // number the person saw in the last preview.
    for (const e of [...edits].sort((a, b) => (b.index ?? 0) - (a.index ?? 0))) {
      const i = Number(e.index) - 1;
      if (!Number.isInteger(i) || i < 0 || i > draft.beats.length) throw new Error(`Slide ${e.index} is not in this script (1 to ${draft.beats.length}).`);
      // Only a replacement keeps the old slide's fields; an insert is a new slide, not a copy of its neighbour.
      const beat = e.beat && typeof e.beat === "object" ? cleanBeat(e.beat, e.op === "replace" ? draft.beats[i] : null) : null;
      if (e.op === "delete" && i < draft.beats.length) draft.beats.splice(i, 1);
      else if (e.op === "insert" && beat) draft.beats.splice(i, 0, beat);
      else if (e.op === "replace" && beat && i < draft.beats.length) draft.beats[i] = beat;
      else throw new Error(`Edit for slide ${e.index}: op must be replace, insert or delete, with a beat for the first two.`);
    }
  }
  if (reused !== undefined) {
    const r = reused && typeof reused === "object" ? reused : {};
    const file = cleanName(r.title_slide ?? "");
    // The title slide opens and closes the show and releases each gag: inserted into the beats now (any put in by
    // an earlier answer come out first), and copied past the end for the extras when building.
    draft.beats = draft.beats.filter((b) => !b.titleSlide);
    if (file) draft.beats = withTitleSlides(draft.beats, { file, after: Number.isFinite(r.after) ? r.after : 3, bookend: r.bookend !== false }, type.titleLabel)
      .map((b) => (b.kind === "background" && b.file === file && !draft.beats.includes(b) ? { ...b, titleSlide: true } : b));
    draft.titleSlide = file ? { file, after: Number.isFinite(r.after) ? r.after : 3, bookend: r.bookend !== false,
      extras: Array.isArray(r.title_extras) ? r.title_extras.map((e) => cleanName(e)).filter(Boolean).slice(0, 5) : type.titleExtras } : null;
    draft.answers.reused = { title_slide: file || null, verse_slide: cleanName(r.verse_slide ?? "") || null, logo_slide: cleanName(r.logo_slide ?? "") || null, none: !file && !r.verse_slide && !r.logo_slide };
    if (draft.answers.reused.verse_slide || draft.answers.reused.logo_slide) notes.push("A reused verse or logo slide is not placed automatically yet: it is on the checklist to put in by hand.");
  }
  await saveDraft(staging, draft);
  return { ...summary(draft, type), notes };
}

/** A beat from a client, through the package's own whitelist, keeping the old one's fields it leaves out. */
function cleanBeat(b, old) {
  const merged = { ...(old ?? {}), ...b };
  if (!BEAT_KINDS.includes(merged.kind)) merged.kind = "note";
  const read = readPayload({ beats: [merged] }, [{ key: "x", label: "x" }]);
  return { ...read.beats[0], id: old?.id ?? randomUUID(), ...(old?.titleSlide ? { titleSlide: true } : {}) };
}

/**
 * build_script_bundle: the draft as a .probundle in the staging folder. Refuses while a question is open.
 * Never overwrites: a name already there gets a number.
 */
export async function buildTool({ draft_id }, { packsDir, staging }) {
  const draft = await loadDraft(staging, draft_id);
  const type = findType(packsDir, draft.type);
  const open = openQuestions(draft);
  if (open.length) {
    return { built: false, reason: "Ask the person first, then record the answers with update_script_draft.", ask_before_building: open };
  }
  const payload = readPayload({ type: "x", name: draft.name, beats: draft.beats, cast: draft.cast, titleSlide: draft.titleSlide ?? undefined }, [{ key: "x", label: type.label }]);
  if (payload.error) throw new Error(payload.error);
  const showType = loadScriptType(type.dir);
  const { buffer, count } = await buildScriptBundle({ name: payload.name, beats: payload.beats, cast: payload.cast, titleSlide: payload.titleSlide }, showType);
  const pro = readBundle(buffer).find((e) => e.name.endsWith(".pro"));
  const check = checkPresentationBytes(pro.data);
  if (!check.ok) throw new Error(`The built presentation did not pass the check (${check.error ?? "unstable on re-read"}); nothing was written.`);
  mkdirSync(staging, { recursive: true });
  let file = path.join(staging, `${payload.name}.probundle`);
  for (let n = 2; existsSync(file); n++) file = path.join(staging, `${payload.name} ${n}.probundle`);
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, buffer);
  await rename(tmp, file);
  const list = checklist(draft.beats, type);
  if (draft.answers.reused?.verse_slide) list.pictures.push({ slide: 0, file: draft.answers.reused.verse_slide, direction: "Reused verse slide: put it in by hand where the Long Verse slides are." });
  if (draft.answers.reused?.logo_slide) list.pictures.push({ slide: 0, file: draft.answers.reused.logo_slide, direction: "Reused logo slide: put it in by hand." });
  return { built: true, file, slides: count, checklist: list, next: "Import the bundle into ProPresenter (File > Import), then work through the checklist." };
}
