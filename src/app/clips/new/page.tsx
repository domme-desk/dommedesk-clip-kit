import { listModels } from '@/lib/actions/models';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ClipUploader } from './uploader';

export default async function NewClipPage() {
  const models = await listModels();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link
        href="/clips"
        className="mb-6 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-black"
      >
        <ArrowLeft size={14} />
        Back to clips
      </Link>

      <h1 className="text-3xl font-bold">Upload Clip</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Upload an 8-15min final edit. Processing starts automatically.
      </p>

      {models.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-neutral-300 p-8 text-center">
          <p className="text-neutral-600">You need to create a model first.</p>
          <Link
            href="/models/new"
            className="mt-3 inline-block text-sm font-medium text-black underline"
          >
            Create your first model &rarr;
          </Link>
        </div>
      ) : (
        <div className="mt-8">
          <ClipUploader models={models} />
        </div>
      )}
    </main>
  );
}
