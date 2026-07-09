import type { VistaLocale } from "./locales";
import en from "./messages/en.json";
import hy from "./messages/hy.json";
import ru from "./messages/ru.json";

export type MessageTree = { [key: string]: string | MessageTree };

const MESSAGES: Record<VistaLocale, MessageTree> = { en, hy, ru };

function lookup(tree: MessageTree, key: string): string | undefined {
  const parts = key.split(".");
  let cur: string | MessageTree | undefined = tree;
  for (const part of parts) {
    if (!cur || typeof cur !== "object" || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function translate(
  locale: VistaLocale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const raw = lookup(MESSAGES[locale], key) ?? lookup(MESSAGES.en, key) ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = vars[name];
    return v !== undefined ? String(v) : `{${name}}`;
  });
}

export function getMessages(locale: VistaLocale): MessageTree {
  return MESSAGES[locale];
}
