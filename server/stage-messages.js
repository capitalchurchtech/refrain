/**
 * Stage messages (owner request, handoff section 44): short notes for the
 * people on stage, shown in the Stage Message box of ProPresenter's stage
 * layouts. Never seen by the audience.
 *
 * The presets are kept in config.json as `liveModule.stageMessages`, per
 * machine. A church that has never set any gets the three below; once the
 * list has been saved, even empty, it's theirs. Pure: index.js does the
 * config write and the ProPresenter call.
 */

import { randomBytes } from "node:crypto";

export const MAX_STAGE_MESSAGES = 8;
export const STAGE_TEXT_MAX = 80;

export const DEFAULT_STAGE_MESSAGES = [
  { id: "delayed", text: "Keep going, we're delayed" },
  { id: "short", text: "Cut short, pressing for time" },
  { id: "great", text: "Killing it!" },
];

/** One line, trimmed, at most STAGE_TEXT_MAX characters; "" when there's nothing. */
export function cleanStageText(text) {
  // Text only: a number or a list is not a message (stress test, 2026-10-04:
  // a 9 became a preset), for every caller, not just one route.
  if (typeof text !== "string") return "";
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, STAGE_TEXT_MAX);
}

const valid = (m) => m && typeof m.id === "string" && m.id && typeof m.text === "string" && m.text;

/** The stored presets, well-formed only; the defaults when none were ever saved. */
export function stageMessages(list) {
  if (list === undefined || list === null) return DEFAULT_STAGE_MESSAGES.map((m) => ({ ...m }));
  return (Array.isArray(list) ? list : []).filter(valid).slice(0, MAX_STAGE_MESSAGES);
}

/** Adds a preset. Returns `{ list, added, error }`; a full list is an error, never a silent drop. */
export function addStageMessage(list, text, { id = randomBytes(4).toString("hex") } = {}) {
  const current = stageMessages(list);
  const clean = cleanStageText(text);
  if (!clean) return { list: current, added: null, error: "Type the message first." };
  const same = current.find((m) => m.text.toLowerCase() === clean.toLowerCase());
  if (same) return { list: current, added: same, error: null };
  if (current.length >= MAX_STAGE_MESSAGES) return { list: current, added: null, error: `There are already ${MAX_STAGE_MESSAGES}. Remove one first.` };
  const added = { id, text: clean };
  return { list: [...current, added], added, error: null };
}

export function removeStageMessage(list, id) {
  return stageMessages(list).filter((m) => m.id !== id);
}

export function editStageMessage(list, id, text) {
  const clean = cleanStageText(text);
  return stageMessages(list).map((m) => (m.id === id && clean ? { ...m, text: clean } : m));
}

/** Moves one earlier (-1) or later (+1). */
export function moveStageMessage(list, id, dir) {
  const out = [...stageMessages(list)];
  const i = out.findIndex((m) => m.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export const MESSAGE_FIELD_MAX = 60;

/**
 * A message field's value as it's posted. Upper-cased (owner, 2026-10-03:
 * pager codes are read off a screen by a parent, and EXVX beats exvx), one
 * line, trimmed, at most MESSAGE_FIELD_MAX characters. The one place this is
 * decided, for the Now screen and the phone alike.
 */
export function messageFieldValue(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, MESSAGE_FIELD_MAX);
}
