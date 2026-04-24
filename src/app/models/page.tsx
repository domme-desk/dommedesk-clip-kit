import Link from 'next/link';
import { listModels } from '@/lib/actions/models';
import { Plus } from 'lucide-react';

export default async function ModelsPage() {
  const models = await listModels();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Models</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Creators you generate clip kits for
          </p>
        </div>
        <Link
          href="/models/new"
          className="inline-flex items-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          <Plus size={16} />
          New Model
        </Link>
      </div>

      {models.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center">
          <p className="text-neutral-600">No models yet.</p>
          <p className="mt-2 text-sm text-neutral-500">
            Create your first creator profile to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {models.map((model) => (
            <Link
              key={model.id}
              href={`/models/${model.id}`}
              className="block rounded-lg border border-neutral-200 p-4 hover:border-neutral-400"
            >
              <h2 className="font-semibold">{model.display_name}</h2>
              {model.tone_notes && (
                <p className="mt-1 text-sm text-neutral-500 line-clamp-2">
                  {model.tone_notes}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
