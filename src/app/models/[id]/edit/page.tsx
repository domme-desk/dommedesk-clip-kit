import { getModel } from '@/lib/actions/models';
import { updateBrandKit } from '@/lib/actions/models';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditModelPage({ params }: Props) {
  const { id } = await params;
  const model = await getModel(id);
  if (!model) notFound();

  const colors = model.brand_colors || {};
  const fonts = model.font_preferences || {};

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href={`/models/${model.id}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-black"
      >
        <ArrowLeft size={14} />
        Back to model
      </Link>

      <h1 className="text-3xl font-bold">Edit Brand Kit</h1>
      <p className="mt-1 text-sm text-neutral-500">{model.display_name}</p>

      <form action={updateBrandKit} encType="multipart/form-data" className="mt-8 space-y-8">
        <input type="hidden" name="id" value={model.id} />

        {/* BASIC */}
        <section className="space-y-4 rounded-lg border border-neutral-200 p-5">
          <h2 className="font-semibold">Basics</h2>

          <div>
            <label className="mb-1 block text-sm font-medium">Display Name</label>
            <input
              name="display_name"
              defaultValue={model.display_name}
              required
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Tone &amp; Voice</label>
            <textarea
              name="tone_notes"
              defaultValue={model.tone_notes || ''}
              rows={3}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Default Style Prompt</label>
            <textarea
              name="default_style_prompt"
              defaultValue={model.default_style_prompt || ''}
              rows={3}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-neutral-500">Fallback when style library is empty.</p>
          </div>
        </section>

        {/* COLORS */}
        <section className="space-y-4 rounded-lg border border-neutral-200 p-5">
          <h2 className="font-semibold">Brand Colors</h2>
          <p className="text-sm text-neutral-500">Hex codes, e.g. #FF0066</p>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Primary</label>
              <input
                name="brand_color_primary"
                defaultValue={(colors as Record<string, string>).primary || ''}
                placeholder="#000000"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Secondary</label>
              <input
                name="brand_color_secondary"
                defaultValue={(colors as Record<string, string>).secondary || ''}
                placeholder="#FFFFFF"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Accent</label>
              <input
                name="brand_color_accent"
                defaultValue={(colors as Record<string, string>).accent || ''}
                placeholder="#FF0066"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
              />
            </div>
          </div>
        </section>

        {/* FONTS */}
        <section className="space-y-4 rounded-lg border border-neutral-200 p-5">
          <h2 className="font-semibold">Fonts</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Heading Font</label>
              <input
                name="font_heading"
                defaultValue={(fonts as Record<string, string>).heading || ''}
                placeholder="e.g. Impact, Bebas Neue"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Body Font</label>
              <input
                name="font_body"
                defaultValue={(fonts as Record<string, string>).body || ''}
                placeholder="e.g. Inter, Helvetica"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Font Notes</label>
            <textarea
              name="font_notes"
              defaultValue={(fonts as Record<string, string>).notes || ''}
              rows={2}
              placeholder="e.g. always bold, italic accent, no script fonts..."
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        </section>

        {/* LOGO & WATERMARK */}
        <section className="space-y-4 rounded-lg border border-neutral-200 p-5">
          <h2 className="font-semibold">Logo &amp; Watermark</h2>

          <div>
            <label className="mb-1 block text-sm font-medium">Logo</label>
            {model.logo_url && (
              <div className="mb-2">
                <img src={model.logo_url} alt="Current logo" className="h-16 rounded border border-neutral-200" />
              </div>
            )}
            <input
              type="file"
              name="logo_file"
              accept="image/*"
              className="text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Watermark (PNG with transparency recommended)</label>
            {model.watermark_url && (
              <div className="mb-2">
                <img src={model.watermark_url} alt="Current watermark" className="h-16 rounded border border-neutral-200 bg-neutral-100" />
              </div>
            )}
            <input
              type="file"
              name="watermark_file"
              accept="image/*"
              className="text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Watermark Position</label>
            <select
              name="watermark_position"
              defaultValue={model.watermark_position}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="bottom-right">Bottom Right</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="top-right">Top Right</option>
              <option value="top-left">Top Left</option>
              <option value="center">Center</option>
            </select>
          </div>
        </section>

        {/* BANNED */}
        <section className="space-y-4 rounded-lg border border-neutral-200 p-5">
          <h2 className="font-semibold">Guardrails</h2>

          <div>
            <label className="mb-1 block text-sm font-medium">Banned Words</label>
            <input
              name="banned_words"
              defaultValue={(model.banned_words || []).join(', ')}
              placeholder="comma, separated, list"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Banned Themes</label>
            <input
              name="banned_themes"
              defaultValue={(model.banned_themes || []).join(', ')}
              placeholder="comma, separated, list"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        </section>

        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Save Changes
          </button>
          <Link
            href={`/models/${model.id}`}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
