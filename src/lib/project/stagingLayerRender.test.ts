import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveStagingLayerRenderer } from "./stagingLayerRouter";
import type { RoomPhotoWithViewpoint } from "./types";

function photo(overrides: Partial<RoomPhotoWithViewpoint> = {}): RoomPhotoWithViewpoint {
  return {
    id: "p1",
    base64: "abc",
    mimeType: "image/jpeg",
    label: "test",
    ...overrides,
  };
}

describe("resolveStagingLayerRenderer", () => {
  it("uses apartment-staging when no opening boxes", () => {
    assert.equal(resolveStagingLayerRenderer(photo(), "shell"), "apartment-staging");
    assert.equal(resolveStagingLayerRenderer(photo(), "furnish"), "apartment-staging");
    assert.equal(
      resolveStagingLayerRenderer(
        photo({ openingAnalysis: { window_boxes: [], door_boxes: [] } }),
        "shell",
      ),
      "apartment-staging",
    );
  });

  it("uses flux opening freeze when door or window boxes exist (both layers)", () => {
    const withDoor = photo({
      openingAnalysis: { door_boxes: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }] },
    });
    assert.equal(resolveStagingLayerRenderer(withDoor, "shell"), "flux-opening-freeze");
    assert.equal(resolveStagingLayerRenderer(withDoor, "furnish"), "flux-opening-freeze");
    assert.equal(
      resolveStagingLayerRenderer(
        photo({ openingAnalysis: { window_boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] } }),
        "furnish",
      ),
      "flux-opening-freeze",
    );
  });
});
