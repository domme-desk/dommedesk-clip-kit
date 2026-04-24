import sharp from 'sharp';
import type { CompositionBrief } from './prompts';

export type CompositeInput = {
  backgroundUrl: string;
  subjectMaskUrl: string;   // RMBG output — transparent PNG of the subject
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
 * Build an SVG overlay with the brief's text. The SVG is then composited as
 * a layer by sharp. Using SVG means the text is always pixel-perfect.
 */
function buildTextSvg(brief: CompositionBrief, width: number, height: number): Buffer {
  const primarySize = Math.round(height * 0.12);
  const secondarySize = Math.round(height * 0.055);
  const color = brief.text_color || '#FFFFFF';
  const shadow = brief.text_shadow ? 'filter="url(#shadow)"' : '';

  // Position mapping
  let anchor: 'start' | 'middle' | 'end' = 'middle';
  let x = width / 2;
  let yPrimary = height / 2;

  const pad = Math.round(height * 0.06);

  switch (brief.text_position) {
    case 'top':
      anchor = 'middle';
      x = width / 2;
      yPrimary = pad + primarySize;
      break;
    case 'bottom':
      anchor = 'middle';
      x = width / 2;
      yPrimary = height - pad;
      break;
    case 'top-left':
      anchor = 'start';
      x = pad;
      yPrimary = pad + primarySize;
      break;
    case 'top-right':
      anchor = 'end';
      x = width - pad;
      yPrimary = pad + primarySize;
      break;
    case 'bottom-left':
      anchor = 'start';
      x = pad;
      yPrimary = height - pad;
      break;
    case 'bottom-right':
      anchor = 'end';
      x = width - pad;
      yPrimary = height - pad;
      break;
    case 'center':
    default:
      anchor = 'middle';
      x = width / 2;
      yPrimary = height / 2;
  }

  const ySecondary = yPrimary + primarySize * 0.9;

  const secondary = brief.text_secondary
    ? `<text x="${x}" y="${ySecondary}" text-anchor="${anchor}" font-family="Impact, 'Arial Black', sans-serif" font-size="${secondarySize}" font-weight="700" fill="${color}" ${shadow}>${escapeXml(brief.text_secondary)}</text>`
    : '';

  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.7"/>
    </filter>
  </defs>
  <text x="${x}" y="${yPrimary}" text-anchor="${anchor}" font-family="Impact, 'Arial Black', sans-serif" font-size="${primarySize}" font-weight="900" fill="${color}" ${shadow}>${escapeXml(brief.text_primary)}</text>
  ${secondary}
</svg>`.trim();

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

  // 1. Fetch and resize the background to target canvas size
  const [bgRaw, subjRaw] = await Promise.all([
    fetchBuffer(backgroundUrl),
    fetchBuffer(subjectMaskUrl),
  ]);

  const background = await sharp(bgRaw)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'cover', position: 'center' })
    .toBuffer();

  // 2. Resize subject to fit within canvas. Keep aspect ratio, fit inside the
  // bottom-centered zone with a small bottom padding. We resize to fit a box
  // that is 90% of canvas height, anchored bottom-center.
  const subjectFitted = await sharp(subjRaw)
    .resize({
      width: Math.round(TARGET_WIDTH * 0.8),
      height: Math.round(TARGET_HEIGHT * 0.95),
      fit: 'inside',
    })
    .toBuffer();
  const subjMeta = await sharp(subjectFitted).metadata();
  const subjW = subjMeta.width || TARGET_WIDTH;
  const subjH = subjMeta.height || TARGET_HEIGHT;
  const subjLeft = Math.round((TARGET_WIDTH - subjW) / 2);
  const subjTop = TARGET_HEIGHT - subjH;

  // 3. Build text overlay SVG
  const textSvg = buildTextSvg(brief, TARGET_WIDTH, TARGET_HEIGHT);

  // 4. Optional watermark
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

  // 5. Compose all layers
  const layers: sharp.OverlayOptions[] = [
    { input: subjectFitted, left: subjLeft, top: subjTop },
    { input: textSvg, left: 0, top: 0 },
  ];
  if (watermarkLayer) layers.push(watermarkLayer);

  return sharp(background).composite(layers).png().toBuffer();
}
