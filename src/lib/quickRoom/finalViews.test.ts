import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPhasedFinalViews, shouldShowPhasedGallery } from "./finalViews";

describe("buildPhasedFinalViews", () => {
  it("returns empty when there are no extra photos", () => {
    const views = buildPhasedFinalViews({
      primary: { base64: "abc", mimeType: "image/png" },
      extraPhotos: [],
      tracks: { x: { phase1Versions: [], phase1SelectedIndex: 0, phase2Versions: [], phase2SelectedIndex: 0, phase3Versions: [], phase3SelectedIndex: 0 } },
      compactFlow: false,
    });
    assert.deepEqual(views, []);
  });

  it("skips base-only extra tracks when primary is fully phased", () => {
    const views = buildPhasedFinalViews({
      primary: { base64: "final", mimeType: "image/png" },
      extraPhotos: [{ id: "extra-1" }],
      tracks: {
        "extra-1": {
          phase1Versions: [{ image: { base64: "base-only", mimeType: "image/png" } }],
          phase1SelectedIndex: 0,
          phase2Versions: [],
          phase2SelectedIndex: 0,
          phase3Versions: [],
          phase3SelectedIndex: 0,
        },
      },
      compactFlow: false,
    });
    assert.deepEqual(views, []);
  });

  it("includes distinct finished extra viewpoints", () => {
    const views = buildPhasedFinalViews({
      primary: { base64: "final", mimeType: "image/png" },
      extraPhotos: [{ id: "extra-1" }],
      tracks: {
        "extra-1": {
          phase1Versions: [],
          phase1SelectedIndex: 0,
          phase2Versions: [],
          phase2SelectedIndex: 0,
          phase3Versions: [{ image: { base64: "extra-final", mimeType: "image/png" } }],
          phase3SelectedIndex: 0,
        },
      },
      compactFlow: false,
    });
    assert.equal(views.length, 2);
    assert.equal(views[0]?.base64, "final");
    assert.equal(views[1]?.base64, "extra-final");
  });
});

describe("shouldShowPhasedGallery", () => {
  it("requires extra photos and multiple views", () => {
    assert.equal(shouldShowPhasedGallery([{ id: "a", base64: "1", mimeType: "image/png" }, { id: "b", base64: "2", mimeType: "image/png" }], 0), false);
    assert.equal(shouldShowPhasedGallery([{ id: "a", base64: "1", mimeType: "image/png" }], 1), false);
    assert.equal(
      shouldShowPhasedGallery(
        [{ id: "a", base64: "1", mimeType: "image/png" }, { id: "b", base64: "2", mimeType: "image/png" }],
        1,
      ),
      true,
    );
  });
});
