import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildQuoteMessage } from "./priceQuoteMessage";

describe("buildQuoteMessage", () => {
  it("includes inquiry, room type, style, project id, and share url", () => {
    const message = buildQuoteMessage({
      inquiry: "Hi! I'd like a price quote.",
      roomType: "living_room",
      style: "modern",
      projectId: "proj-123",
      shareUrl: "https://vista.tunzone.com/share/abc",
    });

    assert.match(message, /Hi! I'd like a price quote\./);
    assert.match(message, /Room type: living_room/);
    assert.match(message, /Style: modern/);
    assert.match(message, /Project ID: proj-123/);
    assert.match(message, /Share URL: https:\/\/vista\.tunzone\.com\/share\/abc/);
  });

  it("omits optional lines when values are missing", () => {
    const message = buildQuoteMessage({
      inquiry: "Quote please",
    });

    assert.equal(message, "Quote please");
    assert.doesNotMatch(message, /Project ID:/);
    assert.doesNotMatch(message, /Share URL:/);
  });
});
