/**
 * Build the Anthropic content block for a floor-plan file.
 *
 * Floor plans are commonly PDFs. Claude rejects `application/pdf` inside an
 * `image` block, so PDFs must be sent as a `document` block (read natively).
 * Everything else is treated as an image, normalizing the media type to one
 * Claude accepts (defaults to JPEG, which is what the client compressor emits).
 */

import type Anthropic from "@anthropic-ai/sdk";

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const SUPPORTED_IMAGE_TYPES: ImageMediaType[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export function isPdfMimeType(mime: string | null | undefined): boolean {
  return (mime ?? "").toLowerCase() === "application/pdf";
}

export function buildFloorPlanContentBlock(
  base64: string,
  mimeType: string,
): Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam {
  if (isPdfMimeType(mimeType)) {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    };
  }

  const mt = SUPPORTED_IMAGE_TYPES.includes(mimeType as ImageMediaType)
    ? (mimeType as ImageMediaType)
    : "image/jpeg";

  return {
    type: "image",
    source: { type: "base64", media_type: mt, data: base64 },
  };
}
