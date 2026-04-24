import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';
import { loadAllFonts, getFontFamily, type FontKey } from './fonts';
import { TEMPLATES, type TemplateId, type TemplateSpec, type BackgroundStyle, type TextEffect } from './templates';

// ---------------------------------------------------------------------------
// Canvas constants
// ---------------------------------------------------------------------------

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

// ---------------------------------------------------------------------------
// Render input — what Claude provides per variant
// ---------------------------------------------------------------------------

export type TemplateRenderInput = {
  template_id: TemplateId;
  subject_urls: string[];          // 1, 2, or 3 cutout URLs (depends on template.frames_needed)
  text_primary: string;
  text_secondary?: string | null;
  palette: string[];                // hex colors chosen by Claude (brand + template fallback)
  watermark_url?: string | null;
  watermark_position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function pickColor(palette: string[], idx: number, fallback: string): string {
  return palette[idx] || palette[0] || fallback;
}

// ---------------------------------------------------------------------------
// SVG -> PNG using resvg (with bundled fonts)
// ---------------------------------------------------------------------------

function renderSvgToPng(svg: string, width: number, height: number): Buffer {
  const fonts = loadAllFonts();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontBuffers: fonts.map((f) => f.buffer),
      loadSystemFonts: false,
      defaultFontFamily: 'Anton',
    },
    background: 'rgba(0,0,0,0)',
  });
  return resvg.render().asPng();
}

// ---------------------------------------------------------------------------
// Subject prep: tight crop + edge feather
// ---------------------------------------------------------------------------

async function prepSubject(raw: Buffer): Promise<Buffer> {
  const trimmed = await sharp(raw).trim({ threshold: 1 }).toBuffer();
  const meta = await sharp(trimmed).metadata();
  if (!meta.hasAlpha) return trimmed;
  const alpha = await sharp(trimmed).extractChannel('alpha').blur(2.2).toBuffer();
  const rgb = await sharp(trimmed).removeAlpha().toBuffer();
  return sharp(rgb).joinChannel(alpha).toBuffer();
}

async function subjectShadow(subject: Buffer, intensity: number = 0.5): Promise<Buffer> {
  const meta = await sharp(subject).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const alpha = await sharp(subject).extractChannel('alpha').blur(20).linear(intensity, 0).toBuffer();
  const black = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
  return sharp(black).joinChannel(alpha).png().toBuffer();
}

async function subjectRimLight(subject: Buffer, colorHex: string, intensity: number = 0.35): Promise<Buffer> {
  const meta = await sharp(subject).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const { r, g, b } = hexToRgb(colorHex);
  const alpha = await sharp(subject).extractChannel('alpha').toBuffer();
  const expanded = await sharp(alpha).blur(6).linear(1.2, 0).toBuffer();
  const edge = await sharp(expanded).composite([{ input: alpha, blend: 'dest-out' }]).linear(intensity, 0).toBuffer();
  const colored = await sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();
  return sharp(colored).joinChannel(edge).png().toBuffer();
}

// ---------------------------------------------------------------------------
// Background generators (algorithmic, no AI model needed)
// ---------------------------------------------------------------------------

async function generateBackground(style: BackgroundStyle, palette: string[]): Promise<Buffer> {
  const c1 = pickColor(palette, 0, '#FF1493');
  const c2 = pickColor(palette, 1, '#9D4EDD');
  const c3 = pickColor(palette, 2, '#000000');

  const W = CANVAS_W;
  const H = CANVAS_H;

  let svg = '';

  switch (style) {
    case 'flat-saturated':
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${c1}"/></svg>`;
      break;

    case 'gradient':
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
        </linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#g)"/>
      </svg>`;
      break;

    case 'dark-moody-bokeh': {
      // Dark background with soft colored circles (bokeh)
      const circles = [];
      for (let i = 0; i < 14; i++) {
        const cx = Math.random() * W;
        const cy = Math.random() * H;
        const r = 30 + Math.random() * 80;
        const color = Math.random() > 0.5 ? c1 : c2;
        const op = 0.15 + Math.random() * 0.25;
        circles.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${op}"/>`);
      }
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><radialGradient id="bg" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stop-color="${c2}" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="#0A0510"/>
        </radialGradient><filter id="blur"><feGaussianBlur stdDeviation="20"/></filter></defs>
        <rect width="${W}" height="${H}" fill="url(#bg)"/>
        <g filter="url(#blur)">${circles.join('')}</g>
      </svg>`;
      break;
    }

    case 'bright-abstract':
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><radialGradient id="ba" cx="50%" cy="50%" r="80%">
          <stop offset="0%" stop-color="${c3 || '#FFD700'}"/>
          <stop offset="50%" stop-color="${c1}"/>
          <stop offset="100%" stop-color="${c2}"/>
        </radialGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#ba)"/>
      </svg>`;
      break;

    case 'spiral-radial': {
      // Concentric circles creating spiral/hypno effect
      const rings = [];
      for (let i = 0; i < 12; i++) {
        const rad = (i + 1) * 80;
        const color = i % 2 === 0 ? c1 : (c3 || '#000000');
        const op = 0.7 - i * 0.04;
        rings.push(`<circle cx="${W/2}" cy="${H/2}" r="${rad}" fill="none" stroke="${color}" stroke-width="40" opacity="${op}"/>`);
      }
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${W}" height="${H}" fill="${c2}"/>
        ${rings.join('')}
      </svg>`;
      break;
    }

    case 'environmental-bokeh':
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="eb" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#2D1B3D"/>
          <stop offset="60%" stop-color="${c1}" stop-opacity="0.6"/>
          <stop offset="100%" stop-color="#1A0E25"/>
        </linearGradient><filter id="b"><feGaussianBlur stdDeviation="40"/></filter></defs>
        <rect width="${W}" height="${H}" fill="url(#eb)"/>
        <g filter="url(#b)" opacity="0.7">
          <circle cx="200" cy="180" r="120" fill="${c1}"/>
          <circle cx="1050" cy="500" r="160" fill="${c2}"/>
          <circle cx="640" cy="300" r="100" fill="${c3 || '#FFD700'}"/>
        </g>
      </svg>`;
      break;

    case 'dark-texture':
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><radialGradient id="dt" cx="50%" cy="50%" r="80%">
          <stop offset="0%" stop-color="${c1}" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="#050008"/>
        </radialGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#dt)"/>
      </svg>`;
      break;

    case 'pastel-bright':
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="pb" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFE5F1"/>
          <stop offset="100%" stop-color="${c1}"/>
        </linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#pb)"/>
      </svg>`;
      break;

    case 'deep-neon': {
      const gridLines = [];
      for (let i = 0; i < 10; i++) {
        const y = H - i * 40 - 100;
        const op = 0.3 - i * 0.02;
        gridLines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${c1}" stroke-width="1" opacity="${op}"/>`);
      }
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="dn" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#0A0012"/>
          <stop offset="70%" stop-color="${c2}" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="${c1}"/>
        </linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#dn)"/>
        ${gridLines.join('')}
      </svg>`;
      break;
    }

    default:
      svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${c1}"/></svg>`;
  }

  return renderSvgToPng(svg, W, H);
}

// ---------------------------------------------------------------------------
// Text rendering per effect
// ---------------------------------------------------------------------------

type TextPlacement = {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  maxWidth: number;
};

function fitFontSize(text: string, maxWidthPx: number, startSizePx: number): number {
  const approxW = (size: number) => text.length * size * 0.58;
  let s = startSizePx;
  while (approxW(s) > maxWidthPx && s > 20) s -= 2;
  return s;
}

function buildTextSvg(opts: {
  primaryText: string;
  secondaryText?: string;
  primaryFont: FontKey;
  secondaryFont?: FontKey;
  primaryColor: string;
  outlineColor: string;
  secondaryColor?: string;
  effect: TextEffect;
  placement: TextPlacement;
  canvasW: number;
  canvasH: number;
  primaryRelativeSize?: number; // fraction of canvas height, default 0.2
}): string {
  const {
    primaryText, secondaryText, primaryFont, secondaryFont,
    primaryColor, outlineColor, secondaryColor,
    effect, placement, canvasW, canvasH, primaryRelativeSize = 0.22,
  } = opts;

  const targetPrimary = Math.round(canvasH * primaryRelativeSize);
  const primarySize = fitFontSize(primaryText, placement.maxWidth, targetPrimary);
  const stroke = Math.max(4, Math.round(primarySize * 0.09));
  const secSize = secondaryText ? Math.round(primarySize * 0.42) : 0;

  const pFamily = getFontFamily(primaryFont);
  const sFamily = secondaryFont ? getFontFamily(secondaryFont) : pFamily;

  const pText = escapeXml(primaryText);
  const sText = secondaryText ? escapeXml(secondaryText) : '';

  const yPrimary = placement.y;
  const ySecondary = placement.y + primarySize * 0.85;

  let effectDefs = '';
  let primaryElements = '';
  let secondaryElements = '';

  switch (effect) {
    case 'heavy-outline-shadow':
      effectDefs = `<filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000" flood-opacity="0.9"/></filter>`;
      primaryElements = `
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="none" stroke="${outlineColor}" stroke-width="${stroke}" stroke-linejoin="round" paint-order="stroke">${pText}</text>
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="${primaryColor}" filter="url(#sh)">${pText}</text>
      `;
      break;

    case 'neon-glow':
      effectDefs = `
        <filter id="glow1" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" result="b1"/>
          <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="glow2" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="20" result="b2"/>
          <feMerge><feMergeNode in="b2"/></feMerge>
        </filter>
      `;
      primaryElements = `
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="${primaryColor}" filter="url(#glow2)" opacity="0.8">${pText}</text>
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="${primaryColor}" filter="url(#glow1)">${pText}</text>
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="#FFFFFF">${pText}</text>
      `;
      if (secondaryText) {
        secondaryElements = `
          <text x="${placement.x}" y="${ySecondary}" text-anchor="${placement.anchor}" font-family="${sFamily}" font-size="${secSize}" font-style="italic" fill="${secondaryColor || primaryColor}" filter="url(#glow1)">${sText}</text>
        `;
      }
      break;

    case 'clean-outline':
      effectDefs = `<filter id="sh2" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.6"/></filter>`;
      primaryElements = `
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="none" stroke="${outlineColor}" stroke-width="${Math.max(3, stroke - 2)}" paint-order="stroke">${pText}</text>
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="${primaryColor}" filter="url(#sh2)">${pText}</text>
      `;
      break;

    case 'layered-multi': {
      // Text has a shifted colored shadow layer under it
      const shadowColor = outlineColor;
      primaryElements = `
        <text x="${placement.x + 8}" y="${yPrimary + 8}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="${shadowColor}">${pText}</text>
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="none" stroke="#000000" stroke-width="${stroke}" paint-order="stroke">${pText}</text>
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="${primaryColor}">${pText}</text>
      `;
      if (secondaryText) {
        secondaryElements = `
          <text x="${placement.x}" y="${ySecondary}" text-anchor="${placement.anchor}" font-family="${sFamily}" font-size="${secSize}" font-weight="700" fill="${secondaryColor || primaryColor}" stroke="#000000" stroke-width="2" paint-order="stroke">${sText}</text>
        `;
      }
      break;
    }

    case 'elegant-drop-shadow':
      effectDefs = `<filter id="esh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="2" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.75"/></filter>`;
      primaryElements = `
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="${primaryColor}" filter="url(#esh)">${pText}</text>
      `;
      if (secondaryText) {
        secondaryElements = `
          <text x="${placement.x}" y="${ySecondary}" text-anchor="${placement.anchor}" font-family="${sFamily}" font-size="${secSize}" font-style="italic" fill="${secondaryColor || primaryColor}" filter="url(#esh)">${sText}</text>
        `;
      }
      break;

    case 'bubble-thick-rounded':
      primaryElements = `
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="none" stroke="${outlineColor}" stroke-width="${stroke + 2}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke">${pText}</text>
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="${primaryColor}">${pText}</text>
      `;
      if (secondaryText) {
        secondaryElements = `
          <text x="${placement.x}" y="${ySecondary}" text-anchor="${placement.anchor}" font-family="${sFamily}" font-size="${secSize}" font-weight="700" fill="${secondaryColor || primaryColor}" stroke="${outlineColor}" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${sText}</text>
        `;
      }
      break;

    case 'chromatic-aberration':
      primaryElements = `
        <text x="${placement.x - 6}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="#FF00FF" opacity="0.75">${pText}</text>
        <text x="${placement.x + 6}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="#00FFFF" opacity="0.75">${pText}</text>
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="${primaryColor}">${pText}</text>
      `;
      break;

    case 'glow-transparent':
      effectDefs = `
        <filter id="nglow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      `;
      primaryElements = `
        <text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="none" stroke="${primaryColor}" stroke-width="3" filter="url(#nglow)">${pText}</text>
      `;
      break;

    default:
      primaryElements = `<text x="${placement.x}" y="${yPrimary}" text-anchor="${placement.anchor}" font-family="${pFamily}" font-size="${primarySize}" font-weight="900" fill="${primaryColor}">${pText}</text>`;
  }

  return `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg"><defs>${effectDefs}</defs>${primaryElements}${secondaryElements}</svg>`;
}

// ---------------------------------------------------------------------------
// Subject placement per layout
// ---------------------------------------------------------------------------

type PositionedSubject = {
  buffer: Buffer;
  shadow: Buffer;
  rim: Buffer;
  left: number;
  top: number;
  bbox: { left: number; top: number; right: number; bottom: number };
};

async function positionedFrom(subject: Buffer, left: number, top: number, rimColor: string, shadowIntensity: number): Promise<PositionedSubject> {
  const meta = await sharp(subject).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const shadow = await subjectShadow(subject, shadowIntensity);
  const rim = await subjectRimLight(subject, rimColor, 0.35);
  return {
    buffer: subject, shadow, rim, left, top,
    bbox: { left, top, right: left + w, bottom: top + h },
  };
}

async function layoutSingle(subject: Buffer, rimColor: string): Promise<PositionedSubject[]> {
  const scaled = await sharp(subject).resize({ height: Math.round(CANVAS_H * 0.95), fit: 'inside' }).toBuffer();
  const meta = await sharp(scaled).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const left = Math.max(0, Math.min(Math.round(CANVAS_W * 0.62 - w / 2), CANVAS_W - w));
  const top = CANVAS_H - h;
  return [await positionedFrom(scaled, left, top, rimColor, 0.55)];
}

async function layoutMirror(subject: Buffer, rimColor: string): Promise<PositionedSubject[]> {
  const target = await sharp(subject).resize({ height: Math.round(CANVAS_H * 0.92), fit: 'inside' }).toBuffer();
  const meta = await sharp(target).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const leftCopy = target;
  const rightCopy = await sharp(target).flop().toBuffer();
  const topY = CANVAS_H - h;
  const leftX = Math.round(CANVAS_W * 0.22 - w / 2);
  const rightX = Math.round(CANVAS_W * 0.78 - w / 2);
  return [
    await positionedFrom(leftCopy, leftX, topY, rimColor, 0.5),
    await positionedFrom(rightCopy, rightX, topY, rimColor, 0.5),
  ];
}

async function layoutTripleDiff(subjects: Buffer[], rimColor: string): Promise<PositionedSubject[]> {
  // Three DIFFERENT subjects: center biggest, sides smaller, with overlap
  const centerTarget = await sharp(subjects[0]).resize({ height: Math.round(CANVAS_H * 0.98), fit: 'inside' }).toBuffer();
  const leftSource = subjects[1] || subjects[0];
  const rightSource = subjects[2] || subjects[0];
  const leftTarget = await sharp(leftSource).resize({ height: Math.round(CANVAS_H * 0.75), fit: 'inside' }).toBuffer();
  const rightTarget = await sharp(rightSource).resize({ height: Math.round(CANVAS_H * 0.75), fit: 'inside' }).toBuffer();

  const cMeta = await sharp(centerTarget).metadata();
  const lMeta = await sharp(leftTarget).metadata();
  const rMeta = await sharp(rightTarget).metadata();
  const cw = cMeta.width || 0;
  const ch = cMeta.height || 0;
  const lw = lMeta.width || 0;
  const lh = lMeta.height || 0;
  const rw = rMeta.width || 0;
  const rh = rMeta.height || 0;

  const leftPos = { left: Math.round(CANVAS_W * 0.16 - lw / 2), top: CANVAS_H - lh };
  const rightPos = { left: Math.round(CANVAS_W * 0.84 - rw / 2), top: CANVAS_H - rh };
  const centerPos = { left: Math.round(CANVAS_W / 2 - cw / 2), top: CANVAS_H - ch };

  return [
    await positionedFrom(leftTarget, leftPos.left, leftPos.top, rimColor, 0.4),
    await positionedFrom(rightTarget, rightPos.left, rightPos.top, rimColor, 0.4),
    await positionedFrom(centerTarget, centerPos.left, centerPos.top, rimColor, 0.55),
  ];
}

async function layoutSplitDiff(subjects: Buffer[], rimColor: string): Promise<PositionedSubject[]> {
  // Two DIFFERENT subjects side by side, each filling their half
  const leftTarget = await sharp(subjects[0]).resize({ height: Math.round(CANVAS_H * 0.95), fit: 'inside' }).toBuffer();
  const rightTarget = await sharp(subjects[1] || subjects[0]).resize({ height: Math.round(CANVAS_H * 0.95), fit: 'inside' }).toBuffer();
  const lMeta = await sharp(leftTarget).metadata();
  const rMeta = await sharp(rightTarget).metadata();
  const lw = lMeta.width || 0;
  const lh = lMeta.height || 0;
  const rw = rMeta.width || 0;
  const rh = rMeta.height || 0;
  const leftPos = { left: Math.round(CANVAS_W * 0.25 - lw / 2), top: CANVAS_H - lh };
  const rightPos = { left: Math.round(CANVAS_W * 0.75 - rw / 2), top: CANVAS_H - rh };
  return [
    await positionedFrom(leftTarget, leftPos.left, leftPos.top, rimColor, 0.5),
    await positionedFrom(rightTarget, rightPos.left, rightPos.top, rimColor, 0.5),
  ];
}

// ---------------------------------------------------------------------------
// Text placement per template (which corner/zone)
// ---------------------------------------------------------------------------

function pickTextPlacement(template: TemplateSpec, subjectBoxes: { left: number; top: number; right: number; bottom: number }[]): TextPlacement {
  const pad = Math.round(CANVAS_H * 0.06);

  // Find vertical bands that don't overlap subject heads (top 40% of each subject)
  const headZones = subjectBoxes.map((b) => ({ top: b.top, bottom: b.top + (b.bottom - b.top) * 0.45 }));
  const bandClear = (top: number, bottom: number) => !headZones.some((hz) => hz.top < bottom && hz.bottom > top);

  switch (template.layout) {
    case 'single': {
      // Text on the left third, vertically centered-ish
      const bandTop = CANVAS_H * 0.25;
      const bandBottom = CANVAS_H * 0.70;
      return {
        x: Math.round(CANVAS_W * 0.05),
        y: Math.round((bandTop + bandBottom) / 2),
        anchor: 'start',
        maxWidth: Math.round(CANVAS_W * 0.55),
      };
    }
    case 'mirror': {
      // Text centered between the two copies
      return {
        x: CANVAS_W / 2,
        y: Math.round(CANVAS_H * 0.5),
        anchor: 'middle',
        maxWidth: Math.round(CANVAS_W * 0.45),
      };
    }
    case 'triple-diff': {
      // Text in top band (bands pretty much occupied by figures, so text goes high)
      const topClear = bandClear(pad, pad + CANVAS_H * 0.3);
      if (topClear) {
        return { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.2), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.85) };
      }
      // Otherwise overlay at bottom center
      return { x: CANVAS_W / 2, y: Math.round(CANVAS_H * 0.85), anchor: 'middle', maxWidth: Math.round(CANVAS_W * 0.75) };
    }
    case 'split-diff': {
      // Text centered, overlaps both subjects — big and bold
      return {
        x: CANVAS_W / 2,
        y: Math.round(CANVAS_H * 0.5),
        anchor: 'middle',
        maxWidth: Math.round(CANVAS_W * 0.75),
      };
    }
    default:
      return { x: CANVAS_W / 2, y: CANVAS_H - pad, anchor: 'middle', maxWidth: CANVAS_W - pad * 2 };
  }
}

// ---------------------------------------------------------------------------
// Final polish pass
// ---------------------------------------------------------------------------

async function polishPass(img: Buffer): Promise<Buffer> {
  const vignette = Buffer.from(
    `<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="vg" cx="50%" cy="50%" r="75%">
        <stop offset="60%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.32"/>
      </radialGradient></defs>
      <rect width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#vg)"/>
    </svg>`
  );
  return sharp(img)
    .modulate({ saturation: 1.10, brightness: 1.02 })
    .composite([{ input: vignette, blend: 'over' }])
    .sharpen({ sigma: 0.6 })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Watermark positioning
// ---------------------------------------------------------------------------

function wmOffset(pos: string | undefined, wmW: number, wmH: number) {
  const pad = 24;
  switch (pos) {
    case 'top-left': return { left: pad, top: pad };
    case 'top-right': return { left: CANVAS_W - wmW - pad, top: pad };
    case 'bottom-left': return { left: pad, top: CANVAS_H - wmH - pad };
    case 'center': return { left: Math.round((CANVAS_W - wmW) / 2), top: Math.round((CANVAS_H - wmH) / 2) };
    case 'bottom-right':
    default: return { left: CANVAS_W - wmW - pad, top: CANVAS_H - wmH - pad };
  }
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export async function renderTemplate(input: TemplateRenderInput): Promise<Buffer> {
  const template = TEMPLATES[input.template_id];
  if (!template) throw new Error(`Unknown template: ${input.template_id}`);

  const palette = input.palette.length > 0 ? input.palette : template.default_palette;

  // Fetch subject cutouts
  const subjectBuffers = await Promise.all(input.subject_urls.map(fetchBuffer));
  const preppedSubjects = await Promise.all(subjectBuffers.map(prepSubject));

  // Generate background
  const backgroundBuf = await generateBackground(template.background, palette);
  const background = await sharp(backgroundBuf).modulate({ brightness: 0.92 }).toBuffer();

  // Layout subjects
  const rimColor = pickColor(palette, 0, '#FF1493');
  let positioned: PositionedSubject[];
  switch (template.layout) {
    case 'single': positioned = await layoutSingle(preppedSubjects[0], rimColor); break;
    case 'mirror': positioned = await layoutMirror(preppedSubjects[0], rimColor); break;
    case 'triple-diff': positioned = await layoutTripleDiff(preppedSubjects, rimColor); break;
    case 'split-diff': positioned = await layoutSplitDiff(preppedSubjects, rimColor); break;
    default: positioned = await layoutSingle(preppedSubjects[0], rimColor);
  }

  // Build text
  const textPlacement = pickTextPlacement(template, positioned.map(p => p.bbox));
  const textSvg = buildTextSvg({
    primaryText: input.text_primary,
    secondaryText: template.supports_secondary_text ? (input.text_secondary || undefined) : undefined,
    primaryFont: template.primary_font,
    secondaryFont: template.secondary_font,
    primaryColor: pickColor(palette, 0, '#FFFFFF'),
    outlineColor: pickColor(palette, 3, '#000000'),
    secondaryColor: pickColor(palette, 1, '#FFFFFF'),
    effect: template.text_effect,
    placement: textPlacement,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
  });
  const textPng = renderSvgToPng(textSvg, CANVAS_W, CANVAS_H);

  // Compose
  const layers: sharp.OverlayOptions[] = [];
  for (const p of positioned) layers.push({ input: p.shadow, left: p.left + 12, top: p.top + 18 });
  for (const p of positioned) layers.push({ input: p.buffer, left: p.left, top: p.top });
  for (const p of positioned) layers.push({ input: p.rim, left: p.left, top: p.top, blend: 'screen' });
  layers.push({ input: textPng, left: 0, top: 0 });

  if (input.watermark_url) {
    const wmRaw = await fetchBuffer(input.watermark_url);
    const wmSized = await sharp(wmRaw).resize({ width: Math.round(CANVAS_W * 0.12), withoutEnlargement: true }).toBuffer();
    const wmMeta = await sharp(wmSized).metadata();
    const offset = wmOffset(input.watermark_position, wmMeta.width || 0, wmMeta.height || 0);
    layers.push({ input: wmSized, left: offset.left, top: offset.top });
  }

  const raw = await sharp(background).composite(layers).png().toBuffer();
  return polishPass(raw);
}
