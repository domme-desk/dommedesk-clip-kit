import * as path from 'path';
import * as fs from 'fs';
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
    fileName: 'Anton-Regular.ttf',
    weight: 400,
  },
  'bebas-neue': {
    family: 'Bebas Neue',
    fontsourcePackage: '@fontsource/bebas-neue',
    fileName: 'BebasNeue-Regular.ttf',
    weight: 400,
  },
  'montserrat-black': {
    family: 'Montserrat',
    fontsourcePackage: '@fontsource/montserrat',
    fileName: 'Montserrat-Black.ttf',
    weight: 900,
  },
  'bowlby-one': {
    family: 'Bowlby One',
    fontsourcePackage: '@fontsource/bowlby-one',
    fileName: 'BowlbyOne-Regular.ttf',
    weight: 400,
  },
  'fredoka-one': {
    family: 'Fredoka One',
    fontsourcePackage: '@fontsource/fredoka-one',
    fileName: 'FredokaOne-Regular.ttf',
    weight: 400,
  },
  'dancing-script': {
    family: 'Dancing Script',
    fontsourcePackage: '@fontsource/dancing-script',
    fileName: 'DancingScript-Regular.ttf',
    weight: 700,
  },
  'pacifico': {
    family: 'Pacifico',
    fontsourcePackage: '@fontsource/pacifico',
    fileName: 'Pacifico-Regular.ttf',
    weight: 400,
  },
  'playfair-display-black': {
    family: 'Playfair Display',
    fontsourcePackage: '@fontsource/playfair-display',
    fileName: 'PlayfairDisplay-Black.ttf',
    weight: 900,
  },
  'orbitron': {
    family: 'Orbitron',
    fontsourcePackage: '@fontsource/orbitron',
    fileName: 'Orbitron-Black.ttf',
    weight: 900,
  },
  'permanent-marker': {
    family: 'Permanent Marker',
    fontsourcePackage: '@fontsource/permanent-marker',
    fileName: 'PermanentMarker-Regular.ttf',
    weight: 400,
  },
  'playfair-display-italic': {
    family: 'Playfair Display',
    fontsourcePackage: '@fontsource/playfair-display',
    fileName: 'PlayfairDisplay-BlackItalic.ttf',
    weight: 900,
  },
  'abril-fatface': {
    family: 'Abril Fatface',
    fontsourcePackage: '@fontsource/abril-fatface',
    fileName: 'AbrilFatface-Regular.ttf',
    weight: 400,
  },
  'monoton': {
    family: 'Monoton',
    fontsourcePackage: '@fontsource/monoton',
    fileName: 'Monoton-Regular.ttf',
    weight: 400,
  },
  'yeseva-one': {
    family: 'Yeseva One',
    fontsourcePackage: '@fontsource/yeseva-one',
    fileName: 'YesevaOne-Regular.ttf',
    weight: 400,
  },
  'alfa-slab-one': {
    family: 'Alfa Slab One',
    fontsourcePackage: '@fontsource/alfa-slab-one',
    fileName: 'AlfaSlabOne-Regular.ttf',
    weight: 400,
  },
  'caveat': {
    family: 'Caveat',
    fontsourcePackage: '@fontsource/caveat',
    fileName: 'Caveat-Bold.ttf',
    weight: 700,
  },
  'pinyon-script': {
    family: 'Pinyon Script',
    fontsourcePackage: '@fontsource/pinyon-script',
    fileName: 'PinyonScript-Regular.ttf',
    weight: 400,
  },
  'rubik-mono-one': {
    family: 'Rubik Mono One',
    fontsourcePackage: '@fontsource/rubik-mono-one',
    fileName: 'RubikMonoOne-Regular.ttf',
    weight: 400,
  },
  'passion-one': {
    family: 'Passion One',
    fontsourcePackage: '@fontsource/passion-one',
    fileName: 'PassionOne-Black.ttf',
    weight: 900,
  },
  'sacramento': {
    family: 'Sacramento',
    fontsourcePackage: '@fontsource/sacramento',
    fileName: 'Sacramento-Regular.ttf',
    weight: 400,
  },

};

type LoadedFont = {
  key: FontKey;
  family: string;
  weight: number;
  buffer: Buffer;
  path: string;
};

let fontsCache: LoadedFont[] | null = null;

const LOCAL_FONTS_DIR = path.join(process.cwd(), 'src/assets/fonts');

function resolveFontPath(spec: FontSpec): string | null {
  // Use local TTF files (Resvg requires TTF/OTF, not woff2)
  const localPath = path.join(LOCAL_FONTS_DIR, spec.fileName);
  if (fs.existsSync(localPath)) return localPath;
  console.warn(`[fonts] Local font not found: ${localPath}`);
  return null;
}

function _legacyResolveFontPath(spec: FontSpec): string | null {
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
      path,
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
