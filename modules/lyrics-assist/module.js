/**
 * Lyrics search-assist module. See docs/refrain-architecture.md
 * Section 14 — scoped web search + paste-to-slides only. Never
 * scrapes lyrics sites or search results directly; that's a
 * permanent boundary, not a placeholder for a future scraper.
 */
export default {
  id: "lyrics-assist",
  navLabel: "Lyrics",
  icon: "music",
  route: "/lyrics-assist",
  component: null, // TODO: LyricsAssistScreen component
  enabledByDefault: true,
};
