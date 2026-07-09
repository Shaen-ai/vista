import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProjectRenderModel } from "./projectRenderModel";

test("resolveProjectRenderModel defaults to edit-pipeline", () => {
  delete process.env.VISTA_PROJECT_RENDER_MODEL;
  assert.equal(resolveProjectRenderModel(), "edit-pipeline");
});

test("resolveProjectRenderModel reads kontext flag", () => {
  process.env.VISTA_PROJECT_RENDER_MODEL = "kontext";
  assert.equal(resolveProjectRenderModel(), "kontext");
  delete process.env.VISTA_PROJECT_RENDER_MODEL;
});

test("resolveProjectRenderModel reads apartment-staging flag", () => {
  process.env.VISTA_PROJECT_RENDER_MODEL = "apartment-staging";
  assert.equal(resolveProjectRenderModel(), "apartment-staging");
  delete process.env.VISTA_PROJECT_RENDER_MODEL;
});
