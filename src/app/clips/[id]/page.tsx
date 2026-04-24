import { getClip } from '@/lib/actions/clips';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { RefreshButton } from './refresh-button';

type Props = {
  params: Promise<{ id: string }>;
};

export const dynamic = 'force-dynamic';

export default async function ClipDetailPage({ params }: Props) {
  const { id } = await params;
  const clip = await getClip(id);
  if (!clip) notFound();

  const modelName = (clip.models as { display_name: string } | null)?.display_name;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/clips"
        className="mb-6 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-black"
      >
        <ArrowLeft size={14} />
        Back to clips
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{clip.original_filename}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {modelName} &middot; uploaded {new Date(clip.created_at).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={clip.status} />
      </div>

      {clip.status_message && (
        <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          {clip.status_message}
        </div>
      )}

      <div className="mt-8 space-y-4">
        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="mb-3 font-semibold">Details</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-neutral-500">Filename</dt>
            <dd>{clip.original_filename}</dd>
            <dt className="text-neutral-500">Size</dt>
            <dd>{clip.file_size_bytes ? `${(clip.file_size_bytes / 1024 / 1024).toFixed(1)} MB` : '—'}</dd>
            <dt className="text-neutral-500">Storage path</dt>
            <dd className="font-mono text-xs">{clip.source_url}</dd>
          </dl>
        </section>

        <section className="rounded-lg border border-dashed border-neutral-300 p-5">
          <h2 className="mb-2 font-semibold text-neutral-600">Outputs</h2>
          <p className="text-sm text-neutral-500">
            Thumbnails will appear here once the pipeline is built out.
          </p>
        </section>

        <div className="flex justify-center pt-4">
          <RefreshButton />
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    uploaded: 'bg-neutral-100 text-neutral-700',
    processing: 'bg-blue-100 text-blue-700',
    ready: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${styles[status] || styles.uploaded}`}>
      {status}
    </span>
  );
}
