'use client';

import { RefreshCw } from 'lucide-react';

export function RefreshButton() {
  return (
    <button
      onClick={() => window.location.reload()}
      className="inline-flex items-center gap-2 text-xs text-neutral-500 hover:text-black"
      type="button"
    >
      <RefreshCw size={12} />
      Refresh to check status
    </button>
  );
}
