'use client';

import { useState, useTransition } from 'react';
import { regenerateClip } from '@/lib/actions/clips';
import { RefreshCw, Loader2 } from 'lucide-react';

export function RegenerateButton({ clipId }: { clipId: string }) {
  const [isPending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);

  function handleClick() {
    if (!confirmed) {
      setConfirmed(true);
      setTimeout(() => setConfirmed(false), 3000);
      return;
    }
    startTransition(async () => {
      await regenerateClip(clipId);
      window.location.reload();
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50 ${
        confirmed
          ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
          : 'border-neutral-300 hover:bg-neutral-50'
      }`}
    >
      {isPending ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <RefreshCw size={14} />
      )}
      {isPending ? 'Regenerating...' : confirmed ? 'Click again to confirm' : 'Regenerate thumbnails'}
    </button>
  );
}
