import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildObjectRemovalDirective,
  FAL_OBJECT_REMOVAL_TAIL,
  OBJECT_REMOVAL_DIRECTIVE,
} from "./buildObjectRemovalDirective";
import { buildFalRedesignPrompt } from "./falPipelinePrompt";

describe("buildObjectRemovalDirective", () => {
  it("returns directive when mask is present", () => {
    assert.equal(buildObjectRemovalDirective(true), OBJECT_REMOVAL_DIRECTIVE);
  });

  it("returns empty string when no mask", () => {
    assert.equal(buildObjectRemovalDirective(false), "");
  });

  it("exports FAL tail matching directive", () => {
    assert.equal(FAL_OBJECT_REMOVAL_TAIL, OBJECT_REMOVAL_DIRECTIVE);
  });
});

describe("buildFalRedesignPrompt removal tail", () => {
  it("appends object removal mandate when mask flag set", () => {
    const out = buildFalRedesignPrompt({
      designPrompt: "Modern living room with warm lighting.",
      hasObjectRemovalMask: true,
    });
    assert.match(out, /OBJECT REMOVAL/);
  });
});
