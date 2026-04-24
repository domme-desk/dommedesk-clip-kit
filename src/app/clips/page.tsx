import Link from 'next/link';
import { listClips } from '@/lib/actions/clips';
import { Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ClipsPage() {
  const clips = await listClips();

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Clips</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Uploaded source clips and their generated outputs
          </p>
        </div>
        <Link
          href="/clips/new"
          className="inline-flex items-center gap-2 rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          <Plus size={16} />
          New Clip
        </Link>
      </div>

      {clips.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center">
          <p className="text-neutral-600">No clips uploaded yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clips.map((clip) => {
            const modelName = (clip.models as { display_name: string } | null)?.display_name;
            return (
              <Link
                key={clip.id}
                href={`/clips/${clip.id}`}
                className="flex items-center justify-between rounded-lg border border-neutral-200 p-4 hover:border-neutral-400"
              >
                <div>
                  <h2 className="font-semibold">{clip.original_filename || 'Untitled clip'}</h2>
                  <p className="mt-0.5 text-sm text-neutral-500">
                    {modelName} &middot; {new Date(clip.created_at).toLocaleString()}
                  </p>
                </div>
                <StatusBadge status={clip.status} />
              </Link>
            );
          })}
        </div>
      )}
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
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${styles[status] || styles.uploaded}`}>
      {status}
    </span>
  );
}
