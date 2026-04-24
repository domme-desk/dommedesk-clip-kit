'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClipUploadUrl, finalizeClipUpload } from '@/lib/actions/clips';
import { createClient } from '@/lib/supabase/client';
import { Upload, Loader2 } from 'lucide-react';
import type { Model } from '@/lib/supabase/types';

export function ClipUploader({ models }: { models: Model[] }) {
  const router = useRouter();
  const [modelId, setModelId] = useState(models[0]?.id || '');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'finalizing' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !modelId) return;

    setStatus('uploading');
    setError(null);
    setProgress(0);

    try {
      // 1. Get signed upload URL from server
      const urlRes = await createClipUploadUrl(file.name, modelId);
      if ('error' in urlRes) {
        throw new Error(urlRes.error);
      }

      // 2. Upload directly to Supabase Storage via signed URL
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from('clips')
        .uploadToSignedUrl(urlRes.path, urlRes.token, file, {
          contentType: file.type || 'video/mp4',
        });

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      setProgress(100);
      setStatus('finalizing');

      // 3. Finalize — create DB row, kick off Inngest job
      const finalizeRes = await finalizeClipUpload({
        model_id: modelId,
        storage_path: urlRes.path,
        original_filename: file.name,
        file_size_bytes: file.size,
      });

      if ('error' in finalizeRes) {
        throw new Error(finalizeRes.error);
      }

      router.push(`/clips/${finalizeRes.clipId}`);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="mb-1 block text-sm font-medium">Model</label>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          required
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Video File</label>
        <div className="rounded-lg border-2 border-dashed border-neutral-300 p-6 text-center">
          <Upload size={24} className="mx-auto mb-2 text-neutral-400" />
          <input
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
            className="text-sm"
          />
          {file && (
            <p className="mt-2 text-xs text-neutral-500">
              {file.name} &middot; {(file.size / 1024 / 1024).toFixed(1)} MB
            </p>
          )}
        </div>
      </div>

      {status === 'uploading' && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-neutral-500">
            <span>Uploading to storage...</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full animate-pulse bg-black" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {status === 'finalizing' && (
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <Loader2 size={14} className="animate-spin" />
          Starting pipeline...
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={!file || !modelId || status === 'uploading' || status === 'finalizing'}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        Upload & Process
      </button>
    </form>
  );
}
