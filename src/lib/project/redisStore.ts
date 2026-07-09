/**
 * Redis-backed project state store.
 * Replaces the in-memory Map for production durability across restarts.
 */

import "server-only";
import Redis from "ioredis";
import type { ProjectState } from "./types";
import { pipelineLog, pipelineTimed } from "@/lib/pipelineLog";

const PROJECT_KEY_PREFIX = "vista:project:";
const PROJECT_TTL_SECONDS = 60 * 60 * 24; // 24 hours

let client: Redis | null = null;

function getRedisClient(): Redis {
  if (client) return client;
  const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  client = new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  return client;
}

function projectKey(id: string): string {
  return `${PROJECT_KEY_PREFIX}${id}`;
}

export async function getProjectFromRedis(id: string): Promise<ProjectState | undefined> {
  const start = Date.now();
  try {
    const redis = getRedisClient();
    const raw = await redis.get(projectKey(id));
    const found = !!raw;
    if (!found) {
      pipelineLog("STATE_PERSIST", "redis getProject — miss", {
        projectId: id,
        durationMs: Date.now() - start,
      });
      return undefined;
    }
    return JSON.parse(raw) as ProjectState;
  } catch (err) {
    pipelineLog(
      "STATE_PERSIST",
      "redis getProject — failed",
      { projectId: id, durationMs: Date.now() - start, error: String(err).slice(0, 300) },
      "error",
    );
    console.error("Redis getProject error:", err);
    return undefined;
  }
}

export async function setProjectInRedis(state: ProjectState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  let payloadBytes = 0;
  try {
    await pipelineTimed(
      "STATE_PERSIST",
      "redis setProject",
      async () => {
        const payload = JSON.stringify(state);
        payloadBytes = payload.length;
        const redis = getRedisClient();
        await redis.set(projectKey(state.id), payload, "EX", PROJECT_TTL_SECONDS);
      },
      {
        meta: {
          projectId: state.id,
        },
        completeMeta: () => ({ payloadBytes }),
      },
    );
  } catch (err) {
    pipelineLog(
      "STATE_PERSIST",
      "redis setProject — failed",
      { projectId: state.id, error: String(err).slice(0, 300) },
      "error",
    );
    console.error("Redis setProject error:", err);
    throw err;
  }
}

export async function deleteProjectFromRedis(id: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(projectKey(id));
  } catch (err) {
    console.error("Redis deleteProject error:", err);
  }
}
