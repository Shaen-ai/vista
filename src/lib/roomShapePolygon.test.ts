import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bboxFromPolygonEdges,
  buildPolygonEdges,
  cornerLabel,
  defaultPolygonEdgesForShape,
  formatPolygonEdgesForPrompt,
  L_SHAPE_TEMPLATE,
  roomShapeUsesPolygonEditor,
  syncPolygonEdgesForShape,
} from "./roomShapePolygon";

describe("roomShapePolygon", () => {
  it("cornerLabel cycles A-Z", () => {
    assert.equal(cornerLabel(0), "A");
    assert.equal(cornerLabel(5), "F");
  });

  it("detects polygon editor shapes", () => {
    assert.equal(roomShapeUsesPolygonEditor("l-shaped"), true);
    assert.equal(roomShapeUsesPolygonEditor("u-shaped"), true);
    assert.equal(roomShapeUsesPolygonEditor("rectangular"), false);
    assert.equal(roomShapeUsesPolygonEditor("irregular"), false);
  });

  it("builds default L-shape edges from bbox", () => {
    const edges = defaultPolygonEdgesForShape("l-shaped", 5, 4);
    assert.ok(edges);
    assert.equal(edges.length, 6);
    const bbox = bboxFromPolygonEdges("l-shaped", edges);
    assert.ok(bbox.width > 0);
    assert.ok(bbox.depth > 0);
  });

  it("syncPolygonEdgesForShape preserves matching edge count", () => {
    const template = buildPolygonEdges(L_SHAPE_TEMPLATE, [3, 2, 1.5, 2, 3, 4]);
    const synced = syncPolygonEdgesForShape("l-shaped", 5, 4, template);
    assert.equal(synced?.length, 6);
    assert.equal(synced?.[0]?.length_m, 3);
  });

  it("formatPolygonEdgesForPrompt includes edge list", () => {
    const edges = defaultPolygonEdgesForShape("u-shaped", 6, 5)!;
    const text = formatPolygonEdgesForPrompt("u-shaped", edges);
    assert.match(text, /A-B/);
    assert.match(text, /Per-edge/);
  });
});
