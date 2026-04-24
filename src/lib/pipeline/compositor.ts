import sharp from 'sharp';
import type { CompositionBrief } from './prompts';

export type CompositeInput = {
  backgroundUrl: string;
  subjectMaskUrl: string;
  brief: CompositionBrief;
  watermarkUrl?: string | null;
  watermarkPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
};

const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Trim fully-transparent padding around the subject so cropped PNG is a tight bbox.
 */
async function tightCropSubject(raw: Buffer): Promise<Buffer> {
  return sharp(raw).trim({ threshold: 1 }).toBuffer();
}

function buildTextSvg(brief: CompositionBrief, width: number, height: number): Buffer {
  const primarySize = Math.round(height * 0.14);
  const secondarySize = Math.round(height * 0.06);
  const color = brief.text_color || '#FFFFFF';
  const outline = brief.text_outline_color || '#000000';
  const strokeWidth = Math.max(3, Math.round(primarySize * 0.06));

  let anchor: 'start' | 'middle' | 'end' = 'middle';
  let x = width / 2;
  let yPrimary = height / 2;
  const pad = Math.round(height * 0.06);

  switch (brief.text_position) {
    case 'top':
      anchor = 'middle'; x = width / 2; yPrimary = pad + primarySize; break;
    case 'bottom':
      anchor = 'middle'; x = width / 2; yPrimary = height - pad; break;
    case 'top-left':
      anchor = 'start'; x = pad; yPrimary = pad + primarySize; break;
    case 'top-right':
      anchor = 'end'; x = width - pad; yPrimary = pad + primarySize; break;
    case 'bottom-left':
      anchor = 'start'; x = pad; yPrimary = height - pad; break;
    case 'bottom-right':
      anchor = 'end'; x = width - pad; yPrimary = height - pad; break;
    case 'center':
    default:
      anchor = 'middle'; x = width / 2; yPrimary = height / 2;
  }

  const ySecondary = yPrimary + primarySize * 0.9;

  const primaryText = escapeXml(brief.text_primary);
  const secondaryText = brief.text_secondary ? escapeXml(brief.text_secondary) : '';

  const primaryFont = `font-family="Impact, Arial Black, sans-serif" font-size="${primarySize}" font-weight="900"`;
  const secondaryFont = `font-family="Impact, Arial Black, sans-serif" font-size="${secondarySize}" font-weight="700"`;

  // Draw each text twice: once as outline stroke, once as fill, for strong readability
  const primaryStroke = `<text x="${x}" y="${yPrimary}" text-anchor="${anchor}" ${primaryFont} fill="none" stroke="${outline}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke">${primaryText}</text>`;
  const primaryFill = `<text x="${x}" y="${yPrimary}" text-anchor="${anchor}" ${primaryFont} fill="${color}" filter="url(#shadow)">${primaryText}</text>`;

  const secondaryStroke = secondaryText
    ? `<text x="${x}" y="${ySecondary}" text-anchor="${anchor}" ${secondaryFont} fill="none" stroke="${outline}" stroke-width="${Math.max(2, Math.round(strokeWidth * 0.6))}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke">${secondaryText}</text>`
    : '';
  const secondaryFill = secondaryText
    ? `<text x="${x}" y="${ySecondary}" text-anchor="${anchor}" ${secondaryFont} fill="${color}" filter="url(#shadow)">${secondaryText}</text>`
    : '';

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="0.85"/></filter></defs>${primaryStroke}${primaryFill}${secondaryStroke}${secondaryFill}</svg>`;

  return Buffer.from(svg);
}

function watermarkOffset(
  position: string | undefined,
  canvasW: number,
  canvasH: number,
  wmW: number,
  wmH: number
): { left: number; top: number } {
  const pad = 24;
  switch (position) {
    case 'top-left': return { left: pad, top: pad };
    case 'top-right': return { left: canvasW - wmW - pad, top: pad };
    case 'bottom-left': return { left: pad, top: canvasH - wmH - pad };
    case 'center': return { left: Math.round((canvasW - wmW) / 2), top: Math.round((canvasH - wmH) / 2) };
    case 'bottom-right':
    default:
      return { left: canvasW - wmW - pad, top: canvasH - wmH - pad };
  }
}

export async function composite(input: CompositeInput): Promise<Buffer> {
  const { backgroundUrl, subjectMaskUrl, brief, watermarkUrl, watermarkPosition } = input;

  const [bgRaw, subjRaw] = await Promise.all([
    fetchBuffer(backgroundUrl),
    fetchBuffer(subjectMaskUrl),
  ]);

  // 1. Background filling entire canvas
  const background = await sharp(bgRaw)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'cover', position: 'center' })
    .toBuffer();

  // 2. Subject: tight-crop transparent padding, then fill 95% of canvas height
  const tightSubject = await tightCropSubject(subjRaw);
  const subjectFitted = await sharp(tightSubject)
    .resize({
      height: Math.round(TARGET_HEIGHT * 0.95),
      fit: 'inside',
      withoutEnlargement: false,
    })
    .toBuffer();

  const subjMeta = await sharp(subjectFitted).metadata();
  const subjW = subjMeta.width || 0;
  const subjH = subjMeta.height || 0;

  // If the subject is wider than the canvas (rare), constrain width
  let finalSubject = subjectFitted;
  let finalW = subjW;
  let finalH = subjH;
  if (subjW > TARGET_WIDTH * 0.95) {
    finalSubject = await sharp(tightSubject)
      .resize({
        width: Math.round(TARGET_WIDTH * 0.9),
        fit: 'inside',
      })
      .toBuffer();
    const m = await sharp(finalSubject).metadata();
    finalW = m.width || TARGET_WIDTH;
    finalH = m.height || TARGET_HEIGHT;
  }

  const subjLeft = Math.round((TARGET_WIDTH - finalW) / 2);
  const subjTop = TARGET_HEIGHT - finalH;  // anchor bottom

  // 3. Text overlay (drawn AFTER subject so it overlaps)
  const textSvg = buildTextSvg(brief, TARGET_WIDTH, TARGET_HEIGHT);

  // 4. Optional watermark (always last, above everything)
  let watermarkLayer: { input: Buffer; left: number; top: number } | null = null;
  if (watermarkUrl) {
    const wmRaw = await fetchBuffer(watermarkUrl);
    const wmSized = await sharp(wmRaw)
      .resize({ width: Math.round(TARGET_WIDTH * 0.12), withoutEnlargement: true })
      .toBuffer();
    const wmMeta = await sharp(wmSized).metadata();
    const wmW = wmMeta.width || 0;
    const wmH = wmMeta.height || 0;
    const offset = watermarkOffset(watermarkPosition, TARGET_WIDTH, TARGET_HEIGHT, wmW, wmH);
    watermarkLayer = { input: wmSized, left: offset.left, top: offset.top };
  }

  const layers: sharp.OverlayOptions[] = [
    { input: finalSubject, left: subjLeft, top: subjTop },
    { input: textSvg, left: 0, top: 0 },
  ];
  if (watermarkLayer) layers.push(watermarkLayer);

  return sharp(background).composite(layers).png().toBuffer();
}
