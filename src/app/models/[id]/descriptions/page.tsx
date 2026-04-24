import { getModel } from '@/lib/actions/models';
import { listDescriptionExamples } from '@/lib/actions/description-examples';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { DescriptionUploader } from './uploader';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function DescriptionsPage({ params }: Props) {
  const { id } = await params;
  const model = await getModel(id);
  if (!model) notFound();

  const items = await listDescriptionExamples(id);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href={`/models/${model.id}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-black"
      >
        <ArrowLeft size={14} />
        Back to model
      </Link>

      <h1 className="text-3xl font-bold">Description Examples</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {model.display_name} · {items.length} example{items.length === 1 ? '' : 's'}
      </p>
      <p className="mt-4 text-sm text-neutral-600">
        Paste pairs of <strong>clip titles</strong> and their <strong>published descriptions</strong> so Claude learns to write in your voice. Claude will use these when auto-writing descriptions for new clips.
      </p>

      <div className="mt-8">
        <DescriptionUploader modelId={model.id} />
      </div>

      {items.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-neutral-300 p-10 text-center">
          <p className="text-sm text-neutral-500">No description examples yet.</p>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {items.map((item) => {
            const title = typeof (item.auto_tags as Record<string, unknown>)?.title === 'string'
              ? String((item.auto_tags as Record<string, unknown>).title)
              : item.notes || 'Untitled';
            return (
              <div key={item.id} className="rounded-lg border border-neutral-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="font-semibold text-sm">{title}</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">
                      {item.caption_text}
                    </p>
                    {item.manual_tags && item.manual_tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.manual_tags.map((tag, i) => (
                          <span
                            key={i}
                            className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
