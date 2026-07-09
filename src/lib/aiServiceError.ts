import { AI_SERVICE_CONFIG_ERROR_CODE } from "@/lib/tunzoneAi";

export class AiServiceUnavailableError extends Error {
  readonly code = AI_SERVICE_CONFIG_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = "AiServiceUnavailableError";
  }
}

export function isAiServiceUnavailableError(err: unknown): err is AiServiceUnavailableError {
  return err instanceof AiServiceUnavailableError;
}

export function isAiServiceUnavailableCode(code: unknown): boolean {
  return code === AI_SERVICE_CONFIG_ERROR_CODE;
}

export function throwIfAiServiceUnavailable(json: {
  error?: string;
  code?: string;
}): void {
  if (isAiServiceUnavailableCode(json.code)) {
    throw new AiServiceUnavailableError(
      json.error?.trim() || "Our design service needs a quick fix. Please contact us.",
    );
  }
}

/** Returns true when the error was handled (caller should skip inline error UI). */
export function handleAiServiceUnavailableClientError(
  err: unknown,
  onServiceUnavailable: () => void,
): boolean {
  if (isAiServiceUnavailableError(err)) {
    onServiceUnavailable();
    return true;
  }
  return false;
}
