import { getModel } from '@/lib/actions/models';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ModelDetailPage({ params }: Props) {
  const { id } = await params;
  const model = await getModel(id);

  if (!model) notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/models"
        className="mb-6 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-black"
      >
        <ArrowLeft size={14} />
        Back to models
      </Link>

      <h1 className="text-3xl font-bold">{model.display_name}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Model profile &middot; created {new Date(model.created_at).toLocaleDateString()}
      </p>

      <div className="mt-8 space-y-6">
        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="mb-3 font-semibold">Tone &amp; Voice</h2>
          {model.tone_notes ? (
            <p className="whitespace-pre-wrap text-sm text-neutral-700">
              {model.tone_notes}
            </p>
          ) : (
            <p className="text-sm text-neutral-400">No tone notes yet.</p>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="mb-3 font-semibold">Default Style Prompt</h2>
          {model.default_style_prompt ? (
            <p className="whitespace-pre-wrap text-sm text-neutral-700">
              {model.default_style_prompt}
            </p>
          ) : (
            <p className="text-sm text-neutral-400">No default style prompt yet.</p>
          )}
        </section>

        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="mb-3 font-semibold">Watermark</h2>
          <p className="text-sm text-neutral-700">
            Position: <span className="font-mono text-xs">{model.watermark_position}</span>
          </p>
          {!model.watermark_url && (
            <p className="mt-1 text-sm text-neutral-400">No watermark uploaded yet.</p>
          )}
        </section>

        <section className="rounded-lg border border-dashed border-neutral-300 p-5">
          <h2 className="mb-2 font-semibold text-neutral-600">Coming next</h2>
          <ul className="space-y-1 text-sm text-neutral-500">
            <li>&bull; Brand colors, fonts, logo/watermark upload</li>
            <li>&bull; Style library (upload thumbnail examples)</li>
            <li>&bull; Banned words and themes</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
