import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STYLE_REF_OUTPUT_MAX_EDGE,
  pickGeminiStyleInput,
} from "./falStyleReferenceUtils";

test("pickGeminiStyleInput uses hero photo when USE_PHOTO=1", () => {
  const prev = process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO;
  process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO = "1";
  try {
    const picked = pickGeminiStyleInput({
      heroPhotoBase64: "raw-construction",
      heroPhotoMime: "image/jpeg",
    });
    assert.equal(picked.source, "hero");
    assert.equal(picked.base64, "raw-construction");
  } finally {
    if (prev === undefined) delete process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO;
    else process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO = prev;
  }
});

test("pickGeminiStyleInput is brief_only when USE_PHOTO is off", () => {
  const prev = process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO;
  process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO = "0";
  try {
    const picked = pickGeminiStyleInput({
      heroPhotoBase64: "raw-construction",
      heroPhotoMime: "image/jpeg",
    });
    assert.equal(picked.source, "brief_only");
    assert.equal(picked.base64, undefined);
  } finally {
    if (prev === undefined) delete process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO;
    else process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO = prev;
  }
});

test("style reference output max edge is 1024px", () => {
  assert.equal(STYLE_REF_OUTPUT_MAX_EDGE, 1024);
});
