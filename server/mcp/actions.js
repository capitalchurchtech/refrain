/**
 * A slide's actions, beyond the slide itself: read in plain words, and added or removed by name. Media and
 * macros have their own fields (file-tools.js); this is the rest a slide can fire: clear a layer, a Look,
 * a timer, a message, a prop, a clear group. A stage layout is shown, but never added: the team switches
 * stage layouts through its macros (owner, 2026-11-04), so one on a slide is an old reference.
 *
 * A new action copies one of its kind from the church's own macros when the workspace has one, so it keeps
 * the settings ProPresenter writes for that kind (a prop's auto-clear, which stage screens a layout goes to),
 * then points it at the thing named. Without an example it is built from the fields ProPresenter's own
 * actions carry. Names are looked up in ProPresenter's workspace, read only; never written.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// The type numbers ProPresenter writes, as its own macros have them.
export const TYPE = { stage: 1, media: 2, timer: 3, communication: 4, clear: 5, prop: 6, message: 8, slide: 11, audience_look: 18, slide_destination: 22, macro: 23, clear_group: 24 };
const CLEAR = ["all", "audio", "background", "live_video", "prop", "slide", "logo", "messages", "audio_effects"];
const TIMER = ["start", "stop", "reset", "reset_and_start", "stop_and_reset", "increment"];
const KIND_NAMES = { audience_look: "look", clear_group: "clear group", stage: "stage layout", slide_destination: "slide destination" };
const ce = (x) => x?.parameter_name ?? null;
// An enum as decoded (a number) or spelled out ("ACTION_RESET_AND_START"): the longest name it ends with, so
// RESET_AND_START is not read as START.
const enumIndex = (v, list) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").toLowerCase();
  let best = -1;
  list.forEach((n, i) => { if ((s === n || s.endsWith(`_${n}`)) && (best < 0 || n.length > list[best].length)) best = i; });
  return Math.max(0, best);
};
const LAYERS = ["background", "foreground", "fill", "input"];

/** What one action does, in plain words. The slide's own action is not one a person adds, so it is null. */
export function describeAction(a) {
  if (a.slide) return null;
  const on = a.isEnabled === false ? { off: true } : {};
  if (a.media) {
    const file = (a.media.element?.url?.local?.path ?? a.media.element?.url?.absolute_string ?? "").split("/").pop().replace(/%20/g, " ");
    return { kind: "media", file, layer: a.media.element?.audio && !a.media.element?.video ? "sound" : LAYERS[enumIndex(a.media.layer_type ?? 0, LAYERS)] ?? "background", ...on };
  }
  if (a.macro) return { kind: "macro", name: ce(a.macro.identification), ...on };
  if (a.clear) return { kind: "clear", what: CLEAR[enumIndex(a.clear.target_layer, CLEAR)] ?? "all", ...on };
  if (a.timer) return { kind: "timer", name: ce(a.timer.timer_identification), do: TIMER[enumIndex(a.timer.action_type, TIMER)] ?? "start", ...on };
  if (a.message) return { kind: "message", name: ce(a.message.message_identificaton), ...on };
  if (a.prop) return { kind: "prop", name: ce(a.prop.identification), ...on };
  if (a.audience_look) return { kind: "look", name: ce(a.audience_look.identification), ...on };
  if (a.clear_group) return { kind: "clear group", name: ce(a.clear_group.identification), ...on };
  if (a.stage) return { kind: "stage layout", old: true, screens: (a.stage.stage_screen_assignments ?? []).map((s) => ({ screen: ce(s.screen), layout: ce(s.layout) })), ...on };
  if (a.communication) return { kind: "communication", device: ce(a.communication.device_identification), description: a.communication.description ?? null, ...on };
  const k = Object.keys(a).find((x) => !["uuid", "name", "isEnabled", "type", "label", "delay_time", "duration"].includes(x));
  return { kind: KIND_NAMES[k] ?? (k ?? "other").replace(/_/g, " "), ...on };
}

/** The names a slide can point an action at, from ProPresenter's workspace, with the macros' own examples. */
export function workspaceIndex(p, folder) {
  const { root } = p.loadSchema();
  const read = (file, type) => {
    const f = path.join(folder, file);
    if (!existsSync(f)) return {};
    const T = root.lookupType(type);
    return T.toObject(T.decode(readFileSync(f)), { longs: String, enums: Number, bytes: Buffer, defaults: false });
  };
  const byName = (list, nameOf = (x) => x.name) => new Map((list ?? []).filter((x) => nameOf(x)).map((x) => [nameOf(x).toLowerCase(), x]));
  const ws = read("Configuration/Workspace", "rv.data.ProPresenterWorkspace");
  const props = read("Configuration/Props", "rv.data.PropDocument");
  const macros = read("Configuration/Macros", "rv.data.MacrosDocument");
  const examples = {};
  for (const a of (macros.macros ?? []).flatMap((m) => m.actions ?? [])) for (const k of Object.keys(TYPE)) if (a[k] && !examples[k]) examples[k] = a;
  return {
    looks: byName(ws.audience_looks),
    screens: byName(ws.pro_screens),
    stageScreens: (ws.pro_screens ?? []).filter((s) => s.screen_type === 2),
    layouts: byName(read("Configuration/Stage", "rv.data.Stage.Document").layouts),
    props: byName(props.cues),
    propCollection: (id) => (props.prop_collections ?? []).find((c) => (c.items ?? []).some((i) => i.prop_cue_uuid?.string === id)) ?? null,
    messages: byName(read("Configuration/Messages", "rv.data.MessageDocument").messages, (m) => m.title),
    // The macros that switch a stage layout, for the answer to someone asking to add one.
    stageMacros: (macros.macros ?? []).filter((m) => (m.actions ?? []).some((a) => a.stage)).map((m) => m.name).filter(Boolean),
    timers: byName(read("Configuration/Timers", "rv.data.TimersDocument").timers),
    clearGroups: byName(read("Configuration/ClearGroups", "rv.data.ClearGroupsDocument").groups),
    examples,
  };
}

const ref = (x, name) => ({ parameter_uuid: { string: x.uuid?.string }, parameter_name: name ?? x.name ?? x.title ?? "" });

/**
 * A new action of `kind`, pointed at what `spec` names. `index` is workspaceIndex's, or null when there is
 * no workspace (then only clear, which names nothing, can be built). `fresh` makes a copy with new ids.
 */
export function buildAction(kind, spec, index, { uuid, freshCopy }) {
  const need = (map, what) => {
    if (!index) throw new Error(`There is no ProPresenter workspace on this computer to find the ${what} "${spec.name}" in.`);
    const x = map.get(String(spec.name ?? "").toLowerCase());
    if (!x) throw new Error(`No ${what} called "${spec.name}" in ProPresenter's workspace. refrain_read_workspace lists them.`);
    return x;
  };
  const start = (field) => {
    const ex = index?.examples[field];
    const a = ex ? freshCopy(ex) : { isEnabled: true, type: TYPE[field], [field]: {} };
    a.uuid = uuid();
    delete a.name;
    a.isEnabled = true;
    return a;
  };
  switch (kind) {
    case "clear": {
      const what = String(spec.what ?? "all").toLowerCase().replace(/ /g, "_");
      if (!CLEAR.includes(what)) throw new Error(`clear what is ${CLEAR.join(", ")}.`);
      const a = start("clear");
      a.clear = { ...a.clear, target_layer: CLEAR.indexOf(what) };
      return a;
    }
    case "look": {
      const look = need(index?.looks ?? new Map(), "Look");
      const a = start("audience_look");
      a.audience_look = { ...a.audience_look, identification: ref(look) };
      return a;
    }
    case "prop": {
      const prop = need(index?.props ?? new Map(), "prop");
      const col = index.propCollection(prop.uuid?.string);
      const a = start("prop");
      a.prop = { ...a.prop, identification: { ...ref(prop), ...(col ? { parent_collection: ref(col) } : {}) } };
      return a;
    }
    case "message": {
      const m = need(index?.messages ?? new Map(), "message");
      // A message with a blank to fill (a pager code) is shown from Now or a phone, where the value is
      // typed; fired from a slide it would show empty, or the last value typed (owner, 2026-11-04).
      const blanks = (m.tokens ?? []).filter((t) => t.text).map((t) => t.text.name).filter(Boolean);
      if (blanks.length) throw new Error(`"${m.title}" has ${blanks.length === 1 ? "a blank" : `${blanks.length} blanks`} to fill in when it's shown (${blanks.join(", ")}), so it isn't put on a slide: the slide would show it empty or with the last value typed. Show it from Now or a phone, where the value is typed.`);
      const a = start("message");
      a.message = { message_identificaton: ref(m, m.title) };
      return a;
    }
    case "timer": {
      const t = need(index?.timers ?? new Map(), "timer");
      const todo = String(spec.do ?? "start").toLowerCase().replace(/ /g, "_");
      if (!TIMER.includes(todo)) throw new Error(`timer do is ${TIMER.join(", ")}.`);
      const a = start("timer");
      a.timer = { ...a.timer, action_type: TIMER.indexOf(todo), timer_identification: ref(t) };
      if (a.timer.timer_configuration && t.configuration) a.timer.timer_configuration = t.configuration; // this timer's own, not the example's
      return a;
    }
    case "clear group": {
      const g = need(index?.clearGroups ?? new Map(), "clear group");
      const a = start("clear_group");
      a.clear_group = { identification: ref(g) };
      return a;
    }
    case "stage layout":
      // Stage layouts go through the team's macros, which name the screens for each event; templates
      // carry those macros and are copied as they are (owner, 2026-11-04).
      throw new Error(`A stage layout is switched by a macro, not added to a slide on its own. Add the macro that switches it (add_macro)${index?.stageMacros?.length ? `; these switch stage layouts: ${index.stageMacros.join(", ")}` : ""}, or copy the slide from a template that already fires it.`);
    default:
      throw new Error(`An action to add is clear, look, prop, message, timer or clear group (media and macros have their own fields; a stage layout goes through a macro), not ${kind}.`);
  }
}

/** Whether an action is the kind (and, when given, the name) a person asked to remove. */
export function matchesAction(a, kind, name) {
  const d = describeAction(a);
  if (!d || d.kind !== kind) return false;
  if (name === undefined || name === null) return true;
  const want = String(name).toLowerCase();
  return [d.name, d.what, d.file, ...(d.screens ?? []).map((s) => s.layout)].some((v) => typeof v === "string" && v.toLowerCase() === want);
}
