import Replicate from 'replicate';

export const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
});

// Model identifiers — using model slugs (not pinned versions) so Replicate
// auto-resolves the latest published version. We can pin specific versions
// later once we've validated outputs.
export const MODELS = {
  // Background removal / subject segmentation. bria/remove-background is a
  // well-maintained official model with stable output behavior.
  rmbg: 'bria/remove-background',
  // Image generation — Flux 1.1 Pro (more permissive than Nano Banana for fetish aesthetics)
  nanoBanana: 'black-forest-labs/flux-1.1-pro',
} as const;

/**
 * Run background removal to produce a transparent-background PNG of the subject.
 * Returns a URL pointing to the masked output.
 */
export async function removeBackground(imageUrl: string): Promise<string> {
  const output = await replicate.run(MODELS.rmbg as `${string}/${string}`, {
    input: { image: imageUrl },
  });

  return extractUrl(output, 'removeBackground');
}

/**
 * Generate an image with Nano Banana (Gemini 2.5 Flash Image).
 */
export async function generateBackground(
  prompt: string,
  aspectRatio: '16:9' | '9:16' | '1:1' = '16:9'
): Promise<string> {
  const output = await replicate.run(MODELS.nanoBanana as `${string}/${string}`, {
    input: {
      prompt,
      aspect_ratio: aspectRatio,
      output_format: 'png',
      safety_tolerance: 5,  // Flux's permissiveness knob (2=strict, 5=most permissive allowed)
      prompt_upsampling: true,
    },
  });

  return extractUrl(output, 'generateBackground');
}

/**
 * Replicate's output shape varies between models and SDK versions. Try the
 * common shapes in priority order.
 */
function extractUrl(output: unknown, label: string): string {
  if (typeof output === 'string') return output;

  if (Array.isArray(output)) {
    const first = output[0];
    if (typeof first === 'string') return first;
    if (first && typeof (first as { url?: () => string }).url === 'function') {
      return (first as { url: () => string }).url();
    }
  }

  if (output && typeof (output as { url?: () => string }).url === 'function') {
    return (output as { url: () => string }).url();
  }

  console.error(`[${label}] unexpected output shape:`, output);
  throw new Error(`Unexpected ${label} output shape.`);
}
