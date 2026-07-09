import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatViewpointAnalysisForPrompt } from "./viewpointPhotoAnalyzer";
import type { ViewpointFraming } from "./viewpointFraming";
import type { DetectedRoom, ViewpointPhotoAnalysis } from "./types";

function sampleFraming(): ViewpointFraming {
  return {
    fovDeg: 85,
    facing: "east",
    aheadWall: "east",
    leftWall: "north",
    rightWall: "south",
    aheadWallM: 2.6,
    leftWallM: 5.65,
    rightWallM: 5.65,
    standingDesc: "camera ~0.1 m from the west wall, near the north-west corner, facing east",
    visibleOpenings: [],
    note: "camera ~0.1 m from the west wall, facing east. Ahead: east wall.",
    openingsSummary: "In view: window on east wall ahead",
    wallLengthsM: { back: 2.6, left: 5.65, right: 5.65 },
  };
}

function sampleAnalysis(): ViewpointPhotoAnalysis {
  return {
    walls: [
      {
        position: "center",
        compass: "east",
        openings: [
          { type: "window", placementAlongWall: "centered on the far wall", confirmed: true },
        ],
        features: ["exposed plumbing below the window"],
        currentFinish: "light beige-white plaster",
      },
      {
        position: "left",
        compass: "north",
        openings: [],
        features: ["small electrical outlet boxes"],
        currentFinish: "white plaster",
      },
    ],
    ceiling: { type: "flat plaster", features: ["dropped soffit near the window"] },
    floor: { currentFinish: "unfinished concrete screed" },
    structuralNotes: "room in an unfinished renovation state",
    structuralMembers: [],
  };
}

const room = { dimensions: { width: 5.76, depth: 2.61, height: 2.7 } } as DetectedRoom;

describe("formatViewpointAnalysisForPrompt", () => {
  it("describes orientation + finishes but states no per-wall opening placement", () => {
    const text = formatViewpointAnalysisForPrompt(sampleFraming(), sampleAnalysis(), room);

    // Retains camera orientation, wall finishes, ceiling, floor.
    assert.match(text, /CAMERA VANTAGE/);
    assert.match(text, /facing east/);
    assert.match(text, /light beige-white plaster/);
    assert.match(text, /Ceiling: 2\.7m/);
    assert.match(text, /Floor: unfinished concrete screed/);
    // Defers openings to the authoritative floor-plan lock.
    assert.match(text, /the floor plan is authoritative/i);

    // The dedicated per-wall opening clauses are gone (placement is owned by the
    // opening lock). Feature strings may still mention a window incidentally.
    assert.doesNotMatch(text, /window centered on the far wall/i);
    assert.doesNotMatch(text, /, no openings\./);
  });
});
