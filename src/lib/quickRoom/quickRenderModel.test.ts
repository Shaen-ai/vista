import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolveQuickRenderModel } from "./quickRenderModel";

const savedEnv = {
  VISTA_QUICK_RENDER_MODEL: process.env.VISTA_QUICK_RENDER_MODEL,
  FAL_KEY: process.env.FAL_KEY,
  FAL_AI_KEY: process.env.FAL_AI_KEY,
};

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("defaults to edit-pipeline when FAL_KEY is set", () => {
  process.env.FAL_KEY = "test-key";
  delete process.env.VISTA_QUICK_RENDER_MODEL;
  assert.equal(resolveQuickRenderModel(), "edit-pipeline");
});

test("legacy and gemini values select the legacy engine", () => {
  process.env.FAL_KEY = "test-key";
  process.env.VISTA_QUICK_RENDER_MODEL = "legacy";
  assert.equal(resolveQuickRenderModel(), "legacy");
  process.env.VISTA_QUICK_RENDER_MODEL = "Gemini";
  assert.equal(resolveQuickRenderModel(), "legacy");
});

test("degrades to legacy when no fal credentials exist", () => {
  delete process.env.FAL_KEY;
  delete process.env.FAL_AI_KEY;
  delete process.env.VISTA_QUICK_RENDER_MODEL;
  assert.equal(resolveQuickRenderModel(), "legacy");
});

test("FAL_AI_KEY alias also enables the edit pipeline", () => {
  delete process.env.FAL_KEY;
  process.env.FAL_AI_KEY = "alias-key";
  delete process.env.VISTA_QUICK_RENDER_MODEL;
  assert.equal(resolveQuickRenderModel(), "edit-pipeline");
});
