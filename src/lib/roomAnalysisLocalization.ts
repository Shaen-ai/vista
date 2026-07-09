import type { RoomAnalysis } from "@/lib/interiorDesignPrompts";

export type RoomAnalysisLocale = "hy" | "en" | "ru";

/** Ordered longest-first phrase replacements for English AI output → locale. */
const PHRASE_REPLACEMENTS: Record<Exclude<RoomAnalysisLocale, "en">, Array<[RegExp, string]>> = {
  hy: [
    [/\blarge window on the back wall, left of center\b/gi, "մեծ պատուհան հետևի պատի վրա, կենտրոնից ձախ"],
    [/\blarge window on the back wall\b/gi, "մեծ պատուհան հետևի պատի վրա"],
    [/\bfirst (?:tall )?window on (?:the )?back wall\b/gi, "հետևի պատ, առաջին պատուհան"],
    [/\bsecond (?:tall )?window on (?:the )?back wall\b/gi, "հետևի պատ, երկրորդ պատուհան"],
    [/\bthird (?:tall )?window on (?:the )?back wall\b/gi, "հետևի պատ, երրորդ պատուհան"],
    [/\bleft (?:side )?of (?:the )?back wall\b/gi, "հետևի պատի ձախ կողմ"],
    [/\bback wall,? left(?: of center)?\b/gi, "հետևի պատ, ձախ կողմ"],
    [/\bright (?:side )?of (?:the )?back wall\b/gi, "հետևի պատի աջ կողմ"],
    [/\bback wall,? right(?: of center)?\b/gi, "հետևի պատ, աջ կողմ"],
    [/\bnear (?:the )?left corner of (?:the )?back wall\b/gi, "հետևի պատ, ձախ անկյան մոտ"],
    [/\bnear (?:the )?right corner of (?:the )?back wall\b/gi, "հետևի պատ, աջ անկյան մոտ"],
    [/\bleft of center on (?:the )?back wall\b/gi, "հետևի պատ, կենտրոնից ձախ"],
    [/\bright of center on (?:the )?back wall\b/gi, "հետևի պատ, կենտրոնից աջ"],
    [/\bleft of center\b/gi, "կենտրոնից ձախ"],
    [/\bright of center\b/gi, "կենտրոնից աջ"],
    [/\bon the back wall\b/gi, "հետևի պատի վրա"],
    [/\bfar wall\b/gi, "հեռու պատ"],
    [/\bon the left wall\b/gi, "ձախ պատի վրա"],
    [/\bon the right wall\b/gi, "աջ պատի վրա"],
    [/\bon the front wall\b/gi, "առջևի պատի վրա"],
    [/\bback wall\b/gi, "հետևի պատ"],
    [/\bfront wall\b/gi, "առջևի պատ"],
    [/\bleft wall, first\b/gi, "ձախ պատ, առաջին"],
    [/\bleft wall, second\b/gi, "ձախ պատ, երկրորդ"],
    [/\bleft wall\b/gi, "ձախ պատ"],
    [/\bright wall\b/gi, "աջ պատ"],
    [/\bnear (?:the )?corner\b/gi, "\u0561\u0576\u056F\u0578\u0576\u056B \u0574\u0578\u057F"],
    [/\bleft corner\b/gi, "\u0571\u0561\u056D \u0561\u0576\u056F\u0578\u0576"],
    [/\bright corner\b/gi, "\u0561\u0573 \u0561\u0576\u056F\u0578\u0576"],
    [/\bright corner wall\b/gi, "աջ անկյունային պատ"],
    [/\bleft corner wall\b/gi, "ձախ անկյունային պատ"],
    [/\bfirst section\b/gi, "առաջին հատված"],
    [/\bsecond section\b/gi, "երկրորդ հատված"],
    [/\bthird section\b/gi, "երրորդ հատված"],
    [/\bright of (?:the )?camera\b/gi, "տեսախցիկից աջ"],
    [/\bleft of (?:the )?camera\b/gi, "տեսախցիկից ձախ"],
    [/\brelative to (?:the )?camera\b/gi, "տեսախցիկի նկատմամբ"],
    [/\bcentered\b/gi, "կենտրոնում"],
    [/\bcenter\b/gi, "կենտրոն"],
    [/\bleft side of (?:the )?frame\b/gi, "կադրի ձախ կողմ"],
    [/\bleft side\b/gi, "ձախ կողմ"],
    [/\bright side\b/gi, "աջ կողմ"],
    [/\bmidway\b/gi, "կես ճանապարհին"],
    [/\bbetween\b/gi, "միջև"],
    [/\band\b/gi, "և"],
    [/\bwindow\b/gi, "պատուհան"],
    [/\bdoorway\b/gi, "դռան բաց"],
    [/\bdoor\b/gi, "դուռ"],
    [/\bpassage\b/gi, "անցք"],
    [/\barchway\b/gi, "կամարային անցք"],
    [/\bopening\b/gi, "բաց"],
    [/\bcolumn\b/gi, "սյուն"],
    [/\bpost\b/gi, "հաստատուն"],
    [/\bpier\b/gi, "կամուրջ"],
    [/\bload[- ]bearing\b/gi, "բեռնատար"],
    [/\bfireplace\b/gi, "բուրարար"],
    [/\bstaircase\b/gi, "աստիռներ"],
    [/\bstairwell\b/gi, "աստիռների հոր"],
    [/\bceiling\b/gi, "\u0561\u0580\u0561\u057D\u057F\u0561\u0572"],
    [/\brecessed lights?\b/gi, "թաքնված լույս"],
    [/\bunspecified\b/gi, "նշված չէ"],
    [/\bunknown\b/gi, "անհայտ"],
    [/\bpresent\b/gi, "կա"],
  ],
  ru: [
    [/\bleft (?:side )?of (?:the )?back wall\b/gi, "задняя стена слева"],
    [/\bback wall,? left\b/gi, "задняя стена слева"],
    [/\bright (?:side )?of (?:the )?back wall\b/gi, "задняя стена справа"],
    [/\bback wall,? right\b/gi, "задняя стена справа"],
    [/\bon the back wall\b/gi, "на задней стене"],
    [/\bfar wall\b/gi, "дальняя стена"],
    [/\bon the left wall\b/gi, "на левой стене"],
    [/\bon the right wall\b/gi, "на правой стене"],
    [/\bback wall\b/gi, "задняя стена"],
    [/\bleft wall\b/gi, "левая стена"],
    [/\bright wall\b/gi, "правая стена"],
    [/\bright of (?:the )?camera\b/gi, "справа от камеры"],
    [/\bleft of (?:the )?camera\b/gi, "слева от камеры"],
    [/\bnear (?:the )?corner\b/gi, "у угла"],
    [/\bcenter(?:ed)?\b/gi, "центр"],
    [/\bwindow\b/gi, "окно"],
    [/\bdoor(?:way)?\b/gi, "дверь"],
    [/\bcolumn\b/gi, "колонна"],
    [/\bceiling\b/gi, "потолок"],
    [/\bunspecified\b/gi, "не указано"],
    [/\bunknown\b/gi, "неизвестно"],
  ],
};

export function localizeAnalysisPhrase(text: string, locale: RoomAnalysisLocale): string {
  if (locale === "en" || !text.trim()) return text;
  let out = text;
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS[locale]) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function localizeLines(lines: string[], locale: RoomAnalysisLocale): string[] {
  return lines.map((line) => localizeAnalysisPhrase(line, locale));
}

/** Localize free-text room analysis fields for display/editing in the user's locale. */
export function localizeRoomAnalysisForLocale(
  analysis: RoomAnalysis,
  locale: RoomAnalysisLocale,
): RoomAnalysis {
  if (locale === "en") return analysis;

  return {
    ...analysis,
    window_positions: localizeLines(analysis.window_positions, locale),
    door_positions: localizeLines(analysis.door_positions, locale),
    structural_elements: localizeLines(analysis.structural_elements, locale),
    architectural_features: localizeLines(analysis.architectural_features, locale),
    lighting_sources: localizeLines(analysis.lighting_sources, locale),
    suggestions: localizeLines(analysis.suggestions, locale),
    camera_angle: localizeAnalysisPhrase(analysis.camera_angle, locale),
    current_style: localizeAnalysisPhrase(analysis.current_style, locale),
    staircase_description: analysis.staircase_description
      ? localizeAnalysisPhrase(analysis.staircase_description, locale)
      : null,
    floor_opening_description: analysis.floor_opening_description
      ? localizeAnalysisPhrase(analysis.floor_opening_description, locale)
      : null,
    existing_furniture: analysis.existing_furniture.map((item) => ({
      ...item,
      name: localizeAnalysisPhrase(item.name, locale),
      position: localizeAnalysisPhrase(item.position, locale),
    })),
  };
}
