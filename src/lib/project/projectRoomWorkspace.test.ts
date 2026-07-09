import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  ensureRoomWorkspace,
  readWorkspaceFile,
  roomWorkspaceDir,
  writeWorkspaceFile,
  writeWorkspaceMeta,
  readWorkspaceMeta,
} from "./projectRoomWorkspace";

test("projectRoomWorkspace writes and reads files under custom root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vista-ws-"));
  process.env.VISTA_PROJECT_STORAGE_ROOT = root;
  const projectId = "proj-test";
  const roomId = "room-a";

  await ensureRoomWorkspace(projectId, roomId);
  assert.equal(roomWorkspaceDir(projectId, roomId), path.join(root, projectId, roomId));

  await writeWorkspaceFile(projectId, roomId, "original.jpg", Buffer.from("photo"));
  const read = await readWorkspaceFile(projectId, roomId, "original.jpg");
  assert.equal(read?.toString(), "photo");

  await writeWorkspaceMeta(projectId, roomId, { status: "running", step: "prep" });
  const meta = await readWorkspaceMeta(projectId, roomId);
  assert.equal(meta?.status, "running");
  assert.equal(meta?.step, "prep");

  delete process.env.VISTA_PROJECT_STORAGE_ROOT;
  await fs.rm(root, { recursive: true, force: true });
});
