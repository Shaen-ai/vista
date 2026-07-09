import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPublicUploadUrl,
  resolveUploadFilePath,
  saveUploadToDisk,
} from "./localUploadStorage";

test("localUploadStorage writes and resolves paths under custom root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vista-uploads-"));
  process.env.VISTA_UPLOADS_DIR = root;
  process.env.VISTA_PUBLIC_ORIGIN = "https://vista.example.com";

  const relative = await saveUploadToDisk(Buffer.from("png-bytes"), "image/png", {
    sessionId: "proj-1",
    type: "original",
  });
  assert.match(relative, /^proj-1\/[0-9a-f-]+\.png$/);

  const absolute = resolveUploadFilePath(relative);
  assert.ok(absolute);
  const bytes = await fs.readFile(absolute!);
  assert.equal(bytes.toString(), "png-bytes");

  assert.equal(
    buildPublicUploadUrl(relative),
    `https://vista.example.com/api/uploads/${relative}`,
  );

  assert.equal(resolveUploadFilePath("../etc/passwd"), null);

  delete process.env.VISTA_UPLOADS_DIR;
  delete process.env.VISTA_PUBLIC_ORIGIN;
  await fs.rm(root, { recursive: true, force: true });
});
