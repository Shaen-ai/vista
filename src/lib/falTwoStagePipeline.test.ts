import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeStructuralLineMap } from "./extractUserStructuralLines";
import { buildFalRedesignPrompt } from "./falPipelinePrompt";
import type { RoomAnalysis } from "./interiorDesignPrompts";

async function blackPngWithWhiteLine(): Promise<string> {
  const width = 64;
  const height = 48;
  const buf = Buffer.alloc(width * height);
  for (let y = 20; y < 22; y++) {
    for (let x = 8; x < 56; x++) {
      buf[y * width + x] = 255;
    }
  }
  const png = await sharp(buf, { raw: { width, height, channels: 1 } }).png().toBuffer();
  return png.toString("base64");
}

async function solidPngBase64(r: number, g: number, b: number): Promise<string> {
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
  return png.toString("base64");
}

test("normalizeStructuralLineMap accepts stroke-only black/white map", async () => {
  const strokeOnly = await blackPngWithWhiteLine();
  const out = await normalizeStructuralLineMap({
    lineMapBase64: strokeOnly,
    strokeOnly: true,
  });
  assert.ok(out.base64.length > 100);
  assert.equal(out.mimeType, "image/png");
});

test("normalizeStructuralLineMap extracts red strokes from composite", async () => {
  const original = await solidPngBase64(200, 195, 190);
  const width = 32;
  const height = 32;
  const composite = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 195, b: 190 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 20, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 255 } },
        })
          .png()
          .toBuffer(),
        left: 6,
        top: 10,
      },
    ])
    .png()
    .toBuffer();

  const out = await normalizeStructuralLineMap({
    lineMapBase64: composite.toString("base64"),
    originalPhotoBase64: original,
  });
  assert.ok(out.base64.length > 50);
});

test("buildFalRedesignPrompt includes style room type and materials", () => {
  const analysis: RoomAnalysis = {
    room_type: "living room",
    room_shape: "rectangular",
    estimated_dimensions: { width: 5, depth: 4, height: 2.7 },
    existing_furniture: [],
    architectural_features: [],
    lighting_sources: [],
    current_style: "dated",
    color_palette: [],
    suggestions: [],
    window_count: 2,
    door_count: 1,
    window_positions: ["left wall"],
    door_positions: ["right wall"],
    plan_door_count: 1,
    plan_door_positions: [],
    camera_angle: "",
    ceiling_type: "",
    structural_elements: ["column near window"],
    has_staircase: false,
    staircase_description: null,
    has_floor_opening: false,
    floor_opening_description: null,
    confidence: {
      room_type: "high",
      dimensions: "medium",
      style: "low",
      window_count: "high",
      door_count: "high",
    },
  };

  const prompt = buildFalRedesignPrompt({
    styleId: "scandinavian",
    roomAnalysis: analysis,
    surfaceMaterials: { floor: "light oak wood", walls: "matte white paint" },
    hasStructuralLines: true,
  });

  assert.match(prompt, /Scandinavian/i);
  assert.match(prompt, /living room/i);
  assert.match(prompt, /light oak wood/i);
  assert.match(prompt, /line map/i);
  assert.match(prompt, /Preserve exactly 2 window/i);
});
