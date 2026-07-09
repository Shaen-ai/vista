/**
 * Parse the creative-director (Claude) reply into a JSON object.
 * Handles markdown fences, prose wrappers, multiple content blocks, and rejects HTML error pages.
 */

/** Curly / typographic quotes break JSON.parse — normalize before parsing. */
function normalizeJsonLikeQuotes(text: string): string {
  return text
    .replace(/\u201c|\u201d|\u00ab|\u00bb/g, '"')
    .replace(/\u2018|\u2019|\u2032/g, "'");
}

/**
 * Remove trailing commas before } or ] (invalid JSON but common in LLM output).
 * String-aware — does not touch commas inside JSON strings.
 */
function removeTrailingCommasJson(text: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) {
      out += ch;
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escape = true;
        out += ch;
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      if (j < text.length && (text[j] === "}" || text[j] === "]")) {
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function repairJsonCandidate(raw: string): string {
  return removeTrailingCommasJson(normalizeJsonLikeQuotes(raw));
}

function extractBalancedObject(source: string, openBraceIdx: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openBraceIdx; i < source.length; i++) {
    const ch = source[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(openBraceIdx, i + 1);
    }
  }
  return null;
}

function extractMarkdownCodeBodies(text: string): string[] {
  const re = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1]?.trim();
    if (inner) out.push(inner);
  }
  return out;
}

function looksLikeHtmlErrorBody(s: string): boolean {
  const t = s.trim();
  return /^<!DOCTYPE\s+/i.test(t) || /^<html[\s>]/i.test(t);
}

function tryParseJsonObjectFromString(trimmed: string): unknown | undefined {
  const tryOne = (s: string): unknown | undefined => {
    const repaired = repairJsonCandidate(s);
    try {
      return JSON.parse(repaired);
    } catch {
      return undefined;
    }
  };

  if (trimmed.startsWith("{")) {
    const parsed = tryOne(trimmed);
    if (parsed !== undefined) return parsed;
  }
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== "{") continue;
    const slice = extractBalancedObject(trimmed, i);
    if (slice) {
      const parsed = tryOne(slice);
      if (parsed !== undefined) return parsed;
    }
    const truncated = tryRepairTruncatedJsonObject(trimmed.slice(i));
    if (truncated !== undefined) return truncated;
  }
  return undefined;
}

/** Close dangling strings/brackets when Claude hits max_tokens mid-JSON. */
function closeOpenBrackets(text: string): string {
  let s = text.trimEnd();
  let inString = false;
  let escape = false;
  const stack: ("{" | "[")[] = [];

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") stack.push("{");
    else if (ch === "[") stack.push("[");
    else if (ch === "}") {
      if (stack.length > 0 && stack[stack.length - 1] === "{") stack.pop();
    } else if (ch === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === "[") stack.pop();
    }
  }

  if (inString) s += '"';
  s = s.replace(/,\s*("[^"]*")?\s*:?\s*("[^"]*)?\s*$/, "");

  while (stack.length > 0) {
    const open = stack.pop()!;
    s += open === "{" ? "}" : "]";
  }

  return repairJsonCandidate(s);
}

function tryRepairTruncatedJsonObject(source: string): unknown | undefined {
  const tryOne = (s: string): unknown | undefined => {
    const repaired = repairJsonCandidate(s);
    try {
      return JSON.parse(repaired);
    } catch {
      return undefined;
    }
  };

  const closed = closeOpenBrackets(source);
  const parsed = tryOne(closed);
  if (parsed !== undefined) return parsed;

  const braceEnds: number[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "}") braceEnds.push(i);
  }
  const probeFrom = Math.max(0, braceEnds.length - 24);
  for (let j = braceEnds.length - 1; j >= probeFrom; j--) {
    const slice = closeOpenBrackets(source.slice(0, braceEnds[j]! + 1));
    const p = tryOne(slice);
    if (p !== undefined) return p;
  }

  return undefined;
}

/** Concatenate every plain text segment from an Anthropic message (skips thinking/tool blocks). */
export function collectAnthropicTextBlocks(content: Array<{ type: string; text?: string }>): string {
  const parts: string[] = [];
  for (const b of content) {
    if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
      parts.push(b.text);
    }
  }
  return parts.join("\n\n").trim();
}

/** Parse a JSON object from Claude assistant text (fences, repair, truncation). */
export function parseAssistantJsonObject(rawAssistantText: string): unknown {
  const text = rawAssistantText.trim();
  if (!text) {
    throw new Error("Empty assistant response");
  }

  if (looksLikeHtmlErrorBody(text)) {
    throw new Error("Assistant returned HTML instead of JSON (proxy or API error page).");
  }

  const candidates: string[] = [];
  const codeBodies = extractMarkdownCodeBodies(text);
  if (codeBodies.length > 0) {
    candidates.push(...codeBodies);
  }
  candidates.push(text);

  for (const cand of candidates) {
    const trimmed = cand.trim();
    if (!trimmed || looksLikeHtmlErrorBody(trimmed)) continue;

    const parsed = tryParseJsonObjectFromString(trimmed);
    if (parsed !== undefined && typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  throw new Error("No valid JSON object found in assistant response");
}

/** @alias parseAssistantJsonObject — design brief and other Claude JSON payloads */
export const parseDesignBriefJsonFromAssistantText = parseAssistantJsonObject;
