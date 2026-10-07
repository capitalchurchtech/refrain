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
  nav: { group: "prep", order: 4 },
  client: { file: "lyrics-assist.js", init: "initLyricsAssist" },
  route: "/lyrics-assist",
  component: null, // TODO: LyricsAssistScreen component
  // Switchable on Settings > Features (server/features.js); off hides its
  // screen and its routes answer "switched off".
  feature: { default: false, label: "Lyrics", description: "Finds lyrics online and splits pasted lyrics into slides.", apiPrefixes: ["/api/lyrics-assist"] },
};
