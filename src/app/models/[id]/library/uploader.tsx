'use client';

import { useState } from 'react';
import { uploadStyleLibraryItem } from '@/lib/actions/style-library';
import { Upload, Loader2, Check, X } from 'lucide-react';

type FileStatus = 'pending' | 'uploading' | 'done' | 'error';

type FileEntry = {
  file: File;
  status: FileStatus;
  error?: string;
};

export function StyleLibraryUploader({ modelId }: { modelId: string }) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    setEntries(files.map((f) => ({ file: f, status: 'pending' as FileStatus })));
  }

  async function uploadAll() {
    setIsRunning(true);
    for (let i = 0; i < entries.length; i++) {
      setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, status: 'uploading' } : e)));
      try {
        const fd = new FormData();
        fd.set('model_id', modelId);
        fd.set('asset_type', 'thumbnail');
        fd.append('files', entries[i].file);
        const res = await uploadStyleLibraryItem(fd);
        if (res && 'error' in res && res.error) {
          setEntries((prev) =>
            prev.map((e, idx) =>
              idx === i ? { ...e, status: 'error', error: res.error } : e
            )
          );
        } else {
          setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, status: 'done' } : e)));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setEntries((prev) =>
          prev.map((e, idx) => (idx === i ? { ...e, status: 'error', error: msg } : e))
        );
      }
    }
    setIsRunning(false);
    // Give the list a moment, then refresh the page to show the new items
    setTimeout(() => window.location.reload(), 1500);
  }

  const doneCount = entries.filter((e) => e.status === 'done').length;
  const errorCount = entries.filter((e) => e.status === 'error').length;

  return (
    <div className="rounded-lg border-2 border-dashed border-neutral-300 p-6">
      <div className="flex flex-col items-center text-center">
        <Upload size={28} className="mb-3 text-neutral-400" />
        <label className="cursor-pointer">
          <span className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
            Choose files
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFiles}
            disabled={isRunning}
          />
        </label>
        <p className="mt-2 text-xs text-neutral-500">
          Select multiple thumbnails at once. Each will be auto-tagged by Claude (one at a time).
        </p>

        {entries.length > 0 && (
          <div className="mt-4 w-full max-w-md">
            <button
              onClick={uploadAll}
              disabled={isRunning || entries.every((e) => e.status === 'done')}
              className="w-full rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
            >
              {isRunning
                ? `Uploading ${doneCount + 1}/${entries.length}...`
                : doneCount === entries.length
                ? 'All done'
                : `Upload ${entries.length} file${entries.length === 1 ? '' : 's'}`}
            </button>

            <ul className="mt-3 max-h-64 overflow-y-auto text-left text-xs">
              {entries.map((e, i) => (
                <li key={i} className="flex items-center justify-between border-b border-neutral-100 py-1">
                  <span className="truncate pr-2">{e.file.name}</span>
                  <span className="shrink-0">
                    {e.status === 'pending' && <span className="text-neutral-400">waiting</span>}
                    {e.status === 'uploading' && <Loader2 size={12} className="inline animate-spin text-blue-500" />}
                    {e.status === 'done' && <Check size={12} className="inline text-green-600" />}
                    {e.status === 'error' && (
                      <span className="inline-flex items-center gap-1 text-red-600">
                        <X size={12} />
                        {e.error?.slice(0, 40)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            {!isRunning && (doneCount > 0 || errorCount > 0) && (
              <p className="mt-2 text-xs text-neutral-500">
                {doneCount} uploaded, {errorCount} failed
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
