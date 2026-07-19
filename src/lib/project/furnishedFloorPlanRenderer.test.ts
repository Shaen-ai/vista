import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFurnishedFloorPlanPrompt,
  furnitureHintForRoomType,
} from "./furnishedFloorPlanPrompt";
import { isPlanOnlyProject, type ProjectState } from "./types";

function minimalProjectState(overrides?: Partial<ProjectState>): ProjectState {
  return {
    id: "p1",
    status: "reviewing",
    preferences: {
      style: "modern-neutral",
      familyMembers: 2,
      budgetTier: "mid",
      wishes: "warm wood tones",
      designMode: "custom",
    },
    floorPlanBase64: "abc",
    floorPlanMimeType: "image/jpeg",
    analysis: {
      totalArea: 80,
      ceilingHeight: 2.7,
      rooms: [
        {
          id: "r1",
          name: "Living",
          type: "living",
          estimatedArea: 25,
          dimensions: { width: 5, depth: 5, height: 2.7 },
          polygon: [
            [0, 0],
            [5000, 0],
            [5000, 5000],
            [0, 5000],
          ],
          windows: [],
          doors: [],
          features: [],
        },
        {
          id: "r2",
          name: "Bedroom",
          type: "bedroom",
          estimatedArea: 14,
          dimensions: { width: 4, depth: 3.5, height: 2.7 },
          polygon: [
            [5000, 0],
            [9000, 0],
            [9000, 3500],
            [5000, 3500],
          ],
          windows: [],
          doors: [],
          features: [],
        },
      ],
      wallSegments: [],
      overallShape: "rectangular",
      notes: "",
    },
    concept: {
      projectName: "Test",
      overallStyle: "Modern Neutral",
      colorPalette: {
        primary: { hex: "#f5f5f4", ncs: "NCS", name: "Warm White" },
        secondary: { hex: "#d6d3d1", ncs: "NCS", name: "Stone" },
        accent: { hex: "#78716c", ncs: "NCS", name: "Taupe" },
        neutral: { hex: "#e7e5e4", ncs: "NCS", name: "Sand" },
      },
      materialPalette: {
        woodType: "oak",
        metalFinish: "brushed brass",
        stoneType: "travertine",
        textilePrimary: "linen",
      },
      rooms: [
        {
          roomId: "r1",
          roomName: "Living",
          roomType: "living",
          wallColor: { hex: "#f5f5f4", ncs: "NCS" },
          floorMaterial: "oak flooring",
          ceilingDesign: "flat white",
          lightingConcept: "recessed grid",
          furnitureList: ["sofa", "coffee table"],
          keyDesignElements: [],
          renderAngles: [],
          specialNotes: "",
        },
        {
          roomId: "r2",
          roomName: "Bedroom",
          roomType: "bedroom",
          wallColor: { hex: "#f5f5f4", ncs: "NCS" },
          floorMaterial: "oak flooring",
          ceilingDesign: "flat white",
          lightingConcept: "pendant",
          furnitureList: [],
          keyDesignElements: [],
          renderAngles: [],
          specialNotes: "",
        },
      ],
    },
    roomRenderPlans: null,
    rooms: [],
    currentRoomIndex: 0,
    technicalDrawings: null,
    wallElevations: null,
    pdfBase64: null,
    error: null,
    createdAt: "",
    updatedAt: "",
    roomPhotos: {},
    uploadedPhotos: [],
    scrapedRoomAllowlists: null,
    pinnedProductIds: [],
    inspirationUploads: [],
    suggestedRoomOrder: [],
    approvedDesignSummaries: {},
    floorPlanConfirmed: true,
    utilityEntryPoints: [],
    ...overrides,
  };
}

test("isPlanOnlyProject is true with zero uploaded photos", () => {
  const state = minimalProjectState({ uploadedPhotos: [] });
  assert.equal(isPlanOnlyProject(state), true);
});

test("isPlanOnlyProject is false when photos exist", () => {
  const state = minimalProjectState({
    uploadedPhotos: [
      {
        id: "p1",
        label: "Living",
        base64: "x",
        mimeType: "image/jpeg",
        roomId: "r1",
      },
    ],
  });
  assert.equal(isPlanOnlyProject(state), false);
});

test("furnitureHintForRoomType maps bedroom and dining", () => {
  assert.match(furnitureHintForRoomType("bedroom"), /bed/i);
  assert.match(furnitureHintForRoomType("dining"), /table/i);
});

test("buildFurnishedFloorPlanPrompt includes rooms, style, and wishes", () => {
  const prompt = buildFurnishedFloorPlanPrompt(minimalProjectState());
  assert.match(prompt, /Modern Neutral/);
  assert.match(prompt, /Living \(living\)/);
  assert.match(prompt, /Bedroom \(bedroom\)/);
  assert.match(prompt, /sofa, coffee table/);
  assert.match(prompt, /warm wood tones/);
  assert.match(prompt, /FURNISHED FLOOR PLAN/i);
  assert.match(prompt, /Do NOT generate perspective room photographs/i);
});
