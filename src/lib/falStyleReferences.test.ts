import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeStyleReferenceCacheKey,
  mergeFalPipelineWarnings,
  buildImageRolesBlock,
  pickGeminiStyleInput,
  buildCachedStyleReferenceHitResult,
  buildKontextImageUrls,
  STYLE_REF_FAILURE_WARNING,
  STRUCTURAL_FALLBACK_WARNING,
  shouldGenerateGeminiStylePlate,
} from "./falStyleReferenceUtils";
import { buildCompactOpeningLockForFal } from "./falOpeningLockCompact";
import type { UserPreferences } from "./project/types";

const prefs: UserPreferences = {
  style: "modern-neutral",
  familyMembers: 2,
  budgetTier: "luxury",
  wishes: "green wallpaper",
  designMode: "custom",
};

test("computeStyleReferenceCacheKey uses base64 content for inspiration hash", () => {
  const keyA = computeStyleReferenceCacheKey({
    conceptPrompt: "concept",
    preferences: prefs,
    photoId: "photo-1",
    inspirationUploads: [{ base64: "abc123" }],
    geminiStyleInputBase64: "hero-bytes",
  });
  const keyB = computeStyleReferenceCacheKey({
    conceptPrompt: "concept",
    preferences: prefs,
    photoId: "photo-1",
    inspirationUploads: [{ base64: "different" }],
    geminiStyleInputBase64: "hero-bytes",
  });
  assert.notEqual(keyA, keyB);
});

test("computeStyleReferenceCacheKey ignores photo input in brief-only mode", () => {
  const base = {
    conceptPrompt: "concept",
    preferences: prefs,
    photoId: "photo-1",
    inspirationUploads: [] as { base64: string }[],
  };
  const a = computeStyleReferenceCacheKey({
    ...base,
    geminiStyleInputBase64: "hero-a",
  });
  const b = computeStyleReferenceCacheKey({
    ...base,
    geminiStyleInputBase64: "hero-b",
  });
  assert.equal(a, b);
});

test("computeStyleReferenceCacheKey invalidates when hero photo changes with USE_PHOTO=1", () => {
  const prev = process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO;
  process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO = "1";
  try {
    const base = {
      conceptPrompt: "concept",
      preferences: prefs,
      photoId: "photo-1",
      inspirationUploads: [] as { base64: string }[],
    };
    const heroA = computeStyleReferenceCacheKey({
      ...base,
      geminiStyleInputBase64: "hero-photo-a",
    });
    const heroB = computeStyleReferenceCacheKey({
      ...base,
      geminiStyleInputBase64: "hero-photo-b",
    });
    assert.notEqual(heroA, heroB);
  } finally {
    if (prev === undefined) delete process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO;
    else process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO = prev;
  }
});

test("computeStyleReferenceCacheKey invalidates when wishes change", () => {
  const keyA = computeStyleReferenceCacheKey({
    conceptPrompt: "concept",
    preferences: { ...prefs, wishes: "bunk bed" },
    photoId: "photo-1",
    inspirationUploads: [],
    geminiStyleInputBase64: "hero",
  });
  const keyB = computeStyleReferenceCacheKey({
    conceptPrompt: "concept",
    preferences: { ...prefs, wishes: "green wallpaper" },
    photoId: "photo-1",
    inspirationUploads: [],
    geminiStyleInputBase64: "hero",
  });
  assert.notEqual(keyA, keyB);
});

test("mergeFalPipelineWarnings combines structural and style-ref clauses", () => {
  const merged = mergeFalPipelineWarnings(
    STRUCTURAL_FALLBACK_WARNING,
    STYLE_REF_FAILURE_WARNING,
  );
  assert.match(merged!, /structural check/i);
  assert.match(merged!, /Style reference could not be generated/i);
  assert.ok(merged!.indexOf("structural") < merged!.indexOf("Style reference"));
});

test("buildImageRolesBlock describes user inspiration ref when geminiStyleRef is false", () => {
  const block = buildImageRolesBlock({
    styleRefCount: 1,
    geminiStyleRef: false,
  });
  assert.match(block, /STYLE INSPIRATION photo/);
  assert.match(block, /image_urls\[0\] defines all structure/);
  assert.doesNotMatch(block, /DESIGN CONCEPT image/);
});

test("buildImageRolesBlock describes gemini ref at index 1 with anti-collage line", () => {
  const block = buildImageRolesBlock({
    styleRefCount: 1,
    geminiStyleRef: true,
  });
  assert.match(block, /image_urls\[1\] = STYLE REFERENCES/);
  assert.match(block, /DESIGN CONCEPT image/);
  assert.match(block, /Reference \[1\]/);
  assert.match(block, /no collage/i);
  assert.doesNotMatch(block, /GEOMETRY SCHEMATIC/);
});

test("buildImageRolesBlock omits style lines when styleRefCount is zero", () => {
  const block = buildImageRolesBlock({
    styleRefCount: 0,
    geminiStyleRef: false,
  });
  assert.doesNotMatch(block, /image_urls\[1\.\.N\]/);
  assert.match(block, /image_urls\[0\]/);
});

test("buildImageRolesBlock describes structural markup at index 1 and style at index 2", () => {
  const block = buildImageRolesBlock({
    styleRefCount: 1,
    hasStructuralMarkup: true,
    geminiStyleRef: false,
  });
  assert.match(block, /image_urls\[1\] = STRUCTURAL MARKUP/);
  assert.match(block, /image_urls\[2\] = STYLE REFERENCES/);
  assert.match(block, /do NOT reproduce the gold markup lines/i);
  assert.match(block, /fully furnished photoreal interior photograph/i);
});

test("buildKontextImageUrls excludes geometry schematic even if legacy callers pass it", () => {
  const urls = buildKontextImageUrls({
    baseUrl: "https://fal.ai/room.png",
    styleReferenceUrls: ["https://fal.ai/style.png"],
  });
  assert.equal(urls.length, 2);
  assert.equal(urls[0], "https://fal.ai/room.png");
  assert.equal(urls[1], "https://fal.ai/style.png");
});

test("pickGeminiStyleInput uses hero photo when USE_PHOTO=1, never stage1", () => {
  const prev = process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO;
  process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO = "1";
  try {
    const result = pickGeminiStyleInput({
      heroPhotoBase64: "construction-photo",
      heroPhotoMime: "image/jpeg",
    });
    assert.equal(result.base64, "construction-photo");
    assert.equal(result.source, "hero");
  } finally {
    if (prev === undefined) delete process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO;
    else process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO = prev;
  }
});

test("pickGeminiStyleInput returns brief_only when USE_PHOTO is off", () => {
  const prev = process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO;
  process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO = "0";
  try {
    const result = pickGeminiStyleInput({
      heroPhotoBase64: "construction-photo",
      heroPhotoMime: "image/jpeg",
    });
    assert.equal(result.source, "brief_only");
    assert.equal(result.base64, undefined);
  } finally {
    if (prev === undefined) delete process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO;
    else process.env.VISTA_FAL_STYLE_PLATE_USE_PHOTO = prev;
  }
});

test("buildCachedStyleReferenceHitResult omits cacheEntry", () => {
  const result = buildCachedStyleReferenceHitResult("https://fal.media/style-plate.jpg");
  assert.equal(result.source, "gemini");
  assert.equal(result.count, 1);
  assert.equal(result.cacheEntry, undefined);
});

test("primary opening lock compacts plan-door off-camera rules", () => {
  const openingLock = buildCompactOpeningLockForFal(
    "OPENING COUNT LOCK: 0 doors visible; plan has 1 door off-camera west — do NOT add doors on visible walls.",
  );
  assert.ok(openingLock.length > 0);
  assert.match(openingLock, /off-camera west/i);
});

test("shouldGenerateGeminiStylePlate is false when user uploads present", () => {
  assert.equal(shouldGenerateGeminiStylePlate([{ base64: "user-ref" }]), false);
  assert.equal(shouldGenerateGeminiStylePlate([]), true);
});

test("shouldGenerateGeminiStylePlate is false when VISTA_FAL_STYLE_PLATE=0", () => {
  const prev = process.env.VISTA_FAL_STYLE_PLATE;
  process.env.VISTA_FAL_STYLE_PLATE = "0";
  try {
    assert.equal(shouldGenerateGeminiStylePlate([{ base64: "user-ref" }]), false);
    assert.equal(shouldGenerateGeminiStylePlate([]), false);
  } finally {
    if (prev === undefined) delete process.env.VISTA_FAL_STYLE_PLATE;
    else process.env.VISTA_FAL_STYLE_PLATE = prev;
  }
});
