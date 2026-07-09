import { translate } from "./translate";
import type { VistaLocale } from "./locales";

export type LocalizedPlan = {
  key: string;
  title: string;
  titleRu: string;
  titleHy?: string;
  svg: string | null;
};

const PLAN_KEY_MAP: Record<string, string> = {
  measurement: "technicalPlans.measurement",
  furniture: "technicalPlans.furniture",
  furnitureLayout: "technicalPlans.furniture",
  flooring: "technicalPlans.flooring",
  ceiling: "technicalPlans.ceiling",
  lighting: "technicalPlans.lighting",
  electrical: "technicalPlans.electrical",
  plumbing: "technicalPlans.plumbing",
  gas: "technicalPlans.gas",
  hvac: "technicalPlans.hvac",
};

export function planTitle(plan: LocalizedPlan, locale: VistaLocale): string {
  const msgKey = PLAN_KEY_MAP[plan.key];
  if (msgKey) {
    const localized = translate(locale, msgKey);
    if (localized !== msgKey) return localized;
  }
  if (locale === "ru" && plan.titleRu) return plan.titleRu;
  if (locale === "hy" && plan.titleHy) return plan.titleHy;
  return plan.title;
}
