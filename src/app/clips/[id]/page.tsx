import { getClip, listThumbnailsForClip, getPipelineStages } from '@/lib/actions/clips';
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

  const [thumbnails, stages] = await Promise.all([
    listThumbnailsForClip(id),
    getPipelineStages(id),
  ]);

  const modelName = (clip.models as { display_name: string } | null)?.display_name;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
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
            {modelName} · uploaded {new Date(clip.created_at).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={clip.status} />
      </div>

      {clip.status_message && (
        <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          {clip.status_message}
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-3 font-semibold">Thumbnails</h2>
        {thumbnails.length === 0 ? (
          <EmptyThumbnails status={clip.status} />
        ) : (
          <ThumbnailsGrid thumbnails={thumbnails} />
        )}
      </section>

      <section className="mt-8 rounded-lg border border-neutral-200 p-5">
        <h2 className="mb-3 font-semibold">Pipeline</h2>
        {stages.length === 0 ? (
          <p className="text-sm text-neutral-400">No stages yet.</p>
        ) : (
          <StagesList stages={stages} />
        )}
      </section>

      <div className="mt-6 flex justify-center">
        <RefreshButton />
      </div>
    </main>
  );
}

function EmptyThumbnails({ status }: { status: string }) {
  let msg = 'No thumbnails yet.';
  if (status === 'processing') msg = 'Generating thumbnails — hang tight...';
  if (status === 'failed') msg = 'Generation failed. See pipeline stages below.';
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center">
      <p className="text-sm text-neutral-500">{msg}</p>
    </div>
  );
}

type ThumbRow = {
  id: string;
  image_url: string;
  variant_index: number;
  composition_brief: Record<string, unknown> | null;
};

function ThumbnailsGrid({ thumbnails }: { thumbnails: ThumbRow[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {thumbnails.map((t) => {
        const brief = (t.composition_brief || {}) as Record<string, unknown>;
        const primary = typeof brief.text_primary === 'string' ? brief.text_primary : null;
        const bgConcept = typeof brief.background_concept === 'string' ? brief.background_concept : null;
        return (
          <div key={t.id} className="overflow-hidden rounded-lg border border-neutral-200">
            <div className="aspect-video overflow-hidden bg-neutral-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.image_url} alt={`Variant ${t.variant_index}`} className="h-full w-full object-cover" />
            </div>
            <div className="p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Variant {t.variant_index}</span>
                <a href={t.image_url} download="thumbnail.png" className="text-xs text-neutral-500 underline hover:text-black">Download</a>
              </div>
              {primary && (
                <div className="mt-1 text-xs text-neutral-500">&ldquo;{primary}&rdquo;</div>
              )}
              {bgConcept && (
                <div className="mt-0.5 text-xs text-neutral-400">bg: {bgConcept}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type StageRow = {
  id: string;
  stage: string;
  status: string;
};

function StagesList({ stages }: { stages: StageRow[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {stages.map((s) => {
        const tone =
          s.status === 'completed'
            ? 'bg-green-100 text-green-700'
            : s.status === 'running'
            ? 'bg-blue-100 text-blue-700'
            : s.status === 'failed'
            ? 'bg-red-100 text-red-700'
            : 'bg-neutral-100 text-neutral-600';
        return (
          <li key={s.id} className="flex items-center justify-between">
            <span className="font-mono text-xs">{s.stage}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{s.status}</span>
          </li>
        );
      })}
    </ul>
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
