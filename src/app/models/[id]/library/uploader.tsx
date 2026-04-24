'use client';

import { useState, useTransition } from 'react';
import { uploadStyleLibraryItem } from '@/lib/actions/style-library';
import { Upload, Loader2 } from 'lucide-react';

export function StyleLibraryUploader({ modelId }: { modelId: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    uploaded?: number;
    failed?: number;
    errors?: string[];
    error?: string;
  } | null>(null);

  async function handleSubmit(formData: FormData) {
    setResult(null);
    formData.set('model_id', modelId);
    formData.set('asset_type', 'thumbnail');

    startTransition(async () => {
      const res = await uploadStyleLibraryItem(formData);
      setResult(res);
    });
  }

  return (
    <form
      action={handleSubmit}
      className="rounded-lg border-2 border-dashed border-neutral-300 p-6"
    >
      <div className="flex flex-col items-center text-center">
        <Upload size={28} className="mb-3 text-neutral-400" />
        <label className="cursor-pointer">
          <span className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
            Choose files
          </span>
          <input
            type="file"
            name="files"
            accept="image/*"
            multiple
            required
            className="hidden"
            disabled={isPending}
          />
        </label>
        <p className="mt-2 text-xs text-neutral-500">
          Select multiple thumbnails at once. Each will be auto-tagged by Claude.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            {isPending ? 'Uploading & tagging...' : 'Upload'}
          </button>
        </div>

        {result && (
          <div className="mt-4 text-sm">
            {result.error ? (
              <p className="text-red-600">Error: {result.error}</p>
            ) : (
              <>
                <p className="text-green-600">
                  Uploaded {result.uploaded} file{result.uploaded === 1 ? '' : 's'}
                  {result.failed ? `, ${result.failed} failed` : ''}
                </p>
                {result.errors && result.errors.length > 0 && (
                  <ul className="mt-1 text-xs text-red-600">
                    {result.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
