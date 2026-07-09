import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveGalleryUrls, isCatalogSofa, SOFA_GALLERY_MAX } from "./consumerCatalog";

describe("resolveGalleryUrls", () => {
  it("returns first 4 URLs from images[]", () => {
    const item = {
      images: [
        "https://cdn.example.com/img1.jpg",
        "https://cdn.example.com/img2.jpg",
        "https://cdn.example.com/img3.jpg",
        "https://cdn.example.com/img4.jpg",
        "https://cdn.example.com/img5.jpg",
      ],
      main_image_url: "https://cdn.example.com/main.jpg",
      cutout_image_url: "https://cdn.example.com/cutout.jpg",
    };
    const result = resolveGalleryUrls(item);
    assert.equal(result.length, SOFA_GALLERY_MAX);
    assert.deepEqual(result, [
      "https://cdn.example.com/img1.jpg",
      "https://cdn.example.com/img2.jpg",
      "https://cdn.example.com/img3.jpg",
      "https://cdn.example.com/img4.jpg",
    ]);
  });

  it("handles 1-3 images", () => {
    const item = {
      images: [
        "https://cdn.example.com/img1.jpg",
        "https://cdn.example.com/img2.jpg",
      ],
      main_image_url: "https://cdn.example.com/main.jpg",
    };
    const result = resolveGalleryUrls(item);
    assert.equal(result.length, 2);
    assert.deepEqual(result, [
      "https://cdn.example.com/img1.jpg",
      "https://cdn.example.com/img2.jpg",
    ]);
  });

  it("falls back to main_image_url + cutout_image_url when images[] is empty", () => {
    const item = {
      images: [],
      main_image_url: "https://cdn.example.com/main.jpg",
      cutout_image_url: "https://cdn.example.com/cutout.jpg",
    };
    const result = resolveGalleryUrls(item);
    assert.deepEqual(result, [
      "https://cdn.example.com/main.jpg",
      "https://cdn.example.com/cutout.jpg",
    ]);
  });

  it("falls back when images is not an array", () => {
    const item = {
      main_image_url: "https://cdn.example.com/main.jpg",
    };
    const result = resolveGalleryUrls(item);
    assert.deepEqual(result, ["https://cdn.example.com/main.jpg"]);
  });

  it("dedupes identical URLs", () => {
    const item = {
      images: [
        "https://cdn.example.com/same.jpg",
        "https://cdn.example.com/same.jpg",
        "https://cdn.example.com/other.jpg",
      ],
    };
    const result = resolveGalleryUrls(item);
    assert.deepEqual(result, [
      "https://cdn.example.com/same.jpg",
      "https://cdn.example.com/other.jpg",
    ]);
  });

  it("skips non-HTTP URLs", () => {
    const item = {
      images: [
        "data:image/png;base64,abc",
        "https://cdn.example.com/valid.jpg",
        "",
        "https://cdn.example.com/valid2.jpg",
      ],
    };
    const result = resolveGalleryUrls(item);
    assert.deepEqual(result, [
      "https://cdn.example.com/valid.jpg",
      "https://cdn.example.com/valid2.jpg",
    ]);
  });
});

describe("isCatalogSofa", () => {
  it("matches product_subtype sofa", () => {
    assert.equal(
      isCatalogSofa({ id: "mp-1", name: "HOBEL CORNER", category: "Furniture", product_subtype: "sofa", width_cm: 0, depth_cm: 0, height_cm: 0, price: 0, currency: "AMD" }),
      true,
    );
  });

  it("matches sofa in name", () => {
    assert.equal(
      isCatalogSofa({ id: "mp-2", name: "Sofa EGEDAL 2.5 seater", category: "Upholstery", product_subtype: "chair", width_cm: 0, depth_cm: 0, height_cm: 0, price: 0, currency: "AMD" }),
      true,
    );
  });

  it("matches sectional in category", () => {
    assert.equal(
      isCatalogSofa({ id: "mp-3", name: "Living room set", category: "Sectional sofas", product_subtype: null, width_cm: 0, depth_cm: 0, height_cm: 0, price: 0, currency: "AMD" }),
      true,
    );
  });

  it("matches divan in name", () => {
    assert.equal(
      isCatalogSofa({ id: "mp-4", name: "Divan luxury beige", category: "Furniture", product_subtype: null, width_cm: 0, depth_cm: 0, height_cm: 0, price: 0, currency: "AMD" }),
      true,
    );
  });

  it("does not match unrelated products", () => {
    assert.equal(
      isCatalogSofa({ id: "mp-5", name: "Chair HOBEL", category: "Furniture", product_subtype: "chair", width_cm: 0, depth_cm: 0, height_cm: 0, price: 0, currency: "AMD" }),
      false,
    );
  });

  it("does not match tv_stand", () => {
    assert.equal(
      isCatalogSofa({ id: "mp-6", name: "TV unit HOBEL", category: "Furniture", product_subtype: "tv_stand", width_cm: 0, depth_cm: 0, height_cm: 0, price: 0, currency: "AMD" }),
      false,
    );
  });
});
