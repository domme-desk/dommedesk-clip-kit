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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function tightCropSubject(raw: Buffer): Promise<Buffer> {
  return sharp(raw).trim({ threshold: 1 }).toBuffer();
}

function buildTextSvg(brief: CompositionBrief, width: number, height: number): Buffer {
  const color = brief.text_color || '#FFFFFF';
  const outline = brief.text_outline_color || '#000000';
  const primaryText = brief.text_primary;
  const secondaryText = brief.text_secondary || '';

  function fitFontSize(text: string, maxWidthPx: number, startSizePx: number): number {
    const approxW = (size: number) => text.length * size * 0.58;
    let s = startSizePx;
    while (approxW(s) > maxWidthPx && s > 18) s -= 2;
    return s;
  }

  const pad = Math.round(height * 0.05);
  const maxTextWidth = width - pad * 2;

  const targetPrimary = Math.round(height * 0.22);  // bigger than before
  const primarySize = fitFontSize(primaryText, maxTextWidth, targetPrimary);
  const targetSecondary = Math.round(height * 0.08);
  const secondarySize = secondaryText ? fitFontSize(secondaryText, maxTextWidth, targetSecondary) : 0;

  const strokeWidth = Math.max(4, Math.round(primarySize * 0.08));

  let anchor: 'start' | 'middle' | 'end' = 'middle';
  let x = width / 2;
  let yPrimary = height / 2;

  switch (brief.text_position) {
    case 'top': anchor = 'middle'; x = width / 2; yPrimary = pad + primarySize; break;
    case 'bottom': anchor = 'middle'; x = width / 2; yPrimary = height - pad; break;
    case 'top-left': anchor = 'start'; x = pad; yPrimary = pad + primarySize; break;
    case 'top-right': anchor = 'end'; x = width - pad; yPrimary = pad + primarySize; break;
    case 'bottom-left': anchor = 'start'; x = pad; yPrimary = height - pad; break;
    case 'bottom-right': anchor = 'end'; x = width - pad; yPrimary = height - pad; break;
    case 'center': default: anchor = 'middle'; x = width / 2; yPrimary = height / 2;
  }

  const ySecondary = yPrimary + primarySize * 0.9;
  const primaryFont = `font-family="Impact, Arial Black, sans-serif" font-size="${primarySize}" font-weight="900"`;
  const secondaryFont = `font-family="Impact, Arial Black, sans-serif" font-size="${secondarySize}" font-weight="700"`;

  const pText = escapeXml(primaryText);
  const sText = escapeXml(secondaryText);

  const primaryStroke = `<text x="${x}" y="${yPrimary}" text-anchor="${anchor}" ${primaryFont} fill="none" stroke="${outline}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke">${pText}</text>`;
  const primaryFill = `<text x="${x}" y="${yPrimary}" text-anchor="${anchor}" ${primaryFont} fill="${color}" filter="url(#shadow)">${pText}</text>`;
  const secondaryStroke = secondaryText
    ? `<text x="${x}" y="${ySecondary}" text-anchor="${anchor}" ${secondaryFont} fill="none" stroke="${outline}" stroke-width="${Math.max(2, Math.round(strokeWidth * 0.6))}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke">${sText}</text>`
    : '';
  const secondaryFill = secondaryText
    ? `<text x="${x}" y="${ySecondary}" text-anchor="${anchor}" ${secondaryFont} fill="${color}" filter="url(#shadow)">${sText}</text>`
    : '';

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="0.85"/></filter></defs>${primaryStroke}${primaryFill}${secondaryStroke}${secondaryFill}</svg>`;

  return Buffer.from(svg);
}

function watermarkOffset(position: string | undefined, canvasW: number, canvasH: number, wmW: number, wmH: number): { left: number; top: number } {
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

/**
 * Given the tight-cropped subject PNG, build subject layer(s) depending on layout.
 * Returns an array of overlay inputs.
 */
async function buildSubjectLayers(
  tightSubject: Buffer,
  layout: 'single' | 'mirrored' | 'triple'
): Promise<sharp.OverlayOptions[]> {
  if (layout === 'single') {
    // One copy, 85% canvas height, positioned right-of-center (leaves room for big left text)
    const scaled = await sharp(tightSubject)
      .resize({ height: Math.round(TARGET_HEIGHT * 0.92), fit: 'inside' })
      .toBuffer();
    const meta = await sharp(scaled).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    // Position right-of-center for single layout
    const left = Math.round(TARGET_WIDTH * 0.55 - w / 2);
    const top = TARGET_HEIGHT - h;
    return [{ input: scaled, left: Math.max(0, Math.min(left, TARGET_WIDTH - w)), top }];
  }

  if (layout === 'mirrored') {
    // Two copies: one left, one right (horizontally flipped)
    const target = await sharp(tightSubject)
      .resize({ height: Math.round(TARGET_HEIGHT * 0.90), fit: 'inside' })
      .toBuffer();
    const meta = await sharp(target).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;

    const leftCopy = target;
    const rightCopy = await sharp(target).flop().toBuffer();

    const leftPosX = Math.round(TARGET_WIDTH * 0.18 - w / 2);
    const rightPosX = Math.round(TARGET_WIDTH * 0.82 - w / 2);
    const topY = TARGET_HEIGHT - h;

    return [
      { input: leftCopy, left: Math.max(-Math.round(w * 0.15), leftPosX), top: topY },
      { input: rightCopy, left: Math.min(TARGET_WIDTH - Math.round(w * 0.85), rightPosX), top: topY },
    ];
  }

  // triple
  const centerTarget = await sharp(tightSubject)
    .resize({ height: Math.round(TARGET_HEIGHT * 0.95), fit: 'inside' })
    .toBuffer();
  const sideTarget = await sharp(tightSubject)
    .resize({ height: Math.round(TARGET_HEIGHT * 0.80), fit: 'inside' })
    .toBuffer();

  const centerMeta = await sharp(centerTarget).metadata();
  const sideMeta = await sharp(sideTarget).metadata();
  const cw = centerMeta.width || 0;
  const ch = centerMeta.height || 0;
  const sw = sideMeta.width || 0;
  const sh = sideMeta.height || 0;

  const leftSide = await sharp(sideTarget).toBuffer();
  const rightSide = await sharp(sideTarget).flop().toBuffer();

  return [
    // Left side copy (smaller, edge)
    { input: leftSide, left: Math.round(TARGET_WIDTH * 0.15 - sw / 2), top: TARGET_HEIGHT - sh },
    // Right side copy (mirrored)
    { input: rightSide, left: Math.round(TARGET_WIDTH * 0.85 - sw / 2), top: TARGET_HEIGHT - sh },
    // Center copy (biggest, in front)
    { input: centerTarget, left: Math.round(TARGET_WIDTH / 2 - cw / 2), top: TARGET_HEIGHT - ch },
  ];
}

export async function composite(input: CompositeInput): Promise<Buffer> {
  const { backgroundUrl, subjectMaskUrl, brief, watermarkUrl, watermarkPosition } = input;

  const [bgRaw, subjRaw] = await Promise.all([
    fetchBuffer(backgroundUrl),
    fetchBuffer(subjectMaskUrl),
  ]);

  const background = await sharp(bgRaw)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'cover', position: 'center' })
    .toBuffer();

  const tightSubject = await tightCropSubject(subjRaw);

  const layout = brief.layout || 'single';
  const subjectLayers = await buildSubjectLayers(tightSubject, layout);

  const textSvg = buildTextSvg(brief, TARGET_WIDTH, TARGET_HEIGHT);

  let watermarkLayer: { input: Buffer; left: number; top: number } | null = null;
  if (watermarkUrl) {
    const wmRaw = await fetchBuffer(watermarkUrl);
    const wmSized = await sharp(wmRaw)
      .resize({ width: Math.round(TARGET_WIDTH * 0.12), withoutEnlargement: true })
      .toBuffer();
    const wmMeta = await sharp(wmSized).metadata();
    const offset = watermarkOffset(watermarkPosition, TARGET_WIDTH, TARGET_HEIGHT, wmMeta.width || 0, wmMeta.height || 0);
    watermarkLayer = { input: wmSized, left: offset.left, top: offset.top };
  }

  const layers: sharp.OverlayOptions[] = [...subjectLayers, { input: textSvg, left: 0, top: 0 }];
  if (watermarkLayer) layers.push(watermarkLayer);

  return sharp(background).composite(layers).png().toBuffer();
}
