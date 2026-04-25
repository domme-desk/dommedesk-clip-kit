import { getClip, listThumbnailsForClip, getPipelineStages } from '@/lib/actions/clips';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { RefreshButton } from './refresh-button';
import { RegenerateButton } from './regenerate-button';

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
  const effectiveDesc = clip.description || clip.auto_description;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link
        href="/clips"
        className="mb-6 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-black"
      >
        <ArrowLeft size={14} />
        Back to clips
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{clip.title || clip.original_filename}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {modelName} · uploaded {new Date(clip.created_at).toLocaleString()}
          </p>
          {clip.tags && clip.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {clip.tags.map((t: string, i: number) => (
                <span key={i} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <StatusBadge status={clip.status} />
      </div>

      {clip.status_message && (
        <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          {clip.status_message}
        </div>
      )}

      {effectiveDesc && (
        <section className="mt-6 rounded-lg border border-neutral-200 p-4">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Description</h2>
            {!clip.description && clip.auto_description && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                AI-generated
              </span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm text-neutral-700">{effectiveDesc}</p>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Thumbnails</h2>
          {clip.status === 'ready' && <RegenerateButton clipId={clip.id} />}
        </div>
        {thumbnails.length === 0 ? (
          <EmptyThumbnails status={clip.status} />
        ) : (() => {
          const runs = groupThumbnailsByRun(thumbnails);
          const [latestRun, ...priorRuns] = runs;
          return (
            <>
              <ThumbnailsGrid thumbnails={latestRun} />
              {priorRuns.length > 0 && (
                <div className="mt-8">
                  <h3 className="mb-3 text-sm font-semibold text-neutral-600">Previous generations</h3>
                  {priorRuns.map((run, i) => (
                    <details key={i} className="mb-3 rounded-lg border border-neutral-200 p-3">
                      <summary className="cursor-pointer text-xs text-neutral-600">
                        Run from {formatRelativeTime(run[0].created_at)} ({run.length} variants)
                      </summary>
                      <div className="mt-3">
                        <ThumbnailsGrid thumbnails={run} />
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </>
          );
        })()}
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
  created_at: string;
};

function ThumbnailsGrid({ thumbnails }: { thumbnails: ThumbRow[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {thumbnails.map((t) => {
        const brief = (t.composition_brief || {}) as Record<string, unknown>;
        // Support both old (text_primary string) and new (lockup array) brief shapes
        let primary: string | null = null;
        if (Array.isArray(brief.lockup)) {
          const lines = (brief.lockup as Array<{ text?: unknown }>)
            .map((l) => (typeof l?.text === 'string' ? l.text : ''))
            .filter(Boolean);
          if (lines.length > 0) primary = lines.join(' / ');
        } else if (typeof brief.text_primary === 'string') {
          primary = brief.text_primary;
        }
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
                <a href={`/api/download/thumbnail/${t.id}`} className="text-xs text-neutral-500 underline hover:text-black">Download</a>
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
          s.status === 'completed' ? 'bg-green-100 text-green-700'
          : s.status === 'running' ? 'bg-blue-100 text-blue-700'
          : s.status === 'failed' ? 'bg-red-100 text-red-700'
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

// Group thumbnails into runs by clustering on created_at
// Thumbnails within 5 minutes of each other are considered the same run
function groupThumbnailsByRun(thumbnails: ThumbRow[]): ThumbRow[][] {
  if (thumbnails.length === 0) return [];

  const RUN_GAP_MS = 5 * 60 * 1000; // 5 minutes
  const runs: ThumbRow[][] = [];
  let currentRun: ThumbRow[] = [thumbnails[0]];

  for (let i = 1; i < thumbnails.length; i++) {
    const prev = new Date(currentRun[currentRun.length - 1].created_at).getTime();
    const curr = new Date(thumbnails[i].created_at).getTime();
    if (Math.abs(prev - curr) > RUN_GAP_MS) {
      runs.push(currentRun);
      currentRun = [thumbnails[i]];
    } else {
      currentRun.push(thumbnails[i]);
    }
  }
  runs.push(currentRun);

  // Within each run, sort by variant_index ascending
  return runs.map((run) => [...run].sort((a, b) => a.variant_index - b.variant_index));
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

