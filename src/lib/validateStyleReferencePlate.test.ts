import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStyleReferencePlate } from "./validateStyleReferencePlate";

test("validateStyleReferencePlate soft-passes when OPENAI_API_KEY is missing", async () => {
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await validateStyleReferencePlate({
      renderedBase64: "empty-room-bytes",
      renderedMime: "image/png",
      styleBrief: "Luxury bedroom with bunk bed",
    });
    assert.equal(result.furnished, true);
    assert.match(result.reason, /skipped/i);
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
  }
});
