'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClipUploadUrl, finalizeClipUpload } from '@/lib/actions/clips';
import { createClient } from '@/lib/supabase/client';
import { Upload, Loader2 } from 'lucide-react';
import type { Model } from '@/lib/supabase/types';

function filenameToTitle(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')              // strip extension
    .replace(/[_-]+/g, ' ')               // underscores/dashes to spaces
    .replace(/\s+/g, ' ')
    .trim();
}

export function ClipUploader({ models }: { models: Model[] }) {
  const router = useRouter();
  const [modelId, setModelId] = useState(models[0]?.id || '');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'finalizing' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (f && !title) setTitle(filenameToTitle(f.name));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !modelId || !title.trim()) return;

    setStatus('uploading');
    setError(null);

    try {
      const urlRes = await createClipUploadUrl(file.name, modelId);
      if ('error' in urlRes) throw new Error(urlRes.error);

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from('clips')
        .uploadToSignedUrl(urlRes.path, urlRes.token, file, {
          contentType: file.type || 'video/mp4',
        });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      setStatus('finalizing');

      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const finalizeRes = await finalizeClipUpload({
        model_id: modelId,
        storage_path: urlRes.path,
        original_filename: file.name,
        file_size_bytes: file.size,
        title: title.trim(),
        description: description.trim() || undefined,
        tags,
      });

      if ('error' in finalizeRes) throw new Error(finalizeRes.error);

      router.push(`/clips/${finalizeRes.clipId}`);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  const isBusy = status === 'uploading' || status === 'finalizing';

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="mb-1 block text-sm font-medium">Model</label>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          required
          disabled={isBusy}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
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
            onChange={handleFileChange}
            required
            disabled={isBusy}
            className="text-sm"
          />
          {file && (
            <p className="mt-2 text-xs text-neutral-500">
              {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Clip Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={500}
          disabled={isBusy}
          placeholder="e.g. A Task for Chastity Slave"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-neutral-500">
          Auto-filled from filename. Edit to match the real title — it drives the whole thumbnail concept.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Tags</label>
        <input
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          disabled={isBusy}
          placeholder="chastity, tease, findom"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-neutral-500">
          Comma-separated. Helps the AI understand what's in the clip.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">
          Description <span className="text-neutral-400">(optional)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={5000}
          disabled={isBusy}
          placeholder="Leave blank and the AI will write one based on the title, tags, and examples. Fill in to override."
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      {status === 'uploading' && (
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <Loader2 size={14} className="animate-spin" />
          Uploading to storage...
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
        disabled={!file || !modelId || !title.trim() || isBusy}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        Upload & Process
      </button>
    </form>
  );
}
