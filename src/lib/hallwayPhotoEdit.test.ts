import test from "node:test";
import assert from "node:assert/strict";
import { buildHallwayPhotoGeminiParts } from "./hallwayPhotoEditParts";

test("buildHallwayPhotoGeminiParts puts reference angles before EDIT TARGET", () => {
  const parts = buildHallwayPhotoGeminiParts({
    roomName: "Entrance Hall",
    editTargetPhotoId: "p2",
    photos: [
      { id: "p1", label: "Angle A", base64: "ref-a", mimeType: "image/jpeg" },
      { id: "p2", label: "Angle B", base64: "edit-b", mimeType: "image/jpeg" },
      { id: "p3", label: "Angle C", base64: "ref-c", mimeType: "image/jpeg" },
    ],
  });

  const texts = parts.filter((p) => p.text).map((p) => p.text!);
  const refIndex = texts.findIndex((t) => t.includes("Reference angle"));
  const editIndex = texts.findIndex((t) => t.includes("EDIT TARGET"));
  assert.ok(refIndex >= 0);
  assert.ok(editIndex > refIndex);

  const images = parts.filter((p) => p.inlineData).map((p) => p.inlineData!.data);
  assert.deepEqual(images, ["ref-a", "ref-c", "edit-b"]);
});

test("buildHallwayPhotoGeminiParts with single photo emits EDIT TARGET only", () => {
  const parts = buildHallwayPhotoGeminiParts({
    editTargetPhotoId: "p1",
    photos: [{ id: "p1", label: "Main", base64: "only", mimeType: "image/jpeg" }],
  });
  assert.equal(parts.filter((p) => p.inlineData).length, 1);
  assert.match(parts[0]?.text ?? "", /EDIT TARGET/);
});
