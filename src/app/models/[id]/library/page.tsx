import { getModel } from '@/lib/actions/models';
import { listStyleLibraryItems } from '@/lib/actions/style-library';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { StyleLibraryUploader } from './uploader';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function StyleLibraryPage({ params }: Props) {
  const { id } = await params;
  const model = await getModel(id);
  if (!model) notFound();

  const items = await listStyleLibraryItems(id, 'thumbnail');

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link
        href={`/models/${model.id}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-black"
      >
        <ArrowLeft size={14} />
        Back to model
      </Link>

      <h1 className="text-3xl font-bold">Style Library</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {model.display_name} &middot; {items.length} thumbnail{items.length === 1 ? '' : 's'}
      </p>

      <div className="mt-8">
        <StyleLibraryUploader modelId={model.id} />
      </div>

      {items.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-neutral-300 p-12 text-center">
          <p className="text-neutral-600">No style examples yet.</p>
          <p className="mt-2 text-sm text-neutral-500">
            Upload 5+ thumbnails to unlock personalized generation.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item) => {
            const tags = (item.auto_tags || {}) as Record<string, unknown>;
            return (
              <div
                key={item.id}
                className="overflow-hidden rounded-lg border border-neutral-200"
              >
                <div className="aspect-video overflow-hidden bg-neutral-100">
                  <img
                    src={item.asset_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="p-3">
                  {tags.mood !== undefined && (
                    <div className="text-xs font-medium text-neutral-700">
                      {String(tags.mood)}
                    </div>
                  )}
                  {tags.background_type !== undefined && (
                    <div className="mt-0.5 text-xs text-neutral-500">
                      bg: {String(tags.background_type)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
