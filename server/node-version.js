/**
 * Whether the Node running Refrain is new enough for the version an update
 * would bring, read from that version's package.json before anything is
 * pulled. sharp 0.35 (2026-11-05) needs Node 20.9; an update that installed it
 * on an older Node would leave Image Crop, picture copies and QR codes broken.
 * Refusing first leaves the copy as it was. Only `>=X.Y.Z` is understood; any
 * other range lets the update through, as before.
 */

/**
 * @param {string|undefined} range  the incoming package.json's engines.node
 * @param {string} [version]  the running Node, e.g. "20.8.1"
 * @returns {string|null} the version needed, when this Node is older; else null
 */
export function nodeTooOld(range, version = process.versions.node) {
  const m = /^\s*>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(String(range ?? ""));
  if (!m) return null;
  const want = [m[1], m[2] ?? 0, m[3] ?? 0].map(Number);
  const have = String(version).replace(/^v/, "").split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((have[i] ?? 0) !== want[i]) return (have[i] ?? 0) < want[i] ? want.join(".") : null;
  }
  return null;
}

/** The refusal, in words for whoever pressed Update now. */
export const nodeRefusal = (need, have = process.versions.node) =>
  `This update needs Node ${need} or newer, and Refrain is running on Node ${have}. Install the current LTS from nodejs.org, then update again. Nothing was changed.`;
