import type { PhotoRenderPrompt, RoomFinishLock } from "./types";
import fs from "fs/promises";
import path from "path";

export interface WorkspaceMeta {
  status: string;
  step?: string;
  error?: string;
  attempt?: number;
  prepComplete?: boolean;
  stagingComplete?: boolean;
  prepSkipped?: boolean;
  renderModel?: string;
  updatedAt: string;
}

export function getProjectStorageRoot(): string {
  return (
    process.env.VISTA_PROJECT_STORAGE_ROOT?.trim() ||
    path.join(process.cwd(), ".data/vista-projects")
  );
}

export function roomWorkspaceDir(projectId: string, roomId: string): string {
  return path.join(getProjectStorageRoot(), projectId, roomId);
}

export function workspaceFilePath(projectId: string, roomId: string, name: string): string {
  return path.join(roomWorkspaceDir(projectId, roomId), name);
}

export async function ensureRoomWorkspace(projectId: string, roomId: string): Promise<string> {
  const dir = roomWorkspaceDir(projectId, roomId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeWorkspaceFile(
  projectId: string,
  roomId: string,
  name: string,
  buffer: Buffer,
): Promise<string> {
  await ensureRoomWorkspace(projectId, roomId);
  const fp = workspaceFilePath(projectId, roomId, name);
  await fs.writeFile(fp, buffer);
  return fp;
}

export async function readWorkspaceFile(
  projectId: string,
  roomId: string,
  name: string,
): Promise<Buffer | null> {
  try {
    return await fs.readFile(workspaceFilePath(projectId, roomId, name));
  } catch {
    return null;
  }
}

export async function workspaceFileExists(
  projectId: string,
  roomId: string,
  name: string,
): Promise<boolean> {
  try {
    await fs.access(workspaceFilePath(projectId, roomId, name));
    return true;
  } catch {
    return false;
  }
}

export async function deleteWorkspaceFile(
  projectId: string,
  roomId: string,
  name: string,
): Promise<void> {
  try {
    await fs.unlink(workspaceFilePath(projectId, roomId, name));
  } catch {
    // ignore missing
  }
}

export async function readWorkspaceMeta(
  projectId: string,
  roomId: string,
): Promise<WorkspaceMeta | null> {
  const buf = await readWorkspaceFile(projectId, roomId, "meta.json");
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString()) as WorkspaceMeta;
  } catch {
    return null;
  }
}

export async function writeWorkspaceMeta(
  projectId: string,
  roomId: string,
  meta: Partial<WorkspaceMeta> & { status?: string },
): Promise<void> {
  const existing = await readWorkspaceMeta(projectId, roomId);
  const merged: WorkspaceMeta = {
    ...(existing ?? { status: meta.status ?? "running", updatedAt: new Date().toISOString() }),
    ...meta,
    status: meta.status ?? existing?.status ?? "running",
    updatedAt: new Date().toISOString(),
  };
  await writeWorkspaceFile(
    projectId,
    roomId,
    "meta.json",
    Buffer.from(JSON.stringify(merged, null, 2)),
  );
}

export async function writeWorkspaceSeed(
  projectId: string,
  roomId: string,
  seed: number,
  stagingPrompt: string,
  masterRenderPrompt?: string,
  extras?: {
    finishLock?: RoomFinishLock;
    photoPrompts?: PhotoRenderPrompt[];
  },
): Promise<void> {
  await writeWorkspaceFile(
    projectId,
    roomId,
    "seed.json",
    Buffer.from(
      JSON.stringify(
        {
          seed,
          stagingPrompt,
          masterRenderPrompt,
          finishLock: extras?.finishLock,
          photoPrompts: extras?.photoPrompts,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    ),
  );
}
