import test from "node:test";
import assert from "node:assert/strict";
import { classifyAiError } from "./aiIncidentClassifier.ts";
import { AI_SERVICE_CONFIG_ERROR_CODE } from "./tunzoneAi.ts";

test("classifyAiError detects missing FAL key as provider_auth", () => {
  const result = classifyAiError(new Error("FAL_KEY is not set (required for fal storage/render)."));
  assert.equal(result.category, "provider_auth");
  assert.equal(result.provider, "fal");
});

test("classifyAiError detects OpenAI 401 as provider_auth", () => {
  const result = classifyAiError(new Error("OpenAI images/edits failed: 401 invalid_api_key"));
  assert.equal(result.category, "provider_auth");
  assert.equal(result.provider, "openai");
});

test("classifyAiError treats generic failures as unexpected", () => {
  const result = classifyAiError(new Error("Image generation returned no results."));
  assert.equal(result.category, "unexpected");
});

test("AI_SERVICE_CONFIG_ERROR_CODE is stable", () => {
  assert.equal(AI_SERVICE_CONFIG_ERROR_CODE, "ai_service_unavailable");
});
