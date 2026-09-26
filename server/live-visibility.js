/**
 * Which Live controls the church has put away (owner request, handoff §39f).
 *
 * A bank of 26 macros in one grid means reading every tile under pressure.
 * Hiding the ones a service never uses is the fix, and it is the church's own
 * choice, so it lives in their config.json: `liveModule.hiddenMacros`, a list
 * of ProPresenter macro ids. Ids rather than names, so renaming a macro in
 * ProPresenter doesn't bring it back. Nothing in ProPresenter changes.
 */

const MAX_ID = 128;

export function isControlId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= MAX_ID;
}

/** The hidden list as stored: unique, well-formed ids only. */
export function hiddenIds(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(isControlId))];
}

/** Marks each control hidden or not. Hidden ones stay in the list so they can be un-hidden. */
export function markHidden(items, list) {
  const hidden = new Set(hiddenIds(list));
  return (items ?? []).map((it) => ({ ...it, hidden: hidden.has(it.id) }));
}

/** The list after hiding or showing one id. Returns a new array. */
export function setHidden(list, id, hidden) {
  const current = hiddenIds(list);
  if (!isControlId(id)) return current;
  return hidden ? [...new Set([...current, id])] : current.filter((x) => x !== id);
}

/**
 * The last few values posted into each message field, newest first, so a
 * pager code used earlier is a tap instead of typing it again (handoff §39e).
 * Kept in config.json per machine: `liveModule.messageRecent`, as
 * `{ [messageId]: { [fieldName]: [values] } }`. Nothing leaves the machine.
 */
export const RECENT_PER_FIELD = 5;

export function rememberValues(recent, messageId, values) {
  const out = typeof recent === "object" && recent ? { ...recent } : {};
  if (!isControlId(messageId)) return out;
  const fields = { ...(out[messageId] ?? {}) };
  for (const v of values ?? []) {
    const name = String(v?.name ?? "").slice(0, 60);
    const text = String(v?.text ?? "").trim().slice(0, 120);
    if (!name || !text) continue;
    fields[name] = [text, ...(fields[name] ?? []).filter((x) => x !== text)].slice(0, RECENT_PER_FIELD);
  }
  out[messageId] = fields;
  return out;
}
