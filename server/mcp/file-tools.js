/**
 * The general tools: open any ProPresenter document (.pro, .probundle, .protheme), read it slide by slide,
 * check it, and change it, without ProPresenter and without Refrain's Bundles setting. Specific jobs (a
 * sermon, a skit, tidying a theme) are skills that use these; nothing here knows about any of them.
 *
 * NOTHING THE PERSON GAVE IS EVER CHANGED. A change is made on a working copy in the staging folder
 * (refrain_make_copy), each change is checked and written by temp file and rename, and a new presentation is written
 * there too, never over another file. Paths go through paths.js first, which keeps every tool away from
 * ProPresenter's database. A document with fields the reader does not understand can be read but not copied
 * for changing, so nothing in it is quietly lost.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { writeFile, rename, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openablePath, mediaPath, forbiddenReason } from "./paths.js";
import { describeAction, buildAction, matchesAction, workspaceIndex } from "./actions.js";

const lib = () => import("propresenter-bundle");
const COPY_ID = /^[a-f0-9-]{36}$/;
const WORDS_SHORT = 160;

/** A file name a person gives, kept to characters every file system accepts. */
const cleanName = (s) => [...String(s ?? "")].map((ch) => (ch.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(ch) ? " " : ch)).join("").replace(/\s+/g, " ").trim().slice(0, 80);
/** A slide's label: any characters a person types (a colon in "Romans 12:2"), on one line. */
const cleanLabel = (s) => [...String(s ?? "")].map((ch) => (ch.charCodeAt(0) < 32 ? " " : ch)).join("").replace(/\s+/g, " ").trim().slice(0, 120);
const short = (s) => (s.length > WORDS_SHORT ? `${s.slice(0, WORDS_SHORT)}…` : s);

async function atomicWrite(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

/** A new file in `dir` named `base` + `ext`, numbered rather than written over anything. */
function freshPath(dir, base, ext) {
  mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `${base}${ext}`);
  for (let n = 2; existsSync(file); n++) file = path.join(dir, `${base} ${n}${ext}`);
  return file;
}

const copyDir = (staging, id) => {
  if (!COPY_ID.test(id ?? "")) throw new Error("That is not a copy id. refrain_make_copy gives one.");
  const dir = path.join(staging, "copies", id);
  if (!existsSync(path.join(dir, "copy.json"))) throw new Error(`No working copy ${id}. Make one with refrain_make_copy.`);
  return dir;
};

/** The bytes a tool works on: a document the person named by path, or one of the working copies. */
async function source(args, staging) {
  if (args.copy_id) {
    const dir = copyDir(staging, args.copy_id);
    const meta = JSON.parse(readFileSync(path.join(dir, "copy.json"), "utf8"));
    const file = path.join(dir, meta.file);
    return { bytes: await readFile(file), where: file, copy: { id: args.copy_id, dir, meta } };
  }
  const file = openablePath(args.path);
  const bytes = await readFile(file);
  if (args.inside === undefined) return { bytes, where: file, copy: null };
  return { bytes: await fromPlaylist(bytes, args.inside, file), where: `${file} › ${args.inside}`, copy: null };
}

const isPlaylist = (p, bytes) => p.isZip(bytes) && p.readBundle(bytes).some((e) => e.name === "data");

/**
 * One presentation inside a playlist file, as a bundle of its own with the media it uses from the playlist,
 * so it can be read, copied and changed like any other.
 */
async function fromPlaylist(bytes, inside, file) {
  const p = await lib();
  if (!isPlaylist(p, bytes)) throw new Error(`${path.basename(file)} is not a playlist, so there is nothing inside it to open.`);
  const r = p.readPlaylistFile(bytes);
  const pro = r.entries.find((e) => e.name === inside || e.name.toLowerCase() === `${String(inside).toLowerCase().replace(/\.pro$/, "")}.pro`);
  if (!pro) throw new Error(`No presentation ${inside} in this playlist. It holds: ${r.presentations.join(", ") || "none"}.`);
  const { doc } = p.decodePresentation(pro.data);
  const used = new Set((doc.cues ?? []).flatMap(p.mediaFilesOf));
  const media = r.entries.filter((e) => r.media.includes(e.name) && used.has(e.name.split("/").pop()));
  return p.writeBundle([{ name: pro.name, data: pro.data }, ...media]);
}

/** A document decoded, whatever its kind, with what writing it back needs. */
async function decode(bytes) {
  const p = await lib();
  notesReader ??= p.notesOf;
  if (isPlaylist(p, bytes)) {
    const r = p.readPlaylistFile(bytes);
    return { kind: "proplaylist", name: r.playlists[0]?.name ?? "", unknown: Array(r.unknown).fill(null), playlist: r };
  }
  if (p.isZip(bytes) && p.readBundle(bytes).some((e) => /(^|\/)Theme$/.test(e.name))) {
    const t = p.readThemeFile(bytes);
    return { kind: "protheme", name: t.file.name ?? "", doc: t.doc, schema: t.schema, unknown: t.unknown, file: t.file, theme: t.model };
  }
  const file = p.openFile(bytes);
  const { doc, unknown, schema } = p.decodePresentation(file.pro);
  return { kind: file.kind, name: doc.name ?? "", doc, schema, unknown, file, model: p.toModel(doc) };
}

/** A presentation slide's notes as text, read with the package once it is loaded (decode loads it first). */
let notesReader = null;
const notesOf = (cue) => (notesReader && cue ? notesReader((cue.actions ?? []).find((a) => a.slide)) : "");

/** Every slide, numbered from 1 in the order ProPresenter shows them, in one shape for both kinds. */
function slidesOf(d, { full = false } = {}) {
  if (d.kind === "proplaylist") throw new Error(`This is a playlist. Name a presentation in it with inside: ${d.playlist.presentations.join(", ") || "(it holds none)"}.`);
  const box = (e) => ({ id: e.uuid, name: e.name, kind: e.kind, words: full ? e.text : short(e.text), ...(e.links?.length ? { linked_to: e.links } : {}),
    ...(full ? { role: e.role, bounds: e.bounds, font: e.fontName, font_family: e.fontFamily, size: e.fontSize, caps: e.caps, picture: e.media } : {}) });
  // Every action the slide fires besides showing itself, in plain words.
  const actions = (list) => (list ?? []).map(describeAction).filter(Boolean);
  if (d.kind === "protheme") {
    return d.theme.slides.map((s, i) => ({ number: i + 1, id: s.uuid, name: s.name, boxes: s.elements.map(box), macros: s.macros.map((m) => m.name),
      ...(full ? { size: s.size, actions: actions(d.doc.slides[i]?.actions) } : {}) }));
  }
  const cueById = full ? new Map((d.doc.cues ?? []).map((c) => [c.uuid?.string, c])) : null;
  let n = 0;
  return d.model.groups.flatMap((g) => g.slides.map((s) => ({ number: ++n, id: s.uuid, group: g.name, label: s.label, enabled: s.enabled,
    boxes: s.elements.map(box), macros: s.macros.map((m) => m.name),
    ...(full ? { media: s.media, actions: actions(cueById.get(s.uuid)?.actions), notes: notesOf(cueById.get(s.uuid)) } : {}) })));
}

const describe = (src) => (src.copy ? { copy_id: src.copy.id, file: src.where } : { file: src.where });

/**
 * A slide in a line, for the first look at a file: what it says and how many boxes, not every box. Results
 * cost the assistant's allowance, so the full list comes only when asked for (boxes: true) or a slide at a
 * time (refrain_read_slide).
 */
const brief = (s) => {
  const { boxes, enabled, macros, ...rest } = s;
  delete rest.id;
  const words = boxes.map((b) => b.words).filter(Boolean).join(" / ");
  // Only what says something: a slide's id is in refrain_read_slide, and an enabled slide or no macros is the usual case.
  return { ...rest, words: words.length > 120 ? `${words.slice(0, 120)}…` : words, boxes: boxes.length, ...(enabled === false ? { enabled } : {}), ...(macros?.length ? { macros } : {}) };
};

export async function openTool(args, { staging }) {
  const src = await source(args, staging);
  const d = await decode(src.bytes);
  if (d.kind === "proplaylist") {
    const pl = d.playlist;
    return {
      ...describe(src), kind: d.kind, name: d.name, slide_count: 0, can_change: false, unreadable_fields: d.unknown.length,
      playlists: pl.playlists, presentations: pl.presentations, media: pl.media.length, slides: [],
      next: "Open a presentation in it with inside: its file name (refrain_open, refrain_read_slide, refrain_check, refrain_make_copy). A playlist itself is read, not changed.",
    };
  }
  const slides = args.boxes === true ? slidesOf(d) : slidesOf(d).map(brief);
  return {
    ...describe(src), kind: d.kind, name: d.name, slide_count: slides.length,
    ...(d.kind === "protheme" ? { pictures: d.file.assets.map((a) => a.file) } : {
      arrangements: d.model.arrangements, media: d.model.media,
      playing_arrangement: (d.doc.arrangements ?? []).find((a) => a.uuid?.string === d.doc.selected_arrangement?.string)?.name ?? null,
    }),
    unreadable_fields: d.unknown.length,
    can_change: d.unknown.length === 0,
    slides,
  };
}

/** A slide by its number (from 1), its id, or its label or name when only one slide has it. */
function pickSlide(slides, which) {
  if (typeof which === "number" || /^\d+$/.test(String(which))) {
    const s = slides[Number(which) - 1];
    if (!s) throw new Error(`No slide ${which}. This file has slides 1 to ${slides.length}.`);
    return s;
  }
  const byId = slides.find((x) => x.id === which);
  if (byId) return byId;
  const want = String(which ?? "").trim().toLowerCase();
  const named = slides.filter((x) => (x.label ?? x.name ?? "").trim().toLowerCase() === want);
  if (named.length === 1) return named[0];
  if (named.length > 1) throw new Error(`${named.length} slides are called "${which}" (${named.map((x) => x.number).join(", ")}): give its number.`);
  throw new Error(`No slide ${which}. This file has slides 1 to ${slides.length}.`);
}

export async function readSlideTool(args, { staging }) {
  const src = await source(args, staging);
  const d = await decode(src.bytes);
  return { ...describe(src), kind: d.kind, slide: pickSlide(slidesOf(d, { full: true }), args.slide) };
}

export async function checkTool(args, { staging }) {
  const src = await source(args, staging);
  const p = await lib();
  const d = await decode(src.bytes);
  const findings = [];
  if (d.kind === "protheme") {
    const c = p.checkThemeBytes(d.file.theme);
    if (!c.ok) findings.push({ severity: "problem", code: "unreadable", slide: null, box: null, message: c.error ?? `${c.unknown.length} field(s) this reader does not understand; the theme can be read but not changed here.` });
  } else {
    findings.push(...p.checkFile(src.bytes).findings);
  }
  // Names, for tidying: a box with none, or two boxes on one slide with the same one.
  for (const s of slidesOf(d)) {
    const where = s.name ?? `${s.group} / ${s.label}`;
    const seen = new Map();
    for (const b of s.boxes) {
      if (!b.name) findings.push({ severity: "note", code: "unnamed-box", slide: where, box: b.id, message: `A ${b.kind} box with no name.` });
      else seen.set(b.name, (seen.get(b.name) ?? 0) + 1);
    }
    for (const [name, count] of seen) if (count > 1) findings.push({ severity: "note", code: "same-name", slide: where, box: name, message: `${count} boxes on this slide are all called "${name}".` });
  }
  return { ...describe(src), kind: d.kind, findings };
}

export async function makeCopyTool(args, { staging }) {
  const file = openablePath(args.path);
  const bytes = args.inside === undefined ? await readFile(file) : await fromPlaylist(await readFile(file), args.inside, file);
  const d = await decode(bytes);
  if (d.kind === "proplaylist") throw new Error("A playlist is read, not changed. Copy a presentation in it with inside: its file name.");
  if (d.unknown.length) throw new Error(`${path.basename(file)} holds ${d.unknown.length} field(s) this reader does not understand, so it is not copied for changing: something in it could be lost. It can still be opened and read.`);
  const id = randomUUID();
  const dir = path.join(staging, "copies", id);
  mkdirSync(dir, { recursive: true });
  // A presentation from inside a playlist becomes a bundle of its own, carrying its media.
  const ext = args.inside === undefined ? path.extname(file) : ".probundle";
  const name = cleanName(args.name) || `${args.inside === undefined ? path.basename(file, path.extname(file)) : path.basename(String(args.inside), ".pro")} (edited)`;
  await atomicWrite(path.join(dir, `${name}${ext}`), bytes);
  await atomicWrite(path.join(dir, "copy.json"), JSON.stringify({ source: file, file: `${name}${ext}`, kind: d.kind, made: new Date().toISOString() }));
  return { copy_id: id, file: path.join(dir, `${name}${ext}`), kind: d.kind, name, from: file };
}

/** A changed document back into the working copy, checked first. */
async function saveCopy(src, d) {
  const p = await lib();
  let out;
  if (d.kind === "protheme") out = await p.writeTheme(d.file, d.doc, d.schema);
  else {
    const pro = p.encodePresentation(d.schema, d.doc);
    const check = p.checkPresentationBytes(pro);
    if (!check.ok) throw new Error(`The changed presentation did not pass the check (${check.error ?? "unstable on re-read"}); the copy was not changed.`);
    const entries = p.readBundle(src.bytes).map((e) => (e.name === d.file.proName ? { name: e.name, data: pro } : e));
    const have = new Set(entries.map((e) => e.name));
    out = d.kind === "pro" ? pro : await p.writeBundle([...entries, ...(d.newMedia ?? []).filter((e) => !have.has(e.name))]);
  }
  await atomicWrite(src.where, out);
}

const changeable = (args) => {
  if (!args.copy_id) throw new Error("Changes are made on a working copy: make one with refrain_make_copy, then pass its copy_id.");
};

const NUMBER = (v) => typeof v === "number" && Number.isFinite(v);

/** A font's family, from a box in this file that already uses it; else the person has to say. */
function familyOf(d, name) {
  const boxes = d.kind === "protheme" ? d.theme.slides.flatMap((s) => s.elements) : d.model.groups.flatMap((g) => g.slides.flatMap((s) => s.elements));
  const family = boxes.find((e) => e.fontName === name && e.fontFamily)?.fontFamily;
  if (!family) throw new Error(`No box in this file uses ${name} yet, so its family isn't known: give font_family too (e.g. Helvetica Neue).`);
  return family;
}
const plainWords = (w) => w.replace(/\*\*/g, "").trim();

/**
 * A box whose words come from somewhere else (a linked box). One linked to its own slide's label shows the
 * label, so new words for it are the slide's new label: returns the label and a setter. Any other link that
 * supplies words is refused, naming where the words come from. Null for an ordinary box.
 */
function labelLinked(p, hit, at) {
  const from = p.linksOf(hit.wrapper).find((l) => l.words);
  if (!from) return null;
  const name = hit.element.name || hit.element.uuid?.string;
  if (from.kind === "slide_Label_Text" && !from.next) {
    if (!hit.action) throw new Error(`${at}the box "${name}" shows the slide label. In a theme, each presentation slide supplies its own label, so there are no words to set here. Nothing was saved.`);
    const a = hit.action, cue = hit.cue;
    return {
      text: a.label?.text ?? cue.name ?? "",
      set: (words) => {
        if (cue.name === (a.label?.text ?? cue.name)) cue.name = words;
        a.label = { ...(a.label ?? {}), text: words };
        return words;
      },
    };
  }
  throw new Error(`${at}the box "${name}" shows the ${from.name}, not words of its own. ${from.next ? "Change the next slide's label instead." : "Change it where it comes from."} Nothing was saved.`);
}
const boundsOf = (el) => {
  const b = el.bounds ?? {};
  return { x: b.origin?.x ?? 0, y: b.origin?.y ?? 0, width: b.size?.width ?? 0, height: b.size?.height ?? 0 };
};

/**
 * Any number of changes to boxes on a working copy, by box id: its name, its words (with a type size if
 * wanted), its position and size. All are applied in memory and checked first; if one is wrong, none is saved.
 */
export async function editBoxesTool(args, env) {
  const { staging } = env;
  changeable(args);
  if (!Array.isArray(args.changes) || !args.changes.length) throw new Error("changes is a list of { box, name, words, type_size, x, y, width, height }: the box's id and what to change.");
  const p = await lib();
  const src = await source(args, staging);
  const d = await decode(src.bytes);
  const where = new Map(p.elementsOf(d.doc).map((x) => [x.element.uuid?.string, x]));
  const done = [];
  for (const [i, c] of args.changes.entries()) {
    const at = `Change ${i + 1}`;
    const hit = where.get(c?.box);
    if (!hit) throw new Error(`${at}: no box with the id ${c?.box} in this file. Nothing was saved.`);
    const el = hit.element;
    const changed = {};
    if (c.name !== undefined) {
      const before = el.name ?? "";
      p.renameElement(d.doc, c.box, c.name);
      changed.name = [before, el.name];
    }
    if (c.words !== undefined || c.type_size !== undefined) {
      if (typeof c.words !== "string" || !c.words.trim()) throw new Error(`${at}: give the words (**double asterisks** for bold), with a type_size if it should change. Nothing was saved.`);
      if (!el.text?.rtf_data) throw new Error(`${at}: the box "${el.name || c.box}" holds no words to replace. Nothing was saved.`);
      if (c.type_size !== undefined && !(NUMBER(c.type_size) && c.type_size >= 4 && c.type_size <= 1000)) throw new Error(`${at}: type_size is points, from 4 to 1000. Nothing was saved.`);
      const label = labelLinked(p, hit, `${at}: `);
      const before = label ? label.text : p.textOf({ element: el });
      p.setText({ element: el }, p.markdownRuns(c.words), c.type_size);
      if (label) changed.label = [before, label.set(cleanLabel(plainWords(c.words)))];
      else changed.words = [before, p.textOf({ element: el })];
      if (c.type_size !== undefined) changed.type_size = c.type_size;
    }
    const move = ["x", "y", "width", "height"].filter((k) => c[k] !== undefined);
    if (move.length) {
      for (const k of move) if (!NUMBER(c[k]) || ((k === "width" || k === "height") && c[k] <= 0)) throw new Error(`${at}: ${k} must be a number${k === "width" || k === "height" ? " above 0" : ""}. Nothing was saved.`);
      const before = boundsOf(el);
      const next = { ...before, ...Object.fromEntries(move.map((k) => [k, c[k]])) };
      el.bounds = { ...el.bounds, origin: { x: next.x, y: next.y }, size: { width: next.width, height: next.height } };
      changed.position = [before, next];
    }
    // The slide editor's text settings, each where ProPresenter keeps it (package format.js).
    const text = (key, fn) => { if (c[key] !== undefined) { fn(c[key]); changed[key] = c[key]; } };
    try {
      text("text_color", (v) => p.setTextColor(hit.wrapper, v));
      text("align", (v) => p.setAlignment(hit.wrapper, v));
      text("vertical_align", (v) => p.setVerticalAlignment(hit.wrapper, v));
      text("fit", (v) => p.setTextFit(hit.wrapper, v));
      text("capitals", (v) => p.setCapitals(hit.wrapper, v));
      text("line_spacing", (v) => p.setLineSpacing(hit.wrapper, v));
      text("font", (v) => p.setFont(hit.wrapper, { name: v, family: c.font_family ?? familyOf(d, v) }));
      const look = Object.fromEntries(["fill", "outline", "outline_width", "shadow", "rotation", "opacity", "hidden", "locked"].filter((k) => c[k] !== undefined).map((k) => [k, c[k]]));
      if (Object.keys(look).length) { p.setBoxStyle(hit.wrapper, look); Object.assign(changed, look); }
      if (c.picture !== undefined) {
        if (!el.fill?.media) throw new Error("this box holds no picture to replace; add one with refrain_edit_slides add_media as a box.");
        const { info, workspace } = await newMedia(p, d, env, c.picture);
        if (info.kind === "audio") throw new Error("a sound can't fill a box.");
        el.fill.media = p.mediaObject(info, workspace, el.fill.media);
        changed.picture = info.file;
      }
      if (c.arrange !== undefined) {
        const made = p.arrangeBox(hit.base, hit.wrapper, c.arrange);
        changed.arrange = c.arrange;
        if (made) changed.new_box = made;
      }
    } catch (err) {
      throw new Error(`${at}: ${err.message} Nothing was saved.`);
    }
    if (!Object.keys(changed).length) throw new Error(`${at}: nothing to change for box ${c.box}. Nothing was saved.`);
    done.push({ box: c.box, slide: hit.slide, changed });
  }
  await saveCopy(src, d);
  return { copy_id: args.copy_id, file: src.where, changes: done };
}

/**
 * A new presentation from slides of an existing one, or of a theme: each chosen slide copied with fresh ids
 * (its macros still pointing at the same macros), new words in the boxes named, under the group named. A
 * theme slide's own pictures are carried into the bundle and pointed at the workspace's media
 * (themeSlideAsCue). The source is only read.
 */
export async function buildFromTool(args, env) {
  const { staging } = env;
  const p = await lib();
  const src = await source(args.source ?? {}, staging);
  const d = await decode(src.bytes);
  const theme = d.kind === "protheme";
  let workspace = null;
  if (theme) {
    workspace = p.themeWorkspace(d.doc);
    if (!workspace) {
      const ctx = await import("./context-tools.js");
      workspace = ctx.findWorkspaces(env).find((w) => w.source === "ProPresenter on this computer")?.folder ?? null;
    }
    if (!workspace) throw new Error("Neither the theme nor ProPresenter on this computer says which workspace its pictures belong under.");
  }
  const themeMedia = new Map();
  if (d.unknown.length) throw new Error(`${path.basename(src.where)} holds ${d.unknown.length} field(s) this reader does not understand, so nothing is built from it: something could be lost.`);
  const name = cleanName(args.name);
  if (!name) throw new Error("Give the new presentation a name.");
  if (!Array.isArray(args.slides) || !args.slides.length) throw new Error("slides is a list of { from, group, label, words }.");
  const listed = slidesOf(d);
  const cueById = new Map((d.doc.cues ?? []).map((c) => [c.uuid?.string, c]));
  const cues = [];
  const groups = [];
  for (const [i, want] of args.slides.entries()) {
    const at = pickSlide(listed, want?.from);
    let copy, before;
    if (theme) {
      const made = p.themeSlideAsCue(d.file, d.doc, at.number - 1, { workspace });
      for (const m of made.media) themeMedia.set(m.name, m);
      copy = made.cue;
      before = p.elementsOf({ slides: [d.doc.slides[at.number - 1]] });
    } else {
      const original = cueById.get(at.id);
      copy = p.freshCopy(original);
      before = p.elementsOf({ cues: [original] });
    }
    // Copies keep the order of everything, so a box is found in the copy where it was in the original.
    const after = p.elementsOf({ cues: [copy] });
    let labelFromWords = null;
    for (const [boxId, words] of Object.entries(want.words ?? {})) {
      const k = before.findIndex((x) => x.element.uuid?.string === boxId);
      if (k < 0) throw new Error(`Slide ${i + 1}: slide ${at.number} has no box ${boxId}.`);
      if (typeof words !== "string" || !after[k].element.text?.rtf_data) throw new Error(`Slide ${i + 1}: box ${boxId} takes no words, or none were given.`);
      // A box showing its slide's label takes its new words as the label.
      if (labelLinked(p, after[k], `Slide ${i + 1}: `)) labelFromWords = plainWords(words);
      p.setText({ element: after[k].element }, p.markdownRuns(words));
    }
    if (typeof want.label === "string" && labelFromWords !== null && cleanLabel(want.label) !== cleanLabel(labelFromWords)) {
      throw new Error(`Slide ${i + 1}: a box on it shows the slide label, so its words and the label must be the same ("${labelFromWords}" and "${want.label}"). Give one of them.`);
    }
    const label = typeof want.label === "string" ? want.label : labelFromWords;
    if (label !== null) {
      copy.name = cleanLabel(label);
      for (const a of copy.actions ?? []) if (a.slide) a.label = { ...(a.label ?? {}), text: copy.name };
    }
    cues.push(copy);
    const group = cleanName(want.group) || at.group || "Slides";
    if (groups.at(-1)?.name !== group) groups.push({ name: group, ids: [] });
    groups.at(-1).ids.push(copy.uuid.string);
  }
  const color = new Map((d.doc.cue_groups ?? []).map((g) => [g.group?.name, g.group?.color]));
  const doc = {
    ...(theme ? { application_info: d.doc.application_info } : d.doc), uuid: p.uuid(), name, cues,
    cue_groups: groups.map((g) => ({ group: { uuid: p.uuid(), name: g.name, ...(color.get(g.name) ? { color: color.get(g.name) } : {}) }, cue_identifiers: g.ids.map((s) => ({ string: s })) })),
    arrangements: [],
  };
  delete doc.selected_arrangement;
  const pro = p.encodePresentation(d.schema, doc);
  const check = p.checkPresentationBytes(pro);
  if (!check.ok) throw new Error(`The new presentation did not pass the check (${check.error ?? "unstable on re-read"}); nothing was written.`);
  const used = new Set(cues.flatMap(p.mediaFilesOf));
  const media = theme ? [...themeMedia.values()] : d.kind === "probundle" ? p.readBundle(src.bytes).filter((e) => e.name !== d.file.proName && used.has(e.name.split("/").pop())) : [];
  const out = await p.writeBundle([{ name: `${name}.pro`, data: pro }, ...media]);
  const file = freshPath(path.join(staging, "built"), name, ".probundle");
  await atomicWrite(file, out);
  const carried = new Set(media.map((e) => e.name.split("/").pop()));
  return { file, name, slides: cues.length, groups: groups.map((g) => g.name), media_included: [...carried], media_not_included: [...used].filter((f) => !carried.has(f)),
    next: "Import the bundle into ProPresenter (File > Import). Nothing was written into ProPresenter's library." };
}

/**
 * A macro to put on a slide, by name: from ProPresenter's workspace when there is one, else from another
 * slide in this file that already fires it. Either way it points at the macro by its id, so ProPresenter
 * finds the macro the workspace already has.
 */
async function macroByName(name, d, env) {
  const want = String(name ?? "").trim().toLowerCase();
  if (!want) throw new Error("Give the macro's name.");
  const inFile = (d.doc.cues ?? []).flatMap((c) => c.actions ?? []).find((a) => a.macro && (a.macro.identification?.parameter_name ?? "").toLowerCase() === want);
  if (inFile) return structuredClone(inFile.macro.identification);
  try {
    const ctx = await import("./context-tools.js");
    const p = await lib();
    const w = ctx.findWorkspaces(env)[0];
    if (w) {
      const r = p.readWorkspacePart("macros", readFileSync(path.join(w.folder, p.WORKSPACE_PARTS.macros)));
      const m = r.macros.find((x) => x.name.toLowerCase() === want);
      if (m) {
        const col = r.collections.find((c) => c.macros.includes(m.name));
        return { parameter_uuid: { string: m.id }, parameter_name: m.name, ...(col ? { parent_collection: { parameter_uuid: { string: col.id }, parameter_name: col.name } } : {}) };
      }
    }
  } catch { /* no workspace here: only this file's own macros can be named */ }
  throw new Error(`No macro called "${name}" in ProPresenter's workspace here or on another slide in this file. refrain_read_workspace with part macros lists them.`);
}

/**
 * A picture, video or sound the person gave, ready to put on a slide of this working copy: its info, the
 * workspace its URL points under, and its bytes queued to go into the bundle when the copy is saved.
 */
async function newMedia(p, d, env, given) {
  if (d.kind !== "probundle") throw new Error("Only a bundle carries its pictures and videos with it: make the working copy from a .probundle (or build one with refrain_build_from), then add media.");
  const file = mediaPath(given);
  const bytes = readFileSync(file);
  const info = p.mediaInfo(path.basename(file), bytes);
  let workspace = p.workspaceOf(d.doc);
  if (!workspace) {
    const ctx = await import("./context-tools.js");
    workspace = ctx.findWorkspaces(env).find((w) => w.source === "ProPresenter on this computer")?.folder ?? null;
  }
  if (!workspace) throw new Error("Neither this file's media nor ProPresenter on this computer says which workspace new media belongs under. Add it on the computer with ProPresenter, or to a bundle that already has media.");
  (d.newMedia ??= []).push({ name: p.mediaEntryName(info.file, workspace), data: bytes });
  return { info, workspace };
}

/**
 * Media of the same kind already in this file, to copy ProPresenter's settings from: a media action, and
 * for a box the media filling another box of that kind (else the action's).
 */
function likeMedia(p, d, kind) {
  const kindOf = (m) => (m?.image ? "image" : m?.video ? "video" : m?.audio ? "audio" : null);
  const action = (d.doc.cues ?? []).flatMap((c) => c.actions ?? []).find((a) => kindOf(a.media?.element) === kind) ?? null;
  const box = p.elementsOf(d.doc).find((x) => kindOf(x.element.fill?.media) === kind)?.element.fill.media ?? null;
  return { action, media: box ?? action?.media.element ?? null };
}
const mediaFile = (m) => (m?.url?.local?.path ?? m?.url?.absolute_string ?? "").split("/").pop().replace(/%20/g, " ");

/** ProPresenter's workspace on this computer, read for action names and its macros' examples; null without one. */
async function actionIndex(p, env) {
  const ctx = await import("./context-tools.js");
  const w = ctx.findWorkspaces(env).find((x) => x.source === "ProPresenter on this computer") ?? ctx.findWorkspaces(env)[0];
  if (!w) return { value: null };
  const real = realpathSync(w.folder);
  if (forbiddenReason(real)) throw new Error(`Not read: ${forbiddenReason(real)}. This never reads ProPresenter's database.`);
  return { value: workspaceIndex(p, real) };
}

const MOVES = ["up", "down", "first", "last", "duplicate", "delete"];

/**
 * Changes to whole slides on a working copy: label and its colour, on or off, background colour, which
 * group, its place in the group, a copy, removal, macros on and off; and the groups and the presentation's
 * name. Slides are named by their number when the copy was opened, or their id. All checked first; if one
 * is wrong, none is saved.
 */
export async function editSlidesTool(args, env) {
  changeable(args);
  const p = await lib();
  const src = await source(args, env.staging);
  const d = await decode(src.bytes);
  const theme = d.kind === "protheme";
  const listed = slidesOf(d);
  const done = [];
  const notes = [];
  const say = (msg) => { throw new Error(`${msg} Nothing was saved.`); };
  // Each slide found before anything moves, so numbers mean what the person saw.
  const targets = (args.changes ?? []).map((c, i) => {
    const s = pickSlide(listed, c?.slide);
    const item = theme ? d.doc.slides[s.number - 1] : d.doc.cues.find((x) => x.uuid?.string === s.id);
    return { c, at: `Change ${i + 1} (slide ${s.number})`, item, number: s.number };
  });
  const groupOf = (cue) => (d.doc.cue_groups ?? []).find((g) => (g.cue_identifiers ?? []).some((u) => u.string === cue.uuid?.string));
  let index = null; // ProPresenter's workspace names, read once, only if an action is added
  const slideAction = (cue) => (cue.actions ?? []).find((a) => a.slide);
  const base = (item) => (theme ? item.base_slide : slideAction(item)?.slide?.presentation?.base_slide);

  for (const { c, at, item } of targets) {
    const changed = {};
    if (c.label !== undefined) {
      const label = cleanLabel(c.label);
      if (theme) { changed.label = [item.name ?? "", label]; item.name = label; }
      else {
        const a = slideAction(item);
        changed.label = [a?.label?.text ?? item.name ?? "", label];
        if (a) a.label = { ...(a.label ?? {}), text: label };
        item.name = label;
      }
    }
    if (c.label_color !== undefined) {
      if (theme) say(`${at}: a theme slide has no label colour.`);
      const a = slideAction(item);
      const col = p.parseColor(c.label_color);
      a.label = { ...(a.label ?? {}), ...(col ? { color: col } : {}) };
      if (!col) delete a.label.color;
      changed.label_color = c.label_color;
    }
    if (c.notes !== undefined) {
      if (theme) say(`${at}: a theme slide has no notes.`);
      const a = slideAction(item);
      try { p.setNotes(a, c.notes); } catch (err) { say(`${at}: ${err.message}`); }
      changed.notes = p.notesOf(a);
    }
    if (c.enabled !== undefined) {
      if (theme) say(`${at}: a theme slide can't be switched off.`);
      item.isEnabled = Boolean(c.enabled);
      changed.enabled = item.isEnabled;
    }
    if (c.background !== undefined) {
      const b = base(item);
      if (!b) say(`${at}: this slide has no slide of its own to colour.`);
      const col = p.parseColor(c.background);
      b.draws_background_color = Boolean(col);
      if (col) b.background_color = col;
      changed.background = c.background;
    }
    for (const name of [].concat(c.add_macro ?? [])) {
      if (theme) say(`${at}: put macros on presentation slides, not theme slides.`);
      const identification = await macroByName(name, d, env).catch((err) => say(`${at}: ${err.message}`));
      item.actions = [...(item.actions ?? []), { uuid: p.uuid(), isEnabled: true, type: 23, macro: { identification } }];
      (changed.macros_added ??= []).push(identification.parameter_name);
    }
    for (const spec of [].concat(c.add_action ?? [])) {
      if (theme) say(`${at}: put actions on presentation slides, not theme slides.`);
      index ??= await actionIndex(p, env);
      try { item.actions = [...(item.actions ?? []), buildAction(String(spec?.kind ?? "").toLowerCase(), spec ?? {}, index.value, p)]; } catch (err) { say(`${at}: ${err.message}`); }
      (changed.actions_added ??= []).push(describeAction(item.actions.at(-1)));
    }
    for (const spec of [].concat(c.remove_action ?? [])) {
      const kind = String(spec?.kind ?? "").toLowerCase();
      const before = (item.actions ?? []).length;
      item.actions = (item.actions ?? []).filter((a) => !matchesAction(a, kind, spec?.name));
      if (item.actions.length === before) say(`${at}: no ${kind}${spec?.name ? ` "${spec.name}"` : ""} action on this slide.`);
      (changed.actions_removed ??= []).push({ kind, ...(spec?.name ? { name: spec.name } : {}), count: before - item.actions.length });
    }
    for (const name of [].concat(c.remove_macro ?? [])) {
      const before = (item.actions ?? []).length;
      item.actions = (item.actions ?? []).filter((a) => !(a.macro && (a.macro.identification?.parameter_name ?? "").toLowerCase() === String(name).toLowerCase()));
      if (item.actions.length === before) say(`${at}: no macro "${name}" on this slide.`);
      (changed.macros_removed ??= []).push(name);
    }
    for (const m of [].concat(c.add_media ?? [])) {
      if (theme) say(`${at}: put media on presentation slides; a theme slide's pictures are its boxes.`);
      const { info, workspace } = await newMedia(p, d, env, m?.file).catch((err) => say(`${at}: ${err.message}`));
      const as = m.as ?? "background";
      if (as === "box") {
        const b = base(item);
        const bounds = ["x", "y", "width", "height"].every((k) => typeof m[k] === "number") ? { x: m.x, y: m.y, width: m.width, height: m.height } : undefined;
        try { b.elements = [p.mediaBox(info, workspace, { name: m.name, bounds, like: likeMedia(p, d, info.kind).media }), ...(b.elements ?? [])]; } catch (err) { say(`${at}: ${err.message}`); }
      } else {
        try { item.actions = [...(item.actions ?? []), p.mediaAction(info, workspace, { layer: as, like: likeMedia(p, d, info.kind).action })]; } catch (err) { say(`${at}: ${err.message}`); }
      }
      (changed.media_added ??= []).push({ file: info.file, as: info.kind === "audio" ? "sound" : as });
    }
    for (const name of [].concat(c.remove_media ?? [])) {
      const want = String(name).toLowerCase();
      const before = (item.actions ?? []).length + (base(item)?.elements ?? []).length;
      if (!theme) item.actions = (item.actions ?? []).filter((a) => !(a.media && mediaFile(a.media.element).toLowerCase() === want));
      const b = base(item);
      if (b) b.elements = (b.elements ?? []).filter((e) => !(e.element?.fill?.media && mediaFile(e.element.fill.media).toLowerCase() === want));
      if ((item.actions ?? []).length + (b?.elements ?? []).length === before) say(`${at}: no media "${name}" on this slide.`);
      (changed.media_removed ??= []).push(name);
    }
    if (c.group !== undefined) {
      if (theme) say(`${at}: theme slides have no groups.`);
      const name = cleanLabel(c.group);
      if (!name) say(`${at}: give the group's name.`);
      const from = groupOf(item);
      let to = (d.doc.cue_groups ?? []).find((g) => g.group?.name === name);
      if (!to) {
        to = { group: { uuid: p.uuid(), name }, cue_identifiers: [] };
        d.doc.cue_groups = [...(d.doc.cue_groups ?? []), to];
        if ((d.doc.arrangements ?? []).length) notes.push(`New group "${name}" is not in this presentation's arrangements yet; add it in ProPresenter if an arrangement should play it.`);
      }
      if (from !== to) {
        if (from) from.cue_identifiers = from.cue_identifiers.filter((u) => u.string !== item.uuid.string);
        to.cue_identifiers.push({ string: item.uuid.string });
      }
      changed.group = name;
    }
    if (c.move !== undefined) {
      if (!MOVES.includes(c.move)) say(`${at}: move is ${MOVES.join(", ")}.`);
      const list = theme ? d.doc.slides : groupOf(item)?.cue_identifiers;
      if (!list) say(`${at}: this slide is in no group, so it has no place to move within.`);
      const i = theme ? list.indexOf(item) : list.findIndex((u) => u.string === item.uuid.string);
      if (c.move === "delete") {
        list.splice(i, 1);
        if (!theme) d.doc.cues = d.doc.cues.filter((x) => x !== item);
      } else if (c.move === "duplicate") {
        const copy = p.freshCopy(item);
        if (theme) list.splice(i + 1, 0, copy);
        else { d.doc.cues.push(copy); list.splice(i + 1, 0, { string: copy.uuid.string }); }
        changed.new_slide = theme ? copy.base_slide?.uuid?.string : copy.uuid.string;
      } else {
        const [it] = list.splice(i, 1);
        const to = { up: Math.max(0, i - 1), down: Math.min(list.length, i + 1), first: 0, last: list.length }[c.move];
        list.splice(to, 0, it);
      }
      changed.move = c.move;
    }
    if (!Object.keys(changed).length) say(`${at}: nothing to change.`);
    done.push({ slide: listed[targets.find((t) => t.c === c).number - 1].number, changed });
  }

  const groupChanges = [];
  for (const [i, g] of (args.groups ?? []).entries()) {
    if (theme) say("A theme has no groups.");
    const found = (d.doc.cue_groups ?? []).find((x) => x.group?.name === g?.name);
    if (!found) say(`Group change ${i + 1}: no group "${g?.name}".`);
    if (g.rename !== undefined) { const n = cleanLabel(g.rename); if (!n) say(`Group change ${i + 1}: give the new name.`); found.group.name = n; }
    if (g.color !== undefined) { const col = p.parseColor(g.color); if (col) found.group.color = col; else delete found.group.color; }
    groupChanges.push({ group: g.name, ...(g.rename !== undefined ? { rename: found.group.name } : {}), ...(g.color !== undefined ? { color: g.color } : {}) });
  }
  // Arrangements: the order groups play in. Created or replaced with { name, groups }, renamed, deleted; and
  // which one plays when the presentation is opened.
  const arrangementChanges = [];
  const groupByName = (n) => (d.doc.cue_groups ?? []).find((g) => g.group?.name === n);
  for (const [i, a] of (args.arrangements ?? []).entries()) {
    if (theme) say("A theme has no arrangements.");
    const at = `Arrangement change ${i + 1}`;
    const name = cleanLabel(a?.name);
    if (!name) say(`${at}: give the arrangement's name.`);
    d.doc.arrangements ??= [];
    let found = d.doc.arrangements.find((x) => x.name === name);
    if (a.delete === true) {
      if (!found) say(`${at}: no arrangement "${name}".`);
      d.doc.arrangements = d.doc.arrangements.filter((x) => x !== found);
      if (d.doc.selected_arrangement?.string === found.uuid?.string) delete d.doc.selected_arrangement;
      arrangementChanges.push({ arrangement: name, deleted: true });
      continue;
    }
    if (a.groups !== undefined) {
      if (!Array.isArray(a.groups) || !a.groups.length) say(`${at}: groups is the list of group names, in the order they play.`);
      const ids = a.groups.map((g) => { const found = groupByName(cleanLabel(g)); if (!found) say(`${at}: no group "${g}" in this presentation.`); return { string: found.group.uuid.string }; });
      if (!found) { found = { uuid: p.uuid(), name, group_identifiers: [] }; d.doc.arrangements.push(found); }
      found.group_identifiers = ids;
    } else if (!found) say(`${at}: no arrangement "${name}"; to make one, give its groups.`);
    if (a.rename !== undefined) { const n = cleanLabel(a.rename); if (!n) say(`${at}: give the new name.`); found.name = n; }
    arrangementChanges.push({ arrangement: found.name, groups: (found.group_identifiers ?? []).map((u) => (d.doc.cue_groups ?? []).find((g) => g.group?.uuid?.string === u.string)?.group.name ?? "(missing group)") });
  }
  if (args.play_arrangement !== undefined) {
    if (theme) say("A theme has no arrangements.");
    if (args.play_arrangement === "none" || args.play_arrangement === null) delete d.doc.selected_arrangement;
    else {
      const a = (d.doc.arrangements ?? []).find((x) => x.name === cleanLabel(args.play_arrangement));
      if (!a) say(`No arrangement "${args.play_arrangement}" to play.`);
      d.doc.selected_arrangement = { string: a.uuid.string };
    }
  }
  if (args.name !== undefined) {
    if (theme) say("A theme's name is its file's; rename the file instead.");
    const n = cleanLabel(args.name);
    if (!n) say("Give the presentation's new name.");
    d.doc.name = n;
  }
  if (!done.length && !groupChanges.length && !arrangementChanges.length && args.play_arrangement === undefined && args.name === undefined) throw new Error("Nothing to change: give changes (to slides), groups, arrangements, play_arrangement or name.");
  await saveCopy(src, d);
  return {
    copy_id: args.copy_id, file: src.where, slides: done, groups: groupChanges,
    ...(arrangementChanges.length ? { arrangements: arrangementChanges } : {}),
    ...(args.play_arrangement !== undefined ? { playing_arrangement: (d.doc.arrangements ?? []).find((a) => a.uuid?.string === d.doc.selected_arrangement?.string)?.name ?? null } : {}),
    ...(args.name !== undefined ? { name: d.doc.name } : {}), ...(notes.length ? { notes } : {}),
  };
}
