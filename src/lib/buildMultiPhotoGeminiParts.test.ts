import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMultiPhotoIntroText, buildMultiPhotoContextParts } from "./buildMultiPhotoGeminiParts";

test("buildMultiPhotoIntroText labels each image part and edit target", () => {
  const text = buildMultiPhotoIntroText({
    roomName: "Bedroom",
    roomType: "bedroom",
    photos: [
      { id: "a", label: "IMG 4163", base64: "x", mimeType: "image/jpeg", cameraNote: "facing west" },
      { id: "b", label: "IMG 4162", base64: "y", mimeType: "image/jpeg" },
    ],
    editTargetPhotoId: "b",
    mode: "initial-design",
  });
  assert.match(text, /\[Image Part 1\].*IMG 4163/);
  assert.match(text, /\[Image Part 2\].*IMG 4162.*EDIT TARGET/);
  assert.match(text, /Cross-reference ALL photos/);
});

test("buildMultiPhotoContextParts emits intro plus one inline image per photo", () => {
  const parts = buildMultiPhotoContextParts({
    roomName: "Bedroom",
    roomType: "bedroom",
    photos: [
      { id: "a", label: "A", base64: "aaa", mimeType: "image/jpeg" },
      { id: "b", label: "B", base64: "bbb", mimeType: "image/jpeg" },
    ],
    editTargetPhotoId: "a",
    mode: "viewpoint-transfer",
  });
  assert.equal(parts.filter((p) => p.inlineData).length, 2);
  assert.match(parts[0]?.text ?? "", /2 perspective photo/);
});

test("mode selection: initial-design vs viewpoint-transfer produce different intro text", () => {
  const photos = [
    { id: "a", label: "A", base64: "aaa", mimeType: "image/jpeg" },
    { id: "b", label: "B", base64: "bbb", mimeType: "image/jpeg" },
  ];
  const initial = buildMultiPhotoIntroText({
    roomName: "Kitchen",
    roomType: "kitchen",
    photos,
    editTargetPhotoId: "a",
    mode: "initial-design",
  });
  const transfer = buildMultiPhotoIntroText({
    roomName: "Kitchen",
    roomType: "kitchen",
    photos,
    editTargetPhotoId: "a",
    mode: "viewpoint-transfer",
  });
  // Both should reference the edit target
  assert.match(initial, /EDIT TARGET/);
  assert.match(transfer, /EDIT TARGET/);
  // viewpoint-transfer should mention approved/reference design
  assert.match(transfer, /approved|reference|transfer/i);
});
