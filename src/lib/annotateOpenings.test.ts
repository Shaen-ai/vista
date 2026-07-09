import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { annotateOpenings } from "./annotateOpenings";

async function solidPhotoBase64(w = 200, h = 150): Promise<string> {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 180, g: 180, b: 180 } },
  })
    .jpeg()
    .toBuffer();
  return buf.toString("base64");
}

test("returns null when there are no boxes", async () => {
  const photo = await solidPhotoBase64();
  assert.equal(await annotateOpenings(photo, "image/jpeg", [], []), null);
  assert.equal(await annotateOpenings(photo, "image/jpeg", undefined, undefined), null);
});

test("composites a valid image when boxes are present", async () => {
  const photo = await solidPhotoBase64();
  const out = await annotateOpenings(
    photo,
    "image/jpeg",
    [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }],
    [{ x: 0.6, y: 0.5, w: 0.2, h: 0.3 }],
  );
  assert.ok(out, "expected an annotated image");
  assert.equal(out!.mimeType, "image/jpeg");
  // The output must be a decodable image with the original dimensions preserved.
  const meta = await sharp(Buffer.from(out!.data, "base64")).metadata();
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 150);
});
