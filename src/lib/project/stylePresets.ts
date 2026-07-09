/**
 * Interior design style presets for the Full Project generator.
 *
 * Each preset provides default material and color guidance that seeds
 * the Master Design Concept prompt, ensuring Claude produces
 * style-appropriate results even with minimal user input.
 */

import type { MaterialPalette, NcsColor } from "./types";

export interface StylePreset {
  id: string;
  label: string;
  description: string;
  keywords: string;
  defaultPalette: {
    primary: NcsColor;
    secondary: NcsColor;
    accent: NcsColor;
    neutral: NcsColor;
  };
  defaultMaterials: MaterialPalette;
  ceilingStyle: string;
  lightingStyle: string;
  textileNotes: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "modern-neutral",
    label: "Modern Neutral",
    description: "Clean lines, warm neutrals, understated luxury with natural materials",
    keywords: "warm beige, clean lines, natural materials, hidden storage, integrated lighting, minimal ornament, soft textures, layered neutrals",
    defaultPalette: {
      primary: { hex: "#D6CBBC", ncs: "NCS-S-1505-Y50R", name: "Light Beige" },
      secondary: { hex: "#B0A597", ncs: "NCS-S-3005-Y50R", name: "Taupe" },
      accent: { hex: "#8E7554", ncs: "NCS-S-4020-Y30R", name: "Caramel" },
      neutral: { hex: "#F0EDE8", ncs: "NCS-S-0500-N", name: "Pure White" },
    },
    defaultMaterials: {
      woodType: "Light oak",
      metalFinish: "Brushed brass",
      stoneType: "Light marble (Calacatta or Bianco)",
      textilePrimary: "Linen in natural sand tones",
    },
    ceilingStyle: "Flat gypsum ceiling with a perimeter tray step; one continuous warm-white LED cove runs parallel to all four walls in a clean unbroken rectangle, plus a symmetric grid of evenly-spaced flush recessed downlights aligned to the walls",
    lightingStyle: "Symmetric grid of flush recessed downlights aligned to the walls, continuous concealed perimeter LED cove, one glass pendant centered over the main furniture anchor, matching brass wall sconces in symmetric pairs — all warm 2700-3000K",
    textileNotes: "Bouclé and velvet upholstery, linen curtains floor-to-ceiling, textured wool area rugs",
  },
  {
    id: "japandi",
    label: "Japandi",
    description: "Japanese wabi-sabi meets Scandinavian minimalism — serene, natural, craft-focused",
    keywords: "wabi-sabi, Scandinavian simplicity, natural materials, muted earth tones, handcrafted ceramics, negative space, organic shapes",
    defaultPalette: {
      primary: { hex: "#E3DACB", ncs: "NCS-S-1005-Y20R", name: "Vanilla Cream" },
      secondary: { hex: "#C8BDB0", ncs: "NCS-S-2005-Y50R", name: "Medium Beige" },
      accent: { hex: "#5D8254", ncs: "NCS-S-4030-G10Y", name: "Olive Green" },
      neutral: { hex: "#F5F2EF", ncs: "NCS-S-0300-N", name: "Off White" },
    },
    defaultMaterials: {
      woodType: "Natural ash or light birch",
      metalFinish: "Matte black iron",
      stoneType: "Natural grey stone or terrazzo",
      textilePrimary: "Undyed cotton and linen",
    },
    ceilingStyle: "Flat white ceiling with evenly-spaced parallel wooden beams running in one direction; any recessed spots sit in a tidy symmetric grid aligned to the walls",
    lightingStyle: "One rice-paper pendant centered over the main furniture anchor, washi wall sconces in matching symmetric pairs, a minimal symmetric grid of flush recessed spots aligned to the walls, warm 2700K, natural daylight emphasis",
    textileNotes: "Undyed linen, cotton slub, woven jute rugs, handmade ceramic accessories",
  },
  {
    id: "dark-luxury",
    label: "Dark Luxury",
    description: "Rich dark tones, velvet, marble, and gold — dramatic and opulent",
    keywords: "dark walls, velvet, marble, gold accents, moody lighting, jewel tones, dramatic contrast, luxurious textures",
    defaultPalette: {
      primary: { hex: "#3C4042", ncs: "NCS-S-7502-B", name: "Anthracite" },
      secondary: { hex: "#5B4833", ncs: "NCS-S-6020-Y30R", name: "Dark Walnut" },
      accent: { hex: "#CCBA7A", ncs: "NCS-S-2030-Y10R", name: "Mustard Gold" },
      neutral: { hex: "#E2DFDC", ncs: "NCS-S-1000-N", name: "Pearl" },
    },
    defaultMaterials: {
      woodType: "Dark walnut or smoked oak",
      metalFinish: "Polished gold or antique brass",
      stoneType: "Dark Emperador marble or Nero Marquina",
      textilePrimary: "Velvet in deep jewel tones",
    },
    ceilingStyle: "Dark painted ceiling with a symmetric grid of coffered panels, gold trim aligned to the panel grid, and a concealed warm LED cove running parallel to the walls",
    lightingStyle: "One statement chandelier centered over the room's primary anchor, gold wall sconces in symmetric pairs at equal height, concealed LED strips, a symmetric grid of dimmable warm recessed spots aligned to the walls — warm 2700K",
    textileNotes: "Velvet sofas, silk cushions, deep-pile wool rugs, heavy blackout drapes with metallic sheers",
  },
  {
    id: "scandinavian",
    label: "Scandinavian",
    description: "Light, airy, functional — white walls, light wood, cozy textiles",
    keywords: "light wood, white walls, hygge warmth, functional furniture, natural textiles, soft curves, airy open layout",
    defaultPalette: {
      primary: { hex: "#F0EDE8", ncs: "NCS-S-0500-N", name: "Pure White" },
      secondary: { hex: "#E6E0D0", ncs: "NCS-S-1002-Y", name: "Light Sand" },
      accent: { hex: "#8DBCAE", ncs: "NCS-S-2020-B90G", name: "Teal Mist" },
      neutral: { hex: "#D4D7DA", ncs: "NCS-S-1502-B", name: "Light Gray" },
    },
    defaultMaterials: {
      woodType: "Light pine or white-washed oak",
      metalFinish: "Matte white or light brushed steel",
      stoneType: "White Carrara marble",
      textilePrimary: "Chunky knit wool and sheepskin",
    },
    ceilingStyle: "Flat white ceiling; one sculptural flush-mount or pendant centered over the main furniture anchor, any recessed spots in a tidy symmetric grid aligned to the walls",
    lightingStyle: "One sculptural pendant centered over the main furniture anchor, floor lamps with linen shades flanking the seating symmetrically, candles, warm 2700K, maximized natural light",
    textileNotes: "Sheepskin throws, chunky knit blankets, cotton-linen blend curtains, wool flatweave rugs",
  },
  {
    id: "mid-century",
    label: "Mid-Century Modern",
    description: "Retro-inspired with organic curves, tapered legs, and warm wood tones",
    keywords: "tapered legs, organic curves, walnut wood, teal and mustard accents, retro optimism, atomic-era design",
    defaultPalette: {
      primary: { hex: "#E4D4A8", ncs: "NCS-S-1020-Y10R", name: "Pale Gold" },
      secondary: { hex: "#8E7554", ncs: "NCS-S-4020-Y30R", name: "Caramel" },
      accent: { hex: "#5D8AAE", ncs: "NCS-S-3030-B", name: "Ocean Blue" },
      neutral: { hex: "#EFECE3", ncs: "NCS-S-0502-Y", name: "Warm White" },
    },
    defaultMaterials: {
      woodType: "American walnut",
      metalFinish: "Polished brass or copper",
      stoneType: "Terrazzo or travertine",
      textilePrimary: "Tweed and bouclé in warm tones",
    },
    ceilingStyle: "Flat white ceiling with one sputnik or globe pendant chandelier centered over the room's primary anchor, hung plumb and bilaterally symmetric",
    lightingStyle: "One globe/sputnik pendant centered over the main furniture anchor, an arc floor lamp arcing symmetrically over the seating, tripod table lamps in matching pairs, warm-tone 2700K bulbs",
    textileNotes: "Bouclé armchairs, tweed cushions, flat-weave geometric rugs, linen drapes",
  },
  {
    id: "contemporary",
    label: "Contemporary Elegant",
    description: "Current trends, mixed materials, statement lighting, refined and sophisticated",
    keywords: "current trends, mixed materials, statement lighting, neutral base with curated accents, architectural details",
    defaultPalette: {
      primary: { hex: "#C8C5C2", ncs: "NCS-S-2000-N", name: "Ash" },
      secondary: { hex: "#AA9A88", ncs: "NCS-S-3010-Y50R", name: "Mocha Cream" },
      accent: { hex: "#343844", ncs: "NCS-S-7010-R90B", name: "Dark Navy" },
      neutral: { hex: "#F0EDE8", ncs: "NCS-S-0500-N", name: "Pure White" },
    },
    defaultMaterials: {
      woodType: "Grey-washed oak or light walnut",
      metalFinish: "Brushed nickel and matte black mix",
      stoneType: "Statuario marble or polished concrete",
      textilePrimary: "Performance fabrics and soft leather",
    },
    ceilingStyle: "Clean gypsum ceiling with linear LED profiles in concealed slots running parallel to the walls in a symmetric rectangle, plus a symmetric grid of flush recessed downlights aligned to the walls",
    lightingStyle: "Continuous linear LED profiles parallel to the walls, architectural cove lighting, a symmetric grid of flush recessed downlights, one sculptural pendant centered over the main anchor, smart dimmers — warm 2700-3000K",
    textileNotes: "Leather accent chairs, performance-fabric sofas, silk-blend pillows, custom drapery panels",
  },
  {
    id: "classic",
    label: "Classic / Traditional",
    description: "Rich wood tones, crown molding, symmetry, warm and timeless elegance",
    keywords: "rich wood tones, crown molding, classic patterns, symmetry, upholstered seating, warm lighting, wainscoting, ornamental details",
    defaultPalette: {
      primary: { hex: "#E2D8CC", ncs: "NCS-S-1005-Y50R", name: "Warm Cream" },
      secondary: { hex: "#C6B89E", ncs: "NCS-S-2010-Y30R", name: "Warm Sand" },
      accent: { hex: "#715C42", ncs: "NCS-S-5020-Y30R", name: "Walnut" },
      neutral: { hex: "#EDE6D6", ncs: "NCS-S-0804-Y30R", name: "Antique White" },
    },
    defaultMaterials: {
      woodType: "Cherry or mahogany",
      metalFinish: "Antique bronze or oil-rubbed brass",
      stoneType: "Crema Marfil marble",
      textilePrimary: "Damask and jacquard fabrics",
    },
    ceilingStyle: "Symmetric crown molding around the full perimeter, one centered ceiling medallion under the chandelier, evenly-spaced coffered panels in formal rooms",
    lightingStyle: "One crystal chandelier centered over the room (or dining-table center) on the ceiling medallion, candelabra sconces in symmetric pairs at equal height, silk-shaded table lamps in matching pairs, picture lights centered above the art — warm 2700K",
    textileNotes: "Damask upholstery, tasseled curtains, Persian-style rugs, silk throw pillows",
  },
  {
    id: "industrial",
    label: "Industrial Loft",
    description: "Exposed brick, metal pipes, raw concrete, Edison bulbs, reclaimed wood",
    keywords: "exposed brick, metal pipes, raw concrete, Edison bulbs, reclaimed wood, loft aesthetic, open plan",
    defaultPalette: {
      primary: { hex: "#928F8C", ncs: "NCS-S-4000-N", name: "Concrete" },
      secondary: { hex: "#8F8070", ncs: "NCS-S-4010-Y50R", name: "Dark Taupe" },
      accent: { hex: "#A0785C", ncs: "NCS-S-3030-Y60R", name: "Terracotta" },
      neutral: { hex: "#E2DFDC", ncs: "NCS-S-1000-N", name: "Pearl" },
    },
    defaultMaterials: {
      woodType: "Reclaimed or distressed oak",
      metalFinish: "Raw steel and matte black iron",
      stoneType: "Polished concrete or slate",
      textilePrimary: "Canvas, aged leather, and denim",
    },
    ceilingStyle: "Raw concrete finish with exposed ducts and pipes running in straight parallel runs; cage pendant lights hung in an evenly-spaced straight row at equal height",
    lightingStyle: "Edison-bulb cage pendants in an evenly-spaced straight row over the main anchor, black track lights on one straight track aligned to the wall with evenly-spaced heads, industrial task lamps in matching pairs — warm 2700K",
    textileNotes: "Aged leather sofas, canvas cushions, woven jute rugs, simple linen curtains or none",
  },
];

export function getStylePreset(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((s) => s.id === id);
}

export function getStylePresetOrDefault(id: string): StylePreset {
  return getStylePreset(id) ?? STYLE_PRESETS[0];
}
