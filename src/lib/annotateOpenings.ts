import sharp from "sharp";
import type { OpeningBox } from "@/lib/interiorDesignPrompts";

/**
 * Build a labeled "guide" copy of a room photo with each window/door opening drawn
 * as a numbered, colored rectangle. This guide is sent to Gemini ALONGSIDE the clean
 * photo so opening placement is grounded in pixels (the image-space version of the
 * corner-letter idea) — far more reliable than prose wall labels. The clean photo
 * stays the edit source; the guide is reference only. See `OPENING_MARKER_PROMPT`.
 */

const WINDOW_COLOR = "#ff2d2d"; // red
const DOOR_COLOR = "#1e7bff"; // blue

export interface AnnotatedImage {
  /** Base64 image data (named `data` to match Gemini `inlineData` parts). */
  data: string;
  mimeType: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function rectsFor(
  boxes: OpeningBox[] | undefined,
  prefix: "W" | "D",
  color: string,
  imgW: number,
  imgH: number,
): string {
  if (!boxes?.length) return "";
  const stroke = Math.max(3, Math.round(Math.min(imgW, imgH) * 0.006));
  const fontSize = Math.max(18, Math.round(Math.min(imgW, imgH) * 0.03));
  return boxes
    .map((b, i) => {
      const x = Math.round(b.x * imgW);
      const y = Math.round(b.y * imgH);
      const w = Math.round(b.w * imgW);
      const h = Math.round(b.h * imgH);
      const label = `${prefix}${i + 1}`;
      const labelW = label.length * fontSize * 0.7 + fontSize * 0.4;
      const labelH = fontSize * 1.25;
      // Tag sits just inside the top-left corner of the box.
      const tagX = x;
      const tagY = Math.max(0, y);
      return [
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${stroke}" />`,
        `<rect x="${tagX}" y="${tagY}" width="${Math.round(labelW)}" height="${Math.round(labelH)}" fill="${color}" />`,
        `<text x="${Math.round(tagX + labelW / 2)}" y="${Math.round(tagY + labelH * 0.78)}" font-family="sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff" text-anchor="middle">${esc(label)}</text>`,
      ].join("");
    })
    .join("");
}

/**
 * Composite numbered opening markers onto a photo. Returns null (caller falls back
 * to the clean photo only) when there are no boxes or compositing fails.
 */
export async function annotateOpenings(
  photoBase64: string,
  photoMimeType: string,
  windowBoxes: OpeningBox[] | undefined,
  doorBoxes: OpeningBox[] | undefined,
): Promise<AnnotatedImage | null> {
  if (!windowBoxes?.length && !doorBoxes?.length) return null;

  try {
    const input = Buffer.from(photoBase64, "base64");
    const meta = await sharp(input).metadata();
    const imgW = meta.width ?? 0;
    const imgH = meta.height ?? 0;
    if (!(imgW > 0) || !(imgH > 0)) return null;

    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}" viewBox="0 0 ${imgW} ${imgH}">${rectsFor(
      windowBoxes,
      "W",
      WINDOW_COLOR,
      imgW,
      imgH,
    )}${rectsFor(doorBoxes, "D", DOOR_COLOR, imgW, imgH)}</svg>`;

    const out = await sharp(input)
      .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
      .jpeg({ quality: 88 })
      .toBuffer();

    console.info("[annotateOpenings] built guide", {
      windowBoxes: windowBoxes?.length ?? 0,
      doorBoxes: doorBoxes?.length ?? 0,
      imgW,
      imgH,
    });

    return { data: out.toString("base64"), mimeType: "image/jpeg" };
  } catch (err) {
    console.error("[annotateOpenings] compositing failed:", err);
    return null;
  }
}

/** Prompt block telling Gemini how to read the guide image and NOT to draw the boxes. */
export const OPENING_MARKER_PROMPT =
  "OPENING GUIDE IMAGE: One reference image has colored numbered boxes overlaid on it. " +
  "Each RED box labeled W1, W2… marks a WINDOW; each BLUE box labeled D1, D2… marks a DOOR or passage. " +
  "In your output, keep every marked opening at EXACTLY that wall and location and size — do not move it to another wall, merge it, or drop it. " +
  "Any wall area with no box is solid: never add a window, door, or glazing there. " +
  "CRITICAL: the boxes and labels are annotations only — do NOT draw, paint, or reproduce them in the final render. Edit the CLEAN (un-annotated) photo; use the guide purely to locate openings.";
