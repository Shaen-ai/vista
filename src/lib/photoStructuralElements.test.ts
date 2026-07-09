import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";
import type { ViewpointPhotoAnalysis } from "@/lib/project/types";
import {
  allStructuralColumnBoxes,
  buildPhotoStructuralPromptBlock,
  gatePhotoConfirmedColumns,
  hasPhotoConfirmedColumn,
  selectStructuralElementsForPrompt,
  structuralNotesMentionsColumn,
  validateStructuralBboxPlausibility,
} from "./photoStructuralElements";
import { buildGeometryLockPrompt } from "./falGeometryLockPrompt";
import { buildKontextStage2Prompt } from "./falKontextPrompt";

describe("structuralNotesMentionsColumn", () => {
  it("accepts affirmative column mention", () => {
    assert.equal(structuralNotesMentionsColumn("freestanding column on left"), true);
  });

  it("rejects negated column mention", () => {
    assert.equal(structuralNotesMentionsColumn("no column visible in frame"), false);
  });
});

describe("validateStructuralBboxPlausibility", () => {
  it("rejects overly wide boxes", () => {
    const result = validateStructuralBboxPlausibility(
      { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
      "column",
    );
    assert.equal(result.ok, false);
  });

  it("accepts square head-on column bbox", () => {
    const result = validateStructuralBboxPlausibility(
      { x: 0.1, y: 0.2, w: 0.15, h: 0.16 },
      "column",
    );
    assert.equal(result.ok, true);
  });
});

describe("gatePhotoConfirmedColumns", () => {
  it("confirms high-confidence member with plausible bbox", () => {
    const analysis: ViewpointPhotoAnalysis = {
      walls: [],
      ceiling: { type: "flat", features: [] },
      floor: { currentFinish: "concrete" },
      structuralNotes: "",
      structuralMembers: [
        {
          type: "column",
          position: "left",
          confidence: "high",
          bbox: { x: 0.05, y: 0.2, w: 0.12, h: 0.55 },
        },
      ],
    };
    const { confirmed, log } = gatePhotoConfirmedColumns(analysis);
    assert.equal(confirmed.length, 1);
    assert.equal(log.highConfidenceMissingBbox.length, 0);
  });

  it("logs high confidence missing bbox without confirming", () => {
    const analysis: ViewpointPhotoAnalysis = {
      walls: [],
      ceiling: { type: "flat", features: [] },
      floor: { currentFinish: "concrete" },
      structuralNotes: "",
      structuralMembers: [
        { type: "column", position: "left", confidence: "high" },
      ],
    };
    const { confirmed, log } = gatePhotoConfirmedColumns(analysis);
    assert.equal(confirmed.length, 0);
    assert.equal(log.highConfidenceMissingBbox.length, 1);
  });

  it("requires structuralNotes for borderline bbox area", () => {
    const analysis: ViewpointPhotoAnalysis = {
      walls: [],
      ceiling: { type: "flat", features: [] },
      floor: { currentFinish: "concrete" },
      structuralNotes: "",
      structuralMembers: [
        {
          type: "column",
          position: "left",
          confidence: "high",
          bbox: { x: 0.1, y: 0.3, w: 0.08, h: 0.08 },
        },
      ],
    };
    assert.equal(gatePhotoConfirmedColumns(analysis).confirmed.length, 0);
    analysis.structuralNotes = "one column on the left";
    assert.equal(gatePhotoConfirmedColumns(analysis).confirmed.length, 1);
  });
});

describe("prompt selection and mask boxes", () => {
  it("prompt uses top 3 by area while mask keeps all", () => {
    const elements = [
      { type: "column" as const, position: "a", label: "column at a", bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } },
      { type: "column" as const, position: "b", label: "column at b", bbox: { x: 0, y: 0, w: 0.2, h: 0.2 } },
      { type: "column" as const, position: "c", label: "column at c", bbox: { x: 0, y: 0, w: 0.15, h: 0.15 } },
      { type: "column" as const, position: "d", label: "column at d", bbox: { x: 0, y: 0, w: 0.12, h: 0.12 } },
    ];
    assert.equal(selectStructuralElementsForPrompt(elements).length, 3);
    assert.equal(allStructuralColumnBoxes(elements).length, 4);
    const block = buildPhotoStructuralPromptBlock(elements);
    assert.match(block, /column at b/);
    assert.doesNotMatch(block, /column at a/);
  });
});

describe("hasPhotoConfirmedColumn", () => {
  it("returns true only when photoConfirmedStructuralElements is non-empty", () => {
    const analysis = {
      photoConfirmedStructuralElements: [
        {
          type: "column" as const,
          position: "left",
          label: "column at left",
          bbox: { x: 0.1, y: 0.2, w: 0.1, h: 0.5 },
        },
      ],
    } as RoomAnalysis;
    assert.equal(hasPhotoConfirmedColumn(analysis), true);
    assert.equal(hasPhotoConfirmedColumn({ ...analysis, photoConfirmedStructuralElements: [] }), false);
    assert.equal(hasPhotoConfirmedColumn(null), false);
  });
});

describe("FAL prompt wiring", () => {
  it("geometry lock prompt preserves columns when flagged", () => {
    assert.match(buildGeometryLockPrompt(true), /structural column/);
    assert.match(buildGeometryLockPrompt(true), /non-structural surfaces/);
    assert.match(buildGeometryLockPrompt(false), /Smooth matte white walls/);
  });

  it("kontext primary and retry modes prepend structural prefix", () => {
    const prefix = "PRESERVE COLUMNS: Keep every frozen structural member";
    const overlay = "Furnish with sofa.";
    const primary = buildKontextStage2Prompt({
      designOverlay: overlay,
      mode: "primary",
      structuralPreservePrefix: prefix,
    });
    assert.ok(primary.startsWith(prefix));

    const retryPreserve = buildKontextStage2Prompt({
      designOverlay: overlay,
      mode: "retry",
      retryUsesPrimaryOutput: true,
      structuralPreservePrefix: prefix,
    });
    assert.ok(retryPreserve.startsWith(prefix));
    assert.match(retryPreserve, /Furnish with sofa/);
    assert.match(retryPreserve, /Keep furniture already visible/);

    const retryFurnish = buildKontextStage2Prompt({
      designOverlay: overlay,
      mode: "retry",
      retryUsesPrimaryOutput: false,
      structuralPreservePrefix: prefix,
    });
    assert.ok(retryFurnish.startsWith(prefix));
    assert.match(retryFurnish, /Furnish with sofa/);
  });
});
