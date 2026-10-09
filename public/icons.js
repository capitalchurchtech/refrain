/**
 * The drawn icons for the rail and the search strip, as the design draws them
 * (24px grid, round caps, 1.7 stroke from CSS). The rest of the app keeps the
 * Lucide set; these are the few the design draws its own way, so the rail and
 * the field read the same as the artifact. Pure markup, no lookup at runtime.
 */
const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  spellcheck: '<path d="M5 20 11 4l6 16M7.5 14h7"/><path d="m16 18 2.5 2.5L22 16"/>',
  service: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  flag: '<path d="M5 21V4h12l-2 4 2 4H5"/>',
  library: '<path d="M4 19V5a1 1 0 0 1 1-1h3v16H5a1 1 0 0 1-1-1zM12 4h3v16h-3zM19 6l-2.5 13"/>',
  filter: '<path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"/>',
  deep: '<path d="M12 3 3 8l9 5 9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5"/>',
};

/** The drawn icon for a key or control, or null when the design does not draw one. */
export function drawnIcon(name, cls = "") {
  const d = PATHS[name];
  return d ? `<svg class="rf-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>` : null;
}
