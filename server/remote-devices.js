/**
 * Phones, one by one (owner decision, 2026-09-26): which phones have signed
 * in, and which of them the booth has approved to control ProPresenter.
 *
 * The daily PIN gets a phone to helper level (search, what's live, flags).
 * Control (next and previous slide, safe slides) needs a person at this Mac
 * to press Approve beside that phone's name, and every control press on the
 * phone still needs a second press to confirm it. A removed phone is refused
 * outright, even with a valid token, until it signs in again with the PIN.
 *
 * Pure except for load/save at the bottom.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "./append-store.js";

const NAME_MAX = 40;
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);

export function emptyRegistry() {
  return { devices: {} };
}

/** Records a phone signing in, or seen again. A removed phone that signs in again with the PIN starts over, unapproved. */
export function seeDevice(reg, id, { name, now = Date.now(), signIn = false } = {}) {
  const devices = { ...(reg?.devices ?? {}) };
  const prev = devices[id];
  if (prev?.removed && !signIn) return { devices };
  devices[id] = {
    name: clean(name) || prev?.name || "A phone",
    firstSeen: prev && !prev.removed ? prev.firstSeen : now,
    lastSeen: now,
    approved: prev && !prev.removed ? Boolean(prev.approved) : false,
    approvedAt: prev && !prev.removed ? (prev.approvedAt ?? null) : null,
    removed: false,
  };
  return { devices };
}

export function setApproved(reg, id, approved, now = Date.now()) {
  const d = reg?.devices?.[id];
  if (!d || d.removed) return reg;
  return { devices: { ...reg.devices, [id]: { ...d, approved: Boolean(approved), approvedAt: approved ? now : null } } };
}

export function removeDevice(reg, id) {
  const d = reg?.devices?.[id];
  if (!d) return reg;
  return { devices: { ...reg.devices, [id]: { ...d, approved: false, approvedAt: null, removed: true } } };
}

export const isRemoved = (reg, id) => Boolean(reg?.devices?.[id]?.removed);
export const isApproved = (reg, id) => Boolean(reg?.devices?.[id]?.approved) && !isRemoved(reg, id);

/** For the booth's list: newest first, removed ones left out. */
export function deviceList(reg, now = Date.now()) {
  return Object.entries(reg?.devices ?? {})
    .filter(([, d]) => !d.removed)
    .map(([id, d]) => ({ id, name: d.name, approved: Boolean(d.approved), lastSeen: d.lastSeen, activeRecently: now - d.lastSeen < 5 * 60_000 }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

/**
 * The confirm step, enforced by the server rather than only by the page: a
 * control press is prepared, then confirmed with the id it was given, by the
 * same phone, within `ttlMs`, once. So a single request can never take over
 * ProPresenter, however it's sent.
 */
export function createConfirmer({ ttlMs = 6000, idOf = () => Math.random().toString(36).slice(2, 12) } = {}) {
  const pending = new Map();
  return {
    prepare(deviceId, action, now = Date.now()) {
      for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
      const id = idOf();
      pending.set(id, { deviceId, action, expires: now + ttlMs });
      return id;
    },
    take(deviceId, id, now = Date.now()) {
      const p = pending.get(id);
      pending.delete(id);
      if (!p || p.deviceId !== deviceId || p.expires < now) return null;
      return p.action;
    },
  };
}

/**
 * A per-phone pause between control presses, so a stuck thumb can't run
 * through a song. `ready` only looks; `mark` starts the pause. Checked before
 * a confirm is used up, so pressing inside the pause keeps the prepared
 * press for a retry instead of losing it.
 */
export function createCooldown(ms = 1200) {
  const last = new Map();
  return {
    ready: (deviceId, now = Date.now()) => now - (last.get(deviceId) ?? -Infinity) >= ms,
    mark: (deviceId, now = Date.now()) => last.set(deviceId, now),
  };
}

// --- storage --------------------------------------------------------------

export async function loadRegistry(file) {
  try {
    const reg = JSON.parse(await readFile(file, "utf-8"));
    return reg && typeof reg.devices === "object" ? reg : emptyRegistry();
  } catch {
    return emptyRegistry();
  }
}

export async function saveRegistry(file, reg) {
  await writeAtomic(path.dirname(file), path.basename(file), reg, { mode: 0o600 });
}
