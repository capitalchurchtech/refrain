/**
 * Features that can be switched on and off (owner, 2026-10-06): "the killer
 * features of Refrain are search and spell/date check, everything else is
 * secondary ... modular on/off ... extensible when needed but simple when
 * speed is key".
 *
 * Each module says for itself whether it's a feature and what its default
 * is, in its own module.js (`feature`, and `features` for parts of a screen,
 * like Now's Looks, Macros and Messages). Nothing here lists them: a new
 * module folder with a `feature` appears on Settings › Features by itself.
 * A module with no `feature` is core and always on (Search, Spell Check,
 * Now's safe slides and Clear).
 *
 * Pure: index.js discovers the modules and keeps the settings.
 */

const clean = (s) => String(s ?? "").trim();

/**
 * The switchable features the modules declare, in menu order.
 * Each: { id, label, description, default, apiPrefixes, parent, parentLabel }.
 */
export function moduleFeatures(modules) {
  const out = [];
  const ordered = [...(modules ?? [])].sort((a, b) => (a?.nav?.order ?? 99) - (b?.nav?.order ?? 99));
  for (const m of ordered) {
    if (!m?.id) continue;
    if (m.feature && typeof m.feature === "object") {
      out.push({
        id: m.id,
        label: clean(m.feature.label) || clean(m.navLabel) || m.id,
        description: clean(m.feature.description),
        default: m.feature.default === true,
        apiPrefixes: (m.feature.apiPrefixes ?? []).filter((p) => typeof p === "string" && p.startsWith("/api/")),
        parent: null,
        parentLabel: null,
      });
    }
    for (const f of Array.isArray(m.features) ? m.features : []) {
      if (!f?.id) continue;
      out.push({
        id: f.id,
        label: clean(f.label) || f.id,
        description: clean(f.description),
        default: f.default === true,
        apiPrefixes: (f.apiPrefixes ?? []).filter((p) => typeof p === "string" && p.startsWith("/api/")),
        parent: m.id,
        parentLabel: clean(m.navLabel) || m.id,
      });
    }
  }
  // An id twice is a mistake in a module.js; the first one wins.
  const seen = new Set();
  return out.filter((f) => (seen.has(f.id) ? false : seen.add(f.id)));
}

/** { id: default } for config.js's featureOn. */
export function featureDefaults(features) {
  return Object.fromEntries((features ?? []).map((f) => [f.id, f.default]));
}

/**
 * The feature a request path belongs to (the longest matching prefix), or
 * null. Case-blind, as Express's routing is: /API/Live/macro reaches the
 * same handler as /api/live/macro, so it must meet the same switch.
 */
export function featureForPath(features, path) {
  const at = String(path).toLowerCase();
  let best = null;
  for (const f of features ?? []) {
    for (const p of f.apiPrefixes) {
      if (at.startsWith(p.toLowerCase()) && (!best || p.length > best.prefix.length)) best = { feature: f, prefix: p };
    }
  }
  return best?.feature ?? null;
}
