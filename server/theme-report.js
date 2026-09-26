/**
 * Which theme each deck uses, and the decks that don't match their library
 * (docs/ideas.md: "Template and theme conformance"; handoff §36 and §38).
 *
 * A theme's own id appears in no .pro file, but its slide layouts' ids do:
 * ProPresenter copies a layout into a deck when it's applied and keeps the
 * layout's id. So a deck "uses" a theme when it references one of that
 * theme's layout ids. Measured on this library: 237 of 973 presentations
 * reference at least one.
 *
 * **"Current theme" is an assumption, stated wherever it's shown:** the
 * theme most of that library's decks use. The owner hasn't defined it yet,
 * and this is the definition that needs no configuration. Read-only.
 */

const UUID = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/g;

/** layout id -> theme name, from ProPresenter's /v1/themes (folders of themes, and themes at the top). */
export function layoutThemes(themesJson) {
  const map = new Map();
  const addTheme = (t, folder) => {
    const name = [folder, t?.id?.name].filter(Boolean).join(" / ") || "Untitled theme";
    for (const s of t?.slides ?? []) if (s?.id?.uuid) map.set(s.id.uuid.toUpperCase(), name);
  };
  const walk = (g, path) => {
    const here = [path, g?.id?.name].filter(Boolean).join(" / ");
    for (const t of g?.themes ?? []) addTheme(t, here);
    for (const sub of g?.groups ?? []) walk(sub, here);
  };
  for (const g of themesJson?.groups ?? []) walk(g, "");
  for (const t of themesJson?.themes ?? []) addTheme(t, "");
  return map;
}

/** The themes a .pro file's bytes reference. */
export function themesInDeck(buf, layouts) {
  const found = new Set();
  const text = Buffer.isBuffer(buf) ? buf.toString("latin1") : String(buf ?? "");
  for (const id of text.match(UUID) ?? []) {
    const theme = layouts.get(id);
    if (theme) found.add(theme);
  }
  return found;
}

/**
 * Per library: the theme most decks use, and the decks that use another.
 * @param {Array<{ presentationId, name, folder, themes: Set<string> }>} decks
 */
export function themeReport(decks) {
  const byFolder = new Map();
  for (const d of decks ?? []) {
    if (!d.themes?.size) continue;
    const key = d.folder ?? "(no library)";
    (byFolder.get(key) ?? byFolder.set(key, []).get(key)).push(d);
  }
  const libraries = [];
  for (const [folder, list] of byFolder) {
    const counts = new Map();
    for (const d of list) for (const t of d.themes) counts.set(t, (counts.get(t) ?? 0) + 1);
    const [current, currentCount] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const off = list
      .filter((d) => [...d.themes].some((t) => t !== current))
      .map((d) => ({ presentationId: d.presentationId, name: d.name, themes: [...d.themes].sort(), alsoCurrent: d.themes.has(current) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    libraries.push({ folder, current, currentCount, themedDecks: list.length, off });
  }
  return libraries.sort((a, b) => b.off.length - a.off.length || a.folder.localeCompare(b.folder));
}
