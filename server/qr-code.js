/**
 * QR code generator — fully local, no third-party service. A lot of
 * "free" online QR generators route the code through their own domain
 * so they can later disable it, expire it, or start charging (or track
 * scans); a printed bulletin or sign made that way can be quietly taken
 * hostage. Codes made here encode your content directly — nothing to
 * expire, nobody in the middle.
 *
 * Stateless: the frontend builds the final QR string (URL, WiFi, vCard,
 * etc.) and posts it here to render. PNG goes through sharp so an
 * optional center logo can be composited in; SVG is emitted directly
 * (vector, ideal for print) but can't carry a raster logo.
 */
import QRCode from "qrcode";
import sharp from "sharp";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const EC_LEVELS = new Set(["L", "M", "Q", "H"]);
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Recent-codes history (the last N codes the user actually downloaded),
// kept as plain JSON in the data folder like the rest of the app. Each
// entry stores what's needed to rebuild the code plus a small thumbnail
// for the list. A logo is kept inline only when it's small; a large one
// is dropped (flagged), so the file can't balloon.
const HISTORY_PATH = "./data/qr-history.json";
const MAX_HISTORY = 20;
const MAX_STORED_LOGO_CHARS = 200_000; // ~150KB of image; bigger logos aren't kept for restore
const THUMB_SIZE = 160;

export const QR_LIMITS = {
  maxContentLength: 2000, // well under QR's hard capacity, generous for URLs/vCards
  minSize: 64,
  maxSize: 2000,
  maxMargin: 20,
  maxLogoBytes: 2 * 1024 * 1024, // decoded logo cap, guards against decompression bombs
};

/**
 * Validates the render options, throwing a plain Error (message safe to
 * show the user) on anything off. Returned object is normalized.
 */
export function validateQrOptions(opts = {}) {
  const { content, format = "png", size = 512, margin = 3, ecLevel = "L", dark = "#000000", light = "#ffffff", logoDataUrl = null } = opts;

  if (typeof content !== "string" || !content.trim()) throw new Error("Nothing to encode — enter some content.");
  if (content.length > QR_LIMITS.maxContentLength) throw new Error(`Content is too long for a QR code (max ${QR_LIMITS.maxContentLength} characters).`);
  if (format !== "png" && format !== "svg") throw new Error('format must be "png" or "svg".');
  if (!Number.isInteger(size) || size < QR_LIMITS.minSize || size > QR_LIMITS.maxSize) {
    throw new Error(`size must be an integer between ${QR_LIMITS.minSize} and ${QR_LIMITS.maxSize}.`);
  }
  if (!Number.isInteger(margin) || margin < 0 || margin > QR_LIMITS.maxMargin) throw new Error(`margin must be between 0 and ${QR_LIMITS.maxMargin}.`);
  if (!EC_LEVELS.has(ecLevel)) throw new Error("ecLevel must be one of L, M, Q, H.");
  if (!HEX_COLOR.test(dark) || !HEX_COLOR.test(light)) throw new Error("Colors must be hex like #000000.");
  if (logoDataUrl != null) {
    if (typeof logoDataUrl !== "string" || !logoDataUrl.startsWith("data:image/")) throw new Error("Logo must be an image.");
    if (logoDataUrl.length > QR_LIMITS.maxLogoBytes * 1.4) throw new Error("Logo image is too large.");
  }

  return { content, format, size, margin, ecLevel, dark, light, logoDataUrl };
}

/**
 * @returns {Promise<{ format: "png", dataUrl: string } | { format: "svg", svg: string }>}
 */
export async function generateQr(rawOpts) {
  const { content, format, size, margin, ecLevel, dark, light, logoDataUrl } = validateQrOptions(rawOpts);

  if (format === "svg") {
    // A raster logo can't cleanly embed in SVG; the route/UI disables the
    // logo option for SVG, but guard here too so it's never silently ignored.
    const svg = await QRCode.toString(content, {
      type: "svg",
      errorCorrectionLevel: ecLevel,
      margin,
      width: size,
      color: { dark, light },
    });
    return { format: "svg", svg };
  }

  // With a logo, force high error correction so the covered modules can
  // still be recovered — otherwise a centered logo can make the code unscannable.
  const effectiveEc = logoDataUrl ? "H" : ecLevel;
  const qrBuffer = await QRCode.toBuffer(content, {
    type: "png",
    errorCorrectionLevel: effectiveEc,
    margin,
    width: size,
    color: { dark, light },
  });

  if (!logoDataUrl) {
    return { format: "png", dataUrl: `data:image/png;base64,${qrBuffer.toString("base64")}` };
  }

  // Composite a center logo: ~22% of the QR, on a small rounded white pad
  // so it reads cleanly against the code.
  const base64 = logoDataUrl.slice(logoDataUrl.indexOf(",") + 1);
  const logoInput = Buffer.from(base64, "base64");
  if (logoInput.length > QR_LIMITS.maxLogoBytes) throw new Error("Logo image is too large.");

  const logoSize = Math.round(size * 0.22);
  const padSize = Math.round(logoSize * 1.25);
  const resizedLogo = await sharp(logoInput)
    .resize(logoSize, logoSize, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  const pad = await sharp({
    create: { width: padSize, height: padSize, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: resizedLogo, gravity: "centre" }])
    .png()
    .toBuffer();

  const composited = await sharp(qrBuffer)
    .composite([{ input: pad, gravity: "centre" }])
    .png()
    .toBuffer();

  return { format: "png", dataUrl: `data:image/png;base64,${composited.toString("base64")}` };
}

// --- Recent-codes history ---

async function readHistory() {
  try {
    const raw = await readFile(HISTORY_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Missing or unreadable history is just an empty list, not an error.
    return [];
  }
}

async function writeHistory(entries) {
  await mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  const tmp = `${HISTORY_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(entries, null, 2));
  await rename(tmp, HISTORY_PATH);
}

const appearanceSignature = (e) => [e.content, e.size, e.margin, e.ecLevel, e.dark, e.light, Boolean(e.logoDataUrl) || Boolean(e.logoOmitted)].join("|");

/** The list for the UI: newest first, with the heavy logo stripped (see getQrHistoryEntry for the full one). */
export async function getQrHistoryList() {
  const entries = await readHistory();
  return entries.map(({ logoDataUrl, ...rest }) => ({ ...rest, logoRestorable: Boolean(logoDataUrl) }));
}

/** One full entry including its stored logo, for a faithful restore. */
export async function getQrHistoryEntry(id) {
  const entries = await readHistory();
  return entries.find((e) => e.id === id) ?? null;
}

/**
 * Records a downloaded code. Validates the render params, builds a small
 * thumbnail, keeps the logo inline only if it's small, dedupes against the
 * newest entry, caps at MAX_HISTORY, and returns the updated (stripped) list.
 */
export async function addQrHistoryEntry(input = {}) {
  const { content, label, type, fields } = input;
  // Reuse the generator's validation on the render options.
  const opts = validateQrOptions({ ...input, format: "png" });
  if (!type || typeof type !== "string") throw new Error("type is required");

  const entries = await readHistory();

  const logoStorable = opts.logoDataUrl && opts.logoDataUrl.length <= MAX_STORED_LOGO_CHARS;
  const candidate = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    label: typeof label === "string" && label.trim() ? label.slice(0, 120) : content.slice(0, 60),
    type,
    fields: fields && typeof fields === "object" ? fields : {},
    content,
    size: opts.size,
    margin: opts.margin,
    ecLevel: opts.ecLevel,
    dark: opts.dark,
    light: opts.light,
    logoDataUrl: logoStorable ? opts.logoDataUrl : null,
    logoOmitted: Boolean(opts.logoDataUrl) && !logoStorable,
  };

  // Skip if identical to the most recent entry (re-downloading the same code shouldn't pile up duplicates).
  if (entries[0] && appearanceSignature(entries[0]) === appearanceSignature(candidate)) {
    return entries.map(({ logoDataUrl, ...rest }) => ({ ...rest, logoRestorable: Boolean(logoDataUrl) }));
  }

  const { dataUrl: thumb } = await generateQr({
    content,
    format: "png",
    size: THUMB_SIZE,
    margin: opts.margin,
    ecLevel: opts.ecLevel,
    dark: opts.dark,
    light: opts.light,
    logoDataUrl: opts.logoDataUrl,
  });
  candidate.thumb = thumb;

  const updated = [candidate, ...entries].slice(0, MAX_HISTORY);
  await writeHistory(updated);
  return updated.map(({ logoDataUrl, ...rest }) => ({ ...rest, logoRestorable: Boolean(logoDataUrl) }));
}

export async function clearQrHistory() {
  await writeHistory([]);
}
