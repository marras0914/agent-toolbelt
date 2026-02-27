import { z } from "zod";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Company or brand name"),
  industry: z
    .string()
    .optional()
    .describe("Industry or sector (e.g., 'fintech', 'healthcare', 'fashion', 'food & beverage', 'education')"),
  vibe: z
    .array(z.string())
    .optional()
    .describe("Aesthetic keywords describing the desired feel. Examples: 'modern', 'playful', 'luxurious', 'minimal', 'bold', 'organic', 'techy', 'warm', 'corporate', 'rebellious'"),
  targetAudience: z
    .string()
    .optional()
    .describe("Who the brand is for (e.g., 'enterprise B2B', 'gen-z consumers', 'health-conscious parents')"),
  format: z
    .enum(["full", "tokens", "css", "tailwind"])
    .default("full")
    .describe("Output format: 'full' (everything), 'tokens' (JSON design tokens), 'css' (CSS custom properties), 'tailwind' (Tailwind config)"),
});

type Input = z.infer<typeof inputSchema>;

// ----- Color Science Utilities -----

interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

interface RGB {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

function hslToRgb(hsl: HSL): RGB {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function rgbToHex(rgb: RGB): string {
  return `#${[rgb.r, rgb.g, rgb.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function hslToHex(hsl: HSL): string {
  return rgbToHex(hslToRgb(hsl));
}

function hslToString(hsl: HSL): string {
  return `hsl(${Math.round(hsl.h)}, ${Math.round(hsl.s)}%, ${Math.round(hsl.l)}%)`;
}

// WCAG 2.1 relative luminance
function relativeLuminance(rgb: RGB): number {
  const [rs, gs, bs] = [rgb.r, rgb.g, rgb.b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(color1: HSL, color2: HSL): number {
  const l1 = relativeLuminance(hslToRgb(color1));
  const l2 = relativeLuminance(hslToRgb(color2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function wcagRating(ratio: number): string {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA Large";
  return "Fail";
}

// ----- Design Intelligence -----

// Industry → base hue associations (based on color psychology research)
const INDUSTRY_HUES: Record<string, number[]> = {
  // Blues: trust, technology, finance
  fintech: [210, 220, 230],
  finance: [210, 215, 225],
  banking: [210, 220, 230],
  tech: [200, 220, 260],
  technology: [200, 220, 260],
  saas: [220, 240, 260],
  software: [210, 230, 250],
  ai: [250, 260, 270],

  // Greens: health, nature, growth
  healthcare: [140, 160, 170],
  health: [140, 150, 165],
  wellness: [150, 160, 140],
  organic: [100, 120, 140],
  sustainability: [130, 150, 100],
  agriculture: [90, 110, 130],

  // Warm: food, energy, creativity
  food: [20, 30, 40],
  restaurant: [15, 25, 35],
  "food & beverage": [20, 30, 350],
  energy: [40, 50, 30],
  creative: [280, 300, 320],

  // Purple: luxury, education, creativity
  luxury: [270, 280, 310],
  fashion: [330, 340, 280],
  beauty: [320, 330, 340],
  education: [230, 250, 270],

  // Red/Orange: entertainment, sports, urgency
  entertainment: [350, 10, 20],
  gaming: [0, 280, 260],
  sports: [0, 10, 350],
  fitness: [350, 0, 140],

  // Neutral: professional, legal, consulting
  legal: [210, 215, 0],
  consulting: [210, 220, 200],
  corporate: [210, 215, 220],
  real_estate: [200, 210, 30],
};

// Vibe → color adjustments
const VIBE_MODIFIERS: Record<string, { satAdj: number; lightAdj: number; hueShift: number }> = {
  modern: { satAdj: 10, lightAdj: 0, hueShift: 0 },
  playful: { satAdj: 20, lightAdj: 5, hueShift: 10 },
  luxurious: { satAdj: -10, lightAdj: -10, hueShift: 0 },
  luxury: { satAdj: -10, lightAdj: -10, hueShift: 0 },
  minimal: { satAdj: -20, lightAdj: 10, hueShift: 0 },
  minimalist: { satAdj: -20, lightAdj: 10, hueShift: 0 },
  bold: { satAdj: 25, lightAdj: -5, hueShift: 0 },
  organic: { satAdj: -5, lightAdj: 5, hueShift: -20 },
  natural: { satAdj: -10, lightAdj: 5, hueShift: -15 },
  techy: { satAdj: 15, lightAdj: -5, hueShift: 20 },
  warm: { satAdj: 5, lightAdj: 5, hueShift: -30 },
  cool: { satAdj: 5, lightAdj: 0, hueShift: 30 },
  corporate: { satAdj: -15, lightAdj: 0, hueShift: 0 },
  rebellious: { satAdj: 20, lightAdj: -10, hueShift: 40 },
  edgy: { satAdj: 15, lightAdj: -15, hueShift: 30 },
  elegant: { satAdj: -5, lightAdj: -5, hueShift: 0 },
  fun: { satAdj: 25, lightAdj: 10, hueShift: 15 },
  serious: { satAdj: -15, lightAdj: -5, hueShift: 0 },
  friendly: { satAdj: 10, lightAdj: 10, hueShift: -10 },
  premium: { satAdj: -10, lightAdj: -10, hueShift: 5 },
  youthful: { satAdj: 20, lightAdj: 10, hueShift: -20 },
  clean: { satAdj: -10, lightAdj: 15, hueShift: 0 },
};

// Curated font pairings (display + body)
const FONT_PAIRINGS = [
  { display: "Playfair Display", body: "Source Sans 3", vibe: ["luxurious", "elegant", "premium", "editorial"] },
  { display: "Space Grotesk", body: "Inter", vibe: ["modern", "techy", "clean", "saas"] },
  { display: "Sora", body: "DM Sans", vibe: ["modern", "friendly", "clean"] },
  { display: "Clash Display", body: "Satoshi", vibe: ["bold", "modern", "edgy"] },
  { display: "Cabinet Grotesk", body: "General Sans", vibe: ["minimal", "modern", "corporate"] },
  { display: "Fraunces", body: "Commissioner", vibe: ["organic", "warm", "elegant", "natural"] },
  { display: "Plus Jakarta Sans", body: "Nunito Sans", vibe: ["friendly", "youthful", "playful"] },
  { display: "Instrument Serif", body: "Instrument Sans", vibe: ["luxurious", "editorial", "premium"] },
  { display: "Bricolage Grotesque", body: "Onest", vibe: ["fun", "playful", "rebellious"] },
  { display: "Outfit", body: "Work Sans", vibe: ["corporate", "serious", "clean"] },
  { display: "Unbounded", body: "Rubik", vibe: ["bold", "techy", "gaming", "fun"] },
  { display: "Cormorant Garamond", body: "Lato", vibe: ["luxurious", "elegant", "fashion"] },
  { display: "Manrope", body: "Karla", vibe: ["minimal", "modern", "tech"] },
  { display: "Archivo Black", body: "Archivo", vibe: ["bold", "edgy", "sports", "rebellious"] },
];

// ----- Generation Logic -----

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function seededRandom(seed: string): () => number {
  // Simple hash-based PRNG for deterministic results per brand name
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return () => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    return (hash % 1000) / 1000;
  };
}

function generatePalette(
  industry: string,
  vibes: string[],
  brandName: string
): {
  primary: HSL;
  secondary: HSL;
  accent: HSL;
  background: HSL;
  surface: HSL;
  text: HSL;
  textMuted: HSL;
  success: HSL;
  warning: HSL;
  error: HSL;
} {
  const rng = seededRandom(brandName);

  // Pick base hue from industry
  const industryKey = industry.toLowerCase().replace(/[^a-z& ]/g, "").replace(/ /g, "_");
  const hues = INDUSTRY_HUES[industryKey] || INDUSTRY_HUES.tech || [210, 220, 230];
  const baseHue = hues[Math.floor(rng() * hues.length)];

  // Apply vibe modifiers
  let satAdj = 0;
  let lightAdj = 0;
  let hueShift = 0;
  for (const v of vibes) {
    const mod = VIBE_MODIFIERS[v.toLowerCase()];
    if (mod) {
      satAdj += mod.satAdj;
      lightAdj += mod.lightAdj;
      hueShift += mod.hueShift;
    }
  }

  const primaryHue = (baseHue + hueShift + 360) % 360;
  const primarySat = clamp(65 + satAdj, 20, 95);
  const primaryLight = clamp(50 + lightAdj, 25, 65);

  const primary: HSL = { h: primaryHue, s: primarySat, l: primaryLight };

  // Secondary: analogous (30° shift)
  const secondary: HSL = {
    h: (primaryHue + 30 + rng() * 10) % 360,
    s: clamp(primarySat - 10, 20, 85),
    l: clamp(primaryLight + 5, 30, 65),
  };

  // Accent: complementary or triadic
  const accentShift = rng() > 0.5 ? 180 : 120;
  const accent: HSL = {
    h: (primaryHue + accentShift + rng() * 20) % 360,
    s: clamp(primarySat + 10, 40, 95),
    l: clamp(primaryLight, 40, 60),
  };

  // Neutral scale
  const background: HSL = { h: primaryHue, s: 5, l: 98 };
  const surface: HSL = { h: primaryHue, s: 8, l: 94 };
  const text: HSL = { h: primaryHue, s: 15, l: 12 };
  const textMuted: HSL = { h: primaryHue, s: 10, l: 45 };

  // Semantic
  const success: HSL = { h: 145, s: 60, l: 42 };
  const warning: HSL = { h: 38, s: 92, l: 50 };
  const error: HSL = { h: 0, s: 72, l: 51 };

  return { primary, secondary, accent, background, surface, text, textMuted, success, warning, error };
}

function selectFontPairing(vibes: string[], industry: string, brandName: string): typeof FONT_PAIRINGS[0] {
  const rng = seededRandom(brandName);
  const allTerms = [...vibes.map((v) => v.toLowerCase()), industry.toLowerCase()];

  // Score each pairing
  let bestPairing = FONT_PAIRINGS[0];
  let bestScore = -1;

  for (const pairing of FONT_PAIRINGS) {
    let score = 0;
    for (const term of allTerms) {
      if (pairing.vibe.includes(term)) score += 2;
      // Partial match
      for (const v of pairing.vibe) {
        if (term.includes(v) || v.includes(term)) score += 1;
      }
    }
    // Add slight randomness to break ties based on brand name
    score += rng() * 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestPairing = pairing;
    }
  }

  return bestPairing;
}

// ----- Output Formatters -----

function colorToAll(name: string, hsl: HSL) {
  const rgb = hslToRgb(hsl);
  return {
    name,
    hex: hslToHex(hsl),
    hsl: hslToString(hsl),
    rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    values: { h: Math.round(hsl.h), s: Math.round(hsl.s), l: Math.round(hsl.l) },
  };
}

function generateDesignTokens(palette: ReturnType<typeof generatePalette>, fonts: typeof FONT_PAIRINGS[0]) {
  return {
    color: {
      primary: hslToHex(palette.primary),
      secondary: hslToHex(palette.secondary),
      accent: hslToHex(palette.accent),
      background: hslToHex(palette.background),
      surface: hslToHex(palette.surface),
      text: hslToHex(palette.text),
      "text-muted": hslToHex(palette.textMuted),
      success: hslToHex(palette.success),
      warning: hslToHex(palette.warning),
      error: hslToHex(palette.error),
    },
    typography: {
      "font-display": fonts.display,
      "font-body": fonts.body,
      "font-size-xs": "0.75rem",
      "font-size-sm": "0.875rem",
      "font-size-base": "1rem",
      "font-size-lg": "1.125rem",
      "font-size-xl": "1.25rem",
      "font-size-2xl": "1.5rem",
      "font-size-3xl": "1.875rem",
      "font-size-4xl": "2.25rem",
      "font-size-5xl": "3rem",
      "line-height-tight": "1.25",
      "line-height-base": "1.5",
      "line-height-relaxed": "1.75",
      "font-weight-normal": "400",
      "font-weight-medium": "500",
      "font-weight-semibold": "600",
      "font-weight-bold": "700",
    },
    spacing: {
      "space-1": "0.25rem",
      "space-2": "0.5rem",
      "space-3": "0.75rem",
      "space-4": "1rem",
      "space-6": "1.5rem",
      "space-8": "2rem",
      "space-12": "3rem",
      "space-16": "4rem",
      "space-24": "6rem",
    },
    radius: {
      sm: "0.25rem",
      md: "0.5rem",
      lg: "0.75rem",
      xl: "1rem",
      "2xl": "1.5rem",
      full: "9999px",
    },
    shadow: {
      sm: "0 1px 2px rgba(0,0,0,0.05)",
      md: "0 4px 6px rgba(0,0,0,0.07)",
      lg: "0 10px 15px rgba(0,0,0,0.1)",
      xl: "0 20px 25px rgba(0,0,0,0.1)",
    },
  };
}

function generateCSS(palette: ReturnType<typeof generatePalette>, fonts: typeof FONT_PAIRINGS[0]): string {
  return `:root {
  /* Colors */
  --color-primary: ${hslToHex(palette.primary)};
  --color-secondary: ${hslToHex(palette.secondary)};
  --color-accent: ${hslToHex(palette.accent)};
  --color-background: ${hslToHex(palette.background)};
  --color-surface: ${hslToHex(palette.surface)};
  --color-text: ${hslToHex(palette.text)};
  --color-text-muted: ${hslToHex(palette.textMuted)};
  --color-success: ${hslToHex(palette.success)};
  --color-warning: ${hslToHex(palette.warning)};
  --color-error: ${hslToHex(palette.error)};

  /* Typography */
  --font-display: '${fonts.display}', sans-serif;
  --font-body: '${fonts.body}', sans-serif;
  --font-size-base: 1rem;
  --line-height-base: 1.5;

  /* Spacing */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-4: 1rem;
  --space-8: 2rem;
  --space-16: 4rem;

  /* Radius */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
}`;
}

function generateTailwindConfig(palette: ReturnType<typeof generatePalette>, fonts: typeof FONT_PAIRINGS[0]): string {
  return `/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: '${hslToHex(palette.primary)}',
        secondary: '${hslToHex(palette.secondary)}',
        accent: '${hslToHex(palette.accent)}',
        background: '${hslToHex(palette.background)}',
        surface: '${hslToHex(palette.surface)}',
        foreground: '${hslToHex(palette.text)}',
        muted: '${hslToHex(palette.textMuted)}',
        success: '${hslToHex(palette.success)}',
        warning: '${hslToHex(palette.warning)}',
        error: '${hslToHex(palette.error)}',
      },
      fontFamily: {
        display: ['${fonts.display}', 'sans-serif'],
        body: ['${fonts.body}', 'sans-serif'],
      },
    },
  },
};`;
}

// ----- Handler -----
async function handler(input: Input) {
  const industry = input.industry || "tech";
  const vibes = input.vibe || ["modern"];

  const palette = generatePalette(industry, vibes, input.name);
  const fonts = selectFontPairing(vibes, industry, input.name);

  // Accessibility check: primary on background
  const primaryOnBg = contrastRatio(palette.primary, palette.background);
  const textOnBg = contrastRatio(palette.text, palette.background);
  const primaryOnWhite = contrastRatio(palette.primary, { h: 0, s: 0, l: 100 });

  const accessibility = {
    primaryOnBackground: {
      ratio: Math.round(primaryOnBg * 100) / 100,
      rating: wcagRating(primaryOnBg),
    },
    textOnBackground: {
      ratio: Math.round(textOnBg * 100) / 100,
      rating: wcagRating(textOnBg),
    },
    primaryOnWhite: {
      ratio: Math.round(primaryOnWhite * 100) / 100,
      rating: wcagRating(primaryOnWhite),
    },
  };

  switch (input.format) {
    case "tokens":
      return {
        brand: input.name,
        tokens: generateDesignTokens(palette, fonts),
        accessibility,
      };

    case "css":
      return {
        brand: input.name,
        css: generateCSS(palette, fonts),
        accessibility,
        fonts: { display: fonts.display, body: fonts.body, googleFontsUrl: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fonts.display)}:wght@400;600;700&family=${encodeURIComponent(fonts.body)}:wght@400;500;600&display=swap` },
      };

    case "tailwind":
      return {
        brand: input.name,
        tailwindConfig: generateTailwindConfig(palette, fonts),
        accessibility,
        fonts: { display: fonts.display, body: fonts.body },
      };

    case "full":
    default:
      return {
        brand: input.name,
        industry,
        vibes,
        palette: {
          primary: colorToAll("primary", palette.primary),
          secondary: colorToAll("secondary", palette.secondary),
          accent: colorToAll("accent", palette.accent),
          background: colorToAll("background", palette.background),
          surface: colorToAll("surface", palette.surface),
          text: colorToAll("text", palette.text),
          textMuted: colorToAll("text-muted", palette.textMuted),
          success: colorToAll("success", palette.success),
          warning: colorToAll("warning", palette.warning),
          error: colorToAll("error", palette.error),
        },
        typography: {
          display: {
            family: fonts.display,
            weights: ["400", "600", "700"],
            usage: "Headings, hero text, brand moments",
          },
          body: {
            family: fonts.body,
            weights: ["400", "500", "600"],
            usage: "Body text, UI labels, descriptions",
          },
          scale: {
            xs: "0.75rem / 12px",
            sm: "0.875rem / 14px",
            base: "1rem / 16px",
            lg: "1.125rem / 18px",
            xl: "1.25rem / 20px",
            "2xl": "1.5rem / 24px",
            "3xl": "1.875rem / 30px",
            "4xl": "2.25rem / 36px",
            "5xl": "3rem / 48px",
          },
          googleFontsUrl: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fonts.display)}:wght@400;600;700&family=${encodeURIComponent(fonts.body)}:wght@400;500;600&display=swap`,
        },
        accessibility,
        tokens: generateDesignTokens(palette, fonts),
        css: generateCSS(palette, fonts),
        tailwindConfig: generateTailwindConfig(palette, fonts),
      };
  }
}

// ----- Register -----
const brandKitTool: ToolDefinition<Input> = {
  name: "brand-kit",
  description:
    "Generate a complete brand kit from a company name, industry, and aesthetic keywords. Returns a color palette (with hex, HSL, RGB), typography pairings (curated Google Fonts), WCAG accessibility scores, and ready-to-use design tokens in JSON, CSS custom properties, or Tailwind config format. Powered by color psychology and professional design principles.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["design", "branding", "color", "typography", "css", "tailwind", "tokens"],
    pricing: "$0.005 per call",
    exampleInput: {
      name: "Solaris Health",
      industry: "healthcare",
      vibe: ["modern", "warm", "clean"],
      targetAudience: "health-conscious millennials",
      format: "full",
    },
  },
};

registerTool(brandKitTool);
export default brandKitTool;
