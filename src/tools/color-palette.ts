import { z } from "zod";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  description: z
    .string()
    .min(1)
    .max(500)
    .describe("Description of the desired palette. E.g. 'sunset over the ocean', 'corporate fintech', 'playful children's brand', '#3B82F6'"),
  count: z
    .number()
    .int()
    .min(2)
    .max(10)
    .default(5)
    .describe("Number of colors to generate (2-10)"),
  format: z
    .enum(["hex", "rgb", "hsl", "all"])
    .default("all")
    .describe("Output color format"),
  includeShades: z
    .boolean()
    .default(false)
    .describe("Include light/dark shades for each color"),
});

type Input = z.infer<typeof inputSchema>;

// ----- Color math -----
interface RGB { r: number; g: number; b: number; }
interface HSL { h: number; s: number; l: number; }

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      case bn: h = ((rn - gn) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const sn = s / 100, ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = ln - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function wcagContrastRatio(hex1: string, hex2: string): number {
  function luminance({ r, g, b }: RGB): number {
    return [r, g, b].reduce((acc, v) => {
      const sn = v / 255;
      return acc + (sn <= 0.03928 ? sn / 12.92 : Math.pow((sn + 0.055) / 1.055, 2.4));
    }, 0) / 3; // simplified
  }
  const l1 = luminance(hexToRgb(hex1));
  const l2 = luminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return parseFloat(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

function wcagGrade(ratio: number): string {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA Large";
  return "Fail";
}

// ----- Palette database -----
// Curated seed palettes keyed by theme keywords
const PALETTES: Record<string, { name: string; seeds: string[]; label: string }> = {
  // Nature
  sunset:     { name: "Sunset", seeds: ["#FF6B35","#F7931E","#FFD23F","#FF4365","#C03546"], label: "Warm & vibrant" },
  ocean:      { name: "Ocean", seeds: ["#0077B6","#00B4D8","#90E0EF","#CAF0F8","#03045E"], label: "Cool & calming" },
  forest:     { name: "Forest", seeds: ["#2D6A4F","#40916C","#52B788","#74C69D","#1B4332"], label: "Natural & earthy" },
  desert:     { name: "Desert", seeds: ["#E9C46A","#F4A261","#E76F51","#264653","#2A9D8F"], label: "Warm & earthy" },
  mountain:   { name: "Mountain", seeds: ["#4A5568","#718096","#A0AEC0","#2D3748","#E2E8F0"], label: "Cool & muted" },
  spring:     { name: "Spring", seeds: ["#FFB3C6","#FF85A1","#A8DADC","#B5EAD7","#FFDDD2"], label: "Soft & fresh" },
  autumn:     { name: "Autumn", seeds: ["#D4502A","#E8871A","#F5C842","#8B4513","#556B2F"], label: "Rich & warm" },
  // Moods
  calm:       { name: "Calm", seeds: ["#A8DADC","#457B9D","#1D3557","#F1FAEE","#E63946"], label: "Peaceful" },
  energetic:  { name: "Energetic", seeds: ["#FF006E","#FB5607","#FFBE0B","#8338EC","#3A86FF"], label: "Bold & vibrant" },
  playful:    { name: "Playful", seeds: ["#FF6B9D","#C44569","#F8B500","#00B16A","#3F51B5"], label: "Fun & bright" },
  luxurious:  { name: "Luxurious", seeds: ["#B8960C","#1A1A2E","#16213E","#0F3460","#E94560"], label: "Rich & dark" },
  minimal:    { name: "Minimal", seeds: ["#FFFFFF","#F5F5F5","#E0E0E0","#9E9E9E","#212121"], label: "Clean & simple" },
  dark:       { name: "Dark Mode", seeds: ["#1A1A2E","#16213E","#0F3460","#E94560","#533483"], label: "Dark & bold" },
  pastel:     { name: "Pastel", seeds: ["#FFD1DC","#FFDFD3","#FFF1C1","#DAFFD9","#C1F0FF"], label: "Soft & light" },
  // Industries
  tech:       { name: "Tech", seeds: ["#0066FF","#00D2FF","#7B2FBE","#1A1A2E","#F0F0F0"], label: "Modern & digital" },
  fintech:    { name: "Fintech", seeds: ["#003087","#0070BA","#00A0DC","#1D1D1D","#F5F5F5"], label: "Trust & stability" },
  healthcare: { name: "Healthcare", seeds: ["#0077C8","#00A651","#FFFFFF","#F2F2F2","#E5F4FB"], label: "Clean & caring" },
  fashion:    { name: "Fashion", seeds: ["#1C1C1C","#FF4081","#FF80AB","#F5F5DC","#C0A882"], label: "Stylish & bold" },
  food:       { name: "Food", seeds: ["#FF4136","#FF851B","#FFDC00","#2ECC40","#3D9970"], label: "Appetizing & warm" },
  wellness:   { name: "Wellness", seeds: ["#8CC084","#5B8E7D","#F2D0A4","#F1A65F","#BC4749"], label: "Natural & balanced" },
  // Colors
  blue:       { name: "Blues", seeds: ["#03045E","#0077B6","#00B4D8","#90E0EF","#CAF0F8"], label: "Monochromatic blue" },
  green:      { name: "Greens", seeds: ["#1B4332","#2D6A4F","#52B788","#95D5B2","#D8F3DC"], label: "Monochromatic green" },
  red:        { name: "Reds", seeds: ["#370617","#6A040F","#D00000","#E85D04","#FAA307"], label: "Warm reds & oranges" },
  purple:     { name: "Purples", seeds: ["#10002B","#3C096C","#7B2FBE","#C77DFF","#E0AAFF"], label: "Monochromatic purple" },
  monochrome: { name: "Monochrome", seeds: ["#000000","#333333","#666666","#999999","#CCCCCC"], label: "Grayscale" },
  corporate:  { name: "Corporate", seeds: ["#003366","#0066CC","#3399FF","#F5F5F5","#333333"], label: "Professional" },
  warm:       { name: "Warm", seeds: ["#FF6B35","#F7931E","#FFD23F","#FF4365","#FF8C42"], label: "Warm tones" },
  cool:       { name: "Cool", seeds: ["#0077B6","#00B4D8","#7B2FBE","#3F51B5","#009688"], label: "Cool tones" },
  organic:    { name: "Organic", seeds: ["#606C38","#283618","#FEFAE0","#DDA15E","#BC6C25"], label: "Natural & earthy" },
  techy:      { name: "Techy", seeds: ["#00FF41","#0D0208","#003B00","#008F11","#00FF41"], label: "Matrix-inspired" },
  retro:      { name: "Retro", seeds: ["#FF6B6B","#FFE66D","#4ECDC4","#1A535C","#F7FFF7"], label: "Vintage & bold" },
  neon:       { name: "Neon", seeds: ["#FF00FF","#00FFFF","#FFFF00","#FF0080","#00FF80"], label: "Bright & electric" },
  earth:      { name: "Earth", seeds: ["#8B4513","#A0522D","#CD853F","#DEB887","#F5DEB3"], label: "Earthy browns" },
  nordic:     { name: "Nordic", seeds: ["#2B2D42","#8D99AE","#EDF2F4","#EF233C","#D90429"], label: "Scandinavian" },
};

function findBestPalette(description: string): typeof PALETTES[string] {
  const desc = description.toLowerCase();

  // Check for hex color in input — build palette around it
  const hexMatch = desc.match(/#([0-9a-f]{6})/i);
  if (hexMatch) {
    const base = "#" + hexMatch[1].toUpperCase();
    const rgb = hexToRgb(base);
    const hsl = rgbToHsl(rgb);
    // Generate analogous + complementary
    const seeds = [
      base,
      rgbToHex(hslToRgb((hsl.h + 30) % 360, hsl.s, hsl.l)),
      rgbToHex(hslToRgb((hsl.h + 60) % 360, hsl.s, Math.max(hsl.l - 15, 10))),
      rgbToHex(hslToRgb((hsl.h + 180) % 360, hsl.s, hsl.l)),
      rgbToHex(hslToRgb((hsl.h + 210) % 360, Math.max(hsl.s - 20, 10), Math.min(hsl.l + 20, 90))),
    ];
    return { name: "Custom", seeds, label: `Built around ${base}` };
  }

  // Score each palette by keyword matches
  let bestKey = "calm";
  let bestScore = 0;

  for (const key of Object.keys(PALETTES)) {
    let score = desc.includes(key) ? 10 : 0;
    // Also check label words
    const labelWords = PALETTES[key].label.toLowerCase().split(/\W+/);
    for (const word of labelWords) {
      if (word.length > 3 && desc.includes(word)) score += 3;
    }
    if (score > bestScore) { bestScore = score; bestKey = key; }
  }

  // Fallback keyword mapping
  const keywords: Record<string, string> = {
    sunrise: "sunset", beach: "ocean", sea: "ocean", water: "ocean",
    nature: "forest", tree: "forest", trees: "forest", jungle: "forest",
    sand: "desert", arid: "desert", dune: "desert",
    snow: "mountain", alpine: "mountain", peak: "mountain",
    flower: "spring", floral: "spring", blossom: "spring",
    fall: "autumn", harvest: "autumn", pumpkin: "autumn",
    relax: "calm", peaceful: "calm", soothing: "calm", meditation: "calm",
    bold: "energetic", vibrant: "energetic", dynamic: "energetic", sport: "energetic",
    kids: "playful", children: "playful", fun: "playful", candy: "playful",
    luxury: "luxurious", premium: "luxurious", gold: "luxurious", elegant: "luxurious",
    clean: "minimal", simple: "minimal", white: "minimal", light: "minimal",
    night: "dark", noir: "dark", moody: "dark",
    soft: "pastel", gentle: "pastel", baby: "pastel",
    startup: "tech", saas: "tech", software: "tech", digital: "tech", ai: "tech",
    finance: "fintech", bank: "fintech", payment: "fintech", crypto: "fintech",
    medical: "healthcare", hospital: "healthcare", clinic: "healthcare", health: "healthcare",
    clothing: "fashion", apparel: "fashion", beauty: "fashion", makeup: "fashion",
    restaurant: "food", cafe: "food", cooking: "food", recipe: "food",
    yoga: "wellness", spa: "wellness", fitness: "wellness",
    professional: "corporate", business: "corporate", enterprise: "corporate",
    natural: "organic", sustainable: "organic", eco: "organic", botanical: "organic",
    matrix: "techy", hacker: "techy", terminal: "techy",
    vintage: "retro", "80s": "retro", "90s": "retro",
    electric: "neon", rave: "neon", cyber: "neon",
    scandi: "nordic", minimalist: "nordic",
  };

  if (bestScore === 0) {
    for (const [kw, paletteKey] of Object.entries(keywords)) {
      if (desc.includes(kw)) return PALETTES[paletteKey];
    }
  }

  return PALETTES[bestKey];
}

function generateShades(hex: string): { light: string; dark: string } {
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb);
  return {
    light: rgbToHex(hslToRgb(hsl.h, hsl.s, Math.min(hsl.l + 25, 95))),
    dark: rgbToHex(hslToRgb(hsl.h, hsl.s, Math.max(hsl.l - 25, 5))),
  };
}

function formatColor(hex: string, format: string) {
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb);
  const contrast = wcagContrastRatio(hex, "#FFFFFF");
  const contrastDark = wcagContrastRatio(hex, "#000000");

  const base = {
    hex,
    wcag: {
      contrastOnWhite: contrast,
      contrastOnBlack: contrastDark,
      gradeOnWhite: wcagGrade(contrast),
      gradeOnBlack: wcagGrade(contrastDark),
    },
  };

  if (format === "hex") return base;
  if (format === "rgb") return { ...base, rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`, rgbValues: rgb };
  if (format === "hsl") return { ...base, hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`, hslValues: hsl };
  return {
    ...base,
    rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    rgbValues: rgb,
    hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
    hslValues: hsl,
  };
}

// ----- Handler -----
async function handler(input: Input) {
  const { description, count, format, includeShades } = input;

  const palette = findBestPalette(description);

  // Select `count` colors from seeds (cycle if needed)
  const selected: string[] = [];
  for (let i = 0; i < count; i++) {
    selected.push(palette.seeds[i % palette.seeds.length]);
  }

  const colors = selected.map((hex, i) => ({
    index: i + 1,
    name: `Color ${i + 1}`,
    ...formatColor(hex, format),
    ...(includeShades && { shades: generateShades(hex) }),
  }));

  // CSS custom properties
  const cssVars = selected.map((hex, i) => `  --color-${i + 1}: ${hex};`).join("\n");

  return {
    paletteName: palette.name,
    paletteLabel: palette.label,
    colors,
    css: `:root {\n${cssVars}\n}`,
    swatches: selected.join(", "),
  };
}

// ----- Register -----
const colorPaletteTool: ToolDefinition<Input> = {
  name: "color-palette",
  description:
    "Generate a color palette from a description or seed color. Supports moods (calm, energetic, luxurious), industries (fintech, healthcare, fashion), nature themes (sunset, ocean, forest), and hex color seeds. Returns hex, RGB, HSL values with WCAG accessibility scores and CSS variables.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["color", "palette", "design", "branding", "css", "accessibility"],
    pricing: "$0.0005 per call",
    exampleInput: {
      description: "calm ocean fintech brand",
      count: 5,
      format: "all",
      includeShades: false,
    },
  },
};

registerTool(colorPaletteTool);

export default colorPaletteTool;
