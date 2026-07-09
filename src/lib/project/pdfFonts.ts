/**
 * Register Unicode fonts for react-pdf (Armenian / Cyrillic body text).
 */

import { Font } from "@react-pdf/renderer";

let registered = false;

const NOTO_REGULAR =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf";
const NOTO_ITALIC =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Italic.ttf";
const NOTO_BOLD =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Bold.ttf";
const NOTO_BOLD_ITALIC =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-BoldItalic.ttf";
const HY_REGULAR =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansArmenian/NotoSansArmenian-Regular.ttf";
const HY_BOLD =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansArmenian/NotoSansArmenian-Bold.ttf";

export async function ensurePdfFontsRegistered(): Promise<void> {
  if (registered) return;
  Font.register({
    family: "NotoSans",
    fonts: [
      { src: NOTO_REGULAR, fontWeight: 400 },
      { src: NOTO_ITALIC, fontWeight: 400, fontStyle: "italic" },
      { src: NOTO_BOLD, fontWeight: 700 },
      { src: NOTO_BOLD_ITALIC, fontWeight: 700, fontStyle: "italic" },
      // Armenian has no italic cuts — reuse regular/bold so react-pdf never fails lookup.
      { src: HY_REGULAR, fontWeight: 400 },
      { src: HY_REGULAR, fontWeight: 400, fontStyle: "italic" },
      { src: HY_BOLD, fontWeight: 700 },
      { src: HY_BOLD, fontWeight: 700, fontStyle: "italic" },
    ],
  });
  registered = true;
}

export const PDF_FONT_FAMILY = "NotoSans";
