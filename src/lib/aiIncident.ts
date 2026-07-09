import "server-only";

import { getPublicApiUrl } from "@/lib/publicEnv";
import {
  AI_SERVICE_CONFIG_ERROR_CODE,
  PUBLIC_AI_GENERIC_ERROR,
  PUBLIC_AI_SERVICE_UNAVAILABLE,
} from "@/lib/tunzoneAi";
import {
  classifyAiError,
  errorText,
  isOverloadedAiError,
  sanitizeIncidentMessage,
  type AiIncidentCategory,
  type AiProvider,
} from "@/lib/aiIncidentClassifier";

export type { AiIncidentCategory, AiProvider };
export { classifyAiError, isOverloadedAiError };

export interface AiIncidentClassification {
  category: AiIncidentCategory;
  provider: AiProvider;
}

export interface ReportAiIncidentPayload {
  category: AiIncidentCategory;
  provider?: AiProvider;
  route: string;
  errorMessage: string;
  roomType?: string;
  phase?: string;
}

function laravelApiBase(): string {
  const raw = process.env.LARAVEL_API_URL || getPublicApiUrl();
  return raw.replace(/\/$/, "");
}

const THROTTLE_MS = 15 * 60 * 1000;
const recentReports = new Map<string, number>();

function throttleKey(payload: ReportAiIncidentPayload): string {
  return [
    payload.category,
    payload.provider ?? "unknown",
    payload.route,
    payload.errorMessage.slice(0, 200),
  ].join("|");
}

export async function reportAiIncident(payload: ReportAiIncidentPayload): Promise<void> {
  const key = process.env.INTERNAL_API_KEY ?? "";
  if (!key) return;

  const signature = throttleKey(payload);
  const now = Date.now();
  const lastSent = recentReports.get(signature);
  if (lastSent != null && now - lastSent < THROTTLE_MS) return;
  recentReports.set(signature, now);

  try {
    await fetch(`${laravelApiBase()}/internal/notify/vista-issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": key,
      },
      body: JSON.stringify({
        ...payload,
        occurredAt: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.warn("[reportAiIncident] failed:", err);
  }
}

export interface AiIncidentResponse {
  body: { error: string; code?: string };
  status: number;
}

export async function buildAiIncidentResponse(
  err: unknown,
  context: { route: string; roomType?: string; phase?: string },
): Promise<AiIncidentResponse> {
  const classification = classifyAiError(err);
  const message = sanitizeIncidentMessage(errorText(err));

  void reportAiIncident({
    category: classification.category,
    provider: classification.provider,
    route: context.route,
    errorMessage: message,
    roomType: context.roomType,
    phase: context.phase,
  });

  if (classification.category === "provider_auth") {
    return {
      body: { error: PUBLIC_AI_SERVICE_UNAVAILABLE, code: AI_SERVICE_CONFIG_ERROR_CODE },
      status: 503,
    };
  }

  return {
    body: { error: PUBLIC_AI_GENERIC_ERROR },
    status: 500,
  };
}

export async function buildAiIncidentSseEvent(
  err: unknown,
  context: { route: string; roomType?: string; phase?: string },
): Promise<{ phase: "error"; message: string; code?: string }> {
  const incident = await buildAiIncidentResponse(err, context);
  return {
    phase: "error",
    message: incident.body.error,
    ...(incident.body.code ? { code: incident.body.code } : {}),
  };
}

export function reportOverloadedIncident(route: string): void {
  void reportAiIncident({
    category: "unexpected",
    provider: "unknown",
    route,
    errorMessage: "Service temporarily overloaded (529/overloaded_error)",
  });
}

export function buildMissingKeyResponse(
  route: string,
  detail: string,
): AiIncidentResponse {
  void reportAiIncident({
    category: "provider_auth",
    provider: "unknown",
    route,
    errorMessage: detail,
  });
  return {
    body: { error: PUBLIC_AI_SERVICE_UNAVAILABLE, code: AI_SERVICE_CONFIG_ERROR_CODE },
    status: 503,
  };
}
