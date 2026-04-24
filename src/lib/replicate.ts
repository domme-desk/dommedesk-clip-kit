import Replicate from 'replicate';

export const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
});

// Model identifiers — pinned versions for reproducibility.
// Update these only when intentionally adopting a new model version.
export const MODELS = {
  // Subject segmentation / background removal
  rmbg: 'lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff4ba8ed9a83aebdf0b9c86db8be8ddf',
  // Image generation (Nano Banana / Gemini 2.5 Flash Image)
  nanoBanana: 'google/nano-banana',
} as const;

/**
 * Run Replicate RMBG to produce a transparent-background PNG of the subject.
 * Returns the URL of the masked output.
 */
export async function removeBackground(imageUrl: string): Promise<string> {
  const output = await replicate.run(MODELS.rmbg, {
    input: { image: imageUrl },
  });

  // RMBG returns a single URL (string) or a ReadableStream depending on version
  if (typeof output === 'string') return output;
  if (output instanceof ReadableStream) {
    // Convert stream to blob, then upload to our own storage
    throw new Error('Stream output not expected from RMBG; check model version.');
  }
  // Some versions return an array
  if (Array.isArray(output) && typeof output[0] === 'string') return output[0];

  console.error('[removeBackground] unexpected output shape:', output);
  throw new Error('Unexpected RMBG output shape.');
}

/**
 * Generate an image with Nano Banana (Gemini 2.5 Flash Image).
 * Use for thematic backgrounds ("money spiral", "velvet curtain", etc.).
 */
export async function generateBackground(prompt: string, aspectRatio: '16:9' | '9:16' | '1:1' = '16:9'): Promise<string> {
  const output = await replicate.run(MODELS.nanoBanana, {
    input: {
      prompt,
      aspect_ratio: aspectRatio,
      output_format: 'png',
    },
  });

  if (typeof output === 'string') return output;
  if (Array.isArray(output) && typeof output[0] === 'string') return output[0];
  // Some Replicate SDK versions return file-like objects with a url() method
  if (output && typeof (output as { url?: () => string }).url === 'function') {
    return (output as { url: () => string }).url();
  }

  console.error('[generateBackground] unexpected output shape:', output);
  throw new Error('Unexpected Nano Banana output shape.');
}
