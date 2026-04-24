import { getModel } from '@/lib/actions/models';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil } from 'lucide-react';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ModelDetailPage({ params }: Props) {
  const { id } = await params;
  const model = await getModel(id);
  if (!model) notFound();

  const colors = (model.brand_colors || {}) as Record<string, string>;
  const fonts = (model.font_preferences || {}) as Record<string, string>;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/models"
        className="mb-6 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-black"
      >
        <ArrowLeft size={14} />
        Back to models
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">{model.display_name}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Created {new Date(model.created_at).toLocaleDateString()}
          </p>
        </div>
        <Link
          href={`/models/${model.id}/edit`}
          className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
        >
          <Pencil size={14} />
          Edit Brand Kit
        </Link>
      </div>

      <div className="mt-8 space-y-4">
        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="mb-3 font-semibold">Tone &amp; Voice</h2>
          {model.tone_notes ? (
            <p className="whitespace-pre-wrap text-sm text-neutral-700">{model.tone_notes}</p>
          ) : (
            <p className="text-sm text-neutral-400">No tone notes yet.</p>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="mb-3 font-semibold">Default Style Prompt</h2>
          {model.default_style_prompt ? (
            <p className="whitespace-pre-wrap text-sm text-neutral-700">{model.default_style_prompt}</p>
          ) : (
            <p className="text-sm text-neutral-400">No default style prompt yet.</p>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="mb-3 font-semibold">Brand Colors</h2>
          {colors.primary || colors.secondary || colors.accent ? (
            <div className="flex gap-4">
              {(['primary', 'secondary', 'accent'] as const).map((key) =>
                colors[key] ? (
                  <div key={key} className="flex items-center gap-2">
                    <div
                      className="h-8 w-8 rounded border border-neutral-200"
                      style={{ backgroundColor: colors[key] }}
                    />
                    <div>
                      <div className="text-xs font-medium capitalize">{key}</div>
                      <div className="font-mono text-xs text-neutral-500">{colors[key]}</div>
                    </div>
                  </div>
                ) : null
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-400">No brand colors set.</p>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="mb-3 font-semibold">Fonts</h2>
          {fonts.heading || fonts.body || fonts.notes ? (
            <div className="space-y-1 text-sm text-neutral-700">
              {fonts.heading && <div><span className="text-neutral-500">Heading:</span> {fonts.heading}</div>}
              {fonts.body && <div><span className="text-neutral-500">Body:</span> {fonts.body}</div>}
              {fonts.notes && <div className="text-neutral-500 italic">{fonts.notes}</div>}
            </div>
          ) : (
            <p className="text-sm text-neutral-400">No fonts set.</p>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="mb-3 font-semibold">Logo &amp; Watermark</h2>
          <div className="flex gap-6">
            <div>
              <div className="mb-1 text-xs text-neutral-500">Logo</div>
              {model.logo_url ? (
                <img src={model.logo_url} alt="Logo" className="h-16 rounded border border-neutral-200" />
              ) : (
                <div className="flex h-16 w-32 items-center justify-center rounded border border-dashed border-neutral-300 text-xs text-neutral-400">
                  None
                </div>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs text-neutral-500">Watermark ({model.watermark_position})</div>
              {model.watermark_url ? (
                <img src={model.watermark_url} alt="Watermark" className="h-16 rounded border border-neutral-200 bg-neutral-100" />
              ) : (
                <div className="flex h-16 w-32 items-center justify-center rounded border border-dashed border-neutral-300 text-xs text-neutral-400">
                  None
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="mb-3 font-semibold">Guardrails</h2>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-neutral-500">Banned words: </span>
              {model.banned_words && model.banned_words.length > 0 ? (
                <span className="text-neutral-700">{model.banned_words.join(', ')}</span>
              ) : (
                <span className="text-neutral-400">none</span>
              )}
            </div>
            <div>
              <span className="text-neutral-500">Banned themes: </span>
              {model.banned_themes && model.banned_themes.length > 0 ? (
                <span className="text-neutral-700">{model.banned_themes.join(', ')}</span>
              ) : (
                <span className="text-neutral-400">none</span>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-dashed border-neutral-300 p-5">
          <h2 className="mb-2 font-semibold text-neutral-600">Coming next</h2>
          <ul className="space-y-1 text-sm text-neutral-500">
            <li>&bull; Style library (upload thumbnail examples for this model)</li>
            <li>&bull; Clip upload and pipeline</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
