import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLayeredStagingEnabled } from "./stagingLayeredConfig";

describe("isLayeredStagingEnabled", () => {
  it("respects explicit opt-out", () => {
    process.env.VISTA_STAGING_LAYERED = "0";
    assert.equal(isLayeredStagingEnabled(), false);
    delete process.env.VISTA_STAGING_LAYERED;
  });

  it("respects explicit opt-in", () => {
    process.env.VISTA_STAGING_LAYERED = "1";
    assert.equal(isLayeredStagingEnabled(), true);
    delete process.env.VISTA_STAGING_LAYERED;
  });
});
