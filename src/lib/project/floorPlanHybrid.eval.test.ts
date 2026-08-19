import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCvOpeningsFromNormalized,
  assessCvGptOpeningDisagreement,
  buildCvGeometryPriorBlock,
  detectionCenterInImageUnits,
} from "./floorPlanCvPrior";
import { CUBICASA5K_SAMPLE_FIXTURE } from "./floorPlanDetections";
import { parseArchitecturalLabel, buildOcrHintBlock, ocrLabelsFromParsedRaw } from "./floorPlanOcrScale";
import { uploadKindPromptHint } from "./floorPlanUploadKind";
import {
  assessGeometryQuality,
  FLOOR_PLAN_VISION_MAX_RETRIES,
  isFloorPlanGeometryRetryEnabled,
} from "./floorPlanAnalyzer";
import type { DetectedRoom, FloorPlanAnalysis } from "./types";

function room(id: string, polygon: [number, number][]): DetectedRoom {
  return {
    id,
    name: id,
    type: "living",
    estimatedArea: 20,
    dimensions: { width: 4, depth: 5, height: 2.7 },
    windows: [{ position: "north", width: 1.2, height: 1.4, edgeIndex: 0, t: 0.5 }],
    doors: [],
    features: [],
    polygon,
  };
}

describe("buildCvGeometryPriorBlock", () => {
  it("includes compact JSON prior from fixture", () => {
    const block = buildCvGeometryPriorBlock(CUBICASA5K_SAMPLE_FIXTURE, 1720);
    assert.ok(block.includes("COMPUTER-VISION PRIOR"));
    assert.ok(block.includes('"openings"'));
    assert.ok(block.length < 8000);
  });
});

describe("detectionCenterInImageUnits", () => {
  it("maps pixel center to 0..1000 x", () => {
    const p = CUBICASA5K_SAMPLE_FIXTURE.predictions[0]!;
    const [x] = detectionCenterInImageUnits(
      p,
      CUBICASA5K_SAMPLE_FIXTURE.image.width,
      CUBICASA5K_SAMPLE_FIXTURE.image.height,
      1720,
    );
    assert.ok(x >= 0 && x <= 1000);
  });
});

describe("parseArchitecturalLabel", () => {
  it("parses feet-inches and SF", () => {
    const ft = parseArchitecturalLabel("19'-6\"");
    assert.ok(ft.valueMeters != null && ft.valueMeters > 5.9);
    const sf = parseArchitecturalLabel("110 SF");
    assert.ok(sf.valueAreaM2 != null && sf.valueAreaM2 > 10);
  });
});

describe("uploadKindPromptHint", () => {
  it("returns non-empty hints for permit and furnished", () => {
    assert.ok(uploadKindPromptHint("dense_permit_sheet").includes("permit"));
    assert.ok(uploadKindPromptHint("furnished_marketing").includes("furniture"));
  });
});

describe("buildOcrHintBlock", () => {
  it("formats parsed labels", () => {
    const block = buildOcrHintBlock([
      { text: "110 SF", kind: "area", valueMeters: null, valueAreaM2: 10.2 },
    ]);
    assert.ok(block.includes("110 SF"));
  });
});

describe("ocrLabelsFromParsedRaw", () => {
  it("maps printedLabels from main vision JSON", () => {
    const labels = ocrLabelsFromParsedRaw({ printedLabels: ["110 SF", "19'-6\""] });
    assert.equal(labels.length, 2);
    assert.ok(labels[0]!.valueAreaM2 != null);
  });
});

describe("floor plan analyze policy", () => {
  it("uses zero OpenAI retries by default", () => {
    assert.equal(FLOOR_PLAN_VISION_MAX_RETRIES, 0);
  });

  it("geometry retry off unless env set", () => {
    const prev = process.env.FLOOR_PLAN_GEOMETRY_RETRY;
    delete process.env.FLOOR_PLAN_GEOMETRY_RETRY;
    assert.equal(isFloorPlanGeometryRetryEnabled(), false);
    process.env.FLOOR_PLAN_GEOMETRY_RETRY = "1";
    assert.equal(isFloorPlanGeometryRetryEnabled(), true);
    if (prev === undefined) delete process.env.FLOOR_PLAN_GEOMETRY_RETRY;
    else process.env.FLOOR_PLAN_GEOMETRY_RETRY = prev;
  });
});

describe("assessCvGptOpeningDisagreement", () => {
  it("flags large count delta as problematic", () => {
    const analysis: FloorPlanAnalysis = {
      totalArea: 60,
      ceilingHeight: 2.7,
      rooms: [room("a", [[0, 0], [500, 0], [500, 500], [0, 500]])],
      wallSegments: [],
      overallShape: "rect",
      notes: "",
    };
    const review = assessCvGptOpeningDisagreement(analysis, CUBICASA5K_SAMPLE_FIXTURE, 1720);
    assert.ok(review);
    assert.ok(review.cvDoorCount + review.cvWindowCount > 0);
  });
});

describe("applyCvOpeningsFromNormalized", () => {
  it("re-anchors openings onto nearest wall from normalized overlay", () => {
    const analysis: FloorPlanAnalysis = {
      totalArea: 60,
      ceilingHeight: 2.7,
      rooms: [room("a", [[0, 0], [8000, 0], [8000, 6000], [0, 6000]])],
      wallSegments: [],
      overallShape: "rect",
      notes: "",
      imageFrame: { width: 8000, height: 6000 },
    };
    const normalized = [
      {
        class: "window" as const,
        confidence: 0.9,
        left: 0.4,
        top: 0.02,
        width: 0.08,
        height: 0.02,
      },
    ];
    const updated = applyCvOpeningsFromNormalized(analysis, normalized, analysis.imageFrame!);
    assert.equal(updated.rooms[0]!.windows[0]?.confirmed, true);
  });
});

describe("hybrid eval — geometry quality baseline", () => {
  it("clean tiling passes assessGeometryQuality", () => {
    const a: FloorPlanAnalysis = {
      totalArea: 40,
      ceilingHeight: 2.7,
      rooms: [
        room("a", [[0, 0], [500, 0], [500, 500], [0, 500]]),
        room("b", [[500, 0], [1000, 0], [1000, 500], [500, 500]]),
      ],
      wallSegments: [],
      overallShape: "rect",
      notes: "",
    };
    const q = assessGeometryQuality(a, 2);
    assert.ok(!q.problematic);
  });
});
