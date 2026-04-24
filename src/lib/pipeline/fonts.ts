import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Font registry for thumbnail rendering.
 *
 * @fontsource packages install .ttf/.woff2 files into node_modules. We resolve
 * those paths at runtime and read the font files as buffers so resvg-js can
 * register them for SVG text rendering.
 *
 * When adding a new font: add the entry here, install the corresponding
 * @fontsource package, and reference it by logical name in templates.
 */

export type FontKey =
  | 'anton'
  | 'bebas-neue'
  | 'montserrat-black'
  | 'bowlby-one'
  | 'fredoka-one'
  | 'dancing-script'
  | 'pacifico'
  | 'playfair-display-black'
  | 'playfair-display-italic'
  | 'orbitron'
  | 'permanent-marker'
  | 'abril-fatface'
  | 'monoton'
  | 'yeseva-one'
  | 'alfa-slab-one'
  | 'caveat'
  | 'pinyon-script'
  | 'rubik-mono-one'
  | 'passion-one'
  | 'sacramento';

type FontSpec = {
  family: string;           // CSS font-family name for SVG
  fontsourcePackage: string; // npm package name
  fileName: string;          // specific .ttf filename inside the package's files/ dir
  weight: number;            // font weight (100-900)
};

const FONT_SPECS: Record<FontKey, FontSpec> = {
  'anton': {
    family: 'Anton',
    fontsourcePackage: '@fontsource/anton',
    fileName: 'anton-latin-400-normal.woff2',
    weight: 400,
  },
  'bebas-neue': {
    family: 'Bebas Neue',
    fontsourcePackage: '@fontsource/bebas-neue',
    fileName: 'bebas-neue-latin-400-normal.woff2',
    weight: 400,
  },
  'montserrat-black': {
    family: 'Montserrat',
    fontsourcePackage: '@fontsource/montserrat',
    fileName: 'montserrat-latin-900-normal.woff2',
    weight: 900,
  },
  'bowlby-one': {
    family: 'Bowlby One',
    fontsourcePackage: '@fontsource/bowlby-one',
    fileName: 'bowlby-one-latin-400-normal.woff2',
    weight: 400,
  },
  'fredoka-one': {
    family: 'Fredoka One',
    fontsourcePackage: '@fontsource/fredoka-one',
    fileName: 'fredoka-one-latin-400-normal.woff2',
    weight: 400,
  },
  'dancing-script': {
    family: 'Dancing Script',
    fontsourcePackage: '@fontsource/dancing-script',
    fileName: 'dancing-script-latin-700-normal.woff2',
    weight: 700,
  },
  'pacifico': {
    family: 'Pacifico',
    fontsourcePackage: '@fontsource/pacifico',
    fileName: 'pacifico-latin-400-normal.woff2',
    weight: 400,
  },
  'playfair-display-black': {
    family: 'Playfair Display',
    fontsourcePackage: '@fontsource/playfair-display',
    fileName: 'playfair-display-latin-900-normal.woff2',
    weight: 900,
  },
  'orbitron': {
    family: 'Orbitron',
    fontsourcePackage: '@fontsource/orbitron',
    fileName: 'orbitron-latin-900-normal.woff2',
    weight: 900,
  },
  'permanent-marker': {
    family: 'Permanent Marker',
    fontsourcePackage: '@fontsource/permanent-marker',
    fileName: 'permanent-marker-latin-400-normal.woff2',
    weight: 400,
  },
  'playfair-display-italic': {
    family: 'Playfair Display',
    fontsourcePackage: '@fontsource/playfair-display',
    fileName: 'playfair-display-latin-900-italic.woff2',
    weight: 900,
  },
  'abril-fatface': {
    family: 'Abril Fatface',
    fontsourcePackage: '@fontsource/abril-fatface',
    fileName: 'abril-fatface-latin-400-normal.woff2',
    weight: 400,
  },
  'monoton': {
    family: 'Monoton',
    fontsourcePackage: '@fontsource/monoton',
    fileName: 'monoton-latin-400-normal.woff2',
    weight: 400,
  },
  'yeseva-one': {
    family: 'Yeseva One',
    fontsourcePackage: '@fontsource/yeseva-one',
    fileName: 'yeseva-one-latin-400-normal.woff2',
    weight: 400,
  },
  'alfa-slab-one': {
    family: 'Alfa Slab One',
    fontsourcePackage: '@fontsource/alfa-slab-one',
    fileName: 'alfa-slab-one-latin-400-normal.woff2',
    weight: 400,
  },
  'caveat': {
    family: 'Caveat',
    fontsourcePackage: '@fontsource/caveat',
    fileName: 'caveat-latin-700-normal.woff2',
    weight: 700,
  },
  'pinyon-script': {
    family: 'Pinyon Script',
    fontsourcePackage: '@fontsource/pinyon-script',
    fileName: 'pinyon-script-latin-400-normal.woff2',
    weight: 400,
  },
  'rubik-mono-one': {
    family: 'Rubik Mono One',
    fontsourcePackage: '@fontsource/rubik-mono-one',
    fileName: 'rubik-mono-one-latin-400-normal.woff2',
    weight: 400,
  },
  'passion-one': {
    family: 'Passion One',
    fontsourcePackage: '@fontsource/passion-one',
    fileName: 'passion-one-latin-900-normal.woff2',
    weight: 900,
  },
  'sacramento': {
    family: 'Sacramento',
    fontsourcePackage: '@fontsource/sacramento',
    fileName: 'sacramento-latin-400-normal.woff2',
    weight: 400,
  },

};

type LoadedFont = {
  key: FontKey;
  family: string;
  weight: number;
  buffer: Buffer;
};

let fontsCache: LoadedFont[] | null = null;

function resolveFontPath(spec: FontSpec): string | null {
  // Try .woff2 first (modern), fall back to .ttf
  const candidates = [
    join(process.cwd(), 'node_modules', spec.fontsourcePackage, 'files', spec.fileName),
    join(process.cwd(), 'node_modules', spec.fontsourcePackage, 'files', spec.fileName.replace('.woff2', '.ttf')),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadAllFonts(): LoadedFont[] {
  if (fontsCache) return fontsCache;

  const loaded: LoadedFont[] = [];
  const missing: string[] = [];

  for (const [key, spec] of Object.entries(FONT_SPECS) as [FontKey, FontSpec][]) {
    const path = resolveFontPath(spec);
    if (!path) {
      missing.push(`${key} (${spec.fontsourcePackage})`);
      continue;
    }
    loaded.push({
      key,
      family: spec.family,
      weight: spec.weight,
      buffer: readFileSync(path),
    });
  }

  if (missing.length > 0) {
    console.warn(`[fonts] Missing font files: ${missing.join(', ')}`);
  }
  console.log(`[fonts] Loaded ${loaded.length} fonts`);

  fontsCache = loaded;
  return loaded;
}

export function getFontFamily(key: FontKey): string {
  return FONT_SPECS[key]?.family || 'Impact, Arial Black, sans-serif';
}

export function getFontFamilyWithFallback(key: FontKey, fallback: string = 'Impact, Arial Black, sans-serif'): string {
  const family = FONT_SPECS[key]?.family;
  return family ? `"${family}", ${fallback}` : fallback;
}
